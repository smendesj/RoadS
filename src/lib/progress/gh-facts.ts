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
  /** Set when this issue is a sub-issue: it is rolled up into that parent. */
  parent: number | null;
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

export type FactEntry = {
  id: string; // "gc-<issue>": the key edits are stored under
  issue: number;
  title: string; // as written on GitHub: the drafting step rewrites it in plain language
  status: EntryStatus;
  deliveredAt: string | null;
  subIssues: { total: number; done: number } | null;
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
  /** What was looked at and deliberately left out, so a missing issue is never a mystery. */
  ignored: { backlog: number; quiet: number; settled: number; children: number };
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
  for (const p of input.prs) {
    const targets = new Set<number>([...p.title.matchAll(TITLE_REF)].map((m) => Number(m[1])).concat(p.closing));
    for (const t of input.timelines) if (t.closers.includes(p.number)) targets.add(t.issue);
    targets.delete(p.number);
    if (targets.size > 0) prHasIssue.add(p.number);
    for (const n of targets) prsOfIssue.set(n, [...(prsOfIssue.get(n) ?? []), p]);
  }

  const childrenOf = new Map<number, number[]>();
  for (const i of input.issues) if (i.parent != null) childrenOf.set(i.parent, [...(childrenOf.get(i.parent) ?? []), i.number]);

  const batch = batchMembers(input.issues);
  const issueOf = new Map(input.issues.map((i) => [i.number, i]));
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
  const gathered = (n: number) => {
    const kids = childrenOf.get(n) ?? [];
    const own = timelineOf.get(n);
    return {
      prs: (kids.length === 0 ? prsOfIssue.get(n) ?? [] : unique([...reduced(n), ...kids.flatMap(reduced)])).slice().sort(byNumber),
      commits: [...(own?.commits ?? []), ...kids.flatMap((k) => timelineOf.get(k)?.commits ?? [])],
      history: own?.statusHistory ?? [],
    };
  };

  const internalReason = (i: GhIssue, atEnd: ReturnType<typeof boardStatusAt>): string | null => {
    if (hide.issues.includes(i.number) || hide.patterns.some((p) => patternMatches(p, i.title))) return "lista local (hide.json)";
    if (TEST_SYNC.test(i.title)) return "teste de sincronização";
    if (i.state === "closed" && i.stateReason === "not_planned") return "fechada como não planejada";
    // Whatever the team moved to the sprint board is real work, whatever it is called.
    if (atEnd === "Development" || atEnd === "Blocker") return null;
    const labels = i.labels.map((l) => l.toLowerCase());
    if (labels.some((l) => INTERNAL_LABELS.has(l)) && !labels.some((l) => FEATURE_LABELS.has(l))) return "rótulo de teste/chore/infra";
    const head = i.body.slice(0, 400);
    if (FOLLOW_UP_BODY.some((re) => re.test(head))) return "pendência de revisão";
    if (batch.has(i.number) && i.assignees.length === 0 && (prsOfIssue.get(i.number) ?? []).length === 0) {
      return "planejamento criado em lote";
    }
    return null;
  };

  const entries: FactEntry[] = [];
  const internal: InternalItem[] = [];
  const ignored = { backlog: 0, quiet: 0, settled: 0, children: 0 };

  for (const issue of [...input.issues].sort(byNumber)) {
    if (issue.parent != null) {
      ignored.children++;
      continue;
    }
    const { prs, commits, history } = gathered(issue.number);
    const item = boardItem.get(issue.number) ?? null;
    const atEnd = boardStatusAt(item, history, input.window.end);
    const now = asBoardStatus(item?.status);

    const activity = [
      issue.createdAt,
      issue.closedAt,
      item?.statusUpdatedAt,
      ...history.map((h) => h.at),
      ...commits.map((c) => c.at),
      ...prs.flatMap((p) => [p.createdAt, p.closedAt, p.mergedAt, ...p.commits.map((c) => c.at)]),
    ];
    const active = activity.some(inWindow);

    const reason = internalReason(issue, atEnd);
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
    const subIssues = issue.subIssues && issue.subIssues.total > 0 ? { total: issue.subIssues.total, done: issue.subIssues.completed } : null;
    const decision = classifyEntry({
      windowEnd: input.window.end,
      closedAt,
      board: { atEnd, now },
      prs,
      closers: timelineOf.get(issue.number)?.closers,
      commits: commits.map((c) => c.at),
      subIssues,
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
      hidden: hiddenReason !== null,
      hiddenReason,
      evidence: evidenceLines({ issue, decision, prs, commits, now, since: item?.statusUpdatedAt ?? null, windowEnd: input.window.end, subIssues }),
      sources: unique([issue.url, ...prs.map((p) => p.url)]),
    });
  }

  // A PR that cites no issue at all is housekeeping.
  for (const p of [...input.prs].sort(byNumber)) {
    if (prHasIssue.has(p.number)) continue;
    if (inWindow(p.createdAt) || inWindow(p.mergedAt)) internal.push({ ref: `PR #${p.number}`, title: p.title, reason: "PR sem issue" });
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
    lines.push(`${cited.length} commit${cited.length > 1 ? "s" : ""} citando a issue, o último em ${formatSaoPaulo(cited[cited.length - 1].at)}`);
  }
  if (a.now) {
    const late = a.since && Date.parse(a.since) >= end ? ", depois do fim da janela" : "";
    lines.push(`Quadro: ${a.now}${a.since ? ` desde ${formatSaoPaulo(a.since)}` : ""}${late}`);
  }
  if (a.issue.state === "closed" && a.issue.closedAt) {
    lines.push(`Issue fechada em ${formatSaoPaulo(a.issue.closedAt)}${Date.parse(a.issue.closedAt) >= end ? ", depois do fim da janela" : ""}`);
  }
  if (a.subIssues) lines.push(`Sub-issues: ${a.subIssues.done} de ${a.subIssues.total} concluídas`);
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
