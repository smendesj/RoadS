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

  // ===================== SCRUM MASTER
  await check("sm", "read another profile (admin)", "deny", async () => rows(await sm.c.from("profiles").select("id").eq("id", adm.id)));
  await check("sm", "insert own item", "allow", async () => rows(await sm.c.from("roadmap_items").insert({ lane_id: "zz-test-a", title: "[TESTE] sm novo", created_by: sm.id }).select("id")));
  await check("sm", "insert item as someone else", "deny", async () => rows(await sm.c.from("roadmap_items").insert({ lane_id: "zz-test-a", title: "[TESTE] forjado", created_by: adm.id }).select("id")));
  await check("sm", "insert item with created_by null", "deny", async () => rows(await sm.c.from("roadmap_items").insert({ lane_id: "zz-test-a", title: "[TESTE] sem dono", created_by: null }).select("id")));
  await check("sm", "edit own item (title+prioridade)", "allow", async () => rows(await sm.c.from("roadmap_items").update({ title: "[TESTE] sm editado", prioridade: "High" }).eq("id", M).select("id")));
  await check("sm", "change own item's created_by", "deny", async () => rows(await sm.c.from("roadmap_items").update({ created_by: adm.id }).eq("id", M).select("id")));
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
} catch (e) {
  console.error("AUDIT FAILED:", e.message ?? e);
  exitCode = 1;
} finally {
  // ---------- cleanup (service role): always
  await svc.from("lanes").delete().like("id", "zz-test-%");
  await svc.from("roadmap_items").delete().in("created_by", [sm.id, adm.id]);
  await svc.from("roadmap_sync_queue").delete().eq("payload->>zz_test", "true");
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
console.log(`\n${results.length} checks | holes (allowed but forbidden): ${holes} | broken (refused but allowed): ${broken}`);
process.exit(exitCode || (holes + broken > 0 ? 1 : 0));
