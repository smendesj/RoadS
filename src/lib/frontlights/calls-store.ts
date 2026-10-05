// The Supabase side of the call log port (calls.ts). Written by the service role only: the table has RLS on and
// no policy, so nobody signed in, and nobody anonymous, reads or writes it.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallStore } from "./calls.ts";

const TABLE = "frontlights_calls";

export function supabaseCallStore(client: SupabaseClient): CallStore {
  return {
    async insert(record) {
      const { error } = await client.from(TABLE).insert(record);
      if (error) throw error;
    },

    async deleteOlderThan(cutoff) {
      const { data, error } = await client.from(TABLE).delete().lt("created_at", cutoff).select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },
  };
}
