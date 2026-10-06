// "In the current sprint" (the Roadmap's `atual` lane) and "Development" (the Status on GitHub Project #7)
// are one fact told twice, and the sync keeps the two telling it the same way. The Project has no sprint
// field, so the next sprints exist only in the Roadmap: their issues are Open on the Project.
//
//   in `atual`, Development  -> agree, nothing to do          outside `atual`, Open -> agree, nothing to do
//   in `atual`, Open         -> disagree                      outside `atual`, Development -> disagree
//
// When they disagree the one that moved LAST wins: the Project's side is the time GitHub keeps for the
// Status of that card, the Roadmap's is the item's latest add / move_lane row in the sync queue (a person's
// move, the rotation of the sprints, an import). The Roadmap follows a later Project by moving the item
// (queued, so FrontlightS writes the .md); the Project follows a later Roadmap by getting the Status
// written. Because only a disagreement is acted on, a write RoadS made comes back agreeing and is never an
// echo. Done and Blocker are never the sprint's to say: nothing is moved or written for them.
//
// Pure on purpose, with the database and GitHub behind the ports of SprintSyncDeps, so the rule runs under
// test without either. board-sync.ts plugs the real ones in.

export const CURRENT_SPRINT = "atual";

export type ProjectStatus = "Open" | "Development" | "Blocker" | "Done";
type WritableStatus = "Open" | "Development";

export type SprintCandidate = {
  /** The Roadmap item. */
  id: string;
  laneId: string;
  /** When the item's row was born: the age of an item the queue has no move for. */
  createdAt: string;
  /** The block of the Roadmap the item goes back to when the Project takes it out of the sprint; null if none can be named. */
  releaseTo: string | null;
  /** Its card on the Project: where the Status is written, what it says and since when. */
  card: { projectItemId: string; status: ProjectStatus; statusAt: string };
};

export type SprintPlan = {
  /** The Project is ahead: the item goes into the current sprint. */
  pull: { id: string; from: string }[];
  /** The Project is ahead: the item leaves the current sprint for its block. */
  release: { id: string; from: string; to: string }[];
  /** The Roadmap is ahead: the Status to write on the Project. */
  write: { id: string; projectItemId: string; status: WritableStatus }[];
  /** The Project took the item out of the sprint but there is no block to put it in: it stays. */
  stuck: string[];
};

const inSprint = (c: SprintCandidate) => c.laneId === CURRENT_SPRINT;
const sprintSays = (c: SprintCandidate) => c.card.status === "Development";
const concerned = (c: SprintCandidate) => c.card.status === "Open" || c.card.status === "Development";

/** The items whose two sides tell different stories, and so the only ones whose last move is worth looking up. */
export function disagreeing(candidates: SprintCandidate[]): SprintCandidate[] {
  return candidates.filter((c) => concerned(c) && inSprint(c) !== sprintSays(c));
}

export function planSprintSync(candidates: SprintCandidate[], movedAt: Map<string, string>): SprintPlan {
  const plan: SprintPlan = { pull: [], release: [], write: [], stuck: [] };
  for (const c of disagreeing(candidates)) {
    const roadmapAt = Date.parse(movedAt.get(c.id) ?? c.createdAt);
    const projectAt = Date.parse(c.card.statusAt);
    const projectLast = projectAt > roadmapAt; // a tie goes to the Roadmap
    if (projectLast) {
      if (inSprint(c)) {
        if (c.releaseTo) plan.release.push({ id: c.id, from: c.laneId, to: c.releaseTo });
        else plan.stuck.push(c.id);
      } else {
        plan.pull.push({ id: c.id, from: c.laneId });
      }
    } else {
      plan.write.push({ id: c.id, projectItemId: c.card.projectItemId, status: inSprint(c) ? "Development" : "Open" });
    }
  }
  return plan;
}

export type SprintSyncDeps = {
  /** False reports what would be written to the Project and writes nothing. The Roadmap's own moves are never held back. */
  writeEnabled: boolean;
  /** When the Roadmap last placed each of these items (the newest add / move_lane row); an item with none is absent. */
  movedAt(itemIds: string[]): Promise<Map<string, string>>;
  pull(move: { id: string; from: string }): Promise<void>;
  release(move: { id: string; from: string; to: string }): Promise<void>;
  writeStatus(projectItemId: string, status: WritableStatus): Promise<void>;
};

/** Counts only: no titles, no links, so it can travel in the sync-board summary. */
export type SprintSyncSummary = {
  pulled: number;
  released: number;
  written: number;
  wouldWrite: number;
  failed: number;
  stuck: number;
  error?: string;
};

export const EMPTY_SPRINT_SUMMARY: SprintSyncSummary = { pulled: 0, released: 0, written: 0, wouldWrite: 0, failed: 0, stuck: 0 };

/**
 * Plans and applies. Reading the queue failing fails the step with nothing applied (guessing times would
 * move things the wrong way); one move or write failing is counted and the others carry on.
 * `written` says which items got which Status, so the snapshot of the board can be brought up to date.
 */
export async function runSprintSync(
  candidates: SprintCandidate[],
  deps: SprintSyncDeps
): Promise<{ summary: SprintSyncSummary; written: { id: string; status: WritableStatus }[] }> {
  const apart = disagreeing(candidates);
  const movedAt = apart.length ? await deps.movedAt(apart.map((c) => c.id)) : new Map<string, string>();
  const plan = planSprintSync(candidates, movedAt);

  const summary: SprintSyncSummary = { ...EMPTY_SPRINT_SUMMARY, stuck: plan.stuck.length };
  const written: { id: string; status: WritableStatus }[] = [];

  for (const move of plan.pull) {
    try {
      await deps.pull(move);
      summary.pulled++;
    } catch (e) {
      console.error("sprint sync: pull failed", e);
      summary.failed++;
    }
  }
  for (const move of plan.release) {
    try {
      await deps.release(move);
      summary.released++;
    } catch (e) {
      console.error("sprint sync: release failed", e);
      summary.failed++;
    }
  }
  for (const w of plan.write) {
    if (!deps.writeEnabled) {
      summary.wouldWrite++;
      continue;
    }
    try {
      await deps.writeStatus(w.projectItemId, w.status);
      summary.written++;
      written.push({ id: w.id, status: w.status });
    } catch (e) {
      console.error("sprint sync: status write failed", e);
      summary.failed++;
    }
  }
  return { summary, written };
}
