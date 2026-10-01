import { RoadmapView } from "@/components/RoadmapView";
import { getViewer } from "@/lib/get-viewer";

export default async function RoadmapPage() {
  return <RoadmapView viewer={await getViewer()} />;
}
