// READ-ONLY per-role smoke test of PRODUCTION: logs in as each test account and looks, never writes.
process.env.E2E_BASE = "https://roads-psi.vercel.app";
const L = require("./lib.cjs");
const { BASE, expect, sleep } = L;

(async () => {
  const browser = await L.launch();
  try {
    for (const role of ["dev", "sm", "admin"]) {
      const label = L.LABEL[role];
      console.log(`\n--- ${label} on production ---`);
      const s = await L.newSession(browser, role);
      const { page } = s;
      await L.login(s);
      const menu = L.menuButton(page);
      await menu.waitFor({ timeout: 30000 });
      await sleep(2000);
      expect(`${label}: lands on /dashboard`, page.url().endsWith("/dashboard"), page.url());
      expect(`${label}: header label`, (await menu.innerText()).trim() === label);
      const hrefs = await page.locator("a[href='/dashboard'], a[href='/roadmap'], a[href='/config']").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("href")))]);
      expect(`${label}: nav ${role === "admin" ? "has" : "has no"} Config`, hrefs.includes("/config") === (role === "admin"), JSON.stringify(hrefs));

      await page.goto(BASE + "/roadmap", { waitUntil: "load" });
      await page.getByText("Carregando...").waitFor({ state: "detached", timeout: 45000 });
      await sleep(800);
      const novo = await page.getByRole("button", { name: "+ Novo item" }).count();
      const syncIssues = await page.getByRole("button", { name: /Sincronizar issues/ }).count();
      const draggable = await page.locator('div[draggable="true"]').count();
      const mover = await page.locator('select[aria-label="Mover para"]').count();
      const editable = role !== "dev";
      expect(`${label}: roadmap controls ${editable ? "present" : "absent"} (novo ${novo}, sync ${syncIssues}, draggable ${draggable}, mover ${mover})`,
        editable ? novo === 3 && syncIssues === 1 && draggable > 0 && mover > 0 : novo === 0 && syncIssues === 0 && draggable === 0 && mover === 0);
      expect(`${label}: never sees 'Entrar' while signed in`, (await page.locator('a[href="/login"]').count()) === 0);

      await page.goto(BASE + "/config", { waitUntil: "load" });
      const onConfig = new URL(page.url()).pathname === "/config";
      expect(`${label}: /config ${role === "admin" ? "opens" : "bounces to /dashboard"}`, onConfig === (role === "admin"), page.url());
      if (role === "admin") {
        await page.locator("tbody tr").first().waitFor({ timeout: 30000 });
        expect("admin: Config lists the accounts", (await page.locator("tbody tr").count()) >= 4);
      }

      if (role === "dev") {
        // the cron-only sync must not be reachable as an endpoint any more
        const oldId = "00ac3b6ef692bf08d9ac587b902b687a76024068f2";
        const res = await page.context().request.post(BASE + "/dashboard", {
          headers: { "next-action": oldId, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: BASE },
          data: "[]",
          maxRedirects: 0,
        });
        const body = await res.text();
        expect("dev: the old syncBoard action id is gone on production", res.status() !== 200 || !/not_configured|"ok":/.test(body), `status ${res.status()}`);
        const headers = (await page.request.get(BASE + "/login")).headers();
        expect("production sends the security headers", headers["x-frame-options"] === "DENY" && /frame-ancestors 'none'/.test(headers["content-security-policy"] ?? "") && headers["x-content-type-options"] === "nosniff");
      }

      await menu.click();
      await page.getByRole("button", { name: "Sair" }).click();
      await page.waitForURL("**/login");
      await page.goto(BASE + "/dashboard", { waitUntil: "load" });
      expect(`${label}: Sair ends the session`, page.url().endsWith("/login"));
      const noise = s.problems.filter((p) => !/auth\/v1\/token|ERR_FAILED|Failed to load resource/.test(p));
      expect(`${label}: no console or hydration errors on production`, noise.length === 0, noise.slice(0, 3).join(" | "));
    }
  } catch (e) {
    expect("run completed without an exception", false, L.scrub(e && e.message ? e.message : e).slice(0, 300));
  } finally {
    await browser.close();
  }
  process.exit(L.summary("PRODUCTION") ? 1 : 0);
})();
