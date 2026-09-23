import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// service_role bypasses every RLS policy. Only ever import this from a Server Action or Route
// Handler, never from a Client Component, and never return its client or its key to the browser.
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    throw new Error("SUPABASE_SECRET_KEY is not set — add it to .env.local (server-only, no NEXT_PUBLIC_ prefix).");
  }
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
