// Which deliveries are on show and where each print goes: the one rule the e-mail (email.ts) and the week's
// presentation (WeekPresentation.tsx) share. Small and pure on purpose, so the browser gets this rule without
// the whole e-mail builder.
import type { ProgressContent, ProgressEntry, Shot } from "../progress-report.ts";
import { MAX_SHOTS } from "./draft.ts";

const clean = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The deliveries the reader sees: not hidden, and with a title or a sentence to show. */
export const visibleOf = (content: ProgressContent): ProgressEntry[] =>
  (Array.isArray(content.entries) ? content.entries : []).filter((e) => e && !e.hidden && (clean(e.title) || clean(e.summary)));

export type PlacedShot = { shot: Shot; src: string | null };

/**
 * A print of a delivery that has its own block sits under it; a print of a hidden delivery is left out with
 * it; every other print (no delivery, or one only listed under "Próximos passos") is a general one, at the end.
 * `urls[i]` is the link of `content.shots[i]`, checked by `safe`; a print without a usable link keeps its place
 * with `src: null`. One e-mail carries at most MAX_SHOTS; the week, made of several, passes Infinity.
 */
export function placeShots(
  content: ProgressContent,
  urls: (string | undefined)[] | undefined,
  safe: (url: string | undefined) => string | null,
  max: number = MAX_SHOTS
): { shotsOf: (issue: number) => PlacedShot[]; general: PlacedShot[] } {
  const visible = visibleOf(content);
  const shots = (Array.isArray(content.shots) ? content.shots : []).slice(0, max).map((shot, i) => ({ shot, src: safe(urls?.[i]) }));
  const blocked = new Set(visible.filter((e) => e.status !== "proximo").map((e) => e.issue));
  const hiddenIssues = new Set((Array.isArray(content.entries) ? content.entries : []).filter((e) => e && !visible.includes(e)).map((e) => e.issue));
  return {
    shotsOf: (issue) => shots.filter((s) => s.shot.issue === issue),
    general: shots.filter((s) => s.shot.issue === undefined || (!blocked.has(s.shot.issue) && !hiddenIssues.has(s.shot.issue))),
  };
}
