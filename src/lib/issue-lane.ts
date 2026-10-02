// The Roadmap block an open issue is filed in comes from its type:* label; without a known one it
// stays in the "Sem tipo" block (TRIAGE_LANE, kept from before the type blocks existed).
export const TRIAGE_LANE = "triagem";
export const TYPE_LANES = ["tipo-feature", "tipo-bug", "tipo-chore", "tipo-spike"];

export function laneForLabels(labels: string[]): string {
  const type = labels.find((l) => l.startsWith("type:"))?.slice(5);
  const lane = `tipo-${type}`;
  return TYPE_LANES.includes(lane) ? lane : TRIAGE_LANE;
}
