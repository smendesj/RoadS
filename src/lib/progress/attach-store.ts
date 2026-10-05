// The Supabase side of the attach port (attach.ts): the route passes its admin client (service role: the
// table's guard and the prints bucket only let that one write). Like ingest-store.ts, it takes the client as
// an argument and carries no "server-only".
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttachStore, AttachedReport } from "./attach.ts";
import { PROGRESS_SHOTS_BUCKET } from "./shot-store.ts";

const TABLE = "progress_reports";

export function supabaseAttachStore(client: SupabaseClient): AttachStore {
  return {
    async findReport(id) {
      const { data, error } = await client.from(TABLE).select("status, rev, content, overrides").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as AttachedReport | null;
    },

    async shotExists(path) {
      // exists() asks with a HEAD and answers an absent object with { data: false } AND an error (400, no body):
      // that is "not uploaded", not a failure. Only an answer that is not a yes or a no is one.
      const { data } = await client.storage.from(PROGRESS_SHOTS_BUCKET).exists(path);
      if (typeof data !== "boolean") throw new Error("print lookup failed");
      return data;
    },

    async writeShots(id, rev, content) {
      // Only over the revision that was read, and only while the report is still sent.
      const { data, error } = await client.from(TABLE).update({ content, rev: rev + 1 }).eq("id", id).eq("rev", rev).eq("status", "sent").select("id");
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
  };
}
