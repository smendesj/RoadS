const L = require("./lib.cjs");
const { BASE, expect, sleep } = L;

// A made-up issue of the current sprint, converted to boxes: three boxes of acceptance criteria (one ticked, one
// with a "Bloqueada:" sub-item), one sub-issue still open and two closed in the conversion. The test server can't
// read GitHub (GITHUB_TOKEN is empty), so its parts go straight into the board snapshot, the way the sync stores
// them; the closed ones are kept there, as a snapshot written before 16/10/2026 has them, and must not show. The
// numbers are far above any real issue, so nothing real is ever named.
const GEOCLOUD = "https://github.com/Essencis-Labs/GeoCloudAI/issues/";
const SEED = {
  number: 990001,
  title: "[TESTE] issue com critérios",
  open: { number: 990004, title: "[TESTE] sub-issue aberta" },
  closed: [990002, 990003].map((number) => ({ number, title: `[TESTE] sub-issue fechada ${number}` })),
  boxes: [
    { text: "S1. [TESTE] primeira parte.", checked: true, blocked: null },
    { text: "S2. [TESTE] segunda parte.", checked: false, blocked: "falta a chave de teste" },
    { text: "S3. [TESTE] terceira parte.", checked: false, blocked: null },
  ],
};
// The lane the Dashboard reads as the current sprint (src/lib/actions/dashboard.ts).
const CURRENT_SPRINT = "atual";

// Puts the made-up issue in the current sprint and its parts in the snapshot; the returned function takes both out
// again, leaving the rest of the snapshot as the last real sync wrote it.
async function seedSprintIssue() {
  const { data: item, error } = await L.svc
    .from("roadmap_items")
    .insert({ lane_id: CURRENT_SPRINT, title: SEED.title, description: "descrição de teste", created_by: null, github_issue_url: GEOCLOUD + SEED.number, github_issue_number: SEED.number })
    .select("id")
    .single();
  if (error) throw error;
  const group = {
    parent: { number: SEED.number, title: SEED.title, url: GEOCLOUD + SEED.number },
    total: 4,
    items: [
      { number: SEED.open.number, title: SEED.open.title, url: GEOCLOUD + SEED.open.number, state: "open" },
      ...SEED.closed.map((c) => ({ number: c.number, title: c.title, url: GEOCLOUD + c.number, state: "closed" })),
    ],
    boxes: SEED.boxes,
  };
  // A failed read would write the snapshot back empty, and a failed write would leave the seed behind: both stop the run.
  const others = async () => {
    const { data, error } = await L.svc.from("board_sync_state").select("slices").eq("id", true).single();
    if (error) throw error;
    return (data?.slices ?? []).filter((g) => g?.parent?.number !== SEED.number);
  };
  const setSlices = async (slices) => {
    const { error } = await L.svc.from("board_sync_state").update({ slices }).eq("id", true);
    if (error) throw error;
  };
  await setSlices([group, ...(await others())]);
  return async () => {
    // The item is taken out even when the snapshot can't be restored; the first failure is the one thrown.
    const failures = [];
    try {
      await setSlices(await others());
    } catch (e) {
      failures.push(e);
    }
    const { error } = await L.svc.from("roadmap_items").delete().eq("id", item.id);
    if (error) failures.push(error);
    if (failures.length > 0) throw failures[0];
  };
}

(async () => {
  const t0 = new Date().toISOString();
  await L.ensureFixtures();
  const browser = await L.launch();
  // The Dashboard's own sync and its button are checked past the brake, whatever production synced lately.
  const restoreSnapshot = await L.ageSnapshot();
  let unseed = async () => {};
  let unseedFailed = false;
  try {
    unseed = await seedSprintIssue();
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
    // The blocks it keeps (Sprint, with the parts of each issue under it) and the ones it dropped.
    const block = (title) => page.getByText(title, { exact: true }).count();
    expect("dashboard: has the Sprint block and the 'Concluídas' KPI, and no Slices block", (await block("Sprint")) === 1 && (await block("Slices")) === 0 && (await block("Concluídas")) === 1);
    const dropped = [];
    for (const title of ["Em paralelo", "Próxima semana", "Esta sprint", "Concluídas na sprint"]) if ((await block(title)) > 0) dropped.push(title);
    expect("dashboard: no 'Em paralelo', 'Próxima semana' or old titles", dropped.length === 0, dropped.join(", "));
    expect("dashboard: the Sprint block sits above the Kanban", await page.evaluate(() => {
      const order = ["Sprint", "Kanban"].map((t) => [...document.querySelectorAll("span")].find((el) => el.textContent === t));
      return order.every(Boolean) && order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING;
    }));
    // Every block lists its issues from the highest number to the lowest (src/lib/issue-order.ts), read on the real sprint.
    const descending = (refs) => refs.every((r, i) => i === 0 || r <= refs[i - 1]);
    const numbersIn = (texts) => texts.map((t) => Number(t.match(/^#(\d+)$/)?.[1])).filter((n) => n > 0);
    const sprintBlock = page.getByText("Sprint", { exact: true }).locator("xpath=..");
    const sprintNumbers = numbersIn(await sprintBlock.locator("[data-issue] > :first-child span.font-mono").allInnerTexts());
    expect("dashboard: the Sprint block lists its issues from the highest number to the lowest", sprintNumbers.length > 1 && descending(sprintNumbers), JSON.stringify(sprintNumbers));
    const partsOk = await sprintBlock.locator("[data-issue]").evaluateAll((sections) =>
      sections.every((s) => {
        // The boxes keep the issue's order and come first; the open sub-issues after them, highest number first.
        const kinds = [...s.querySelectorAll(":scope > [data-part]")].map((el) => el.dataset.part);
        const n = [...s.querySelectorAll(':scope > [data-part="sub-issue"] span.font-mono')].map((el) => Number(el.textContent.replace("#", ""))).filter((x) => x > 0);
        return kinds.every((k, i) => i === 0 || k === kinds[i - 1] || k === "sub-issue") && n.every((x, i) => i === 0 || x <= n[i - 1]);
      })
    );
    expect("dashboard: under each issue, its boxes come first and its open sub-issues after, highest number first", partsOk);

    // The made-up issue converted to boxes: its three criteria right under it, its open sub-issue, and "1 de 4".
    const seeded = sprintBlock.locator("[data-issue]", { has: page.getByText(SEED.title, { exact: true }) });
    const seededShown = await seeded.waitFor({ timeout: 15000 }).then(() => true, () => false);
    expect("dashboard: an issue of the sprint converted to boxes is in the Sprint block", seededShown && (await seeded.count()) === 1);
    const partsCount = seededShown ? (await seeded.locator("[data-parts-count]").innerText()).trim() : "";
    expect("dashboard: its count is 1 de 4 (three boxes, one ticked, plus the open sub-issue; the closed ones don't count)", partsCount === "1 de 4", partsCount);
    const boxes = seededShown
      ? await seeded.evaluate((s) => {
          const issuePill = s.firstElementChild.querySelector("span").getBoundingClientRect().left;
          return [...s.querySelectorAll(':scope > [data-part="box"]')].map((row) => ({
            pill: row.querySelector("span").textContent,
            text: row.textContent,
            link: row.tagName === "A" || row.querySelector("a") !== null,
            indented: row.querySelector("span").getBoundingClientRect().left > issuePill + 8,
          }));
        })
      : [];
    expect(
      "dashboard: its three criteria are indented rows under it, with no link, CONCLUÍDO / BLOQUEADO / A FAZER in the order of the body",
      boxes.length === 3 &&
        boxes.every((b) => b.indented && !b.link) &&
        JSON.stringify(boxes.map((b) => b.pill)) === JSON.stringify(["CONCLUÍDO", "BLOQUEADO", "A FAZER"]) &&
        boxes.every((b, i) => b.text.includes(SEED.boxes[i].text)),
      JSON.stringify(boxes)
    );
    const subRows = seededShown ? await seeded.locator('[data-part="sub-issue"]').evaluateAll((rows) => rows.map((a) => [a.getAttribute("href"), a.textContent])) : [];
    expect(
      "dashboard: its open sub-issue is an extra row that links to it",
      subRows.length === 1 && subRows[0][0] === GEOCLOUD + SEED.open.number && subRows[0][1].includes(SEED.open.title) && subRows[0][1].includes(`#${SEED.open.number}`),
      JSON.stringify(subRows)
    );
    expect("dashboard: its sub-issues closed in the conversion are not shown", (await page.getByText(/\[TESTE\] sub-issue fechada/).count()) === 0);
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
    const sprintOrders = await page.locator('[data-drag-scroll="x"] > [data-lane-id]').evaluateAll((lanes) =>
      lanes.map((lane) => [...lane.querySelectorAll("div[draggable] a, div[draggable] > span")].map((a) => Number(a.textContent.match(/^#(\d+) /)?.[1])).filter((n) => n > 0))
    );
    expect(
      "roadmap: each of the sprints lists its issues from the highest number to the lowest",
      sprintOrders.some((n) => n.length > 1) && sprintOrders.every((n) => n.every((x, i) => i === 0 || x <= n[i - 1])),
      JSON.stringify(sprintOrders)
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
    // A seed left behind fails the run, without counting as one of its checks.
    await unseed().catch((e) => {
      unseedFailed = true;
      console.error("unseed failed:", L.scrub(e && e.message ? e.message : e));
    });
    await restoreSnapshot();
    await browser.close();
    await L.cleanup(t0);
  }
  process.exit(L.summary("DEV") || unseedFailed ? 1 : 0);
})();
