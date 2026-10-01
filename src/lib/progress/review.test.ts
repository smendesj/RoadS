import { test } from "node:test";
import assert from "node:assert/strict";
import type { Overrides, ProgressContent, UsageModel } from "../progress-report.ts";
import {
  applyEdit,
  isChecked,
  markSent,
  editorAccess,
  saveEdit,
  setChecked,
  type Actor,
  type ReviewPatch,
  type ReviewPorts,
  type ReviewRow,
} from "./review.ts";

const usage: UsageModel = {
  scope: "GeoCloud",
  window: { start: "2026-01-05T00:00:00-03:00", end: "2026-01-07T00:00:00-03:00" },
  generatedAt: "2026-01-07T09:00:00-03:00",
  totals: { sessions: 0, messages: 0, activeDays: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  byModel: [],
  favoriteModel: null,
  peakHour: null,
  days: [],
};

const content: ProgressContent = {
  window: usage.window,
  headline: "Semana de exemplo.",
  entries: [
    {
      id: "gc-1",
      issue: 1,
      status: "em_andamento",
      title: "Título um",
      summary: "Resumo de gc-1.",
      deliveredAt: null,
      subIssues: null,
      hidden: false,
      edited: false,
      sources: [],
    },
  ],
  internal: { count: 1, text: "Uma melhoria interna." },
  difficulties: [{ id: "d1", text: "Uma dificuldade.", needs: "Uma decisão." }],
  nextSteps: [{ id: "n1", text: "Um passo." }],
  usage,
};

const ID = "0b9f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4";
const PUSHED = "2026-01-07T10:00:00Z";

const draft = (over: Partial<ReviewRow> = {}): ReviewRow => ({
  id: ID,
  status: "draft",
  rev: 4,
  content,
  overrides: {},
  checked_at: null,
  pushed_at: PUSHED,
  ...over,
});

/* ---------- applyEdit ---------- */

test("a valid edit is stored with the pushed text as its base, and the rest is left alone", () => {
  const before: Overrides = { headline: { value: "Outra abertura.", base: "Antiga." } };
  const frozen = Object.freeze({ ...before });
  const out = applyEdit(frozen, "entry:gc-1:summary", "Minha frase.", "Resumo de gc-1.");
  assert.deepEqual(out, {
    overrides: {
      headline: { value: "Outra abertura.", base: "Antiga." },
      "entry:gc-1:summary": { value: "Minha frase.", base: "Resumo de gc-1." },
    },
    warnings: [],
  });
  assert.deepEqual(before, { headline: { value: "Outra abertura.", base: "Antiga." } });
});

test("saving again replaces the earlier edit and refreshes its base ('keep my version')", () => {
  const out = applyEdit({ "entry:gc-1:summary": { value: "Minha frase.", base: "Texto antigo." } }, "entry:gc-1:summary", "Minha frase.", "Texto novo.");
  assert.deepEqual(out, { overrides: { "entry:gc-1:summary": { value: "Minha frase.", base: "Texto novo." } }, warnings: [] });
});

test("text is tidied: edges trimmed, blanks and line breaks collapsed, control characters dropped", () => {
  const out = applyEdit({}, "headline", "  Uma\n\nfrase   com\tespaços\u0007 soltos.  ", "x");
  assert.ok(!("error" in out));
  assert.equal(out.overrides.headline.value, "Uma frase com espaços soltos.");
});

test("a text key takes text only", () => {
  for (const wrong of [42, null, undefined, true, { a: 1 }, ["x"]]) {
    assert.deepEqual(applyEdit({}, "entry:gc-1:summary", wrong, "x"), { error: "invalid_value" }, JSON.stringify(wrong));
  }
});

test("a yes/no key takes a boolean only, and keeps no base", () => {
  assert.deepEqual(applyEdit({}, "entry:gc-1:hidden", true, "x"), { overrides: { "entry:gc-1:hidden": { value: true } }, warnings: [] });
  assert.deepEqual(applyEdit({}, "difficulty:d1:hidden", false, "x"), { overrides: { "difficulty:d1:hidden": { value: false } }, warnings: [] });
  for (const wrong of ["true", "sim", 1, 0, null, undefined]) {
    assert.deepEqual(applyEdit({}, "nextStep:n1:hidden", wrong, "x"), { error: "invalid_value" }, JSON.stringify(wrong));
  }
});

test("the status is one of the five, never an invented one or a label", () => {
  for (const ok of ["concluido", "em_validacao", "em_andamento", "bloqueado", "proximo"]) {
    assert.deepEqual(applyEdit({}, "entry:gc-1:status", ok, "em_andamento"), {
      overrides: { "entry:gc-1:status": { value: ok, base: "em_andamento" } },
      warnings: [],
    });
  }
  for (const wrong of ["quase_pronto", "Concluído", "", "CONCLUIDO"]) {
    assert.deepEqual(applyEdit({}, "entry:gc-1:status", wrong, "x"), { error: "invalid_status" }, wrong);
  }
  assert.deepEqual(applyEdit({}, "entry:gc-1:status", 3, "x"), { error: "invalid_value" });
});

test("limits: a title up to 80, a sentence up to 280, the headline up to 320", () => {
  const cases: [string, number][] = [
    ["entry:gc-1:title", 80],
    ["entry:gc-1:summary", 280],
    ["internal", 280],
    ["difficulty:d1:text", 280],
    ["difficulty:d1:needs", 280],
    ["nextStep:n1:text", 280],
    ["headline", 320],
  ];
  for (const [key, max] of cases) {
    assert.ok(!("error" in applyEdit({}, key, "a".repeat(max), "x")), `${key} accepts ${max}`);
    assert.deepEqual(applyEdit({}, key, "a".repeat(max + 1), "x"), { error: "too_long" }, `${key} refuses ${max + 1}`);
  }
});

test("the limits count characters, not bytes: accents and emoji are one each", () => {
  assert.ok(!("error" in applyEdit({}, "entry:gc-1:title", "é".repeat(80), "x")));
  assert.ok(!("error" in applyEdit({}, "entry:gc-1:title", "😀".repeat(80), "x")));
  assert.deepEqual(applyEdit({}, "entry:gc-1:title", "😀".repeat(81), "x"), { error: "too_long" });
});

test("a blank text is refused where the e-mail needs the line, and allowed where clearing removes it", () => {
  for (const key of ["headline", "entry:gc-1:title", "entry:gc-1:summary", "difficulty:d1:text", "nextStep:n1:text"]) {
    assert.deepEqual(applyEdit({}, key, "   \n ", "x"), { error: "empty" }, key);
  }
  for (const key of ["internal", "difficulty:d1:needs"]) {
    assert.deepEqual(applyEdit({}, key, "  ", "x"), { overrides: { [key]: { value: "", base: "x" } }, warnings: [] }, key);
  }
});

test("a key outside the contract is refused", () => {
  for (const key of ["", "foo", "entry:gc-1:colour", "entry:gc-1", "headline:x", "nextStep:n1:needs", "__proto__", "constructor", "entry:a b:title"]) {
    assert.deepEqual(applyEdit({}, key, "texto", "x"), { error: "invalid_key" }, JSON.stringify(key));
  }
  assert.deepEqual(applyEdit({}, 42 as unknown as string, "texto", "x"), { error: "invalid_key" });
});

test("the plain-language warnings come back with the saved edit", () => {
  const out = applyEdit({}, "entry:gc-1:summary", "Corrigimos um bug no endpoint (#123).", "x");
  assert.ok(!("error" in out));
  assert.deepEqual(out.warnings.map((w) => w.code), ["jargao", "jargao", "numero_de_issue"]);
  assert.equal(out.overrides["entry:gc-1:summary"].value, "Corrigimos um bug no endpoint (#123).", "a warning never blocks the edit");
});

test("a headline between 281 and 320 characters is saved, with a nudge that it is long", () => {
  const out = applyEdit({}, "headline", "a ".repeat(150), "x"); // 299 characters once tidied
  assert.ok(!("error" in out));
  assert.deepEqual(out.warnings.map((w) => w.code), ["muito_longo"]);
  assert.equal(String(out.overrides.headline.value).length, 299);
});

test("a status or a switch is never judged as a sentence", () => {
  const status = applyEdit({}, "entry:gc-1:status", "bloqueado", "endpoint");
  const flag = applyEdit({}, "entry:gc-1:hidden", true, "endpoint");
  assert.ok(!("error" in status) && !("error" in flag));
  assert.deepEqual([status.warnings, flag.warnings], [[], []]);
});

/* ---------- who may review ---------- */

const who = (over: Partial<Actor>): Actor => ({ userId: "u1", role: "admin", mustResetPassword: false, ...over });

test("only an admin may edit the report: the scrum master (who can read it) may not", () => {
  assert.deepEqual(editorAccess(who({ role: "admin" })), { ok: true, userId: "u1" });
  assert.deepEqual(editorAccess(who({ role: "scrum_master" })), { ok: false, reason: "forbidden" });
});

test("nobody signed in is turned away", () => {
  assert.deepEqual(editorAccess(who({ userId: null, role: "admin" })), { ok: false, reason: "unauthenticated" });
  assert.deepEqual(editorAccess(who({ userId: "" })), { ok: false, reason: "unauthenticated" });
});

test("a dev, or an account whose role is missing or unknown, is turned away too", () => {
  for (const role of ["dev", null, undefined, "", "owner", "ADMIN", "Admin", " admin"]) {
    assert.deepEqual(editorAccess(who({ role })), { ok: false, reason: "forbidden" }, String(role));
  }
});

test("someone who still has to choose a new password is turned away, even an admin", () => {
  assert.deepEqual(editorAccess(who({ role: "admin", mustResetPassword: true })), { ok: false, reason: "must_reset_password" });
  assert.equal(editorAccess(who({ role: "scrum_master", mustResetPassword: true })).ok, false);
  assert.equal(editorAccess(who({ role: "dev", mustResetPassword: true })).ok, false);
});

test("a missing or null reset flag means no reset is pending", () => {
  assert.equal(editorAccess(who({ mustResetPassword: null })).ok, true);
  assert.equal(editorAccess(who({ mustResetPassword: undefined })).ok, true);
});

/* ---------- "números conferidos" ---------- */

test("the numbers count as checked only while the check is not older than the last push", () => {
  assert.equal(isChecked({ checked_at: null, pushed_at: PUSHED }), false);
  assert.equal(isChecked({ checked_at: "2026-01-07T10:30:00Z", pushed_at: PUSHED }), true);
  assert.equal(isChecked({ checked_at: PUSHED, pushed_at: PUSHED }), true);
  assert.equal(isChecked({ checked_at: "2026-01-07T09:59:59Z", pushed_at: PUSHED }), false, "a push after the check cancels it");
  assert.equal(isChecked({ checked_at: "2026-01-07T07:30:00-03:00", pushed_at: "2026-01-07T10:00:00+00:00" }), true, "offsets are compared as instants");
  assert.equal(isChecked({ checked_at: "not a date", pushed_at: PUSHED }), false);
});

/* ---------- the three actions, with the database faked ---------- */

const ADMIN = who({ role: "admin" });
const SCRUM = who({ role: "scrum_master" });
const DEV = who({ role: "dev" });

function fake(opts: { actor?: Actor; row?: ReviewRow | null; raceLost?: boolean; failOn?: "actor" | "load" | "update" } = {}) {
  const calls = { loads: [] as string[], writes: [] as { id: string; rev: number; patch: ReviewPatch }[], errors: [] as unknown[] };
  const ports: ReviewPorts = {
    getActor: async () => {
      if (opts.failOn === "actor") throw new Error("SENTINEL-actor-down");
      return opts.actor ?? ADMIN;
    },
    loadReport: async (id) => {
      calls.loads.push(id);
      if (opts.failOn === "load") throw new Error("SENTINEL-load-down");
      return opts.row === undefined ? draft() : opts.row;
    },
    updateReport: async (id, rev, patch) => {
      calls.writes.push({ id, rev, patch });
      if (opts.failOn === "update") throw new Error("SENTINEL-update-down");
      return opts.raceLost ? null : { rev: rev + 1 };
    },
    now: () => new Date("2026-01-07T15:00:00Z"),
    onError: (e) => calls.errors.push(e),
  };
  return { ports, calls };
}

const save = (over: Record<string, unknown> = {}) => ({ id: ID, rev: 4, key: "entry:gc-1:summary", value: "Minha frase.", ...over });
const check = (over: Record<string, unknown> = {}) => ({ id: ID, rev: 4, checked: true, ...over });
const send = (over: Record<string, unknown> = {}) => ({ id: ID, rev: 4, ...over });

type Flow = [name: string, run: (ports: ReviewPorts) => Promise<unknown>];
const FLOWS: Flow[] = [
  ["saveEdit", (p) => saveEdit(save(), p)],
  ["setChecked", (p) => setChecked(check(), p)],
  ["markSent", (p) => markSent(send(), p)],
];

test("every action turns away nobody-signed-in, scrum masters, devs and pending resets before reading or writing anything", async () => {
  const refused: [string, Actor, string][] = [
    ["anonymous", who({ userId: null, role: null }), "unauthenticated"],
    ["scrum master", SCRUM, "forbidden"],
    ["dev", DEV, "forbidden"],
    ["profile without a role", who({ role: null }), "forbidden"],
    ["admin who must reset the password", who({ role: "admin", mustResetPassword: true }), "must_reset_password"],
  ];
  for (const [name, run] of FLOWS) {
    for (const [label, actor, reason] of refused) {
      const { ports, calls } = fake({ actor, row: draft({ checked_at: "2026-01-07T11:00:00Z" }) });
      assert.deepEqual(await run(ports), { ok: false, reason }, `${name} as ${label}`);
      assert.deepEqual(calls.loads, [], `${name} as ${label} read nothing`);
      assert.deepEqual(calls.writes, [], `${name} as ${label} wrote nothing`);
    }
  }
});

test("every action works for an admin", async () => {
  for (const [name, run] of FLOWS) {
    const { ports } = fake({ actor: ADMIN, row: draft({ checked_at: "2026-01-07T11:00:00Z", rev: 4 }) });
    const out = (await run(ports)) as { ok: boolean };
    assert.equal(out.ok, true, name);
  }
});

test("every action refuses malformed references without touching the database", async () => {
  for (const bad of [{ id: "not-a-uuid" }, { id: 42 }, { id: undefined }, { rev: -1 }, { rev: 1.5 }, { rev: "4" }, { rev: Number.NaN }, { rev: undefined }]) {
    for (const input of [save(bad), check(bad), send(bad)]) {
      const flow = "key" in input ? saveEdit(input, fake().ports) : "checked" in input ? setChecked(input, fake().ports) : markSent(input, fake().ports);
      assert.deepEqual(await flow, { ok: false, reason: "invalid" }, JSON.stringify(bad));
    }
  }
  const { ports, calls } = fake();
  await saveEdit(save({ id: "../../etc/passwd" }), ports);
  assert.deepEqual(calls.loads, []);
});

test("every action says so when the report is not there", async () => {
  for (const [name, run] of FLOWS) {
    const { ports, calls } = fake({ row: null });
    assert.deepEqual(await run(ports), { ok: false, reason: "not_found" }, name);
    assert.deepEqual(calls.writes, [], name);
  }
});

test("a sent report is frozen: no action changes it, whatever the revision", async () => {
  for (const [name, run] of FLOWS) {
    const { ports, calls } = fake({ row: draft({ status: "sent", checked_at: "2026-01-07T11:00:00Z" }) });
    assert.deepEqual(await run(ports), { ok: false, reason: "sent" }, name);
    assert.deepEqual(calls.writes, [], name);
  }
  const { ports } = fake({ row: draft({ status: "sent", rev: 9 }) });
  assert.deepEqual(await saveEdit(save({ rev: 4 }), ports), { ok: false, reason: "sent" });
});

test("a revision that does not match means the screen is out of date: nothing is written", async () => {
  for (const [name, run] of FLOWS) {
    const { ports, calls } = fake({ row: draft({ rev: 5, checked_at: "2026-01-07T11:00:00Z" }) });
    assert.deepEqual(await run(ports), { ok: false, reason: "stale" }, name);
    assert.deepEqual(calls.writes, [], name);
  }
});

test("losing the race between reading and writing is also 'stale'", async () => {
  for (const [name, run] of FLOWS) {
    const { ports } = fake({ raceLost: true, row: draft({ checked_at: name === "setChecked" ? null : "2026-01-07T11:00:00Z" }) });
    assert.deepEqual(await run(ports), { ok: false, reason: "stale" }, name);
  }
});

test("a database failure is answered as 'unavailable' with none of its details", async () => {
  for (const [name, run] of FLOWS) {
    for (const failOn of ["actor", "load", "update"] as const) {
      const { ports, calls } = fake({ failOn, row: draft({ checked_at: name === "setChecked" ? null : "2026-01-07T11:00:00Z" }) });
      const out = await run(ports);
      assert.deepEqual(out, { ok: false, reason: "unavailable" }, `${name} failing on ${failOn}`);
      assert.ok(!JSON.stringify(out).includes("SENTINEL"));
      assert.equal(calls.errors.length, 1, "the real error still reaches the server log");
    }
  }
});

/* saveEdit */

test("saving an edit writes the merged edits against the revision it was based on", async () => {
  const existing: Overrides = { headline: { value: "Minha abertura.", base: "Semana de exemplo." } };
  const { ports, calls } = fake({ row: draft({ overrides: existing }) });
  const out = await saveEdit(save(), ports);
  assert.deepEqual(out, { ok: true, rev: 5, warnings: [] });
  assert.deepEqual(calls.writes, [
    {
      id: ID,
      rev: 4,
      patch: {
        overrides: {
          headline: { value: "Minha abertura.", base: "Semana de exemplo." },
          "entry:gc-1:summary": { value: "Minha frase.", base: "Resumo de gc-1." },
        },
      },
    },
  ]);
});

test("the pushed text kept as the base comes from the stored report, never from the caller", async () => {
  const { ports, calls } = fake();
  await saveEdit({ ...save(), base: "texto forjado", pushedText: "texto forjado" }, ports);
  assert.deepEqual((calls.writes[0].patch as { overrides: Overrides }).overrides["entry:gc-1:summary"], { value: "Minha frase.", base: "Resumo de gc-1." });
});

test("saving returns the language warnings and still saves", async () => {
  const { ports, calls } = fake();
  const out = (await saveEdit(save({ value: "Ajustamos o endpoint." }), ports)) as { ok: true; warnings: { code: string }[] };
  assert.equal(out.ok, true);
  assert.deepEqual(out.warnings.map((w) => w.code), ["jargao"]);
  assert.equal(calls.writes.length, 1);
});

test("an edit that points at an entry that does not exist is refused", async () => {
  const { ports, calls } = fake();
  assert.deepEqual(await saveEdit(save({ key: "entry:gc-9:summary" }), ports), { ok: false, reason: "invalid_key" });
  assert.deepEqual(await saveEdit(save({ key: "difficulty:zz:hidden", value: true }), ports), { ok: false, reason: "invalid_key" });
  assert.deepEqual(calls.writes, []);
});

test("a bad key, value or status is refused with its reason, and nothing is written", async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ key: "nope" }, "invalid_key"],
    [{ key: 7 }, "invalid_key"],
    [{ value: 7 }, "invalid_value"],
    [{ key: "entry:gc-1:hidden", value: "sim" }, "invalid_value"],
    [{ key: "entry:gc-1:title", value: "t".repeat(81) }, "too_long"],
    [{ key: "entry:gc-1:status", value: "quase_pronto" }, "invalid_status"],
    [{ value: "   " }, "empty"],
  ];
  for (const [over, reason] of cases) {
    const { ports, calls } = fake();
    assert.deepEqual(await saveEdit(save(over), ports), { ok: false, reason }, JSON.stringify(over));
    assert.deepEqual(calls.writes, [], JSON.stringify(over));
  }
});

/* setChecked */

test("ticking 'números conferidos' stamps the moment; the database keeps the real stamp", async () => {
  const { ports, calls } = fake();
  assert.deepEqual(await setChecked(check(), ports), { ok: true, rev: 5 });
  assert.deepEqual(calls.writes, [{ id: ID, rev: 4, patch: { checked_at: "2026-01-07T15:00:00.000Z" } }]);
});

test("unticking clears the check", async () => {
  const { ports, calls } = fake({ row: draft({ checked_at: "2026-01-07T11:00:00Z" }) });
  assert.deepEqual(await setChecked(check({ checked: false }), ports), { ok: true, rev: 5 });
  assert.deepEqual(calls.writes[0].patch, { checked_at: null });
});

test("asking for the state it already has writes nothing", async () => {
  const checked = fake({ row: draft({ checked_at: "2026-01-07T11:00:00Z" }) });
  assert.deepEqual(await setChecked(check({ checked: true }), checked.ports), { ok: true, rev: 4 });
  const unchecked = fake();
  assert.deepEqual(await setChecked(check({ checked: false }), unchecked.ports), { ok: true, rev: 4 });
  assert.deepEqual([...checked.calls.writes, ...unchecked.calls.writes], []);
});

test("after a new push the old check no longer counts, so ticking again writes", async () => {
  const { ports, calls } = fake({ row: draft({ checked_at: "2026-01-07T09:00:00Z" }) });
  assert.deepEqual(await setChecked(check({ checked: true }), ports), { ok: true, rev: 5 });
  assert.equal(calls.writes.length, 1);
});

test("the check must be a real yes or no", async () => {
  for (const checked of ["true", 1, null, undefined]) {
    const { ports, calls } = fake();
    assert.deepEqual(await setChecked(check({ checked }), ports), { ok: false, reason: "invalid" }, String(checked));
    assert.deepEqual(calls.writes, []);
  }
});

/* markSent */

test("marking as sent needs the numbers checked first", async () => {
  const { ports, calls } = fake();
  assert.deepEqual(await markSent(send(), ports), { ok: false, reason: "not_checked" });
  assert.deepEqual(calls.writes, []);
});

test("a new push cancels the check, so a report checked before it cannot be marked as sent", async () => {
  const { ports, calls } = fake({ row: draft({ checked_at: "2026-01-07T09:59:59Z", pushed_at: PUSHED }) });
  assert.deepEqual(await markSent(send(), ports), { ok: false, reason: "not_checked" });
  assert.deepEqual(calls.writes, []);
});

test("a checked report is marked as sent, once, against its revision", async () => {
  const { ports, calls } = fake({ row: draft({ checked_at: "2026-01-07T11:00:00Z" }) });
  assert.deepEqual(await markSent(send(), ports), { ok: true, rev: 5 });
  assert.deepEqual(calls.writes, [{ id: ID, rev: 4, patch: { status: "sent" } }]);
});

test("an out-of-date screen hears 'stale' before anything about the check", async () => {
  const { ports } = fake({ row: draft({ rev: 6 }) });
  assert.deepEqual(await markSent(send(), ports), { ok: false, reason: "stale" });
});
