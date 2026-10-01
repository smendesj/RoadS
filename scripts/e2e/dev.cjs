const L = require("./lib.cjs");
const { BASE, expect, sleep } = L;

(async () => {
  const t0 = new Date().toISOString();
  await L.ensureFixtures();
  const browser = await L.launch();
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
    await L.login(s);
    await menu.waitFor();
    expect("login: lands on /dashboard, not on the forced-reset page", page.url().endsWith("/dashboard"), page.url());
    expect("header label says Dev", (await menu.innerText()).trim() === "Dev");
    const tabs = await page.locator("a[href='/dashboard'], a[href='/roadmap'], a[href='/config']").allInnerTexts();
    expect("nav has Dashboard and Roadmap, but no Config", tabs.includes("Dashboard") && tabs.includes("Roadmap") && !tabs.includes("Config"), JSON.stringify(tabs));

    // ------------------------------------------------ dashboard
    await sleep(1500);
    const sync = page.getByRole("button", { name: /Sincronizar/ });
    expect("dashboard: shows the (read-refresh) Sincronizar button", (await sync.count()) === 1);
    await sync.click();
    const notConfigured = await page.getByText(/ainda não configurada/).waitFor({ timeout: 20000 }).then(() => true, () => false);
    expect("dashboard: Sincronizar with no GitHub token fails closed with a clear message (nothing reaches GitHub)", notConfigured);

    // ------------------------------------------------ roadmap is read-only
    await page.getByRole("link", { name: "Roadmap", exact: true }).click();
    await page.waitForURL("**/roadmap");
    await page.getByText("Carregando...").waitFor({ state: "detached", timeout: 30000 });
    await page.getByText("[TESTE] item semeado (sem dono)").waitFor({ timeout: 15000 });
    const count = (loc) => loc.count();
    expect("roadmap: dev can READ the board (fixture items visible)", (await count(page.getByText("[TESTE] item do scrum master"))) === 1);
    expect("roadmap: no '+ Novo item'", (await count(page.getByRole("button", { name: "+ Novo item" }))) === 0);
    expect("roadmap: no 'Sincronizar issues'", (await count(page.getByRole("button", { name: /Sincronizar issues/ }))) === 0);
    expect("roadmap: no Editar / + nota / Excluir", (await count(page.getByRole("button", { name: /^(Editar|\+ nota|Excluir)$/ }))) === 0);
    expect("roadmap: no card is draggable", (await count(page.locator('div[draggable="true"]'))) === 0);
    expect("roadmap: no 'Mover para' select", (await count(page.locator('select[aria-label="Mover para"]'))) === 0);
    expect("roadmap: plain subtitle (no 'defina o que entra e quando')", (await count(page.getByText(/defina o que entra/))) === 0);
    expect("roadmap: the user area never shows 'Entrar'", (await count(page.locator('a[href="/login"]'))) === 0);

    // ------------------------------------------------ /config is closed to everyone but admin
    await page.goto(BASE + "/config", { waitUntil: "load" });
    expect("direct visit to /config is sent back to /dashboard", page.url().endsWith("/dashboard"), page.url());

    // ------------------------------------------------ avatar (own profile only)
    await menu.click();
    await page.locator('button[aria-label="Foto 02"]').click();
    await sleep(1500);
    await page.reload({ waitUntil: "load" });
    await menu.waitFor();
    const shown = await menu.locator("img").getAttribute("src");
    const { data: row } = await L.svc.from("profiles").select("avatar, role").eq("id", L.ids.dev).single();
    expect("avatar: a Dev can pick a picture and it persists", /avatar-02\.svg$/.test(shown ?? "") && row.avatar === "avatar-02", `${shown} / db=${row.avatar}`);
    expect("avatar: choosing a picture did not change the Dev's role", row.role === "dev");

    // ------------------------------------------------ the API routes refuse a signed-in Dev too
    const cron = await page.evaluate(async () => (await fetch("/api/cron/sync-board")).status);
    const queue = await page.evaluate(async () => (await fetch("/api/frontlights/pending-changes")).status);
    expect("api: cron and queue routes answer 401 to a signed-in Dev (they take secrets, not sessions)", cron === 401 && queue === 401, `${cron}/${queue}`);

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
    await browser.close();
    await L.cleanup(t0);
  }
  process.exit(L.summary("DEV") ? 1 : 0);
})();
