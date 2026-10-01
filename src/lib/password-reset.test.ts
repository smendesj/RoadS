import { test } from "node:test";
import assert from "node:assert/strict";
import { resetFailureMessage, resetPassword, temporaryPassword } from "./password-reset.ts";
import { isValidPassword } from "./validation.ts";

function ports(over: Partial<Record<"getEmail" | "sendRecoveryEmail" | "setTemporaryPassword" | "flagMustReset", () => Promise<unknown>>> = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      getEmail: async (id: string) => {
        calls.push(`getEmail:${id}`);
        return (await over.getEmail?.()) === undefined ? "ana@essencislabs.com" : ((await over.getEmail?.()) as string | null);
      },
      sendRecoveryEmail: async (email: string) => {
        calls.push(`send:${email}`);
        await over.sendRecoveryEmail?.();
      },
      setTemporaryPassword: async (id: string) => {
        calls.push(`password:${id}`);
        await over.setTemporaryPassword?.();
      },
      flagMustReset: async (id: string) => {
        calls.push(`flag:${id}`);
        await over.flagMustReset?.();
      },
    },
  };
}

test("the e-mail goes out first, then the old password is invalidated, then the account is flagged", async () => {
  const { calls, deps } = ports();
  const email = await resetPassword("u1", deps);
  assert.equal(email, "ana@essencislabs.com");
  assert.deepEqual(calls, ["getEmail:u1", "send:ana@essencislabs.com", "password:u1", "flag:u1"]);
});

test("an e-mail that can't be sent changes nothing: nobody is locked out with no way back in", async () => {
  const { calls, deps } = ports({
    sendRecoveryEmail: async () => {
      throw new Error("429 over_email_send_rate_limit");
    },
  });
  await assert.rejects(resetPassword("u1", deps), /429/);
  assert.deepEqual(calls, ["getEmail:u1", "send:ana@essencislabs.com"]);
});

test("an unknown account changes nothing", async () => {
  const { calls, deps } = ports({ getEmail: async () => null });
  await assert.rejects(resetPassword("ghost", deps), /user_not_found/);
  assert.deepEqual(calls, ["getEmail:ghost"]);
});

test("the address comes from the account, never from the caller", async () => {
  const { deps } = ports();
  assert.equal(resetPassword.length, 2, "resetPassword takes the user id and the ports, no e-mail argument");
  assert.equal(await resetPassword("u9", deps), "ana@essencislabs.com");
});

test("a failure setting the temporary password is reported", async () => {
  const { calls, deps } = ports({
    setTemporaryPassword: async () => {
      throw new Error("auth down");
    },
  });
  await assert.rejects(resetPassword("u1", deps), /auth down/);
  assert.ok(!calls.includes("flag:u1"));
});

test("temporary passwords are long, URL-safe, different every time, and satisfy the password rule", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const p = temporaryPassword();
    assert.match(p, /^[A-Za-z0-9_-]{32,}$/);
    assert.equal(isValidPassword(p), true);
    seen.add(p);
  }
  assert.equal(seen.size, 50);
});

test("the per-person cooldown (one e-mail a minute) is explained as such", () => {
  const tooSoon = /uma vez por minuto/;
  assert.match(resetFailureMessage({ status: 429, code: "over_email_send_rate_limit", message: "For security purposes, you can only request this after 55 seconds." }), tooSoon);
  assert.match(resetFailureMessage(new Error("For security purposes, you can only request this after 12 seconds.")), tooSoon);
});

test("the project-wide e-mail cap is explained as that, not as the per-person minute", () => {
  const cap = /limite de e-mails de autenticação do projeto/;
  assert.match(resetFailureMessage({ status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" }), cap);
  assert.match(resetFailureMessage(new Error("email rate limit exceeded")), cap);
  assert.doesNotMatch(resetFailureMessage(new Error("email rate limit exceeded")), /uma vez por minuto/);
});

test("an unknown account and any other failure each get a plain line, never the raw error", () => {
  assert.equal(resetFailureMessage(new Error("user_not_found")), "Usuário não encontrado.");
  const other = resetFailureMessage(new Error('relation "profiles" does not exist'));
  assert.equal(other, "Não foi possível concluir o reset agora. Tente de novo.");
  assert.doesNotMatch(other, /relation|profiles/);
});
