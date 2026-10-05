import { test } from "node:test";
import assert from "node:assert/strict";
import type { EntryStatus, Overrides, ProgressContent } from "../progress-report.ts";
import type { Produto } from "../types.ts";
import { ingestDraft, receiveDraft, reportState, reportedEntries } from "./ingest.ts";
import type { DraftPatch, NewReport, ReportStore, StoredReport } from "./ingest.ts";

// Everything below is made-up data: round numbers, invented titles.

const WINDOW = { start: "2026-03-02T00:00:00-03:00", end: "2026-03-04T00:00:00-03:00" };
const TOKENS = { input: 100, output: 200, cacheRead: 300, cacheWrite: 400 };

function content(headline = "Duas entregas de exemplo foram concluídas.", window = WINDOW): ProgressContent {
  return {
    window,
    headline,
    entries: [
      {
        id: "gc-101",
        issue: 101,
        status: "concluido",
        title: "Entrega de exemplo A",
        summary: "Uma frase simples sobre a entrega de exemplo.",
        deliveredAt: "2026-03-03T15:00:00-03:00",
        subIssues: null,
        hidden: false,
        edited: false,
        sources: [],
      },
    ],
    internal: { count: 0, text: "" },
    difficulties: [],
    nextSteps: [],
    // The delivery on show comes with its print (a path in the storage bucket).
    shots: [{ id: "shot-1", caption: "Tela de exemplo", mime: "image/png", issue: 101, path: `${"a".repeat(64)}.png` }],
    usage: {
      scope: "GeoCloud",
      window,
      generatedAt: "2026-03-04T12:00:00-03:00",
      totals: { sessions: 0, messages: 0, activeDays: 0, tokens: TOKENS },
      byModel: [],
      favoriteModel: null,
      peakHour: null,
      days: [],
    },
  };
}

const T1 = new Date("2026-03-04T15:00:00Z");

/** What the database keeps per report, as far as these tests care. */
type Stored = StoredReport & { content: ProgressContent; overrides: Overrides; share_token: string; checked_by: string | null };

/** An in-memory stand-in for the table, with the two unique indexes the real one has. */
function fakeDatabase() {
  const rows: Stored[] = [];
  let seq = 0;
  const hooks: { beforeInsert?: () => void; beforeUpdate?: () => void } = {};
  const summary = (r: Stored | undefined): StoredReport | null =>
    r ? { id: r.id, produto: r.produto, period_start: r.period_start, period_end: r.period_end, status: r.status, rev: r.rev, pushed_at: r.pushed_at, checked_at: r.checked_at } : null;
  const calls: string[] = [];
  // What each write carried, as sent: the push time is not the application's to give (see below).
  const writes: Record<string, unknown>[] = [];
  // The database's clock: like the real table (migration 0025), it stamps pushed_at itself on every new
  // draft and every refresh of a draft's content, whatever the write carried.
  let dbClock = Date.parse("2026-03-04T12:00:00.000Z");
  const dbNow = () => new Date((dbClock += 1000)).toISOString();
  const store: ReportStore = {
    async findDraft(produto: Produto) {
      calls.push(`findDraft ${produto}`);
      return summary(rows.find((r) => r.produto === produto && r.status === "draft"));
    },
    async findLastSent(produto: Produto) {
      const sent = rows.filter((r) => r.produto === produto && r.status === "sent").sort((a, b) => Date.parse(b.period_end) - Date.parse(a.period_end));
      const r = sent[0];
      if (!r) return null;
      const entries = r.content.entries.map(({ id, status, hidden }) => ({ id, status, hidden }));
      return { ...(summary(r) as StoredReport), entries, overrides: r.overrides };
    },
    async findByPeriod(produto: Produto, periodStart: string) {
      calls.push(`findByPeriod ${periodStart}`);
      return summary(rows.find((r) => r.produto === produto && r.period_start === periodStart));
    },
    async insert(row: NewReport) {
      calls.push("insert");
      hooks.beforeInsert?.();
      if (rows.some((r) => r.produto === row.produto && (r.status === "draft" || r.period_start === row.period_start))) return null;
      writes.push({ ...row });
      seq += 1;
      rows.push({ ...row, pushed_at: dbNow(), id: `id-${seq}`, status: "draft", rev: 0, overrides: {}, share_token: `token-${seq}`, checked_at: null, checked_by: null } as Stored);
      return { id: `id-${seq}` };
    },
    async updateDraft(id: string, patch: DraftPatch) {
      calls.push("updateDraft");
      hooks.beforeUpdate?.();
      writes.push({ ...patch });
      const row = rows.find((r) => r.id === id && r.status === "draft");
      if (!row) return false;
      const changed = JSON.stringify(row.content) !== JSON.stringify(patch.content);
      Object.assign(row, patch, changed ? { pushed_at: dbNow() } : {});
      return true;
    },
  };
  const addSent = (periodStart: string, periodEnd: string, opts: { produto?: Produto; content?: ProgressContent; overrides?: Overrides } = {}) => {
    seq += 1;
    rows.push({
      id: `id-${seq}`, produto: opts.produto ?? "GeoCloud", period_start: new Date(periodStart).toISOString(), period_end: new Date(periodEnd).toISOString(), status: "sent",
      rev: 5, pushed_at: "2026-03-01T10:00:00.000Z", checked_at: "2026-03-01T11:00:00.000Z", content: opts.content ?? content(), overrides: opts.overrides ?? {}, share_token: `token-${seq}`, checked_by: "someone",
    });
    return rows[rows.length - 1];
  };
  return { rows, store, hooks, calls, writes, addSent };
}

test("the first push creates the draft", async () => {
  const db = fakeDatabase();
  const result = await ingestDraft(db.store, { produto: "GeoCloud", content: content() });
  assert.deepEqual(result, { status: 200, id: "id-1", created: true });
  assert.equal(db.rows.length, 1);
  const row = db.rows[0];
  assert.equal(row.status, "draft");
  assert.equal(row.produto, "GeoCloud");
  // The push time is the database's, never the clock of whoever pushed: the write does not carry one.
  assert.ok(!("pushed_at" in db.writes[0]));
  assert.equal(row.rev, 0);
  assert.deepEqual(row.content, content());
  // The period is stored as UTC instants, whatever offset the content was written with.
  assert.equal(row.period_start, "2026-03-02T03:00:00.000Z");
  assert.equal(row.period_end, "2026-03-04T03:00:00.000Z");
});

test("pushing again refreshes the draft and keeps what the user did to it", async () => {
  const db = fakeDatabase();
  await ingestDraft(db.store, { produto: "GeoCloud", content: content() });
  // Meanwhile the user edited a sentence and ticked "numbers checked".
  const row = db.rows[0];
  const firstPushedAt = row.pushed_at;
  row.overrides = { headline: { value: "Minha frase", base: "Duas entregas de exemplo foram concluídas." } };
  row.checked_at = "2026-03-04T16:00:00.000Z";
  row.checked_by = "a-user";
  const token = row.share_token;

  const next = content("Uma frase nova sugerida pelo Claude.", { start: WINDOW.start, end: "2026-03-05T00:00:00-03:00" });
  const result = await ingestDraft(db.store, { produto: "GeoCloud", content: next });

  assert.deepEqual(result, { status: 200, id: "id-1", created: false });
  assert.equal(db.rows.length, 1);
  assert.deepEqual(row.content, next);
  assert.ok(!("pushed_at" in db.writes[1]));
  assert.ok(Date.parse(row.pushed_at) > Date.parse(firstPushedAt));
  assert.equal(row.period_end, "2026-03-05T03:00:00.000Z");
  // The edits and the link of the image survive...
  assert.deepEqual(row.overrides, { headline: { value: "Minha frase", base: "Duas entregas de exemplo foram concluídas." } });
  assert.equal(row.share_token, token);
  // ...but the numbers have to be checked again, since they may have changed.
  assert.equal(row.checked_at, null);
  assert.equal(row.checked_by, null);
});

test("every push moves the revision up by one", async () => {
  const db = fakeDatabase();
  await ingestDraft(db.store, { produto: "GeoCloud", content: content() });
  assert.equal(db.rows[0].rev, 0);
  await ingestDraft(db.store, { produto: "GeoCloud", content: content() });
  assert.equal(db.rows[0].rev, 1);
  await ingestDraft(db.store, { produto: "GeoCloud", content: content() });
  assert.equal(db.rows[0].rev, 2);
});

test("sending the very same draft again changes nothing but the revision (and voids the check)", async () => {
  const db = fakeDatabase();
  const first = await ingestDraft(db.store, { produto: "GeoCloud", content: content() });
  const pushedAt = db.rows[0].pushed_at;
  db.rows[0].checked_at = "2026-03-04T16:00:00.000Z";
  db.rows[0].checked_by = "a-user";
  const again = await ingestDraft(db.store, { produto: "GeoCloud", content: content() });
  assert.equal(db.rows[0].checked_at, null);
  assert.equal(db.rows[0].rev, 1);
  // The database stamps a push only when the content changed: the very same content keeps its time.
  assert.equal(db.rows[0].pushed_at, pushedAt);
  assert.ok(!("pushed_at" in db.writes[1]));
  assert.equal(first.status === 200 && first.id, again.status === 200 && again.id);
  assert.equal(db.rows.length, 1);
  assert.deepEqual(db.rows[0].content, content());
  assert.equal(db.rows[0].share_token, "token-1");
});

test("a period that was already sent answers 409 and nothing is written", async () => {
  const db = fakeDatabase();
  db.addSent(WINDOW.start, WINDOW.end);
  const result = await ingestDraft(db.store, { produto: "GeoCloud", content: content() });
  assert.deepEqual(result, { status: 409, error: "period_already_sent" });
  assert.ok(!db.calls.includes("insert") && !db.calls.includes("updateDraft"));
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].status, "sent");
});

test("a sent period blocks the push even when there is a newer draft", async () => {
  const db = fakeDatabase();
  db.addSent("2026-02-27T00:00:00-03:00", WINDOW.start);
  await ingestDraft(db.store, { produto: "GeoCloud", content: content() });
  const draft = db.rows[1];
  const result = await ingestDraft(db.store, { produto: "GeoCloud", content: content("x", { start: "2026-02-27T00:00:00-03:00", end: WINDOW.start }) });
  assert.deepEqual(result, { status: 409, error: "period_already_sent" });
  assert.deepEqual(draft.content, content());
});

test("after a report is sent, the next push starts a new draft", async () => {
  const db = fakeDatabase();
  db.addSent(WINDOW.start, WINDOW.end);
  const result = await ingestDraft(db.store, { produto: "GeoCloud", content: content("Próximo período.", { start: WINDOW.end, end: "2026-03-06T00:00:00-03:00" }) });
  assert.deepEqual(result, { status: 200, id: "id-2", created: true });
  assert.equal(db.rows.length, 2);
});

test("if another push creates the draft first, this push is applied to that draft", async () => {
  const db = fakeDatabase();
  db.hooks.beforeInsert = () => {
    db.hooks.beforeInsert = undefined;
    db.rows.push({ id: "id-rival", produto: "GeoCloud", period_start: "2026-03-02T03:00:00.000Z", period_end: "2026-03-03T03:00:00.000Z", status: "draft", rev: 0, pushed_at: T1.toISOString(), checked_at: null, content: content("rival"), overrides: {}, share_token: "token-rival", checked_by: null });
  };
  const result = await ingestDraft(db.store, { produto: "GeoCloud", content: content("a minha") });
  assert.deepEqual(result, { status: 200, id: "id-rival", created: false });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].content.headline, "a minha");
});

test("if the draft gets sent between the read and the write, the push is refused, not written over it", async () => {
  const db = fakeDatabase();
  await ingestDraft(db.store, { produto: "GeoCloud", content: content() });
  db.hooks.beforeUpdate = () => {
    db.hooks.beforeUpdate = undefined;
    db.rows[0].status = "sent";
  };
  const result = await ingestDraft(db.store, { produto: "GeoCloud", content: content("tarde demais") });
  assert.deepEqual(result, { status: 409, error: "period_already_sent" });
  assert.deepEqual(db.rows[0].content, content());
});

test("it gives up with a clear answer when the race does not settle", async () => {
  const db = fakeDatabase();
  db.store.insert = async () => null; // the database keeps saying "already there", yet no draft is ever found
  const result = await ingestDraft(db.store, { produto: "GeoCloud", content: content() });
  assert.deepEqual(result, { status: 409, error: "concurrent_push" });
});

/* ---------- The request, as the route sees it ---------- */

const body = (c: ProgressContent = content()) => ({ produto: "GeoCloud", content: c });

test("a good request answers 200 with the id, whether it was created, and the link to the screen", async () => {
  const db = fakeDatabase();
  const out = await receiveDraft(db.store, body());
  assert.deepEqual(out, { status: 200, body: { id: "id-1", created: true, url: "https://roads-psi.vercel.app/resumo" } });
  const again = await receiveDraft(db.store, body());
  assert.deepEqual(again.body, { id: "id-1", created: false, url: "https://roads-psi.vercel.app/resumo" });
});

test("a bad request answers 400 with the reason and stores nothing", async () => {
  const db = fakeDatabase();
  const bad = body();
  bad.content.entries[0].status = "quase" as never;
  const out = await receiveDraft(db.store, bad);
  assert.equal(out.status, 400);
  assert.match((out.body as { error: string }).error, /content\.entries\[0\]\.status/);
  assert.equal(db.rows.length, 0);
  assert.deepEqual(db.calls, []);
});

test("a request for a period already sent answers 409", async () => {
  const db = fakeDatabase();
  db.addSent(WINDOW.start, WINDOW.end);
  const out = await receiveDraft(db.store, body());
  assert.deepEqual(out, { status: 409, body: { error: "period_already_sent" } });
});

test("the state starts the next window where the last sent report ended, and lists draft and last sent briefly", async () => {
  const db = fakeDatabase();
  const sent = db.addSent("2026-02-27T00:00:00-03:00", WINDOW.start);
  await ingestDraft(db.store, { produto: "GeoCloud", content: content() });
  const state = await reportState(db.store, "GeoCloud", new Date("2026-03-05T15:00:00Z"));
  assert.deepEqual(state.window, { start: sent.period_end, end: "2026-03-05T00:00:00-03:00" });
  assert.deepEqual(state.lastSent, {
    id: sent.id, period_start: sent.period_start, period_end: sent.period_end, pushed_at: sent.pushed_at, rev: 5, checked_at: sent.checked_at,
    entries: [{ id: "gc-101", status: "concluido" }],
  });
  assert.deepEqual(state.draft, {
    id: "id-2", period_start: "2026-03-02T03:00:00.000Z", period_end: "2026-03-04T03:00:00.000Z", pushed_at: db.rows.find((r) => r.id === "id-2")!.pushed_at, rev: 0, checked_at: null,
  });
  // Nothing else about the reports leaks: no content, edits or link token.
  assert.deepEqual(Object.keys(state.draft ?? {}).sort(), ["checked_at", "id", "period_end", "period_start", "pushed_at", "rev"]);
});

test("with nothing sent yet the window is the first one, and there may be no draft", async () => {
  const db = fakeDatabase();
  const state = await reportState(db.store, "GeoCloud", new Date("2026-10-01T15:00:00Z"));
  assert.deepEqual(state, { window: { start: "2026-09-28T00:00:00-03:00", end: "2026-10-01T00:00:00-03:00" }, draft: null, lastSent: null });
});

/* ---------- What the last sent report already told the board ---------- */

/** A content whose entries are given as [id, status, hidden?]. */
function contentWith(entries: [string, EntryStatus, boolean?][]): ProgressContent {
  const base = content();
  base.entries = entries.map(([id, status, hidden = false], i) => ({ ...base.entries[0], id, issue: 200 + i, status, hidden }));
  return base;
}

const NOW = new Date("2026-03-05T15:00:00Z");

test("the state lists the entries the last sent report carried, so the next one does not repeat them", async () => {
  const db = fakeDatabase();
  db.addSent("2026-02-27T00:00:00-03:00", WINDOW.start, {
    content: contentWith([["a", "concluido"], ["b", "em_validacao"], ["c", "concluido", true]]),
  });
  const state = await reportState(db.store, "GeoCloud", NOW);
  // The hidden one was never in the e-mail, so it is not "already reported".
  assert.deepEqual(state.lastSent?.entries, [{ id: "a", status: "concluido" }, { id: "b", status: "em_validacao" }]);
});

test("what the user edited counts: an edited status wins, and hiding or showing an entry wins either way", () => {
  const entries = [
    { id: "a", status: "concluido" as const, hidden: false },
    { id: "b", status: "em_validacao" as const, hidden: false },
    { id: "c", status: "concluido" as const, hidden: true },
  ];
  const overrides: Overrides = {
    "entry:b:status": { value: "concluido", base: "em_validacao" },
    "entry:a:hidden": { value: true },
    "entry:c:hidden": { value: false },
  };
  assert.deepEqual(reportedEntries({ entries, overrides }), [
    { id: "b", status: "concluido" },
    { id: "c", status: "concluido" },
  ]);
});

test("an edit that makes no sense is ignored, and so is an edit of an entry that is not there", () => {
  const entries = [{ id: "a", status: "concluido" as const, hidden: false }];
  const overrides: Overrides = {
    "entry:a:status": { value: "inventado" },
    "entry:a:hidden": { value: "sim" },
    "entry:zzz:status": { value: "bloqueado" },
    "entry:zzz:hidden": { value: false },
    headline: { value: "outra frase" },
  };
  assert.deepEqual(reportedEntries({ entries, overrides }), [{ id: "a", status: "concluido" }]);
});

test("with no sent report there is nothing already reported", async () => {
  assert.deepEqual(reportedEntries(null), []);
  const db = fakeDatabase();
  await ingestDraft(db.store, { produto: "GeoCloud", content: content() });
  const state = await reportState(db.store, "GeoCloud", NOW);
  assert.equal(state.lastSent, null);
});

test("the entries come from the LAST sent report, not an older one", async () => {
  const db = fakeDatabase();
  db.addSent("2026-02-20T00:00:00-03:00", "2026-02-27T00:00:00-03:00", { content: contentWith([["old", "concluido"]]) });
  db.addSent("2026-02-27T00:00:00-03:00", WINDOW.start, { content: contentWith([["recent", "em_andamento"]]) });
  const state = await reportState(db.store, "GeoCloud", NOW);
  assert.deepEqual(state.lastSent?.entries, [{ id: "recent", status: "em_andamento" }]);
});

/* ---------- The cadence: Wednesday and Friday, at the end of the day ---------- */

test("on a send day the window takes in that day up to now; on any other day it stops at 00:00", async () => {
  const db = fakeDatabase();
  const lastEnd = "2026-03-02T00:00:00-03:00"; // a Monday
  db.addSent("2026-02-27T00:00:00-03:00", lastEnd);
  const windowAt = async (at: string) => (await reportState(db.store, "GeoCloud", new Date(at))).window;

  const wednesdayEvening = "2026-03-04T22:30:00Z"; // 19:30 in São Paulo
  assert.deepEqual(await windowAt(wednesdayEvening), { start: new Date(lastEnd).toISOString(), end: new Date(wednesdayEvening).toISOString() });

  const fridayEvening = "2026-03-06T21:00:00Z";
  assert.equal((await windowAt(fridayEvening)).end, new Date(fridayEvening).toISOString());

  // Thursday (a late report, or one prepared the next morning): yesterday is complete, today waits.
  assert.equal((await windowAt("2026-03-05T21:00:00Z")).end, "2026-03-05T00:00:00-03:00");
  assert.equal((await windowAt("2026-03-03T21:00:00Z")).end, "2026-03-03T00:00:00-03:00"); // Tuesday
});
