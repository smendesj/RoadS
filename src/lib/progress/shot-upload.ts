// Receives one print of the Resumo and keeps it in the private prints bucket: the door the push script uses
// for each print before it sends the draft, so a draft only ever carries paths and stays far under the
// host's request cap. Pure, with the bucket injected: the route wires the admin client, the tests a fake.
//
//   { data: "<base64>" } -> 200 { path, mime } | 400 { error }   (a bucket failure is thrown: the route's 500)
//
// The type comes from the bytes, never from a name or a declared type, and the path is the hash of the bytes,
// so the same print sent twice is stored once and a path never names anything but a print.
import { checkShotBytes } from "./shot-store.ts";

/** The one call of the storage client this needs: put the bytes at a path in the prints bucket. */
export type ShotBucket = {
  upload(path: string, bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<{ error: { statusCode?: string; message?: string } | null }>;
};
export type ShotAnswer = { status: 200; body: { path: string; mime: string } } | { status: 400; body: { error: string } };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const refuse = (error: string): ShotAnswer => ({ status: 400, body: { error } });

function decode(data: string): Uint8Array<ArrayBuffer> | null {
  if (data.length === 0 || data.length % 4 !== 0 || !BASE64.test(data)) return null;
  try {
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** True when the bucket says the object is already there: same path, same bytes, nothing to do. */
const alreadyThere = (error: { statusCode?: string; message?: string }) => error.statusCode === "409" || /already exists/i.test(error.message ?? "");

export async function receiveShot(bucket: ShotBucket, body: unknown): Promise<ShotAnswer> {
  const data = typeof body === "object" && body !== null ? (body as { data?: unknown }).data : undefined;
  if (typeof data !== "string") return refuse("data: esperada a imagem em base64 puro");
  const bytes = decode(data);
  if (!bytes) return refuse("data: esperada a imagem em base64 puro, sem prefixo data:");
  const checked = await checkShotBytes(bytes);
  if (!checked.ok) return refuse(`data: ${checked.error}`);
  const { error } = await bucket.upload(checked.path, bytes, checked.mime);
  // Only the status travels in the error: the storage's own message is not repeated anywhere.
  if (error && !alreadyThere(error)) throw new Error(`print upload failed (${error.statusCode ?? "unknown"})`);
  return { status: 200, body: { path: checked.path, mime: checked.mime } };
}
