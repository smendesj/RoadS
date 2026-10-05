// Adds prints of deliveries to a Resumo that was already SENT, so the week can be presented with them. The
// door the attach script uses (scripts/progress/attach.ts), after it uploaded each print to the prints bucket.
// Pure, with the table and the bucket injected: the route wires the admin client, the tests a fake.
//
//   { shots: [{ caption, mime, issue, path }] } -> 200 { added, existing } | 400 { error } | 404 | 409
//
// Only prints are ever added: the text, the statuses, the numbers, the user's edits and the prints the report
// already had stay exactly as they were (the e-mail already went out). A print already there (same file, same
// delivery) is skipped, so the run can be repeated. The write is made over the revision that was read.
import type { ProgressContent, ProgressReportRow, Shot } from "../progress-report.ts";
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

type Incoming = { caption: string; mime: Shot["mime"]; issue: number; path: string };

/** One incoming print, checked, or the sentence that says what is wrong with it. */
function incoming(value: unknown, at: string, issues: Set<number>, hidden: Set<number>): Incoming | string {
  const s = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const mime = s.mime;
  if (mime !== "image/png" && mime !== "image/jpeg") return `${at}.mime: esperado image/jpeg ou image/png`;
  const caption = typeof s.caption === "string" ? s.caption.replace(CONTROL, " ").replace(/\s+/g, " ").trim() : "";
  if (caption === "" || caption.length > 200) return `${at}.caption: esperada uma legenda de 1 a 200 caracteres`;
  const issue = s.issue;
  if (typeof issue !== "number" || !Number.isInteger(issue) || issue <= 0) return `${at}.issue: esperado o número da issue da entrega`;
  if (!issues.has(issue)) return `${at}.issue: a entrega #${issue} não está neste resumo`;
  // The e-mail leaves a hidden delivery out, and its prints with it: a print there would never be seen.
  if (hidden.has(issue)) return `${at}.issue: a entrega #${issue} está escondida neste resumo`;
  const path = s.path;
  if (typeof path !== "string" || !SHOT_PATH.test(path) || !path.endsWith(`.${shotExtension(mime)}`)) {
    return `${at}.path: esperado o nome do print no armazenamento (hash e extensão do tipo)`;
  }
  return { caption, mime, issue, path };
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
  const known = new Set(had.map((s) => `${s.issue}:${s.path}`));
  const fresh: Incoming[] = [];
  for (const shot of checked) {
    const key = `${shot.issue}:${shot.path}`;
    if (known.has(key)) continue;
    known.add(key);
    fresh.push(shot);
  }
  if (fresh.length === 0) return { status: 200, body: { added: 0, existing: checked.length } };
  if (had.length + fresh.length > MAX_SHOTS) return refuse(`shots: o resumo passaria de ${MAX_SHOTS} prints`);
  for (const shot of fresh) {
    if (!(await store.shotExists(shot.path))) return refuse(`shots: o print da entrega #${shot.issue} não foi enviado ao armazenamento`);
  }

  // New ids follow the highest "shot-<n>" already there, so the public links of the old prints never move.
  const top = had.reduce((max, s) => Math.max(max, Number(/^shot-(\d+)$/.exec(s.id)?.[1] ?? 0)), 0);
  const added: Shot[] = fresh.map((s, i) => ({ id: `shot-${top + i + 1}`, caption: s.caption, mime: s.mime, issue: s.issue, path: s.path }));
  const content: ProgressContent = { ...report.content, shots: [...had, ...added] };
  if (!(await store.writeShots(id, report.rev, content))) return { status: 409, body: { error: "concurrent_change" } };
  return { status: 200, body: { added: added.length, existing: checked.length - added.length } };
}
