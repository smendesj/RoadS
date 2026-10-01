// Forced password reset, the admin's "Resetar senha", and the recovery link opened in a clean browser.
// Part 2 sends ONE real e-mail (to the Dev test account's plus-address, the owner's own mailbox).
const { createClient } = require("@supabase/supabase-js");
const L = require("./lib.cjs");
const { BASE, expect, sleep, svc } = L;

const fresh = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

(async () => {
  const t0 = new Date().toISOString();
  await L.ensureFixtures();
  const devEmail = L.cred("ROADS_TEST_DEV_EMAIL");
  const devPassword = L.cred("ROADS_TEST_DEV_PASSWORD");
  const flag = async () => (await svc.from("profiles").select("must_reset_password").eq("id", L.ids.dev).single()).data.must_reset_password;
  const setPassword = (p) => svc.auth.admin.updateUserById(L.ids.dev, { password: p });
  const updatedAt = async () => (await svc.auth.admin.getUserById(L.ids.dev)).data.user.updated_at;
  const canLogin = async (password) => !(await fresh().auth.signInWithPassword({ email: devEmail, password })).error;
  const browser = await L.launch();
  try {
    // ================================================= part 1: the forced reset (no e-mail involved)
    await svc.from("profiles").update({ must_reset_password: true }).eq("id", L.ids.dev);
    const dev = await L.newSession(browser, "dev");
    const { page } = dev;
    await L.login(dev);
    expect("flagged account: login sends the Dev to /redefinir-senha", page.url().endsWith("/redefinir-senha"), page.url());
    expect("the page explains the reset", (await page.getByText(/senha foi resetada/).count()) === 1);

    for (const target of ["/dashboard", "/roadmap"]) {
      await page.goto(BASE + target, { waitUntil: "load" });
      expect(`flagged account: typing ${target} does NOT get the Dev around the reset`, page.url().endsWith("/redefinir-senha"), page.url());
    }
    await page.goto(BASE + "/config", { waitUntil: "load" });
    expect("flagged account: nor does /config", page.url().endsWith("/redefinir-senha"), page.url());

    const own = fresh();
    await own.auth.signInWithPassword({ email: devEmail, password: devPassword });
    const cleared = await own.from("profiles").update({ must_reset_password: false }).eq("id", L.ids.dev).select("id");
    expect("flagged account: the user can NOT clear their own flag through the API", !!cleared.error || (cleared.data ?? []).length === 0, cleared.error?.message ?? `${cleared.data?.length} row(s) updated`);
    expect("flagged account: the flag is still on", (await flag()) === true);

    await page.goto(BASE + "/redefinir-senha", { waitUntil: "load" });
    await page.locator('input[type="password"]').fill("abc");
    await page.getByRole("button", { name: /Salvar e continuar/ }).click();
    await page.getByText(/Mínimo 8 caracteres/).first().waitFor();
    expect("reset form: a weak password is refused with the rule", page.url().endsWith("/redefinir-senha"));
    const newPassword = `Nova-${Date.now()}-x9`;
    await page.locator('input[type="password"]').fill(newPassword);
    await page.getByRole("button", { name: /Salvar e continuar/ }).click();
    await page.waitForURL("**/dashboard", { timeout: 30000 });
    expect("reset form: a good password finishes the reset and opens the dashboard", page.url().endsWith("/dashboard"));
    expect("reset form: the flag is cleared by the server", (await flag()) === false);
    expect("reset form: the new password works and the old one stopped", (await canLogin(newPassword)) && !(await canLogin(devPassword)));
    await setPassword(devPassword);
    await svc.from("profiles").update({ must_reset_password: false }).eq("id", L.ids.dev);

    // ================================================= part 2: the admin's "Resetar senha"
    const adm = await L.newSession(browser, "admin");
    await L.login(adm);
    await adm.page.goto(BASE + "/config", { waitUntil: "load" });
    await adm.page.locator("tbody tr").first().waitFor({ timeout: 30000 });
    const row = adm.page.locator("tbody tr", { hasText: "RoadS Tester Dev" });

    await row.getByRole("button", { name: "Resetar senha" }).click();
    await adm.page.getByText(/Resetar a senha de/).waitFor();
    await adm.page.getByRole("button", { name: "Cancelar" }).click();
    await sleep(800);
    expect("config: Cancelar changes nothing (flag off, old password works)", (await flag()) === false && (await canLogin(devPassword)));

    await row.getByRole("button", { name: "Resetar senha" }).click();
    await adm.page.getByRole("button", { name: "Confirmar reset" }).click();
    // Supabase may refuse (its e-mail cap is tiny on the default sender); both outcomes must be handled honestly.
    const outcome = await Promise.race([
      adm.page.getByText(/E-mail de redefinição enviado/).waitFor({ timeout: 30000 }).then(() => "sent"),
      adm.page.getByText(/uma vez por minuto|limite de e-mails/).waitFor({ timeout: 30000 }).then(() => "refused"),
    ]).catch(() => "none");
    await sleep(1500);
    if (outcome === "sent") {
      expect("config: Confirmar reset shows the 'e-mail enviado' notice", true);
      expect("config: the Dev account is flagged and the old password stopped working", (await flag()) === true && !(await canLogin(devPassword)));
      expect("config: the row says the person needs a new password", (await row.getByText("Precisa criar nova senha").count()) === 1);
    } else {
      expect("config: e-mail refused by Supabase -> the screen says so and NOTHING was changed (flag off, old password works)", outcome === "refused" && (await flag()) === false && (await canLogin(devPassword)), `outcome=${outcome}`);
      console.log("   (success path of the reset NOT exercised this run: Supabase refused to send. Re-run once its e-mail cap has reset.)");
    }

    // a second reset right after: refused or throttled by Supabase. The screen must say so, and change nothing.
    const before = await updatedAt();
    await row.getByRole("button", { name: "Resetar senha" }).click();
    await adm.page.getByRole("button", { name: "Confirmar reset" }).click();
    await adm.page.getByText(/uma vez por minuto|limite de e-mails/).waitFor({ timeout: 30000 }).catch(() => {});
    await sleep(1000);
    expect("config: a refused e-mail is reported as such, never as 'enviado'", (await adm.page.getByText(/uma vez por minuto|limite de e-mails/).count()) === 1 && (await adm.page.getByText(/E-mail de redefinição enviado/).count()) === 0);
    expect("config: and the failed attempt left the account untouched (the old password is not thrown away)", (await updatedAt()) === before);

    // ================================================= part 3: the person opens the link in a browser of their own
    const { data: linkData } = await svc.auth.admin.generateLink({ type: "recovery", email: devEmail, options: { redirectTo: BASE + "/redefinir-senha" } });
    const recipient = await browser.newContext(); // no cookie, no verifier, nothing from the admin's browser
    const rp = await recipient.newPage();
    const rpProblems = [];
    rp.on("pageerror", (e) => rpProblems.push(String(e).slice(0, 120)));
    await rp.goto(linkData.properties.action_link, { waitUntil: "load" });
    // the page turns the link's tokens into a session shortly after loading: wait for it, up to 20s
    for (let i = 0; i < 40; i++) {
      const done = new URL(rp.url()).hash === "" && (await recipient.cookies()).some((c) => c.name.startsWith("sb-") && /auth-token/.test(c.name));
      if (done) break;
      await sleep(500);
    }
    const landed = new URL(rp.url());
    expect("recovery link: opens the reset page", landed.pathname === "/redefinir-senha", landed.pathname);
    expect("recovery link: the tokens are taken out of the address bar", landed.hash === "", landed.hash.slice(0, 30));
    expect("recovery link: a session exists in this clean browser", (await recipient.cookies()).some((c) => c.name.startsWith("sb-") && /auth-token/.test(c.name)));
    const chosen = `Escolhida-${Date.now()}-y7`;
    await rp.locator('input[type="password"]').fill(chosen);
    await rp.getByRole("button", { name: /Salvar e continuar/ }).click();
    await rp.waitForURL("**/dashboard", { timeout: 30000 });
    expect("recovery link: choosing a new password finishes the reset (dashboard opens)", rp.url().endsWith("/dashboard"));
    expect("recovery link: flag cleared, new password works", (await flag()) === false && (await canLogin(chosen)));
    await recipient.close();

    // a dead link must say so instead of failing quietly
    const dead = await browser.newContext();
    const dp = await dead.newPage();
    await dp.goto(`${BASE}/redefinir-senha#access_token=invalido&refresh_token=invalido&type=recovery`, { waitUntil: "load" });
    await sleep(2500);
    await dp.locator('input[type="password"]').fill("Qualquer-senha-9");
    await dp.getByRole("button", { name: /Salvar e continuar/ }).click();
    const deadMsg = await dp.getByText(/expirou ou já foi usado/).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    expect("recovery link: an expired or invalid link says so", deadMsg);
    expect("recovery link: ...and the address bar no longer shows the bad tokens", new URL(dp.url()).hash === "");
    await dead.close();

    const noise = [...dev.problems, ...adm.problems, ...rpProblems].filter((p) => !/auth\/v1\/(token|recover|user)|ERR_FAILED|Failed to load resource|\/api\/|HTTP (400|401|403|429)/.test(p));
    expect("no unexpected console errors on any of these pages", noise.length === 0, noise.slice(0, 3).join(" | "));
  } catch (e) {
    expect("run completed without an exception", false, L.scrub(e && e.message ? e.message : e).slice(0, 300));
  } finally {
    await browser.close();
    await setPassword(devPassword);
    await svc.from("profiles").update({ must_reset_password: false }).eq("id", L.ids.dev);
    await L.cleanup(t0);
  }
  process.exit(L.summary("PASSWORD RESET") ? 1 : 0);
})();
