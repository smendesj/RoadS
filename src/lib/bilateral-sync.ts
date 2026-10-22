// The rule of the two-way sync, one field at a time (issue #22). RoadS keeps, per item and per field, what the issue
// said the last time the sync looked (the base). Comparing the two sides with the base tells who moved:
//   - only RoadS differs from the base: someone edited it in RoadS, and the value goes to GitHub;
//   - only GitHub differs: someone edited the issue, and the value comes to RoadS;
//   - both differ: the last one to move wins, by the time of the edit on each side; an unknown time loses to GitHub;
//   - no base yet (the first sync of the field): RoadS copies GitHub and writes nothing there, so an old value kept
//     in RoadS never overwrites an issue nobody touched.
// It replaces the old title-follow rule (titles only came down) and generalizes the last-mover rule of sprint-status-sync.ts.
//
// Pure on purpose: board-sync.ts reads both sides, applies the decisions and remembers the new base.

import { areaLabels, isHighPriority, TIPOS, type Stack, type Tipo } from "./issue-fields.ts";
import type { Prioridade } from "./types.ts";
import { currentMonday } from "./sprint-week.ts";

export type FieldSides = {
  /** What the RoadS item says now. */
  roads: string;
  /** What the issue said when the sync last looked; null when it never looked at this field. */
  base: string | null;
  /** What the issue says now. */
  github: string;
  /** When the field was last edited in RoadS (ISO), if known. */
  roadsAt: string | null;
  /** When the field was last changed on GitHub (ISO), if known; only needed when both sides moved. */
  githubAt: string | null;
  /**
   * An empty value on GitHub is a gap RoadS fills with its own (Type, Stack, Priority, Effort), not a value to copy; only
   * with a value someone edited in RoadS (`roadsAt`), never with a default nobody chose, which waits for that edit.
   */
  fillGap?: boolean;
};

export type FieldDecision = "pull" | "push" | "none";

export function decideField(f: FieldSides): FieldDecision {
  if (f.roads === f.github) return "none";
  if (f.fillGap && f.github === "") return f.roadsAt ? "push" : "none";
  if (f.base === null) return "pull";
  const roadsMoved = f.roads !== f.base;
  const githubMoved = f.github !== f.base;
  if (roadsMoved && !githubMoved) return "push";
  if (githubMoved && !roadsMoved) return "pull";
  if (f.roadsAt && f.githubAt && Date.parse(f.roadsAt) > Date.parse(f.githubAt)) return "push";
  return "pull";
}

/**
 * Effort's two sides (issue #23): GitHub's is the organization's issue field on the issue, "" when the issue leaves it
 * empty (a gap). GitHub doesn't tell when it changed, so that time is unknown and, both sides moved, the issue wins.
 * Null when the issue's Effort wasn't read: Effort waits for the next sync instead of reading as a difference.
 */
export function effortSides(roads: string, read: { effort: string | null } | undefined): { roads: string; github: string; githubAt: null } | null {
  return read ? { roads, github: read.effort ?? "", githubAt: null } : null;
}

/** Whether two bases hold the same fields with the same values: an item whose base didn't change isn't written again. */
export function sameBase(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
}

/** The Type an issue's labels give: its first type: label RoadS knows (type:epic is a block, not a Type). */
export function tipoOfLabels(labels: string[]): Tipo | null {
  for (const l of labels) {
    const t = l.startsWith("type:") ? l.slice(5) : "";
    if ((TIPOS as readonly string[]).includes(t)) return t as Tipo;
  }
  return null;
}

/** The issue's native type a Type implies: Bug and Feature by name, the rest Task. */
export function nativeTypeOf(tipo: Tipo): "Bug" | "Feature" | "Task" {
  return tipo === "bug" ? "Bug" : tipo === "feature" ? "Feature" : "Task";
}

export type LabelledField = "tipo" | "stack" | "prioridade";

/**
 * The issue's labels once its Type, Stack and Priority are these values. A field in `changed` swaps the labels of its
 * family (type: for the Type, area: for the Stack, priority:high for the Priority) for the ones it implies; any other
 * field only adds the ones it implies that are missing (the gaps), never removing a label someone put there. Labels of
 * other families are kept in their order, and the new ones go at the end.
 */
export function labelsAfter(
  labels: string[],
  values: { tipo: Tipo | null; stack: Stack | null; prioridade: Prioridade | null },
  changed: ReadonlySet<LabelledField>
): string[] {
  const isType = (l: string) => l.startsWith("type:") && (TIPOS as readonly string[]).includes(l.slice(5));
  const isArea = (l: string) => l === "area:frontend" || l === "area:backend";
  const dropped = (l: string) =>
    (changed.has("tipo") && isType(l)) || (changed.has("stack") && isArea(l)) || (changed.has("prioridade") && l === "priority:high");
  const next = labels.filter((l) => !dropped(l));
  const add = (l: string) => {
    if (!next.includes(l)) next.push(l);
  };
  if (values.tipo && !next.some(isType)) add(`type:${values.tipo}`);
  if (values.stack) areaLabels(values.stack).forEach(add);
  if (values.prioridade && isHighPriority(values.prioridade)) add("priority:high");
  return next;
}

// ---- Week (S5). An item's Week is the Monday of its week lane ("" in a block); on the board it is the date field Week.

/** The Monday of the item's week, or "" when it sits in a block. */
export function weekOfLane(lane: { kind: string; start_date: string | null } | undefined): string {
  return lane?.kind === "sprint" && lane.start_date ? lane.start_date : "";
}

/** The issue's Week: the Monday of the date on its card (a weekend counts as the week after, as the calendar does). */
export function weekOfIssue(date: string | null | undefined): string {
  return date ? currentMonday(date) : "";
}

/** Where a Week brought from GitHub puts the item: into that week, or back to its block; a week gone by moves nothing. */
export function weekPull(monday: string, today: string): { to: "week"; monday: string } | { to: "block" } | null {
  if (!monday) return { to: "block" };
  return monday < currentMonday(today) ? null : { to: "week", monday };
}

// ---- Status (S4). An item's own Status is Open, Blocker or Done. Development is not a Status RoadS keeps: it is being
// in the current sprint, which the sprint sync (sprint-status-sync.ts) keeps in step with the Project, as since 06/10.

export type ItemStatus = "Open" | "Blocker" | "Done";
export type SelectorStatus = "Open" | "Development" | "Blocker" | "Done";
type CardStatus = "Open" | "Development" | "Blocker" | "Done";

/** The issue's Status as RoadS compares it: Done when the issue is closed or its card says Done, Blocker when the card says so. */
export function statusOfIssue({ closed, card }: { closed: boolean; card: CardStatus | null }): ItemStatus {
  if (closed || card === "Done") return "Done";
  return card === "Blocker" ? "Blocker" : "Open";
}

/**
 * The Status decision for an item whose issue is closed (not among the open issues the sync reads): the closed issue is
 * Done, so an item RoadS didn't move becomes Done, and an item taken out of Done in RoadS reopens the issue.
 */
export function closedIssueStatus(f: { roads: ItemStatus; base: string | null; roadsAt: string | null }): FieldDecision {
  return decideField({ roads: f.roads, base: f.base, github: "Done", roadsAt: f.roadsAt, githubAt: null });
}

/**
 * What GitHub gets when RoadS's Status wins over the issue's: Done closes the issue as completed, leaving Done reopens
 * it, and the card's Status follows (an open item is Development in the current sprint, Open outside it).
 */
export function statusWrites(
  roads: ItemStatus,
  github: ItemStatus,
  inCurrentSprint: boolean
): { issue: { state: "open" | "closed"; state_reason: "completed" | "reopened" } | null; card: CardStatus } {
  if (roads === "Done") return { issue: { state: "closed", state_reason: "completed" }, card: "Done" };
  const issue = github === "Done" ? ({ state: "open", state_reason: "reopened" } as const) : null;
  return { issue, card: roads === "Blocker" ? "Blocker" : inCurrentSprint ? "Development" : "Open" };
}

/** The selector's value for an item: its Done or Blocker, else Development in the current sprint and Open outside it. */
export function selectorStatus(status: ItemStatus, inCurrentSprint: boolean): SelectorStatus {
  return status === "Open" && inCurrentSprint ? "Development" : status;
}

/** What a choice in the selector stores, and the move it makes: Development and Open are where the item is planned. */
export function storedStatus(choice: SelectorStatus, inCurrentSprint: boolean): { status: ItemStatus; move: "into_sprint" | "out_of_sprint" | null } {
  if (choice === "Development") return { status: "Open", move: inCurrentSprint ? null : "into_sprint" };
  if (choice === "Open") return { status: "Open", move: inCurrentSprint ? "out_of_sprint" : null };
  return { status: choice, move: null };
}

/** The Comment a Delete leaves on the issue it closes: who deleted it, by the profile's GitHub login, else by the role. */
export function deletionComment(role: "admin" | "scrum_master", login: string | null): string {
  const who = login ? `@${login}` : role === "admin" ? "an admin" : "a scrum master";
  return `Deleted in RoadS by ${who}: this issue was closed as not planned.`;
}

/** Who may write to GitHub through a sync: scrum masters, admins and the daily cron. A dev's press only pulls. */
export function mayPush(role: string | null): boolean {
  return role === "admin" || role === "scrum_master" || role === "cron";
}

const SOLUCAO = /^## Solução[ \t]*$/m;

/** The text under the body's first "## Solução" heading, up to the next "## " heading; null without one. */
export function extractSolucao(body: string): string | null {
  const head = SOLUCAO.exec(body);
  if (!head) return null;
  const rest = body.slice(head.index + head[0].length);
  const next = /^## /m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/**
 * The card's summary of an issue (issue #28): the first paragraph of its Solução section, its wrapped lines joined by
 * a space. The paragraph ends at a blank line, a list item or a heading; a Solução that opens with a list gives its
 * first item's text, without the marker. Null without a Solução section. CRLF bodies read the same.
 */
export function extractResumo(body: string): string | null {
  const solucao = extractSolucao(body.replace(/\r\n?/g, "\n"));
  if (solucao === null) return null;
  const lines: string[] = [];
  for (const line of solucao.split("\n")) {
    const text = line.trim();
    if (!text || /^#{1,6}\s/.test(text)) break;
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(text);
    if (item) {
      if (!lines.length) lines.push(item[1].trim());
      break;
    }
    lines.push(text);
  }
  return lines.join(" ");
}

/** Which synced fields an item writes to its issue: all but the Description, which only comes from GitHub (issue #28). */
export function pushesToGitHub(field: string): boolean {
  return field !== "description";
}

/**
 * The Description a sync brings to an item with an issue: the issue's summary ("" when its body has no Solução),
 * whatever RoadS holds, a text edited there too; null when the item already holds it.
 */
export function descriptionPull(stored: string, body: string): string | null {
  const resumo = extractResumo(body) ?? "";
  return resumo === stored ? null : resumo;
}

/** The body with the Solução section's text replaced (or the section added at the end); nothing else changes. */
export function replaceSolucao(body: string, text: string): string {
  const head = SOLUCAO.exec(body);
  if (!head) return `${body.replace(/\s+$/, "")}\n\n## Solução\n\n${text.trim()}\n`;
  const start = head.index + head[0].length;
  const rest = body.slice(start);
  const next = /^## /m.exec(rest);
  const tail = next ? `\n\n${rest.slice(next.index)}` : "\n";
  return `${body.slice(0, start)}\n\n${text.trim()}${tail}`;
}
