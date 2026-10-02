// When the current sprint's week is over, the sprints move one step: "proxima" becomes the current
// one, "terceira" becomes "proxima" and a new, empty "terceira" opens a week after. Items the board
// marks Done leave the Roadmap with the sprint that ended (they stay in the history); the rest
// carry over into the new current sprint, ahead of the items that were planned for it.

export const SPRINT_IDS = ["atual", "proxima", "terceira"] as const;
export type SprintId = (typeof SPRINT_IDS)[number];

export type SprintDates = { start: string; end: string };
export type RotationItem = { id: string; laneId: string; url: string | null };

export type RotationPlan = {
  /** How many weeks went by; 0 means nothing to do. */
  rotations: number;
  /** The dates each sprint has once rotated. */
  dates: Record<SprintId, SprintDates>;
  /** Items finished in a sprint that ended; they leave the Roadmap. */
  finished: string[];
  /** Where each surviving sprint item ends up, in order within its sprint. Empty when nothing rotates. */
  placements:{ id: string; from: SprintId; to: SprintId; sortOrder: number }[];
};

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** A sprint "ends" at the end of its last day: it is over from the day after. */
export function planRotation(input: {
  today: string;
  dates: Record<SprintId, SprintDates>;
  items: RotationItem[];
  doneUrls: Set<string>;
}): RotationPlan {
  let dates = input.dates;
  let sprints: Record<SprintId, RotationItem[]> = { atual: [], proxima: [], terceira: [] };
  for (const it of input.items) if ((SPRINT_IDS as readonly string[]).includes(it.laneId)) sprints[it.laneId as SprintId].push(it);
  const origin = new Map(Object.entries(sprints).flatMap(([lane, items]) => items.map((it) => [it.id, lane as SprintId] as const)));

  const finished: string[] = [];
  let rotations = 0;
  while (dates.atual.end < input.today && rotations < 60) {
    rotations++;
    const carried = sprints.atual.filter((it) => !(it.url && input.doneUrls.has(it.url)));
    for (const it of sprints.atual) if (!carried.includes(it)) finished.push(it.id);
    sprints = { atual: [...carried, ...sprints.proxima], proxima: sprints.terceira, terceira: [] };
    dates = {
      atual: dates.proxima,
      proxima: dates.terceira,
      terceira: { start: addDays(dates.terceira.start, 7), end: addDays(dates.terceira.end, 7) },
    };
  }

  const placements: RotationPlan["placements"] = [];
  if (rotations > 0) {
    for (const to of SPRINT_IDS) sprints[to].forEach((it, sortOrder) => placements.push({ id: it.id, from: origin.get(it.id)!, to, sortOrder }));
  }
  return { rotations, dates, finished, placements };
}
