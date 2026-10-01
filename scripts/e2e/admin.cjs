const L = require("./lib.cjs");
const { BASE, expect, sleep, svc } = L;

(async () => {
  const t0 = new Date().toISOString();
  await L.ensureFixtures();
  const browser = await L.launch();
  try {
    const s = await L.newSession(browser, "admin", { width: 1440, height: 3600 });
    const { page } = s;
    page.on("dialog", (d) => d.accept());
    const menu = L.menuButton(page);
    const count = (loc) => loc.count();

    await L.login(s);
    await menu.waitFor();
    expect("login: lands on /dashboard", page.url().endsWith("/dashboard"), page.url());
    expect("header label says Admin", (await menu.innerText()).trim() === "Admin");
    expect("nav shows the Config tab", (await count(page.getByRole("link", { name: "Config", exact: true }))) === 1);

    // ------------------------------------------------ Config: users table
    await page.getByRole("link", { name: "Config", exact: true }).click();
    await page.waitForURL("**/config");
    await page.getByText("Usuários", { exact: true }).waitFor({ timeout: 30000 });
    await page.locator("tbody tr").first().waitFor();
    const rows = page.locator("tbody tr");
    expect("config: lists the 4 accounts", (await count(rows)) === 4, String(await count(rows)));
    const adminRows = rows.filter({ hasText: "Admin" }).filter({ hasNot: page.locator("select") });
    expect("config: admin rows show a fixed 'Admin' badge (no role select)", (await count(adminRows)) === 2, String(await count(adminRows)));
    expect("config: the two non-admin accounts get a role select", (await count(page.locator("tbody select"))) === 2);
    expect("config: every row has 'Resetar senha'", (await count(page.getByRole("button", { name: "Resetar senha" }))) === 4);

    const devRow = rows.filter({ hasText: "RoadS Tester Dev" });
    await devRow.locator("select").selectOption("scrum_master");
    await sleep(2500);
    const { data: promoted } = await svc.from("profiles").select("role").eq("id", L.ids.dev).single();
    expect("config: promoting the Dev account to Scrum Master is saved", promoted.role === "scrum_master", promoted.role);
    await devRow.locator("select").selectOption("dev");
    await sleep(2500);
    const { data: demoted } = await svc.from("profiles").select("role").eq("id", L.ids.dev).single();
    expect("config: and back to Dev", demoted.role === "dev", demoted.role);
    await page.reload({ waitUntil: "load" });
    await page.locator("tbody tr").first().waitFor();
    expect("config: the page shows the saved role after a reload", (await page.locator("tbody tr", { hasText: "RoadS Tester Dev" }).locator("select").inputValue()) === "dev");

    // ------------------------------------------------ Roadmap: full control over everybody's items
    await page.goto(BASE + "/roadmap", { waitUntil: "load" });
    await page.getByText("Carregando...").waitFor({ state: "detached", timeout: 30000 });
    await page.getByText("[TESTE] item do scrum master").waitFor();
    const card = (title) => page.locator("div[draggable]", { hasText: title }).first();
    const btn = (c, name) => c.getByRole("button", { name, exact: true });
    for (const [label, title] of [["admin's own item", "[TESTE] item do admin"], ["Scrum Master's item", "[TESTE] item do scrum master"], ["seeded item", "[TESTE] item semeado (sem dono)"]]) {
      const c = card(title);
      expect(`roadmap: ${label} is draggable with Editar and Excluir`, (await c.getAttribute("draggable")) === "true" && (await count(btn(c, "Editar"))) === 1 && (await count(btn(c, "Excluir"))) === 1);
    }
    expect("roadmap: no 'Config' tab missing, and the subtitle is the editor one", (await count(page.getByText(/defina o que entra e quando/))) === 1);

    // edit the Scrum Master's item (title) and the seeded item (title: only admin may)
    await btn(card("[TESTE] item do scrum master"), "Editar").click();
    const editing = () => page.locator('div[draggable="false"]:has(input[placeholder^="Escrever nota"])');
    await editing().locator("input").first().fill("[TESTE] SM item, renomeado pelo admin");
    await editing().getByPlaceholder("Escrever nota (opcional)...").fill("[TESTE] nota do admin");
    await btn(editing(), "Salvar").click();
    await page.getByText("[TESTE] SM item, renomeado pelo admin").first().waitFor({ timeout: 15000 });
    await sleep(1200);
    const { data: renamed } = await svc.from("roadmap_items").select("title, created_by").eq("id", L.ids.smItem).single();
    const { data: aNotes } = await svc.from("item_notes").select("author_role, author_id").eq("item_id", L.ids.smItem);
    expect("admin renames a Scrum Master's item; the owner stays the Scrum Master", renamed.title === "[TESTE] SM item, renomeado pelo admin" && renamed.created_by === L.ids.sm);
    expect("admin's note is stored under the admin's id", aNotes.length === 1 && aNotes[0].author_id === L.ids.admin, JSON.stringify(aNotes));

    await btn(card("[TESTE] item semeado (sem dono)"), "Editar").click();
    await editing().locator("input").first().fill("[TESTE] semeado, renomeado pelo admin");
    await btn(editing(), "Salvar").click();
    await page.getByText("[TESTE] semeado, renomeado pelo admin").first().waitFor({ timeout: 15000 });
    await sleep(1000);
    const { data: seededRow } = await svc.from("roadmap_items").select("title").eq("id", L.ids.seeded).single();
    expect("admin can rename a seeded item (the one thing no Scrum Master can do)", seededRow.title === "[TESTE] semeado, renomeado pelo admin");

    // drag the Scrum Master's item into a group lane, and it must stay on screen
    const groupBox = (t) => page.getByText(t, { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]");
    const source = card("[TESTE] SM item, renomeado pelo admin");
    await source.scrollIntoViewIfNeeded();
    const c = await source.boundingBox();
    const tgt = await groupBox("[TESTE] lane A (apagar)").boundingBox();
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width / 2 + 10, c.y + c.height / 2 + 10, { steps: 5 });
    await page.mouse.move(tgt.x + tgt.width / 2, tgt.y + 12, { steps: 25 });
    await page.mouse.up();
    await sleep(2000);
    const { data: moved } = await svc.from("roadmap_items").select("lane_id").eq("id", L.ids.smItem).single();
    expect("admin drags another user's item into a group lane: saved", moved.lane_id === "zz-test-a", moved.lane_id);
    expect("…and the card stays on screen (it used to vanish until a reload)", (await count(card("[TESTE] SM item, renomeado pelo admin"))) === 1);

    // delete other people's items
    await btn(card("[TESTE] semeado, renomeado pelo admin"), "Excluir").click();
    await sleep(1800);
    await btn(card("[TESTE] SM item, renomeado pelo admin"), "Excluir").click();
    await sleep(1800);
    const left = (await svc.from("roadmap_items").select("id").in("id", [L.ids.seeded, L.ids.smItem])).data.length;
    expect("admin deletes a seeded item and a Scrum Master's item", left === 0, String(left));

    // ------------------------------------------------ dashboard + sync fails closed
    await page.goto(BASE + "/dashboard", { waitUntil: "load" });
    await page.getByRole("button", { name: /Sincronizar/ }).click();
    expect("dashboard: Sincronizar with no GitHub token fails closed", await page.getByText(/ainda não configurada/).waitFor({ timeout: 20000 }).then(() => true, () => false));

    // ------------------------------------------------ idle and Sair
    await page.evaluate(() => localStorage.setItem("roads-last-activity", String(Date.now() - (10 * 60 + 1) * 1000)));
    await page.waitForURL("**/login", { timeout: 45000 });
    expect("idle: 10 minutes and 1 second signs the admin out", true);
    await L.login(s);
    await menu.waitFor();
    await menu.click();
    await page.getByRole("button", { name: "Sair" }).click();
    await page.waitForURL("**/login");
    await page.goto(BASE + "/config", { waitUntil: "load" });
    expect("logout: Sair ends the session (/config bounces to /login)", page.url().endsWith("/login"), page.url());

    const noise = s.problems.filter((p) => !/auth\/v1\/token|ERR_FAILED|Failed to load resource/.test(p));
    expect("no console errors, hydration errors or failed requests during the whole run", noise.length === 0, noise.slice(0, 3).join(" | "));
  } catch (e) {
    expect("run completed without an exception", false, L.scrub(e && e.message ? e.message : e).slice(0, 300));
  } finally {
    await browser.close();
    await L.cleanup(t0);
  }
  process.exit(L.summary("ADMIN") ? 1 : 0);
})();
