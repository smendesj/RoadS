import { bearerMatches } from "@/lib/secret";

// Shared bearer-token check for the /api/frontlights/* routes FrontlightS's
// /update-roads consumer calls — not a browser session, so this is a
// shared-secret header instead of the Supabase auth cookie other routes use.
export function checkFrontlightsAuth(request: Request): boolean {
  return bearerMatches(request.headers.get("authorization"), process.env.FRONTLIGHTS_API_SECRET);
}
