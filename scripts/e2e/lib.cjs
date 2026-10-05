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
async function newSession(browser, role, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, locale: "pt-BR" });
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

const menuButton = (page) => page.locator('button[aria-label="Menu do usuário"]');
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

// A native HTML5 drop only lands on screen: grow the window to the whole page, so source and target are both
// visible however long the Roadmap gets (its blocks grow with the real board).
async function fitWholePage(page, width = 1440) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height: Math.max(900, height + 200) });
  await sleep(600);
}

// Removes everything a run can create and puts the test accounts back as they were.
async function cleanup(since) {
  // Queue rows first, while the items they point to still exist: a row for an item that is already gone
  // (item_id null) can only be told apart by its action, so those orphans are removed too.
  if (since) {
    const inLanes = (await svc.from("roadmap_items").select("id").like("lane_id", "zz-test-%")).data ?? [];
    const titled = (await svc.from("roadmap_items").select("id").like("title", "[TESTE]%")).data ?? [];
    const byOwner = (await svc.from("roadmap_items").select("id").in("created_by", [ids.admin, ids.sm].filter(Boolean))).data ?? [];
    const testIds = new Set([...inLanes, ...titled, ...byOwner].map((r) => r.id));
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
  await svc.from("profiles").update({ role: "admin", must_reset_password: false }).eq("id", ids.admin);
  await svc.from("profiles").update({ role: "scrum_master", must_reset_password: false }).eq("id", ids.sm);
  await svc.from("profiles").update({ role: "dev", must_reset_password: false }).eq("id", ids.dev);
}

module.exports = { BASE, LABEL, PREFIX, cred, svc, sleep, expect, summary, results, launch, newSession, login, menuButton, ids, ensureFixtures, cleanup, scrub, fitWholePage };
