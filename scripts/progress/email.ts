// Contingency tool: builds the e-mail HTML from a report file, for when the screen is not ready.
//
//   node --experimental-strip-types scripts/progress/email.ts --content resumo.json [--out email.html] [--confirm]
//
// It first prints the conferência table (the numbers to check against what the person remembers) and
// writes nothing until it is run again with --confirm. Pictures are embedded as data URIs so the file
// opens anywhere: open it in a browser, select all, copy and paste into a new Outlook message.
// Without `--out` the file goes to .frontlights/progress/ (ignored by git).
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PRODUCTION_ORIGIN } from "../../src/lib/progress-report.ts";
import { clockSP, conferenceRows, sessionSpan, type ConferenceLine } from "../../src/lib/progress/conference.ts";
import { buildEmail, emailSubject } from "../../src/lib/progress/email.ts";
import { compactCount, renderVisualPng } from "../../src/lib/progress/visual.ts";
import { loadImageResponse, loadVisualFonts, readReportContent } from "../../src/lib/progress/visual-node.ts";

const USAGE = "Uso: node --experimental-strip-types scripts/progress/email.ts --content <resumo.json> [--out <email.html>] [--confirm]";

const cell = (text: string, width: number) => text.padEnd(width);

/** The table as plain text: one line per day, then the coverage warnings. */
function printConference(rows: ConferenceLine[]) {
  console.log("Conferência dos números (horário de São Paulo)");
  console.log("");
  console.log(`${cell("Dia", 7)}${cell("Sessões", 36)}${cell("Primeiro–último pedido", 24)}${cell("Mensagens", 11)}Tokens`);
  for (const row of rows) {
    if (row.warning) {
      console.log(`! ${row.note ?? ""}`);
      continue;
    }
    const day = `${row.date.slice(8, 10)}/${row.date.slice(5, 7)}`;
    const sessions = row.sessions.length > 0 ? row.sessions.map(sessionSpan).join(" ") : "sem sessão";
    const prompts = row.firstPromptAt && row.lastPromptAt ? `${clockSP(row.firstPromptAt)}–${clockSP(row.lastPromptAt)}` : "–";
    console.log(`${cell(day, 7)}${cell(sessions, 36)}${cell(prompts, 24)}${cell(String(row.messages), 11)}${compactCount(row.tokens)}`);
    if (row.note) console.log(`       ${row.note}`);
  }
  console.log("");
}

const dataUri = (mime: string, base64: string) => `data:${mime};base64,${base64}`;

async function main(): Promise<number> {
  let values: { content?: string; out?: string; confirm?: boolean };
  try {
    values = parseArgs({ options: { content: { type: "string" }, out: { type: "string" }, confirm: { type: "boolean" } }, strict: true }).values;
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
    printConference(conferenceRows(content.usage, content.gaps ?? []));
    if (!values.confirm) {
      console.log("Nada foi gravado. Confira a tabela acima e rode de novo com --confirm para gerar o e-mail.");
      return 0;
    }

    const png = await renderVisualPng(content, { ImageResponse: loadImageResponse(), fonts: await loadVisualFonts() });
    const shots = (content.shots ?? []).slice(0, 2);
    const { html } = buildEmail(content, {
      visualUrl: dataUri("image/png", Buffer.from(png).toString("base64")),
      shotUrls: shots.map((shot) => dataUri(shot.mime, shot.data)),
      roadsUrl: `${PRODUCTION_ORIGIN}/resumo`,
    });
    const out = resolve(values.out ?? ".frontlights/progress/email.html");
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, html, "utf8");
    console.log(`E-mail gravado em ${out}.`);
    console.log(`Assunto: ${emailSubject(content)}`);
    console.log("Abra o arquivo no navegador, selecione tudo (Ctrl+A), copie (Ctrl+C) e cole numa mensagem nova do Outlook.");
    return 0;
  } catch (error) {
    console.error(`Erro: ${error instanceof Error ? error.message : "falha ao montar o e-mail."}`);
    return 1;
  }
}

process.exitCode = await main();
