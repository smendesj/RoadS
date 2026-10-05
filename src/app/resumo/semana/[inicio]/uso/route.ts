import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getViewerOrReset } from "@/lib/get-viewer";
import { combineWeek } from "@/lib/progress/week";
import { VISUAL_FONT_FAMILY, VISUAL_FONT_FILES, renderVisualPng, type VisualFont } from "@/lib/progress/visual";
import { loadWeek, weekProduct, weekStartParam } from "../../../data";

// GET /resumo/semana/<monday>/uso: the picture of Claude's usage across the whole week, for the week's
// presentation. Unlike the e-mail's picture this one is NOT public: it is drawn for a signed-in admin or scrum
// master, from the reports their own session can read (sent ones only). Anyone else gets the same 404.

export const runtime = "nodejs";

// Same loader as the public image route (src/app/api/progress-report/[token]/[v]/[file]/route.ts): a literal
// path under process.cwd() is what the build's file tracing recognises, so the fonts ship with this function.
const FONT_DIR = join(process.cwd(), "src/lib/progress/fonts");
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
    fontsOnce = null;
    throw error;
  });
  return fontsOnce;
}

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ inicio: string }> }) {
  const viewer = await getViewerOrReset();
  if (!viewer || (viewer.role !== "admin" && viewer.role !== "scrum_master")) return notFound();
  const start = weekStartParam((await params).inicio);
  const produto = weekProduct(new URL(request.url).searchParams.get("produto") ?? undefined);
  if (!start || !produto) return notFound();
  const { rows, failed } = await loadWeek(start, produto);
  if (failed) return new Response(null, { status: 500, headers: { "Cache-Control": "no-store" } });
  if (rows.length === 0) return notFound();
  const png = await renderVisualPng(combineWeek(rows).content, { ImageResponse, fonts: await loadFonts() });
  // Private to this browser; the page puts the week's latest push in the address (?v=), so a new report of the
  // week asks for a new picture and an hour of cache never shows a stale one.
  return new Response(png, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
