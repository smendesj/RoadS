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
    expect("roadmap: 'Sincronizar' is available", (await count(page.getByRole("button", { name: /^Sincronizar$/ }))) === 1);
    const novoButtons = await count(page.getByRole("button", { name: "+ Novo item" }));
    const sprintLaneCount = await count(page.locator('[data-drag-scroll="x"] > [data-lane-id]:not([data-virtual])'));
    const virtualNovo = await count(page.locator('[data-drag-scroll="x"] > [data-virtual]').getByRole("button", { name: "+ Novo item" }));
    expect("roadmap: a '+ Novo item' in every stored sprint lane (the real weeks + 1 test), none in a week not stored", sprintLaneCount >= 2 && novoButtons === sprintLaneCount && virtualNovo === 0, `${novoButtons}/${sprintLaneCount}, virtual ${virtualNovo}`);
    expect("roadmap: no 'Config' for a Scrum Master", (await count(page.getByRole("link", { name: "Config", exact: true }))) === 0);

    // ------------------------------------------------ the sprints are weeks, titled by their dates, the current one tinted
    // The row: every week stored, then from the current one on every week up to the last stored one (a gap shows,
    // not stored), plus one empty week at the end; the e2e test week after them.
    const W = await L.weeks();
    {
      const row = page.locator('[data-drag-scroll="x"] > [data-lane-id]');
      const shown = await row.evaluateAll((lanes) => lanes.map((l) => ({ id: l.dataset.laneId, virtual: l.hasAttribute("data-virtual"), title: l.querySelector(":scope > div > div")?.textContent?.trim() ?? "", current: l.getAttribute("aria-current") })));
      const expected = W.real.map((l) => ({ id: l.id, start: l.start_date, virtual: false }));
      for (let m = W.monday; m <= W.trailing; m = L.addDays(m, 7)) if (!W.holds(m)) expected.push({ id: L.weekId(m), start: m, virtual: true });
      expected.sort((a, b) => a.start.localeCompare(b.start));
      expected.push({ id: "zz-test-sprint", virtual: false });
      expect("weeks: the row is every stored week and every week from the current one to the empty one at the end, by date, then the test week",
        JSON.stringify(shown.map((l) => [l.id, l.virtual])) === JSON.stringify(expected.map((l) => [l.id, l.virtual])), JSON.stringify(shown.map((l) => [l.id, l.virtual])));
      expect("weeks: the last week of the row is an empty one the database doesn't have", shown.at(-2)?.id === L.weekId(W.trailing) && shown.at(-2)?.virtual === true, JSON.stringify(shown.at(-2)));
      expect("weeks: every sprint is titled by its dates only (\"Sprint 12–16/10\")", shown.every((l) => /^Sprint \d{2}(\/\d{2})?–\d{2}\/\d{2}$/.test(l.title)), JSON.stringify(shown.map((l) => l.title)));
      expect("weeks: the test week of 07 to 11/12 reads 'Sprint 07–11/12'", shown.find((l) => l.id === "zz-test-sprint")?.title === "Sprint 07–11/12");
      expect("weeks: no positional title is left on the Roadmap", (await count(page.getByText(/^(Sprint atual|Próxima sprint|Sprint seguinte)$/))) === 0);
      const current = shown.filter((l) => l.current === "date");
      // The current week holds the current Monday (today's, or the next one on a weekend), stored or not.
      const holdsMonday = current.length === 1 && (current[0].id === L.weekId(W.monday) || W.real.some((l) => l.id === current[0].id && l.start_date <= W.monday && W.monday <= l.end_date));
      expect("weeks: exactly one week is tinted as the current one, and it is the week of today in São Paulo", holdsMonday, JSON.stringify({ current, today: W.today }));
      expect("weeks: the e2e test week is never the current one", !current.some((l) => l.id.startsWith("zz-test-")));
      const style = await page.locator('[data-drag-scroll="x"]').evaluate((el) => [getComputedStyle(el).display, getComputedStyle(el).overflowX]);
      expect("weeks: on a wide screen the row is one line that scrolls sideways (no grid of three)", style[0] === "flex" && ["auto", "scroll"].includes(style[1]), JSON.stringify(style));
      // Holds only after migration 0031 is pushed: before it the database still has atual/proxima/terceira.
      expect("weeks (after 0031): every real sprint lane is named sprint-DD-MM-AAAA by its Monday", W.real.length > 0 && W.real.every((l) => l.id === L.weekId(l.start_date)), JSON.stringify(W.real.map((l) => l.id)));
    }

    const card = (title) => page.locator("div[draggable]", { hasText: title }).first();
    const btn = (c, name) => c.getByRole("button", { name, exact: true });
    const seeded = card("[TESTE] item semeado (sem dono)");
    const adminItem = card("[TESTE] item do admin");
    const mine = card("[TESTE] item do scrum master");

    expect("own item: draggable, with Editar and Excluir", (await mine.getAttribute("draggable")) === "true" && (await count(btn(mine, "Editar"))) === 1 && (await count(btn(mine, "Excluir"))) === 1);
    expect("seeded item (no owner): draggable, '+ nota' only, no Editar, no Excluir", (await seeded.getAttribute("draggable")) === "true" && (await count(btn(seeded, "+ nota"))) === 1 && (await count(btn(seeded, "Editar"))) === 0 && (await count(btn(seeded, "Excluir"))) === 0);
    expect("admin's item: not draggable and no controls at all", (await adminItem.getAttribute("draggable")) === "false" && (await count(adminItem.getByRole("button"))) === 0);

    // ------------------------------------------------ create through the UI, in the test sprint lane only
    const sprint = page.locator('[data-lane-id="zz-test-sprint"]');
    await sprint.getByRole("button", { name: "+ Novo item" }).click();
    // The one card in edit mode (not draggable while editing, has the note field): stable while its inputs change.
    const fresh = page.locator('div[draggable="false"]:has(input[placeholder^="Escrever nota"])');
    await fresh.waitFor({ timeout: 15000 });
    expect("create: the new item opens straight into edit mode", (await count(fresh)) === 1);
    await fresh.locator("input").first().fill("[TESTE] criado pelo Scrum Master");
    await fresh.locator("textarea").fill("descrição escrita no teste");
    // By their visible labels, not their position: the card gained and lost selects (Tipo, Stack) over time.
    // The select sits inside its <label>, so the label's accessible name also carries every option: match its caption.
    const labelled = (scope, caption) => scope.locator("label").filter({ has: page.getByText(caption, { exact: true }) }).locator("select");
    await labelled(fresh, "Prioridade").selectOption("High");
    await labelled(fresh, "Effort").selectOption("Low");
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
    await labelled(noting, "Prioridade").selectOption("Critical");
    await noting.getByPlaceholder("Escrever nota (opcional)...").fill("[TESTE] nota no item semeado");
    await btn(noting, "Salvar").click();
    await page.getByText("[TESTE] nota no item semeado").waitFor({ timeout: 15000 });
    await sleep(1000);
    const { data: sRow } = await svc.from("roadmap_items").select("title, prioridade").eq("id", L.ids.seeded).single();
    const { data: sNotes } = await svc.from("item_notes").select("author_role").eq("item_id", L.ids.seeded);
    expect("seeded item: priority changed, title untouched, note stored as scrum_master", sRow.prioridade === "Critical" && sRow.title === "[TESTE] item semeado (sem dono)" && sNotes.length === 1 && sNotes[0].author_role === "scrum_master", JSON.stringify([sRow, sNotes]));

    // ------------------------------------------------ move: drag and drop on desktop, the select on a narrow screen
    const groupBox = (title) => page.getByText(title, { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]");
    // A window as tall as the page keeps source and drop target on screen together (a drop can't land off-screen).
    await L.fitWholePage(page);
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
    // The sync queue says where the item went AND where it came from (Frontlights writes the departure into the
    // sprint file the item left; docs/frontlights-contract.md promises both lanes in every move_lane).
    const { data: movedQueue } = await svc.from("roadmap_sync_queue").select("payload").eq("item_id", L.ids.seeded).eq("action", "move_lane");
    expect(
      "move (drag and drop): the queue row names the lane it went to and the lane it came from",
      (movedQueue ?? []).some((r) => r.payload?.lane_id === "zz-test-b" && r.payload?.from_lane_id === "zz-test-sprint"),
      JSON.stringify((movedQueue ?? []).map((r) => Object.keys(r.payload ?? {}).sort()))
    );
    await mouseDrag(adminItem, groupBox("[TESTE] lane B (apagar)"));
    await sleep(1500);
    const { data: movedAdmin } = await svc.from("roadmap_items").select("lane_id").eq("id", L.ids.adminItem).single();
    expect("move: the admin's item cannot be dragged anywhere", movedAdmin.lane_id === "zz-test-sprint", movedAdmin.lane_id);

    await page.setViewportSize({ width: 800, height: 1000 });
    await sleep(800);
    const moveSelect = page.locator("div[draggable]", { hasText: "[TESTE] criado e editado pelo SM" }).first().locator('select[aria-label="Mover para"]');
    // By the lane's id: the option reads only the week's dates ("Sprint 07–11/12 (2/4)").
    await moveSelect.selectOption("zz-test-sprint");
    await sleep(2000);
    const { data: movedBack } = await svc.from("roadmap_items").select("lane_id").eq("id", created.id).single();
    expect("move (select, phone width): own item goes back to the test sprint", movedBack.lane_id === "zz-test-sprint", movedBack.lane_id);
    await page.setViewportSize({ width: 1440, height: 900 });
    await sleep(500);

    // ------------------------------------------------ a week is born when an item is dropped on it, and goes when it empties
    {
      const trailing = L.weekId(W.trailing);
      const next = L.weekId(L.addDays(W.trailing, 7));
      const laneRows = async (id) => (await svc.from("lanes").select("id, kind, start_date, end_date").eq("id", id)).data ?? [];
      expect("new week: the empty week at the end is not in the database yet", (await laneRows(trailing)).length === 0, trailing);
      L.createdWeeks.add(trailing);
      await L.fitWholePage(page);
      // Both lanes on screen together: the test week sits right after the empty one at the end of the row.
      await page.locator('[data-lane-id="zz-test-sprint"]').scrollIntoViewIfNeeded();
      await mouseDrag(card("[TESTE] criado e editado pelo SM"), page.locator(`[data-lane-id="${trailing}"]`));
      await sleep(2500);
      const born = await laneRows(trailing);
      const { data: inWeek } = await svc.from("roadmap_items").select("lane_id").eq("id", created.id).single();
      expect("new week: dropped on the empty week, the item is saved there and the week's lane exists, dated by its Monday",
        inWeek.lane_id === trailing && born.length === 1 && born[0].kind === "sprint" && born[0].start_date === W.trailing && born[0].end_date === L.addDays(W.trailing, 4),
        JSON.stringify({ lane: inWeek.lane_id, born }));
      await page.locator(`[data-lane-id="${next}"][data-virtual]`).waitFor({ timeout: 15000 }).catch(() => {});
      expect("new week: the week shows as stored, and a new empty week follows it at the end",
        (await count(page.locator(`[data-lane-id="${trailing}"]:not([data-virtual])`))) === 1 && (await count(page.locator(`[data-lane-id="${next}"][data-virtual]`))) === 1);

      await page.setViewportSize({ width: 800, height: 1000 });
      await sleep(800);
      await page.locator("div[draggable]", { hasText: "[TESTE] criado e editado pelo SM" }).first().locator('select[aria-label="Mover para"]').selectOption("zz-test-sprint");
      await sleep(2500);
      const { data: outOfWeek } = await svc.from("roadmap_items").select("lane_id").eq("id", created.id).single();
      expect("empty week: its only item moved out, the future week's lane is deleted", outOfWeek.lane_id === "zz-test-sprint" && (await laneRows(trailing)).length === 0, outOfWeek.lane_id);
      await page.locator(`[data-lane-id="${next}"]`).waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
      expect("empty week: the row ends again with that week, empty and not stored",
        (await count(page.locator(`[data-lane-id="${trailing}"][data-virtual]`))) === 1 && (await count(page.locator(`[data-lane-id="${next}"]`))) === 0);
      await page.setViewportSize({ width: 1440, height: 900 });
      await sleep(500);
    }

    // ------------------------------------------------ move on a phone: hold the card, then drag it with the finger
    {
      const phone = await L.newSession(browser, "sm", { width: 390, height: 844 }, { hasTouch: true, isMobile: true });
      await L.login(phone);
      await phone.page.goto(BASE + "/roadmap", { waitUntil: "load" });
      await phone.page.getByText("Carregando...").waitFor({ state: "detached", timeout: 30000 });
      await phone.page.getByText("[TESTE] criado e editado pelo SM").first().waitFor({ timeout: 15000 });
      const cdp = await phone.context.newCDPSession(phone.page);
      const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
      const centre = async (loc) => {
        const b = await loc.boundingBox();
        return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 20) };
      };
      const lane = async (id) => (await svc.from("roadmap_items").select("lane_id").eq("id", id).single()).data.lane_id;
      const phoneCard = () => phone.page.locator("[data-lane-id] div[draggable]", { hasText: "[TESTE] criado e editado pelo SM" }).first();
      // Glide from one point to another the way a finger does, in small steps.
      const glide = async (from, to, steps = 12) => {
        for (let i = 1; i <= steps; i++) {
          await touch("touchMove", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
          await sleep(16);
        }
      };

      // Safety: a real (non-[TESTE]) item dragged into a zz-test lane would be deleted with that lane by the cleanup
      // (on delete cascade). Checked after the gestures, and the suite stops before cleanup if one is found.
      const realInTestLanes = async () =>
        ((await svc.from("roadmap_items").select("id, title, lane_id").like("lane_id", "zz-test-%")).data ?? []).filter((r) => !r.title.startsWith("[TESTE]"));
      // Held for 400 ms: the lifted copy must be the [TESTE] card, or the gesture is cancelled before anything moves.
      const holdTestCard = async (at) => {
        await touch("touchStart", at.x, at.y);
        await sleep(400);
        const held = await phone.page.locator("[data-touch-ghost]").innerText({ timeout: 2000 }).catch(() => "");
        if (!held.includes("[TESTE] criado e editado pelo SM")) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
          throw new Error(`the finger lifted something else: ${held.slice(0, 60)}`);
        }
      };

      // The select stays only for screen readers: on a touch screen it takes no room on the card.
      const select = phone.page.locator('select[aria-label="Mover para"]');
      const box = (await select.count()) ? await select.first().boundingBox() : null;
      expect("phone: no 'Mover para' select to see on a touch screen (kept for screen readers)", !box || (box.width <= 1 && box.height <= 1), JSON.stringify(box));
      // Nothing (a loose absolute element, say) widens the page past the phone, which would zoom the whole page out.
      const widths = await phone.page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
      expect("phone: the Roadmap is as wide as the phone, not zoomed out", widths[0] === 390 && widths[1] === 390, JSON.stringify(widths));

      // Source and target on screen together: the phone's width, the page's height.
      await L.fitWholePage(phone.page);
      await phoneCard().scrollIntoViewIfNeeded();

      // A quick swipe is a scroll: the card is not moved.
      let from = await centre(phoneCard());
      await touch("touchStart", from.x, from.y);
      await glide(from, { x: from.x, y: from.y + 80 }, 4);
      await touch("touchEnd");
      await sleep(1200);
      expect("phone: a quick swipe over a card scrolls and moves nothing", (await lane(created.id)) === "zz-test-sprint");

      // Held, then dropped on nothing (the page's title): it goes back and nothing is saved.
      await phoneCard().scrollIntoViewIfNeeded();
      from = await centre(phoneCard());
      await holdTestCard(from);
      const ghost = await phone.page.locator("[data-touch-ghost]").count();
      const title = await centre(phone.page.locator("h1", { hasText: "Roadmap" }));
      await glide(from, title);
      await touch("touchEnd");
      await sleep(1200);
      expect("phone: holding the card lifts it (a copy follows the finger)", ghost === 1, `ghosts=${ghost}`);
      expect("phone: dropped outside any sprint or group, the card goes back and nothing is saved", (await lane(created.id)) === "zz-test-sprint" && (await phone.page.locator("[data-touch-ghost]").count()) === 0);

      // Held, then dragged onto a group: saved there, the same as a drag on the desktop.
      await phoneCard().scrollIntoViewIfNeeded();
      from = await centre(phoneCard());
      const target = await centre(phone.page.locator('[data-lane-id="zz-test-a"]'));
      await holdTestCard(from);
      await glide(from, target, 20);
      const lit = await phone.page.locator('[data-lane-id="zz-test-a"][data-drop-target]').count();
      await touch("touchEnd");
      await sleep(2000);
      expect("phone: the group under the finger is lit while the card is over it", lit === 1, `lit=${lit}`);
      expect("phone: held and dragged onto a group, the item is saved there", (await lane(created.id)) === "zz-test-a", await lane(created.id));

      // Near the top of the screen the page scrolls by itself while a card is lifted; a cancelled touch saves nothing.
      // Only the [TESTE] card is held, and the gesture ends in touchCancel, so no real item can land anywhere.
      await phone.page.setViewportSize({ width: 390, height: 844 });
      await sleep(300);
      await phoneCard().scrollIntoViewIfNeeded();
      const before = await phone.page.evaluate(() => window.scrollY);
      from = await centre(phoneCard());
      await holdTestCard(from);
      await glide(from, { x: from.x, y: 6 }, 10);
      await sleep(800);
      const after = await phone.page.evaluate(() => window.scrollY);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await sleep(1200);
      expect("phone: holding a card near the top edge scrolls the page up", before > 100 && before - after > 100, `scrollY ${before} -> ${after}`);
      expect("phone: a cancelled touch puts the card back and saves nothing", (await lane(created.id)) === "zz-test-a" && (await phone.page.locator("[data-touch-ghost]").count()) === 0);

      expect("phone: no console errors while dragging", phone.problems.length === 0, phone.problems.slice(0, 3).join(" | "));
      const strays = await realInTestLanes();
      expect("phone: no real item ended up in a test lane", strays.length === 0, strays.map((r) => r.id).join(","));
      if (strays.length) {
        // Never let the cleanup delete a real item with its test lane: stop here, before it, so a person moves it back.
        console.error("STOP: real items in test lanes, cleanup skipped:", strays.map((r) => r.id).join(","));
        L.summary("SCRUM MASTER");
        process.exit(1);
      }
      await phone.context.close();
      // Back where the rest of this suite expects it.
      await svc.from("roadmap_items").update({ lane_id: "zz-test-sprint" }).eq("id", created.id);
      await page.reload({ waitUntil: "load" });
      await page.getByText("Carregando...").waitFor({ state: "detached", timeout: 30000 });
    }

    // ------------------------------------------------ delete: own yes, others no
    const toDelete = card("[TESTE] criado e editado pelo SM");
    await btn(toDelete, "Excluir").click();
    await sleep(2000);
    const { data: gone } = await svc.from("roadmap_items").select("id").eq("id", created.id);
    expect("delete: own item is removed", gone.length === 0);
    expect("delete: the admin's item survives, the seeded one has no Excluir", (await svc.from("roadmap_items").select("id").eq("id", L.ids.adminItem)).data.length === 1);

    // ------------------------------------------------ Sincronizar with no token
    await page.getByRole("button", { name: /^Sincronizar$/ }).click();
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
