// Cross-tab logout, narrow screens and dark mode, for every role, and (#23 S3) English on every screen but the Prévia.
// Local production server (UTC, no GitHub token).
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
      await page.locator('button[aria-label="Toggle theme"]').click();
      await sleep(400);
      const dark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
      expect(`${label}: dark mode switches on`, await dark());
      await page.goto(BASE + "/roadmap", { waitUntil: "load" });
      await menu.waitFor();
      expect(`${label}: dark mode survives a full page load`, await dark());
      await page.locator('button[aria-label="Toggle theme"]').click();
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

      // ---------- Sign out in one tab takes the other tab to /login too (real network)
      await page.goto(BASE + "/dashboard", { waitUntil: "load" });
      await menu.waitFor();
      const tabB = await context.newPage();
      await tabB.goto(BASE + "/roadmap", { waitUntil: "load" });
      await L.menuButton(tabB).waitFor();
      await sleep(1500);
      await page.bringToFront();
      await menu.click();
      const t = Date.now();
      await page.getByRole("button", { name: "Sign out" }).click();
      await Promise.all([page.waitForURL("**/login", { timeout: 30000 }), tabB.waitForURL("**/login", { timeout: 30000 })]);
      expect(`${label}: Sign out in one tab sends both tabs to /login`, true, `${((Date.now() - t) / 1000).toFixed(1)}s`);
      await tabB.goto(BASE + "/dashboard", { waitUntil: "load" });
      expect(`${label}: the other tab can't reopen the app`, tabB.url().endsWith("/login"));

      const noise = s.problems.filter((p) => !/auth\/v1\/token|ERR_FAILED|Failed to load resource/.test(p));
      expect(`${label}: no console or hydration errors`, noise.length === 0, noise.slice(0, 3).join(" | "));
    }

    // ---------- #23 S3: the app speaks English everywhere but the Resumo's Prévia
    // As the admin (who sees every screen): Dashboard, Roadmap, an item's edit form, Config and the Resumo. What is read
    // is the text on screen (and the aria-labels, placeholders and titles), minus the Prévia and minus what people and
    // GitHub wrote (item titles, descriptions, Comments, issues and their parts, the "[TESTE]" items), searched for the
    // old Portuguese UI words.
    {
      console.log("\n--- Admin: English outside the Prévia (#23 S3) ---");
      const s = await L.newSession(browser, "admin");
      const { page } = s;
      await L.login(s);
      const menu = L.menuButton(page);
      await menu.waitFor();
      const PORTUGUESE = [
        "Sincronizar", "Sincronizando", "Sincronização", "sincronização", "Editar", "Excluir", "Salvar", "Cancelar", "Fechar",
        "Prioridade", "Semana", "semana", "Carregando", "Nenhum", "Nenhuma", "Sair", "Entrar", "Concluído", "Concluídas",
        "Resumo para a diretoria", "Resumo", "Visitante", "Usuários", "Senha", "Papel", "Título", "Descrição", "Tipo",
        "Mover para", "Bloqueios", "Bloqueado", "Comprometidas", "Última", "Resetar", "Andamento", "andamento", "Enviados",
        "Apresentar", "Foto do perfil", "Alternar tema", "Tela cheia", "Arraste", "Ver todas", "Novo item", "Menu do usuário",
      ];
      const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const found = (text) => PORTUGUESE.filter((w) => new RegExp(`(^|[^\\p{L}])${escape(w)}(?![\\p{L}])`, "u").test(text));
      // Each visible text node (and each aria-label, placeholder and title) on its own line, outside the zones left out.
      const screenText = () =>
        page
          .evaluate(() => {
            const skip = new Set();
            // The Prévia's whole component (editor, conference, e-mail, seal): the child of the Resumo screen that holds it.
            for (const mark of document.querySelectorAll('section[aria-label="Prévia"], iframe[title="Prévia"], [data-seal]')) {
              let el = mark;
              while (el.parentElement && el.parentElement !== document.body && !el.parentElement.querySelector(":scope > div > h1, :scope > h1")) el = el.parentElement;
              skip.add(el);
            }
            // Issues, their parts and links (GitHub's titles and acceptance criteria), and Comments (people's words).
            for (const el of document.querySelectorAll('[data-issue], [data-part], [data-issue-card], [data-comment-id], a[href*="/issues/"]')) skip.add(el);
            // A Roadmap card's own title, description and assignee names; its badges, labels and buttons stay.
            for (const el of document.querySelectorAll("[data-item-id] > span, [data-item-id] > a, [data-item-id] > p")) skip.add(el);
            const skipped = (el) => [...skip].some((z) => z.contains(el));
            const lines = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              const el = n.parentElement;
              if (!el || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName) || !n.textContent.trim()) continue;
              if (el.tagName !== "OPTION" && !el.checkVisibility()) continue;
              if (!skipped(el)) lines.push(n.textContent.trim());
            }
            for (const el of document.querySelectorAll("[aria-label], [placeholder], [title]")) {
              if (skipped(el)) continue;
              for (const a of ["aria-label", "placeholder", "title"]) if (el.getAttribute(a)) lines.push(el.getAttribute(a));
            }
            return lines.join("\n");
          })
          .then((text) => text.split("\n").filter((line) => !line.includes("[TESTE]")).join("\n"));
      const lang = () => page.evaluate(() => document.documentElement.lang);
      const check = async (where) => {
        const l = await lang();
        expect(`S3 ${where}: <html lang="en">`, l === "en", l);
        const words = found(await screenText());
        expect(`S3 ${where}: no Portuguese UI word on screen outside the Prévia`, words.length === 0, words.join(", "));
      };

      await page.goto(BASE + "/dashboard", { waitUntil: "load" });
      await menu.waitFor();
      await sleep(2500);
      await check("Dashboard");

      await page.goto(BASE + "/roadmap", { waitUntil: "load" });
      await page.getByText("Loading...").waitFor({ state: "detached", timeout: 30000 });
      await page.getByText("[TESTE] item do admin").first().waitFor({ timeout: 15000 });
      await sleep(800);
      await check("Roadmap");

      const adminCard = page.locator('[data-lane-id="zz-test-sprint"] div[draggable]', { hasText: "[TESTE] item do admin" }).first();
      await L.cardButton(adminCard, "Edit").click();
      const form = page.locator('div[draggable="false"]:has(input[aria-label="New Comment"])');
      await form.waitFor({ timeout: 15000 });
      const captions = (await form.locator("label > span, legend").allTextContents()).map((t) => t.trim());
      const missing = ["Title", "Description", "Type", "Stack", "Priority", "Effort", "Status"].filter((c) => !captions.includes(c));
      expect("S3 edit form: its fields are named as GitHub names them (Title, Description, Type, Stack, Priority, Effort, Status)", missing.length === 0, missing.join(", "));
      expect("S3 edit form: Save and Cancel", (await L.cardButton(form, "Save").count()) === 1 && (await L.cardButton(form, "Cancel").count()) === 1);
      await check("edit form");
      await L.cardButton(form, "Cancel").click();

      await page.goto(BASE + "/config", { waitUntil: "load" });
      await page.locator("tbody tr").first().waitFor({ timeout: 30000 });
      await check("Config");

      await page.goto(BASE + "/resumo", { waitUntil: "load" });
      await page.getByRole("heading", { name: "Board report", exact: true }).waitFor({ timeout: 30000 });
      expect("S3 Resumo: the tab says 'Board report'", ((await page.locator('a[href="/resumo"]').first().innerText()) ?? "").trim() === "Board report");
      await sleep(800);
      await check("Resumo");
      // The Prévia, when a report is on show, keeps its Portuguese: its title and its seal.
      if ((await page.locator('section[aria-label="Prévia"]').count()) > 0) {
        const seal = ((await page.locator("[data-seal]").first().innerText().catch(() => "")) ?? "").trim();
        expect("S3 Resumo: the Prévia stays in Portuguese (titled 'Prévia', sealed 'Rascunho' or 'Enviado em …')",
          (await page.getByRole("heading", { name: "Prévia", exact: true }).count()) >= 1 && /^(Rascunho|Enviado em)/.test(seal), seal);
      } else {
        expect("S3 Resumo: no report on show, so no Prévia to check (the empty state is in English)", (await page.locator("[data-report-empty]").count()) === 1);
      }

      const noise = s.problems.filter((p) => !/auth\/v1\/token|ERR_FAILED|Failed to load resource/.test(p));
      expect("S3: no console or hydration errors on the way", noise.length === 0, noise.slice(0, 3).join(" | "));
      await s.context.close();
    }
  } catch (e) {
    expect("run completed without an exception", false, L.scrub(e && e.message ? e.message : e).slice(0, 300));
  } finally {
    await browser.close();
    await L.cleanup(t0);
  }
  process.exit(L.summary("FINAL (dark mode, phone widths, cross-tab, English outside the Prévia)") ? 1 : 0);
})();
