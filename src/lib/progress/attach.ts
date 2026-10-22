// Adds prints to a Resumo that was already SENT, so the week can be presented with them: prints of its
// deliveries, and general prints that belong to no delivery (a plan for the week, say). The door the attach
// script uses (scripts/progress/attach.ts), after it uploaded each print to the prints bucket.
// Pure, with the table and the bucket injected: the route wires the admin client, the tests a fake.
//
//   { shots: [{ caption, mime, issue?, path, before? }] } -> 200 { added, existing } | 400 { error } | 404 | 409
//
// Only prints are ever added: the text, the statuses, the numbers, the user's edits and the prints the report
// already had stay exactly as they were (the e-mail already went out). A print already there (same file, same
// delivery, or both general) is skipped, so the run can be repeated. A general print has no `issue` at all,
// so the e-mail and the week place it at the end, like the ones a push carries without a delivery.
// A new print may come with its `before` ({ mime, path }, uploaded like a print): the pair takes one place. A
// before is never added to a print the report already has: the e-mail already showed that print, with its links.
// The write is made over the revision that was read.
import type { ProgressContent, ProgressReportRow, Shot, ShotBefore } from "../progress-report.ts";
import { MAX_SHOTS, SHOT_PATH, shotExtension } from "./draft.ts";
import { isUuid } from "./report-view.ts";
import { resolveContent } from "./resolve.ts";

export type AttachedReport = { status: ProgressReportRow["status"]; rev: number; content: ProgressContent; overrides: ProgressReportRow["overrides"] };
export type AttachStore = {
  findReport(id: string): Promise<AttachedReport | null>;
  /** True when the print was uploaded to the prints bucket. */
  shotExists(path: string): Promise<boolean>;
  /**
   * Writes the report's content back with its new prints, only if the report is still at `rev` and still sent;
   * false when it changed in between. The whole content goes back because the table stores it as one value.
   */
  writeShots(id: string, rev: number, content: ProgressContent): Promise<boolean>;
};
export type AttachAnswer = { status: 200; body: { added: number; existing: number } } | { status: 400 | 404 | 409; body: { error: string } };

const refuse = (error: string): AttachAnswer => ({ status: 400, body: { error } });
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

/** `issue` is absent for a general print; `before` for a print without one. */
type Incoming = { caption: string; mime: Shot["mime"]; issue?: number; path: string; before?: ShotBefore };

/** The same print twice means the same file under the same delivery, or the same file twice as a general print. */
const printKey = (issue: number | undefined, path: string) => `${issue ?? "geral"}:${path}`;

const stored = (mime: unknown, path: unknown): path is string =>
  (mime === "image/png" || mime === "image/jpeg") && typeof path === "string" && SHOT_PATH.test(path) && path.endsWith(`.${shotExtension(mime)}`);

/** Where a print sits, said in words: "geral" or "da entrega #n". */
const where = (issue: number | undefined) => (issue === undefined ? "geral" : `da entrega #${issue}`);

/** One incoming print, checked, or the sentence that says what is wrong with it. */
function incoming(value: unknown, at: string, issues: Set<number>, hidden: Set<number>): Incoming | string {
  const s = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const mime = s.mime;
  if (mime !== "image/png" && mime !== "image/jpeg") return `${at}.mime: esperado image/jpeg ou image/png`;
  const caption = typeof s.caption === "string" ? s.caption.replace(CONTROL, " ").replace(/\s+/g, " ").trim() : "";
  if (caption === "" || caption.length > 200) return `${at}.caption: esperada uma legenda de 1 a 200 caracteres`;
  // No `issue` key is a general print; a key that is there must be a delivery (null or "1" is not "none").
  const general = !("issue" in s) || s.issue === undefined;
  const issue = s.issue;
  if (!general) {
    if (typeof issue !== "number" || !Number.isInteger(issue) || issue <= 0) return `${at}.issue: esperado o número da issue da entrega`;
    if (!issues.has(issue)) return `${at}.issue: a entrega #${issue} não está neste resumo`;
    // The e-mail leaves a hidden delivery out, and its prints with it: a print there would never be seen.
    if (hidden.has(issue)) return `${at}.issue: a entrega #${issue} está escondida neste resumo`;
  }
  const path = s.path;
  if (!stored(mime, path)) return `${at}.path: esperado o nome do print no armazenamento (hash e extensão do tipo)`;
  // The before, like the draft takes it: only ever a path in the bucket, never inline.
  let before: ShotBefore | undefined;
  if (s.before !== undefined) {
    const b = (typeof s.before === "object" && s.before !== null ? s.before : {}) as Record<string, unknown>;
    if (b.mime !== "image/png" && b.mime !== "image/jpeg") return `${at}.before.mime: esperado image/jpeg ou image/png`;
    if (!stored(b.mime, b.path)) return `${at}.before.path: esperado o nome do print antes no armazenamento (hash e extensão do tipo)`;
    before = { mime: b.mime, path: b.path };
  }
  return { caption, mime, ...(general ? {} : { issue: issue as number }), path, ...(before ? { before } : {}) };
}

export async function attachShots(store: AttachStore, id: string, body: unknown): Promise<AttachAnswer> {
  if (!isUuid(id)) return { status: 404, body: { error: "not_found" } };
  const list = typeof body === "object" && body !== null ? (body as { shots?: unknown }).shots : undefined;
  if (!Array.isArray(list) || list.length === 0) return refuse("shots: esperada uma lista com ao menos um print");
  if (list.length > MAX_SHOTS) return refuse(`shots: no máximo ${MAX_SHOTS} prints`);

  const report = await store.findReport(id);
  if (!report) return { status: 404, body: { error: "not_found" } };
  // A draft gets its prints from the push; this door is for what was already sent.
  if (report.status !== "sent") return { status: 409, body: { error: "not_sent" } };

  const issues = new Set((report.content.entries ?? []).map((e) => e.issue));
  // Hidden as the e-mail showed it: the pushed flag, or the user's edit on the screen.
  const shown = resolveContent({ content: report.content, overrides: report.overrides ?? {} });
  const hidden = new Set((shown.entries ?? []).filter((e) => e.hidden).map((e) => e.issue));
  const checked: Incoming[] = [];
  for (const [i, value] of list.entries()) {
    const shot = incoming(value, `shots[${i}]`, issues, hidden);
    if (typeof shot === "string") return refuse(shot);
    checked.push(shot);
  }

  const had = report.content.shots ?? [];
  // Each print there, with the path of its before ("" when it has none).
  const known = new Map(had.map((s) => [printKey(s.issue, s.path ?? ""), s.before?.path ?? ""]));
  const fresh: Incoming[] = [];
  for (const shot of checked) {
    const key = printKey(shot.issue, shot.path);
    const was = known.get(key);
    if (was === undefined) {
      known.set(key, shot.before?.path ?? "");
      fresh.push(shot);
      continue;
    }
    // Already there: skipped when it brings no before it lacks. A new or other before would change a print the
    // e-mail already showed, so it is refused. Without a before it changes nothing, and is skipped too.
    if (shot.before && shot.before.path !== was) {
      return refuse(`shots: o print ${where(shot.issue)} já está no resumo enviado e não ganha print antes; envie o par como um print novo`);
    }
  }
  if (fresh.length === 0) return { status: 200, body: { added: 0, existing: checked.length } };
  if (had.length + fresh.length > MAX_SHOTS) return refuse(`shots: o resumo passaria de ${MAX_SHOTS} prints`);
  for (const shot of fresh) {
    if (!(await store.shotExists(shot.path))) return refuse(`shots: o print ${where(shot.issue)} não foi enviado ao armazenamento`);
    if (shot.before && !(await store.shotExists(shot.before.path))) {
      return refuse(`shots: o print antes do print ${where(shot.issue)} não foi enviado ao armazenamento`);
    }
  }

  // New ids follow the highest "shot-<n>" already there, so the public links of the old prints never move.
  const top = had.reduce((max, s) => Math.max(max, Number(/^shot-(\d+)$/.exec(s.id)?.[1] ?? 0)), 0);
  const added: Shot[] = fresh.map((s, i) => ({
    id: `shot-${top + i + 1}`,
    caption: s.caption,
    mime: s.mime,
    ...(s.issue === undefined ? {} : { issue: s.issue }),
    path: s.path,
    ...(s.before ? { before: s.before } : {}),
  }));
  const content: ProgressContent = { ...report.content, shots: [...had, ...added] };
  if (!(await store.writeShots(id, report.rev, content))) return { status: 409, body: { error: "concurrent_change" } };
  return { status: 200, body: { added: added.length, existing: checked.length - added.length } };
}
