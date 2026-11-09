import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret } from "./vault.ts";

test("a secret round-trips through encrypt/decrypt with the same key", () => {
  const key = "a-test-key-only";
  const sealed = encryptSecret("hunter2-Çãõ!", key);
  assert.ok(sealed.startsWith("v1:"));
  assert.notEqual(sealed, "hunter2-Çãõ!");
  assert.equal(decryptSecret(sealed, key), "hunter2-Çãõ!");
});

test("two seals of the same secret differ (random IV) but both decrypt", () => {
  const key = "k";
  const a = encryptSecret("same", key);
  const b = encryptSecret("same", key);
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a, key), "same");
  assert.equal(decryptSecret(b, key), "same");
});

test("a wrong key cannot open the secret", () => {
  const sealed = encryptSecret("top secret", "right-key");
  assert.throws(() => decryptSecret(sealed, "wrong-key"));
});

test("an unknown stored format is rejected", () => {
  assert.throws(() => decryptSecret("plaintext-leak", "any"), /unknown_vault_format/);
});
