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
  /** An empty value on GitHub is a gap RoadS fills with its own (Type, Stack, Priority, Effort), not a value to copy. */
  fillGap?: boolean;
};

export type FieldDecision = "pull" | "push" | "none";

export function decideField(f: FieldSides): FieldDecision {
  if (f.roads === f.github) return "none";
  if (f.fillGap && f.github === "") return "push";
  if (f.base === null) return "pull";
  const roadsMoved = f.roads !== f.base;
  const githubMoved = f.github !== f.base;
  if (roadsMoved && !githubMoved) return "push";
  if (githubMoved && !roadsMoved) return "pull";
  if (f.roadsAt && f.githubAt && Date.parse(f.roadsAt) > Date.parse(f.githubAt)) return "push";
  return "pull";
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
