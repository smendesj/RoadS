import "server-only";
import { redirect } from "next/navigation";
import { getViewerOrReset } from "@/lib/get-viewer";
import type { ProgressReportRow } from "@/lib/progress-report";
import { createClient } from "@/lib/supabase/server";
import type { Produto, Role } from "@/lib/types";
import { weekStartOf, type WeekReport } from "@/lib/progress/week";
import type { Viewer } from "@/lib/viewer";

// Everything on the Resumo screens is read with the signed-in user's own client, so Row Level Security
// is what decides who sees a report. The product rule on top of it: an admin reviews drafts and sent
// reports; a scrum master only reads what was already SENT. The queries below ask for exactly that
// (a scrum master's never even mentions drafts), so the page is right even if a policy were looser.

const PRODUCT: Produto = "GeoCloud";

const ROW_COLUMNS = "id, produto, period_start, period_end, status, content, overrides, share_token, checked_at, sent_at, pushed_at, rev";

export type ReportLoad = { row: ProgressReportRow | null; failed: boolean };
export type SentSummary = { id: string; period_start: string; period_end: string; sent_at: string | null };

/** Admin reviews; the scrum master only reads what was sent. */
export const canReview = (role: Role): boolean => role === "admin";

/** Admin and scrum master only. Dev goes back to the Dashboard (the tab never shows for them anyway). */
export async function requireReportViewer(): Promise<Viewer> {
  const viewer = await getViewerOrReset();
  if (!viewer) redirect("/login");
  if (viewer.role !== "admin" && viewer.role !== "scrum_master") redirect("/dashboard");
  return viewer;
}

// The screen never needs a print's bytes: the preview points at the public image route instead. Dropping
// the inline ones of older reports keeps the page payload small; a print kept in the bucket has none.
function forScreen(row: ProgressReportRow): ProgressReportRow {
  const shots = row.content.shots;
  return shots ? { ...row, content: { ...row.content, shots: shots.map((s) => (s.data === undefined ? s : { ...s, data: "" })) } } : row;
}

function failure(what: string, error: { code?: string } | null): boolean {
  if (!error) return false;
  // The code is enough to diagnose (missing table, RLS); the message could echo row contents.
  console.error(`progress_reports ${what} failed`, error.code ?? "unknown");
  return true;
}

type Raw = Record<string, unknown>;

async function latestSent(columns: string): Promise<{ data: Raw | null; failed: boolean }> {
  const supabase = await createClient();
  const sent = await supabase
    .from("progress_reports")
    .select(columns)
    .eq("produto", PRODUCT)
    .eq("status", "sent")
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (failure("last sent read", sent.error)) return { data: null, failed: true };
  return { data: (sent.data as unknown as Raw | null) ?? null, failed: false };
}

// For an admin: the draft, else the last one sent. For anyone else: the last one sent.
async function readCurrent(columns: string, role: Role): Promise<{ data: Raw | null; failed: boolean }> {
  if (!canReview(role)) return latestSent(columns);
  const supabase = await createClient();
  const draft = await supabase.from("progress_reports").select(columns).eq("produto", PRODUCT).eq("status", "draft").maybeSingle();
  if (failure("draft read", draft.error)) return { data: null, failed: true };
  if (draft.data) return { data: draft.data as unknown as Raw, failed: false };
  return latestSent(columns);
}

/** The report the /resumo page opens on. */
export async function loadCurrentReport(role: Role): Promise<ReportLoad> {
  const { data, failed } = await readCurrent(ROW_COLUMNS, role);
  return { row: data ? forScreen(data as unknown as ProgressReportRow) : null, failed };
}

/**
 * One report by id, whatever the product. For anyone but an admin a draft is "no such report": the
 * question never reaches it, so the answer is the same as for an id that does not exist.
 */
export async function loadReportById(id: string, role: Role): Promise<ReportLoad> {
  const supabase = await createClient();
  let query = supabase.from("progress_reports").select(ROW_COLUMNS).eq("id", id);
  if (!canReview(role)) query = query.eq("status", "sent");
  const { data, error } = await query.maybeSingle();
  if (failure("read by id", error)) return { row: null, failed: true };
  return { row: data ? forScreen(data as unknown as ProgressReportRow) : null, failed: false };
}

/** The reports already sent, newest first, for the list of links. */
export async function loadSentList(): Promise<{ list: SentSummary[]; failed: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("progress_reports")
    .select("id, period_start, period_end, sent_at")
    .eq("produto", PRODUCT)
    .eq("status", "sent")
    .order("period_start", { ascending: false })
    .limit(30);
  if (failure("sent list read", error)) return { list: [], failed: true };
  return { list: (data ?? []) as SentSummary[], failed: false };
}

/**
 * The products a week can be of: the database's, GeoCloud being the only one the app writes now (the e2e
 * suite's synthetic reports are the other).
 */
export type WeekProduct = "GeoCloud" | "ELIMS";

/** The product a week's address asks for (?produto=), GeoCloud when it asks for none; null when it is unknown. */
export function weekProduct(value: string | string[] | undefined): WeekProduct | null {
  if (value === undefined) return PRODUCT;
  return value === "GeoCloud" || value === "ELIMS" ? value : null;
}

/** "YYYY-MM-DD" of a Monday (the address of a week), or null. */
export function weekStartParam(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`))) return null;
  return weekStartOf(`${value}T15:00:00Z`) === value ? value : null;
}

/**
 * The reports SENT in the week that starts on that Monday (São Paulo time, by the day each period ENDS, see
 * weekOfPeriod), for the week's presentation, of one product: GeoCloud unless the address asks for another (the
 * e2e suite's synthetic reports use another, so real ones are never touched). Drafts never: the query asks for
 * sent ones only, for every role.
 */
export async function loadWeek(start: string, produto: WeekProduct = PRODUCT): Promise<{ rows: WeekReport[]; failed: boolean }> {
  const from = new Date(Date.parse(`${start}T03:00:00Z`)); // Monday 00:00 in São Paulo
  const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  const supabase = await createClient();
  // The end of a period is exclusive, so its last instant is just before it: that instant in [from, to) is
  // the end in (from, to]. Two reports can end in the same week without starting in it.
  const { data, error } = await supabase
    .from("progress_reports")
    .select("content, overrides, share_token, pushed_at, period_start")
    .eq("produto", produto)
    .eq("status", "sent")
    .gt("period_end", from.toISOString())
    .lte("period_end", to.toISOString())
    .order("period_start", { ascending: true });
  if (failure("week read", error)) return { rows: [], failed: true };
  const rows = ((data ?? []) as unknown as WeekReport[]).map((r) => ({ ...r, content: forScreen({ content: r.content } as ProgressReportRow).content }));
  return { rows, failed: false };
}
