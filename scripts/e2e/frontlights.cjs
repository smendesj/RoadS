// The doors under /api/frontlights, called straight over HTTP against the local production server, with and
// without the shared secret. It checks what a consumer relies on: the version of the contract in every JSON
// body (errors too), the secret, the refusals, the shape of the reads, and the log of calls (what is written
// down, what is not, and the daily sweep that drops the old ones).
//
// What it must never do, because the database is the real one: no valid ack (that would close every real
// change Frontlights has not written yet), no push of a draft and no print. The writes it tries at the doors are
// the ones refused before anything is read, and it runs before any suite that creates data, so the sync-board call
// (which needs the server started with an empty GITHUB_TOKEN, as in the README) has nothing of ours to push.
// Its calls say they are e2e in their User-Agent, so the rows they leave in the log are told apart and removed.
//
// After the sync-board call, one block makes data of its own: the scrum master moves a "[TESTE]" item through two
// throwaway future weeks with the app's move action, to see an emptied week stay in roadmap-state until the change
// that names it is acked. It stands in for that ack by marking acked only its own item's queue rows, never through
// the ack door, and the cleanup removes the item, the weeks and those rows.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const L = require("./lib.cjs");
const { BASE, expect, sleep, svc } = L;

const DOORS = `${BASE}/api/frontlights`;
const SECRET = process.env.FRONTLIGHTS_API_SECRET;
const UA = `${L.E2E_UA}/frontlights`;
const MISSING_REPORT = crypto.randomUUID();

// What the log must hold once the suite is done: one entry per call that got through the secret.
const expectedLog = [];

async function call(method, route, { secret = SECRET, body } = {}) {
  const headers = { "user-agent": UA, ...(secret ? { authorization: `Bearer ${secret}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) };
  const res = await fetch(`${DOORS}${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = await res.json().catch(() => null);
  if (secret === SECRET && SECRET) {
    const pattern = route.split("?")[0].replace(MISSING_REPORT, "[id]");
    expectedLog.push(`${method} ${pattern} ${res.status}`);
  }
  return { status: res.status, json };
}

// The log is written after the answer is sent, so give it a moment.
async function loggedCalls(wanted) {
  let rows = [];
  for (let attempt = 0; attempt < 25; attempt++) {
    rows = (await svc.from("frontlights_calls").select("method, route, status, user_agent, duration_ms").eq("user_agent", UA)).data ?? [];
    if (rows.length >= wanted) break;
    await sleep(200);
  }
  return rows;
}

// A server action's id, by its name, from the production build (as actions.cjs finds them), and a call to it with a
// signed-in context's cookies. "ok" is a 200 with no error in the answer.
function actionId(name) {
  const dir = path.join(__dirname, "..", "..", ".next", "static", "chunks");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    for (const m of fs.readFileSync(path.join(dir, f), "utf8").matchAll(/createServerReference\)\("([0-9a-f]{40,})",[^)]*?,"(\w+)"\)/g)) if (m[2] === name) return m[1];
  }
  throw new Error(`server action ${name} not found in the build`);
}
async function callAction(context, id, args) {
  const res = await context.request.post(`${BASE}/roadmap`, {
    headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: BASE },
    data: JSON.stringify(args),
    maxRedirects: 0,
  });
  const text = await res.text();
  return res.status() === 200 && !/(^|\n)\d+:E\{/.test(text) ? "ok" : `failed ${res.status()}`;
}

(async () => {
  const t0 = new Date().toISOString();
  let browser = null;
  let fixtures = false;
  try {
    await L.cleanupCalls(); // leftovers of a run that died halfway
    expect("the shared secret is in .env.local", Boolean(SECRET));

    // ---- every door refuses a call without the secret, or with a wrong one, and says the version
    const doors = [
      ["GET", "/roadmap-state"],
      ["GET", "/pending-changes"],
      ["POST", "/ack"],
      ["POST", "/sync-board"],
      ["GET", "/progress-report"],
      ["POST", "/progress-report"],
      ["POST", "/progress-report/shots"],
      ["POST", `/progress-report/${MISSING_REPORT}/shots`],
    ];
    for (const [method, route] of doors) {
      const none = await call(method, route, { secret: null, ...(method === "POST" ? { body: {} } : {}) });
      const wrong = await call(method, route, { secret: "segredo-errado", ...(method === "POST" ? { body: {} } : {}) });
      const ok = (r) => r.status === 401 && r.json?.schemaVersion === 1 && r.json?.error === "unauthorized";
      expect(`${method} ${route.replace(MISSING_REPORT, "<id>")}: no secret and a wrong one are a 401 that says the version`, ok(none) && ok(wrong), `${none.status}/${wrong.status}`);
    }

    // ---- the reads, with the secret
    const state = await call("GET", "/roadmap-state");
    expect(
      "roadmap-state: 200, version 1, sprints, groups and the clock of the call",
      state.status === 200 && state.json?.schemaVersion === 1 && Array.isArray(state.json?.sprints) && Array.isArray(state.json?.groups) && !Number.isNaN(Date.parse(state.json?.asOf)),
      `${state.status}`
    );

    // The sprints are weeks by date: sprintId sprint-DD-MM-AAAA from the Monday, titled by the dates, in date order,
    // and never the e2e fixture (zz-test-*).
    const sprints = state.json?.sprints ?? [];
    const dateId = (iso) => `sprint-${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
    expect(
      "roadmap-state: every sprintId is sprint-DD-MM-AAAA, taken from the week's start date",
      sprints.length > 0 && sprints.every((sp) => /^sprint-\d{2}-\d{2}-\d{4}$/.test(sp.sprintId) && sp.sprintId === dateId(sp.startDate)),
      JSON.stringify(sprints.map((sp) => [sp.sprintId, sp.startDate]))
    );
    expect(
      "roadmap-state: the weeks come in the order of their start date",
      sprints.every((sp, i) => i === 0 || sprints[i - 1].startDate < sp.startDate),
      JSON.stringify(sprints.map((sp) => sp.startDate))
    );
    expect(
      "roadmap-state: a sprint is titled by its dates only, never by its position",
      sprints.every((sp) => /^Sprint \d{2}(\/\d{2})?–\d{2}\/\d{2}$/.test(sp.title)),
      JSON.stringify(sprints.map((sp) => sp.title))
    );
    expect(
      "roadmap-state: the e2e fixture lanes never reach Frontlights",
      ![...sprints, ...(state.json?.groups ?? [])].some((l) => String(l.laneId).startsWith("zz-test-")) &&
        !(state.json?.removedPending ?? []).some((r) => String(r.laneId ?? "").startsWith("zz-test-"))
    );
    // Holds only after migration 0031 is pushed: before it the lanes are still atual/proxima/terceira.
    expect(
      "roadmap-state (after 0031): laneId is the same sprint-DD-MM-AAAA as sprintId",
      sprints.length > 0 && sprints.every((sp) => sp.laneId === sp.sprintId),
      JSON.stringify(sprints.map((sp) => [sp.laneId, sp.sprintId]))
    );

    const pending = await call("GET", "/pending-changes");
    expect(
      "pending-changes: 200, version 1, a list of changes and an asOf that is null or a timestamp",
      pending.status === 200 && pending.json?.schemaVersion === 1 && Array.isArray(pending.json?.changes) && (pending.json?.asOf === null || !Number.isNaN(Date.parse(pending.json?.asOf))),
      `${pending.status}`
    );
    const badSince = await call("GET", "/pending-changes?since=ontem");
    expect("pending-changes: a since that is not an ISO timestamp is a 400 that says the version", badSince.status === 400 && badSince.json?.schemaVersion === 1 && /since/.test(badSince.json?.error ?? ""), `${badSince.status}`);

    const report = await call("GET", "/progress-report");
    expect(
      "progress-report GET: 200, version 1, the window to collect and the draft and last sent (each a brief or null)",
      report.status === 200 &&
        report.json?.schemaVersion === 1 &&
        typeof report.json?.window?.start === "string" &&
        typeof report.json?.window?.end === "string" &&
        "draft" in report.json &&
        "lastSent" in report.json,
      `${report.status}`
    );
    const meeting = report.json?.weekMeeting;
    expect(
      "progress-report GET: weekMeeting is a Monday (YYYY-MM-DD) after the end of the window it describes",
      typeof meeting === "string" && /^\d{4}-\d{2}-\d{2}$/.test(meeting) && new Date(`${meeting}T00:00:00Z`).getUTCDay() === 1 && Date.parse(`${meeting}T00:00:00-03:00`) >= Date.parse(report.json?.window?.end),
      String(meeting)
    );

    // ---- the writes, only the ones refused before anything is read or written
    const ackNoDate = await call("POST", "/ack", { body: {} });
    expect("ack: no asOf is a 400 that says the version, and consumes nothing", ackNoDate.status === 400 && ackNoDate.json?.schemaVersion === 1 && /asOf/.test(ackNoDate.json?.error ?? ""), `${ackNoDate.status}`);
    const ackBadDate = await call("POST", "/ack", { body: { asOf: "ontem" } });
    expect("ack: an asOf that is not an ISO timestamp is a 400", ackBadDate.status === 400, `${ackBadDate.status}`);
    const ackOtherVersion = await call("POST", "/ack", { body: { schemaVersion: 2, asOf: "2099-01-01T00:00:00Z" } });
    expect(
      "ack: another version of the contract is refused (and the far-future asOf closes nothing)",
      ackOtherVersion.status === 400 && ackOtherVersion.json?.error === "unsupported_schema_version" && ackOtherVersion.json?.supported === 1 && ackOtherVersion.json?.schemaVersion === 1,
      `${ackOtherVersion.status} ${JSON.stringify(ackOtherVersion.json)}`
    );

    const pushOtherVersion = await call("POST", "/progress-report", { body: { schemaVersion: 2, produto: "GeoCloud", content: {} } });
    expect("progress-report POST: another version of the contract is refused", pushOtherVersion.status === 400 && pushOtherVersion.json?.error === "unsupported_schema_version", `${pushOtherVersion.status}`);
    const pushEmpty = await call("POST", "/progress-report", { body: { produto: "GeoCloud" } });
    expect("progress-report POST: a draft with no content is a 400 that says the version", pushEmpty.status === 400 && pushEmpty.json?.schemaVersion === 1 && typeof pushEmpty.json?.error === "string", `${pushEmpty.status}`);

    // A print to a report that does not exist: whatever the door answers, it is answered with the version and
    // written down under the PATTERN of the address, never the id that was called.
    const attachMissing = await call("POST", `/progress-report/${MISSING_REPORT}/shots`, { body: { shots: [] } });
    expect("attach: a report that does not exist is refused, with the version", attachMissing.status >= 400 && attachMissing.status < 500 && attachMissing.json?.schemaVersion === 1, `${attachMissing.status}`);

    // ---- the sync, which only fails closed when the server was started with an empty GITHUB_TOKEN
    const sync = await call("POST", "/sync-board");
    const failedClosed = sync.json?.ok === false && sync.json?.reason === "not_configured";
    const coolingDown = sync.json?.ok === true && sync.json?.ran === false;
    expect(
      "sync-board: version 1 and a summary; with an empty GITHUB_TOKEN it fails closed (or answers from a sync of the last 30 s)",
      sync.status === 200 && sync.json?.schemaVersion === 1 && (failedClosed || coolingDown),
      `${sync.status} ${sync.json?.ok} ${sync.json?.reason ?? ""} ran=${sync.json?.ran}`
    );

    // ---- a future week its last item left stays in roadmap-state, empty, until the change that names it is acked
    // Two weeks the database doesn't have: the empty one at the end of the Roadmap's row (`from`) and the one after it
    // (`to`). The scrum master moves their own test item into `from` (the lane is created), then on to `to`: `from`
    // empties and its lane is deleted, while the move_lane that names it as from_lane_id is still unacked.
    await L.ensureFixtures();
    fixtures = true;
    const W = await L.weeks();
    const from = L.weekId(W.trailing);
    const to = L.weekId(L.addDays(W.trailing, 7));
    const endWeek = L.weekId(L.addDays(W.trailing, 14));
    L.createdWeeks.add(from);
    L.createdWeeks.add(to);
    const laneExists = async (id) => ((await svc.from("lanes").select("id").eq("id", id)).data ?? []).length === 1;
    expect("weeks: the two test weeks are not in the database before the run", !(await laneExists(from)) && !(await laneExists(to)), `${from} ${to}`);

    browser = await L.launch();
    const sm = await L.newSession(browser, "sm");
    await L.login(sm);
    const move = actionId("moveRoadmapItemLane");
    const into = await callAction(sm.context, move, [L.ids.smItem, from]);
    expect("move into an empty future week: its lane is created", into === "ok" && (await laneExists(from)), `${into} ${from}`);
    const away = await callAction(sm.context, move, [L.ids.smItem, to]);
    const { data: moved } = await svc.from("roadmap_items").select("lane_id").eq("id", L.ids.smItem).single();
    expect("move the week's only item on to the next week: the emptied lane is deleted", away === "ok" && moved?.lane_id === to && !(await laneExists(from)) && (await laneExists(to)), `${away} ${moved?.lane_id}`);

    const emptied = await call("GET", "/roadmap-state");
    const weeksNow = emptied.json?.sprints ?? [];
    const emptiedWeek = weeksNow.find((sp) => sp.sprintId === from);
    const end = L.addDays(W.trailing, 4);
    const title = `Sprint ${W.trailing.slice(5, 7) === end.slice(5, 7) ? W.trailing.slice(8, 10) : `${W.trailing.slice(8, 10)}/${W.trailing.slice(5, 7)}`}–${end.slice(8, 10)}/${end.slice(5, 7)}`;
    expect(
      "roadmap-state: the deleted week is still there, empty, its laneId and sprintId the id, its dates and title from it",
      emptied.status === 200 && emptiedWeek?.laneId === from && Array.isArray(emptiedWeek?.items) && emptiedWeek.items.length === 0 && emptiedWeek.startDate === W.trailing && emptiedWeek.endDate === end && emptiedWeek.title === title,
      JSON.stringify(emptiedWeek ?? null)
    );
    expect(
      "roadmap-state: the item is in the week it was moved to",
      weeksNow.some((sp) => sp.sprintId === to && sp.laneId === to && sp.items.some((it) => it.id === L.ids.smItem)),
      JSON.stringify(weeksNow.map((sp) => [sp.sprintId, sp.items.length]))
    );
    expect(
      "roadmap-state: the empty week at the end of the Roadmap's row never comes, and the weeks stay in date order",
      !weeksNow.some((sp) => sp.sprintId === endWeek) && weeksNow.every((sp, i) => i === 0 || weeksNow[i - 1].startDate < sp.startDate),
      JSON.stringify(weeksNow.map((sp) => sp.sprintId))
    );

    // The ack, stood in for: only this item's own queue rows are marked acked, never through the ack door.
    const { data: acked } = await svc.from("roadmap_sync_queue").update({ acked_at: new Date().toISOString() }).eq("item_id", L.ids.smItem).is("acked_at", null).gte("created_at", t0).select("id");
    const afterAck = await call("GET", "/roadmap-state");
    const weeksAfter = afterAck.json?.sprints ?? [];
    expect(
      "roadmap-state: once the change naming it is acked, the deleted week is gone and the other stays",
      (acked ?? []).length === 2 && afterAck.status === 200 && !weeksAfter.some((sp) => sp.sprintId === from) && weeksAfter.some((sp) => sp.sprintId === to),
      `${(acked ?? []).length} acked; ${JSON.stringify(weeksAfter.map((sp) => sp.sprintId))}`
    );

    // ---- the log of calls: every call that got through the secret, and only those
    const rows = await loggedCalls(expectedLog.length);
    const kept = rows.map((r) => `${r.method} ${r.route} ${r.status}`).sort();
    const wanted = [...expectedLog].sort();
    expect(
      "the log holds every call that got through the secret (and not the 401s), by method, route pattern and status",
      kept.length === wanted.length && kept.every((entry, i) => entry === wanted[i]),
      `${kept.length} kept / ${wanted.length} expected`
    );
    expect("the log says who the caller said it was, and how long each call took", rows.length > 0 && rows.every((r) => r.user_agent === UA && Number.isInteger(r.duration_ms) && r.duration_ms >= 0));
    expect("the log keeps the pattern of an address with an id, never the id", rows.some((r) => r.route === "/progress-report/[id]/shots") && !JSON.stringify(rows).includes(MISSING_REPORT));
    expect("the log keeps no query string", !JSON.stringify(rows).includes("since") && !JSON.stringify(rows).includes("ontem"));

    // ---- the daily run sweeps what is older than 90 days and keeps the rest
    const day = 24 * 60 * 60 * 1000;
    const old = await svc.from("frontlights_calls").insert({ method: "GET", route: "/zz-old", status: 200, user_agent: `${L.E2E_UA}/old`, duration_ms: 1, created_at: new Date(Date.now() - 200 * day).toISOString() });
    const recent = await svc.from("frontlights_calls").insert({ method: "GET", route: "/zz-recent", status: 200, user_agent: `${L.E2E_UA}/recent`, duration_ms: 1, created_at: new Date(Date.now() - 10 * day).toISOString() });
    expect("the sweep's two fixtures are in the log", !old.error && !recent.error, old.error?.message ?? recent.error?.message ?? "");
    const cron = await fetch(`${BASE}/api/cron/sync-board`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect("the daily run answers (with an empty GITHUB_TOKEN the sync itself reports it is not configured)", cron.status === 200, `${cron.status}`);
    const left = (await svc.from("frontlights_calls").select("route").in("user_agent", [`${L.E2E_UA}/old`, `${L.E2E_UA}/recent`])).data ?? [];
    expect("the sweep drops the call older than 90 days and keeps the one of ten days ago", left.length === 1 && left[0].route === "/zz-recent", JSON.stringify(left));
  } catch (e) {
    expect("run completed without an exception", false, L.scrub(e && e.message ? e.message : e).slice(0, 300));
  } finally {
    if (browser) await browser.close().catch(() => {});
    // The test item, the fixture lanes, the two test weeks (deleted only if empty) and this run's queue rows.
    if (fixtures) await L.cleanup(t0);
    else await L.cleanupCalls();
  }
  process.exit(L.summary("FRONTLIGHTS DOORS") ? 1 : 0);
})();
