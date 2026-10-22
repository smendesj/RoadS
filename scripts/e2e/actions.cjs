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
      ["createRoadmapItem", A.createRoadmapItem, [], "/roadmap"],
      ["deleteRoadmapItem", A.deleteRoadmapItem, [L.ids.adminItem], "/roadmap"],
      ["updateUserRole", A.updateUserRole, [L.ids.dev, "scrum_master"], "/config"],
      ["listUsersForConfig", A.listUsersForConfig, [], "/config"],
      ["getDashboard", probe.getDashboard, [[]], "/dashboard"],
      ["getRoadmapBoard", A.getRoadmapBoard, [], "/roadmap"],
    ]) {
      const r = await call(anon, id, args, p);
      expect(`nobody signed in -> ${name}: stopped at the door (${r.kind} ${r.status})`, r.kind === "redirect");
    }
    const viaLogin = await call(anon, A.createRoadmapItem, [], "/login");
    expect("nobody signed in -> an action posted to the PUBLIC /login page does nothing", viaLogin.kind !== "ok" || !/"id"/.test(viaLogin.returned), `${viaLogin.kind} ${viaLogin.returned.slice(0, 50)}`);
    // "+ New item" puts an item in a type lane, never a week: no item of this run, in any lane, comes from nobody.
    expect("nobody signed in -> no item was created", (await svc.from("roadmap_items").select("id").gte("created_at", t0).not("created_by", "in", `(${L.ids.admin},${L.ids.sm})`)).data.length === 0);

    // A Comment the admin wrote (issue #23): only its author and the admin edit or delete it.
    const adminNote = (await svc.from("item_notes").insert({ item_id: L.ids.adminItem, author_id: L.ids.admin, author_role: "scrum_master", body: "[TESTE] comment do admin" }).select("id").single()).data.id;
    const adminNoteIntact = async () => {
      const { data } = await svc.from("item_notes").select("body, deleted_at").eq("id", adminNote);
      return data.length === 1 && data[0].body === "[TESTE] comment do admin" && !data[0].deleted_at;
    };

    // ------------------------------------------------------------------ DEV
    const devDenied = [
      ["createRoadmapItem", A.createRoadmapItem, [], "/roadmap"],
      ["deleteRoadmapItem (admin's item)", A.deleteRoadmapItem, [L.ids.adminItem], "/roadmap"],
      ["moveRoadmapItemLane (SM's item)", A.moveRoadmapItemLane, [L.ids.smItem, "zz-test-b"], "/roadmap"],
      ["moveRoadmapItemLane to the Kanban, unplanning it (SM's item)", A.moveRoadmapItemLane, [L.ids.smItem, "kanban"], "/roadmap"],
      ["saveRoadmapItemEdit (SM's item)", A.saveRoadmapItemEdit, [L.ids.smItem, edit({ prioridade: "Critical" })], "/roadmap"],
      ["saveRoadmapItemEdit + note", A.saveRoadmapItemEdit, [L.ids.smItem, edit({ note: "[TESTE] nota de dev" })], "/roadmap"],
      ["listUsersForConfig", A.listUsersForConfig, [], "/config"],
      ["updateUserRole (self-promotion)", A.updateUserRole, [L.ids.dev, "scrum_master"], "/config"],
      ["updateUserRole (to admin)", A.updateUserRole, [L.ids.dev, "admin"], "/config"],
      ["resetUserPassword", A.resetUserPassword, [nonexistent], "/config"],
    ];
    for (const [name, id, args, p] of devDenied) {
      const r = await call(dev.context, id, args, p);
      expect(`dev -> ${name}: refused`, r.kind === "error", `${r.kind} ${r.status}`);
    }
    // A week that is not in the database (the empty one at the end of the Roadmap's row) is created only for an
    // item its mover may move: a Dev is refused before any lane is written.
    const W = await L.weeks();
    const trailing = L.weekId(W.trailing);
    const laneExists = async (id) => ((await svc.from("lanes").select("id").eq("id", id)).data ?? []).length === 1;
    expect("weeks: the empty week at the end is not in the database before the run", !(await laneExists(trailing)), trailing);
    L.createdWeeks.add(trailing);
    const devWeek = await call(dev.context, A.moveRoadmapItemLane, [L.ids.smItem, trailing], "/roadmap");
    expect("dev -> moveRoadmapItemLane into a week not in the database: refused, and no lane is created",
      devWeek.kind === "error" && !(await laneExists(trailing)) && (await itemRow(L.ids.smItem)).lane_id === lane, `${devWeek.kind} ${trailing}`);
    expect("dev -> nothing changed: no item created, SM item untouched, admin item still there, role still dev",
      (await svc.from("roadmap_items").select("id").eq("created_by", L.ids.dev)).data.length === 0 &&
        (await itemRow(L.ids.smItem)).prioridade === "Medium" && (await itemRow(L.ids.adminItem)) && (await profileRole(L.ids.dev)) === "dev");
    expect("dev -> no note was written", (await svc.from("item_notes").select("id").eq("item_id", L.ids.smItem)).data.length === 0);
    const devOk = [
      ["getRoadmapBoard", A.getRoadmapBoard, [], "/roadmap"],
      ["syncBoardAsViewer (fails closed: no token)", A.syncBoardAsViewer, [], "/roadmap"],
    ];
    for (const [name, id, args, p] of devOk) {
      const r = await call(dev.context, id, args, p);
      expect(`dev -> ${name}: allowed`, r.kind === "ok", `${r.kind} ${r.returned.slice(0, 50)}`);
    }
    expect("updateMyAvatar is no longer a server action (the picture has its own route)", A.updateMyAvatar === undefined);

    // The picture's own door, POST /api/profile/avatar: only the signed-in user's own profile, only shipped ids,
    // only from the app's own pages.
    const avatarOf = async (id) => (await svc.from("profiles").select("avatar").eq("id", id)).data[0].avatar;
    const postAvatar = (ctx, avatar, origin = BASE) =>
      ctx.request.post(BASE + "/api/profile/avatar", { headers: { "content-type": "application/json", origin }, data: JSON.stringify({ avatar }) }).then((r) => r.status());
    await svc.from("profiles").update({ avatar: "avatar-05" }).eq("id", L.ids.dev);
    const anonAvatar = await postAvatar(anon, "avatar-01");
    const badAvatar = await postAvatar(dev.context, "../../etc/passwd");
    const foreignAvatar = await postAvatar(dev.context, "avatar-01", "https://evil.example");
    expect("avatar route: nobody signed in 401, a bad id 400, another site's page 403, and nothing changed",
      anonAvatar === 401 && badAvatar === 400 && foreignAvatar === 403 && (await avatarOf(L.ids.dev)) === "avatar-05", `${anonAvatar}/${badAvatar}/${foreignAvatar}`);
    const goodAvatar = await postAvatar(dev.context, "avatar-03");
    expect("avatar route: the Dev sets their own picture (200, saved by the time it answers)", goodAvatar === 200 && (await avatarOf(L.ids.dev)) === "avatar-03", String(goodAvatar));
    expect("no action in the build behaves like the cron-only syncBoard any more", probe.syncBoard === undefined, JSON.stringify(Object.keys(probe)));
    const OLD_SYNC_BOARD_ID = "00ac3b6ef692bf08d9ac587b902b687a76024068f2"; // its id in the previous build
    const cronAsDev = await call(dev.context, OLD_SYNC_BOARD_ID, [], "/dashboard");
    expect("dev -> the old syncBoard id answers 'not found' (the cron sync is no longer an endpoint)",
      cronAsDev.kind === "not-found" || cronAsDev.kind === "error", `${cronAsDev.kind} ${cronAsDev.returned.slice(0, 60)}`);

    // password reset action, called straight: a weak password is refused by the SERVER, and nobody signed in gets nothing.
    const weak = await call(dev.context, A.completePasswordReset, ["abc"], "/redefinir-senha");
    expect("dev -> completePasswordReset with a weak password: refused by the server, with the rule", weak.kind === "ok" && /"ok":false/.test(weak.returned) && /At least 8/.test(weak.returned), weak.returned.slice(0, 80));
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
      // Back to the old time, unless a real sync in production wrote a newer one meanwhile.
      await svc.from("board_sync_state").update({ synced_at: snap.synced_at }).eq("id", true).eq("synced_at", justNow);
    }
    const restoreSnapshot = await L.ageSnapshot();
    let staleAgain;
    try {
      staleAgain = await call(dev.context, A.syncBoardAsViewer, [], "/roadmap");
    } finally {
      await restoreSnapshot();
    }
    expect("dev -> outside the cooldown the sync really runs (and fails closed here: no token)", /not_configured/.test(staleAgain.returned), staleAgain.returned.slice(0, 70));

    // ------------------------------------------------------------------ SCRUM MASTER
    const smDenied = [
      ["deleteRoadmapItem (admin's item)", A.deleteRoadmapItem, [L.ids.adminItem], "/roadmap"],
      ["moveRoadmapItemLane (admin's item)", A.moveRoadmapItemLane, [L.ids.adminItem, "zz-test-b"], "/roadmap"],
      ["moveRoadmapItemLane to the Kanban, unplanning it (admin's item)", A.moveRoadmapItemLane, [L.ids.adminItem, "kanban"], "/roadmap"],
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
    // Since issue #34 no screen edits or deletes a Comment, so neither action is in the build: called by the ids they had
    // in the previous build, a dev and a scrum master reach nothing, and the admin's Comment stays as it was.
    const OLD_COMMENT_ACTIONS = [
      ["editItemComment", "600dda44334f7fe4de78590284270a36823d0d998b", [adminNote, "[TESTE] forjado"]],
      ["deleteItemComment", "40b3682ed46fbe4e49facaefdd7915b19fd369849d", [adminNote]],
    ];
    expect("editItemComment and deleteItemComment are not actions of the build any more (issue #34)",
      !A.editItemComment && !A.deleteItemComment && OLD_COMMENT_ACTIONS.every(([, id]) => !manifest[id]));
    for (const [who, session] of [["dev", dev], ["scrum master", sm]]) {
      for (const [name, id, args] of OLD_COMMENT_ACTIONS) {
        const r = await call(session.context, id, args, "/roadmap");
        expect(`${who} -> ${name} (the admin's Comment), by its old id: not found`, r.kind === "not-found" || r.kind === "error", `${r.kind} ${r.status}`);
      }
    }
    expect("dev and scrum master -> the admin's Comment is untouched", await adminNoteIntact());
    expect("scrum master -> nothing changed on the admin's and seeded items",
      (await itemRow(L.ids.adminItem)).prioridade === "Medium" && (await itemRow(L.ids.adminItem)).lane_id === lane &&
        (await itemRow(L.ids.seeded)).title === "[TESTE] item semeado (sem dono)" && (await profileRole(L.ids.dev)) === "dev");
    // ---- weeks: the scrum master plans an item into a week that is not in the database yet
    {
      const pastFree = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => L.addDays(W.monday, -7 * k)).find((m) => !W.holds(m)) ?? L.addDays(W.monday, -7 * 30);
      const refusedWeeks = [
        ["a date that does not exist", "sprint-31-02-2027"],
        ["not a Monday", L.weekId(L.addDays(W.trailing, 1))],
        ["a week before the current one", L.weekId(pastFree)],
        ["beyond 52 weeks", L.weekId(L.addDays(W.monday, 7 * 53))],
        ["not a week id", "zz-test-nope"],
      ];
      for (const [why, id] of refusedWeeks) {
        L.createdWeeks.add(id);
        const r = await call(sm.context, A.moveRoadmapItemLane, [L.ids.seeded, id], "/roadmap");
        expect(`scrum master -> moveRoadmapItemLane into ${why} (${id}): refused, no lane, the item stays`,
          r.kind === "error" && !(await laneExists(id)) && (await itemRow(L.ids.seeded)).lane_id === lane, r.kind);
      }
      // The card to go before must be an item of the target week: not one of a group, nor of a week not created yet.
      const refusedBefore = [
        ["a group, before an item", [L.ids.seeded, "zz-test-b", L.ids.adminItem], null],
        ["a week not created yet, before an item of another week", [L.ids.seeded, trailing, L.ids.adminItem], trailing],
        ["its own week, before an item of no week", [L.ids.seeded, lane, "00000000-0000-0000-0000-000000000000"], null],
      ];
      for (const [why, args, week] of refusedBefore) {
        const r = await call(sm.context, A.moveRoadmapItemLane, args, "/roadmap");
        expect(`scrum master -> moveRoadmapItemLane into ${why}: refused, the item stays${week ? ", no lane" : ""}`,
          r.kind === "error" && (await itemRow(L.ids.seeded)).lane_id === lane && !(week && (await laneExists(week))), r.kind);
      }
      // Before an item of its own week: the server renumbers the week, the admin's item too (out of the scrum master's
      // own reach), and queues nothing, since the item stays in its week.
      {
        await svc.from("roadmap_items").update({ sort_order: 5 }).in("id", [L.ids.adminItem, L.ids.smItem]);
        await svc.from("roadmap_items").update({ sort_order: 9 }).eq("id", L.ids.seeded);
        const since = new Date().toISOString();
        const r = await call(sm.context, A.moveRoadmapItemLane, [L.ids.seeded, lane, L.ids.adminItem], "/roadmap");
        const order = (await svc.from("roadmap_items").select("id, sort_order").eq("lane_id", lane).order("sort_order").order("id")).data ?? [];
        const at = (id) => order.findIndex((o) => o.id === id);
        const { data: q } = await svc.from("roadmap_sync_queue").select("id").eq("item_id", L.ids.seeded).gte("created_at", since);
        expect("scrum master -> the seeded item before the admin's, in its own week: saved right before it, the week numbered 0, 1, 2…, nothing queued",
          r.kind === "ok" && at(L.ids.seeded) >= 0 && at(L.ids.seeded) + 1 === at(L.ids.adminItem) && order.every((o, i) => o.sort_order === i) && (q ?? []).length === 0,
          `${r.kind} ${JSON.stringify(order)} queued=${(q ?? []).length}`);
      }
      const adminWeek = await call(sm.context, A.moveRoadmapItemLane, [L.ids.adminItem, trailing], "/roadmap");
      expect("scrum master -> the admin's item into a new week: refused before the week is created",
        adminWeek.kind === "error" && !(await laneExists(trailing)) && (await itemRow(L.ids.adminItem)).lane_id === lane, adminWeek.kind);

      const into = await call(sm.context, A.moveRoadmapItemLane, [L.ids.seeded, trailing], "/roadmap");
      const { data: born } = await svc.from("lanes").select("id, title, kind, start_date, end_date").eq("id", trailing);
      const end = L.addDays(W.trailing, 4);
      const title = `Sprint ${W.trailing.slice(5, 7) === end.slice(5, 7) ? W.trailing.slice(8, 10) : `${W.trailing.slice(8, 10)}/${W.trailing.slice(5, 7)}`}–${end.slice(8, 10)}/${end.slice(5, 7)}`;
      expect("scrum master -> the seeded item dropped on the empty week: the week's lane is created by its Monday, titled and dated by it",
        into.kind === "ok" && born?.length === 1 && born[0].kind === "sprint" && born[0].start_date === W.trailing && born[0].end_date === end && born[0].title === title && (await itemRow(L.ids.seeded)).lane_id === trailing,
        `${into.kind} ${JSON.stringify(born)}`);
      const { data: q } = await svc.from("roadmap_sync_queue").select("payload").eq("item_id", L.ids.seeded).eq("action", "move_lane").gte("created_at", t0);
      expect("scrum master -> the move into the new week is queued with both lanes", (q ?? []).some((r) => r.payload?.lane_id === trailing && r.payload?.from_lane_id === lane));

      const back = await call(sm.context, A.moveRoadmapItemLane, [L.ids.seeded, lane], "/roadmap");
      expect("scrum master -> moving the only item out of that future week deletes its lane",
        back.kind === "ok" && (await itemRow(L.ids.seeded)).lane_id === lane && !(await laneExists(trailing)), back.kind);

      // Deleting the last item of a future week deletes the week too (checked at the delete of the SM's own item below).
      const ownInto = await call(sm.context, A.moveRoadmapItemLane, [L.ids.smItem, trailing], "/roadmap");
      expect("scrum master -> own item into the empty week: the lane is created again", ownInto.kind === "ok" && (await laneExists(trailing)), ownInto.kind);
    }

    const smOk = [
      ["saveRoadmapItemEdit (own item)", A.saveRoadmapItemEdit, [L.ids.smItem, edit({ prioridade: "High", note: "[TESTE] nota com activeView=dev forjado" })], "/roadmap"],
      ["saveRoadmapItemEdit (seeded: priority + note)", A.saveRoadmapItemEdit, [L.ids.seeded, edit({ prioridade: "High" })], "/roadmap"],
      ["moveRoadmapItemLane (seeded item)", A.moveRoadmapItemLane, [L.ids.seeded, "zz-test-b"], "/roadmap"],
      // Sent a week, on purpose: the server picks the lane of a new item, never the caller.
      ["createRoadmapItem", A.createRoadmapItem, [lane], "/roadmap"],
    ];
    for (const [name, id, args, p] of smOk) {
      const r = await call(sm.context, id, args, p);
      expect(`scrum master -> ${name}: allowed`, r.kind === "ok", `${r.kind} ${r.returned.slice(0, 50)}`);
    }
    const spoof = (await svc.from("item_notes").select("author_role, author_id").eq("item_id", L.ids.smItem)).data;
    expect("scrum master -> a note sent with activeView='dev' is still stored as scrum_master (role can't be spoofed)", spoof.length === 1 && spoof[0].author_role === "scrum_master" && spoof[0].author_id === L.ids.sm, JSON.stringify(spoof));
    const created = (await svc.from("roadmap_items").select("created_by, lane_id").eq("created_by", L.ids.sm).neq("id", L.ids.smItem)).data;
    expect("scrum master -> the created item belongs to the Scrum Master", created.length === 1);
    expect("scrum master -> the created item is born in the feature type lane, with no week, though a week was sent (the Kanban's Open)",
      created.length === 1 && created[0].lane_id === "tipo-feature", JSON.stringify(created.map((r) => r.lane_id)));
    const delOwn = await call(sm.context, A.deleteRoadmapItem, [L.ids.smItem], "/roadmap");
    expect("scrum master -> deleteRoadmapItem (own item): allowed", delOwn.kind === "ok" && (await itemRow(L.ids.smItem)) === undefined, `${delOwn.kind}`);
    expect("scrum master -> deleting the only item of a future week deletes its lane", !(await laneExists(trailing)), trailing);

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
    expect("admin -> resetUserPassword on an unknown account answers 'not found' and touches nothing", r8.kind === "ok" && /"ok":false/.test(r8.returned) && /User not found/.test(r8.returned), r8.returned.slice(0, 90));

    // an account flagged for a password change is refused by the privileged actions until it has changed it
    await svc.from("profiles").update({ must_reset_password: true }).eq("id", L.ids.sm);
    const flaggedSm = await call(sm.context, A.createRoadmapItem, [], "/roadmap");
    expect("flagged Scrum Master -> createRoadmapItem is refused until the password is changed", flaggedSm.kind === "error", flaggedSm.kind);
    await svc.from("profiles").update({ must_reset_password: false }).eq("id", L.ids.sm);
    const unflaggedSm = await call(sm.context, A.createRoadmapItem, [], "/roadmap");
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
    await L.expectNoTestIssues(t0);
    await L.cleanup(t0);
  }
  process.exit(L.summary("SERVER ACTIONS") ? 1 : 0);
})();
