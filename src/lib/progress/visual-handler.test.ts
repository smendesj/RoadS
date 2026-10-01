import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProgressContent, Shot } from "../progress-report.ts";
import { resolveContent } from "./resolve.ts";
import { renderVisualPng, visualSize } from "./visual.ts";
import { loadImageResponse, loadVisualFonts } from "./visual-node.ts";
import { createAssetStore, handleProgressAsset, type AssetQueryClient, type AssetReport, type AssetResponse } from "./visual-handler.ts";
import { sampleContent } from "./visual-fixture.ts";

const TOKEN = "0b9f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4";
const OTHER_TOKEN = "11111111-2222-4333-8444-555555555555";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9]);
const JPEG_BYTES = [255, 216, 255, 224, 1, 2, 3];
const PNG_SHOT_BYTES = [137, 80, 78, 71, 13, 10, 26, 10, 7, 7];

const shot = (mime: Shot["mime"], bytes: number[], caption = "Tela de exemplo"): Shot => ({
  id: `s-${bytes[0]}`,
  caption,
  mime,
  data: Buffer.from(bytes).toString("base64"),
});

const row = (patch: Partial<AssetReport> = {}, content: ProgressContent = sampleContent(2)): AssetReport => ({
  status: "draft",
  rev: 3,
  content,
  overrides: {},
  pushed_at: "2026-10-01T15:00:00Z",
  ...patch,
});

/** A store that remembers every token it was asked about. */
function fakeStore(rows: Record<string, AssetReport | Error>) {
  const asked: string[] = [];
  return {
    asked,
    async findByToken(token: string) {
      asked.push(token);
      const found = rows[token];
      if (found instanceof Error) throw found;
      return found ?? null;
    },
  };
}

/** A renderer that remembers the content it was given instead of drawing it. */
function fakeRenderer() {
  const drawn: ProgressContent[] = [];
  return {
    drawn,
    async render(content: ProgressContent) {
      drawn.push(content);
      return new Uint8Array(PNG);
    },
  };
}

const header = (res: AssetResponse, name: string) =>
  Object.entries(res.headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

const bytesOf = (res: AssetResponse) => (res.body === null ? null : [...res.body]);

/* ---------- a token or a file that leads nowhere ---------- */

test("a token that is not a uuid is a 404 and the database is never asked", async () => {
  const store = fakeStore({});
  const { render } = fakeRenderer();
  for (const token of ["", "abc", "../../etc/passwd", "0b9f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c", `${TOKEN}x`, "'; drop table progress_reports; --"]) {
    const res = await handleProgressAsset({ token, file: "visual.png" }, store, render);
    assert.equal(res.status, 404, token);
  }
  assert.deepEqual(store.asked, []);
});

test("an unknown token and an unknown file look exactly alike: same status, same headers, same bytes", async () => {
  const store = fakeStore({ [TOKEN]: row({ status: "sent" }, sampleContent(2, { shots: [shot("image/jpeg", JPEG_BYTES)] })) });
  const { render } = fakeRenderer();
  const unknownToken = await handleProgressAsset({ token: OTHER_TOKEN, file: "visual.png" }, store, render);
  const attempts = [
    await handleProgressAsset({ token: TOKEN, file: "evil.txt" }, store, render),
    await handleProgressAsset({ token: TOKEN, file: "shot-9.jpg" }, store, render), // there is no ninth print
    await handleProgressAsset({ token: TOKEN, file: "shot-2.jpg" }, store, render), // nor a second one here
    await handleProgressAsset({ token: TOKEN, file: "shot-0.jpg" }, store, render),
    await handleProgressAsset({ token: TOKEN, file: "..%2Fvisual.png" }, store, render),
    await handleProgressAsset({ token: "not-a-token", file: "visual.png" }, store, render),
  ];
  assert.equal(unknownToken.status, 404);
  for (const other of attempts) assert.deepEqual(other, unknownToken);
  assert.equal(unknownToken.body, null);
  assert.equal(header(unknownToken, "Cache-Control"), "no-store");
  assert.equal(header(unknownToken, "X-Content-Type-Options"), "nosniff");
});

/* ---------- the picture ---------- */

test("a sent report's picture is a PNG that the whole web may keep forever", async () => {
  const store = fakeStore({ [TOKEN]: row({ status: "sent" }) });
  const { render } = fakeRenderer();
  const res = await handleProgressAsset({ token: TOKEN, file: "visual.png" }, store, render);
  assert.equal(res.status, 200);
  assert.equal(header(res, "Content-Type"), "image/png");
  assert.equal(header(res, "Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(header(res, "Content-Length"), String(PNG.byteLength));
  assert.deepEqual(bytesOf(res), [...PNG]);
});

test("a draft's picture is never cached: the next push changes it", async () => {
  const store = fakeStore({ [TOKEN]: row({ status: "draft" }) });
  const { render } = fakeRenderer();
  const res = await handleProgressAsset({ token: TOKEN, file: "visual.png" }, store, render);
  assert.equal(res.status, 200);
  assert.equal(header(res, "Cache-Control"), "no-store");
});

test("the picture is drawn from the report with the user's edits applied, not from the raw push", async () => {
  const content = sampleContent(2);
  const overrides = { headline: { value: "Texto editado." } };
  const store = fakeStore({ [TOKEN]: row({ overrides }, content) });
  const { render, drawn } = fakeRenderer();
  await handleProgressAsset({ token: TOKEN, file: "visual.png" }, store, render);
  assert.deepEqual(drawn, [resolveContent({ content, overrides })]);
});

test("the lookup is by token alone: any product's report answers", async () => {
  const store = fakeStore({ [TOKEN]: row() });
  const { render } = fakeRenderer();
  await handleProgressAsset({ token: TOKEN, file: "visual.png" }, store, render);
  assert.deepEqual(store.asked, [TOKEN]);
});

/* ---------- the prints ---------- */

test("a print comes back byte for byte with its own content type, counted from 1", async () => {
  const content = sampleContent(2, { shots: [shot("image/jpeg", JPEG_BYTES), shot("image/png", PNG_SHOT_BYTES)] });
  const store = fakeStore({ [TOKEN]: row({ status: "sent" }, content) });
  const { render, drawn } = fakeRenderer();

  const first = await handleProgressAsset({ token: TOKEN, file: "shot-1.jpg" }, store, render);
  assert.equal(first.status, 200);
  assert.equal(header(first, "Content-Type"), "image/jpeg");
  assert.deepEqual(bytesOf(first), JPEG_BYTES);
  assert.equal(header(first, "Content-Length"), String(JPEG_BYTES.length));
  assert.equal(header(first, "Cache-Control"), "public, max-age=31536000, immutable");

  const second = await handleProgressAsset({ token: TOKEN, file: "shot-2.png" }, store, render);
  assert.equal(header(second, "Content-Type"), "image/png");
  assert.deepEqual(bytesOf(second), PNG_SHOT_BYTES);
  assert.deepEqual(drawn, []); // a print never triggers a drawing
});

test("a draft's print is not cached either", async () => {
  const store = fakeStore({ [TOKEN]: row({ status: "draft" }, sampleContent(2, { shots: [shot("image/png", PNG_SHOT_BYTES)] })) });
  const res = await handleProgressAsset({ token: TOKEN, file: "shot-1.png" }, store, fakeRenderer().render);
  assert.equal(header(res, "Cache-Control"), "no-store");
});

test("only images are ever served from a print, whatever the database says it is", async () => {
  const sneaky = { ...shot("image/png", PNG_SHOT_BYTES), mime: "text/html" } as unknown as Shot;
  const store = fakeStore({ [TOKEN]: row({}, sampleContent(2, { shots: [sneaky] })) });
  const res = await handleProgressAsset({ token: TOKEN, file: "shot-1.png" }, store, fakeRenderer().render);
  assert.equal(res.status, 404);
});

/* ---------- headers every answer carries ---------- */

test("every answer says nosniff and none of them ever sets a cookie", async () => {
  const content = sampleContent(2, { shots: [shot("image/jpeg", JPEG_BYTES)] });
  const store = fakeStore({ [TOKEN]: row({ status: "sent" }, content), "22222222-2222-4222-8222-222222222222": new Error("db down") });
  const { render } = fakeRenderer();
  const answers = [
    await handleProgressAsset({ token: TOKEN, file: "visual.png" }, store, render),
    await handleProgressAsset({ token: TOKEN, file: "shot-1.jpg" }, store, render),
    await handleProgressAsset({ token: TOKEN, file: "nope.png" }, store, render),
    await handleProgressAsset({ token: OTHER_TOKEN, file: "visual.png" }, store, render),
    await handleProgressAsset({ token: "bad", file: "visual.png" }, store, render),
    await handleProgressAsset({ token: "22222222-2222-4222-8222-222222222222", file: "visual.png" }, store, render),
  ];
  for (const res of answers) {
    assert.equal(header(res, "X-Content-Type-Options"), "nosniff");
    assert.equal(header(res, "Set-Cookie"), undefined);
    assert.equal(header(res, "X-Robots-Tag"), "noindex, nofollow");
  }
});

/* ---------- when something breaks ---------- */

test("a database failure is a plain 500 that tells nothing, and the log never holds the token", async () => {
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  try {
    const store = fakeStore({ [TOKEN]: new Error(`connection refused for share_token=eq.${TOKEN}`) });
    const res = await handleProgressAsset({ token: TOKEN, file: "visual.png" }, store, fakeRenderer().render);
    assert.equal(res.status, 500);
    assert.equal(header(res, "Cache-Control"), "no-store");
    assert.equal(new TextDecoder().decode(res.body ?? new Uint8Array()), '{"error":"internal_error"}');
  } finally {
    console.error = realError;
  }
  assert.ok(logged.length > 0);
  assert.ok(logged.every((line) => !line.includes(TOKEN)));
});

test("a drawing failure is a plain 500, never a half-sent picture", async () => {
  const realError = console.error;
  console.error = () => {};
  try {
    const store = fakeStore({ [TOKEN]: row({ status: "sent" }) });
    const res = await handleProgressAsset({ token: TOKEN, file: "visual.png" }, store, async () => {
      throw new Error("boom");
    });
    assert.equal(res.status, 500);
    assert.equal(header(res, "Cache-Control"), "no-store"); // an error must never be cached as if it were the picture
  } finally {
    console.error = realError;
  }
});

/* ---------- the database side: one query, by token ---------- */

function fakeClient(result: { data: unknown; error: { code?: string; message?: string } | null }) {
  const seen: unknown[][] = [];
  const client: AssetQueryClient = {
    from(table) {
      seen.push(["from", table]);
      return {
        select(columns) {
          seen.push(["select", columns]);
          return {
            eq(column, value) {
              seen.push(["eq", column, value]);
              return { maybeSingle: async () => result };
            },
          };
        },
      };
    },
  };
  return { client, seen };
}

test("the store reads one row of progress_reports by its share token", async () => {
  const found = row({ status: "sent" });
  const { client, seen } = fakeClient({ data: found, error: null });
  assert.deepEqual(await createAssetStore(client).findByToken(TOKEN), found);
  assert.deepEqual(seen, [
    ["from", "progress_reports"],
    ["select", "status, rev, content, overrides, pushed_at"],
    ["eq", "share_token", TOKEN],
  ]);
});

test("no row is null, and a database error is thrown without its message", async () => {
  assert.equal(await createAssetStore(fakeClient({ data: null, error: null }).client).findByToken(TOKEN), null);
  await assert.rejects(
    createAssetStore(fakeClient({ data: null, error: { code: "PGRST000", message: `secret ${TOKEN}` } }).client).findByToken(TOKEN),
    (error: Error) => error.message === "lookup failed (PGRST000)" && !error.message.includes(TOKEN)
  );
});

/* ---------- the whole way: real drawing through next/og ---------- */

test("with the real renderer the answer is a PNG of the promised size", async () => {
  const ImageResponse = loadImageResponse();
  const fonts = await loadVisualFonts();
  const content = sampleContent(3);
  const store = fakeStore({ [TOKEN]: row({ status: "sent" }, content) });
  const res = await handleProgressAsset({ token: TOKEN, file: "visual.png" }, store, (c) => renderVisualPng(c, { ImageResponse, fonts }));
  assert.equal(res.status, 200);
  const body = res.body as Uint8Array;
  assert.deepEqual([...body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  assert.deepEqual({ width: view.getUint32(16), height: view.getUint32(20) }, visualSize(content));
  assert.equal(header(res, "Content-Length"), String(body.byteLength));
});
