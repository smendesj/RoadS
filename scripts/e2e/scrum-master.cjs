const L = require("./lib.cjs");
const { BASE, expect, sleep, svc } = L;

(async () => {
  const t0 = new Date().toISOString();
  await L.ensureFixtures();
  const browser = await L.launch();
  try {
    const s = await L.newSession(browser, "sm");
    const { page } = s;
    page.on("dialog", (d) => d.accept());
    const menu = L.menuButton(page);

    await L.login(s);
    await menu.waitFor();
    expect("login: lands on /dashboard", page.url().endsWith("/dashboard"), page.url());
    expect("header label says Scrum Master", (await menu.innerText()).trim() === "Scrum Master");
    const tabs = await page.locator("a[href='/dashboard'], a[href='/roadmap'], a[href='/config']").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect("nav has no Config link", !tabs.includes("/config"), JSON.stringify([...new Set(tabs)]));
    await page.goto(BASE + "/config", { waitUntil: "load" });
    expect("direct visit to /config is sent back to /dashboard", page.url().endsWith("/dashboard"), page.url());

    // ------------------------------------------------ roadmap, editor view
    await page.goto(BASE + "/roadmap", { waitUntil: "load" });
    await page.getByText("Carregando...").waitFor({ state: "detached", timeout: 30000 });
    await page.getByText("[TESTE] item do scrum master").waitFor();
    const count = (loc) => loc.count();
    expect("roadmap: subtitle offers 'defina o que entra e quando'", (await count(page.getByText(/defina o que entra e quando/))) === 1);
    expect("roadmap: 'Sincronizar issues' is available", (await count(page.getByRole("button", { name: /Sincronizar issues/ }))) === 1);
    const novoButtons = await count(page.getByRole("button", { name: "+ Novo item" }));
    expect("roadmap: a '+ Novo item' in every sprint lane (3 real + 1 test)", novoButtons === 4, String(novoButtons));
    expect("roadmap: no 'Config' for a Scrum Master", (await count(page.getByRole("link", { name: "Config", exact: true }))) === 0);

    const card = (title) => page.locator("div[draggable]", { hasText: title }).first();
    const btn = (c, name) => c.getByRole("button", { name, exact: true });
    const seeded = card("[TESTE] item semeado (sem dono)");
    const adminItem = card("[TESTE] item do admin");
    const mine = card("[TESTE] item do scrum master");

    expect("own item: draggable, with Editar and Excluir", (await mine.getAttribute("draggable")) === "true" && (await count(btn(mine, "Editar"))) === 1 && (await count(btn(mine, "Excluir"))) === 1);
    expect("seeded item (no owner): draggable, '+ nota' only, no Editar, no Excluir", (await seeded.getAttribute("draggable")) === "true" && (await count(btn(seeded, "+ nota"))) === 1 && (await count(btn(seeded, "Editar"))) === 0 && (await count(btn(seeded, "Excluir"))) === 0);
    expect("admin's item: not draggable and no controls at all", (await adminItem.getAttribute("draggable")) === "false" && (await count(adminItem.getByRole("button"))) === 0);

    // ------------------------------------------------ create through the UI, in the test sprint lane only
    const sprint = page.getByText("[TESTE] sprint (apagar)", { exact: true }).locator("xpath=ancestor::div[contains(@class,'min-h-')][1]");
    await sprint.getByRole("button", { name: "+ Novo item" }).click();
    // The one card in edit mode (not draggable while editing, has the note field): stable while its inputs change.
    const fresh = page.locator('div[draggable="false"]:has(input[placeholder^="Escrever nota"])');
    await fresh.waitFor({ timeout: 15000 });
    expect("create: the new item opens straight into edit mode", (await count(fresh)) === 1);
    await fresh.locator("input").first().fill("[TESTE] criado pelo Scrum Master");
    await fresh.locator("textarea").fill("descrição escrita no teste");
    const selects = fresh.locator("select");
    await selects.nth(1).selectOption("High"); // prioridade (0 = produto)
    await selects.nth(2).selectOption("Low"); // effort
    await fresh.getByPlaceholder("Escrever nota (opcional)...").fill("[TESTE] primeira nota");
    await btn(fresh, "Salvar").click();
    await page.getByText("[TESTE] criado pelo Scrum Master").first().waitFor({ timeout: 15000 });
    await sleep(1500);
    const { data: created } = await svc.from("roadmap_items").select("id, title, prioridade, effort, created_by, github_issue_url, lane_id").eq("title", "[TESTE] criado pelo Scrum Master").maybeSingle();
    expect("create: saved with the SM as owner, High/Low, in the test lane", created && created.created_by === L.ids.sm && created.prioridade === "High" && created.effort === "Low" && created.lane_id === "zz-test-sprint", JSON.stringify(created));
    expect("create: no GitHub issue was opened (the token is empty in this test server)", created && created.github_issue_url === null);
    const { data: note } = await svc.from("item_notes").select("author_role, body").eq("item_id", created.id);
    expect("create: the note is stored, pinned to scrum_master", note.length === 1 && note[0].author_role === "scrum_master" && /primeira nota/.test(note[0].body), JSON.stringify(note));
    expect("create: the note shows on the card as 'Scrum Master'", (await count(page.locator("div[draggable]", { hasText: "[TESTE] criado pelo Scrum Master" }).getByText("[TESTE] primeira nota"))) === 1);

    // ------------------------------------------------ edit own item
    const own = card("[TESTE] criado pelo Scrum Master");
    await btn(own, "Editar").click();
    const editing = page.locator('div[draggable="false"]:has(input[placeholder^="Escrever nota"])');
    await editing.locator("input").first().fill("[TESTE] criado e editado pelo SM");
    await btn(editing, "Salvar").click();
    await page.getByText("[TESTE] criado e editado pelo SM").first().waitFor({ timeout: 15000 });
    await sleep(1000);
    const { data: edited } = await svc.from("roadmap_items").select("title").eq("id", created.id).single();
    expect("edit own item: the new title is saved", edited.title === "[TESTE] criado e editado pelo SM", edited.title);

    // ------------------------------------------------ seeded item: note + priority only
    await btn(seeded, "+ nota").click();
    const noting = page.locator('div[draggable="false"]:has(input[placeholder^="Escrever nota"])');
    expect("seeded item: the edit panel has NO title/description/produto fields", (await count(noting.getByText("Título", { exact: true }))) === 0 && (await count(noting.getByText("Descrição", { exact: true }))) === 0);
    await noting.locator("select").first().selectOption("Critical"); // prioridade
    await noting.getByPlaceholder("Escrever nota (opcional)...").fill("[TESTE] nota no item semeado");
    await btn(noting, "Salvar").click();
    await page.getByText("[TESTE] nota no item semeado").waitFor({ timeout: 15000 });
    await sleep(1000);
    const { data: sRow } = await svc.from("roadmap_items").select("title, prioridade").eq("id", L.ids.seeded).single();
    const { data: sNotes } = await svc.from("item_notes").select("author_role").eq("item_id", L.ids.seeded);
    expect("seeded item: priority changed, title untouched, note stored as scrum_master", sRow.prioridade === "Critical" && sRow.title === "[TESTE] item semeado (sem dono)" && sNotes.length === 1 && sNotes[0].author_role === "scrum_master", JSON.stringify([sRow, sNotes]));

    // ------------------------------------------------ move: drag and drop on desktop, the select on a narrow screen
    const groupBox = (title) => page.getByText(title, { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]");
    // A tall window keeps source and drop target on screen together (a drop can't land off-screen).
    await page.setViewportSize({ width: 1440, height: 3600 });
    await sleep(600);
    // Native HTML5 drag: Playwright's dragTo doesn't start one here, so move the mouse in steps, like a person.
    const mouseDrag = async (source, target) => {
      await source.scrollIntoViewIfNeeded();
      const c = await source.boundingBox();
      await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
      await page.mouse.down();
      await page.mouse.move(c.x + c.width / 2 + 10, c.y + c.height / 2 + 10, { steps: 5 });
      const t = await target.boundingBox();
      await page.mouse.move(t.x + t.width / 2, t.y + 12, { steps: 25 });
      await page.mouse.up();
    };
    await mouseDrag(card("[TESTE] criado e editado pelo SM"), groupBox("[TESTE] lane A (apagar)"));
    await sleep(2000);
    const { data: movedA } = await svc.from("roadmap_items").select("lane_id").eq("id", created.id).single();
    expect("move (drag and drop): own item lands in lane A", movedA.lane_id === "zz-test-a", movedA.lane_id);
    await mouseDrag(seeded, groupBox("[TESTE] lane B (apagar)"));
    await sleep(2000);
    const { data: movedS } = await svc.from("roadmap_items").select("lane_id").eq("id", L.ids.seeded).single();
    expect("move (drag and drop): the seeded item can be moved too", movedS.lane_id === "zz-test-b", movedS.lane_id);
    await mouseDrag(adminItem, groupBox("[TESTE] lane B (apagar)"));
    await sleep(1500);
    const { data: movedAdmin } = await svc.from("roadmap_items").select("lane_id").eq("id", L.ids.adminItem).single();
    expect("move: the admin's item cannot be dragged anywhere", movedAdmin.lane_id === "zz-test-sprint", movedAdmin.lane_id);

    await page.setViewportSize({ width: 800, height: 1000 });
    await sleep(800);
    const moveSelect = page.locator("div[draggable]", { hasText: "[TESTE] criado e editado pelo SM" }).first().locator('select[aria-label="Mover para"]');
    await moveSelect.selectOption({ label: "[TESTE] sprint (apagar) (2/4)" }).catch(async () => {
      const options = await moveSelect.locator("option").allInnerTexts();
      await moveSelect.selectOption({ index: options.findIndex((o) => /\[TESTE\] sprint/.test(o)) });
    });
    await sleep(2000);
    const { data: movedBack } = await svc.from("roadmap_items").select("lane_id").eq("id", created.id).single();
    expect("move (select, phone width): own item goes back to the test sprint", movedBack.lane_id === "zz-test-sprint", movedBack.lane_id);
    await page.setViewportSize({ width: 1440, height: 900 });
    await sleep(500);

    // ------------------------------------------------ delete: own yes, others no
    const toDelete = card("[TESTE] criado e editado pelo SM");
    await btn(toDelete, "Excluir").click();
    await sleep(2000);
    const { data: gone } = await svc.from("roadmap_items").select("id").eq("id", created.id);
    expect("delete: own item is removed", gone.length === 0);
    expect("delete: the admin's item survives, the seeded one has no Excluir", (await svc.from("roadmap_items").select("id").eq("id", L.ids.adminItem)).data.length === 1);

    // ------------------------------------------------ Sincronizar issues with no token
    await page.getByRole("button", { name: /Sincronizar issues/ }).click();
    const msg = await page.getByText(/Erro ao sincronizar|não configurada/).waitFor({ timeout: 20000 }).then(() => true, () => false);
    expect("sync issues: with no GitHub token it fails closed with a message", msg);

    // ------------------------------------------------ idle and Sair
    await page.evaluate(() => localStorage.setItem("roads-last-activity", String(Date.now() - (10 * 60 + 1) * 1000)));
    await page.waitForURL("**/login", { timeout: 45000 });
    expect("idle: 10 minutes and 1 second signs the Scrum Master out", true);
    await L.login(s);
    await menu.waitFor();
    await menu.click();
    await page.getByRole("button", { name: "Sair" }).click();
    await page.waitForURL("**/login");
    await page.goto(BASE + "/roadmap", { waitUntil: "load" });
    expect("logout: Sair ends the session", page.url().endsWith("/login"));

    const noise = s.problems.filter((p) => !/auth\/v1\/token|ERR_FAILED|Failed to load resource/.test(p));
    expect("no console errors, hydration errors or failed requests during the whole run", noise.length === 0, noise.slice(0, 3).join(" | "));
  } catch (e) {
    expect("run completed without an exception", false, L.scrub(e && e.message ? e.message : e).slice(0, 300));
  } finally {
    await browser.close();
    await L.cleanup(t0);
  }
  process.exit(L.summary("SCRUM MASTER") ? 1 : 0);
})();
