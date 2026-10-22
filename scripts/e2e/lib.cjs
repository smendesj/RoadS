// Shared harness for the role-by-role UI tests. They drive a real headless Chrome as the three test
// accounts (.env.test-account) against a server started like this, so that writes can never reach
// GitHub and the server's clock zone is the one Vercel uses:
//
//   npm run build && GITHUB_TOKEN= TZ=UTC npm start        (then, in another terminal)  npm run e2e
//
// They create throwaway "[TESTE]" items and "zz-test-*" lanes in the live database and remove them in
// `finally`, along with the sync-queue rows they produce. Credentials are read from the git-ignored
// file and scrubbed from any error text.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..", "..");
process.loadEnvFile(path.join(ROOT, ".env.local"));
const BASE = process.env.E2E_BASE || "http://localhost:3000";

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("Chrome not found: set CHROME_PATH to its executable.");
  return found;
}
const CHROME = chromePath();

let credText;
try {
  credText = fs.readFileSync(path.join(ROOT, ".env.test-account"), "utf8");
} catch {
  throw new Error("Missing .env.test-account (the RoadS Tester credentials). See the README, section Testes.");
}
const cred = (k) => credText.match(new RegExp(`^${k}=(.*)$`, "m"))[1].trim();
const PREFIX = { admin: "ROADS_TEST", sm: "ROADS_TEST_SM", dev: "ROADS_TEST_DEV" };
const LABEL = { admin: "Admin", sm: "Scrum Master", dev: "Dev" };

const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- reporting
const results = [];
function expect(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? "  [" + detail + "]" : ""}`);
}
function summary(title) {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${title}: ${results.length - failed.length}/${results.length} passed${failed.length ? " | FAILED: " + failed.map((f) => f.name).join("; ") : ""}`);
  return failed.length;
}

// ---------------------------------------------------------------- browser
async function launch() {
  return chromium.launch({ executablePath: CHROME, headless: true });
}
// One isolated context (own cookies/storage) per role, with problem collection on every page.
// `extra` goes to the context as is: { hasTouch: true, isMobile: true } is a phone (pointer: coarse, touch events).
async function newSession(browser, role, viewport = { width: 1440, height: 900 }, extra = {}) {
  const context = await browser.newContext({ viewport, locale: "pt-BR", ...extra });
  const page = await context.newPage();
  const problems = [];
  const watch = (p) => {
    p.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`console ${m.type()}: ${m.text().slice(0, 180)}`); });
    p.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 180)}`));
    p.on("response", (r) => { if (r.status() >= 400 && !/favicon|_next\/image/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "").slice(0, 90)}`); });
  };
  watch(page);
  context.on("page", watch);
  return { role, context, page, problems };
}

async function login(session, { expectOk = true, password } = {}) {
  const { page, role } = session;
  await page.goto(BASE + "/login", { waitUntil: "load" });
  await page.locator('input[type="email"]').fill(cred(`${PREFIX[role]}_EMAIL`));
  await page.locator('input[type="password"]').fill(password ?? cred(`${PREFIX[role]}_PASSWORD`));
  await page.locator('button[type="submit"]').click();
  if (expectOk) await page.waitForURL(/\/(dashboard|redefinir-senha)/, { timeout: 45000 });
  else await sleep(2500);
}

const menuButton = (page) => page.locator('button[aria-label="User menu"]');
// A Roadmap card's own button (Edit, Delete, + Comment, Save, Cancel). Since #34 the card shows no Comments, so no
// Comment's button can share these names.
const cardButton = (scope, name) => scope.getByRole("button", { name, exact: true });
const scrub = (text) => {
  let out = String(text);
  for (const r of Object.keys(PREFIX)) out = out.split(cred(`${PREFIX[r]}_PASSWORD`)).join("<hidden>");
  return out;
};

// ---------------------------------------------------------------- fixtures (service role)
const ids = {};
async function ensureFixtures() {
  await svc.from("lanes").delete().like("id", "zz-test-%");
  await svc.from("lanes").insert([
    { id: "zz-test-sprint", title: "[TESTE] sprint (apagar)", kind: "sprint", start_date: "2026-12-07", end_date: "2026-12-11", sort_order: 98 },
    { id: "zz-test-a", title: "[TESTE] lane A (apagar)", kind: "group", sort_order: 990 },
    { id: "zz-test-b", title: "[TESTE] lane B (apagar)", kind: "group", sort_order: 991 },
  ]);
  const { data: users } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const find = (email) => users.users.find((u) => u.email === email)?.id;
  ids.admin = find(cred("ROADS_TEST_EMAIL"));
  ids.sm = find(cred("ROADS_TEST_SM_EMAIL"));
  ids.dev = find(cred("ROADS_TEST_DEV_EMAIL"));
  const item = async (title, created_by) =>
    (await svc.from("roadmap_items").insert({ lane_id: "zz-test-sprint", title, description: "descrição de teste", created_by }).select("id").single()).data.id;
  ids.seeded = await item("[TESTE] item semeado (sem dono)", null);
  ids.adminItem = await item("[TESTE] item do admin", ids.admin);
  ids.smItem = await item("[TESTE] item do scrum master", ids.sm);
  return ids;
}

// The weeks as the server tells them (src/lib/sprint-week.ts), counted here on their own: today in São Paulo, the
// current week's Monday (the next one on a weekend), a week's id by its Monday, and the week after the last real one
// in the database (the empty one at the end of the Roadmap's row). A week lane a suite makes the app create is
// recorded in `createdWeeks`, and the cleanup deletes it if it is still empty (never with an item in it).
const createdWeeks = new Set();
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekId = (monday) => `sprint-${monday.slice(8, 10)}-${monday.slice(5, 7)}-${monday.slice(0, 4)}`;
async function weeks() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = weekday === 6 ? addDays(today, 2) : weekday === 0 ? addDays(today, 1) : addDays(today, 1 - weekday);
  const { data } = await svc.from("lanes").select("id, start_date, end_date").eq("kind", "sprint");
  const real = (data ?? []).filter((l) => l.start_date && l.end_date && !l.id.startsWith("zz-test-"));
  const holds = (day) => real.some((l) => l.start_date <= day && day <= l.end_date);
  const last = real.map((l) => l.start_date).filter((d) => d >= monday).sort().pop() ?? monday;
  return { today, monday, real, holds, trailing: addDays(last, 7) };
}

// A native HTML5 drop only lands on screen: grow the window to the whole page, so source and target are both
// visible however long the Roadmap gets (its blocks grow with the real board).
async function fitWholePage(page, width = 1440) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height: Math.max(900, height + 200) });
  await sleep(600);
}

// The Frontlights doors write down every call that got through the secret; the suites that call them say
// they are e2e in their User-Agent, so their rows are told apart from the real ones and removed.
const E2E_UA = "roads-e2e";
async function cleanupCalls() {
  await svc.from("frontlights_calls").delete().like("user_agent", `${E2E_UA}%`);
}

// The ids of the items a run may have created: in a test lane, titled "[TESTE]" or owned by a test account.
async function testItemIds() {
  const inLanes = (await svc.from("roadmap_items").select("id").like("lane_id", "zz-test-%")).data ?? [];
  const titled = (await svc.from("roadmap_items").select("id").like("title", "[TESTE]%")).data ?? [];
  const byOwner = (await svc.from("roadmap_items").select("id").in("created_by", [ids.admin, ids.sm].filter(Boolean))).data ?? [];
  return new Set([...inLanes, ...titled, ...byOwner].map((r) => r.id));
}

// Test data never reaches GitHub (src/lib/test-data.ts): checked at the end of every suite that creates items, before
// the cleanup removes them. No "[TESTE]" item has an issue (a save that creates one links it on the item), and since
// `since` the queue has no "issue linked" modify for a test item (what the board sync queues when it creates one).
// The suites also seed "[TESTE]" items linked on purpose to made-up issues, numbered from SYNTHETIC_ISSUE_MIN up, far
// above any real issue; those don't count. A "[TESTE]" item linked to any other issue (a real number) fails the check.
const TEST_TITLE = /^\s*\[TESTE\]/;
const SYNTHETIC_ISSUE_MIN = 990000;
const ISSUE_NUMBER = /\/issues\/(\d+)/;
async function expectNoTestIssues(since) {
  try {
    const { data: withUrl, error } = await svc
      .from("roadmap_items")
      .select("id, github_issue_url, github_issue_number")
      .like("title", "[TESTE]%")
      .not("github_issue_url", "is", null);
    if (error) throw error;
    const linked = withUrl.filter((r) => !(Number(r.github_issue_number ?? r.github_issue_url.match(ISSUE_NUMBER)?.[1]) >= SYNTHETIC_ISSUE_MIN));
    expect("test data: no [TESTE] item has a GitHub issue", linked.length === 0, linked.map((r) => r.id).join(","));
    const testIds = await testItemIds();
    const { data: rows, error: qError } = await svc.from("roadmap_sync_queue").select("id, item_id, payload").eq("action", "modify").gte("created_at", since);
    if (qError) throw qError;
    const issueLinked = (rows ?? []).filter(
      (r) => r.payload?.reason === "issue linked" && ((r.item_id && testIds.has(r.item_id)) || TEST_TITLE.test(r.payload?.title ?? ""))
    );
    expect("test data: the queue has no \"issue linked\" modify for a [TESTE] item", issueLinked.length === 0, issueLinked.map((r) => r.id).join(","));
  } catch (e) {
    expect("test data: checked that no [TESTE] item got a GitHub issue", false, scrub(e && e.message ? e.message : e).slice(0, 300));
  }
}

// Removes everything a run can create and puts the test accounts back as they were.
async function cleanup(since) {
  await cleanupCalls();
  // Queue rows first, while the items they point to still exist: a row for an item that is already gone
  // (item_id null) can only be told apart by its action, so those orphans are removed too.
  if (since) {
    const testIds = await testItemIds();
    const { data: rows } = await svc.from("roadmap_sync_queue").select("id, item_id, action, payload").gte("created_at", since);
    const mine = (rows ?? []).filter(
      (r) =>
        (r.item_id && testIds.has(r.item_id)) ||
        (r.item_id === null && r.action !== "remove") ||
        /\[TESTE\]|Novo item — edite a descrição|zz-test/.test(JSON.stringify(r.payload))
    );
    if (mine.length) await svc.from("roadmap_sync_queue").delete().in("id", mine.map((r) => r.id));
    console.log(`cleanup: ${mine.length} queue row(s) of this run removed; ${(rows ?? []).length - mine.length} foreign row(s) left alone`);
  }
  await svc.from("lanes").delete().like("id", "zz-test-%");
  await svc.from("roadmap_items").delete().in("created_by", [ids.admin, ids.sm].filter(Boolean));
  await svc.from("roadmap_items").delete().like("title", "[TESTE]%");
  for (const id of createdWeeks) await svc.rpc("delete_week_lane_if_empty", { p_lane_id: id });
  await svc.from("profiles").update({ role: "admin", must_reset_password: false }).eq("id", ids.admin);
  await svc.from("profiles").update({ role: "scrum_master", must_reset_password: false }).eq("id", ids.sm);
  await svc.from("profiles").update({ role: "dev", must_reset_password: false }).eq("id", ids.dev);
}

// The local server reads production's board snapshot, which production pages refresh every few minutes. A check of
// what happens past the brake makes the snapshot old for its duration, then puts the old time back, but only if
// nothing wrote a newer snapshot meanwhile (a real sync in production wins).
async function ageSnapshot() {
  const { data } = await svc.from("board_sync_state").select("synced_at").eq("id", true).single();
  const aged = new Date(Date.now() - 60 * 60_000).toISOString();
  await svc.from("board_sync_state").update({ synced_at: aged }).eq("id", true);
  return async () => {
    await svc.from("board_sync_state").update({ synced_at: data.synced_at }).eq("id", true).eq("synced_at", aged);
  };
}

module.exports = {
  ageSnapshot, addDays, createdWeeks, weekId, weeks, E2E_UA, cleanupCalls, BASE, LABEL, PREFIX, cred, svc, sleep, expect, summary, results, launch, newSession, login, menuButton, cardButton, ids, ensureFixtures, cleanup, expectNoTestIssues, SYNTHETIC_ISSUE_MIN, scrub, fitWholePage };
