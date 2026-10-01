import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { VISUAL_FONT_FAMILY, VISUAL_FONT_FILES, renderVisualPng, type VisualFont } from "@/lib/progress/visual";
import { createAssetStore, handleProgressAsset, type AssetQueryClient, type AssetStore } from "@/lib/progress/visual-handler";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/progress-report/<token>/<version>/visual.png | shot-<n>.jpg|png
//
// PUBLIC on purpose: the CEO's e-mail client fetches these links with no session, so the unguessable
// share token in the path is the only credential. src/proxy.ts leaves /api alone (its matcher skips it)
// and this handler never reads or sets a cookie. Every rule lives in visual-handler.ts; this file only
// wires the real database and `next/og` into it.

// Fonts are read from disk and `next/og` loads two wasm files: Node, not the edge.
export const runtime = "nodejs";

// A literal path under process.cwd() is what the build's file tracing recognises, so the fonts are
// shipped with the function (see handover-T4 for how to double-check the trace after a build).
const FONT_DIR = join(process.cwd(), "src/lib/progress/fonts");

// Read on the first drawing, not at import: a 404 for a made-up token must not depend on the fonts.
let fontsOnce: Promise<VisualFont[]> | null = null;
function loadFonts(): Promise<VisualFont[]> {
  fontsOnce ??= Promise.all(
    VISUAL_FONT_FILES.map(async ({ weight }) => ({
      name: VISUAL_FONT_FAMILY,
      weight,
      style: "normal" as const,
      data: new Uint8Array(await readFile(join(FONT_DIR, `inter-latin-${weight}-normal.woff`))).buffer,
    }))
  ).catch((error) => {
    fontsOnce = null; // do not cache a failure
    throw error;
  });
  return fontsOnce;
}

// The admin client is created per lookup, so requests that never reach the database (malformed token,
// unknown file) do not need SUPABASE_SECRET_KEY at all. The cast is only for the compiler: the client's
// generics make it give up (TS2589) when matching the three calls of AssetQueryClient, a shape the
// handler tests pin down.
const store: AssetStore = {
  findByToken: (token) => createAssetStore(createAdminClient() as unknown as AssetQueryClient).findByToken(token),
};

export async function GET(_request: Request, { params }: { params: Promise<{ token: string; v: string; file: string }> }) {
  // `v` only makes the URL change when the draft is pushed again, so no client keeps a stale copy: ignored.
  const { token, file } = await params;
  const result = await handleProgressAsset({ token, file }, store, async (content) =>
    renderVisualPng(content, { ImageResponse, fonts: await loadFonts() })
  );
  return new Response(result.body, { status: result.status, headers: result.headers });
}
