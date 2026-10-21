import { test } from "node:test";
import assert from "node:assert/strict";
import { brakeMessage, roadmapChanged, roadmapSyncMessage, syncFailureMessage } from "./sync-message.ts";

test("a missing GitHub token says so, wherever the sync was started from", () => {
  assert.match(syncFailureMessage({ reason: "not_configured" }), /not configured yet.*GITHUB_TOKEN/);
});

test("other failures keep GitHub's own message when there is one", () => {
  assert.equal(syncFailureMessage({ reason: "error", message: "GitHub answered 502" }), "GitHub answered 502");
  assert.equal(syncFailureMessage({ reason: "no_access", message: "The token cannot see Project #7" }), "The token cannot see Project #7");
});

test("and fall back to a generic line when there isn't", () => {
  assert.equal(syncFailureMessage({ reason: "error" }), "Sync failed.");
  assert.equal(syncFailureMessage({ reason: "unauthenticated" }), "Sign in to sync the board.");
});

test("the Roadmap summary counts what came in and went out, and mentions created issues only when there were some", () => {
  assert.equal(roadmapSyncMessage({ added: 2, removed: 1, issuesCreated: 0 }), "2 issue(s) added, 1 closed or off the Project removed.");
  assert.equal(
    roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 3 }),
    "0 issue(s) added, 0 closed or off the Project removed, 3 issue(s) created for items without an issue."
  );
});

test("the Roadmap summary says how many issues stayed out for lack of a type label", () => {
  assert.equal(
    roadmapSyncMessage({ added: 1, removed: 0, issuesCreated: 0, untyped: 2 }),
    "1 issue(s) added, 0 closed or off the Project removed. 2 open issue(s) without a type:* label left out until they get a type."
  );
});

test("a Roadmap that failed reports its own error instead of counts", () => {
  assert.equal(roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, error: "failed" }), "failed");
});

const NO_SPRINT = { pulled: 0, released: 0, written: 0, wouldWrite: 0, failed: 0, stuck: 0 };
const BASE = "0 issue(s) added, 0 closed or off the Project removed.";

test("a sprint that needed nothing from the Project adds nothing to the Roadmap summary", () => {
  assert.equal(roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, sprint: NO_SPRINT }), BASE);
});

test("the summary says how the Roadmap and the Project followed each other", () => {
  assert.equal(
    roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, sprint: { ...NO_SPRINT, pulled: 2, released: 1, written: 3 } }),
    `${BASE} Current sprint and Project: 2 issue(s) pulled into the current sprint, 1 returned to the Roadmap, 3 status(es) written to the Project.`
  );
});

test("with the writing off it says what would have been written, not that it was", () => {
  assert.equal(
    roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, sprint: { ...NO_SPRINT, wouldWrite: 2 } }),
    `${BASE} Current sprint and Project: 2 status(es) would be written to the Project, but writing is off.`
  );
});

test("a failure of the sprint step is reported next to the counts, never hidden", () => {
  assert.equal(
    roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, sprint: { ...NO_SPRINT, pulled: 1, failed: 2, stuck: 1 } }),
    `${BASE} Current sprint and Project: 1 issue(s) pulled into the current sprint, 2 failed, 1 with no Roadmap block to return to.`
  );
  assert.equal(
    roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, sprint: { ...NO_SPRINT, error: "unreadable queue" } }),
    `${BASE} The current sprint did not follow the Project: unreadable queue.`
  );
});


test("the summary says how many Roadmap titles followed a rename on GitHub, and nothing when none did", () => {
  assert.equal(roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, retitled: 0 }), BASE);
  assert.equal(
    roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, retitled: 3 }),
    `${BASE} 3 Roadmap title(s) followed the issue's rename on GitHub.`
  );
});

test("a sync the page ran by itself is worth a line only when it changed something", () => {
  const quiet = { added: 0, removed: 0, issuesCreated: 0, untyped: 3, sprint: { pulled: 0, released: 0, written: 0, wouldWrite: 0, failed: 0, stuck: 0 } };
  assert.equal(roadmapChanged(quiet), false, "0 added, 0 removed and issues left without a type are no news");
  assert.equal(roadmapChanged({ added: 0, removed: 0, issuesCreated: 0 }), false);
  for (const change of [{ added: 1 }, { removed: 2 }, { issuesCreated: 1 }, { retitled: 1 }, { error: "boom" }]) {
    assert.equal(roadmapChanged({ ...quiet, ...change }), true, JSON.stringify(change));
  }
  for (const sprint of [{ pulled: 1 }, { released: 1 }, { written: 1 }, { wouldWrite: 1 }, { failed: 1 }, { stuck: 1 }, { error: "x" }]) {
    assert.equal(roadmapChanged({ ...quiet, sprint: { ...quiet.sprint, ...sprint } }), true, JSON.stringify(sprint));
  }
});
test("a press the brake held back says so and when the next sync can run, never a made-up result", () => {
  assert.equal(brakeMessage(20_000), "A sync started less than 30 s ago or is still running; the next one can run in 20 s.");
  assert.equal(brakeMessage(400), "A sync started less than 30 s ago or is still running; the next one can run in 1 s.");
  assert.equal(brakeMessage(undefined), "A sync started less than 30 s ago or is still running; try again in a moment.");
});
test("the Comments a sync brought in, wrote to GitHub or failed are told, and count as a change", () => {
  const base = { added: 0, removed: 0, issuesCreated: 0 };
  const message = roadmapSyncMessage({ ...base, comments: { pulled: 2, pushed: 1, failed: 0 } });
  assert.match(message, /Comments: 2 pulled from GitHub, 1 pushed to GitHub/);
  assert.equal(roadmapChanged({ ...base, comments: { pulled: 0, pushed: 1, failed: 0 } }), true);
  assert.match(roadmapSyncMessage({ ...base, comments: { pulled: 0, pushed: 0, failed: 0, error: "GitHub answered 502" } }), /Comments did not sync: GitHub answered 502/);
});

test("the Assignees a sync brought in, wrote to GitHub or failed are told, and count as a change", () => {
  const base = { added: 0, removed: 0, issuesCreated: 0 };
  assert.match(roadmapSyncMessage({ ...base, assignees: { pulled: 1, pushed: 2, failed: 0 } }), /Assignees: 1 item\(s\) pulled from GitHub, 2 pushed to GitHub/);
  assert.equal(roadmapChanged({ ...base, assignees: { pulled: 1, pushed: 0, failed: 0 } }), true);
});
