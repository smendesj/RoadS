// "Resumo para a diretoria", role by role: the Dashboard card, the Resumo tab, the review screen, the
// public image link and the three server actions called straight, against the local production server.
//
// Fixtures: two SYNTHETIC reports of produto 'ELIMS' with periods in 2099 (one draft, one already sent),
// created with the service role and removed in `finally`. The real GeoCloud rows are never read or written
// here, and nothing in this file comes from real work: titles, numbers and links are made up.
//
//   admin           reviews everything: edits sentences, sees language warnings, checks the numbers,
//                   copies the e-mail, re-pushes (simulated), marks as sent; a sent report is frozen
//   scrum master    reads SENT reports only, read-only; a draft is a plain 404; every action is refused
//   dev, nobody     redirected; every action is refused; the public image still answers by token
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const L = require("./lib.cjs");
const { BASE, expect, sleep, svc } = L;

const REPO = path.resolve(__dirname, "..", "..");
const MARK = "[TESTE]";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// A print of this suite: made-up bytes that start like a PNG. Stored under the hash of its bytes, like any print.
const E2E_SHOT = Buffer.concat([PNG_SIGNATURE, Buffer.from(`${MARK} print do e2e do Resumo`)]);
const E2E_SHOT_PATH = `${crypto.createHash("sha256").update(E2E_SHOT).digest("hex")}.png`;
// The week of the synthetic sent report (2099-02-02 is a Monday); the presentation puts it together.
const WEEK = "2099-02-02";
// The synthetic reports are of another product, so the week's address names it (GeoCloud is the default).
const WEEK_PATH = `/resumo/semana/${WEEK}?produto=ELIMS`;
const WEEK_USAGE = `/resumo/semana/${WEEK}/uso?produto=ELIMS`;
const WEEK_HEADLINE = "Na semana, 2 entregas concluídas e 1 em andamento.";

// ---------------------------------------------------------------- fixtures (service role)
function makeContent(kind, d1, d2, end) {
  const window = { start: `${d1}T00:00:00-03:00`, end: `${end}T00:00:00-03:00` };
  const entry = (n, status, title, summary, deliveredAt = null) => ({
    id: `gc-${n}`,
    issue: n,
    status,
    title: `${MARK} ${title}`,
    summary,
    deliveredAt,
    subIssues: { total: 2, done: status === "concluido" ? 2 : 1 },
    hidden: false,
    edited: false,
    sources: [`https://github.com/example-org/example-repo/issues/${n}`],
  });
  const day = (date, from, to) => ({
    date,
    sessions: [{ start: `${date}T${from}:00:00-03:00`, end: `${date}T${to}:00:00-03:00`, messages: 80, tokens: 1000000 }],
    firstPromptAt: `${date}T${from}:05:00-03:00`,
    lastPromptAt: `${date}T${to}:00:00-03:00`,
    messages: 80,
    tokens: { input: 1000, output: 2000, cacheRead: 900000, cacheWrite: 97000 },
    hourly: Array.from({ length: 24 }, (_, h) => (h >= Number(from) && h < Number(to) ? 10 : 0)),
  });
  return {
    window,
    headline: `${MARK} Resumo ${kind}: uma entrega pronta e duas em andamento.`,
    entries: [
      entry(9001, "concluido", "Primeira entrega", "A primeira entrega de teste ficou pronta.", `${d2}T15:00:00-03:00`),
      entry(9002, "em_validacao", "Segunda entrega", "A segunda entrega de teste está em validação."),
      entry(9003, "em_andamento", "Terceira entrega", "A terceira entrega de teste está em andamento."),
    ],
    internal: { count: 2, text: "Dois ajustes internos de teste." },
    difficulties: [{ id: "d9001", text: `${MARK} Uma dificuldade de teste.`, needs: "Uma decisão de teste." }],
    nextSteps: [{ id: "n9001", text: `${MARK} Um próximo passo de teste.` }],
    usage: {
      scope: "GeoCloud",
      window,
      generatedAt: `${end}T09:00:00-03:00`,
      totals: { sessions: 2, messages: 160, activeDays: 2, tokens: { input: 2000, output: 4000, cacheRead: 1800000, cacheWrite: 194000 } },
      byModel: [{ model: "claude-opus-5-5", input: 2000, output: 4000, cacheRead: 1800000, cacheWrite: 194000, messages: 160 }],
      favoriteModel: "claude-opus-5-5",
      peakHour: 10,
      days: [day(d1, "09", "17"), day(d2, "10", "18")],
    },
    gaps: [{ at: `${d2}T22:00:00-03:00`, ref: "PR 9001", nearestMessageMinutes: 240 }],
  };
}

const row = async (id) => (await svc.from("progress_reports").select("*").eq("id", id).single()).data;
// Everything an action could change, as one string: "nothing changed" is a string comparison.
const snap = async (id) => {
  const r = await row(id);
  return JSON.stringify([r.status, r.rev, r.overrides, r.checked_at, r.sent_at, r.content.headline]);
};

// Only rows this suite made (their headline starts with the mark) are ever removed.
async function sweep() {
  const { data } = await svc.from("progress_reports").select("id, content").eq("produto", "ELIMS").gte("period_start", "2099-01-01T00:00:00Z");
  const mine = (data ?? []).filter((r) => String(r.content?.headline ?? "").startsWith(MARK)).map((r) => r.id);
  if (mine.length) await svc.from("progress_reports").delete().in("id", mine);
}

async function seed() {
  const stamp = new Date().toISOString();
  const { data, error } = await svc
    .from("progress_reports")
    .insert([
      { produto: "ELIMS", period_start: "2099-01-05T00:00:00-03:00", period_end: "2099-01-07T00:00:00-03:00", status: "draft", content: makeContent("rascunho", "2099-01-05", "2099-01-06", "2099-01-07"), overrides: {} },
      { produto: "ELIMS", period_start: "2099-02-02T00:00:00-03:00", period_end: "2099-02-04T00:00:00-03:00", status: "sent", content: makeContent("enviado", "2099-02-02", "2099-02-03", "2099-02-04"), overrides: {}, checked_at: stamp, sent_at: stamp },
    ])
    .select("id, status, share_token, pushed_at");
  if (error || !data || data.length !== 2) throw new Error(`could not create the fixtures (is the progress_reports migration applied? is there a leftover ELIMS draft?): ${error ? error.message : "no rows"}`);
  return { draft: data.find((r) => r.status === "draft"), sent: data.find((r) => r.status === "sent") };
}

// ---------------------------------------------------------------- server actions, called without the UI
// name -> action id, straight from the production build (they show up because a client component imports them)
function actionIds() {
  const dir = path.join(REPO, ".next", "static", "chunks");
  const ids = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of text.matchAll(/createServerReference\)\("([0-9a-f]{40,})",[^)]*?,"(\w+)"\)/g)) ids[m[2]] = m[1];
  }
  return ids;
}

async function call(ctx, id, args, pagePath) {
  const res = await ctx.request.post(BASE + pagePath, {
    headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: BASE },
    data: JSON.stringify(args),
    maxRedirects: 0,
  });
  const text = await res.text();
  const status = res.status();
  let kind;
  if ([301, 302, 303, 307, 308].includes(status)) kind = "redirect";
  else if (status === 404) kind = "not-found";
  else if (/(^|\n)\d+:E\{/.test(text) || status >= 500) kind = "error";
  else if (status === 200) kind = "ok";
  else kind = `http-${status}`;
  const returned = (text.match(/(?:^|\n)1:(.*)/) || [])[1] ?? "";
  return { status, kind, returned: returned.slice(0, 100), text };
}
// The actions answer { ok: true, ... } on success; anything else (a redirect, an error, { ok: false }) is a refusal.
const accepted = (r) => r.kind === "ok" && /"ok":true/.test(r.text);

// ---------------------------------------------------------------- small helpers
async function until(fn, ms = 12000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await sleep(250);
  }
}
const grab = async (url) => {
  const r = await fetch(url, { redirect: "manual" });
  return {
    status: r.status,
    type: r.headers.get("content-type"),
    cache: r.headers.get("cache-control"),
    cookie: r.headers.get("set-cookie"),
    nosniff: r.headers.get("x-content-type-options"),
    body: Buffer.from(await r.arrayBuffer()),
  };
};
const noise = (s, extra = /^$/) => s.problems.filter((p) => !/auth\/v1\/token|ERR_FAILED|Failed to load resource/.test(p) && !extra.test(p));

(async () => {
  const browser = await L.launch();
  try {
    await sweep();
    const { draft, sent } = await seed();
    const A = actionIds();
    for (const name of ["saveProgressEdit", "setProgressChecked", "markProgressReportSent"]) {
      expect(`build: ${name} is found in the client chunks (so the harness can call it)`, Boolean(A[name]));
    }

    // Tries all three actions against one report as one caller; none may be accepted and the row must not move.
    async function refusedEverywhere(ctx, who, target, label) {
      const before = await snap(target.id);
      const { rev } = await row(target.id);
      const tries = [
        ["saveProgressEdit", { id: target.id, rev, key: "headline", value: `${MARK} mudado por ${who}` }],
        ["setProgressChecked", { id: target.id, rev, checked: true }],
        ["markProgressReportSent", { id: target.id, rev }],
      ];
      for (const [name, args] of tries) {
        const r = await call(ctx, A[name], [args], "/resumo");
        expect(`${who} -> ${name} on the ${label} is refused`, !accepted(r), `${r.kind} ${r.returned.slice(0, 70)}`);
      }
      expect(`${who} -> the ${label} did not change at all`, (await snap(target.id)) === before);
    }

    // ================================================================ nobody signed in
    const anon = await browser.newContext({ locale: "pt-BR" });
    const anonPage = await anon.newPage();
    for (const [name, p] of [["/resumo", "/resumo"], ["/resumo/<draft>", `/resumo/${draft.id}`], ["/resumo/<sent>", `/resumo/${sent.id}`], ["/resumo/semana/<week>", WEEK_PATH]]) {
      await anonPage.goto(BASE + p, { waitUntil: "load" });
      expect(`nobody signed in -> ${name} goes to /login`, new URL(anonPage.url()).pathname === "/login", anonPage.url());
    }
    const anonUsage = await grab(`${BASE}${WEEK_USAGE}`);
    expect("nobody signed in -> the week's usage picture is not served", anonUsage.status !== 200 || !/image\/png/.test(anonUsage.type ?? ""), `${anonUsage.status} ${anonUsage.type}`);
    await refusedEverywhere(anon, "nobody signed in", draft, "draft");
    await refusedEverywhere(anon, "nobody signed in", sent, "sent report");

    // ================================================================ FRONTLIGHTS: the prints door
    // The push script sends each print on its own; only the shared secret opens this door.
    const shotsDoor = `${BASE}/api/frontlights/progress-report/shots`;
    const postShot = (body, secret = process.env.FRONTLIGHTS_API_SECRET) =>
      fetch(shotsDoor, { method: "POST", headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body) });
    const noSecret = await postShot({ data: E2E_SHOT.toString("base64") }, null);
    expect("prints door: without the secret it is a 401", noSecret.status === 401, String(noSecret.status));
    const wrongSecret = await postShot({ data: E2E_SHOT.toString("base64") }, "segredo-errado");
    expect("prints door: a wrong secret is a 401", wrongSecret.status === 401, String(wrongSecret.status));
    const notImage = await postShot({ data: Buffer.from("<svg onload=alert(1)></svg>").toString("base64") });
    expect("prints door: what is not a JPEG or PNG is a 400", notImage.status === 400, String(notImage.status));
    const stored = await postShot({ data: E2E_SHOT.toString("base64") });
    const storedBody = await stored.json().catch(() => ({}));
    expect("prints door: a print is stored under the hash of its bytes", stored.status === 200 && storedBody.path === E2E_SHOT_PATH && storedBody.mime === "image/png", `${stored.status} ${storedBody.path}`);
    const again = await postShot({ data: E2E_SHOT.toString("base64") });
    expect("prints door: the same print again is fine (stored once)", again.status === 200 && (await again.json()).path === E2E_SHOT_PATH, String(again.status));
    // The draft now shows that print under its first delivery (what a push with captions.json would do).
    const draftContent = (await row(draft.id)).content;
    const shotted = await svc
      .from("progress_reports")
      .update({ content: { ...draftContent, shots: [{ id: "shot-1", caption: `${MARK} Tela da primeira entrega`, mime: "image/png", issue: 9001, path: E2E_SHOT_PATH }] } })
      .eq("id", draft.id)
      .select("id");
    expect("prints door: the draft names the stored print", !shotted.error && shotted.data?.length === 1, shotted.error?.message ?? "");

    // ================================================================ FRONTLIGHTS: adding prints to a SENT report
    // Only prints are added; the e-mail already went out, so everything else must stay exactly as it was.
    const attachDoor = (id) => `${BASE}/api/frontlights/progress-report/${id}/shots`;
    const postAttach = (id, body, secret = process.env.FRONTLIGHTS_API_SECRET) =>
      fetch(attachDoor(id), { method: "POST", headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body) });
    const attachBody = (issue = 9001) => ({ shots: [{ caption: `${MARK} Tela da primeira entrega, depois do envio`, mime: "image/png", issue, path: E2E_SHOT_PATH }] });
    const sentBefore = await row(sent.id);
    const keep = (r) => JSON.stringify([r.status, r.overrides, r.checked_at, r.sent_at, r.sent_by, r.pushed_at, r.share_token, { ...r.content, shots: undefined }]);
    expect("attach: without the secret it is a 401", (await postAttach(sent.id, attachBody(), null)).status === 401);
    const toDraft = await postAttach(draft.id, attachBody());
    expect("attach: a draft is a 409 (its prints come with the push)", toDraft.status === 409 && (await toDraft.json()).error === "not_sent", String(toDraft.status));
    const otherIssue = await postAttach(sent.id, attachBody(4242));
    expect("attach: a delivery the report does not have is a 400, naming it", otherIssue.status === 400 && /#4242/.test((await otherIssue.json()).error ?? ""), String(otherIssue.status));
    const neverUploaded = await postAttach(sent.id, { shots: [{ caption: `${MARK} Nunca enviado`, mime: "image/png", issue: 9001, path: `${"e".repeat(64)}.png` }] });
    const neverUploadedBody = await neverUploaded.json().catch(() => ({}));
    expect("attach: a print that was never uploaded is a 400, naming its delivery", neverUploaded.status === 400 && /#9001/.test(neverUploadedBody.error ?? ""), `${neverUploaded.status} ${neverUploadedBody.error}`);
    const ghost = await postAttach(crypto.randomUUID(), attachBody());
    expect("attach: an unknown report is a 404", ghost.status === 404, String(ghost.status));
    const attached = await postAttach(sent.id, attachBody());
    const attachedBody = await attached.json().catch(() => ({}));
    expect("attach: the print is added to the sent report", attached.status === 200 && attachedBody.added === 1 && attachedBody.existing === 0, `${attached.status} ${JSON.stringify(attachedBody)}`);
    const twice = await postAttach(sent.id, attachBody());
    expect("attach: the same print again adds nothing", twice.status === 200 && (await twice.json()).existing === 1, String(twice.status));
    const sentAfter = await row(sent.id);
    expect("attach: text, statuses, numbers, edits, stamps and link of the sent report are untouched", keep(sentAfter) === keep(sentBefore));
    // A second sent report in the same week (Thursday to Friday): the second delivery got done on Friday.
    let fridayToken = null;
    {
      const friday = makeContent("enviado na sexta", "2099-02-05", "2099-02-06", "2099-02-07");
      friday.entries[1].status = "concluido";
      friday.entries[1].title = `${MARK} Segunda entrega, pronta na sexta`;
      // As the collector does: what was delivered before Friday's period comes along hidden.
      friday.entries[0].hidden = true;
      friday.entries[0].title = `${MARK} Primeira entrega, escondida na sexta`;
      friday.shots = [{ id: "shot-1", caption: `${MARK} Tela da terceira entrega, na sexta`, mime: "image/png", issue: 9003, path: E2E_SHOT_PATH }];
      const stamp = new Date().toISOString();
      const { data, error } = await svc
        .from("progress_reports")
        .insert({ produto: "ELIMS", period_start: "2099-02-05T00:00:00-03:00", period_end: "2099-02-07T00:00:00-03:00", status: "sent", content: friday, overrides: {}, checked_at: stamp, sent_at: stamp })
        .select("share_token")
        .single();
      fridayToken = data?.share_token ?? null;
      expect("(setup) a second sent report in the same week", !error && Boolean(fridayToken), error ? error.message : "");
    }
    expect("attach: the report now has that print, after the ones it had", (sentAfter.content.shots ?? []).length === (sentBefore.content.shots ?? []).length + 1 && sentAfter.content.shots.at(-1).issue === 9001);

    // The e-mail client fetches the picture with no cookies: the token in the address is the only key.
    const version = (r) => Date.parse(r.pushed_at).toString(36); // same rule as visualPath() in src/lib/progress-report.ts
    const image = (r, file = "visual.png", token = r.share_token) => grab(`${BASE}/api/progress-report/${token}/${version(r)}/${file}`);
    const draftImage = await image(draft);
    expect("public image: a real token gives a PNG, with no cookie", draftImage.status === 200 && /^image\/png/.test(draftImage.type ?? "") && draftImage.body.subarray(0, 8).equals(PNG_SIGNATURE) && !draftImage.cookie, `${draftImage.status} ${draftImage.type}`);
    expect("public image: a draft's picture is never cached", /no-store/.test(draftImage.cache ?? ""), String(draftImage.cache));
    const sentImage = await image(sent);
    expect("public image: a sent report's picture is cached for a year, immutable", sentImage.status === 200 && /immutable/.test(sentImage.cache ?? "") && /max-age=31536000/.test(sentImage.cache ?? ""), `${sentImage.status} ${sentImage.cache}`);
    const invented = await image(draft, "visual.png", crypto.randomUUID());
    expect("public image: a made-up token is a 404", invented.status === 404, String(invented.status));
    const malformed = await image(draft, "visual.png", "isto-nao-e-um-token");
    expect("public image: a malformed token is a 404", malformed.status === 404, String(malformed.status));
    const strangeFile = await image(draft, "outra-coisa.png");
    expect("public image: an unknown file under a real token is the very same 404 as an unknown token (nothing tells them apart)", strangeFile.status === 404 && strangeFile.body.equals(invented.body) && strangeFile.type === invented.type, `${strangeFile.status}`);
    const storedShot = await image(draft, "shot-1.png");
    expect("public image: a print kept in the bucket comes back byte for byte, with no cookie", storedShot.status === 200 && storedShot.type === "image/png" && storedShot.body.equals(E2E_SHOT) && !storedShot.cookie, `${storedShot.status} ${storedShot.type}`);
    const noSecondShot = await image(draft, "shot-2.png");
    expect("public image: a print the report does not have is the same 404", noSecondShot.status === 404 && noSecondShot.body.equals(invented.body), String(noSecondShot.status));
    expect("public image: nosniff on every answer", [draftImage, sentImage, invented, malformed, strangeFile, storedShot].every((r) => r.nosniff === "nosniff"));

    // ================================================================ DEV
    const dev = await L.newSession(browser, "dev");
    await L.login(dev);
    await L.menuButton(dev.page).waitFor();
    expect("dev -> no Resumo tab", (await dev.page.locator('a[href="/resumo"]').count()) === 0);
    expect("dev -> no Resumo card on the Dashboard", (await dev.page.locator("[data-report-card]").count()) === 0);
    for (const [name, p] of [["/resumo", "/resumo"], ["/resumo/<draft>", `/resumo/${draft.id}`], ["/resumo/<sent>", `/resumo/${sent.id}`], ["/resumo/semana/<week>", WEEK_PATH]]) {
      await dev.page.goto(BASE + p, { waitUntil: "load" });
      expect(`dev -> ${name} goes back to /dashboard`, dev.page.url().endsWith("/dashboard"), dev.page.url());
    }
    const devUsage = await dev.context.request.get(`${BASE}${WEEK_USAGE}`);
    expect("dev -> the week's usage picture is a 404", devUsage.status() === 404, String(devUsage.status()));
    await refusedEverywhere(dev.context, "dev", draft, "draft");
    await refusedEverywhere(dev.context, "dev", sent, "sent report");
    expect("dev -> no console errors or failed requests", noise(dev).length === 0, noise(dev).slice(0, 3).join(" | "));

    // ================================================================ SCRUM MASTER: sent reports, to read
    const sm = await L.newSession(browser, "sm");
    await L.login(sm);
    await L.menuButton(sm.page).waitFor();
    const smPage = sm.page;
    const reviewControls = '[data-field], [data-panel="edicao"], [data-panel="conferencia"]';
    const noReviewButtons = async (page) => (await page.getByRole("button", { name: /Copiar|Marcar como enviado/ }).count()) === 0;

    expect("scrum master -> the Resumo tab is there", (await smPage.locator('a[href="/resumo"]').count()) >= 1);
    expect("scrum master -> no Resumo card on the Dashboard (drafts are the admin's)", (await smPage.locator("[data-report-card]").count()) === 0);

    await smPage.goto(BASE + "/resumo", { waitUntil: "load" });
    expect("scrum master -> /resumo opens", new URL(smPage.url()).pathname === "/resumo", smPage.url());
    expect("scrum master -> /resumo: nothing to edit, check, copy or send", (await smPage.locator(reviewControls).count()) === 0 && (await noReviewButtons(smPage)));
    const smEmpty = await smPage.getByText("Nenhum resumo enviado ainda.").count();
    const smFrames = await smPage.locator('iframe[title="Prévia"]').count();
    expect("scrum master -> /resumo shows the last sent e-mail, or says none was sent yet", smEmpty + smFrames === 1, `empty=${smEmpty} frames=${smFrames}`);

    await smPage.goto(BASE + `/resumo/${sent.id}`, { waitUntil: "load" });
    const smFrame = smPage.locator('iframe[title="Prévia"]');
    await smFrame.waitFor();
    const smSrcdoc = (await smFrame.getAttribute("srcdoc")) ?? "";
    const smSandbox = await smFrame.getAttribute("sandbox");
    {
      const at = (needle) => smSrcdoc.indexOf(needle);
      expect(
        "scrum master -> the print added after sending sits under its delivery",
        at("Primeira entrega") >= 0 && at("Primeira entrega") < at("/shot-1.png") && at("/shot-1.png") < at("Segunda entrega"),
        `${at("Primeira entrega")} ${at("/shot-1.png")} ${at("Segunda entrega")}`
      );
    }
    expect("scrum master -> a sent report opens as a preview of the e-mail", smSrcdoc.includes("Resumo enviado"), `srcdoc has ${smSrcdoc.length} chars`);
    expect("scrum master -> the preview frame is sandboxed and runs no scripts", smSandbox !== null && !/allow-scripts/.test(smSandbox), String(smSandbox));
    expect("scrum master -> the preview is titled just 'Prévia'", (await smPage.getByRole("heading", { name: "Prévia", exact: true }).count()) === 1 && (await smPage.getByRole("region", { name: "Prévia", exact: true }).count()) === 1 && (await smPage.getByText("Prévia do e-mail").count()) === 0);
    expect("scrum master -> the seal says it was sent", (await smPage.locator('[data-seal="sent"]').innerText()).startsWith("Enviado em"));
    expect("scrum master -> a sent report has nothing to edit, check, copy or send", (await smPage.locator(reviewControls).count()) === 0 && (await noReviewButtons(smPage)));

    // A draft's address says nothing about the draft: the same plain 404 as an id that never existed.
    const draftVisit = await smPage.goto(BASE + `/resumo/${draft.id}`, { waitUntil: "load" });
    const draftBody = await smPage.locator("body").innerText();
    const draftHtml = await smPage.content();
    const ghostVisit = await smPage.goto(BASE + `/resumo/${crypto.randomUUID()}`, { waitUntil: "load" });
    const ghostBody = await smPage.locator("body").innerText();
    expect("scrum master -> a draft's address is a 404, exactly like an id that does not exist", draftVisit.status() === 404 && ghostVisit.status() === 404 && draftBody === ghostBody, `${draftVisit.status()} / ${ghostVisit.status()}`);
    expect("scrum master -> nothing of the draft is on that page", !draftHtml.includes(MARK) && !draftHtml.includes(draft.share_token));
    await refusedEverywhere(sm.context, "scrum master", draft, "draft");
    await refusedEverywhere(sm.context, "scrum master", sent, "sent report");

    await smPage.setViewportSize({ width: 390, height: 800 });
    await smPage.goto(BASE + `/resumo/${sent.id}`, { waitUntil: "load" });
    await smPage.locator('iframe[title="Prévia"]').waitFor();
    const smWidth = await smPage.evaluate(() => ({ w: window.innerWidth, sw: document.documentElement.scrollWidth }));
    expect("scrum master -> /resumo/<sent> at phone width has no sideways scroll", smWidth.sw <= smWidth.w + 1, `scrollWidth ${smWidth.sw} vs ${smWidth.w}`);
    // ---- the week, to present at the scrum (on a wide screen, like the meeting's)
    {
      await smPage.setViewportSize({ width: 1440, height: 900 });
      const visit = await smPage.goto(BASE + WEEK_PATH, { waitUntil: "load" });
      await smPage.locator("[data-week]").waitFor();
      expect("scrum master -> the week opens", visit.status() === 200, String(visit.status()));
      expect("scrum master -> the week's opening line comes from the counts", (await smPage.locator("[data-week-headline]").innerText()).trim() === WEEK_HEADLINE, await smPage.locator("[data-week-headline]").innerText());
      const once = await Promise.all([9001, 9002, 9003].map((n) => smPage.locator(`[data-entry="${n}"]`).count()));
      expect("scrum master -> each delivery appears once", once.every((c) => c === 1), once.join(","));
      expect("scrum master -> a delivery shows as the latest report of the week left it", (await smPage.locator('[data-entry="9002"]').innerText()).includes("pronta na sexta"));
      expect(
        "scrum master -> a delivery Wednesday showed stays, as Wednesday showed it, though Friday carries it hidden",
        (await smPage.locator('[data-entry="9001"]').innerText()).includes("Primeira entrega") && !(await smPage.locator('[data-entry="9001"]').innerText()).includes("escondida na sexta")
      );
      expect("scrum master -> the print of a delivery sits under it", (await smPage.locator('[data-entry="9001"] [data-print]').count()) === 1);
      const fridaySrc = (await smPage.locator('[data-entry="9003"] [data-print] img').getAttribute("src")) ?? "";
      expect("scrum master -> a print of the Friday report comes by that report's own link", Boolean(fridayToken) && fridaySrc.includes(`/api/progress-report/${fridayToken}/`), fridaySrc);
      const numbers = await smPage.locator("#uso dd").allInnerTexts();
      expect("scrum master -> the week's numbers add up the e-mails' (4 sessions, 320 messages, 2 delivered)", JSON.stringify(numbers) === JSON.stringify(["4", "320", "2"]), JSON.stringify(numbers));
      // Optional pictures of the presentation, for a person to look at (E2E_SCREENSHOTS=<folder>).
      if (process.env.E2E_SCREENSHOTS) {
        fs.mkdirSync(process.env.E2E_SCREENSHOTS, { recursive: true });
        await smPage.screenshot({ path: path.join(process.env.E2E_SCREENSHOTS, "semana-topo.png") });
        await smPage.screenshot({ path: path.join(process.env.E2E_SCREENSHOTS, "semana-inteira.png"), fullPage: true });
      }
      expect("scrum master -> no navigation bar, nothing to check, edit, copy or send", (await smPage.locator(reviewControls).count()) === 0 && (await noReviewButtons(smPage)) && (await smPage.locator("[data-conference-table]").count()) === 0 && (await smPage.getByRole("link", { name: "Config", exact: true }).count()) === 0);
      expect("scrum master -> a 'Tela cheia' button and an index of the sections", (await smPage.getByRole("button", { name: "Tela cheia" }).count()) === 1 && (await smPage.getByRole("navigation", { name: "Seções da semana" }).locator('a[href^="#"]').count()) >= 4);
      await smPage.locator('[data-entry="9001"] [data-print]').click();
      expect("scrum master -> a print opens large over everything", await smPage.locator("[data-zoom]").isVisible());
      expect("scrum master -> the focus goes to its 'Fechar' button", await smPage.evaluate(() => document.activeElement?.textContent === "Fechar"));
      if (process.env.E2E_SCREENSHOTS) await smPage.screenshot({ path: path.join(process.env.E2E_SCREENSHOTS, "semana-print-ampliado.png") });
      await smPage.keyboard.press("Escape");
      await smPage.locator("[data-zoom]").waitFor({ state: "detached" });
      expect("scrum master -> Esc closes it", (await smPage.locator("[data-zoom]").count()) === 0);
      expect("scrum master -> and the focus is back on the print", await smPage.evaluate(() => document.activeElement?.hasAttribute("data-print") ?? false));
      const usage = await sm.context.request.get(`${BASE}${WEEK_USAGE}`);
      const usageBody = Buffer.from(await usage.body());
      expect("scrum master -> the week's usage picture is a PNG, cached only in this browser", usage.status() === 200 && usageBody.subarray(0, 8).equals(PNG_SIGNATURE) && /^private/.test(usage.headers()["cache-control"] ?? ""), `${usage.status()} ${usage.headers()["cache-control"]}`);
      for (const [label, path] of [
        ["a day that is not a Monday", "2099-02-03?produto=ELIMS"],
        ["a malformed date", "semana-x"],
        ["a week with nothing sent", "2099-03-02?produto=ELIMS"],
        ["the same week of another product (GeoCloud, the default)", WEEK],
        ["an unknown product", `${WEEK}?produto=Outro`],
      ]) {
        const r = await smPage.goto(BASE + `/resumo/semana/${path}`, { waitUntil: "load" });
        expect(`scrum master -> ${label} is a 404`, r.status() === 404, String(r.status()));
      }
      await smPage.setViewportSize({ width: 390, height: 800 });
      await smPage.goto(BASE + WEEK_PATH, { waitUntil: "load" });
      await smPage.locator("[data-week]").waitFor();
      const w = await smPage.evaluate(() => ({ w: window.innerWidth, sw: document.documentElement.scrollWidth }));
      expect("scrum master -> the week at phone width has no sideways scroll", w.sw <= w.w + 1, `scrollWidth ${w.sw} vs ${w.w}`);
      await smPage.setViewportSize({ width: 1440, height: 900 });
    }
    expect("scrum master -> no console errors or failed requests", noise(sm, /\/resumo\//).length === 0, noise(sm, /\/resumo\//).slice(0, 3).join(" | "));

    // ================================================================ ADMIN: the whole review
    const adm = await L.newSession(browser, "admin");
    const page = adm.page;
    page.on("dialog", (d) => d.accept());
    await adm.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin }).catch(() => {});
    await L.login(adm);
    await L.menuButton(page).waitFor();

    const field = (key) => page.locator(`[data-field="${key}"]`);
    const saved = (key) => page.locator(`[data-field-box="${key}"][data-save-state="saved"]`);
    const srcdocNow = async () => (await page.locator('iframe[title="Prévia"]').getAttribute("srcdoc")) ?? "";
    const sendButton = page.getByRole("button", { name: "Marcar como enviado", exact: true });
    const conferred = field("checked");

    // ---- the harness really reaches the actions (otherwise every refusal above would pass for nothing)
    {
      const { rev } = await row(draft.id);
      const on = await call(adm.context, A.setProgressChecked, [{ id: draft.id, rev, checked: true }], "/resumo");
      const afterOn = await row(draft.id);
      expect("admin -> a direct setProgressChecked call is accepted and stamps the row", accepted(on) && afterOn.checked_at !== null, `${on.kind} ${on.returned.slice(0, 60)}`);
      const off = await call(adm.context, A.setProgressChecked, [{ id: draft.id, rev: afterOn.rev, checked: false }], "/resumo");
      expect("admin -> and unticks it again", accepted(off) && (await row(draft.id)).checked_at === null, `${off.kind}`);
    }

    // ---- Dashboard card and the tab
    expect("admin -> the Resumo tab is there, next to Config", (await page.locator('a[href="/resumo"]').count()) >= 1 && (await page.getByRole("link", { name: "Config", exact: true }).count()) === 1);
    const card = page.locator("[data-report-card]");
    expect("admin -> the Resumo card is on the Dashboard", (await card.count()) === 1);
    const cardText = await card.innerText();
    expect("admin -> the card is titled 'Resumo' and loaded (no read error)", /^resumo/i.test(cardText.trim()) && !/Não foi possível carregar/.test(cardText), cardText.slice(0, 80).replace(/\n/g, " | "));
    expect("admin -> the card sits right under 'Em paralelo'", await card.evaluate((el) => (el.previousElementSibling?.textContent ?? "").includes("Em paralelo")));
    const open = card.getByRole("link", { name: "Abrir" });
    if ((await open.count()) === 1) expect("admin -> the card's 'Abrir' goes to /resumo", (await open.getAttribute("href")) === "/resumo");

    await page.goto(BASE + "/resumo", { waitUntil: "load" });
    expect("admin -> /resumo opens (the GeoCloud draft, the last sent, or the empty state)", new URL(page.url()).pathname === "/resumo", page.url());

    // ---- the draft: what is on the screen
    await page.goto(BASE + `/resumo/${draft.id}`, { waitUntil: "load" });
    await field("headline").waitFor();
    const frame = page.locator('iframe[title="Prévia"]');
    const sandbox = await frame.getAttribute("sandbox");
    expect("admin -> the preview frame is sandboxed and runs no scripts", sandbox !== null && !/allow-scripts/.test(sandbox), String(sandbox));
    expect("admin -> the preview is the e-mail built from the draft", (await srcdocNow()).includes("Resumo rascunho") && (await srcdocNow()).includes("Primeira entrega"));
    {
      const doc = await srcdocNow();
      const at = (needle) => doc.indexOf(needle);
      expect(
        "admin -> the print of a delivery sits right under it in the preview, with its caption",
        at("Primeira entrega") >= 0 && at("Primeira entrega") < at("/shot-1.png") && at("/shot-1.png") < at("Segunda entrega") && at("Tela da primeira entrega") > at("/shot-1.png"),
        `${at("Primeira entrega")} ${at("/shot-1.png")} ${at("Segunda entrega")}`
      );
    }
    expect("admin -> the preview is titled just 'Prévia'", (await page.getByRole("heading", { name: "Prévia", exact: true }).count()) === 1 && (await page.getByRole("region", { name: "Prévia", exact: true }).count()) === 1 && (await page.getByText("Prévia do e-mail").count()) === 0);
    expect("admin -> the seal says Rascunho", (await page.locator('[data-seal="draft"]').innerText()) === "Rascunho");
    expect("admin -> 'Marcar como enviado' starts disabled", await sendButton.isDisabled());
    const table = await page.locator("[data-conference-table]").innerText();
    expect("admin -> the conference lists each day with its prompts and the picture's numbers", /05\/01/.test(table) && /06\/01/.test(table) && /09:05/.test(table) && /17:00/.test(table) && /TOKENS DE ENTRADA/i.test(table) && /TOKENS DE SAÍDA/i.test(table) && !/SESSÕES/i.test(table), table.replace(/\s+/g, " ").slice(0, 120));
    expect("admin -> the conference shows no coverage warnings", (await page.locator("[data-conference-warnings]").count()) === 0 && !/Avisos de cobertura/.test(table));
    expect("admin -> every difficulty and next step is editable", (await field("difficulty:d9001:text").count()) === 1 && (await field("nextStep:n9001:text").count()) === 1);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(BASE + `/resumo/${draft.id}`, { waitUntil: "load" });
      await field("headline").waitFor();
      await sleep(600);
      const m = await page.evaluate(() => ({ w: window.innerWidth, sw: document.documentElement.scrollWidth }));
      expect(`admin -> /resumo/<draft> at ${width}px has no sideways scroll`, m.sw <= m.w + 1, `scrollWidth ${m.sw} vs ${m.w}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE + `/resumo/${draft.id}`, { waitUntil: "load" });
    await field("headline").waitFor();

    // ---- editing a sentence: saved apart from what the collectors pushed, and it survives a reload
    const EDITED = "A primeira entrega de teste foi revisada pela equipe.";
    const pushedHeadline = (await row(draft.id)).content.headline;
    await field("entry:gc-9001:summary").fill(EDITED);
    await field("entry:gc-9001:summary").press("Tab");
    await saved("entry:gc-9001:summary").waitFor({ timeout: 15000 });
    const afterEdit = await row(draft.id);
    expect("admin -> the edit is stored in overrides, with the pushed text as its base", afterEdit.overrides["entry:gc-9001:summary"]?.value === EDITED && afterEdit.overrides["entry:gc-9001:summary"]?.base === "A primeira entrega de teste ficou pronta.", JSON.stringify(afterEdit.overrides["entry:gc-9001:summary"]));
    expect("admin -> what the collectors pushed (content) is untouched", afterEdit.content.entries[0].summary === "A primeira entrega de teste ficou pronta." && afterEdit.content.headline === pushedHeadline);
    expect("admin -> the preview shows the edited sentence at once", (await until(async () => (await srcdocNow()).includes("revisada pela equipe"), 8000)) === true);
    await page.reload({ waitUntil: "load" });
    await field("headline").waitFor();
    expect("admin -> after a reload the field holds the edit and is marked 'Editado'", (await field("entry:gc-9001:summary").inputValue()) === EDITED && (await page.locator('[data-field-box="entry:gc-9001:summary"]').innerText()).includes("Editado"));

    // ---- plain-language warning
    await field("entry:gc-9002:summary").fill("Corrigimos o endpoint de login.");
    await field("entry:gc-9002:summary").press("Tab");
    await saved("entry:gc-9002:summary").waitFor({ timeout: 15000 });
    const lint = await page.locator('[data-field-box="entry:gc-9002:summary"] [data-lint]').innerText();
    expect("admin -> a sentence with jargon is saved and shows a warning naming the term", /termo técnico/.test(lint) && /endpoint/.test(lint), lint.replace(/\s+/g, " "));
    await field("entry:gc-9002:summary").fill("A segunda entrega de teste está em validação.");
    await field("entry:gc-9002:summary").press("Tab");
    await saved("entry:gc-9002:summary").waitFor({ timeout: 15000 });
    expect("admin -> the warning goes away once the sentence is plain again", (await page.locator('[data-field-box="entry:gc-9002:summary"] [data-lint]').count()) === 0);

    // ---- status and hiding
    await field("entry:gc-9003:status").selectOption("bloqueado");
    await saved("entry:gc-9003:status").waitFor({ timeout: 15000 });
    expect("admin -> a corrected status is stored and reaches the preview", (await row(draft.id)).overrides["entry:gc-9003:status"]?.value === "bloqueado" && (await until(async () => /Bloqueado: 1/.test(await srcdocNow()), 8000)) === true);
    await field("entry:gc-9003:hidden").check();
    await saved("entry:gc-9003:hidden").waitFor({ timeout: 15000 });
    expect("admin -> a hidden entry is stored and leaves the e-mail", (await row(draft.id)).overrides["entry:gc-9003:hidden"]?.value === true && (await until(async () => !(await srcdocNow()).includes("Terceira entrega"), 8000)) === true);

    // ---- the numbers must be conferred before sending
    await conferred.check();
    expect("admin -> after 'Conferi os números' the send button is enabled", (await until(async () => !(await sendButton.isDisabled()), 10000)) === true);
    const checkedRow = await row(draft.id);
    expect("admin -> the database stamped the check (when and by whom)", checkedRow.checked_at !== null && checkedRow.checked_by !== null);

    // ---- copy
    await page.bringToFront();
    await page.getByRole("button", { name: "Copiar para o e-mail", exact: true }).click();
    const notice = page.locator("[data-notice]");
    expect("admin -> 'Copiar para o e-mail' confirms and says where to paste it", (await until(async () => /Copiado\. Cole numa mensagem nova do Outlook\./.test(await notice.innerText()), 10000)) === true, await notice.innerText());
    const clip = await page.evaluate(async () => {
      try {
        const out = {};
        for (const item of await navigator.clipboard.read()) for (const type of item.types) out[type] = await (await item.getType(type)).text();
        return out;
      } catch (e) {
        return { unreadable: String(e) };
      }
    });
    if (clip.unreadable) {
      console.log(`  (clipboard contents not checked here: ${clip.unreadable.slice(0, 90)})`);
    } else {
      const html = clip["text/html"] ?? "";
      expect("copy: the clipboard carries the e-mail as HTML and as plain text", html.length > 0 && (clip["text/plain"] ?? "").length > 0);
      expect("copy: it is the edited text, with the production image address and never localhost", html.includes("revisada pela equipe") && /https:\/\/roads-psi\.vercel\.app\/api\/progress-report\//.test(html) && !/localhost/.test(html));
      expect("copy: the hidden entry is not in it, and there is no script", !html.includes("Terceira entrega") && !/<script/i.test(html));
    }
    await page.getByRole("button", { name: "Copiar assunto", exact: true }).click();
    expect("admin -> 'Copiar assunto' confirms", (await until(async () => /Assunto copiado\./.test(await notice.innerText()), 8000)) === true, await notice.innerText());

    // ---- a new push of the draft (simulated like the ingest route does): edits stay, the check is voided
    {
      const current = await row(draft.id);
      const next = JSON.parse(JSON.stringify(current.content));
      next.entries[0].summary = "A primeira entrega de teste ganhou um texto novo do Claude.";
      // The database stamps the push time itself when the content changes (migration 0025), like the route's push.
      const { error } = await svc.from("progress_reports").update({ content: next, rev: current.rev + 1 }).eq("id", draft.id);
      expect("(setup) the draft was pushed again", !error, error ? error.message : "");
    }
    await page.reload({ waitUntil: "load" });
    await field("headline").waitFor();
    expect("re-push -> the user's edit is still what the field shows", (await field("entry:gc-9001:summary").inputValue()) === EDITED);
    const suggestion = page.locator('[data-field-box="entry:gc-9001:summary"] [data-suggestion]');
    expect("re-push -> the new text is offered next to it as a 'nova sugestão'", (await suggestion.count()) === 1 && (await suggestion.innerText()).includes("ganhou um texto novo"));
    expect("re-push -> the hidden entry and the corrected status are still in place", (await field("entry:gc-9003:hidden").isChecked()) && (await field("entry:gc-9003:status").inputValue()) === "bloqueado");
    expect("re-push -> the conference is voided and sending is blocked again", !(await conferred.isChecked()) && (await sendButton.isDisabled()));
    await suggestion.getByRole("button", { name: "Usar a sugestão" }).click();
    await saved("entry:gc-9001:summary").waitFor({ timeout: 15000 });
    expect("re-push -> 'Usar a sugestão' stores the new text and clears the notice", (await row(draft.id)).overrides["entry:gc-9001:summary"]?.value === "A primeira entrega de teste ganhou um texto novo do Claude." && (await suggestion.count()) === 0);

    // ---- confer again and send
    await conferred.check();
    expect("admin -> conferring again enables the send button", (await until(async () => !(await sendButton.isDisabled()), 10000)) === true);
    await sendButton.click();
    await page.locator('[data-seal="sent"]').waitFor({ timeout: 15000 }).catch(async (e) => {
      // Say what the screen said, so a red run names the refusal instead of only a timeout.
      const said = await page.locator('[role="status"], [role="alert"]').allInnerTexts().catch(() => []);
      const now = await row(draft.id).catch(() => null);
      const stamps = now ? ` | checked_at ${now.checked_at} pushed_at ${now.pushed_at} rev ${now.rev}` : "";
      throw new Error(`${String(e.message).split(String.fromCharCode(10))[0]} | screen: ${said.join(" / ").slice(0, 200)}${stamps}`);
    });
    const sentRow = await until(async () => {
      const r = await row(draft.id);
      return r.status === "sent" ? r : null;
    }, 10000);
    expect("admin -> 'Marcar como enviado' sends it: status, time and who are stored", sentRow && sentRow.sent_at !== null && sentRow.sent_by !== null, JSON.stringify(sentRow && sentRow.status));
    expect("admin -> the seal reads 'Enviado em' and the send button is gone", (await page.locator('[data-seal="sent"]').innerText()).startsWith("Enviado em") && (await sendButton.count()) === 0);
    expect("admin -> a sent report is read-only on the screen", !(await field("entry:gc-9001:summary").isEditable()) && (await conferred.isDisabled()));

    // ---- a sent report is frozen, whoever asks and however
    {
      const before = await snap(draft.id);
      const { rev } = await row(draft.id);
      const tries = [
        ["saveProgressEdit", { id: draft.id, rev, key: "headline", value: `${MARK} depois de enviado` }],
        ["setProgressChecked", { id: draft.id, rev, checked: false }],
        ["markProgressReportSent", { id: draft.id, rev }],
      ];
      for (const [name, args] of tries) {
        const r = await call(adm.context, A[name], [args], "/resumo");
        expect(`admin -> ${name} on a sent report is refused`, !accepted(r), `${r.kind} ${r.returned.slice(0, 70)}`);
      }
      expect("admin -> and the sent report did not change at all", (await snap(draft.id)) === before);
    }

    // ---- the report that was sent before
    await page.goto(BASE + `/resumo/${sent.id}`, { waitUntil: "load" });
    await page.locator('iframe[title="Prévia"]').waitFor();
    expect("admin -> a sent report's preview is titled just 'Prévia' too", (await page.getByRole("heading", { name: "Prévia", exact: true }).count()) === 1 && (await page.getByRole("region", { name: "Prévia", exact: true }).count()) === 1);
    expect("admin -> an older sent report opens read-only, with its seal", (await page.locator('[data-seal="sent"]').count()) === 1 && !(await field("entry:gc-9001:summary").isEditable()) && (await sendButton.count()) === 0);

    // ---- the Enviados list in weeks (the real GeoCloud list, only read) and the week's presentation
    {
      await page.goto(BASE + "/resumo", { waitUntil: "load" });
      const groups = await page.locator("[data-week-group]").evaluateAll((els) =>
        els.map((g) => {
          const lis = [...g.querySelectorAll("ul > li")];
          return { items: lis.filter((li) => !li.querySelector("[data-present-week]")).length, at: lis.findIndex((li) => li.querySelector("[data-present-week]")), links: g.querySelectorAll("[data-present-week]").length };
        })
      );
      expect(
        "admin -> each week of Enviados has one 'Apresentar a semana', centred between its reports",
        groups.length > 0 && groups.every((g) => g.links === 1 && g.at === Math.ceil(g.items / 2)),
        JSON.stringify(groups.slice(0, 4))
      );
      const visit = await page.goto(BASE + WEEK_PATH, { waitUntil: "load" });
      await page.locator("[data-week]").waitFor();
      expect("admin -> the week opens for the admin too, with nothing to edit", visit.status() === 200 && (await page.locator(reviewControls).count()) === 0, String(visit.status()));
    }
    expect("admin -> no console errors, hydration errors or failed requests during the whole run", noise(adm).length === 0, noise(adm).slice(0, 3).join(" | "));
  } catch (e) {
    expect("run completed without an exception", false, L.scrub(e && e.message ? e.message : e).slice(0, 300));
  } finally {
    await browser.close();
    try {
      await sweep();
      await svc.storage.from("progress-shots").remove([E2E_SHOT_PATH]);
    } catch (e) {
      console.log(`cleanup of the synthetic reports failed: ${L.scrub(e && e.message ? e.message : e).slice(0, 120)}`);
    }
  }
  process.exit(L.summary("PROGRESS REPORT (Resumo para a diretoria)") ? 1 : 0);
})();
