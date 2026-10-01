// Public pages (nobody signed in), against the local production server. Signup is only exercised with inputs
// the page refuses itself: nothing here creates an account or sends an e-mail.
const L = require("./lib.cjs");
const { BASE, expect, sleep } = L;

(async () => {
  const browser = await L.launch();
  try {
    const ctx = await browser.newContext({ locale: "pt-BR" });
    const page = await ctx.newPage();
    const problems = [];
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(m.text().slice(0, 160)); });
    page.on("pageerror", (e) => problems.push(String(e).slice(0, 160)));

    // ---- every protected page sends a visitor to /login, and the public ones load
    for (const path of ["/dashboard", "/roadmap", "/config", "/"]) {
      await page.goto(BASE + path, { waitUntil: "load" });
      await sleep(600);
      expect(`visitor on ${path} ends up at /login`, new URL(page.url()).pathname === "/login", page.url());
    }
    for (const path of ["/login", "/cadastro", "/redefinir-senha"]) {
      await page.goto(BASE + path, { waitUntil: "load" });
      expect(`public page ${path} loads for a visitor`, new URL(page.url()).pathname === path, page.url());
    }

    // ---- /cadastro: the page's own checks (no account is created)
    await page.goto(BASE + "/cadastro", { waitUntil: "load" });
    const email = page.locator('input[type="email"]');
    const pass = page.locator('input[type="password"]');
    const submit = page.getByRole("button", { name: "Cadastrar" });
    const errorText = () => page.locator("p.text-red-600, p.text-\\[13px\\]").first().innerText().catch(() => "");
    await email.fill("alguem@gmail.com");
    await pass.fill("Senha-boa-123");
    await submit.click();
    await sleep(500);
    expect("cadastro: a non-company domain is refused by the page, naming the allowed ones", /essencislabs\.com/.test(await errorText()) && /essencistech\.com\.br/.test(await errorText()), await errorText());
    await email.fill("ana@essencislabs.com@evil.com");
    await submit.click();
    await sleep(500);
    expect("cadastro: 'ana@essencislabs.com@evil.com' is refused too (two @)", /Use um e-mail/.test(await errorText()), await errorText());
    await email.fill("ana@essencislabs.com");
    await pass.fill("curta1");
    await submit.click();
    await sleep(500);
    expect("cadastro: a weak password shows the rule", /Mínimo 8 caracteres/.test(await errorText()), await errorText());
    expect("cadastro: still on /cadastro, nothing was created", new URL(page.url()).pathname === "/cadastro");

    // ---- /login: input handling
    await page.goto(BASE + "/login", { waitUntil: "load" });
    await page.locator('input[type="email"]').fill("nao-e-email");
    await page.locator('input[type="password"]').fill("x");
    await page.locator('button[type="submit"]').click();
    await sleep(500);
    expect("login: a value that isn't an e-mail is stopped by the browser's own validation", new URL(page.url()).pathname === "/login");
    for (const [label, mail, pw] of [
      ["right e-mail, wrong password", L.cred("ROADS_TEST_DEV_EMAIL"), "senha-errada-123"],
      ["unknown e-mail", "ninguem.existe@essencislabs.com", "qualquer-123"],
      ["SQL-looking input", "x'; drop table profiles;--@essencislabs.com", "' or '1'='1"],
    ]) {
      await page.locator('input[type="email"]').fill(mail);
      await page.locator('input[type="password"]').fill(pw);
      await page.locator('button[type="submit"]').click();
      await sleep(2200);
      const msg = await page.getByText(/incorretos/).count();
      expect(`login (${label}): one generic message, still on /login`, new URL(page.url()).pathname === "/login" && msg <= 1, `msgs=${msg}`);
    }

    // ---- a real session cookie is not required to see static assets, and nothing sensitive is cached publicly
    const avatar = await page.request.get(BASE + "/avatars/avatar-01.svg");
    expect("static avatar is public", avatar.status() === 200);
    const apiGet = await page.request.get(BASE + "/api/frontlights/pending-changes");
    expect("API route without its secret: 401", apiGet.status() === 401);
    const login = await page.request.get(BASE + "/login");
    const headers = login.headers();
    expect("security headers present on public pages", headers["x-frame-options"] === "DENY" && /frame-ancestors 'none'/.test(headers["content-security-policy"] ?? "") && headers["x-content-type-options"] === "nosniff", JSON.stringify(Object.keys(headers).filter((h) => /frame|security|content-type-options|referrer|permissions/.test(h))));

    const noise = problems.filter((p) => !/Failed to load resource|ERR_FAILED|status of (400|401|403)/.test(p));
    expect("no console errors on the public pages", noise.length === 0, noise.slice(0, 3).join(" | "));
  } catch (e) {
    expect("run completed without an exception", false, L.scrub(e && e.message ? e.message : e).slice(0, 300));
  } finally {
    await browser.close();
  }
  process.exit(L.summary("PUBLIC PAGES") ? 1 : 0);
})();
