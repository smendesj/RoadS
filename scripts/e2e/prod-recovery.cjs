// A password-recovery link opened in a clean browser against PRODUCTION, finished through the real page.
// Changes only the Dev test account's password and puts the original back. Sends no e-mail (the link comes
// from the admin API); that the e-mail itself arrives is the one thing this can't see.
process.env.E2E_BASE = "https://roads-psi.vercel.app";
const { createClient } = require("@supabase/supabase-js");
const L = require("./lib.cjs");
const { BASE, expect, sleep, svc } = L;

const anon = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const redirectOf = (link) => new URL(link).searchParams.get("redirect_to");

(async () => {
  const devEmail = L.cred("ROADS_TEST_DEV_EMAIL");
  const devPassword = L.cred("ROADS_TEST_DEV_PASSWORD");
  const devId = (await svc.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users.find((u) => u.email === devEmail).id;
  const canLogin = async (password) => !(await anon().auth.signInWithPassword({ email: devEmail, password })).error;
  const browser = await L.launch();
  try {
    // ---- the project's auth URLs: what Supabase will do with a redirect
    const asked = `${BASE}/redefinir-senha`;
    const own = await svc.auth.admin.generateLink({ type: "recovery", email: devEmail, options: { redirectTo: asked } });
    expect("auth config: recovery links go to the production reset page", redirectOf(own.data.properties.action_link) === asked, String(redirectOf(own.data.properties.action_link)));
    const foreign = await svc.auth.admin.generateLink({ type: "recovery", email: devEmail, options: { redirectTo: "https://evil.example.com/redefinir-senha" } });
    expect("auth config: a foreign redirect is replaced by the production Site URL (no open redirect)", redirectOf(foreign.data.properties.action_link) === BASE, String(redirectOf(foreign.data.properties.action_link)));

    // ---- the link, in a browser that has never seen this app
    const { data } = await svc.auth.admin.generateLink({ type: "recovery", email: devEmail, options: { redirectTo: asked } });
    const recipient = await browser.newContext();
    const page = await recipient.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(String(e).slice(0, 140)));
    page.on("console", (m) => { if (m.type() === "error") problems.push(m.text().slice(0, 140)); });
    await page.goto(data.properties.action_link, { waitUntil: "load" });
    for (let i = 0; i < 40; i++) {
      const done = new URL(page.url()).hash === "" && (await recipient.cookies()).some((c) => c.name.startsWith("sb-") && /auth-token/.test(c.name));
      if (done) break;
      await sleep(500);
    }
    const landed = new URL(page.url());
    expect("link: opens the production reset page", landed.origin === BASE && landed.pathname === "/redefinir-senha", `${landed.origin}${landed.pathname}`);
    expect("link: the tokens are taken out of the address bar", landed.hash === "");
    expect("link: a session exists in this clean browser", (await recipient.cookies()).some((c) => c.name.startsWith("sb-") && /auth-token/.test(c.name)));

    const chosen = `Producao-${Date.now()}-z5`;
    await page.locator('input[type="password"]').fill(chosen);
    await page.getByRole("button", { name: /Salvar e continuar/ }).click();
    await page.waitForURL("**/dashboard", { timeout: 45000 });
    expect("link: choosing a new password opens the production dashboard", new URL(page.url()).origin === BASE && page.url().endsWith("/dashboard"), page.url());
    expect("link: the new password works and the old one stopped", (await canLogin(chosen)) && !(await canLogin(devPassword)));
    await L.menuButton(page).waitFor({ timeout: 30000 });
    await L.menuButton(page).click();
    await page.getByRole("button", { name: "Sair" }).click();
    await page.waitForURL("**/login");
    expect("link: Sair works on the account that just came in through the link", page.url().endsWith("/login"));
    await recipient.close();
    const noise = problems.filter((p) => !/auth\/v1\/(token|user)|Failed to load resource|ERR_FAILED/.test(p));
    expect("no console or hydration errors on the way", noise.length === 0, noise.slice(0, 3).join(" | "));
  } catch (e) {
    expect("run completed without an exception", false, L.scrub(e && e.message ? e.message : e).slice(0, 300));
  } finally {
    await browser.close();
    await svc.auth.admin.updateUserById(devId, { password: devPassword });
    await svc.from("profiles").update({ must_reset_password: false }).eq("id", devId);
  }
  process.exit(L.summary("PRODUCTION RECOVERY LINK") ? 1 : 0);
})();
