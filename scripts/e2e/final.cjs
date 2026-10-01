// Cross-tab logout, narrow screens and dark mode, for every role. Local production server (UTC, no GitHub token).
const L = require("./lib.cjs");
const { BASE, expect, sleep } = L;

(async () => {
  const t0 = new Date().toISOString();
  await L.ensureFixtures();
  const browser = await L.launch();
  try {
    for (const role of ["dev", "sm", "admin"]) {
      const label = L.LABEL[role];
      console.log(`\n--- ${label} ---`);

      // ---------- dark mode survives navigation and a reload, with no hydration noise
      const s = await L.newSession(browser, role);
      const { page, context } = s;
      await L.login(s);
      const menu = L.menuButton(page);
      await menu.waitFor();
      await page.locator('button[aria-label="Alternar tema"]').click();
      await sleep(400);
      const dark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
      expect(`${label}: dark mode switches on`, await dark());
      await page.goto(BASE + "/roadmap", { waitUntil: "load" });
      await menu.waitFor();
      expect(`${label}: dark mode survives a full page load`, await dark());
      await page.locator('button[aria-label="Alternar tema"]').click();
      await page.evaluate(() => localStorage.removeItem("roads-theme"));

      // ---------- no horizontal scroll at phone widths, on every page the role can open
      const pages = ["/dashboard", "/roadmap", ...(role === "admin" ? ["/config"] : [])];
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 800 });
        for (const path of pages) {
          await page.goto(BASE + path, { waitUntil: "load" });
          await menu.waitFor();
          await sleep(1200);
          const m = await page.evaluate(() => ({ w: window.innerWidth, sw: document.documentElement.scrollWidth }));
          expect(`${label}: ${path} at ${width}px has no sideways scroll`, m.sw <= m.w + 1, `scrollWidth ${m.sw} vs ${m.w}`);
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });

      // ---------- Sair in one tab takes the other tab to /login too (real network)
      await page.goto(BASE + "/dashboard", { waitUntil: "load" });
      await menu.waitFor();
      const tabB = await context.newPage();
      await tabB.goto(BASE + "/roadmap", { waitUntil: "load" });
      await L.menuButton(tabB).waitFor();
      await sleep(1500);
      await page.bringToFront();
      await menu.click();
      const t = Date.now();
      await page.getByRole("button", { name: "Sair" }).click();
      await Promise.all([page.waitForURL("**/login", { timeout: 30000 }), tabB.waitForURL("**/login", { timeout: 30000 })]);
      expect(`${label}: Sair in one tab sends both tabs to /login`, true, `${((Date.now() - t) / 1000).toFixed(1)}s`);
      await tabB.goto(BASE + "/dashboard", { waitUntil: "load" });
      expect(`${label}: the other tab can't reopen the app`, tabB.url().endsWith("/login"));

      const noise = s.problems.filter((p) => !/auth\/v1\/token|ERR_FAILED|Failed to load resource/.test(p));
      expect(`${label}: no console or hydration errors`, noise.length === 0, noise.slice(0, 3).join(" | "));
    }
  } catch (e) {
    expect("run completed without an exception", false, L.scrub(e && e.message ? e.message : e).slice(0, 300));
  } finally {
    await browser.close();
    await L.cleanup(t0);
  }
  process.exit(L.summary("FINAL (dark mode, phone widths, cross-tab)") ? 1 : 0);
})();
