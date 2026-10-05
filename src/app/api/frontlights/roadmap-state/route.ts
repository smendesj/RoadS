import { frontlightsJson } from "@/lib/frontlights/contract";
import { door } from "@/lib/frontlights/doors";
import { readRoadmapState } from "@/lib/frontlights/state";
import { supabaseStateStore } from "@/lib/frontlights/state-store";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/frontlights/roadmap-state -> the Roadmap as it stands now (see src/lib/roadmap-state.ts for the
// shape). Read-only: it consumes nothing and never acks. FrontlightS uses it for the content and context of
// ROADMAP.md and the SPRINT files (sprint dates, order, status, the over-the-limit flag), while
// /pending-changes stays the list of what changed and the only thing /ack closes. Admin client, like the
// other routes: a service-to-service call with no user session.
export const GET = door("/roadmap-state", async () => {
  const state = await readRoadmapState(supabaseStateStore(createAdminClient()), new Date());
  return frontlightsJson({ ...state });
});
