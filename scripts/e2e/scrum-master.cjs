const L = require("./lib.cjs");
const { BASE, expect, sleep, svc } = L;

// The Kanban under the weeks is built from the board snapshot the sync stores (board_sync_state.columns), which the
// test server can't refresh (GITHUB_TOKEN is empty). Made-up cards go into it for the run, the way the sync stores
// them, with when their Status changed: an issue Open on the Project that a Roadmap item holds, one no item holds, one
// in Development (its item must stay out of Open), one that went to Done yesterday and one 30 days ago. The numbers
// are far above any real issue, so nothing real is ever named; the returned function takes them out again, leaving
// the rest of the snapshot as the last real sync wrote it.
const GEOCLOUD = "https://github.com/Essencis-Labs/GeoCloudAI/issues/";
const BOARD = {
  open: { number: 990101, title: "[TESTE] issue aberta no Project" },
  orphan: { number: 990102, title: "[TESTE] issue aberta sem item" },
  dev: { number: 990103, title: "[TESTE] issue em Development" },
  doneRecent: { number: 990104, title: "[TESTE] issue concluída ontem" },
  doneOld: { number: 990105, title: "[TESTE] issue concluída há 30 dias" },
};
const DAY = 24 * 60 * 60 * 1000;
async function seedBoard() {
  const card = (c, statusAt) => ({ title: c.title, ref: `#${c.number}`, url: GEOCLOUD + c.number, ...(statusAt ? { statusAt } : {}) });
  const ours = new Set(Object.values(BOARD).map((c) => GEOCLOUD + c.number));
  const read = async () => {
    const { data, error } = await svc.from("board_sync_state").select("columns").eq("id", true).single();
    if (error) throw error;
    return data.columns ?? [];
  };
  const write = async (columns) => {
    const { error } = await svc.from("board_sync_state").update({ columns }).eq("id", true);
    if (error) throw error;
  };
  const without = (columns) =>
    columns.map((c) => {
      const items = (c.items ?? []).filter((i) => !ours.has(i.url));
      return { ...c, items, count: (c.count ?? 0) - ((c.items ?? []).length - items.length) };
    });
  const add = {
    open: [card(BOARD.open), card(BOARD.orphan)],
    dev: [card(BOARD.dev)],
    done: [card(BOARD.doneRecent, new Date(Date.now() - DAY).toISOString()), card(BOARD.doneOld, new Date(Date.now() - 30 * DAY).toISOString())],
  };
  const columns = without(await read());
  if (!["open", "dev", "done"].every((k) => columns.some((c) => c.key === k))) throw new Error("the board snapshot has no Open, Development or Done column");
  await write(columns.map((c) => (add[c.key] ? { ...c, items: [...add[c.key], ...c.items], count: c.count + add[c.key].length } : c)));
  // Their items, with no week (in a test type lane): the Open one, and the one in Development.
  const item = async (c) => {
    const { data, error } = await svc
      .from("roadmap_items")
      .insert({ lane_id: "zz-test-a", title: c.title, description: "descrição de teste", created_by: null, github_issue_url: GEOCLOUD + c.number, github_issue_number: c.number })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };
  const ids = { open: await item(BOARD.open), dev: await item(BOARD.dev) };
  return { ids, unseed: async () => write(without(await read())) };
}

(async () => {
  const t0 = new Date().toISOString();
  await L.ensureFixtures();
  const browser = await L.launch();
  let unseed = async () => {};
  let unseedFailed = false;
  try {
    const board = await seedBoard();
    unseed = board.unseed;
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
    // Each item of the test week shows twice: in the week, and in the Kanban's Open with the week's label.
    await page.getByText("[TESTE] item do scrum master").first().waitFor();
    const count = (loc) => loc.count();
    const open = page.locator('[data-kanban-column="open"]');
    const done = page.locator('[data-kanban-column="done"]');
    expect("roadmap: subtitle offers 'defina o que entra e quando'", (await count(page.getByText(/defina o que entra e quando/))) === 1);
    expect("roadmap: 'Sincronizar' is available", (await count(page.getByRole("button", { name: /^Sincronizar$/ }))) === 1);
    expect("roadmap: one '+ Novo item', in the Kanban's Open, none in any week",
      (await count(page.getByRole("button", { name: "+ Novo item" }))) === 1 && (await count(open.getByRole("button", { name: "+ Novo item" }))) === 1 &&
        (await count(page.locator("[data-lane-id]").getByRole("button", { name: "+ Novo item" }))) === 0);
    expect("roadmap: no 'Config' for a Scrum Master", (await count(page.getByRole("link", { name: "Config", exact: true }))) === 0);

    // ------------------------------------------------ the Kanban under the weeks, in place of the Roadmap section
    {
      expect("kanban: the Roadmap shows a Kanban with two columns, Open and Done (no Blocker, no Development)",
        (await count(page.locator("[data-kanban-column]"))) === 2 && (await count(open)) === 1 && (await count(done)) === 1 &&
          (await open.locator("span").first().innerText()).trim() === "Open" && (await done.locator("span").first().innerText()).trim() === "Done");
      expect("kanban: no Roadmap section of type lanes is left (no group lane, no 'Toda issue aberta…' text)",
        (await count(page.locator('[data-lane-id="zz-test-a"], [data-lane-id="zz-test-b"], [data-lane-id^="tipo-"]'))) === 0 &&
          (await count(page.getByText("[TESTE] lane A (apagar)"))) === 0 && (await count(page.getByText(/Toda issue aberta que ainda não entrou/))) === 0);
      const below = await page.evaluate(() => {
        const weeks = document.querySelector("[data-weeks]");
        const kanban = document.querySelector("[data-kanban]");
        return !!weeks && !!kanban && !!(weeks.compareDocumentPosition(kanban) & Node.DOCUMENT_POSITION_FOLLOWING) && getComputedStyle(weeks).position;
      });
      expect("kanban: it sits under the row of weeks, and on a wide screen the row stays at the top while the page scrolls (sticky)", below === "sticky", String(below));
      // From here on the window is as tall as the page: nothing slides under the row of weeks that stays at the top.
      await L.fitWholePage(page);
      // A planned item stays in Open, faded, with the week it is planned in.
      const planned = open.locator("div[draggable]", { hasText: "[TESTE] item do scrum master" });
      const look =
        (await count(planned)) === 1
          ? await planned.evaluate((el) => ({ label: el.querySelector("[data-week-label]")?.textContent?.trim() ?? null, opacity: getComputedStyle(el).opacity }))
          : null;
      expect("kanban: an item of the test week is in Open too, at 70%, labelled '▸ Sprint 07/12'", look?.label === "▸ Sprint 07/12" && look?.opacity === "0.7", JSON.stringify(look));
      // An issue Open on the Project is the card of its Roadmap item; one no item holds is a plain link; one in
      // Development is not in Open.
      const tied = open.locator(`[data-item-id="${board.ids.open}"]`);
      const tiedText = (await count(tied)) ? await tied.innerText() : "missing";
      expect("kanban: an issue Open on the Project shows in Open as its Roadmap item's card (#number, draggable, no week label)",
        (await count(tied)) === 1 && tiedText.includes(`#${BOARD.open.number}`) && (await tied.getAttribute("draggable")) === "true" &&
          (await count(tied.locator("[data-week-label]"))) === 0, tiedText.slice(0, 80));
      const orphan = open.locator("[data-issue-card]", { hasText: BOARD.orphan.title });
      expect("kanban: an issue Open on the Project that no item holds is a plain link to it in Open",
        (await count(orphan)) === 1 && (await orphan.getAttribute("href")) === GEOCLOUD + BOARD.orphan.number);
      expect("kanban: an issue in Development is not in Open (its item neither)",
        (await count(open.getByText(BOARD.dev.title))) === 0 && (await count(open.locator(`[data-item-id="${board.ids.dev}"]`))) === 0);
      // Done: what went to Done in the last 14 days, counted from when the Status changed; "Ver todas" shows the rest.
      const { data: snap } = await svc.from("board_sync_state").select("columns").eq("id", true).single();
      const doneCards = (snap.columns ?? []).find((c) => c.key === "done")?.items ?? [];
      const recent = doneCards.filter((c) => c.statusAt && Date.now() - Date.parse(c.statusAt) <= 14 * DAY).length;
      const shownDone = () => done.locator("[data-issue-card]").count();
      expect("done: the cards that went to Done in the last 14 days, the one of yesterday in, the one of 30 days ago out",
        (await shownDone()) === recent && (await count(done.getByText(BOARD.doneRecent.title))) === 1 && (await count(done.getByText(BOARD.doneOld.title))) === 0,
        `${await shownDone()} of ${recent}`);
      expect("done: only to look at (nothing to drag, no button but 'Ver todas')",
        (await count(done.locator("[draggable]"))) === 0 && (await count(done.getByRole("button"))) === 1);
      await done.getByRole("button", { name: /^Ver todas/ }).click();
      expect("done: 'Ver todas' shows every Done card of the snapshot right there, the one of 30 days ago too",
        (await shownDone()) === doneCards.length && (await count(done.getByText(BOARD.doneOld.title))) === 1, `${await shownDone()} of ${doneCards.length}`);
      // The ELIMS cards are only counted, now under the Kanban.
      const elims = (snap.columns ?? []).reduce((sum, c) => sum + (c.elims ?? 0), 0);
      const noteBox = page.locator("[data-elims-note]");
      const note = (await count(noteBox)) ? await noteBox.innerText() : null;
      expect("kanban: the note counting the ELIMS issues is on the Roadmap", elims === 0 ? note === null : !!note && note.includes(String(elims)), `${elims}: ${note}`);
    }

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

    // A card in the test week, and the same item's card in the Kanban's Open.
    const card = (title) => page.locator('[data-lane-id="zz-test-sprint"] div[draggable]', { hasText: title }).first();
    const openCard = (title) => open.locator("div[draggable]", { hasText: title }).first();
    const btn = (c, name) => c.getByRole("button", { name, exact: true });
    const seeded = card("[TESTE] item semeado (sem dono)");
    const adminItem = card("[TESTE] item do admin");

    for (const [where, of] of [["in its week", card], ["in the Kanban's Open", openCard]]) {
      const own = of("[TESTE] item do scrum master");
      const noOwner = of("[TESTE] item semeado (sem dono)");
      const admins = of("[TESTE] item do admin");
      expect(`own item ${where}: draggable, with Editar and Excluir`, (await own.getAttribute("draggable")) === "true" && (await count(btn(own, "Editar"))) === 1 && (await count(btn(own, "Excluir"))) === 1);
      expect(`seeded item (no owner) ${where}: draggable, '+ nota' only, no Editar, no Excluir`, (await noOwner.getAttribute("draggable")) === "true" && (await count(btn(noOwner, "+ nota"))) === 1 && (await count(btn(noOwner, "Editar"))) === 0 && (await count(btn(noOwner, "Excluir"))) === 0);
      expect(`admin's item ${where}: not draggable and no controls at all`, (await admins.getAttribute("draggable")) === "false" && (await count(admins.getByRole("button"))) === 0);
    }

    // ------------------------------------------------ create through the UI: "+ Novo item" in the Kanban's Open
    await open.getByRole("button", { name: "+ Novo item" }).click();
    // The one card in edit mode (not draggable while editing, has the note field): stable while its inputs change.
    const fresh = page.locator('div[draggable="false"]:has(input[placeholder^="Escrever nota"])');
    await fresh.waitFor({ timeout: 15000 });
    expect("create: the new item opens straight into edit mode, in Open",
      (await count(fresh)) === 1 && (await count(open.locator('div[draggable="false"]:has(input[placeholder^="Escrever nota"])'))) === 1);
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
    expect("create: saved with the SM as owner, High/Low, with no week: in the feature type lane", created && created.created_by === L.ids.sm && created.prioridade === "High" && created.effort === "Low" && created.lane_id === "tipo-feature", JSON.stringify(created));
    expect("create: no GitHub issue was opened (the token is empty in this test server)", created && created.github_issue_url === null);
    // The week's order is roadmap_items.sort_order (the Roadmap's week, the Dashboard's Sprint and roadmap-state's
    // position all read it); a new item, and an item moved with "Mover para", goes last.
    const isLastOfWeek = async (id) => {
      const rows = (await svc.from("roadmap_items").select("id, sort_order").eq("lane_id", "zz-test-sprint")).data ?? [];
      const mine = rows.find((r) => r.id === id);
      return { ok: !!mine && rows.every((r) => r.id === id || r.sort_order < mine.sort_order), rows };
    };
    {
      const first = await open.locator("[data-item-id]").first().evaluate((el) => ({ id: el.dataset.itemId, label: !!el.querySelector("[data-week-label]"), opacity: getComputedStyle(el).opacity }));
      expect("create: the new item is the first card of Open, with no week label, not faded", first.id === created.id && !first.label && first.opacity === "1", JSON.stringify(first));
      expect("create: the new item is in no week", (await count(page.locator(`[data-lane-id] [data-item-id="${created.id}"]`))) === 0);
    }
    const { data: note } = await svc.from("item_notes").select("author_role, body").eq("item_id", created.id);
    expect("create: the note is stored, pinned to scrum_master", note.length === 1 && note[0].author_role === "scrum_master" && /primeira nota/.test(note[0].body), JSON.stringify(note));
    expect("create: the note shows on the card as 'Scrum Master'", (await count(open.locator("div[draggable]", { hasText: "[TESTE] criado pelo Scrum Master" }).getByText("[TESTE] primeira nota"))) === 1);

    // ------------------------------------------------ edit own item, on its card in Open
    const own = openCard("[TESTE] criado pelo Scrum Master");
    await btn(own, "Editar").click();
    const editing = page.locator('div[draggable="false"]:has(input[placeholder^="Escrever nota"])');
    await editing.locator("input").first().fill("[TESTE] criado e editado pelo SM");
    // A bug: unplanned later, the item goes back to the bug type lane (the server picks it by the item's type).
    await labelled(editing, "Tipo").selectOption("bug");
    await btn(editing, "Salvar").click();
    await page.getByText("[TESTE] criado e editado pelo SM").first().waitFor({ timeout: 15000 });
    await sleep(1000);
    const { data: edited } = await svc.from("roadmap_items").select("title, tipo").eq("id", created.id).single();
    expect("edit own item: the new title and the type bug are saved", edited.title === "[TESTE] criado e editado pelo SM" && edited.tipo === "bug", JSON.stringify(edited));

    // ------------------------------------------------ seeded item: note + priority only, on its card in Open
    await btn(openCard("[TESTE] item semeado (sem dono)"), "+ nota").click();
    const noting = page.locator('div[draggable="false"]:has(input[placeholder^="Escrever nota"])');
    expect("seeded item: the edit panel has NO title/description/produto fields", (await count(noting.getByText("Título", { exact: true }))) === 0 && (await count(noting.getByText("Descrição", { exact: true }))) === 0);
    await labelled(noting, "Prioridade").selectOption("Critical");
    await noting.getByPlaceholder("Escrever nota (opcional)...").fill("[TESTE] nota no item semeado");
    await btn(noting, "Salvar").click();
    await page.getByText("[TESTE] nota no item semeado").first().waitFor({ timeout: 15000 });
    await sleep(1000);
    const { data: sRow } = await svc.from("roadmap_items").select("title, prioridade").eq("id", L.ids.seeded).single();
    const { data: sNotes } = await svc.from("item_notes").select("author_role").eq("item_id", L.ids.seeded);
    expect("seeded item: priority changed, title untouched, note stored as scrum_master", sRow.prioridade === "Critical" && sRow.title === "[TESTE] item semeado (sem dono)" && sNotes.length === 1 && sNotes[0].author_role === "scrum_master", JSON.stringify([sRow, sNotes]));

    // ------------------------------------------------ plan: a card dragged from Open to a week stays in Open, labelled with it
    // A window as tall as the page keeps source and drop target on screen together (a drop can't land off-screen).
    await L.fitWholePage(page);
    // Native HTML5 drag: Playwright's dragTo doesn't start one here, so move the mouse in steps, like a person.
    // The target first: a week can be off screen to the side in its row, and a card of Open is never in that row.
    const mouseDrag = async (source, target) => {
      await target.scrollIntoViewIfNeeded();
      await source.scrollIntoViewIfNeeded();
      const c = await source.boundingBox();
      await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
      await page.mouse.down();
      await page.mouse.move(c.x + c.width / 2 + 10, c.y + c.height / 2 + 10, { steps: 5 });
      const t = await target.boundingBox();
      await page.mouse.move(t.x + t.width / 2, t.y + 12, { steps: 25 });
      await page.mouse.up();
    };
    const testWeek = page.locator('[data-lane-id="zz-test-sprint"]');
    const laneOfItem = async (id) => (await svc.from("roadmap_items").select("lane_id").eq("id", id).single()).data.lane_id;
    // How a card of Open looks: its week label (null when it has none), its opacity, and how many copies Open has.
    const inOpen = async (title) => ({
      copies: await open.locator("div[draggable]", { hasText: title }).count(),
      label: ((await openCard(title).locator("[data-week-label]").textContent({ timeout: 2000 }).catch(() => null)) ?? "").trim() || null,
      opacity: await openCard(title).evaluate((el) => getComputedStyle(el).opacity).catch(() => null),
    });
    const moveQueue = async (id) => ((await svc.from("roadmap_sync_queue").select("payload").eq("item_id", id).eq("action", "move_lane")).data ?? []).map((r) => r.payload);
    const trailing = L.weekId(W.trailing);
    const trailingLabel = `▸ Sprint ${W.trailing.slice(8, 10)}/${W.trailing.slice(5, 7)}`;
    const laneRows = async (id) => (await svc.from("lanes").select("id, kind, start_date, end_date").eq("id", id)).data ?? [];
    L.createdWeeks.add(trailing);
    {
      const planned = await inOpen("[TESTE] criado e editado pelo SM");
      expect("plan: before it is planned, the new item's card in Open has no week label and is not faded", planned.copies === 1 && planned.label === null && planned.opacity === "1", JSON.stringify(planned));
    }
    await mouseDrag(openCard("[TESTE] criado e editado pelo SM"), testWeek);
    await sleep(2000);
    expect("plan (drag from Open): own item is saved in the test week", (await laneOfItem(created.id)) === "zz-test-sprint", await laneOfItem(created.id));
    {
      const planned = await inOpen("[TESTE] criado e editado pelo SM");
      expect("plan: the card stays in Open, at 70%, labelled '▸ Sprint 07/12'", planned.copies === 1 && planned.label === "▸ Sprint 07/12" && planned.opacity === "0.7", JSON.stringify(planned));
      expect("plan: the item shows in the week too", (await count(card("[TESTE] criado e editado pelo SM"))) === 1);
      const last = await isLastOfWeek(created.id);
      expect("plan: dropped on the week, not on a card, the item goes last in it", last.ok, JSON.stringify(last.rows));
      // The sync queue says where the item went AND where it came from (Frontlights writes the departure into the
      // file of the lane the item left; docs/frontlights-contract.md promises both lanes in every move_lane).
      const q = await moveQueue(created.id);
      expect("plan: the queue row names the week it went to and the type lane it came from",
        q.some((r) => r?.lane_id === "zz-test-sprint" && r?.from_lane_id === "tipo-feature"), JSON.stringify(q.map((r) => [r?.from_lane_id, r?.lane_id])));
    }

    // The seeded item (no owner), taken out of its week, is planned from Open too.
    await svc.from("roadmap_items").update({ lane_id: "zz-test-b" }).eq("id", L.ids.seeded);
    await page.reload({ waitUntil: "load" });
    await page.getByText("Carregando...").waitFor({ state: "detached", timeout: 30000 });
    await openCard("[TESTE] item semeado (sem dono)").waitFor({ timeout: 15000 });
    await L.fitWholePage(page);
    {
      const before = await inOpen("[TESTE] item semeado (sem dono)");
      expect("plan: an item with no week is in Open with no label, not faded, and in no week", before.label === null && before.opacity === "1" && (await count(seeded)) === 0, JSON.stringify(before));
    }
    await mouseDrag(openCard("[TESTE] item semeado (sem dono)"), testWeek);
    await sleep(2000);
    expect("plan (drag from Open): the seeded item can be planned too", (await laneOfItem(L.ids.seeded)) === "zz-test-sprint", await laneOfItem(L.ids.seeded));
    expect("plan: its move is queued with the lane it came from", (await moveQueue(L.ids.seeded)).some((r) => r?.lane_id === "zz-test-sprint" && r?.from_lane_id === "zz-test-b"));

    // The admin's item, in Open, can't be dragged anywhere: dropped on the empty week at the end, nothing moves and no week is born.
    expect("new week: the empty week at the end is not in the database yet", (await laneRows(trailing)).length === 0, trailing);
    await mouseDrag(openCard("[TESTE] item do admin"), page.locator(`[data-lane-id="${trailing}"]`));
    await sleep(1500);
    expect("plan: the admin's item cannot be dragged from Open, and no week is created for it",
      (await laneOfItem(L.ids.adminItem)) === "zz-test-sprint" && (await laneRows(trailing)).length === 0, await laneOfItem(L.ids.adminItem));

    // ------------------------------------------------ dragged again from Open, the item goes to another week: a week the
    // database lacks is born when the item is dropped on it, and goes when it empties
    {
      const next = L.weekId(L.addDays(W.trailing, 7));
      // Both lanes on screen together: the test week sits right after the empty one at the end of the row.
      await testWeek.scrollIntoViewIfNeeded();
      await mouseDrag(openCard("[TESTE] criado e editado pelo SM"), page.locator(`[data-lane-id="${trailing}"]`));
      await sleep(2500);
      const born = await laneRows(trailing);
      const inWeek = await laneOfItem(created.id);
      expect("new week: dragged from Open onto the empty week, the item is saved there and the week's lane exists, dated by its Monday",
        inWeek === trailing && born.length === 1 && born[0].kind === "sprint" && born[0].start_date === W.trailing && born[0].end_date === L.addDays(W.trailing, 4),
        JSON.stringify({ lane: inWeek, born }));
      const { data: first } = await svc.from("roadmap_items").select("sort_order").eq("id", created.id).single();
      expect("new week: the item dropped on it is its first one (sort_order 0)", first.sort_order === 0, String(first.sort_order));
      await page.locator(`[data-lane-id="${next}"][data-virtual]`).waitFor({ timeout: 15000 }).catch(() => {});
      expect("new week: the week shows as stored, and a new empty week follows it at the end",
        (await count(page.locator(`[data-lane-id="${trailing}"]:not([data-virtual])`))) === 1 && (await count(page.locator(`[data-lane-id="${next}"][data-virtual]`))) === 1);
      const moved = await inOpen("[TESTE] criado e editado pelo SM");
      expect("re-plan: the card is still in Open, labelled with the new week, and left the test week",
        moved.copies === 1 && moved.label === trailingLabel && moved.opacity === "0.7" && (await count(card("[TESTE] criado e editado pelo SM"))) === 0, JSON.stringify({ ...moved, trailingLabel }));

      // Below lg a select on the card moves it too, by the lane's id (the option reads only the week's dates).
      await page.setViewportSize({ width: 800, height: 1000 });
      await sleep(800);
      await openCard("[TESTE] criado e editado pelo SM").locator('select[aria-label="Mover para"]').selectOption("zz-test-sprint");
      await sleep(2500);
      const outOfWeek = await laneOfItem(created.id);
      expect("move (select on the Open card, narrow screen): the item goes back to the test week", outOfWeek === "zz-test-sprint", outOfWeek);
      {
        const last = await isLastOfWeek(created.id);
        expect("move (select): \"Mover para\" puts the item last in the week", last.ok, JSON.stringify(last.rows));
      }
      expect("empty week: its only item moved out, the future week's lane is deleted", (await laneRows(trailing)).length === 0);
      await page.locator(`[data-lane-id="${next}"]`).waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
      expect("empty week: the row ends again with that week, empty and not stored",
        (await count(page.locator(`[data-lane-id="${trailing}"][data-virtual]`))) === 1 && (await count(page.locator(`[data-lane-id="${next}"]`))) === 0);
      expect("move (select): the Open card is labelled with the test week again", (await inOpen("[TESTE] criado e editado pelo SM")).label === "▸ Sprint 07/12");
      await page.setViewportSize({ width: 1440, height: 900 });
      await sleep(500);
    }

    // ------------------------------------------------ a card dropped on another one of a week goes right before it
    // Ties and gaps an older writer left (7, 7, 9) are set first, on items of three owners: the server renumbers the
    // whole week 0, 1, 2… in its new order, the admin's item too, which the scrum master's own session can't write.
    const weekOrder = async () => (await svc.from("roadmap_items").select("id, sort_order").eq("lane_id", "zz-test-sprint").order("sort_order").order("id")).data ?? [];
    const shownOrder = (p) => p.locator('[data-lane-id="zz-test-sprint"] [data-item-id]').evaluateAll((els) => els.map((el) => el.dataset.itemId));
    const at = (order, id) => order.findIndex((r) => r.id === id);
    const numbered = (order) => order.every((r, i) => r.sort_order === i);
    const lineOn = (p, id) => p.locator(`[data-item-id="${id}"] [data-drop-line]`).count();
    {
      const queued = async (id) => ((await svc.from("roadmap_sync_queue").select("id").eq("item_id", id).eq("action", "move_lane")).data ?? []).length;
      // The seeded item goes back to no week, so the drop from Open below is a real move into the week.
      await svc.from("roadmap_items").update({ lane_id: "zz-test-b" }).eq("id", L.ids.seeded);
      await svc.from("roadmap_items").update({ sort_order: 7 }).in("id", [L.ids.adminItem, L.ids.smItem]);
      await svc.from("roadmap_items").update({ sort_order: 9 }).eq("id", created.id);
      await page.reload({ waitUntil: "load" });
      await page.getByText("Carregando...").waitFor({ state: "detached", timeout: 30000 });
      await page.getByText("[TESTE] criado e editado pelo SM").first().waitFor({ timeout: 15000 });
      await L.fitWholePage(page);
      await page.locator('[data-lane-id="zz-test-sprint"]').scrollIntoViewIfNeeded();
      // Like mouseDrag, but the button stays down over the target, so the line can be looked at before the drop.
      const holdOver = async (source, target) => {
        await source.scrollIntoViewIfNeeded();
        const c = await source.boundingBox();
        await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
        await page.mouse.down();
        await page.mouse.move(c.x + c.width / 2 + 10, c.y + c.height / 2 + 10, { steps: 5 });
        const t = await target.boundingBox();
        await page.mouse.move(t.x + t.width / 2, t.y + 12, { steps: 25 });
        await page.mouse.move(t.x + t.width / 2 + 2, t.y + 14, { steps: 2 });
        await sleep(300);
      };

      // From Open (an item with no week) onto the admin's card in the test week.
      const queuedSeeded = await queued(L.ids.seeded);
      await holdOver(openCard("[TESTE] item semeado (sem dono)"), adminItem);
      const litA = await lineOn(page, L.ids.adminItem);
      await page.mouse.up();
      await sleep(2500);
      const afterA = await weekOrder();
      expect("drop on a card (mouse): held over a card of a week, an orange line shows above that card", litA === 1, `lines=${litA}`);
      expect("drop on a card (mouse): the item dragged from Open is saved in the week right before the card it was dropped on",
        at(afterA, L.ids.seeded) >= 0 && at(afterA, L.ids.seeded) + 1 === at(afterA, L.ids.adminItem), JSON.stringify(afterA));
      expect("drop on a card (mouse): the week is numbered 0, 1, 2… in its new order, the admin's item renumbered too (by the server)",
        afterA.length === 4 && numbered(afterA), JSON.stringify(afterA));
      expect("drop on a card (mouse): the move into the week is queued, once", (await queued(L.ids.seeded)) === queuedSeeded + 1);
      const shownA = await shownOrder(page);
      expect("drop on a card (mouse): the week on the screen shows the order saved", JSON.stringify(shownA) === JSON.stringify(afterA.map((r) => r.id)), JSON.stringify(shownA));

      // Within the same week: the item, last there, onto the card just dropped.
      const queuedOwn = await queued(created.id);
      await holdOver(card("[TESTE] criado e editado pelo SM"), seeded);
      const litB = await lineOn(page, L.ids.seeded);
      await page.mouse.up();
      await sleep(2500);
      const afterB = await weekOrder();
      expect("reorder within a week (mouse): the line shows on the card, and the item is saved right before it",
        litB === 1 && at(afterB, created.id) + 1 === at(afterB, L.ids.seeded) && numbered(afterB), JSON.stringify({ litB, afterB }));
      expect("reorder within a week: nothing is queued (roadmap-state's position carries the order)", (await queued(created.id)) === queuedOwn);
      const shownB = await shownOrder(page);
      await page.reload({ waitUntil: "load" });
      await page.getByText("Carregando...").waitFor({ state: "detached", timeout: 30000 });
      await page.getByText("[TESTE] criado e editado pelo SM").first().waitFor({ timeout: 15000 });
      const reloadedB = await shownOrder(page);
      expect("reorder within a week: the screen shows the order saved, right after the drop and on a fresh load",
        JSON.stringify(shownB) === JSON.stringify(afterB.map((r) => r.id)) && JSON.stringify(reloadedB) === JSON.stringify(shownB), JSON.stringify({ shownB, reloadedB }));
      expect("drop on a card: no line is left on the page after the drops", (await page.locator("[data-drop-line]").count()) === 0);
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

      // Held, then dropped on another card of its week: it goes right before that card, under the orange line. The
      // target is the week's last card, never the one right after the held card (the held one is right before the
      // seeded item since the mouse reorder above), so the drop is a real change.
      {
        const order0 = await weekOrder();
        const targetId = order0.at(-1).id;
        await phoneCard().scrollIntoViewIfNeeded();
        from = await centre(phoneCard());
        const onto = await centre(phone.page.locator(`[data-lane-id="zz-test-sprint"] [data-item-id="${targetId}"]`));
        await holdTestCard(from);
        await glide(from, onto, 16);
        await sleep(200);
        const lineLit = await lineOn(phone.page, targetId);
        await touch("touchEnd");
        await sleep(2500);
        const order1 = await weekOrder();
        expect("phone: held over another card of its week, an orange line shows above that card", lineLit === 1, `lines=${lineLit}`);
        expect("phone: dropped on that card, the item is saved right before it, the week numbered 0, 1, 2…",
          at(order1, created.id) + 1 === at(order1, targetId) && numbered(order1), JSON.stringify({ order0, order1 }));
        const shown = await shownOrder(phone.page);
        expect("phone: the week on the screen shows the order saved", JSON.stringify(shown) === JSON.stringify(order1.map((r) => r.id)), JSON.stringify(shown));
      }

      // Near the top of the screen the page scrolls by itself while a card is lifted; a cancelled touch saves nothing.
      // Only the [TESTE] card is held, and the gesture ends in touchCancel, so no real item can land anywhere.
      // The card held is the item's copy in the Kanban's Open, low on the page: the page is scrolled to put it 300 px
      // from the top of the screen, so there is room to scroll up.
      await phone.page.setViewportSize({ width: 390, height: 844 });
      await sleep(300);
      const phoneOpenCard = phone.page.locator('[data-kanban-column="open"] div[draggable]', { hasText: "[TESTE] criado e editado pelo SM" }).first();
      const openTop = await phoneOpenCard.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      await phone.page.evaluate((y) => window.scrollTo(0, y), Math.max(0, openTop - 300));
      await sleep(300);
      const before = await phone.page.evaluate(() => window.scrollY);
      from = await centre(phoneOpenCard);
      await holdTestCard(from);
      await glide(from, { x: from.x, y: 6 }, 10);
      await sleep(800);
      const after = await phone.page.evaluate(() => window.scrollY);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await sleep(1200);
      expect("phone: holding a card near the top edge scrolls the page up", before > 100 && before - after > 100, `scrollY ${before} -> ${after}`);
      expect("phone: a cancelled touch puts the card back and saves nothing", (await lane(created.id)) === "zz-test-sprint" && (await phone.page.locator("[data-touch-ghost]").count()) === 0);

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

    // ------------------------------------------------ unplan: a card dragged from a week back to the Kanban
    // The item is in the test week, its card labelled in Open. The server picks the type lane: the issue's type label,
    // else the type the item is stored with (bug, saved above; the test server reads no labels, its token is empty).
    await page.getByText("[TESTE] criado e editado pelo SM").first().waitFor({ timeout: 15000 });
    await L.fitWholePage(page);
    {
      const title = "[TESTE] criado e editado pelo SM";
      const since = new Date().toISOString();
      // Its own card in Open, dropped back on Open, is no unplanning: only a card taken out of a week is.
      await mouseDrag(openCard(title), open);
      await sleep(2000);
      expect("unplan: the Open card dropped back on Open changes nothing (the item stays in its week)", (await laneOfItem(created.id)) === "zz-test-sprint", await laneOfItem(created.id));

      await mouseDrag(card(title), open);
      await sleep(2500);
      expect("unplan (drag from the week to the Kanban): the item is saved in the bug type lane, out of the week", (await laneOfItem(created.id)) === "tipo-bug", await laneOfItem(created.id));
      const { data: q } = await svc.from("roadmap_sync_queue").select("payload").eq("item_id", created.id).eq("action", "move_lane").gte("created_at", since);
      const moves = (q ?? []).map((r) => r.payload);
      expect("unplan: one move_lane is queued, from the test week to the bug type lane, from the app",
        moves.length === 1 && moves[0]?.from_lane_id === "zz-test-sprint" && moves[0]?.lane_id === "tipo-bug" && moves[0]?.origin === "app", JSON.stringify(moves));
      const shown = await inOpen(title);
      expect("unplan: the card stays in Open with no week label, not faded, and is in no week",
        shown.copies === 1 && shown.label === null && shown.opacity === "1" && (await count(card(title))) === 0, JSON.stringify(shown));
      await page.reload({ waitUntil: "load" });
      await page.getByText("Carregando...").waitFor({ state: "detached", timeout: 30000 });
      await openCard(title).waitFor({ timeout: 15000 });
      const reloaded = await inOpen(title);
      expect("unplan: on a fresh load the card is in Open with no week label, and in no week",
        reloaded.copies === 1 && reloaded.label === null && (await count(page.locator(`[data-lane-id] [data-item-id="${created.id}"]`))) === 0, JSON.stringify(reloaded));
    }

    // ------------------------------------------------ delete: own yes, others no; from the card in Open
    const toDelete = openCard("[TESTE] criado e editado pelo SM");
    await btn(toDelete, "Excluir").click();
    await sleep(2000);
    const { data: gone } = await svc.from("roadmap_items").select("id").eq("id", created.id);
    expect("delete (Excluir on the Open card): own item is removed, from Open and from its week", gone.length === 0 &&
      (await count(page.locator(`[data-item-id="${created.id}"]`))) === 0);
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
    // A seed left behind fails the run, without counting as one of its checks.
    await unseed().catch((e) => {
      unseedFailed = true;
      console.error("unseed failed:", L.scrub(e && e.message ? e.message : e));
    });
    await browser.close();
    await L.cleanup(t0);
  }
  process.exit(L.summary("SCRUM MASTER") || unseedFailed ? 1 : 0);
})();
