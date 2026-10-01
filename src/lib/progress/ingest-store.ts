// The Supabase side of the ingest port (ingest.ts). It takes the client as an argument, so it carries no
// "server-only" and the RLS audit can run it with its own service-role client; the route passes
// createAdminClient(). It reads only the few columns the ingest needs: never the whole `content`, which
// holds the prints.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProgressEntry } from "../progress-report.ts";
import type { ReportStore, SentReport, StoredReport } from "./ingest.ts";

const TABLE = "progress_reports";
const BRIEF = "id, produto, period_start, period_end, status, rev, pushed_at, checked_at";
const UNIQUE_VIOLATION = "23505";

export function supabaseReportStore(client: SupabaseClient): ReportStore {
  return {
    async findDraft(produto) {
      const { data, error } = await client.from(TABLE).select(BRIEF).eq("produto", produto).eq("status", "draft").maybeSingle();
      if (error) throw error;
      return data as StoredReport | null;
    },

    async findLastSent(produto) {
      // `content->entries` asks Postgres for the entries only, not the prints that sit next to them.
      const { data, error } = await client
        .from(TABLE)
        .select(`${BRIEF}, entries:content->entries, overrides`)
        .eq("produto", produto)
        .eq("status", "sent")
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as unknown as StoredReport & { entries: Pick<ProgressEntry, "id" | "status" | "hidden">[] | null; overrides: SentReport["overrides"] };
      const entries = (row.entries ?? []).map(({ id, status, hidden }) => ({ id, status, hidden }));
      return { ...row, entries };
    },

    async findByPeriod(produto, periodStart) {
      const { data, error } = await client.from(TABLE).select(BRIEF).eq("produto", produto).eq("period_start", periodStart).maybeSingle();
      if (error) throw error;
      return data as StoredReport | null;
    },

    async insert(row) {
      const { data, error } = await client.from(TABLE).insert(row).select("id").single();
      // "Already there": another push created the draft (or the period) a moment ago. Not a failure.
      if (error?.code === UNIQUE_VIOLATION) return null;
      if (error) throw error;
      return { id: data.id as string };
    },

    async updateDraft(id, patch) {
      // Only while it is still a draft: if the user sent it in the meantime, nothing is written over it.
      const { data, error } = await client.from(TABLE).update(patch).eq("id", id).eq("status", "draft").select("id");
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
  };
}
