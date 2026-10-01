// Calls every server action DIRECTLY (no UI), as each role and as nobody, and checks the database afterwards.
const fs = require("node:fs");
const path = require("node:path");
const L = require("./lib.cjs");
const { BASE, expect, sleep, svc } = L;

const REPO = path.resolve(__dirname, "..", "..");

// name -> action id, straight from the production build
function actionIds() {
  const dir = path.join(REPO, ".next", "static", "chunks");
  const ids = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of text.matchAll(/createServerReference\)\("([0-9a-f]{40,})",[^)]*?,"(\w+)"\)/g)) ids[m[2]] = m[1];
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, ".next", "server", "server-reference-manifest.json"), "utf8")).node;
  const known = new Set(Object.values(ids));
  const unnamed = Object.keys(manifest).filter((id) => !known.has(id));
  return { ids, unnamed, manifest };
}

async function call(ctx, id, args, pagePath) {
  const res = await ctx.request.post(BASE + pagePath, {
    headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: BASE },
    data: JSON.stringify(args),
    maxRedirects: 0,
  });
  const text = await res.text();
  const status = res.status();
  let kind;
  if ([301, 302, 303, 307, 308].includes(status)) kind = "redirect";
  else if (status === 404) kind = "not-found";
  else if (/(^|\n)\d+:E\{/.test(text) || status >= 500) kind = "error";
  else if (status === 200) kind = "ok";
  else kind = `http-${status}`;
  const returned = (text.match(/(?:^|\n)1:(.*)/) || [])[1] ?? "";
  return { status, kind, returned: returned.slice(0, 100), text };
}

(async () => {
  const t0 = new Date().toISOString();
  await L.ensureFixtures();
  const { ids: A, unnamed, manifest } = actionIds();
  const browser = await L.launch();
  try {
    const dev = await L.newSession(browser, "dev");
    const sm = await L.newSession(browser, "sm");
    const adm = await L.newSession(browser, "admin");
    for (const s of [dev, sm, adm]) await L.login(s);
    const anon = await browser.newContext();

    console.log(`actions found in the build: ${Object.keys(A).length} named + ${unnamed.length} unnamed (manifest total ${Object.keys(manifest).length})`);
    for (const [name, id] of Object.entries(A)) {
      const where = Object.keys(manifest[id]?.workers ?? {}).map((p) => p.replace("app", "").replace("/page", "")).join(",");
      console.log(`  ${name.padEnd(22)} ${id.slice(0, 10)}…  pages: ${where}`);
    }

    // The three that no screen calls: find out what they are by what they return (token is empty, nothing reaches GitHub).
    const probe = {};
    for (const id of unnamed) {
      const r = await call(adm.context, id, [[]], "/dashboard");
      const shape = /not_configured/.test(r.text) ? "syncBoard" : /kpis/.test(r.text) ? "getDashboard" : "getLatestBoardSnapshot";
      probe[shape] = id;
      console.log(`  (unnamed ${id.slice(0, 10)}…) behaves like ${shape}: ${r.kind} ${r.returned.slice(0, 60)}`);
    }
    console.log();

    const lane = "zz-test-sprint";
    const edit = (over = {}) => ({ prioridade: "Low", effort: "Low", note: "", activeView: "dev", ...over });
    const itemRow = async (id) => (await svc.from("roadmap_items").select("title, prioridade, lane_id").eq("id", id)).data?.[0];
    const profileRole = async (id) => (await svc.from("profiles").select("role").eq("id", id)).data[0].role;
    const nonexistent = "00000000-0000-4000-8000-000000000000";

    // ------------------------------------------------------------------ nobody signed in
    for (const [name, id, args, p] of [
      ["createRoadmapItem", A.createRoadmapItem, [lane], "/roadmap"],
      ["deleteRoadmapItem", A.deleteRoadmapItem, [L.ids.adminItem], "/roadmap"],
      ["updateUserRole", A.updateUserRole, [L.ids.dev, "scrum_master"], "/config"],
      ["listUsersForConfig", A.listUsersForConfig, [], "/config"],
      ["getDashboard", probe.getDashboard, [[]], "/dashboard"],
      ["getRoadmapBoard", A.getRoadmapBoard, [], "/roadmap"],
    ]) {
      const r = await call(anon, id, args, p);
      expect(`nobody signed in -> ${name}: stopped at the door (${r.kind} ${r.status})`, r.kind === "redirect");
    }
    const viaLogin = await call(anon, A.createRoadmapItem, [lane], "/login");
    expect("nobody signed in -> an action posted to the PUBLIC /login page does nothing", viaLogin.kind !== "ok" || !/"id"/.test(viaLogin.returned), `${viaLogin.kind} ${viaLogin.returned.slice(0, 50)}`);
    expect("nobody signed in -> no item was created", (await svc.from("roadmap_items").select("id").eq("lane_id", lane).not("created_by", "is", null).neq("created_by", L.ids.admin).neq("created_by", L.ids.sm)).data.length === 0);

    // ------------------------------------------------------------------ DEV
    const devDenied = [
      ["createRoadmapItem", A.createRoadmapItem, [lane], "/roadmap"],
      ["deleteRoadmapItem (admin's item)", A.deleteRoadmapItem, [L.ids.adminItem], "/roadmap"],
      ["moveRoadmapItemLane (SM's item)", A.moveRoadmapItemLane, [L.ids.smItem, "zz-test-b"], "/roadmap"],
      ["saveRoadmapItemEdit (SM's item)", A.saveRoadmapItemEdit, [L.ids.smItem, edit({ prioridade: "Critical" })], "/roadmap"],
      ["saveRoadmapItemEdit + note", A.saveRoadmapItemEdit, [L.ids.smItem, edit({ note: "[TESTE] nota de dev" })], "/roadmap"],
      ["listUsersForConfig", A.listUsersForConfig, [], "/config"],
      ["updateUserRole (self-promotion)", A.updateUserRole, [L.ids.dev, "scrum_master"], "/config"],
      ["updateUserRole (to admin)", A.updateUserRole, [L.ids.dev, "admin"], "/config"],
      ["resetUserPassword", A.resetUserPassword, [nonexistent], "/config"],
      ["updateMyAvatar (invalid id)", A.updateMyAvatar, ["../../etc/passwd"], "/roadmap"],
    ];
    for (const [name, id, args, p] of devDenied) {
      const r = await call(dev.context, id, args, p);
      expect(`dev -> ${name}: refused`, r.kind === "error", `${r.kind} ${r.status}`);
    }
    expect("dev -> nothing changed: no item created, SM item untouched, admin item still there, role still dev",
      (await svc.from("roadmap_items").select("id").eq("created_by", L.ids.dev)).data.length === 0 &&
        (await itemRow(L.ids.smItem)).prioridade === "Medium" && (await itemRow(L.ids.adminItem)) && (await profileRole(L.ids.dev)) === "dev");
    expect("dev -> no note was written", (await svc.from("item_notes").select("id").eq("item_id", L.ids.smItem)).data.length === 0);
    const devOk = [
      ["getRoadmapBoard", A.getRoadmapBoard, [], "/roadmap"],
      ["updateMyAvatar (valid)", A.updateMyAvatar, ["avatar-03"], "/roadmap"],
      ["syncBoardAsViewer (fails closed: no token)", A.syncBoardAsViewer, [], "/roadmap"],
    ];
    for (const [name, id, args, p] of devOk) {
      const r = await call(dev.context, id, args, p);
      expect(`dev -> ${name}: allowed`, r.kind === "ok", `${r.kind} ${r.returned.slice(0, 50)}`);
    }
    expect("no action in the build behaves like the cron-only syncBoard any more", probe.syncBoard === undefined, JSON.stringify(Object.keys(probe)));
    const OLD_SYNC_BOARD_ID = "00ac3b6ef692bf08d9ac587b902b687a76024068f2"; // its id in the previous build
    const cronAsDev = await call(dev.context, OLD_SYNC_BOARD_ID, [], "/dashboard");
    expect("dev -> the old syncBoard id answers 'not found' (the cron sync is no longer an endpoint)",
      cronAsDev.kind === "not-found" || cronAsDev.kind === "error", `${cronAsDev.kind} ${cronAsDev.returned.slice(0, 60)}`);

    // password reset action, called straight: a weak password is refused by the SERVER, and nobody signed in gets nothing.
    const weak = await call(dev.context, A.completePasswordReset, ["abc"], "/redefinir-senha");
    expect("dev -> completePasswordReset with a weak password: refused by the server, with the rule", weak.kind === "ok" && /"ok":false/.test(weak.returned) && /Mínimo 8/.test(weak.returned), weak.returned.slice(0, 80));
    const anonReset = await call(anon, A.completePasswordReset, ["Strong-pass-9"], "/redefinir-senha");
    expect("nobody signed in -> completePasswordReset with a good password changes nothing (no session)", anonReset.kind === "ok" && /"ok":false/.test(anonReset.returned), anonReset.returned.slice(0, 90));

    // the sync cooldown: a snapshot taken seconds ago is returned as is, GitHub is not asked again
    const { data: snap } = await svc.from("board_sync_state").select("synced_at").eq("id", true).single();
    const justNow = new Date(Date.now() - 3000).toISOString();
    await svc.from("board_sync_state").update({ synced_at: justNow }).eq("id", true);
    try {
      const cooled = await call(dev.context, A.syncBoardAsViewer, [], "/roadmap");
      expect("dev -> syncBoardAsViewer inside the 30s cooldown returns the stored snapshot (ok, no GitHub call)", cooled.kind === "ok" && /"ok":true/.test(cooled.returned) && cooled.text.includes(justNow.slice(0, 19)), cooled.returned.slice(0, 70));
    } finally {
      await svc.from("board_sync_state").update({ synced_at: snap.synced_at }).eq("id", true);
    }
    const staleAgain = await call(dev.context, A.syncBoardAsViewer, [], "/roadmap");
    expect("dev -> outside the cooldown the sync really runs (and fails closed here: no token)", /not_configured/.test(staleAgain.returned), staleAgain.returned.slice(0, 70));

    // ------------------------------------------------------------------ SCRUM MASTER
    const smDenied = [
      ["deleteRoadmapItem (admin's item)", A.deleteRoadmapItem, [L.ids.adminItem], "/roadmap"],
      ["moveRoadmapItemLane (admin's item)", A.moveRoadmapItemLane, [L.ids.adminItem, "zz-test-b"], "/roadmap"],
      ["saveRoadmapItemEdit (admin's item)", A.saveRoadmapItemEdit, [L.ids.adminItem, edit({ prioridade: "Critical" })], "/roadmap"],
      ["saveRoadmapItemEdit (rename a seeded item)", A.saveRoadmapItemEdit, [L.ids.seeded, edit({ content: { title: "[TESTE] hack", description: "x", produto: "GeoCloud" } })], "/roadmap"],
      ["deleteRoadmapItem (seeded item)", A.deleteRoadmapItem, [L.ids.seeded], "/roadmap"],
      ["listUsersForConfig", A.listUsersForConfig, [], "/config"],
      ["updateUserRole (promote the dev)", A.updateUserRole, [L.ids.dev, "scrum_master"], "/config"],
      ["resetUserPassword", A.resetUserPassword, [nonexistent], "/config"],
    ];
    for (const [name, id, args, p] of smDenied) {
      const r = await call(sm.context, id, args, p);
      expect(`scrum master -> ${name}: refused`, r.kind === "error", `${r.kind} ${r.status}`);
    }
    expect("scrum master -> nothing changed on the admin's and seeded items",
      (await itemRow(L.ids.adminItem)).prioridade === "Medium" && (await itemRow(L.ids.adminItem)).lane_id === lane &&
        (await itemRow(L.ids.seeded)).title === "[TESTE] item semeado (sem dono)" && (await profileRole(L.ids.dev)) === "dev");
    const smOk = [
      ["saveRoadmapItemEdit (own item)", A.saveRoadmapItemEdit, [L.ids.smItem, edit({ prioridade: "High", note: "[TESTE] nota com activeView=dev forjado" })], "/roadmap"],
      ["saveRoadmapItemEdit (seeded: priority + note)", A.saveRoadmapItemEdit, [L.ids.seeded, edit({ prioridade: "High" })], "/roadmap"],
      ["moveRoadmapItemLane (seeded item)", A.moveRoadmapItemLane, [L.ids.seeded, "zz-test-b"], "/roadmap"],
      ["createRoadmapItem", A.createRoadmapItem, [lane], "/roadmap"],
    ];
    for (const [name, id, args, p] of smOk) {
      const r = await call(sm.context, id, args, p);
      expect(`scrum master -> ${name}: allowed`, r.kind === "ok", `${r.kind} ${r.returned.slice(0, 50)}`);
    }
    const spoof = (await svc.from("item_notes").select("author_role, author_id").eq("item_id", L.ids.smItem)).data;
    expect("scrum master -> a note sent with activeView='dev' is still stored as scrum_master (role can't be spoofed)", spoof.length === 1 && spoof[0].author_role === "scrum_master" && spoof[0].author_id === L.ids.sm, JSON.stringify(spoof));
    const created = (await svc.from("roadmap_items").select("created_by").eq("created_by", L.ids.sm).neq("id", L.ids.smItem)).data;
    expect("scrum master -> the created item belongs to the Scrum Master", created.length === 1);
    const delOwn = await call(sm.context, A.deleteRoadmapItem, [L.ids.smItem], "/roadmap");
    expect("scrum master -> deleteRoadmapItem (own item): allowed", delOwn.kind === "ok" && (await itemRow(L.ids.smItem)) === undefined, `${delOwn.kind}`);

    // ------------------------------------------------------------------ ADMIN
    const adminRoleBefore = await profileRole(L.ids.admin);
    const r1 = await call(adm.context, A.updateUserRole, [L.ids.admin, "dev"], "/config");
    expect("admin -> updateUserRole on an ADMIN (self-demotion) is refused and the role stays admin", r1.kind === "error" && (await profileRole(L.ids.admin)) === adminRoleBefore, `${r1.kind}, role now ${await profileRole(L.ids.admin)}`);
    const r2 = await call(adm.context, A.updateUserRole, [L.ids.dev, "admin"], "/config");
    expect("admin -> updateUserRole to 'admin' is refused (reserved)", r2.kind === "error" && (await profileRole(L.ids.dev)) === "dev", `${r2.kind}`);
    const r3 = await call(adm.context, A.updateUserRole, [L.ids.dev, "owner"], "/config");
    expect("admin -> updateUserRole to an unknown role is refused", r3.kind === "error" && (await profileRole(L.ids.dev)) === "dev", `${r3.kind}`);
    const r4 = await call(adm.context, A.updateUserRole, [L.ids.dev, "scrum_master"], "/config");
    expect("admin -> updateUserRole dev -> scrum_master: allowed", r4.kind === "ok" && (await profileRole(L.ids.dev)) === "scrum_master", `${r4.kind}`);
    await call(adm.context, A.updateUserRole, [L.ids.dev, "dev"], "/config");
    const r5 = await call(adm.context, A.saveRoadmapItemEdit, [L.ids.adminItem, edit({ prioridade: "Urgent" })], "/roadmap");
    expect("admin -> saving a priority that doesn't exist is refused", r5.kind === "error" && (await itemRow(L.ids.adminItem)).prioridade === "Medium", `${r5.kind}`);
    const r6 = await call(adm.context, A.deleteRoadmapItem, [nonexistent], "/roadmap");
    expect("admin -> deleting an item that doesn't exist is an error, not a silent success", r6.kind === "error", `${r6.kind}`);
    const r7 = await call(adm.context, A.listUsersForConfig, [], "/config");
    expect("admin -> listUsersForConfig works and does not leak password hashes", r7.kind === "ok" && !/encrypted_password|password_hash|\$2[aby]\$/i.test(r7.text), `${r7.kind}`);
    const r8 = await call(adm.context, A.resetUserPassword, [nonexistent], "/config");
    expect("admin -> resetUserPassword on an unknown account answers 'not found' and touches nothing", r8.kind === "ok" && /"ok":false/.test(r8.returned) && /não encontrado/.test(r8.returned), r8.returned.slice(0, 90));

    // an account flagged for a password change is refused by the privileged actions until it has changed it
    await svc.from("profiles").update({ must_reset_password: true }).eq("id", L.ids.sm);
    const flaggedSm = await call(sm.context, A.createRoadmapItem, [lane], "/roadmap");
    expect("flagged Scrum Master -> createRoadmapItem is refused until the password is changed", flaggedSm.kind === "error", flaggedSm.kind);
    await svc.from("profiles").update({ must_reset_password: false }).eq("id", L.ids.sm);
    const unflaggedSm = await call(sm.context, A.createRoadmapItem, [lane], "/roadmap");
    expect("…and works again once the flag is gone", unflaggedSm.kind === "ok", unflaggedSm.kind);
    await svc.from("profiles").update({ must_reset_password: true }).eq("id", L.ids.admin);
    const flaggedAdmin = await call(adm.context, A.listUsersForConfig, [], "/config");
    expect("flagged admin -> listUsersForConfig is refused too", flaggedAdmin.kind === "error", flaggedAdmin.kind);
    await svc.from("profiles").update({ must_reset_password: false }).eq("id", L.ids.admin);

    const noise = [dev, sm, adm].flatMap((x) => x.problems).filter((p) => !/auth\/v1\/token|ERR_FAILED|Failed to load resource/.test(p));
    expect("no browser-side console errors while setting the sessions up", noise.length === 0, noise.slice(0, 2).join(" | "));
  } catch (e) {
    expect("run completed without an exception", false, L.scrub(e && e.message ? e.message : e).slice(0, 300));
  } finally {
    await browser.close();
    await L.cleanup(t0);
  }
  process.exit(L.summary("SERVER ACTIONS") ? 1 : 0);
})();
