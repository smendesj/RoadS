import { RoadmapView } from "@/components/RoadmapView";
import { getViewerOrReset } from "@/lib/get-viewer";

export default async function RoadmapPage() {
  return <RoadmapView viewer={await getViewerOrReset()} />;
}
