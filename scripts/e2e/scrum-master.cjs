const L = require("./lib.cjs");
const { BASE, expect, sleep, svc } = L;

// The Kanban under the weeks is built from the board snapshot the sync stores (board_sync_state.columns), which the
// test server can't refresh (GITHUB_TOKEN is empty). Made-up cards go into it for the run, the way the sync stores
// them, with when their Status changed: an issue Open on the Project that a Roadmap item holds, one no item holds, one
// in Development (its item must stay out of Open), one that went to Done yesterday and one 30 days ago. The numbers
// are far above any real issue (from L.SYNTHETIC_ISSUE_MIN up), so nothing real is ever named; the returned function takes them out again, leaving
// the rest of the snapshot as the last real sync wrote it.
const GEOCLOUD = "https://github.com/Essencis-Labs/GeoCloudAI/issues/";
const BOARD = {
  open: { number: L.SYNTHETIC_ISSUE_MIN + 101, title: "[TESTE] issue aberta no Project" },
  orphan: { number: L.SYNTHETIC_ISSUE_MIN + 102, title: "[TESTE] issue aberta sem item" },
  dev: { number: L.SYNTHETIC_ISSUE_MIN + 103, title: "[TESTE] issue em Development" },
  doneRecent: { number: L.SYNTHETIC_ISSUE_MIN + 104, title: "[TESTE] issue concluída ontem" },
  doneOld: { number: L.SYNTHETIC_ISSUE_MIN + 105, title: "[TESTE] issue concluída há 30 dias" },
};
const DAY = 24 * 60 * 60 * 1000;
const LONG_SUMMARY = Array.from({ length: 12 }, (_, i) => `Frase ${i + 1} do resumo de teste, longa o bastante para ocupar espaço no card.`).join(" ");
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
  // Their items, with no week (in a test type lane): the Open one, with a summary far longer than three lines of a
  // card (issue #28), and the one in Development.
  const item = async (c, description = "descrição de teste") => {
    const { data, error } = await svc
      .from("roadmap_items")
      .insert({ lane_id: "zz-test-a", title: c.title, description, created_by: null, github_issue_url: GEOCLOUD + c.number, github_issue_number: c.number })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };
  const ids = { open: await item(BOARD.open, LONG_SUMMARY), dev: await item(BOARD.dev) };
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
    await page.getByText("Loading...").waitFor({ state: "detached", timeout: 30000 });
    // Each item of the test week shows twice: in the week, and in the Kanban's Open with the week's label.
    await page.getByText("[TESTE] item do scrum master").first().waitFor();
    const count = (loc) => loc.count();
    const open = page.locator('[data-kanban-column="open"]');
    const done = page.locator('[data-kanban-column="done"]');
    expect("roadmap: no subtitle and no drag hint under the title", (await count(page.getByText(/decide what goes in|Drag a card from Open/))) === 0);
    expect("roadmap: 'Sync' is available", (await count(page.getByRole("button", { name: /^Sync$/ }))) === 1);
    expect("roadmap: one '+ New item', in the Kanban's Open, none in any week",
      (await count(page.getByRole("button", { name: "+ New item" }))) === 1 && (await count(open.getByRole("button", { name: "+ New item" }))) === 1 &&
        (await count(page.locator("[data-lane-id]").getByRole("button", { name: "+ New item" }))) === 0);
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
      // The tabs Open and Done are a phone's: on a wide screen both columns show, side by side, and no tab does.
      const side = await page.evaluate(() => {
        const o = document.querySelector('[data-kanban-column="open"]')?.getBoundingClientRect();
        const d = document.querySelector('[data-kanban-column="done"]')?.getBoundingClientRect();
        const tabs = [...document.querySelectorAll('[role="tab"]')].filter((el) => el.getClientRects().length > 0).length;
        return o && d ? { sideBySide: d.left >= o.right && Math.abs(d.top - o.top) < 2, openW: o.width, doneW: d.width, tabs } : null;
      });
      expect("kanban: on a wide screen Open and Done are side by side, and no tab Open or Done shows",
        !!side?.sideBySide && side.openW > 0 && side.doneW > 0 && side.tabs === 0, JSON.stringify(side));
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
      // The card of an item with an issue shows the issue's summary in at most three lines, with "Show more" to read it
      // all (issue #28).
      const summary = tied.locator("[data-desc]");
      const lines = (el) => {
        const s = getComputedStyle(el);
        return { lines: Math.round(el.clientHeight / parseFloat(s.lineHeight)), cut: el.scrollHeight > el.clientHeight + 1, state: el.dataset.desc };
      };
      const folded = (await count(summary)) === 1 ? await summary.evaluate(lines) : null;
      const showMore = tied.locator("[data-desc-toggle]");
      expect("card: a long summary of the issue is folded to 3 lines, cut, with 'Show more'",
        folded?.state === "folded" && folded.lines === 3 && folded.cut && (await count(showMore)) === 1 && (await showMore.innerText()).trim() === "Show more",
        JSON.stringify(folded));
      await showMore.click();
      const unfolded = await summary.evaluate(lines);
      expect("card: 'Show more' shows the whole summary, more than 3 lines and nothing cut, and turns into 'Show less'",
        unfolded.state === "open" && unfolded.lines > 3 && !unfolded.cut && (await summary.innerText()).trim() === LONG_SUMMARY && (await showMore.innerText()).trim() === "Show less",
        JSON.stringify(unfolded));
      await showMore.click();
      expect("card: 'Show less' folds it back to 3 lines", (await summary.evaluate(lines)).lines === 3);
      const orphan = open.locator("[data-issue-card]", { hasText: BOARD.orphan.title });
      expect("kanban: an issue Open on the Project that no item holds is a plain link to it in Open",
        (await count(orphan)) === 1 && (await orphan.getAttribute("href")) === GEOCLOUD + BOARD.orphan.number);
      expect("kanban: an issue in Development is not in Open (its item neither)",
        (await count(open.getByText(BOARD.dev.title))) === 0 && (await count(open.locator(`[data-item-id="${board.ids.dev}"]`))) === 0);
      // Done: what went to Done in the last 14 days, counted from when the Status changed; "Show all" shows the rest.
      const { data: snap } = await svc.from("board_sync_state").select("columns").eq("id", true).single();
      const doneCards = (snap.columns ?? []).find((c) => c.key === "done")?.items ?? [];
      const recent = doneCards.filter((c) => c.statusAt && Date.now() - Date.parse(c.statusAt) <= 14 * DAY).length;
      const shownDone = () => done.locator("[data-issue-card]").count();
      expect("done: the cards that went to Done in the last 14 days, the one of yesterday in, the one of 30 days ago out",
        (await shownDone()) === recent && (await count(done.getByText(BOARD.doneRecent.title))) === 1 && (await count(done.getByText(BOARD.doneOld.title))) === 0,
        `${await shownDone()} of ${recent}`);
      expect("done: only to look at (nothing to drag, no button but 'Show all')",
        (await count(done.locator("[draggable]"))) === 0 && (await count(done.getByRole("button"))) === 1);
      await done.getByRole("button", { name: /^Show all/ }).click();
      expect("done: 'Show all' shows every Done card of the snapshot right there, the one of 30 days ago too",
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
      const shown = await row.evaluateAll((lanes) => lanes.map((l) => ({ id: l.dataset.laneId, virtual: l.hasAttribute("data-virtual"), title: l.querySelector("[data-lane-title]")?.textContent?.trim() ?? "", current: l.getAttribute("aria-current") })));
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
    const btn = L.cardButton;
    const seeded = card("[TESTE] item semeado (sem dono)");
    const adminItem = card("[TESTE] item do admin");

    for (const [where, of] of [["in its week", card], ["in the Kanban's Open", openCard]]) {
      const own = of("[TESTE] item do scrum master");
      const noOwner = of("[TESTE] item semeado (sem dono)");
      const admins = of("[TESTE] item do admin");
      expect(`own item ${where}: draggable, with Edit and Delete`, (await own.getAttribute("draggable")) === "true" && (await count(btn(own, "Edit"))) === 1 && (await count(btn(own, "Delete"))) === 1);
      expect(`seeded item (no owner) ${where}: draggable, '+ Comment' only, no Edit, no Delete`, (await noOwner.getAttribute("draggable")) === "true" && (await count(btn(noOwner, "+ Comment"))) === 1 && (await count(btn(noOwner, "Edit"))) === 0 && (await count(btn(noOwner, "Delete"))) === 0);
      expect(`admin's item ${where}: not draggable and no controls at all`, (await admins.getAttribute("draggable")) === "false" && (await count(admins.getByRole("button"))) === 0);
    }

    // ------------------------------------------------ create through the UI: "+ New item" in the Kanban's Open
    await open.getByRole("button", { name: "+ New item" }).click();
    // The one card in edit mode (not draggable while editing, has the note field): stable while its inputs change.
    const fresh = page.locator('div[draggable="false"]:has(input[placeholder^="Write a Comment"])');
    await fresh.waitFor({ timeout: 15000 });
    expect("create: the new item opens straight into edit mode, in Open",
      (await count(fresh)) === 1 && (await count(open.locator('div[draggable="false"]:has(input[placeholder^="Write a Comment"])'))) === 1);
    // Its Description is born as the Problema › Solução template its issue's body will open with (issue #28).
    const template = "## Problema\n\nO que acontece hoje e quem sente.\n\n## Solução\n\nO que passa a acontecer, em uma ou duas frases.";
    const bornWith = await fresh.locator("textarea").inputValue();
    expect("create: the Description field opens with the Problema › Solução template", bornWith === template, JSON.stringify(bornWith));
    await fresh.locator("input").first().fill("[TESTE] criado pelo Scrum Master");
    await fresh.locator("textarea").fill("descrição escrita no teste");
    // By their visible labels, not their position: the card gained and lost selects (Type, Stack) over time.
    // The select sits inside its <label>, so the label's accessible name also carries every option: match its caption.
    const labelled = (scope, caption) => scope.locator("label").filter({ has: page.getByText(caption, { exact: true }) }).locator("select");
    await labelled(fresh, "Priority").selectOption("High");
    await labelled(fresh, "Effort").selectOption("Low");
    await fresh.getByPlaceholder("Write a Comment (optional)...").fill("[TESTE] primeira nota");
    await btn(fresh, "Save").click();
    await page.getByText("[TESTE] criado pelo Scrum Master").first().waitFor({ timeout: 15000 });
    await sleep(1500);
    const { data: created } = await svc.from("roadmap_items").select("id, title, prioridade, effort, created_by, github_issue_url, lane_id").eq("title", "[TESTE] criado pelo Scrum Master").maybeSingle();
    expect("create: saved with the SM as owner, High/Low, with no week: in the feature type lane", created && created.created_by === L.ids.sm && created.prioridade === "High" && created.effort === "Low" && created.lane_id === "tipo-feature", JSON.stringify(created));
    expect("create: no GitHub issue was opened (the token is empty in this test server)", created && created.github_issue_url === null);
    // The week's order is roadmap_items.sort_order (the Roadmap's week, the Dashboard's Sprint and roadmap-state's
    // position all read it); a new item, and an item moved with "Move to", goes last.
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
    expect("create: the note is not shown on the card (issue #34): Comments only go up to the issue", (await count(open.locator("div[draggable]", { hasText: "[TESTE] criado pelo Scrum Master" }).getByText("[TESTE] primeira nota"))) === 0);

    // ------------------------------------------------ edit own item, on its card in Open
    const own = openCard("[TESTE] criado pelo Scrum Master");
    await btn(own, "Edit").click();
    const editing = page.locator('div[draggable="false"]:has(input[placeholder^="Write a Comment"])');
    await editing.locator("input").first().fill("[TESTE] criado e editado pelo SM");
    // A bug: unplanned later, the item goes back to the bug type lane (the server picks it by the item's type).
    await labelled(editing, "Type").selectOption("bug");
    // The Stacks are named in English (issue #22): the old Portuguese names are no longer offered.
    const stackOptions = await labelled(editing, "Stack").locator("option").allTextContents();
    expect("edit own item: Stack offers the English names only", stackOptions.includes("Database") && stackOptions.includes("General") && !stackOptions.includes("Banco de dados") && !stackOptions.includes("Geral"), JSON.stringify(stackOptions));
    await labelled(editing, "Stack").selectOption("Database");
    await labelled(editing, "Effort").selectOption("High");
    await btn(editing, "Save").click();
    await page.getByText("[TESTE] criado e editado pelo SM").first().waitFor({ timeout: 15000 });
    await sleep(1000);
    const { data: edited } = await svc.from("roadmap_items").select("title, tipo, stack, effort, field_changed_at").eq("id", created.id).single();
    expect("edit own item: the new title and the type bug are saved", edited.title === "[TESTE] criado e editado pelo SM" && edited.tipo === "bug", JSON.stringify(edited));
    // The two-way sync settles a field both sides changed by when it was edited here: each edited field has its time.
    const stamped = Object.keys(edited.field_changed_at ?? {});
    expect("edit own item: Stack Database and Effort High saved, each edited field (title, type, stack, effort) with the time of its edit",
      edited.stack === "Database" && edited.effort === "High" && ["title", "tipo", "stack", "effort"].every((f) => stamped.includes(f)), JSON.stringify(edited));

    // ------------------------------------------------ the Status selector (issue #22): Done, Blocker and back to Open
    // An item with no week: Open stays where it is (Development would plan it into the real current week, so it isn't
    // chosen here). Done and Blocker are the item's own, shown on its card; the sync takes them to the issue.
    const setStatus = async (status) => {
      await btn(openCard("[TESTE] criado e editado pelo SM"), "Edit").click();
      const panel = page.locator('div[draggable="false"]:has(input[aria-label="New Comment"])');
      const offered = await labelled(panel, "Status").locator("option").allTextContents();
      await labelled(panel, "Status").selectOption(status);
      await btn(panel, "Save").click();
      await panel.waitFor({ state: "detached", timeout: 15000 });
      // The save lands after the panel closes: wait for it (up to 15 s), then for the board it reloads.
      let data = null;
      for (let i = 0; i < 30; i++) {
        ({ data } = await svc.from("roadmap_items").select("status, lane_id, field_changed_at").eq("id", created.id).single());
        if (data?.status === status || (status === "Development" && data?.status === "Open")) break;
        await sleep(500);
      }
      await sleep(1500);
      return { offered, row: data };
    };
    {
      const done = await setStatus("Done");
      expect("status: the selector offers Open, Development, Blocker and Done", JSON.stringify(done.offered) === JSON.stringify(["Open", "Development", "Blocker", "Done"]), JSON.stringify(done.offered));
      expect("status: Done is saved with its edit time, and the item stays where it was",
        done.row.status === "Done" && !!done.row.field_changed_at?.status && done.row.lane_id === created.lane_id, JSON.stringify(done.row));
      expect("status: the card shows Done", (await count(openCard("[TESTE] criado e editado pelo SM").getByText("Done", { exact: true }))) === 1);
      const blocked = await setStatus("Blocker");
      expect("status: Blocker is saved and shown on the card", blocked.row.status === "Blocker" && (await count(openCard("[TESTE] criado e editado pelo SM").getByText("Blocker", { exact: true }))) === 1, JSON.stringify(blocked.row));
      const reopened = await setStatus("Open");
      expect("status: back to Open, with no badge, still out of any week",
        reopened.row.status === "Open" && reopened.row.lane_id === created.lane_id && (await count(openCard("[TESTE] criado e editado pelo SM").getByText("Blocker", { exact: true }))) === 0, JSON.stringify(reopened.row));
    }

    // ------------------------------------------------ Comments (issue #34): the card shows none, edits none, deletes none
    // A Comment only goes up to the issue; it is read there. The one written on create is still stored (checked above).
    expect("Comment: the card shows no Comment, and so no Edit or Delete of one",
      (await count(page.locator("[data-comment-id]"))) === 0 && (await count(openCard("[TESTE] criado e editado pelo SM").getByText("[TESTE] primeira nota"))) === 0);

    // ------------------------------------------------ Assignees (issue #23): picked among the profiles with a GitHub login
    const { data: smLogin } = await svc.from("profiles").select("github_login").eq("id", L.ids.sm).single();
    await svc.from("profiles").update({ github_login: "zz-teste-sm" }).eq("id", L.ids.sm);
    try {
      await page.reload({ waitUntil: "load" });
      await openCard("[TESTE] criado e editado pelo SM").waitFor({ timeout: 30000 });
      await btn(openCard("[TESTE] criado e editado pelo SM"), "Edit").click();
      const assigning = page.locator('div[draggable="false"]:has([data-assignees])');
      // The profile shows by its name (the account's, or the login when it has none).
      const { data: smUser } = await svc.auth.admin.getUserById(L.ids.sm);
      const smName = smUser.user?.user_metadata?.name?.trim() || "zz-teste-sm";
      const choice = assigning.locator("[data-assignees] label", { hasText: smName });
      await choice.waitFor({ timeout: 15000 });
      await choice.locator("input").check();
      await btn(assigning, "Save").click();
      await openCard("[TESTE] criado e editado pelo SM").locator("[data-assignees-shown]").waitFor({ timeout: 15000 });
      const { data: assigned } = await svc.from("roadmap_items").select("assignees, field_changed_at").eq("id", created.id).single();
      expect("Assignees: the profile picked is saved as its GitHub login, with the time of the edit",
        JSON.stringify(assigned.assignees) === '["zz-teste-sm"]' && Boolean(assigned.field_changed_at?.assignees), JSON.stringify(assigned));
    } finally {
      await svc.from("profiles").update({ github_login: smLogin.github_login }).eq("id", L.ids.sm);
    }

    // ------------------------------------------------ seeded item: note + priority only, on its card in Open
    await btn(openCard("[TESTE] item semeado (sem dono)"), "+ Comment").click();
    const noting = page.locator('div[draggable="false"]:has(input[placeholder^="Write a Comment"])');
    expect("seeded item: the edit panel has NO title/description/produto fields", (await count(noting.getByText("Title", { exact: true }))) === 0 && (await count(noting.getByText("Description", { exact: true }))) === 0);
    await labelled(noting, "Priority").selectOption("Critical");
    await noting.getByPlaceholder("Write a Comment (optional)...").fill("[TESTE] nota no item semeado");
    // The card shows no Comment (issue #34), and the panel closes before the save is sent: the row is read once the
    // server action that carries the item has answered (it may wait behind another action of the page).
    const seededSaved = page.waitForResponse((r) => {
      const q = r.request();
      return q.method() === "POST" && !!q.headers()["next-action"] && (q.postData() ?? "").includes(L.ids.seeded) && (q.postData() ?? "").includes("[TESTE] nota no item semeado");
    }, { timeout: 20000 });
    await btn(noting, "Save").click();
    await seededSaved;
    await noting.waitFor({ state: "detached", timeout: 15000 });
    const { data: sRow } = await svc.from("roadmap_items").select("title, prioridade, field_changed_at").eq("id", L.ids.seeded).single();
    const { data: sNotes } = await svc.from("item_notes").select("author_role").eq("item_id", L.ids.seeded);
    expect("seeded item: priority changed, title untouched, note stored as scrum_master", sRow.prioridade === "Critical" && sRow.title === "[TESTE] item semeado (sem dono)" && sNotes.length === 1 && sNotes[0].author_role === "scrum_master", JSON.stringify([sRow, sNotes]));
    expect("seeded item: '+ Comment' saves the Comment, and the card shows none", (await count(page.getByText("[TESTE] nota no item semeado"))) === 0 && (await count(page.locator("[data-comment-id]"))) === 0);
    expect("seeded item: the priority's edit time is kept for the two-way sync, and the title has none", !!sRow.field_changed_at?.prioridade && !sRow.field_changed_at?.title, JSON.stringify(sRow));

    // ------------------------------------------------ plan: a card dragged from Open to a week stays in Open, labelled with it
    // Native HTML5 drag: Playwright's dragTo doesn't start one here, so move the mouse in steps, like a person. A drop
    // only lands on screen, and Open holds every real open issue (a hundred cards and more), so a window grown to the
    // whole page no longer keeps the card and the week on screen together. The drag is made in a window of 1440×900,
    // where the row of weeks stays at the top while the page scrolls (sticky): a card or lane of that row is brought
    // into view sideways, in the row, and anything under it (a card of Open, Open itself) is scrolled to just under the
    // row, as little as needed. Where a card sits in Open, and how many cards Open holds, then no longer matters.
    const DRAG_VIEW = { width: 1440, height: 900 };
    const inWeeks = (loc) => loc.evaluate((el) => !!el.closest("[data-weeks]"));
    // Scrolls the window until the top `need` px of the element (all of it, if it fits) are between the row's bottom
    // and the window's bottom; re-measured each time, since the row stops being sticky near the page's top.
    const showUnderWeeks = async (loc, need) => {
      for (let i = 0; i < 6; i++) {
        const by = await loc.evaluate((el, need) => {
          const r = el.getBoundingClientRect();
          const floor = (document.querySelector("[data-weeks]")?.getBoundingClientRect().bottom ?? 0) + 8;
          const ceil = window.innerHeight - 20;
          const h = Math.min(need ?? r.height, ceil - floor);
          if (r.top < floor) return r.top - floor;
          if (r.top + h > ceil) return r.top + h - ceil;
          return 0;
        }, need ?? null);
        if (Math.abs(by) < 1) return;
        await page.evaluate((y) => window.scrollBy(0, y), by);
        await sleep(150);
      }
    };
    // Whether the point the mouse uses is on the element itself, not under the row of weeks or off screen.
    const hits = (loc, x, y) => loc.evaluate((el, [x, y]) => el.contains(document.elementFromPoint(x, y)), [x, y]);
    const mouseDrag = async (source, target) => {
      const size = page.viewportSize();
      if (size?.width !== DRAG_VIEW.width || size?.height !== DRAG_VIEW.height) {
        await page.setViewportSize(DRAG_VIEW);
        await sleep(600);
      }
      // A week can be off screen to the side in its row: the row's ones first, then the rest under the row, the
      // target before the source (Open as the target needs its top on screen; a card of Open as the source, all of it).
      if (await inWeeks(target)) await target.scrollIntoViewIfNeeded();
      if (await inWeeks(source)) await source.scrollIntoViewIfNeeded();
      if (!(await inWeeks(target))) await showUnderWeeks(target, 40);
      if (!(await inWeeks(source))) await showUnderWeeks(source);
      // Held in its upper part (its title), which is on screen however tall the card is.
      const c = await source.boundingBox();
      const from = { x: c.x + c.width / 2, y: c.y + Math.min(c.height / 2, 60) };
      // Dropped 12 px under the target's top (a week's header, not one of its cards; Open's top); should that point be
      // under something else, the first point lower down that is on the target.
      const t = await target.boundingBox();
      const to = { x: t.x + t.width / 2, y: t.y + 12 };
      for (let y = to.y; !(await hits(target, to.x, y)) && y < Math.min(t.y + t.height, DRAG_VIEW.height); y += 8) to.y = y + 8;
      // Not a check of its own: the checks after the drag fail if it didn't land; this says why.
      if (!(await hits(source, from.x, from.y)) || !(await hits(target, to.x, to.y))) console.error("mouseDrag: the card or the drop point is not on screen", JSON.stringify({ from, to }));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 10, from.y + 10, { steps: 5 });
      await page.mouse.move(to.x, to.y, { steps: 25 });
      await page.mouse.up();
    };
    // The answer to the move a drop saves: the server action's POST that carries the item and the lane it goes to. The
    // action writes the item and its queue row before it answers, so the database is read once the answer is in (a
    // fixed wait loses the race when the move waits behind another action of the page).
    const moveAnswer = (itemId, laneId) =>
      page.waitForResponse((r) => {
        const q = r.request();
        const body = q.postData() ?? "";
        return q.method() === "POST" && !!q.headers()["next-action"] && body.includes(itemId) && body.includes(`"${laneId}"`);
      }, { timeout: 20000 });
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
    {
      const saved = moveAnswer(created.id, "zz-test-sprint");
      await mouseDrag(openCard("[TESTE] criado e editado pelo SM"), testWeek);
      await saved;
    }
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
    await page.getByText("Loading...").waitFor({ state: "detached", timeout: 30000 });
    await openCard("[TESTE] item semeado (sem dono)").waitFor({ timeout: 15000 });
    {
      const before = await inOpen("[TESTE] item semeado (sem dono)");
      expect("plan: an item with no week is in Open with no label, not faded, and in no week", before.label === null && before.opacity === "1" && (await count(seeded)) === 0, JSON.stringify(before));
    }
    {
      const saved = moveAnswer(L.ids.seeded, "zz-test-sprint");
      await mouseDrag(openCard("[TESTE] item semeado (sem dono)"), testWeek);
      await saved;
    }
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
      await openCard("[TESTE] criado e editado pelo SM").locator('select[aria-label="Move to"]').selectOption("zz-test-sprint");
      await sleep(2500);
      const outOfWeek = await laneOfItem(created.id);
      expect("move (select on the Open card, narrow screen): the item goes back to the test week", outOfWeek === "zz-test-sprint", outOfWeek);
      {
        const last = await isLastOfWeek(created.id);
        expect("move (select): \"Move to\" puts the item last in the week", last.ok, JSON.stringify(last.rows));
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
      await page.getByText("Loading...").waitFor({ state: "detached", timeout: 30000 });
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
      await page.getByText("Loading...").waitFor({ state: "detached", timeout: 30000 });
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
      await phone.page.getByText("Loading...").waitFor({ state: "detached", timeout: 30000 });
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
      const select = phone.page.locator('select[aria-label="Move to"]');
      const box = (await select.count()) ? await select.first().boundingBox() : null;
      expect("phone: no 'Move to' select to see on a touch screen (kept for screen readers)", !box || (box.width <= 1 && box.height <= 1), JSON.stringify(box));
      // Nothing (a loose absolute element, say) widens the page past the phone, which would zoom the whole page out.
      const widths = await phone.page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
      expect("phone: the Roadmap is as wide as the phone, not zoomed out", widths[0] === 390 && widths[1] === 390, JSON.stringify(widths));

      // The weeks slide sideways in their row, each 85% of the screen wide, so the next one shows at the edge.
      const phoneOpen = phone.page.locator('[data-kanban-column="open"]');
      const phoneDone = phone.page.locator('[data-kanban-column="done"]');
      {
        const ratios = await phone.page
          .locator('[data-drag-scroll="x"] > [data-lane-id]')
          .evaluateAll((els) => els.map((el) => Math.round((el.getBoundingClientRect().width / window.innerWidth) * 1000) / 1000));
        expect("phone: every week is 85% of the screen wide", ratios.length > 1 && ratios.every((r) => Math.abs(r - 0.85) <= 0.01), JSON.stringify(ratios));
        const rowScroll = await phone.page.locator('[data-drag-scroll="x"]').evaluate((el) => [getComputedStyle(el).overflowX, el.scrollWidth > el.clientWidth]);
        expect("phone: the row of weeks scrolls sideways, inside itself", ["auto", "scroll"].includes(rowScroll[0]) && rowScroll[1] === true, JSON.stringify(rowScroll));
      }

      // Under the weeks, the Kanban shows one column at a time, picked by the tabs Open and Done; Open first.
      {
        const tab = (id) => phone.page.locator(`[role="tab"][data-kanban-tab="${id}"]`);
        const state = async () => ({
          tabs: await phone.page.locator('[role="tablist"] [role="tab"]').allInnerTexts(),
          openTab: await tab("open").getAttribute("aria-selected").catch(() => null),
          doneTab: await tab("done").getAttribute("aria-selected").catch(() => null),
          open: await phoneOpen.isVisible(),
          done: await phoneDone.isVisible(),
        });
        const first = await state();
        expect("phone: the Kanban has two tabs, Open and Done, under the weeks; Open is picked and only its column shows",
          first.tabs.length === 2 && /^Open/.test(first.tabs[0]) && /^Done/.test(first.tabs[1]) && first.openTab === "true" && first.doneTab === "false" && first.open && !first.done,
          JSON.stringify(first));
        const under = await phone.page.evaluate(() => {
          const weeks = document.querySelector("[data-weeks]");
          const list = document.querySelector('[role="tablist"]');
          return !!weeks && !!list && !!(weeks.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        expect("phone: the tabs sit under the row of weeks", under);
        await tab("done").click();
        await sleep(300);
        const onDone = await state();
        expect("phone: the tab Done shows Done alone", onDone.doneTab === "true" && onDone.openTab === "false" && onDone.done && !onDone.open, JSON.stringify(onDone));
        await tab("open").click();
        await sleep(300);
        const back = await state();
        expect("phone: the tab Open brings Open back, alone", back.openTab === "true" && back.open && !back.done, JSON.stringify(back));
        const narrow = await phone.page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
        expect("phone: with the tabs, the Roadmap is still as wide as the phone", narrow[0] === 390 && narrow[1] === 390, JSON.stringify(narrow));
      }

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

      // Held in its week, then dropped on the Kanban's Open: the item is unplanned, into the bug type lane (its type).
      {
        await L.fitWholePage(phone.page);
        await phoneCard().scrollIntoViewIfNeeded();
        const since = new Date().toISOString();
        from = await centre(phoneCard());
        const onto = await centre(phone.page.locator('[data-kanban-column="open"] span', { hasText: /^Open$/ }).first());
        await holdTestCard(from);
        await glide(from, onto, 16);
        await sleep(200);
        await touch("touchEnd");
        await sleep(2500);
        const { data: q } = await svc.from("roadmap_sync_queue").select("payload").eq("item_id", created.id).eq("action", "move_lane").gte("created_at", since);
        expect("phone: a card held in its week and dropped on the Kanban's Open is unplanned, into the bug type lane, with one move_lane from the app",
          (await lane(created.id)) === "tipo-bug" && (q ?? []).length === 1 && q[0].payload?.from_lane_id === "zz-test-sprint" && q[0].payload?.lane_id === "tipo-bug" && q[0].payload?.origin === "app",
          JSON.stringify({ lane: await lane(created.id), q: (q ?? []).map((r) => r.payload) }));
        expect("phone: the unplanned card is in no week on the phone's screen", (await phoneCard().count()) === 0);
      }

      // On the phone's own screen, held in the Kanban's Open and carried up to the row of weeks: held at the row's right
      // edge, the row slides by itself until the farthest week (the test week, the last of the row, off screen at first)
      // is under the finger; over a card there the orange line shows, and the drop plans the item right before that
      // card, its card staying in Open, faded and labelled with the week, as with the mouse.
      {
        await phone.page.setViewportSize({ width: 390, height: 844 });
        await sleep(500);
        const title = "[TESTE] criado e editado pelo SM";
        const row = phone.page.locator('[data-drag-scroll="x"]');
        const testWeekOnPhone = phone.page.locator('[data-lane-id="zz-test-sprint"]');
        const openOne = () => phoneOpen.locator("div[draggable]", { hasText: title }).first();
        await openOne().waitFor({ timeout: 15000 });
        await row.evaluate((el) => {
          el.scrollLeft = 0;
        });
        await sleep(300);
        const farAway = await testWeekOnPhone.evaluate((el) => el.getBoundingClientRect().left >= window.innerWidth);
        expect("phone (plan from Open): the test week starts off screen, to the right of the row", farAway);
        // The card low on the screen, under the weeks.
        const cardTop = await openOne().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
        await phone.page.evaluate((y) => window.scrollTo(0, y), Math.max(0, cardTop - 680));
        await sleep(300);
        const since = new Date().toISOString();
        const order0 = await weekOrder();
        const targetId = order0[0].id;
        from = await centre(openOne());
        await holdTestCard(from);
        // Up to the top of the screen, where the page scrolls by itself, until the page is at its top. Open holds every
        // real open issue, so the page can be tens of thousands of px tall above the card: what the page has not
        // scrolled in that time the test scrolls itself, with the card still held (no check here is about that trip;
        // "holding a card near the top edge scrolls the page up" above is). The row of weeks is then on screen.
        await glide(from, { x: from.x, y: 6 }, 10);
        for (let i = 0; i < 60 && (await phone.page.evaluate(() => window.scrollY)) > 0; i++) await sleep(100);
        if ((await phone.page.evaluate(() => window.scrollY)) > 0) {
          await phone.page.evaluate(() => window.scrollTo(0, 0));
          await sleep(300);
        }
        // Onto the row, at its right edge, and held there until it stops at its end.
        const rowBox = await row.boundingBox();
        const atEdge = { x: 372, y: rowBox.y + 30 };
        await glide({ x: from.x, y: 6 }, atEdge, 12);
        const slid = async () => row.evaluate((el) => ({ left: el.scrollLeft, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 }));
        for (let i = 0; i < 150 && !(await slid()).end; i++) await sleep(100);
        const atEnd = await slid();
        const overFar = await phone.page.locator('[data-lane-id="zz-test-sprint"][data-drop-target]').count();
        expect("phone (plan from Open): held at the row's right edge, the row slides by itself to the farthest week, which lights up under the finger",
          atEnd.end && atEnd.left > 0 && overFar === 1, JSON.stringify({ ...atEnd, overFar }));
        // Onto the test week's first card: the orange line shows above it.
        const onto = await centre(phone.page.locator(`[data-lane-id="zz-test-sprint"] [data-item-id="${targetId}"]`));
        await glide(atEdge, onto, 12);
        await sleep(200);
        const lit = await lineOn(phone.page, targetId);
        expect("phone (plan from Open): over a card of the far week, the orange line shows above it", lit === 1, `lines=${lit}`);
        await touch("touchEnd");
        await sleep(2500);
        const order1 = await weekOrder();
        expect("phone (plan from Open): dropped there, the item is saved in the test week, right before that card, the week numbered 0, 1, 2…",
          (await lane(created.id)) === "zz-test-sprint" && at(order1, created.id) + 1 === at(order1, targetId) && numbered(order1), JSON.stringify({ order0, order1 }));
        const { data: q } = await svc.from("roadmap_sync_queue").select("payload").eq("item_id", created.id).eq("action", "move_lane").gte("created_at", since);
        expect("phone (plan from Open): one move_lane is queued, from the bug type lane to the test week",
          (q ?? []).length === 1 && q[0].payload?.from_lane_id === "tipo-bug" && q[0].payload?.lane_id === "zz-test-sprint", JSON.stringify((q ?? []).map((r) => r.payload)));
        const look = await openOne()
          .evaluate((el) => ({ label: el.querySelector("[data-week-label]")?.textContent?.trim() ?? null, opacity: getComputedStyle(el).opacity }))
          .catch(() => null);
        expect("phone (plan from Open): the card stays in Open, at 70%, labelled '▸ Sprint 07/12'",
          (await phoneOpen.locator("div[draggable]", { hasText: title }).count()) === 1 && look?.label === "▸ Sprint 07/12" && look?.opacity === "0.7", JSON.stringify(look));
        expect("phone (plan from Open): no copy of the card is left following the finger", (await phone.page.locator("[data-touch-ghost]").count()) === 0);
      }

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
      await page.getByText("Loading...").waitFor({ state: "detached", timeout: 30000 });
    }

    // ------------------------------------------------ unplan: a card dragged from a week back to the Kanban
    // The item is in the test week, its card labelled in Open. The server picks the type lane: the issue's type label,
    // else the type the item is stored with (bug, saved above; the test server reads no labels, its token is empty).
    await page.getByText("[TESTE] criado e editado pelo SM").first().waitFor({ timeout: 15000 });
    {
      const title = "[TESTE] criado e editado pelo SM";
      const since = new Date().toISOString();
      // Its own card in Open, dropped back on Open, is no unplanning: only a card taken out of a week is.
      await mouseDrag(openCard(title), open);
      await sleep(2000);
      expect("unplan: the Open card dropped back on Open changes nothing (the item stays in its week)", (await laneOfItem(created.id)) === "zz-test-sprint", await laneOfItem(created.id));

      const unplanned = moveAnswer(created.id, "kanban");
      await mouseDrag(card(title), open);
      await unplanned;
      expect("unplan (drag from the week to the Kanban): the item is saved in the bug type lane, out of the week", (await laneOfItem(created.id)) === "tipo-bug", await laneOfItem(created.id));
      const { data: q } = await svc.from("roadmap_sync_queue").select("payload").eq("item_id", created.id).eq("action", "move_lane").gte("created_at", since);
      const moves = (q ?? []).map((r) => r.payload);
      expect("unplan: one move_lane is queued, from the test week to the bug type lane, from the app",
        moves.length === 1 && moves[0]?.from_lane_id === "zz-test-sprint" && moves[0]?.lane_id === "tipo-bug" && moves[0]?.origin === "app", JSON.stringify(moves));
      const shown = await inOpen(title);
      expect("unplan: the card stays in Open with no week label, not faded, and is in no week",
        shown.copies === 1 && shown.label === null && shown.opacity === "1" && (await count(card(title))) === 0, JSON.stringify(shown));
      await page.reload({ waitUntil: "load" });
      await page.getByText("Loading...").waitFor({ state: "detached", timeout: 30000 });
      await openCard(title).waitFor({ timeout: 15000 });
      const reloaded = await inOpen(title);
      expect("unplan: on a fresh load the card is in Open with no week label, and in no week",
        reloaded.copies === 1 && reloaded.label === null && (await count(page.locator(`[data-lane-id] [data-item-id="${created.id}"]`))) === 0, JSON.stringify(reloaded));
    }

    // ------------------------------------------------ unplan by keyboard: "Move to" → "Kanban (no week)"
    // The same server action as the drop on Open, without a drag. Back in the test week first (the service role, like the
    // phone above), then below lg, where the select shows.
    {
      const title = "[TESTE] criado e editado pelo SM";
      await svc.from("roadmap_items").update({ lane_id: "zz-test-sprint" }).eq("id", created.id);
      await page.setViewportSize({ width: 800, height: 1000 });
      await page.reload({ waitUntil: "load" });
      await page.getByText("Loading...").waitFor({ state: "detached", timeout: 30000 });
      await card(title).waitFor({ timeout: 15000 });
      const options = (loc) => loc.locator('select[aria-label="Move to"] option').evaluateAll((els) => els.map((el) => ({ value: el.value, text: el.textContent })));
      const weekOptions = await options(card(title));
      const openOptions = await options(openCard(title));
      expect("unplan (Move to): the card in a week offers 'Kanban (no week)'; its card in Open does not",
        weekOptions.some((o) => o.value === "kanban" && o.text === "Kanban (no week)") && !openOptions.some((o) => o.value === "kanban"),
        JSON.stringify({ weekOptions, openOptions }));

      const since = new Date().toISOString();
      const saved = moveAnswer(created.id, "kanban");
      await card(title).locator('select[aria-label="Move to"]').selectOption("kanban");
      await saved;
      expect("unplan (Move to → Kanban): the item is saved in the bug type lane, out of the week", (await laneOfItem(created.id)) === "tipo-bug", await laneOfItem(created.id));
      const { data: q } = await svc.from("roadmap_sync_queue").select("payload").eq("item_id", created.id).eq("action", "move_lane").gte("created_at", since);
      const moves = (q ?? []).map((r) => r.payload);
      expect("unplan (Move to): one move_lane is queued, from the test week to the bug type lane, from the app",
        moves.length === 1 && moves[0]?.from_lane_id === "zz-test-sprint" && moves[0]?.lane_id === "tipo-bug" && moves[0]?.origin === "app", JSON.stringify(moves));
      // Leaving its week changes the item's Week (issue #22): the time of that edit is kept for the two-way sync.
      const { data: stamped } = await svc.from("roadmap_items").select("field_changed_at").eq("id", created.id).single();
      expect("unplan (Move to): the Week's edit time is kept, at this move", (stamped?.field_changed_at?.week ?? "") >= since, JSON.stringify(stamped));
      await openCard(title).waitFor({ timeout: 15000 });
      const shown = await inOpen(title);
      expect("unplan (Move to): the card is in Open with no week label, and in no week",
        shown.copies === 1 && shown.label === null && (await count(card(title))) === 0, JSON.stringify(shown));
      await page.setViewportSize({ width: 1440, height: 900 });
      await sleep(500);
    }

    // ------------------------------------------------ delete: own yes, others no; from the card in Open
    const toDelete = openCard("[TESTE] criado e editado pelo SM");
    await btn(toDelete, "Delete").click();
    // The delete lands after the card leaves the screen (an issue would be closed first): wait for it, up to 15 s.
    let gone = [];
    for (let i = 0; i < 30; i++) {
      ({ data: gone } = await svc.from("roadmap_items").select("id").eq("id", created.id));
      if (!gone?.length) break;
      await sleep(500);
    }
    expect("delete (Delete on the Open card): own item is removed, from Open and from its week", gone.length === 0 &&
      (await count(page.locator(`[data-item-id="${created.id}"]`))) === 0);
    expect("delete: the admin's item survives, the seeded one has no Delete", (await svc.from("roadmap_items").select("id").eq("id", L.ids.adminItem)).data.length === 1);

    // ------------------------------------------------ Sync with no token
    await page.getByRole("button", { name: /^Sync$/ }).click();
    const msg = await page.getByText(/Sync failed|not configured yet/).waitFor({ timeout: 20000 }).then(() => true, () => false);
    expect("sync issues: with no GitHub token it fails closed with a message", msg);

    // ------------------------------------------------ idle and Sign out
    await page.evaluate(() => localStorage.setItem("roads-last-activity", String(Date.now() - (10 * 60 + 1) * 1000)));
    await page.waitForURL("**/login", { timeout: 45000 });
    expect("idle: 10 minutes and 1 second signs the Scrum Master out", true);
    await L.login(s);
    await menu.waitFor();
    await menu.click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login");
    await page.goto(BASE + "/roadmap", { waitUntil: "load" });
    expect("logout: Sign out ends the session", page.url().endsWith("/login"));

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
    await L.expectNoTestIssues(t0);
    await L.cleanup(t0);
  }
  process.exit(L.summary("SCRUM MASTER") || unseedFailed ? 1 : 0);
})();
