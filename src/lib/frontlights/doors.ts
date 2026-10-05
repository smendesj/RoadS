import { checkFrontlightsAuth } from "@/lib/frontlights-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { after } from "next/server";
import { recordCall } from "./calls.ts";
import { supabaseCallStore } from "./calls-store.ts";
import { frontlightsDoor } from "./door.ts";

// The door every /api/frontlights route is exported through, with the real secret check and the real call log
// plugged in. The route files are only the HTTP plumbing: they read the request, call a handler under
// src/lib/frontlights or src/lib/progress (all of it tested without a server) and answer. The call is written
// down after the answer was sent (`after`), so the log never delays a call.
export function door<Context = unknown>(route: string, handle: (request: Request, context: Context) => Promise<Response>) {
  return frontlightsDoor<Context>(
    {
      route,
      authorized: checkFrontlightsAuth,
      // The client is made inside insert, so a missing key is logged by recordCall like any other failure.
      record: (call) => after(() => recordCall({ insert: (row) => supabaseCallStore(createAdminClient()).insert(row) }, call)),
    },
    handle
  );
}
