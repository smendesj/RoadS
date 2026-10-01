// The write side of "Resumo para a diretoria": what becomes of a draft the Frontlights CLI pushes.
// A pure module with the database behind a small port (`ReportStore`), so every rule is testable
// without one; ingest-store.ts plugs Supabase into the port and the route glues it all to HTTP.
//
// The rule that matters most: pushing again NEVER erases what the user did. A draft's text lives in
// `content` (written only here, by the service role) and the user's edits live apart, in `overrides`,
// which this module never touches. The link token of the image (`share_token`) stays as well, so a link
// already pasted in a mail keeps working.
import { ENTRY_STATUSES, PRODUCTION_ORIGIN, defaultReportWindow } from "../progress-report.ts";
import type { EntryStatus, Overrides, ProgressContent, ProgressEntry, ProgressReportRow, ReportWindow } from "../progress-report.ts";
import type { Produto } from "../types.ts";
import { parseDraft } from "./draft.ts";

/** What the ingest needs to know about a stored report: never its content, edits or link token. */
export type StoredReport = Pick<ProgressReportRow, "id" | "produto" | "period_start" | "period_end" | "status" | "rev" | "pushed_at" | "checked_at">;

/** The last sent report, with what "already reported" needs: its entries as pushed, and the user's edits of them. */
export type SentReport = StoredReport & { entries: Pick<ProgressEntry, "id" | "status" | "hidden">[]; overrides: Overrides };

export type NewReport = { produto: Produto; period_start: string; period_end: string; content: ProgressContent; pushed_at: string };
export type DraftPatch = {
  content: ProgressContent;
  period_start: string;
  period_end: string;
  pushed_at: string;
  rev: number;
  checked_at: null;
  checked_by: null;
};

export type ReportStore = {
  findDraft(produto: Produto): Promise<StoredReport | null>;
  findLastSent(produto: Produto): Promise<SentReport | null>;
  /** The report (draft or sent) whose period starts at that instant, if any. */
  findByPeriod(produto: Produto, periodStart: string): Promise<StoredReport | null>;
  /** null when the database says "already there": another push created the draft (or the period) first. */
  insert(row: NewReport): Promise<{ id: string } | null>;
  /** false when no DRAFT with that id is left: it was sent, or removed, since it was read. */
  updateDraft(id: string, patch: DraftPatch): Promise<boolean>;
};

export type IngestInput = { produto: Produto; content: ProgressContent; now?: Date };
export type IngestResult = { status: 200; id: string; created: boolean } | { status: 409; error: "period_already_sent" | "concurrent_push" };

export async function ingestDraft(
  store: Pick<ReportStore, "findDraft" | "findByPeriod" | "insert" | "updateDraft">,
  input: IngestInput
): Promise<IngestResult> {
  const { produto, content } = input;
  const pushedAt = (input.now ?? new Date()).toISOString();
  // Stored as UTC instants, so "the same period" compares equal whatever offset the content was written with.
  const period = { period_start: new Date(content.window.start).toISOString(), period_end: new Date(content.window.end).toISOString() };

  // A second attempt exists for races only: another push may create the draft between our read and our
  // write, or the user may send the draft in between; the new read then tells which of the two happened.
  for (let attempt = 0; attempt < 2; attempt++) {
    const samePeriod = await store.findByPeriod(produto, period.period_start);
    // A report already sent is frozen: the period can't be pushed again (the e-mail already went out).
    if (samePeriod?.status === "sent") return { status: 409, error: "period_already_sent" };

    const draft = await store.findDraft(produto);
    if (draft) {
      // The numbers may have changed, so the user must check them again: a new push voids the conference.
      const patch: DraftPatch = { content, ...period, pushed_at: pushedAt, rev: draft.rev + 1, checked_at: null, checked_by: null };
      if (await store.updateDraft(draft.id, patch)) return { status: 200, id: draft.id, created: false };
      continue;
    }

    const created = await store.insert({ produto, ...period, content, pushed_at: pushedAt });
    if (created) return { status: 200, id: created.id, created: true };
  }
  return { status: 409, error: "concurrent_push" };
}

/* ---------- What the route answers ---------- */

export type ReceiveResult =
  | { status: 200; body: { id: string; created: boolean; url: string } }
  | { status: 400 | 409; body: { error: string } };

/** POST: validate the body, then ingest it. Everything but the secret check and the HTTP plumbing. */
export async function receiveDraft(store: Pick<ReportStore, "findDraft" | "findByPeriod" | "insert" | "updateDraft">, body: unknown, now?: Date): Promise<ReceiveResult> {
  const parsed = parseDraft(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const result = await ingestDraft(store, { produto: parsed.produto, content: parsed.content, now });
  if (result.status === 409) return { status: 409, body: { error: result.error } };
  return { status: 200, body: { id: result.id, created: result.created, url: `${PRODUCTION_ORIGIN}/resumo` } };
}

export type ReportBrief = Pick<StoredReport, "id" | "period_start" | "period_end" | "pushed_at" | "rev" | "checked_at">;
export type ReportedEntry = { id: string; status: EntryStatus };

/**
 * The entries a sent e-mail carried, as the user left them: hidden ones are out (an edit can hide or show
 * an entry either way) and an edited status wins. The next report leaves these out, so a delivery already
 * told is never told again. An edit that makes no sense, or of an entry that is not there, changes nothing.
 */
export function reportedEntries(sent: Pick<SentReport, "entries" | "overrides"> | null): ReportedEntry[] {
  if (!sent) return [];
  const told: ReportedEntry[] = [];
  for (const entry of sent.entries) {
    const hiddenEdit = sent.overrides[`entry:${entry.id}:hidden`]?.value;
    const statusEdit = sent.overrides[`entry:${entry.id}:status`]?.value;
    if (typeof hiddenEdit === "boolean" ? hiddenEdit : entry.hidden) continue;
    const status = typeof statusEdit === "string" && (ENTRY_STATUSES as readonly string[]).includes(statusEdit) ? (statusEdit as EntryStatus) : entry.status;
    told.push({ id: entry.id, status });
  }
  return told;
}

const brief = (r: StoredReport | null): ReportBrief | null =>
  r && { id: r.id, period_start: r.period_start, period_end: r.period_end, pushed_at: r.pushed_at, rev: r.rev, checked_at: r.checked_at };

/** GET: the window to collect next, a short look at the draft, and at the last sent report with what it told. */
export async function reportState(
  store: Pick<ReportStore, "findDraft" | "findLastSent">,
  produto: Produto,
  now: Date = new Date()
): Promise<{ window: ReportWindow; draft: ReportBrief | null; lastSent: (ReportBrief & { entries: ReportedEntry[] }) | null }> {
  const [draft, lastSent] = await Promise.all([store.findDraft(produto), store.findLastSent(produto)]);
  return {
    window: defaultReportWindow(lastSent?.period_end ?? null, now),
    draft: brief(draft),
    lastSent: lastSent && { ...(brief(lastSent) as ReportBrief), entries: reportedEntries(lastSent) },
  };
}
