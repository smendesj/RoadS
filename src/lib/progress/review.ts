// The rules behind the three server actions of "Resumo para a diretoria": saving an edit, ticking
// "números conferidos" and marking the report as sent. The actions in src/lib/actions/progress.ts only
// wire the database to the ports below; every decision (who may, what is written, what is refused)
// lives here, in a plain module that runs under node:test without Next or Supabase, the same split as
// src/lib/profile.ts and src/lib/account.ts. Pure: no "server-only", no "@/" imports.
import {
  ENTRY_STATUSES,
  type LintIssue,
  type Overrides,
  type ProgressReportRow,
} from "../progress-report.ts";
import { lintSentence } from "./lint.ts";
import { locateKey, parseKey } from "./resolve.ts";

/* ---------- one edit ---------- */

export type EditError = "invalid_key" | "invalid_value" | "invalid_status" | "empty" | "too_long";

export type EditResult = { overrides: Overrides; warnings: LintIssue[] } | { error: EditError };

// One line of plain text: line breaks, tabs and other control characters become a space, runs of
// blanks collapse, the edges go. (A sentence pasted from a document often carries all of those.)
const tidy = (s: string): string => s.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim();

/**
 * Applies one edit to the stored edits and returns the new `overrides` (the input is not changed) with
 * the plain-language warnings for the new text, or `{ error }` with the reason it was refused. The key
 * must be in the contract's grammar and the value of the right kind: text within the limits (title 80
 * characters, sentence 280, headline 320, none empty unless clearing the line is meaningful), one of
 * the five statuses, or a boolean. Text and status keep `base`, the text the collectors pushed that
 * the edit was made over, so a later push with different text can be flagged as a new suggestion.
 * Warnings never block the edit: the person editing decides. Everything the user edits is meant for the
 * CEO, so the sentence is judged as "geral".
 */
export function applyEdit(overrides: Overrides, key: string, value: unknown, pushedText: string): EditResult {
  const info = parseKey(key);
  if (!info) return { error: "invalid_key" };

  if (info.type === "flag") {
    if (typeof value !== "boolean") return { error: "invalid_value" };
    return { overrides: { ...overrides, [key]: { value } }, warnings: [] };
  }

  if (typeof value !== "string") return { error: "invalid_value" };

  if (info.type === "status") {
    if (!(ENTRY_STATUSES as readonly string[]).includes(value)) return { error: "invalid_status" };
    return { overrides: { ...overrides, [key]: { value, base: pushedText } }, warnings: [] };
  }

  const text = tidy(value);
  if (text === "" && !info.allowEmpty) return { error: "empty" };
  if ([...text].length > info.max) return { error: "too_long" };
  return { overrides: { ...overrides, [key]: { value: text, base: pushedText } }, warnings: lintSentence(text, "geral") };
}

/* ---------- who may change the report ---------- */

/** Who is calling, as the server read it from the session and the profile. */
export type Actor = {
  userId: string | null;
  role: string | null | undefined;
  mustResetPassword: boolean | null | undefined;
};

export type AccessDenied = "unauthenticated" | "must_reset_password" | "forbidden";

/**
 * The roles that may edit, tick and send the report. A product decision, so it sits alone and is easy
 * to change: the scrum master can read the report (the database lets them) but only an admin changes it.
 */
export const REPORT_EDITOR_ROLES: readonly string[] = ["admin"];

/**
 * Only a signed-in admin who has already chosen their own password may change the report: a scrum
 * master, a dev, a visitor and an account that still has to reset its password get nothing. The
 * database policies enforce the same rule a second time.
 */
export function editorAccess(actor: Actor): { ok: true; userId: string } | { ok: false; reason: AccessDenied } {
  if (!actor.userId) return { ok: false, reason: "unauthenticated" };
  if (actor.mustResetPassword) return { ok: false, reason: "must_reset_password" };
  if (!actor.role || !REPORT_EDITOR_ROLES.includes(actor.role)) return { ok: false, reason: "forbidden" };
  return { ok: true, userId: actor.userId };
}

/* ---------- "números conferidos" ---------- */

/**
 * The numbers count as checked only while the check is not older than the last push: a new draft
 * from the collectors brings new numbers, so it cancels the check. The database enforces the same
 * comparison when the report is marked as sent.
 */
export function isChecked(row: Pick<ProgressReportRow, "checked_at" | "pushed_at">): boolean {
  if (!row.checked_at) return false;
  const checked = Date.parse(row.checked_at);
  return Number.isFinite(checked) && checked >= Date.parse(row.pushed_at);
}

/* ---------- the three actions ---------- */

/** The part of the row the actions need (the screens read the rest on their own). */
export type ReviewRow = Pick<ProgressReportRow, "id" | "status" | "rev" | "content" | "overrides" | "checked_at" | "pushed_at">;

/** What an action asks the database to change; the database adds the stamps and bumps `rev`. */
export type ReviewPatch = { overrides: Overrides } | { checked_at: string | null } | { status: "sent" };

export type ReviewPorts = {
  getActor: () => Promise<Actor>;
  /** Under the caller's own session, so the row policies apply; null when there is no such row for them. */
  loadReport: (id: string) => Promise<ReviewRow | null>;
  /** Writes only if the row still has this `rev` and is still a draft; resolves to the new `rev`, or null when nothing matched. */
  updateReport: (id: string, rev: number, patch: ReviewPatch) => Promise<{ rev: number } | null>;
  now: () => Date;
  /** The real error of a failed port, for the server log: the caller only ever hears "unavailable". */
  onError?: (error: unknown) => void;
};

export type ReviewFailure = AccessDenied | EditError | "invalid" | "not_found" | "sent" | "stale" | "not_checked" | "unavailable";

export type ReviewResult = { ok: true; rev: number; warnings?: LintIssue[] } | { ok: false; reason: ReviewFailure };

/** What arrives from the browser: nothing about it is trusted, so everything is checked here. */
type Untrusted = Record<string, unknown>;

const failure = (reason: ReviewFailure): ReviewResult => ({ ok: false, reason });

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const isRevision = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

// The order of the answers is the order of the questions a caller must pass: are you allowed to ask,
// is the request well-formed, does the report exist, is it still open, is your screen current. Only
// then does the action itself decide. Nothing is read before the caller is known, and any failure of
// a port is reported without its details.
async function onDraft(
  input: Untrusted,
  ports: ReviewPorts,
  shapeOk: (input: Untrusted) => boolean,
  act: (row: ReviewRow, rev: number) => Promise<ReviewResult>
): Promise<ReviewResult> {
  try {
    const access = editorAccess(await ports.getActor());
    if (!access.ok) return failure(access.reason);

    const { id, rev } = input ?? {};
    if (typeof id !== "string" || !UUID.test(id) || !isRevision(rev) || !shapeOk(input)) return failure("invalid");

    const row = await ports.loadReport(id);
    if (!row) return failure("not_found");
    if (row.status === "sent") return failure("sent");
    if (row.rev !== rev) return failure("stale");

    return await act(row, rev);
  } catch (error) {
    ports.onError?.(error);
    return failure("unavailable");
  }
}

/**
 * Saves one edit of the report. The text the edit is made over (`base`) is read from the stored
 * report, never taken from the caller, and the key must point at something that exists in it.
 */
export function saveEdit(input: Untrusted, ports: ReviewPorts): Promise<ReviewResult> {
  return onDraft(input, ports, () => true, async (row, rev) => {
    const key = input.key;
    const target = typeof key === "string" ? locateKey(row.content, key) : null;
    if (typeof key !== "string" || !target) return failure("invalid_key");

    const edit = applyEdit(row.overrides ?? {}, key, input.value, target.pushed ?? "");
    if ("error" in edit) return failure(edit.error);

    const saved = await ports.updateReport(row.id, rev, { overrides: edit.overrides });
    return saved ? { ok: true, rev: saved.rev, warnings: edit.warnings } : failure("stale");
  });
}

/**
 * Ticks or unticks "números conferidos". Ticking sends the current instant, but the database stamps
 * its own clock and the caller's identity; asking for the state the report already has writes nothing.
 */
export function setChecked(input: Untrusted, ports: ReviewPorts): Promise<ReviewResult> {
  return onDraft(input, ports, (i) => typeof i.checked === "boolean", async (row, rev) => {
    if (input.checked === isChecked(row)) return { ok: true, rev: row.rev };
    const saved = await ports.updateReport(row.id, rev, { checked_at: input.checked ? ports.now().toISOString() : null });
    return saved ? { ok: true, rev: saved.rev } : failure("stale");
  });
}

/** Marks the report as sent, which freezes it. Only after the numbers were checked since the last push. */
export function markSent(input: Untrusted, ports: ReviewPorts): Promise<ReviewResult> {
  return onDraft(input, ports, () => true, async (row, rev) => {
    if (!isChecked(row)) return failure("not_checked");
    const saved = await ports.updateReport(row.id, rev, { status: "sent" });
    return saved ? { ok: true, rev: saved.rev } : failure("stale");
  });
}
