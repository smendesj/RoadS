// Node-only helpers shared by the tests and the command-line tools: the fonts read from disk, `next/og`
// taken from the project's own node_modules, and a report file read from disk. The Next route does NOT
// use these: it reads the fonts with a literal path under process.cwd(), which is what the build's
// file tracing recognises and ships. (`next/og` has no package "exports", so Node's ESM loader cannot
// import it by name; `createRequire` can.)
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { ProgressContent } from "../progress-report.ts";
import { VISUAL_FONT_FAMILY, VISUAL_FONT_FILES } from "./visual.ts";
import type { ImageResponseConstructor, VisualFont } from "./visual.ts";

const FONTS_DIR = new URL("./fonts/", import.meta.url);

export async function loadVisualFonts(): Promise<VisualFont[]> {
  return Promise.all(
    VISUAL_FONT_FILES.map(async ({ weight, file }) => ({
      name: VISUAL_FONT_FAMILY,
      weight,
      style: "normal" as const,
      data: new Uint8Array(await readFile(new URL(file, FONTS_DIR))).buffer,
    }))
  );
}

export function loadImageResponse(): ImageResponseConstructor {
  const require = createRequire(import.meta.url);
  return (require("next/og") as { ImageResponse: ImageResponseConstructor }).ImageResponse;
}

/**
 * Reads a report (a `ProgressContent` as JSON) for the command-line tools. Errors are short Portuguese
 * messages that never repeat what the file holds.
 */
export async function readReportContent(path: string): Promise<ProgressContent> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`Não foi possível ler o arquivo "${path}".`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`O arquivo "${path}" não é um JSON válido.`);
  }
  const content = json as Partial<ProgressContent> | null;
  const missing = ["window", "entries", "usage"].filter((key) => !content || typeof content !== "object" || !(key in content));
  if (missing.length > 0) throw new Error(`O arquivo "${path}" não parece um resumo (faltam: ${missing.join(", ")}).`);
  return content as ProgressContent;
}
