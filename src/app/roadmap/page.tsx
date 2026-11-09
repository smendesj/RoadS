import { RoadmapView } from "@/components/RoadmapView";
import { getViewerOrReset, isControlsMember } from "@/lib/get-viewer";

// Its server actions sync the board. A sync may run this long (SYNC_MAX_DURATION_S in src/lib/sync-cooldown.ts; Next reads only a literal here).
export const maxDuration = 300;

export default async function RoadmapPage() {
  const [viewer, showControls] = await Promise.all([getViewerOrReset(), isControlsMember()]);
  return <RoadmapView viewer={viewer} showControls={showControls} />;
}
