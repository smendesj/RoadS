import { test } from "node:test";
import assert from "node:assert/strict";
import { receiveShot, type ShotBucket } from "./shot-upload.ts";
import { MAX_SHOT_BYTES } from "./draft.ts";

// Made-up bytes only: a file that starts like a PNG or a JPEG.
const png = (bytes: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(bytes - 8, 7)]);
const jpeg = (bytes: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes - 4, 7)]);

/** A bucket that keeps what it was given, and can be told an object is already there or that it is down. */
function fakeBucket(opts: { exists?: boolean; down?: boolean } = {}) {
  const stored: { path: string; bytes: number[]; contentType: string }[] = [];
  const bucket: ShotBucket = {
    async upload(path, bytes, contentType) {
      if (opts.down) return { error: { statusCode: "500", message: "storage unavailable" } };
      if (opts.exists) return { error: { statusCode: "409", message: "The resource already exists" } };
      stored.push({ path, bytes: [...bytes], contentType });
      return { error: null };
    },
  };
  return { bucket, stored };
}

test("a print is stored under the hash of its bytes, with its own type, and the path comes back", async () => {
  const { bucket, stored } = fakeBucket();
  const bytes = png(2048);
  const out = await receiveShot(bucket, { data: bytes.toString("base64") });
  assert.equal(out.status, 200);
  assert.ok(out.status === 200 && /^[0-9a-f]{64}\.png$/.test(out.body.path));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].contentType, "image/png");
  assert.deepEqual(stored[0].bytes, [...bytes]);
  if (out.status === 200) {
    assert.equal(stored[0].path, out.body.path);
    assert.equal(out.body.mime, "image/png");
  }
  // The same bytes give the same path: sending a print twice stores it once.
  const again = await receiveShot(fakeBucket({ exists: true }).bucket, { data: bytes.toString("base64") });
  assert.deepEqual(again, out);
  const asJpeg = await receiveShot(fakeBucket().bucket, { data: jpeg(2048).toString("base64") });
  assert.ok(asJpeg.status === 200 && asJpeg.body.path.endsWith(".jpg") && asJpeg.body.mime === "image/jpeg");
});

test("up to 1 MB is taken; anything above, or that is not a JPEG or PNG, or not base64, is a 400 and nothing is stored", async () => {
  const { bucket, stored } = fakeBucket();
  assert.equal((await receiveShot(bucket, { data: jpeg(MAX_SHOT_BYTES).toString("base64") })).status, 200);
  const cases: unknown[] = [
    { data: jpeg(MAX_SHOT_BYTES + 1).toString("base64") },
    { data: Buffer.from("<svg onload=alert(1)></svg>").toString("base64") },
    { data: "isto não é base64!" },
    { data: "data:image/png;base64," + png(64).toString("base64") },
    { data: "" },
    {},
    null,
    "texto",
  ];
  for (const body of cases) {
    const out = await receiveShot(bucket, body);
    assert.equal(out.status, 400, JSON.stringify(body)?.slice(0, 40));
    assert.ok(out.status === 400 && typeof out.body.error === "string");
  }
  assert.equal(stored.length, 1);
});

test("a bucket that fails is thrown, so the route answers 500 and the push stops", async () => {
  await assert.rejects(receiveShot(fakeBucket({ down: true }).bucket, { data: png(64).toString("base64") }));
});
