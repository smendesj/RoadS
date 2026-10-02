// The Roadmap block an open issue is filed in comes from its type:* label; without a known one it
// stays in the "Sem tipo" block (TRIAGE_LANE, kept from before the type blocks existed).
export const TRIAGE_LANE = "triagem";
export const TYPE_LANES = ["tipo-feature", "tipo-bug", "tipo-chore", "tipo-spike"];

export function laneForLabels(labels: string[]): string {
  const type = tipoForLabels(labels);
  return type ? `tipo-${type}` : TRIAGE_LANE;
}

/** The type (feature, bug, chore or spike) named by a type:* label, or null when there is none we know. */
export function tipoForLabels(labels: string[]): string | null {
  const type = labels.find((l) => l.startsWith("type:"))?.slice(5);
  return type && TYPE_LANES.includes(`tipo-${type}`) ? type : null;
}
