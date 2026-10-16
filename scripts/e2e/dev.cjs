const L = require("./lib.cjs");
const { BASE, expect, sleep, svc } = L;

(async () => {
  const t0 = new Date().toISOString();
  await L.ensureFixtures();
  const browser = await L.launch();
  // The Dashboard's own sync and its button are checked past the brake, whatever production synced lately.
  const restoreSnapshot = await L.ageSnapshot();
  try {
    const s = await L.newSession(browser, "dev");
    const { page } = s;
    const menu = L.menuButton(page);

    // ------------------------------------------------ login errors (no user enumeration)
    await page.goto(BASE + "/login", { waitUntil: "load" });
    await page.locator('input[type="email"]').fill(L.cred("ROADS_TEST_DEV_EMAIL"));
    await page.locator('input[type="password"]').fill("senha-errada-123");
    await page.locator('button[type="submit"]').click();
    await page.getByText(/incorretos/).waitFor({ timeout: 15000 });
    const wrongPassword = (await page.getByText(/incorretos/).innerText()).trim();
    await page.locator('input[type="email"]').fill("ninguem.existe@essencislabs.com");
    await page.locator('button[type="submit"]').click();
    await sleep(2500);
    const unknownUser = (await page.getByText(/incorretos/).innerText()).trim();
    expect("login: wrong password shows a message and stays on /login", page.url().endsWith("/login") && /incorretos/.test(wrongPassword), wrongPassword);
    expect("login: unknown e-mail gets the SAME message (no user enumeration)", wrongPassword === unknownUser);

    // ------------------------------------------------ valid login
    // The Dashboard syncs by itself on opening (src/lib/auto-sync.ts): a server action POST nobody clicked for.
    const autoSyncs = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"] && new URL(r.url()).pathname === "/dashboard") autoSyncs.push(r.url());
    });
    await L.login(s);
    await menu.waitFor();
    expect("login: lands on /dashboard, not on the forced-reset page", page.url().endsWith("/dashboard"), page.url());
    expect("header label says Dev", (await menu.innerText()).trim() === "Dev");
    const tabs = await page.locator("a[href='/dashboard'], a[href='/roadmap'], a[href='/config']").allInnerTexts();
    expect("nav has Dashboard and Roadmap, but no Config", tabs.includes("Dashboard") && tabs.includes("Roadmap") && !tabs.includes("Config"), JSON.stringify(tabs));

    // ------------------------------------------------ dashboard
    await sleep(1500);
    expect("dashboard: opening it asks the server for a sync without anyone clicking", autoSyncs.length >= 1, `posts=${autoSyncs.length}`);
    // The blocks it keeps (Sprint, and the Slices of its issues under it) and the ones it dropped.
    const block = (title) => page.getByText(title, { exact: true }).count();
    expect("dashboard: has the Sprint block, the Slices block and the 'Concluídas' KPI", (await block("Sprint")) === 1 && (await block("Slices")) === 1 && (await block("Concluídas")) === 1);
    const dropped = [];
    for (const title of ["Em paralelo", "Próxima semana", "Esta sprint", "Concluídas na sprint"]) if ((await block(title)) > 0) dropped.push(title);
    expect("dashboard: no 'Em paralelo', 'Próxima semana' or old titles", dropped.length === 0, dropped.join(", "));
    expect("dashboard: Slices sits between the Sprint block and the Kanban", await page.evaluate(() => {
      const order = ["Sprint", "Slices", "Kanban"].map((t) => [...document.querySelectorAll("span")].find((el) => el.textContent === t));
      return order.every(Boolean) && order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING && order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING;
    }));
    // The Slices list their issues from the highest number to the lowest (src/lib/issue-order.ts); a week keeps the
    // order the scrum master gave it on the Roadmap (roadmap_items.sort_order). Both read on the real sprint.
    const descending = (refs) => refs.every((r, i) => i === 0 || r <= refs[i - 1]);
    const inStoredOrder = (orders) => orders.every((o, i) => o !== undefined && (i === 0 || o >= orders[i - 1]));
    const numbersIn = (texts) => texts.map((t) => Number(t.match(/^#(\d+)$/)?.[1])).filter((n) => n > 0);
    const sprintBlock = page.getByText("Sprint", { exact: true }).locator("xpath=..");
    const sprintNumbers = numbersIn(await sprintBlock.locator("span.font-mono").allInnerTexts());
    const W = await L.weeks();
    const currentWeek = W.real.find((l) => l.start_date <= W.monday && W.monday <= l.end_date);
    const weekRows = currentWeek ? (await svc.from("roadmap_items").select("github_issue_url, sort_order").eq("lane_id", currentWeek.id)).data ?? [] : [];
    const orderOfIssue = new Map(weekRows.map((r) => [Number(r.github_issue_url?.match(/\/issues\/(\d+)/)?.[1]), r.sort_order]));
    const sprintStored = sprintNumbers.map((n) => orderOfIssue.get(n));
    expect("dashboard: the Sprint block lists the current week's issues in the order saved for the week (sort_order), not by number",
      sprintNumbers.length > 1 && inStoredOrder(sprintStored), JSON.stringify({ sprintNumbers, sprintStored }));
    const slicesBlock = page.getByText("Slices", { exact: true }).locator("xpath=..");
    const parents = numbersIn(await slicesBlock.locator("section > div span.font-mono").allInnerTexts());
    const rowsOk = await slicesBlock.locator("section").evaluateAll((sections) =>
      sections.every((s) => {
        // Rows of boxes (acceptance criteria) carry no number and keep the issue's order: only sub-issue rows are ordered.
        const n = [...s.querySelectorAll(":scope > a span.font-mono")].map((el) => Number(el.textContent.replace("#", ""))).filter((x) => x > 0);
        return n.every((x, i) => i === 0 || x <= n[i - 1]);
      })
    );
    expect("dashboard: the Slices blocks, and the slices in each, go from the highest issue number to the lowest", descending(parents) && rowsOk, JSON.stringify(parents));
    const notConfigured = () => page.getByText(/ainda não configurada/).waitFor({ timeout: 20000 }).then(() => true, () => false);
    expect("dashboard: its own sync with no GitHub token fails closed with a clear message (nothing reaches GitHub)", await notConfigured());
    const sync = page.getByRole("button", { name: /Sincronizar/ });
    expect("dashboard: shows the (read-refresh) Sincronizar button", (await sync.count()) === 1);
    const before = autoSyncs.length;
    await sync.click();
    await sleep(300);
    // The click clears the message and asks again: a new POST, and the message comes back from that answer.
    const cleared = (await page.getByText(/ainda não configurada/).count()) === 0 || autoSyncs.length > before;
    expect("dashboard: Sincronizar asks the server again and fails closed the same way", cleared && (await notConfigured()) && autoSyncs.length > before, `posts ${before} -> ${autoSyncs.length}`);

    // ------------------------------------------------ roadmap is read-only
    await page.getByRole("link", { name: "Roadmap", exact: true }).click();
    await page.waitForURL("**/roadmap");
    await page.getByText("Carregando...").waitFor({ state: "detached", timeout: 30000 });
    await page.getByText("[TESTE] item semeado (sem dono)").waitFor({ timeout: 15000 });
    const shownWeeks = await page.locator('[data-drag-scroll="x"] > [data-lane-id]').evaluateAll((lanes) =>
      lanes.map((lane) => [...lane.querySelectorAll("[data-item-id]")].map((card) => card.dataset.itemId))
    );
    const shownIds = shownWeeks.flat();
    const storedOrder = new Map(((await svc.from("roadmap_items").select("id, sort_order").in("id", shownIds.length ? shownIds : ["00000000-0000-0000-0000-000000000000"])).data ?? []).map((r) => [r.id, r.sort_order]));
    const weekOrders = shownWeeks.map((ids) => ids.map((id) => storedOrder.get(id)));
    expect(
      "roadmap: each of the sprints lists its items in the order saved for the week (sort_order), not by issue number",
      weekOrders.some((o) => o.length > 1) && weekOrders.every(inStoredOrder),
      JSON.stringify(weekOrders)
    );
    const count = (loc) => loc.count();
    expect("roadmap: dev can READ the board (fixture items visible)", (await count(page.getByText("[TESTE] item do scrum master"))) === 1);
    expect("roadmap: no '+ Novo item'", (await count(page.getByRole("button", { name: "+ Novo item" }))) === 0);
    expect("roadmap: the same read-refresh Sincronizar button as the Dashboard", (await count(page.getByRole("button", { name: /^Sincronizar$/ }))) === 1);
    expect("roadmap: no Editar / + nota / Excluir", (await count(page.getByRole("button", { name: /^(Editar|\+ nota|Excluir)$/ }))) === 0);
    expect("roadmap: no card is draggable", (await count(page.locator('div[draggable="true"]'))) === 0);
    expect("roadmap: no 'Mover para' select", (await count(page.locator('select[aria-label="Mover para"]'))) === 0);
    expect("roadmap: plain subtitle (no 'defina o que entra e quando')", (await count(page.getByText(/defina o que entra/))) === 0);
    expect("roadmap: the user area never shows 'Entrar'", (await count(page.locator('a[href="/login"]'))) === 0);

    // ------------------------------------------------ /config is closed to everyone but admin
    await page.goto(BASE + "/config", { waitUntil: "load" });
    expect("direct visit to /config is sent back to /dashboard", page.url().endsWith("/dashboard"), page.url());

    // ------------------------------------------------ avatar (own profile only)
    // The pick is saved by its own request, not a server action: the browser sends actions one at a time, so a
    // pick queued behind the Dashboard's own sync, and a reload in that time showed the old picture (13-14/10) or lost it.
    // Here the sync is held open on purpose and the save must still come back before it is let go.
    let releaseSync;
    const syncHeld = new Promise((r) => (releaseSync = r));
    let heldSyncs = 0;
    const holdSync = async (route) => {
      if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
      heldSyncs++;
      await syncHeld;
      await route.continue().catch(() => {});
    };
    await page.route("**/dashboard", holdSync);
    // Start from another picture, so a page still showing the old one can't pass by luck.
    await L.svc.from("profiles").update({ avatar: "avatar-05" }).eq("id", L.ids.dev);
    await page.reload({ waitUntil: "load" });
    await menu.waitFor();
    for (let waited = 0; heldSyncs === 0 && waited < 15000; waited += 100) await sleep(100);
    await menu.click();
    const saveAnswer = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/profile/avatar", { timeout: 15000 });
    await page.locator('button[aria-label="Foto 02"]').click();
    const saveStatus = await saveAnswer.then((r) => r.status(), () => "no answer");
    expect("avatar: the pick is saved while the page's own sync is still under way (it does not wait behind it)", heldSyncs >= 1 && saveStatus === 200, `held syncs=${heldSyncs}, save=${saveStatus}`);
    releaseSync();
    await page.unroute("**/dashboard", holdSync);
    await page.reload({ waitUntil: "load" });
    await menu.waitFor();
    const shown = await menu.locator("img").getAttribute("src");
    const { data: row } = await L.svc.from("profiles").select("avatar, role").eq("id", L.ids.dev).single();
    expect("avatar: a Dev can pick a picture and it persists", /avatar-02\.svg$/.test(shown ?? "") && row.avatar === "avatar-02", `${shown} / db=${row.avatar}`);
    expect("avatar: choosing a picture did not change the Dev's role", row.role === "dev");

    // ------------------------------------------------ the API routes refuse a signed-in Dev too
    const cron = await page.evaluate(async () => (await fetch("/api/cron/sync-board")).status);
    const queue = await page.evaluate(async () => (await fetch("/api/frontlights/pending-changes")).status);
    const roadmapState = await page.evaluate(async () => (await fetch("/api/frontlights/roadmap-state")).status);
    const syncRoute = await page.evaluate(async () => (await fetch("/api/frontlights/sync-board", { method: "POST" })).status);
    expect("api: cron, queue, roadmap-state and sync-board answer 401 to a signed-in Dev (they take secrets, not sessions)", cron === 401 && queue === 401 && roadmapState === 401 && syncRoute === 401, `${cron}/${queue}/${roadmapState}/${syncRoute}`);

    // ------------------------------------------------ idle logout and Sair
    await page.evaluate(() => localStorage.setItem("roads-last-activity", String(Date.now() - (10 * 60 + 1) * 1000)));
    const t = Date.now();
    await page.waitForURL("**/login", { timeout: 45000 });
    expect("idle: 10 minutes and 1 second of inactivity signs the Dev out", true, `${((Date.now() - t) / 1000).toFixed(1)}s`);
    await page.goto(BASE + "/roadmap", { waitUntil: "load" });
    expect("idle: the session is really gone (/roadmap bounces to /login)", page.url().endsWith("/login"), page.url());

    await L.login(s);
    await menu.waitFor();
    await menu.click();
    await page.getByRole("button", { name: "Sair" }).click();
    await page.waitForURL("**/login");
    await page.goto(BASE + "/dashboard", { waitUntil: "load" });
    expect("logout: Sair ends the session", page.url().endsWith("/login"));

    const noise = s.problems.filter((p) => !/auth\/v1\/token|ERR_FAILED|Failed to load resource|\/api\/(cron|frontlights)\//.test(p));
    expect("no console errors, hydration errors or failed requests during the whole run", noise.length === 0, noise.slice(0, 3).join(" | "));
  } catch (e) {
    expect("run completed without an exception", false, L.scrub(e && e.message ? e.message : e).slice(0, 200));
  } finally {
    await restoreSnapshot();
    await browser.close();
    await L.cleanup(t0);
  }
  process.exit(L.summary("DEV") ? 1 : 0);
})();
