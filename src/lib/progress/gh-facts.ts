// Builds the GitHub facts of a report window from data already downloaded (issues, pull requests, issue
// timelines, Project #7 items). Pure: the network lives in gh-client.ts, the clock is passed in. The
// output is a PROPOSAL for the drafting step and the screen: status, delivery date, rolled-up sub-issues,
// the evidence behind each choice, what looks internal, and the git work the coverage check needs.
import type { EntryStatus, ReportWindow } from "../progress-report.ts";
import type { GitWork } from "./gaps.ts";
import { MAIN_BRANCH, asBoardStatus, boardStatusAt, classifyEntry, pickDelivery, prStateAt, toSaoPauloIso } from "./gh-status.ts";
import type { PrFact, StatusDecision } from "./gh-status.ts";

/* ---------- Input: what the client downloads, already in plain camelCase ---------- */

export type GhIssue = {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  stateReason: "completed" | "not_planned" | "reopened" | null;
  createdAt: string;
  closedAt: string | null;
  labels: string[];
  author: string | null;
  assignees: string[];
  body: string;
  /** Set when this issue is a sub-issue: it is rolled up into that parent (its direct one, at any depth). */
  parent: number | null;
  /**
   * What GitHub says about this issue's DIRECT sub-issues. The report counts the leaves of the tree it was
   * given instead; this is how a tree that was read only in part is noticed (and what stands in for the parts
   * under an issue none of whose sub-issues were read).
   */
  subIssues: { total: number; completed: number } | null;
};

export type GhCommit = { oid: string; at: string; author: string | null };

export type GhPr = PrFact & {
  author: string | null;
  /** Issues GitHub says this PR closes (closing keywords in the body, or linked in the sidebar). */
  closing: number[];
  commits: GhCommit[];
  /** The commit this PR left on its base branch (squash or merge commit). */
  mergeCommit: string | null;
};

export type GhTimeline = {
  issue: number;
  /** Commits whose message cites the issue. */
  commits: GhCommit[];
  /** PRs that closed the issue. */
  closers: number[];
  /** Project #7 status changes the timeline recorded (GitHub does not record the ones made through the API). */
  statusHistory: { at: string; to: string }[];
};

/** One Project #7 item. The project mixes products: items carry their repository, and only ours count. */
export type GhProjectItem = {
  repository: string;
  number: number;
  kind: "Issue" | "PullRequest";
  status: string | null;
  statusUpdatedAt: string | null;
};

/** The local `.frontlights/progress/hide.json`: issue numbers and title patterns to treat as internal. */
export type HideList = { issues: number[]; patterns: string[] };

export type FactsInput = {
  repository: string;
  window: ReportWindow;
  generatedAt: string;
  issues: GhIssue[];
  prs: GhPr[];
  timelines: GhTimeline[];
  projectItems: GhProjectItem[];
  /** Commits on the default branch in the window (direct pushes included). */
  mainCommits?: GhCommit[];
  hide?: HideList;
  /** Whose git work counts for the coverage check; the other people's commits say nothing about Claude use. */
  author?: string | null;
};

/* ---------- Output ---------- */

/** What happened to the parts of an umbrella in the window: evidence for whoever writes, never part of the draft. */
export type PartsSlices = {
  /** Parts, at any depth, closed as completed inside the window, in closing order (São Paulo time). */
  closed: { title: string; closedAt: string }[];
  /** Open parts that carry a blocker label or sit on the Blocker column of Project #7. */
  blocked: { title: string }[];
};

/** The epic above a delivery: only a header for it (an epic is a grouper, never an entry and never needs a print). */
export type EpicContext = {
  /** The closest epic above the delivery. */
  issue: number;
  title: string;
  /** The deliveries under that epic (not their leaves): how many there are, and how many are closed as completed. */
  parts: { total: number; done: number };
};

export type FactEntry = {
  id: string; // "gc-<issue>": the key edits are stored under
  issue: number;
  title: string; // as written on GitHub: the drafting step rewrites it in plain language
  status: EntryStatus;
  deliveredAt: string | null;
  /** The parts of the issue: the leaves of its whole tree of sub-issues, at any depth (cancelled ones left out). */
  subIssues: { total: number; done: number } | null;
  /** Only for an issue that has sub-issues. Kept in facts.json: the assembled draft does not carry it. */
  slices?: PartsSlices;
  /** Only for a delivery with an epic above it; kept in facts.json like `slices`: the assembled draft does not carry it. */
  epic?: EpicContext;
  /** Every epic above the delivery, the outermost first and the closest last (as written on GitHub). */
  epicPath?: { issue: number; title: string }[];
  hidden: boolean;
  hiddenReason: string | null;
  evidence: string[];
  sources: string[];
};

export type InternalItem = { ref: string; title: string; reason: string };

export type ProgressFacts = {
  scope: "GeoCloud";
  repository: string;
  window: ReportWindow;
  generatedAt: string;
  entries: FactEntry[];
  internal: { count: number; items: InternalItem[] };
  /** Commits and merged PRs of the window, in time order: what the coverage check measures against Claude use. */
  gitWork: GitWork[];
  /** Filled by the CLI when a usage file is given. */
  gaps?: { at: string; ref: string; nearestMessageMinutes: number | null }[];
  /**
   * What was looked at and deliberately left out, so a missing issue is never a mystery. `cut` counts the issues
   * whose sub-issues GitHub counts but the collector did not read (a tree too deep or too big, or sub-issues of
   * another repository): their entries carry a line saying the parts may be underestimated. `epics` counts the
   * epics treated as groupers (an epic whose ancestors are all epics): none of them is an entry.
   */
  ignored: { backlog: number; quiet: number; settled: number; children: number; cut: number; epics: number };
};

/* ---------- Window and hide list ---------- */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const dayParts = (s: string): [number, number, number] | null => {
  const m = DAY.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? [y, mo, d] : null;
};

/** `--from` and `--to` are São Paulo calendar days and `--to` is included: the window ends the morning after. */
export function windowFromDates(from: string, to: string): { ok: true; window: ReportWindow } | { ok: false; error: string } {
  const a = dayParts(from);
  const b = dayParts(to);
  if (!a || !b) return { ok: false, error: "Use datas no formato AAAA-MM-DD, por exemplo 2026-09-28, em --from e --to." };
  if (from > to) return { ok: false, error: "A data de --from não pode ser depois da data de --to." };
  const next = new Date(Date.UTC(b[0], b[1] - 1, b[2] + 1)).toISOString().slice(0, 10);
  return { ok: true, window: { start: `${from}T00:00:00-03:00`, end: `${next}T00:00:00-03:00` } };
}

export function parseHideList(json: unknown): HideList {
  const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  return {
    issues: list(obj.issues).filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0),
    patterns: list(obj.patterns).filter((p): p is string => typeof p === "string" && p.length > 0),
  };
}

/* ---------- Time helpers ---------- */

const SP_PARTS = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "28/09 15:49", São Paulo time. */
export function formatSaoPaulo(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return at;
  const p = Object.fromEntries(SP_PARTS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

/* ---------- What looks internal ---------- */

/** An epic only groups deliveries: the label is the repository's own `type:epic`. */
export const isEpic = (issue: { labels: string[] }): boolean => issue.labels.some((l) => l.trim().toLowerCase() === "type:epic");

const TITLE_REF = /\(#(\d+)\)/g;
const TEST_SYNC =
  /\b(?:teste|test)\b[^\n]{0,24}\b(?:sync|sincroniza\w*)\b|\b(?:sync|sincroniza\w*)\b[^\n]{0,24}\b(?:teste|test)\b/i;
const INTERNAL_LABELS = new Set(["test", "tests", "testing", "type:test", "chore", "type:chore", "infra", "type:infra", "ci"]);
const FEATURE_LABELS = new Set(["type:feature", "feature", "enhancement"]);
// Follow-ups born from a review or a live check name their origin right at the top of the body.
const FOLLOW_UP_BODY = [
  /\bachados?\b[^.\n]{0,60}\b(?:revis[aã]o|revis[oõ]es|confer[eê]ncia|review)\b/i,
  /^\s*origem\s*:[^\n]{0,200}\b(?:follow-?ups?|achados?|revis[aã]o|revis[oõ]es|campanha|pend[eê]ncias?)\b/i,
];
/** Five or more issues by one person, each within five minutes of the previous one, is a planning session. */
const BATCH_MIN = 5;
const BATCH_GAP_MS = 5 * 60_000;

function batchMembers(issues: GhIssue[]): Set<number> {
  const byAuthor = new Map<string, GhIssue[]>();
  for (const i of issues) {
    const key = i.author ?? "";
    byAuthor.set(key, [...(byAuthor.get(key) ?? []), i]);
  }
  const members = new Set<number>();
  for (const list of byAuthor.values()) {
    list.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    let run: GhIssue[] = [];
    const close = () => {
      if (run.length >= BATCH_MIN) for (const i of run) members.add(i.number);
      run = [];
    };
    for (const i of list) {
      const last = run.at(-1);
      if (last && Date.parse(i.createdAt) - Date.parse(last.createdAt) > BATCH_GAP_MS) close();
      run.push(i);
    }
    close();
  }
  return members;
}

const patternMatches = (pattern: string, text: string): boolean => {
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return false; // a typo in the local list must not stop the report
  }
};

/* ---------- The builder ---------- */

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}
const sameRepo = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const byNumber = (a: { number: number }, b: { number: number }): number => a.number - b.number;

/** Same limit as the draft contract's `sources` (draft.ts); a longer list would make the whole draft be refused. */
const MAX_SOURCES = 20;

export function buildFacts(input: FactsInput): ProgressFacts {
  const start = Date.parse(input.window.start);
  const end = Date.parse(input.window.end);
  const inWindow = (t: string | null | undefined): boolean => !!t && Date.parse(t) >= start && Date.parse(t) < end;
  const hide = input.hide ?? { issues: [], patterns: [] };

  const boardItem = new Map<number, GhProjectItem>();
  for (const it of input.projectItems) {
    if (it.kind === "Issue" && sameRepo(it.repository, input.repository)) boardItem.set(it.number, it);
  }
  const timelineOf = new Map(input.timelines.map((t) => [t.issue, t]));

  // PR -> issue links: "(#N)" in the title, a closing reference GitHub knows, or a PR the issue's timeline
  // says closed it. A PR that merely mentions an issue elsewhere (its body, a comment) delivers nothing.
  const prsOfIssue = new Map<number, GhPr[]>();
  const prHasIssue = new Set<number>();
  const prTargets = new Map<number, Set<number>>();
  for (const p of input.prs) {
    const targets = new Set<number>([...p.title.matchAll(TITLE_REF)].map((m) => Number(m[1])).concat(p.closing));
    for (const t of input.timelines) if (t.closers.includes(p.number)) targets.add(t.issue);
    targets.delete(p.number);
    prTargets.set(p.number, targets);
    if (targets.size > 0) prHasIssue.add(p.number);
    for (const n of targets) prsOfIssue.set(n, [...(prsOfIssue.get(n) ?? []), p]);
  }

  const childrenOf = new Map<number, number[]>();
  for (const i of input.issues) if (i.parent != null) childrenOf.set(i.parent, [...(childrenOf.get(i.parent) ?? []), i.number]);

  const batch = batchMembers(input.issues);
  const issueOf = new Map(input.issues.map((i) => [i.number, i]));
  // The issues above one, the closest first; null when the chain leaves what was collected (then nothing is known above it).
  const ancestorsOf = (i: GhIssue): GhIssue[] | null => {
    const chain: GhIssue[] = [];
    const seen = new Set([i.number]);
    for (let p = i.parent; p != null; ) {
      const up = issueOf.get(p);
      if (!up || seen.has(p)) return null;
      seen.add(p);
      chain.push(up);
      p = up.parent;
    }
    return chain;
  };
  // An epic groups: it is no delivery. The delivery ("work root") is the highest issue that is not an epic, so an
  // issue is one when everything above it is an epic (or nothing is), and the epics above it are only its header.
  const groupsOnly = (i: GhIssue): boolean => isEpic(i) && (ancestorsOf(i)?.every(isEpic) ?? false);
  const isWorkRoot = (i: GhIssue): boolean => !isEpic(i) && (ancestorsOf(i)?.every(isEpic) ?? false);
  // A PR that cites nothing but epics belongs to no delivery.
  const epicOnly = new Set<number>();
  for (const [number, targets] of prTargets) {
    if (targets.size > 0 && [...targets].every((n) => { const i = issueOf.get(n); return !!i && groupsOnly(i); })) {
      prHasIssue.delete(number);
      epicOnly.add(number);
    }
  }
  const closedAtOf = (n: number): string | null => {
    const i = issueOf.get(n);
    return i && i.state === "closed" ? i.closedAt : null;
  };
  // A step's merged PRs are reduced to the one that delivered it, so a PR that only polishes a step already
  // closed cannot move the delivery of the umbrella it belongs to.
  const reduced = (n: number): GhPr[] => {
    const all = prsOfIssue.get(n) ?? [];
    const merged = all.filter((p) => p.base === MAIN_BRANCH && prStateAt(p, input.window.end) === "merged");
    const delivery = pickDelivery(merged, timelineOf.get(n)?.closers ?? [], closedAtOf(n));
    return all.filter((p) => !merged.includes(p) || p === delivery);
  };
  // Everything under an issue, at any depth (a loop in the parent links, which GitHub does not allow, would not hang this).
  const descendantsOf = (n: number): GhIssue[] => {
    const found: GhIssue[] = [];
    const seen = new Set([n]);
    const walk = (m: number) => {
      for (const k of childrenOf.get(m) ?? []) {
        const kid = issueOf.get(k);
        if (seen.has(k) || !kid) continue;
        seen.add(k);
        found.push(kid);
        walk(k);
      }
    };
    walk(n);
    return found.sort(byNumber);
  };
  // The work of an issue is the work of its whole family: the PRs and commits of any part count for the umbrella.
  const gathered = (n: number) => {
    const family = descendantsOf(n);
    const own = timelineOf.get(n);
    const commits = new Map<string, GhCommit>();
    for (const t of [own, ...family.map((k) => timelineOf.get(k.number))]) for (const cm of t?.commits ?? []) commits.set(cm.oid, cm);
    return {
      family,
      prs: (family.length === 0 ? prsOfIssue.get(n) ?? [] : unique([...reduced(n), ...family.flatMap((k) => reduced(k.number))])).slice().sort(byNumber),
      commits: [...commits.values()],
      history: own?.statusHistory ?? [],
    };
  };

  // The parts of an issue are the leaves of its tree. A cancelled leaf is not a part; a leaf that GitHub says has
  // sub-issues nobody read stands for the parts GitHub counts under it.
  const cancelled = (i: GhIssue): boolean => i.state === "closed" && i.stateReason === "not_planned";
  const unread = (i: GhIssue | undefined): { total: number; done: number } | null =>
    i?.subIssues && i.subIssues.total > 0 ? { total: i.subIssues.total, done: Math.min(i.subIssues.completed, i.subIssues.total) } : null;
  const partsOf = (n: number, family: GhIssue[]): { total: number; done: number } | null => {
    const counts =
      family.length === 0
        ? [unread(issueOf.get(n))]
        : family.filter((i) => !childrenOf.has(i.number)).map((i) => unread(i) ?? (cancelled(i) ? { total: 0, done: 0 } : { total: 1, done: i.state === "closed" ? 1 : 0 }));
    const total = counts.reduce((sum, p) => sum + (p?.total ?? 0), 0);
    return total > 0 ? { total, done: counts.reduce((sum, p) => sum + (p?.done ?? 0), 0) } : null;
  };
  const deliveredPart = (i: GhIssue): boolean => i.state === "closed" && !cancelled(i) && !!i.closedAt;
  const incomplete = (i: GhIssue): boolean => !!i.subIssues && i.subIssues.total > (childrenOf.get(i.number)?.length ?? 0);
  // The repository's own convention: `status:blocker`, named like the Blocker column of Project #7. A bare "blocker" can mean a release blocker.
  const BLOCKED_LABEL = /^status\s*:\s*(?:blocker|blocked)$/i;
  const blockedPart = (i: GhIssue): boolean =>
    i.state === "open" &&
    (i.labels.some((l) => BLOCKED_LABEL.test(l.trim())) ||
      boardStatusAt(boardItem.get(i.number) ?? null, timelineOf.get(i.number)?.statusHistory ?? [], input.window.end) === "Blocker");

  // The parts of an epic are the deliveries under it, through any epics in between: a cancelled one is no part.
  const epicParts = (epic: GhIssue): { total: number; done: number } => {
    const roots = descendantsOf(epic.number).filter((i) => isWorkRoot(i) && !cancelled(i));
    return { total: roots.length, done: roots.filter((i) => i.state === "closed").length };
  };

  // The local hide list names an issue or a title; naming an epic hides every delivery under it.
  const hiddenLocally = (i: GhIssue): boolean => hide.issues.includes(i.number) || hide.patterns.some((p) => patternMatches(p, i.title));
  const internalReason = (i: GhIssue, atEnd: ReturnType<typeof boardStatusAt>, familyPrs: GhPr[], epics: GhIssue[], hasParts: boolean): string | null => {
    if (hiddenLocally(i) || epics.some(hiddenLocally)) return "lista local (hide.json)";
    if (TEST_SYNC.test(i.title)) return "teste de sincronização";
    if (i.state === "closed" && i.stateReason === "not_planned") return "fechada como não planejada";
    // Whatever the team moved to the sprint board is real work, whatever it is called.
    if (atEnd === "Development" || atEnd === "Blocker") return null;
    // The label and the body tell small stray tickets from real work; an issue already broken into parts is real work.
    if (!hasParts) {
      const labels = i.labels.map((l) => l.toLowerCase());
      if (labels.some((l) => INTERNAL_LABELS.has(l)) && !labels.some((l) => FEATURE_LABELS.has(l))) return "rótulo de teste/chore/infra";
      const head = i.body.slice(0, 400);
      if (FOLLOW_UP_BODY.some((re) => re.test(head))) return "pendência de revisão";
    }
    if (batch.has(i.number) && i.assignees.length === 0 && familyPrs.length === 0) {
      return "planejamento criado em lote";
    }
    return null;
  };

  const entries: FactEntry[] = [];
  const internal: InternalItem[] = [];
  const ignored = { backlog: 0, quiet: 0, settled: 0, children: 0, cut: input.issues.filter(incomplete).length, epics: 0 };

  for (const issue of [...input.issues].sort(byNumber)) {
    if (groupsOnly(issue)) {
      ignored.epics++;
      continue;
    }
    if (!isWorkRoot(issue)) {
      ignored.children++;
      continue;
    }
    const epics = ancestorsOf(issue) ?? []; // closest first; all of them are epics
    const { family, prs, commits, history } = gathered(issue.number);
    const closedParts = family.filter(deliveredPart);
    const item = boardItem.get(issue.number) ?? null;
    const atEnd = boardStatusAt(item, history, input.window.end);
    const now = asBoardStatus(item?.status);

    // Creating sub-issues is planning, not progress: only what was done to the family counts as its activity.
    const activity = [
      issue.createdAt,
      issue.closedAt,
      item?.statusUpdatedAt,
      ...history.map((h) => h.at),
      ...commits.map((c) => c.at),
      ...closedParts.map((p) => p.closedAt),
      ...prs.flatMap((p) => [p.createdAt, p.closedAt, p.mergedAt, ...p.commits.map((c) => c.at)]),
    ];
    const active = activity.some(inWindow);

    const reason = internalReason(issue, atEnd, prs, epics, family.length > 0);
    if (reason) {
      if (active) internal.push({ ref: `#${issue.number}`, title: issue.title, reason });
      continue;
    }
    const sprint = issue.state === "open" && (atEnd === "Development" || atEnd === "Blocker");
    if (!active && !sprint) {
      ignored.quiet++;
      continue;
    }

    const closedAt = issue.state === "closed" ? issue.closedAt : null;
    const subIssues = partsOf(issue.number, family);
    const decision = classifyEntry({
      windowEnd: input.window.end,
      closedAt,
      board: { atEnd, now },
      prs,
      closers: timelineOf.get(issue.number)?.closers,
      commits: commits.map((c) => c.at),
      subIssues,
      closedParts: closedParts.map((p) => p.closedAt as string),
    });
    if (!decision) {
      ignored.backlog++;
      continue;
    }
    // Delivered and closed before the window opened: later PRs that only polish it do not bring it back.
    if (closedAt && Date.parse(closedAt) < start && (!decision.delivery || Date.parse(decision.delivery.mergedAt ?? "") < start)) {
      ignored.settled++;
      continue;
    }

    const lastMerge = prs
      .filter((p) => prStateAt(p, input.window.end) === "merged")
      .map((p) => Date.parse(p.mergedAt ?? ""))
      .sort((a, b) => a - b)
      .at(-1);
    let hiddenReason: string | null = null;
    if (decision.delivery && Date.parse(decision.delivery.mergedAt ?? "") < start) hiddenReason = "entregue antes da janela";
    else if (closedAt && lastMerge !== undefined && lastMerge < start) hiddenReason = "entregue antes da janela (em outra branch)";
    else if (decision.reason === "closed_without_pr") hiddenReason = "fechada sem PR no GitHub: nada foi entregue por código";

    entries.push({
      id: `gc-${issue.number}`,
      issue: issue.number,
      title: issue.title,
      status: decision.status,
      deliveredAt: decision.deliveredAt,
      subIssues,
      ...(family.length > 0
        ? {
            slices: {
              closed: closedParts
                .filter((p) => inWindow(p.closedAt))
                .sort((a, b) => Date.parse(a.closedAt as string) - Date.parse(b.closedAt as string) || a.number - b.number)
                .map((p) => ({ title: p.title, closedAt: toSaoPauloIso(p.closedAt as string) })),
              blocked: family.filter(blockedPart).map((p) => ({ title: p.title })),
            },
          }
        : {}),
      ...(epics.length > 0
        ? {
            epic: { issue: epics[0].number, title: epics[0].title, parts: epicParts(epics[0]) },
            epicPath: [...epics].reverse().map((e) => ({ issue: e.number, title: e.title })),
          }
        : {}),
      hidden: hiddenReason !== null,
      hiddenReason,
      evidence: evidenceLines({
        issue,
        decision,
        prs,
        commits,
        now,
        since: item?.statusUpdatedAt ?? null,
        windowEnd: input.window.end,
        subIssues,
        closedInWindow: closedParts.filter((p) => inWindow(p.closedAt)).length,
        lastPartClosed: closedParts.map((p) => p.closedAt as string).filter(inWindow).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null,
        cut: [issue, ...family].some(incomplete),
        epic: epics.length > 0 ? { path: [...epics].reverse().map((e) => e.title), parts: epicParts(epics[0]) } : null,
      }),
      // The draft parser takes at most MAX_SOURCES links: the issue and the PR that delivered it come first.
      sources: unique([issue.url, ...(decision.delivery?.url ? [decision.delivery.url] : []), ...prs.map((p) => p.url)]).slice(0, MAX_SOURCES),
    });
  }

  // A PR that cites no issue at all is housekeeping, and so is one that cites nothing but an epic (a grouper,
  // never a delivery): it is listed with its reason instead of being lost.
  for (const p of [...input.prs].sort(byNumber)) {
    if (prHasIssue.has(p.number)) continue;
    if (inWindow(p.createdAt) || inWindow(p.mergedAt)) {
      internal.push({ ref: `PR #${p.number}`, title: p.title, reason: epicOnly.has(p.number) ? "PR que cita só um epic (agrupador)" : "PR sem issue" });
    }
  }

  return {
    scope: "GeoCloud",
    repository: input.repository,
    window: input.window,
    generatedAt: input.generatedAt,
    entries,
    internal: { count: internal.length, items: internal },
    gitWork: gitWorkOf(input, inWindow),
    ignored,
  };
}

/* ---------- Evidence (for the team and the drafting step; never printed in the e-mail) ---------- */

function evidenceLines(a: {
  issue: GhIssue;
  decision: StatusDecision;
  prs: GhPr[];
  commits: GhCommit[];
  now: ReturnType<typeof asBoardStatus>;
  since: string | null;
  windowEnd: string;
  subIssues: { total: number; done: number } | null;
  /** Parts closed as completed inside the window, and when the last one was. */
  closedInWindow: number;
  lastPartClosed: string | null;
  /** Some issue of the family has sub-issues that were not read. */
  cut: boolean;
  /** The epics above the issue (outermost first) and how far the closest one has come. */
  epic: { path: string[]; parts: { total: number; done: number } } | null;
}): string[] {
  const end = Date.parse(a.windowEnd);
  const lines: string[] = [];
  const otherMain: GhPr[] = [];
  const elsewhere: GhPr[] = [];
  for (const p of a.prs) {
    const state = prStateAt(p, a.windowEnd);
    if (state === "merged") {
      if (a.decision.delivery?.number === p.number) lines.push(`PR #${p.number} mesclado na main em ${formatSaoPaulo(p.mergedAt ?? "")}`);
      else (p.base === MAIN_BRANCH ? otherMain : elsewhere).push(p);
    } else if (state === "open") {
      lines.push(`PR #${p.number} ${p.draft ? "em rascunho" : "aberto"} desde ${formatSaoPaulo(p.createdAt)}${p.mergedAt ? `, mesclado só em ${formatSaoPaulo(p.mergedAt)}, depois do fim da janela` : ""}`);
    } else if (state === "abandoned") {
      lines.push(`PR #${p.number} fechado sem mesclar em ${formatSaoPaulo(p.closedAt ?? p.createdAt)}`);
    } else {
      const early = p.firstCommitAt && Date.parse(p.firstCommitAt) < end ? `; a branch tem commits desde ${formatSaoPaulo(p.firstCommitAt)}` : "";
      lines.push(`PR #${p.number} aberto só em ${formatSaoPaulo(p.createdAt)}, depois do fim da janela${early}`);
    }
  }
  // An umbrella can carry dozens of merged PRs: past three, say how many and when instead of listing each.
  const merged = (list: GhPr[], where: (p: GhPr) => string): string[] => {
    if (list.length === 0) return [];
    if (list.length <= 3) return list.map((p) => `PR #${p.number} mesclado ${where(p)} em ${formatSaoPaulo(p.mergedAt ?? "")}`);
    const times = list.map((p) => Date.parse(p.mergedAt ?? "")).sort((x, y) => x - y);
    const span = `de ${formatSaoPaulo(new Date(times[0]).toISOString())} a ${formatSaoPaulo(new Date(times[times.length - 1]).toISOString())}`;
    return [`${list.length} PRs mesclados ${where(list[0])}, ${span}`];
  };
  lines.push(...merged(otherMain, () => "na main"));
  lines.push(
    ...merged(elsewhere, (p) => (elsewhere.length > 3 ? "em outras branches, sem chegar à main" : `em ${p.base ?? "outra branch"}, sem chegar à main`))
  );
  const cited = a.commits.filter((c) => Date.parse(c.at) < end).sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  if (cited.length > 0) {
    lines.push(`${cited.length} commit${cited.length > 1 ? "s" : ""} citando a issue ou suas sub-issues, o último em ${formatSaoPaulo(cited[cited.length - 1].at)}`);
  }
  if (a.now) {
    const late = a.since && Date.parse(a.since) >= end ? ", depois do fim da janela" : "";
    lines.push(`Quadro: ${a.now}${a.since ? ` desde ${formatSaoPaulo(a.since)}` : ""}${late}`);
  }
  if (a.issue.state === "closed" && a.issue.closedAt) {
    lines.push(`Issue fechada em ${formatSaoPaulo(a.issue.closedAt)}${Date.parse(a.issue.closedAt) >= end ? ", depois do fim da janela" : ""}`);
  }
  if (a.subIssues) lines.push(`Partes (as folhas das sub-issues, em qualquer nível): ${a.subIssues.done} de ${a.subIssues.total} concluídas`);
  if (a.closedInWindow > 0 && a.lastPartClosed) {
    lines.push(`${a.closedInWindow} sub-issue${a.closedInWindow > 1 ? "s" : ""} fechada${a.closedInWindow > 1 ? "s" : ""} no período, a última em ${formatSaoPaulo(a.lastPartClosed)}`);
  }
  if (a.epic) lines.push(`Dentro do epic ${a.epic.path.join(" > ")}: ${a.epic.parts.done} de ${a.epic.parts.total} entregas dele prontas`);
  if (a.cut) lines.push("Leitura das sub-issues cortada (árvore funda ou grande demais, ou sub-issues de outro repositório): a contagem de partes pode estar abaixo do real");
  if (a.decision.reason === "board_development") {
    lines.push(`Sem commits nem PR até ${formatSaoPaulo(new Date(end - 60_000).toISOString())}: o quadro diz Development, mas ainda não há código`);
  }
  return lines;
}

/* ---------- Git work, for the coverage check ---------- */

function gitWorkOf(input: FactsInput, inWindow: (t: string | null | undefined) => boolean): GitWork[] {
  const sameAuthor = (login: string | null): boolean => !input.author || !login || login.toLowerCase() === input.author.toLowerCase();
  const squashCommits = new Set(input.prs.map((p) => p.mergeCommit).filter((oid): oid is string => !!oid));
  const seen = new Set<string>();
  const work: GitWork[] = [];
  const addCommit = (c: GhCommit) => {
    if (seen.has(c.oid) || squashCommits.has(c.oid) || !inWindow(c.at) || !sameAuthor(c.author)) return;
    seen.add(c.oid);
    work.push({ at: toSaoPauloIso(c.at), ref: `commit ${c.oid.slice(0, 7)}` });
  };
  for (const p of input.prs) {
    if (inWindow(p.mergedAt) && sameAuthor(p.author)) work.push({ at: toSaoPauloIso(p.mergedAt ?? ""), ref: `PR #${p.number} mesclado` });
    p.commits.forEach(addCommit);
  }
  input.timelines.forEach((t) => t.commits.forEach(addCommit));
  (input.mainCommits ?? []).forEach(addCommit);
  return work.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
}
