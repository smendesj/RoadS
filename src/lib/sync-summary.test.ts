import { test } from "node:test";
import assert from "node:assert/strict";
import { syncSummary } from "./sync-summary.ts";

test("a finished sync reports when it ran and what the Roadmap took in, without the board's cards", () => {
  const summary = syncSummary(
    { ok: true, syncedAt: "2026-01-01T12:00:00.000Z", columns: [{ key: "done", items: [{ title: "Segredo", url: "u" }] }], roadmap: { added: 2, removed: 1, issuesCreated: 0 } },
    false
  );
  assert.deepEqual(summary, {
    ok: true,
    ran: true,
    syncedAt: "2026-01-01T12:00:00.000Z",
    roadmap: { added: 2, removed: 1, issuesCreated: 0 },
  });
  assert.ok(!JSON.stringify(summary).includes("Segredo"));
});

test("a sync skipped by the cooldown says it did not run, and carries no roadmap change", () => {
  const summary = syncSummary({ ok: true, syncedAt: "2026-01-01T12:00:00.000Z", columns: [], roadmap: { added: 0, removed: 0, issuesCreated: 0 } }, true);
  assert.equal(summary.ok, true);
  assert.equal(summary.ran, false);
});

test("a Roadmap that failed after the board synced is reported, not hidden", () => {
  const summary = syncSummary(
    { ok: true, syncedAt: "2026-01-01T12:00:00.000Z", columns: [], roadmap: { added: 0, removed: 0, issuesCreated: 0, error: "falhou" } },
    false
  );
  assert.equal(summary.ok, true);
  assert.equal(summary.ok && summary.roadmap.error, "falhou");
});

test("a failed sync keeps its reason and a message in the user's language", () => {
  assert.deepEqual(syncSummary({ ok: false, reason: "not_configured" }, false), {
    ok: false,
    reason: "not_configured",
    message: "Sincronização do GitHub ainda não configurada (falta GITHUB_TOKEN no servidor).",
  });
  assert.deepEqual(syncSummary({ ok: false, reason: "error", message: "GitHub respondeu 502" }, false), {
    ok: false,
    reason: "error",
    message: "GitHub respondeu 502",
  });
});


test("what the sprint step did travels in the summary as counts only", () => {
  const sprint = { pulled: 1, released: 0, written: 2, wouldWrite: 0, failed: 0, stuck: 0 };
  const summary = syncSummary({ ok: true, syncedAt: "2026-01-01T12:00:00.000Z", columns: [], roadmap: { added: 0, removed: 0, issuesCreated: 0, sprint } }, false);
  assert.equal(summary.ok && summary.roadmap.sprint?.written, 2);
  assert.deepEqual(summary.ok && summary.roadmap.sprint, sprint);
});
