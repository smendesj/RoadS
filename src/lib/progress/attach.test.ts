import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProgressContent, Shot } from "../progress-report.ts";
import { attachShots, type AttachStore, type AttachedReport } from "./attach.ts";
import { entry, sampleContent } from "./visual-fixture.ts";

// Made-up data only: invented deliveries, hash-shaped names that point at nothing real.

const ID = "0b9f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4";
const path = (c: string, ext: "png" | "jpg" = "png") => `${c.repeat(64)}.${ext}`;
const shotOf = (issue: number | undefined, p: string, caption = "Tela de exemplo"): Shot => ({
  id: "x",
  caption,
  mime: p.endsWith(".png") ? "image/png" : "image/jpeg",
  ...(issue === undefined ? {} : { issue }),
  path: p,
});

const sentContent = (): ProgressContent =>
  sampleContent(2, {
    entries: [entry(1, "concluido"), entry(2, "em_andamento"), entry(3, "proximo")],
    shots: [{ id: "shot-1", caption: "Print geral já enviado", mime: "image/jpeg", data: "AAAA" }],
  });

/** A table with one report, and a bucket that knows which prints were uploaded. */
function fakeStore(report: AttachedReport | null, uploaded: string[] = []) {
  const writes: { id: string; rev: number; shots: Shot[] }[] = [];
  let current = report ? structuredClone(report) : null;
  const store: AttachStore = {
    async findReport(id) {
      return id === ID && current ? structuredClone(current) : null;
    },
    async shotExists(p) {
      return uploaded.includes(p);
    },
    async writeShots(id, rev, content) {
      writes.push({ id, rev, shots: structuredClone(content.shots ?? []) });
      if (!current || current.rev !== rev) return false;
      current = { ...current, rev: rev + 1, content: structuredClone(content) };
      return true;
    },
  };
  return { store, writes, now: () => current };
}

const sent = (content = sentContent(), overrides: AttachedReport["overrides"] = {}): AttachedReport => ({ status: "sent", rev: 7, content, overrides });

test("prints of deliveries are added to a sent report after the ones it had, and nothing else changes", async () => {
  const db = fakeStore(sent(), [path("a"), path("b", "jpg")]);
  const before = structuredClone(db.now()!.content);
  const out = await attachShots(db.store, ID, { shots: [shotOf(1, path("a"), "Tela da entrega 1"), shotOf(2, path("b", "jpg"), "Código da entrega 2")] });
  assert.deepEqual(out, { status: 200, body: { added: 2, existing: 0 } });
  const after = db.now()!.content;
  assert.deepEqual(after.shots, [
    before.shots![0],
    { id: "shot-2", caption: "Tela da entrega 1", mime: "image/png", issue: 1, path: path("a") },
    { id: "shot-3", caption: "Código da entrega 2", mime: "image/jpeg", issue: 2, path: path("b", "jpg") },
  ]);
  // Everything but the prints is exactly as it was.
  assert.deepEqual({ ...after, shots: undefined }, { ...before, shots: undefined });
  assert.equal(db.writes[0].rev, 7); // written only over the revision that was read
});

test("sending the same prints again adds nothing: the run can be repeated", async () => {
  const db = fakeStore(sent(), [path("a")]);
  await attachShots(db.store, ID, { shots: [shotOf(1, path("a"))] });
  const again = await attachShots(db.store, ID, { shots: [shotOf(1, path("a"))] });
  assert.deepEqual(again, { status: 200, body: { added: 0, existing: 1 } });
  assert.equal(db.now()!.content.shots!.length, 2);
  assert.equal(db.writes.length, 1); // nothing to write the second time
});

test("a print must name a delivery of that report and be one already uploaded; otherwise nothing is written", async () => {
  const cases: [unknown, RegExp][] = [
    [{ shots: [shotOf(99, path("a"))] }, /#99/],
    [{ shots: [shotOf(undefined, path("a"))] }, /issue/],
    [{ shots: [shotOf(1, path("c"))] }, /não foi enviado/],
    [{ shots: [shotOf(1, "../segredo.png")] }, /path/],
    [{ shots: [{ ...shotOf(1, path("a")), path: path("a", "jpg") }] }, /path/], // extension of another type
    [{ shots: [shotOf(1, path("a"), "")] }, /caption/],
    [{ shots: [] }, /shots/],
    [{}, /shots/],
    [null, /shots/],
  ];
  for (const [body, why] of cases) {
    const db = fakeStore(sent(), [path("a")]);
    const out = await attachShots(db.store, ID, body);
    assert.equal(out.status, 400, JSON.stringify(body));
    assert.ok(out.status === 400 && why.test(out.body.error), out.status === 400 ? out.body.error : "");
    assert.equal(db.writes.length, 0);
  }
});

test("a delivery the e-mail did not show (hidden, or hidden by an edit) takes no print: it would never appear", async () => {
  const content = sentContent();
  content.entries[1].hidden = true;
  const byFlag = fakeStore(sent(content), [path("a")]);
  const flagged = await attachShots(byFlag.store, ID, { shots: [shotOf(2, path("a"))] });
  assert.ok(flagged.status === 400 && /#2/.test(flagged.body.error) && /escondida/.test(flagged.body.error));
  const byEdit = fakeStore(sent(sentContent(), { "entry:gc-1:hidden": { value: true } }), [path("a")]);
  const edited = await attachShots(byEdit.store, ID, { shots: [shotOf(1, path("a"))] });
  assert.ok(edited.status === 400 && /#1/.test(edited.body.error));
  assert.equal(byFlag.writes.length + byEdit.writes.length, 0);
});

test("the total stays within forty prints", async () => {
  const many = Array.from({ length: 39 }, (_, i) => shotOf(1, path(String(i % 10)).replace(/^./, String.fromCharCode(97 + (i % 6)))));
  const full = sentContent();
  full.shots = Array.from({ length: 39 }, (_, i) => ({ ...many[i], id: `shot-${i + 1}` }));
  const db = fakeStore(sent(full), [path("e"), path("f")]);
  const out = await attachShots(db.store, ID, { shots: [shotOf(1, path("e")), shotOf(2, path("f"))] });
  assert.equal(out.status, 400);
  assert.ok(out.status === 400 && /40/.test(out.body.error));
  assert.equal(db.writes.length, 0);
});

test("only a sent report takes prints this way: a draft is a 409, an unknown id a 404", async () => {
  const draft = fakeStore({ ...sent(), status: "draft" }, [path("a")]);
  assert.deepEqual(await attachShots(draft.store, ID, { shots: [shotOf(1, path("a"))] }), { status: 409, body: { error: "not_sent" } });
  const none = fakeStore(null, [path("a")]);
  assert.deepEqual(await attachShots(none.store, ID, { shots: [shotOf(1, path("a"))] }), { status: 404, body: { error: "not_found" } });
  const malformed = fakeStore(sent(), [path("a")]);
  assert.deepEqual(await attachShots(malformed.store, "isto-nao-e-um-id", { shots: [shotOf(1, path("a"))] }), { status: 404, body: { error: "not_found" } });
});

test("a report that changed between the read and the write is a 409, not a silent overwrite", async () => {
  const db = fakeStore(sent(), [path("a")]);
  const store: AttachStore = { ...db.store, writeShots: async () => false };
  assert.deepEqual(await attachShots(store, ID, { shots: [shotOf(1, path("a"))] }), { status: 409, body: { error: "concurrent_change" } });
});
