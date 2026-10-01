// Contingency tool: draws the picture "Claude por trás das entregas" from a report file, for when the
// screen is not ready. It renders exactly what the public link would (same module, same fonts).
//
//   node --experimental-strip-types scripts/progress/visual.ts --content resumo.json [--out imagem.png]
//
// `--content` is a ProgressContent as JSON. Without `--out` the PNG goes to .frontlights/progress/
// (ignored by git). It prints where the file went and its size, never what the report says.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { renderVisualPng, visualSize } from "../../src/lib/progress/visual.ts";
import { loadImageResponse, loadVisualFonts, readReportContent } from "../../src/lib/progress/visual-node.ts";

const USAGE = "Uso: node --experimental-strip-types scripts/progress/visual.ts --content <resumo.json> [--out <imagem.png>]";

async function main(): Promise<number> {
  let values: { content?: string; out?: string };
  try {
    values = parseArgs({ options: { content: { type: "string" }, out: { type: "string" } }, strict: true }).values;
  } catch {
    console.error(USAGE);
    return 2;
  }
  if (!values.content) {
    console.error(USAGE);
    return 2;
  }

  try {
    const content = await readReportContent(values.content);
    const png = await renderVisualPng(content, { ImageResponse: loadImageResponse(), fonts: await loadVisualFonts() });
    const out = resolve(values.out ?? ".frontlights/progress/visual.png");
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, png);
    const { width, height } = visualSize(content);
    console.log(`Imagem gravada em ${out} (${width}x${height}, ${Math.round(png.byteLength / 1024)} KB).`);
    return 0;
  } catch (error) {
    console.error(`Erro: ${error instanceof Error ? error.message : "falha ao desenhar a imagem."}`);
    return 1;
  }
}

process.exitCode = await main();
