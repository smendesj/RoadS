// What the public image link answers. The e-mail client of the CEO fetches these URLs with no cookies
// and no session, so the only credential is the unguessable share token in the path. A pure module with
// the database and the drawing injected: the route wires in the admin client and `next/og`, the tests
// wire in fakes.
//
//   /api/progress-report/<token>/<version>/visual.png   the "Claude por trás das entregas" picture
//   /api/progress-report/<token>/<version>/shot-<n>.jpg|png   print number n (counted from 1)
//
// The <version> segment only changes the URL when the draft is pushed again, so a client never shows a
// stale copy; it is not read here. Every way of not getting an image is the same 404, byte for byte, so
// the link cannot be used to learn which tokens exist.
import { isShareToken } from "../progress-report.ts";
import type { ProgressContent, ProgressReportRow } from "../progress-report.ts";
import { resolveContent } from "./resolve.ts";
import { SHOT_PATH } from "./draft.ts";
import { PROGRESS_SHOTS_BUCKET } from "./shot-store.ts";

export type AssetRequest = { token: string; file: string };
export type AssetResponse = { status: number; headers: Record<string, string>; body: Uint8Array<ArrayBuffer> | null };

/** The slice of a report row the public link needs; any product's report answers. */
export type AssetReport = Pick<ProgressReportRow, "status" | "rev" | "content" | "overrides" | "pushed_at">;
export type AssetStore = {
  findByToken(token: string): Promise<AssetReport | null>;
  /** The bytes of a print kept in the private storage bucket, or null when it is not there. */
  readShot(path: string): Promise<Uint8Array<ArrayBuffer> | null>;
};
export type VisualRenderer = (content: ProgressContent) => Promise<Uint8Array<ArrayBuffer>>;

/** A sent report is frozen, so its images never change; a draft changes with every push. */
const IMMUTABLE = "public, max-age=31536000, immutable";
const NO_STORE = "no-store";
// Set on every answer. Never a Set-Cookie: nothing here may identify a visitor.
const ALWAYS = { "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" } as const;
const SHOT_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png"]);

function notFound(): AssetResponse {
  return { status: 404, headers: { "Cache-Control": NO_STORE, ...ALWAYS }, body: null };
}

function failed(token: string, what: string, error: unknown): AssetResponse {
  // The link is a credential: scrub it from whatever the database or the renderer said before logging.
  const said = error instanceof Error ? error.message : String(error);
  console.error(`progress asset ${what} failed`, said.split(token).join("[token]"));
  const body = new TextEncoder().encode('{"error":"internal_error"}');
  return {
    status: 500,
    headers: { "Content-Type": "application/json", "Content-Length": String(body.byteLength), "Cache-Control": NO_STORE, ...ALWAYS },
    body,
  };
}

function image(type: string, body: Uint8Array<ArrayBuffer>, cache: string): AssetResponse {
  return { status: 200, headers: { "Content-Type": type, "Content-Length": String(body.byteLength), "Cache-Control": cache, ...ALWAYS }, body };
}

function decodeBase64(data: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

type Target = { kind: "visual" } | { kind: "shot"; n: number };

function targetOf(file: string): Target | null {
  if (file === "visual.png") return { kind: "visual" };
  const shot = /^shot-([1-9][0-9]?)\.(?:jpg|png)$/.exec(file);
  return shot ? { kind: "shot", n: Number(shot[1]) } : null;
}

export async function handleProgressAsset(request: AssetRequest, store: AssetStore, render: VisualRenderer): Promise<AssetResponse> {
  const { token, file } = request;
  // Nothing that is not shaped like a token, or not a file we serve, ever reaches the database.
  if (!isShareToken(token)) return notFound();
  const target = targetOf(file);
  if (!target) return notFound();

  let report: AssetReport | null;
  try {
    report = await store.findByToken(token);
  } catch (error) {
    return failed(token, "lookup", error);
  }
  if (!report) return notFound();
  const cache = report.status === "sent" ? IMMUTABLE : NO_STORE;

  if (target.kind === "shot") {
    const shot = report.content?.shots?.[target.n - 1];
    // The stored type is data, not trusted: only the two image types are ever sent back.
    if (!shot || !SHOT_TYPES.has(shot.mime)) return notFound();
    if (shot.path !== undefined) {
      // The stored path is data too: only a print's own name (a hash) is ever looked up in the bucket.
      if (typeof shot.path !== "string" || !SHOT_PATH.test(shot.path)) return notFound();
      let stored: Uint8Array<ArrayBuffer> | null;
      try {
        stored = await store.readShot(shot.path);
      } catch (error) {
        return failed(token, "print", error);
      }
      return stored ? image(shot.mime, stored, cache) : notFound();
    }
    const bytes = typeof shot.data === "string" ? decodeBase64(shot.data) : null;
    return bytes ? image(shot.mime, bytes, cache) : notFound();
  }

  try {
    const png = await render(resolveContent({ content: report.content, overrides: report.overrides ?? {} }));
    return image("image/png", png, cache);
  } catch (error) {
    return failed(token, "render", error);
  }
}

/* ---------- the database side ---------- */

/**
 * The few calls of the Supabase client the lookup uses, so it can be tested with a plain fake and so the
 * route hands over its admin client (service role: this table has no policy for anonymous readers).
 */
export type AssetQueryClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
      };
    };
  };
  storage: {
    from(bucket: string): {
      download(path: string): PromiseLike<{ data: Blob | null; error: { message?: string; statusCode?: string } | null }>;
    };
  };
};

export function createAssetStore(client: AssetQueryClient): AssetStore {
  return {
    async findByToken(token) {
      const { data, error } = await client
        .from("progress_reports")
        .select("status, rev, content, overrides, pushed_at")
        .eq("share_token", token)
        .maybeSingle();
      // Only the code travels in the error: the database's own message could repeat the filter value.
      if (error) throw new Error(`lookup failed (${error.code ?? "unknown"})`);
      return data && typeof data === "object" ? (data as AssetReport) : null;
    },
    async readShot(path) {
      const { data, error } = await client.storage.from(PROGRESS_SHOTS_BUCKET).download(path);
      // A print that is not in the bucket answers "not found"; anything else is a failure worth a 500.
      if (error) {
        // Only the object being absent is a 404. Storage answers statusCode "404" for a missing bucket too
        // ("Bucket not found"): that one is a failure to log, so the message is what tells them apart.
        if (/^object not found$/i.test(error.message ?? "")) return null;
        throw new Error("print download failed");
      }
      return data ? new Uint8Array(await data.arrayBuffer()) : null;
    },
  };
}
