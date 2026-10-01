// Permission audit at the database seam: every role (and anonymous) against every table, through the
// public PostgREST API with real JWTs, plus the e-mail domain rule on signup.
//
//   npm run audit:rls
//
// Runs against the project in .env.local (the live one) with the test accounts in .env.test-account
// (ROADS_TEST_*, ROADS_TEST_SM_* and ROADS_TEST_DEV_*: an admin, a scrum_master and a dev). Fixtures
// are throwaway lanes "zz-test-*" and throwaway auth users "roads-audit-*", all removed in `finally`.
// Prints counts and verdicts only, never row contents. Exits 1 on any HOLE (something is allowed that
// the permission model forbids) or BROKEN (something the model allows is refused).
//
// The model it encodes: anonymous reads nothing; a dev reads and can only set their own avatar; a
// scrum_master writes items they own (plus priority/effort/lane on seeded ones) and notes as
// scrum_master; an admin does everything except hand out or take away the admin role; lanes are
// admin-only; only company e-mail domains can have an account.
//
// The reports for the board (progress_reports) are read and edited by the admin, read by a scrum_master
// only once sent, created and refreshed only by the ingest route (service role), and frozen once sent.
// Their fixtures are ELIMS reports in 2099, marked content.zz_test, so the real GeoCloud rows are never
// touched.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const { NEXT_PUBLIC_SUPABASE_URL: URL_, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ANON, SUPABASE_SECRET_KEY: SECRET } = process.env;

let credText;
try {
  credText = readFileSync(".env.test-account", "utf8");
} catch {
  console.error("Missing .env.test-account (the RoadS Tester credentials). See the README, section Testes.");
  process.exit(2);
}
const cred = (key) => credText.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1].trim();

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(URL_, SECRET, opts);
const mk = () => createClient(URL_, ANON, opts);

async function signIn(prefix) {
  const c = mk();
  const { data, error } = await c.auth.signInWithPassword({ email: cred(`${prefix}_EMAIL`), password: cred(`${prefix}_PASSWORD`) });
  if (error) throw new Error(`login ${prefix}: ${error.message}`);
  return { c, id: data.user.id };
}

const results = [];
const warnings = []; // dashboard settings the audit can see but code can't fix: shown, never fail the run
// expected "deny": a HOLE if it succeeds. expected "allow": BROKEN if it fails.
async function check(who, what, expected, fn) {
  let actual;
  let detail = "";
  try {
    const r = await fn();
    actual = r.ok ? "allowed" : "denied";
    detail = r.detail ?? "";
  } catch (e) {
    actual = "denied";
    detail = String(e.message ?? e).slice(0, 90);
  }
  const verdict = expected === "allow" ? (actual === "allowed" ? "ok" : "BROKEN") : actual === "denied" ? "ok" : "HOLE";
  results.push({ who, what, expected, actual, verdict, detail });
}

const rows = (res) => ({
  ok: !res.error && Array.isArray(res.data) && res.data.length > 0,
  detail: res.error ? res.error.message.slice(0, 90) : `${res.data?.length ?? 0} row(s)`,
});

const [dev, sm, adm] = await Promise.all([signIn("ROADS_TEST_DEV"), signIn("ROADS_TEST_SM"), signIn("ROADS_TEST")]);
const anon = mk();
const startedAt = new Date().toISOString();
let exitCode = 0;

try {
  // ---------- fixtures (service role)
  await svc.from("lanes").delete().like("id", "zz-test-%");
  await svc.from("lanes").insert([
    { id: "zz-test-a", title: "[TESTE] lane A — apagar", kind: "group", sort_order: 990 },
    { id: "zz-test-b", title: "[TESTE] lane B — apagar", kind: "group", sort_order: 991 },
  ]);
  const item = async (row) =>
    (await svc.from("roadmap_items").insert({ lane_id: "zz-test-a", title: "[TESTE] item", description: "d", ...row }).select("id").single()).data.id;
  const S = await item({ title: "[TESTE] seeded-like", created_by: null });
  const S2 = await item({ title: "[TESTE] seeded-like 2", created_by: null });
  const A = await item({ title: "[TESTE] admin item", created_by: adm.id });
  const A2 = await item({ title: "[TESTE] admin item 2", created_by: adm.id });
  const M = await item({ title: "[TESTE] sm item", created_by: sm.id });
  const M2 = await item({ title: "[TESTE] sm item 2", created_by: sm.id });

  // ===================== ANONYMOUS
  for (const t of ["lanes", "roadmap_items", "item_notes", "profiles", "roadmap_sync_queue", "board_sync_state"]) {
    await check("anon", `read ${t}`, "deny", async () => rows(await anon.from(t).select("id").limit(1)));
  }
  await check("anon", "insert roadmap_items", "deny", async () => rows(await anon.from("roadmap_items").insert({ lane_id: "zz-test-a", title: "x", created_by: null }).select("id")));
  await check("anon", "update roadmap_items", "deny", async () => rows(await anon.from("roadmap_items").update({ prioridade: "High" }).eq("id", A).select("id")));
  await check("anon", "delete roadmap_items", "deny", async () => rows(await anon.from("roadmap_items").delete().eq("id", A).select("id")));
  await check("anon", "insert lanes", "deny", async () => rows(await anon.from("lanes").insert({ id: "zz-test-anon", title: "x", kind: "group" }).select("id")));
  await check("anon", "insert item_notes", "deny", async () => rows(await anon.from("item_notes").insert({ item_id: A, author_id: dev.id, author_role: "dev", body: "x" }).select("id")));
  await check("anon", "update profiles", "deny", async () => rows(await anon.from("profiles").update({ avatar: "avatar-01" }).eq("id", dev.id).select("id")));

  // ===================== DEV (read-only)
  await check("dev", "read lanes", "allow", async () => rows(await dev.c.from("lanes").select("id").limit(1)));
  await check("dev", "read roadmap_items", "allow", async () => rows(await dev.c.from("roadmap_items").select("id").eq("id", A)));
  await check("dev", "read item_notes", "allow", async () => ({ ok: !(await dev.c.from("item_notes").select("id").limit(1)).error }));
  await check("dev", "read board_sync_state", "allow", async () => rows(await dev.c.from("board_sync_state").select("id").limit(1)));
  await check("dev", "read OTHER profiles", "deny", async () => rows(await dev.c.from("profiles").select("id").neq("id", dev.id)));
  await check("dev", "read own profile", "allow", async () => rows(await dev.c.from("profiles").select("id").eq("id", dev.id)));
  await check("dev", "read roadmap_sync_queue", "deny", async () => rows(await dev.c.from("roadmap_sync_queue").select("id").limit(1)));
  await check("dev", "insert roadmap_items", "deny", async () => rows(await dev.c.from("roadmap_items").insert({ lane_id: "zz-test-a", title: "[TESTE] dev", created_by: dev.id }).select("id")));
  await check("dev", "update seeded item", "deny", async () => rows(await dev.c.from("roadmap_items").update({ prioridade: "Critical" }).eq("id", S).select("id")));
  await check("dev", "update sm item", "deny", async () => rows(await dev.c.from("roadmap_items").update({ prioridade: "Critical" }).eq("id", M).select("id")));
  await check("dev", "delete sm item", "deny", async () => rows(await dev.c.from("roadmap_items").delete().eq("id", M).select("id")));
  await check("dev", "insert note (as dev)", "deny", async () => rows(await dev.c.from("item_notes").insert({ item_id: M, author_id: dev.id, author_role: "dev", body: "[TESTE] nota de dev" }).select("id")));
  await check("dev", "insert note spoofing scrum_master", "deny", async () => rows(await dev.c.from("item_notes").insert({ item_id: M, author_id: dev.id, author_role: "scrum_master", body: "[TESTE] nota forjada" }).select("id")));
  await check("dev", "insert note as another author", "deny", async () => rows(await dev.c.from("item_notes").insert({ item_id: M, author_id: adm.id, author_role: "admin", body: "[TESTE] forjada" }).select("id")));
  await check("dev", "promote self to scrum_master", "deny", async () => rows(await dev.c.from("profiles").update({ role: "scrum_master" }).eq("id", dev.id).select("id")));
  await check("dev", "promote self to admin", "deny", async () => rows(await dev.c.from("profiles").update({ role: "admin" }).eq("id", dev.id).select("id")));
  await check("dev", "change OTHER profile avatar", "deny", async () => rows(await dev.c.from("profiles").update({ avatar: "avatar-01" }).eq("id", sm.id).select("id")));
  await check("dev", "set own avatar", "allow", async () => rows(await dev.c.from("profiles").update({ avatar: "avatar-02" }).eq("id", dev.id).select("id")));
  await check("dev", "insert lane", "deny", async () => rows(await dev.c.from("lanes").insert({ id: "zz-test-dev", title: "x", kind: "group" }).select("id")));
  await check("dev", "update lane", "deny", async () => rows(await dev.c.from("lanes").update({ title: "[TESTE] hacked" }).eq("id", "zz-test-a").select("id")));
  await check("dev", "delete lane", "deny", async () => rows(await dev.c.from("lanes").delete().eq("id", "zz-test-a").select("id")));
  await check("dev", "insert sync_queue", "deny", async () => rows(await dev.c.from("roadmap_sync_queue").insert({ item_id: null, action: "add", payload: { zz_test: true } }).select("id")));

  // The forced password reset can't be skipped by switching its flag off through the API.
  await svc.from("profiles").update({ must_reset_password: true }).eq("id", dev.id);
  await check("dev", "clear own must_reset_password flag", "deny", async () => rows(await dev.c.from("profiles").update({ must_reset_password: false }).eq("id", dev.id).select("id")));
  await svc.from("profiles").update({ must_reset_password: false }).eq("id", dev.id);
  await check("dev", "set own avatar while NOT flagged (flag trigger leaves other updates alone)", "allow", async () => rows(await dev.c.from("profiles").update({ avatar: "avatar-03" }).eq("id", dev.id).select("id")));

  // ===================== SCRUM MASTER
  await check("sm", "read another profile (admin)", "deny", async () => rows(await sm.c.from("profiles").select("id").eq("id", adm.id)));
  await check("sm", "insert own item", "allow", async () => rows(await sm.c.from("roadmap_items").insert({ lane_id: "zz-test-a", title: "[TESTE] sm novo", created_by: sm.id }).select("id")));
  await check("sm", "insert item as someone else", "deny", async () => rows(await sm.c.from("roadmap_items").insert({ lane_id: "zz-test-a", title: "[TESTE] forjado", created_by: adm.id }).select("id")));
  await check("sm", "insert item with created_by null", "deny", async () => rows(await sm.c.from("roadmap_items").insert({ lane_id: "zz-test-a", title: "[TESTE] sem dono", created_by: null }).select("id")));
  await check("sm", "edit own item (title+prioridade)", "allow", async () => rows(await sm.c.from("roadmap_items").update({ title: "[TESTE] sm editado", prioridade: "High" }).eq("id", M).select("id")));
  await check("sm", "change own item's created_by", "deny", async () => rows(await sm.c.from("roadmap_items").update({ created_by: adm.id }).eq("id", M).select("id")));
  // The issue link renders as a link for everyone, so only GitHub issue links of the org are stored.
  await check("sm", "own item: link to a phishing site", "deny", async () => rows(await sm.c.from("roadmap_items").update({ github_issue_url: "https://evil.example.com/login" }).eq("id", M).select("id")));
  await check("sm", "own item: javascript: link", "deny", async () => rows(await sm.c.from("roadmap_items").update({ github_issue_url: "javascript:alert(1)" }).eq("id", M).select("id")));
  await check("sm", "own item: lookalike GitHub host", "deny", async () => rows(await sm.c.from("roadmap_items").update({ github_issue_url: "https://github.com.evil.example.com/Essencis-Labs/x/issues/1" }).eq("id", M).select("id")));
  await check("sm", "own item: a real GitHub issue link", "allow", async () => rows(await sm.c.from("roadmap_items").update({ github_issue_url: "https://github.com/Essencis-Labs/GeoCloudAI/issues/1" }).eq("id", M).select("id")));
  await check("sm", "seeded item: prioridade/effort", "allow", async () => rows(await sm.c.from("roadmap_items").update({ prioridade: "Low", effort: "High" }).eq("id", S).select("id")));
  await check("sm", "seeded item: move lane", "allow", async () => rows(await sm.c.from("roadmap_items").update({ lane_id: "zz-test-b" }).eq("id", S).select("id")));
  await check("sm", "seeded item: title", "deny", async () => rows(await sm.c.from("roadmap_items").update({ title: "[TESTE] renomeado" }).eq("id", S).select("id")));
  await check("sm", "seeded item: description", "deny", async () => rows(await sm.c.from("roadmap_items").update({ description: "hack" }).eq("id", S).select("id")));
  await check("sm", "seeded item: produto", "deny", async () => rows(await sm.c.from("roadmap_items").update({ produto: "ELIMS" }).eq("id", S).select("id")));
  await check("sm", "seeded item: delete", "deny", async () => rows(await sm.c.from("roadmap_items").delete().eq("id", S2).select("id")));
  await check("sm", "admin's item: prioridade", "deny", async () => rows(await sm.c.from("roadmap_items").update({ prioridade: "Low" }).eq("id", A).select("id")));
  await check("sm", "admin's item: move lane", "deny", async () => rows(await sm.c.from("roadmap_items").update({ lane_id: "zz-test-b" }).eq("id", A).select("id")));
  await check("sm", "admin's item: delete", "deny", async () => rows(await sm.c.from("roadmap_items").delete().eq("id", A2).select("id")));
  await check("sm", "own item: delete", "allow", async () => rows(await sm.c.from("roadmap_items").delete().eq("id", M2).select("id")));
  await check("sm", "note on own item as scrum_master", "allow", async () => rows(await sm.c.from("item_notes").insert({ item_id: M, author_id: sm.id, author_role: "scrum_master", body: "[TESTE] nota" }).select("id")));
  await check("sm", "note on seeded item as scrum_master", "allow", async () => rows(await sm.c.from("item_notes").insert({ item_id: S, author_id: sm.id, author_role: "scrum_master", body: "[TESTE] nota" }).select("id")));
  await check("sm", "note spoofing role dev", "deny", async () => rows(await sm.c.from("item_notes").insert({ item_id: M, author_id: sm.id, author_role: "dev", body: "[TESTE] forjada" }).select("id")));
  await check("sm", "note spoofing role admin", "deny", async () => rows(await sm.c.from("item_notes").insert({ item_id: M, author_id: sm.id, author_role: "admin", body: "[TESTE] forjada" }).select("id")));
  await check("sm", "note as someone else", "deny", async () => rows(await sm.c.from("item_notes").insert({ item_id: M, author_id: adm.id, author_role: "scrum_master", body: "[TESTE] forjada" }).select("id")));
  await check("sm", "promote self to admin", "deny", async () => rows(await sm.c.from("profiles").update({ role: "admin" }).eq("id", sm.id).select("id")));
  await check("sm", "change dev's role", "deny", async () => rows(await sm.c.from("profiles").update({ role: "scrum_master" }).eq("id", dev.id).select("id")));
  await check("sm", "insert lane", "deny", async () => rows(await sm.c.from("lanes").insert({ id: "zz-test-sm", title: "x", kind: "group" }).select("id")));
  await check("sm", "rename a lane", "deny", async () => rows(await sm.c.from("lanes").update({ title: "[TESTE] hacked" }).eq("id", "zz-test-b").select("id")));
  // Deleting a lane cascades to every item in it, owned by anyone: item deletes are owner-only, lane deletes must not bypass that.
  await svc.from("lanes").insert({ id: "zz-test-cascade", title: "[TESTE] cascade — apagar", kind: "group", sort_order: 992 });
  const victim = (await svc.from("roadmap_items").insert({ lane_id: "zz-test-cascade", title: "[TESTE] item do admin", description: "d", created_by: adm.id }).select("id").single()).data.id;
  await check("sm", "delete a lane (cascades to admin's item)", "deny", async () => {
    const r = await sm.c.from("lanes").delete().eq("id", "zz-test-cascade").select("id");
    const survives = (await svc.from("roadmap_items").select("id").eq("id", victim)).data.length === 1;
    return { ok: !r.error && r.data.length > 0, detail: `lane rows ${r.data?.length ?? 0}, admin's item survives: ${survives}` };
  });
  await check("sm", "read roadmap_sync_queue", "allow", async () => ({ ok: !(await sm.c.from("roadmap_sync_queue").select("id").limit(1)).error }));
  await check("sm", "insert sync_queue (what the actions do)", "allow", async () => rows(await sm.c.from("roadmap_sync_queue").insert({ item_id: M, action: "modify", payload: { zz_test: true } }).select("id")));

  // ===================== ADMIN
  await check("admin", "read ALL profiles", "allow", async () => ({ ok: ((await adm.c.from("profiles").select("id")).data ?? []).length >= 4 }));
  await check("admin", "edit anyone's item (title)", "allow", async () => rows(await adm.c.from("roadmap_items").update({ title: "[TESTE] admin editou" }).eq("id", M).select("id")));
  await check("admin", "edit seeded item title", "allow", async () => rows(await adm.c.from("roadmap_items").update({ title: "[TESTE] admin editou seeded" }).eq("id", S).select("id")));
  await check("admin", "delete anyone's item", "allow", async () => rows(await adm.c.from("roadmap_items").delete().eq("id", S2).select("id")));
  await check("admin", "note as admin", "allow", async () => rows(await adm.c.from("item_notes").insert({ item_id: M, author_id: adm.id, author_role: "dev", body: "[TESTE] nota do admin" }).select("id")));
  await check("admin", "write lanes", "allow", async () => rows(await adm.c.from("lanes").update({ title: "[TESTE] lane A admin" }).eq("id", "zz-test-a").select("id")));
  await check("admin", "dev -> scrum_master", "allow", async () => rows(await adm.c.from("profiles").update({ role: "scrum_master" }).eq("id", dev.id).select("id")));
  await check("admin", "scrum_master -> dev (restore dev)", "allow", async () => rows(await adm.c.from("profiles").update({ role: "dev" }).eq("id", dev.id).select("id")));
  await check("admin", "make dev an admin", "deny", async () => rows(await adm.c.from("profiles").update({ role: "admin" }).eq("id", dev.id).select("id")));
  await check("admin", "demote an admin (the TEST admin's own row)", "deny", async () => rows(await adm.c.from("profiles").update({ role: "dev" }).eq("id", adm.id).select("id")));
  await svc.from("profiles").update({ role: "admin" }).eq("id", adm.id); // put it back if the demotion went through

  // ===================== PROGRESS REPORTS ("Resumo para a diretoria")
  // The admin reads and edits every report (the screen's edits live in `overrides`); a scrum_master reads
  // only the SENT ones and edits none; dev and anonymous read nothing. Nobody signed in creates or deletes a
  // report, or rewrites what the collectors pushed (content, link token, product, period); a sent report is
  // frozen; "sent" needs the numbers checked AFTER the last push. A product has one draft at a time, so the
  // fixtures are one sent report and one draft (plus the draft the ingest round trip makes at the end).
  const R = "progress_reports";
  const when = (n) => `2099-03-${String(n).padStart(2, "0")}T03:00:00Z`;
  const fixtureRow = (n, extra = {}) => ({ produto: "ELIMS", period_start: when(n), period_end: when(n + 1), content: { zz_test: true }, ...extra });
  const report = async (n, extra = {}) => {
    const r = await svc.from(R).insert(fixtureRow(n, extra)).select("id").single();
    return { id: r.data?.id, detail: r.error ? r.error.message.slice(0, 90) : "created" };
  };
  const readReport = async (id) => (await svc.from(R).select("*").eq("id", id).single()).data;
  const edit = (c, id, patch) => c.from(R).update(patch).eq("id", id).select("id");
  const recent = (iso) => iso != null && Math.abs(Date.now() - Date.parse(iso)) < 120000;
  await svc.from(R).delete().eq("content->>zz_test", "true"); // leftovers of a run that died halfway

  const S1 = await report(12, { status: "sent", checked_at: when(12), sent_at: when(13) });
  const D1 = await report(14);
  await check("svc", "create the fixture reports (the ingest route does)", "allow", async () => ({ ok: Boolean(S1.id && D1.id), detail: S1.id ? D1.detail : S1.detail }));
  // The table's own invariants, which the ingest route relies on.
  await check("svc", "a second draft of the same product", "deny", async () => rows(await svc.from(R).insert(fixtureRow(30)).select("id")));
  await check("svc", "the same period twice for a product", "deny", async () => rows(await svc.from(R).insert(fixtureRow(12, { status: "sent" })).select("id")));
  await check("svc", "a period that ends before it starts", "deny", async () => rows(await svc.from(R).insert({ ...fixtureRow(40, { status: "sent" }), period_end: when(39) }).select("id")));
  await check("svc", "a status other than draft or sent", "deny", async () => rows(await svc.from(R).insert(fixtureRow(41, { status: "archived" })).select("id")));

  for (const [who, c] of [["anon", anon], ["dev", dev.c]]) {
    await check(who, "read a draft", "deny", async () => rows(await c.from(R).select("id").eq("id", D1.id)));
    await check(who, "read a sent report", "deny", async () => rows(await c.from(R).select("id").eq("id", S1.id)));
    await check(who, "edit a draft", "deny", async () => rows(await edit(c, D1.id, { overrides: { zz: { value: "x" } } })));
    await check(who, "edit a sent report", "deny", async () => rows(await edit(c, S1.id, { overrides: { zz: { value: "x" } } })));
    await check(who, "insert a report", "deny", async () => rows(await c.from(R).insert(fixtureRow(31)).select("id")));
    await check(who, "delete a report", "deny", async () => rows(await c.from(R).delete().eq("id", D1.id).select("id")));
  }

  // A scrum_master reads what was sent and nothing else: no draft, no edit.
  await check("sm", "read a sent report", "allow", async () => rows(await sm.c.from(R).select("id").eq("id", S1.id)));
  await check("sm", "read a draft", "deny", async () => rows(await sm.c.from(R).select("id").eq("id", D1.id)));
  await check("sm", "edit a draft", "deny", async () => rows(await edit(sm.c, D1.id, { overrides: { zz: { value: "x" } } })));
  await check("sm", "tick checked_at on a draft", "deny", async () => rows(await edit(sm.c, D1.id, { checked_at: new Date().toISOString() })));
  await check("sm", "edit a sent report", "deny", async () => rows(await edit(sm.c, S1.id, { overrides: { zz: { value: "x" } } })));
  await check("sm", "insert a report", "deny", async () => rows(await sm.c.from(R).insert(fixtureRow(32)).select("id")));
  await check("sm", "delete a sent report", "deny", async () => rows(await sm.c.from(R).delete().eq("id", S1.id).select("id")));

  await check("admin", "read a draft", "allow", async () => rows(await adm.c.from(R).select("id").eq("id", D1.id)));
  await check("admin", "read a sent report", "allow", async () => rows(await adm.c.from(R).select("id").eq("id", S1.id)));
  await check("admin", "edit overrides of a draft", "allow", async () => rows(await edit(adm.c, D1.id, { overrides: { headline: { value: "[TESTE] frase" } } })));
  await check("admin", "rewrite content", "deny", async () => rows(await edit(adm.c, D1.id, { content: { zz_test: true, headline: "forjado" } })));
  await check("admin", "rewrite share_token", "deny", async () => rows(await edit(adm.c, D1.id, { share_token: "00000000-0000-4000-8000-000000000000" })));
  await check("admin", "rewrite produto", "deny", async () => rows(await edit(adm.c, D1.id, { produto: "GeoCloud" })));
  await check("admin", "rewrite the period", "deny", async () => rows(await edit(adm.c, D1.id, { period_start: when(10), period_end: when(11) })));
  await check("admin", "rewrite pushed_at", "deny", async () => rows(await edit(adm.c, D1.id, { pushed_at: when(12) })));
  await check("admin", "insert a report", "deny", async () => rows(await adm.c.from(R).insert(fixtureRow(33)).select("id")));
  await check("admin", "delete a draft", "deny", async () => rows(await adm.c.from(R).delete().eq("id", D1.id).select("id")));
  await check("admin", "send a report nobody checked", "deny", async () => rows(await edit(adm.c, D1.id, { status: "sent" })));
  await check("admin", "tick checked_at", "allow", async () => rows(await edit(adm.c, D1.id, { checked_at: new Date().toISOString() })));
  // The stamp is the database's: the time and the author sent along are ignored.
  await check("admin", "forge the checked_at / checked_by stamp", "deny", async () => {
    await edit(adm.c, D1.id, { checked_at: null });
    await edit(adm.c, D1.id, { checked_at: "2000-01-01T00:00:00Z", checked_by: sm.id });
    const row = await readReport(D1.id);
    const forged = row.checked_by !== adm.id || !recent(row.checked_at);
    return { ok: forged, detail: forged ? "forged stamp stored" : "stamped by the database" };
  });
  await check("admin", "rewrite checked_by of a checked report", "deny", async () => {
    await edit(adm.c, D1.id, { checked_by: sm.id });
    return { ok: (await readReport(D1.id)).checked_by !== adm.id, detail: "checked_by changed" };
  });
  // A push after the check makes the check stale: the report can't be sent until it is checked again.
  await svc.from(R).update({ pushed_at: new Date(Date.now() + 3600000).toISOString() }).eq("id", D1.id);
  await check("admin", "send a report checked before the last push", "deny", async () => rows(await edit(adm.c, D1.id, { status: "sent" })));
  await svc.from(R).update({ checked_at: new Date(Date.now() + 7200000).toISOString() }).eq("id", D1.id);
  await check("admin", "send forging sent_by / sent_at", "deny", async () => {
    await edit(adm.c, D1.id, { status: "sent", sent_by: sm.id, sent_at: "2000-01-01T00:00:00Z" });
    const row = await readReport(D1.id);
    const forged = row.sent_by !== adm.id || !recent(row.sent_at);
    return { ok: forged, detail: forged ? "forged stamp stored" : "stamped by the database" };
  });
  await check("admin", "a checked report is sent, stamped by the database", "allow", async () => {
    const row = await readReport(D1.id);
    return { ok: row.status === "sent" && row.sent_by === adm.id && recent(row.sent_at), detail: `status ${row.status}` };
  });
  await check("sm", "read the report once it is sent", "allow", async () => rows(await sm.c.from(R).select("id").eq("id", D1.id)));

  // A sent report is frozen, for everyone signed in.
  await check("admin", "sent report: edit overrides", "deny", async () => rows(await edit(adm.c, D1.id, { overrides: { headline: { value: "depois de enviado" } } })));
  await check("admin", "sent report: untick checked_at", "deny", async () => rows(await edit(adm.c, D1.id, { checked_at: null })));
  await check("admin", "sent report: back to draft", "deny", async () => rows(await edit(adm.c, D1.id, { status: "draft" })));
  await check("admin", "sent report: delete", "deny", async () => rows(await adm.c.from(R).delete().eq("id", D1.id).select("id")));
  await check("admin", "sent fixture: edit overrides", "deny", async () => rows(await edit(adm.c, S1.id, { overrides: { zz: { value: "x" } } })));

  // The ingest route's store, against the real table (the service role): the rules of ingest.ts meeting the
  // table's guards. Skipped, loudly, on a Node that can't load .ts files.
  let ingestModules = null;
  try {
    ingestModules = [await import("../src/lib/progress/ingest.ts"), await import("../src/lib/progress/ingest-store.ts")];
  } catch (e) {
    if (e?.code === "ERR_MODULE_NOT_FOUND") throw e; // a renamed file must not silently drop the checks
    console.log("(ingest round trip skipped: this Node can't load .ts files)");
  }
  if (ingestModules) {
    const [{ ingestDraft, reportState }, { supabaseReportStore }] = ingestModules;
    const store = supabaseReportStore(svc);
    const push = (headline, endDay) =>
      ingestDraft(store, {
        produto: "ELIMS",
        content: {
          zz_test: true,
          window: { start: when(20), end: when(endDay) },
          headline,
          entries: [{ id: "zz-1", status: "em_validacao", hidden: false }, { id: "zz-2", status: "concluido", hidden: true }],
        },
        now: new Date(),
      });
    const first = await push("[TESTE] primeira", 21);
    await check("ingest", "the first push creates the draft", "allow", async () => ({ ok: first.status === 200 && first.created === true, detail: `status ${first.status}` }));
    await edit(adm.c, first.id, {
      overrides: { headline: { value: "[TESTE] minha frase", base: "[TESTE] primeira" }, "entry:zz-1:status": { value: "concluido", base: "em_validacao" } },
    });
    await edit(adm.c, first.id, { checked_at: new Date().toISOString() });
    const before = await readReport(first.id);
    const second = await push("[TESTE] segunda", 22);
    const after = await readReport(first.id);
    await check("ingest", "pushing again keeps edits and link, voids the check", "allow", async () => {
      const kept = JSON.stringify(after.overrides) === JSON.stringify(before.overrides) && after.share_token === before.share_token;
      const voided = after.checked_at === null && after.checked_by === null;
      const fresh = after.content.headline === "[TESTE] segunda" && after.rev > before.rev;
      return { ok: second.status === 200 && second.created === false && second.id === first.id && kept && voided && fresh, detail: `kept ${kept}, voided ${voided}, fresh ${fresh}` };
    });
    await edit(adm.c, first.id, { checked_at: new Date().toISOString() });
    await edit(adm.c, first.id, { status: "sent" });
    const late = await push("[TESTE] tarde demais", 22);
    await check("ingest", "a period already sent answers 409", "allow", async () => ({ ok: late.status === 409 && late.error === "period_already_sent", detail: `status ${late.status}` }));
    // The GET answer: the window since the last sent report, and what that report told (edits applied).
    await check("ingest", "the state lists what the sent report told", "allow", async () => {
      const state = await reportState(store, "ELIMS", new Date());
      const told = JSON.stringify(state.lastSent?.entries);
      const ok = state.lastSent?.id === first.id && told === JSON.stringify([{ id: "zz-1", status: "concluido" }]);
      return { ok, detail: `told ${told}` };
    });
    await check("ingest", "...and the sent report is untouched", "allow", async () => {
      const row = await readReport(first.id);
      return { ok: row.status === "sent" && row.content.headline === "[TESTE] segunda", detail: `status ${row.status}` };
    });
  }

  // ===================== SIGNUP / E-MAIL DOMAIN
  // No real e-mail is ever sent: the public signUp probe only runs once the backend has already refused
  // the same domain through the admin API (a refused row never reaches GoTrue's confirmation e-mail).
  const tag = Math.random().toString(36).slice(2, 8);
  const pw = `Au-${tag}-1aZ!x9`;
  let backendRefusedBadDomain = false;
  await check("signup", "admin API creates a non-allowed domain account", "deny", async () => {
    const r = await svc.auth.admin.createUser({ email: `roads-audit-${tag}@gmail.com`, password: pw, email_confirm: true });
    backendRefusedBadDomain = Boolean(r.error);
    return { ok: !r.error, detail: r.error ? r.error.message.slice(0, 90) : "account created" };
  });
  if (backendRefusedBadDomain) {
    await check("signup", "public signUp with a non-allowed domain", "deny", async () => {
      const r = await mk().auth.signUp({ email: `roads-audit-${tag}b@gmail.com`, password: pw });
      return { ok: !r.error && Boolean(r.data.user), detail: r.error ? r.error.message.slice(0, 90) : "user created" };
    });
  } else {
    console.log("(public signUp probe skipped: the backend accepted the domain, so it would send a real e-mail)");
  }
  await check("signup", "admin API creates an allowed-domain account (+tag)", "allow", async () => {
    const r = await svc.auth.admin.createUser({ email: `sergio.mendes+roads-audit-${tag}@essencislabs.com`, password: pw, email_confirm: true });
    return { ok: !r.error, detail: r.error ? r.error.message.slice(0, 90) : "account created" };
  });
  await check("signup", "moving an account's e-mail to a non-allowed domain", "deny", async () => {
    const list = (await svc.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users;
    const good = list.find((u) => u.email === `sergio.mendes+roads-audit-${tag}@essencislabs.com`);
    if (!good) return { ok: false, detail: "no allowed-domain account to move" };
    const r = await svc.auth.admin.updateUserById(good.id, { email: `roads-audit-${tag}c@gmail.com`, email_confirm: true });
    return { ok: !r.error, detail: r.error ? r.error.message.slice(0, 90) : "e-mail changed" };
  });

  // ===================== AUTH CONFIG (a warning: it's a dashboard setting, code can't fix it)
  // Auth e-mails (password reset, signup confirmation) only link to the production site if it is the
  // project's Site URL / an allowed redirect. generateLink sends no e-mail.
  const production = process.env.PRODUCTION_URL ?? "https://roads-psi.vercel.app";
  const asked = `${production}/redefinir-senha`;
  const { data: probeLink } = await svc.auth.admin.generateLink({ type: "recovery", email: cred("ROADS_TEST_DEV_EMAIL"), options: { redirectTo: asked } });
  const effective = probeLink?.properties?.action_link ? new URL(probeLink.properties.action_link).searchParams.get("redirect_to") : null;
  if (effective !== asked) {
    warnings.push(`Auth e-mails (password reset, signup confirmation) would send people to ${effective} instead of ${production}. Set Site URL and Redirect URLs in the Supabase dashboard, Authentication > URL Configuration.`);
  }
} catch (e) {
  console.error("AUDIT FAILED:", e.message ?? e);
  exitCode = 1;
} finally {
  // ---------- cleanup (service role): always
  await svc.from("lanes").delete().like("id", "zz-test-%");
  await svc.from("roadmap_items").delete().in("created_by", [sm.id, adm.id]);
  await svc.from("roadmap_sync_queue").delete().eq("payload->>zz_test", "true");
  await svc.from("progress_reports").delete().eq("content->>zz_test", "true");
  for (const u of (await svc.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users.filter((x) => /roads-audit-/.test(x.email ?? ""))) {
    await svc.auth.admin.deleteUser(u.id);
  }
  await svc.from("profiles").update({ role: "admin", must_reset_password: false }).eq("id", adm.id);
  await svc.from("profiles").update({ role: "scrum_master", must_reset_password: false }).eq("id", sm.id);
  await svc.from("profiles").update({ role: "dev", must_reset_password: false, avatar: null }).eq("id", dev.id);
  const { data: strayQueue } = await svc.from("roadmap_sync_queue").select("id").gte("created_at", startedAt);
  console.log(`cleanup done. new sync_queue rows since start: ${strayQueue?.length ?? 0} (expected 0)`);
}

let holes = 0;
let broken = 0;
for (const r of results) {
  if (r.verdict === "HOLE") holes++;
  if (r.verdict === "BROKEN") broken++;
  const mark = r.verdict === "ok" ? "  ok  " : r.verdict === "HOLE" ? " HOLE " : "BROKEN";
  const note = r.verdict === "ok" ? "" : `[${r.detail}]`;
  console.log(`${mark} ${r.who.padEnd(6)} ${r.what.padEnd(48)} expected ${r.expected.padEnd(5)} -> ${r.actual.padEnd(7)} ${note}`);
}
for (const w of warnings) console.log(`  WARN  ${w}`);
console.log(`\n${results.length} checks | holes (allowed but forbidden): ${holes} | broken (refused but allowed): ${broken}${warnings.length ? ` | warnings: ${warnings.length}` : ""}`);
process.exit(exitCode || (holes + broken > 0 ? 1 : 0));
