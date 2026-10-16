import { test } from "node:test";
import assert from "node:assert/strict";
import { planSprintSync, runSprintSync, type SprintCandidate, type SprintSyncDeps } from "./sprint-status-sync.ts";

// The current week is whichever lane the sync names as current: a date id here, a positional one before migration 0031.
const NOW = "sprint-12-10-2026";
const NEXT = "sprint-19-10-2026";
const LATER = "sprint-26-10-2026";
const T = (hour: number) => `2026-10-06T${String(hour).padStart(2, "0")}:00:00.000Z`;

function candidate(over: Partial<SprintCandidate> & { status?: string; statusAt?: string } = {}): SprintCandidate {
  const { status = "Open", statusAt = T(12), ...rest } = over;
  return {
    id: "item-1",
    laneId: "tipo-feature",
    createdAt: T(1),
    releaseTo: "tipo-feature",
    card: { projectItemId: "PVTI_1", status: status as SprintCandidate["card"]["status"], statusAt },
    ...rest,
  };
}
const moved = (...pairs: [string, string][]) => new Map(pairs);

// ---- the rule: "in the current sprint" and "Development" are the same fact told twice

test("an item in the current sprint that is Development, and one outside it that is Open, need nothing", () => {
  const plan = planSprintSync(
    [candidate({ id: "a", laneId: NOW, status: "Development" }), candidate({ id: "b", laneId: NEXT, status: "Open" }), candidate({ id: "c", laneId: "tipo-bug", status: "Open" })],
    new Map(),
    NOW
  );
  assert.deepEqual(plan, { pull: [], release: [], write: [], stuck: [] });
});

test("Done and Blocker are never the sprint's to say: nothing moves and nothing is written, whatever the lane", () => {
  for (const status of ["Done", "Blocker"]) {
    for (const laneId of [NOW, NEXT, "tipo-feature"]) {
      const plan = planSprintSync([candidate({ laneId, status, statusAt: T(20) })], moved(["item-1", T(2)]), NOW);
      assert.deepEqual(plan, { pull: [], release: [], write: [], stuck: [] }, `${status} in ${laneId}`);
    }
  }
});

test("the current sprint is the lane named current, whatever its id: a positional lane is no longer it once the week is a date lane", () => {
  const plan = planSprintSync(
    [candidate({ id: "week", laneId: NOW, status: "Development" }), candidate({ id: "old", laneId: "atual", status: "Development", statusAt: T(12) })],
    moved(["old", T(9)]),
    NOW
  );
  assert.deepEqual(plan.pull, [{ id: "old", from: "atual" }]);
  assert.deepEqual(plan.write, []);
});

test("with no lane for this week yet, nothing is in the current sprint: a Development the Project set last is pulled into it", () => {
  const plan = planSprintSync([candidate({ laneId: NEXT, status: "Development", statusAt: T(12) })], moved(["item-1", T(9)]), null);
  assert.deepEqual(plan.pull, [{ id: "item-1", from: NEXT }]);
});

// ---- the Project moved last: the Roadmap follows

test("an item the Project put in Development after the Roadmap placed it is pulled into the current sprint, from wherever it was", () => {
  for (const from of [NEXT, LATER, "tipo-feature"]) {
    const plan = planSprintSync([candidate({ laneId: from, status: "Development", statusAt: T(12) })], moved(["item-1", T(9)]), NOW);
    assert.deepEqual(plan.pull, [{ id: "item-1", from }]);
    assert.deepEqual(plan.write, []);
  }
});

test("an item the Project took out of Development after the Roadmap put it in the current sprint goes back to its block of the Roadmap", () => {
  const plan = planSprintSync([candidate({ laneId: NOW, status: "Open", statusAt: T(12), releaseTo: "tipo-bug" })], moved(["item-1", T(9)]), NOW);
  assert.deepEqual(plan.release, [{ id: "item-1", from: NOW, to: "tipo-bug" }]);
  assert.deepEqual(plan.write, []);
});

test("with no block to go back to, the item stays where it is and is counted as stuck", () => {
  const plan = planSprintSync([candidate({ laneId: NOW, status: "Open", statusAt: T(12), releaseTo: null })], moved(["item-1", T(9)]), NOW);
  assert.deepEqual(plan.release, []);
  assert.deepEqual(plan.stuck, ["item-1"]);
});

// ---- the Roadmap moved last: the Project follows

test("an item the Roadmap put in the current sprint after the Project said Open is written Development", () => {
  const plan = planSprintSync([candidate({ laneId: NOW, status: "Open", statusAt: T(9) })], moved(["item-1", T(12)]), NOW);
  assert.deepEqual(plan.write, [{ id: "item-1", projectItemId: "PVTI_1", status: "Development" }]);
  assert.deepEqual(plan.pull, []);
  assert.deepEqual(plan.release, []);
});

test("an item the Roadmap took out of the current sprint after the Project said Development is written Open", () => {
  const plan = planSprintSync([candidate({ laneId: NEXT, status: "Development", statusAt: T(9) })], moved(["item-1", T(12)]), NOW);
  assert.deepEqual(plan.write, [{ id: "item-1", projectItemId: "PVTI_1", status: "Open" }]);
  assert.deepEqual(plan.pull, []);
});

test("the same instant goes to the Roadmap: the Project only wins by being strictly later", () => {
  const plan = planSprintSync([candidate({ laneId: NOW, status: "Open", statusAt: T(12) })], moved(["item-1", T(12)]), NOW);
  assert.equal(plan.write.length, 1);
  assert.deepEqual(plan.release, []);
});

test("an item the Roadmap never moved is as old as its row: a later Project change beats it, an earlier one doesn't", () => {
  const later = planSprintSync([candidate({ laneId: NEXT, status: "Development", statusAt: T(12), createdAt: T(3) })], new Map(), NOW);
  assert.equal(later.pull.length, 1);
  const earlier = planSprintSync([candidate({ laneId: NEXT, status: "Development", statusAt: T(2), createdAt: T(3) })], new Map(), NOW);
  assert.equal(earlier.write.length, 1);
});

test("each item is judged on its own times", () => {
  const plan = planSprintSync(
    [
      candidate({ id: "x", laneId: NEXT, status: "Development", statusAt: T(12) }),
      candidate({ id: "y", laneId: NEXT, status: "Development", statusAt: T(8) }),
    ],
    moved(["x", T(10)], ["y", T(10)]),
    NOW
  );
  assert.deepEqual(plan.pull.map((m) => m.id), ["x"]);
  assert.deepEqual(plan.write.map((w) => w.id), ["y"]);
});

// ---- no echo: once one side follows the other, the sides agree and the next sync has nothing to do

test("after the Roadmap writes the Project, and after the Project moves the Roadmap, the next sync finds nothing", () => {
  const first = planSprintSync([candidate({ laneId: NOW, status: "Open", statusAt: T(9) })], moved(["item-1", T(12)]), NOW);
  assert.equal(first.write.length, 1);
  // The write made the Project say Development, at a time later than the move that caused it.
  const echo = planSprintSync([candidate({ laneId: NOW, status: "Development", statusAt: T(13) })], moved(["item-1", T(12)]), NOW);
  assert.deepEqual(echo, { pull: [], release: [], write: [], stuck: [] });

  const pulled = planSprintSync([candidate({ laneId: NEXT, status: "Development", statusAt: T(12) })], moved(["item-1", T(9)]), NOW);
  assert.equal(pulled.pull.length, 1);
  const after = planSprintSync([candidate({ laneId: NOW, status: "Development", statusAt: T(12) })], moved(["item-1", T(13)]), NOW);
  assert.deepEqual(after, { pull: [], release: [], write: [], stuck: [] });
});

// ---- running a plan

function fakes(over: Partial<SprintSyncDeps> = {}) {
  const calls = { movedAt: [] as string[][], pull: [] as unknown[], release: [] as unknown[], write: [] as unknown[] };
  const deps: SprintSyncDeps = {
    writeEnabled: true,
    movedAt: async (ids) => {
      calls.movedAt.push(ids);
      return new Map(ids.map((id) => [id, T(10)] as [string, string]));
    },
    pull: async (m) => void calls.pull.push(m),
    release: async (m) => void calls.release.push(m),
    writeStatus: async (id, status) => void calls.write.push([id, status]),
    ...over,
  };
  return { deps, calls };
}

const MIXED = [
  candidate({ id: "agree", laneId: NOW, status: "Development" }),
  candidate({ id: "pull", laneId: NEXT, status: "Development", statusAt: T(12) }),
  candidate({ id: "release", laneId: NOW, status: "Open", statusAt: T(12) }),
  candidate({ id: "write", laneId: NOW, status: "Open", statusAt: T(8), card: { projectItemId: "PVTI_w", status: "Open", statusAt: T(8) } }),
];

test("only the items whose sides disagree have their last move looked up", async () => {
  const { deps, calls } = fakes();
  await runSprintSync(MIXED, deps, NOW);
  assert.deepEqual(calls.movedAt, [["pull", "release", "write"]]);

  const quiet = fakes();
  await runSprintSync([candidate({ id: "agree", laneId: NOW, status: "Development" })], quiet.deps, NOW);
  assert.deepEqual(quiet.calls.movedAt, [], "nothing disagrees: nothing is looked up");
});

test("with writing on, the Project follows the Roadmap and the summary says what happened", async () => {
  const { deps, calls } = fakes();
  const { summary, written } = await runSprintSync(MIXED, deps, NOW);
  assert.deepEqual(calls.pull, [{ id: "pull", from: NEXT }]);
  assert.deepEqual(calls.release, [{ id: "release", from: NOW, to: "tipo-feature" }]);
  assert.deepEqual(calls.write, [["PVTI_w", "Development"]]);
  assert.deepEqual(written, [{ id: "write", status: "Development" }]);
  assert.deepEqual(summary, { pulled: 1, released: 1, written: 1, wouldWrite: 0, failed: 0, stuck: 0 });
});

test("with writing off, the Roadmap still follows the Project but nothing is written: the summary says what would be", async () => {
  const { deps, calls } = fakes({ writeEnabled: false });
  const { summary, written } = await runSprintSync(MIXED, deps, NOW);
  assert.equal(calls.write.length, 0);
  assert.deepEqual(written, []);
  assert.equal(calls.pull.length, 1);
  assert.equal(calls.release.length, 1);
  assert.deepEqual(summary, { pulled: 1, released: 1, written: 0, wouldWrite: 1, failed: 0, stuck: 0 });
});

test("one item that fails to move or to be written is counted and doesn't stop the others", async () => {
  const { deps, calls } = fakes({
    pull: async () => {
      throw new Error("db down");
    },
    writeStatus: async () => {
      throw new Error("GitHub respondeu 502");
    },
  });
  const { summary, written } = await runSprintSync(MIXED, deps, NOW);
  assert.equal(calls.release.length, 1, "the release after the failed pull still ran");
  assert.deepEqual(written, []);
  assert.deepEqual(summary, { pulled: 0, released: 1, written: 0, wouldWrite: 0, failed: 2, stuck: 0 });
});

test("a failure to look up the last moves fails the whole step, loudly, and applies nothing", async () => {
  const { deps, calls } = fakes({
    movedAt: async () => {
      throw new Error("fila ilegível");
    },
  });
  await assert.rejects(runSprintSync(MIXED, deps, NOW), /fila ilegível/);
  assert.equal(calls.pull.length + calls.release.length + calls.write.length, 0);
});
