import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// The vault's encryption at rest. Each secret is sealed with AES-256-GCM before it ever reaches the
// database, so a dump without the key reads nothing. The key is CONTROLS_VAULT_KEY (any string: its
// SHA-256 is the 32-byte key); it lives only in the server environment, never in the repo or the database.
//
// Stored shape: base64 of [12-byte IV][16-byte GCM tag][ciphertext], prefixed with "v1:" so the format can
// change later without guessing. Pure functions that take the key, so they test without any environment.

const PREFIX = "v1:";

function keyBytes(secretKey: string): Buffer {
  return createHash("sha256").update(secretKey, "utf8").digest();
}

/** Seal a plain secret into the stored ciphertext string. */
export function encryptSecret(plain: string, secretKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(secretKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Open a stored ciphertext string back into the plain secret. Throws if the key is wrong or the blob is bad. */
export function decryptSecret(stored: string, secretKey: string): string {
  if (!stored.startsWith(PREFIX)) throw new Error("unknown_vault_format");
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(secretKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** The server-side key, or null when it isn't configured (the vault then refuses to store or reveal secrets). */
export function vaultKey(): string | null {
  const key = process.env.CONTROLS_VAULT_KEY;
  return key && key.length > 0 ? key : null;
}
