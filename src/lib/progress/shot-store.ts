// Where the prints of the Resumo live: a private storage bucket that only the service role reads or writes
// (migration 0024 gives it no policy for anyone else). A print is stored under the SHA-256 of its bytes, so
// sending the same file twice stores it once, and a path can never name anything but a print.
// Pure on purpose (no "server-only", no "@/" imports): the push script and the tests use it too.
import type { Shot } from "../progress-report.ts";
import { MAX_SHOT_BYTES, shotExtension } from "./draft.ts";

export const PROGRESS_SHOTS_BUCKET = "progress-shots";

const SIGNATURE: Record<Shot["mime"], number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

/** The type of a print, read from its first bytes: the name or a declared type is never trusted. */
export function imageMime(bytes: Uint8Array): Shot["mime"] | null {
  for (const mime of ["image/png", "image/jpeg"] as const) {
    if (SIGNATURE[mime].every((byte, i) => bytes[i] === byte)) return mime;
  }
  return null;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type CheckedShot = { ok: true; mime: Shot["mime"]; path: string } | { ok: false; error: string };

/** Checks one print's bytes (type and size) and names the path it is stored under. */
export async function checkShotBytes(bytes: Uint8Array<ArrayBuffer>): Promise<CheckedShot> {
  if (bytes.byteLength === 0) return { ok: false, error: "o print está vazio" };
  if (bytes.byteLength > MAX_SHOT_BYTES) return { ok: false, error: `print acima de ${MAX_SHOT_BYTES / 1024} KB` };
  const mime = imageMime(bytes);
  if (!mime) return { ok: false, error: "o arquivo não é uma imagem JPEG ou PNG" };
  return { ok: true, mime, path: `${await sha256Hex(bytes)}.${shotExtension(mime)}` };
}
