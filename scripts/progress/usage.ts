// Collector of Claude usage for "Resumo para a diretoria".
//
//   node --experimental-strip-types scripts/progress/usage.ts --from 2026-09-28 --to 2026-09-30
//
// Reads the local transcripts (READ ONLY, ~/.claude/projects/**/*.jsonl) and writes, in
// .frontlights/progress/ (git-ignored): usage.json (a UsageModel), activity.json (the minutes with a
// message, for the coverage-gap detector) and scope-review.json (every session seen, with the numbers
// behind the scope decision). Only counts, instants, ids, model names and working-directory roots are
// kept: never a prompt, an answer, code or a file path. Prints the "conferência" table to check the
// numbers and the sessions the scope rule was not sure about.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CountMethod } from "../../src/lib/progress-report.ts";
import { buildUsage, cleanLabel } from "../../src/lib/progress/usage-aggregate.ts";
import { formatUsageReport } from "../../src/lib/progress/usage-report.ts";
import { GEOCLOUD_RULE, mergeOverrides, readOverrides, readProducts } from "../../src/lib/progress/usage-scope.ts";
import { readUsageEvents } from "../../src/lib/progress/usage-source.ts";
import type { ReadStats } from "../../src/lib/progress/usage-source.ts";

const DAY_MS = 86_400_000;

const HELP = `Uso do Claude para o resumo da diretoria (GeoCloud por padrão; vários projetos conectados via scope.json).

  node --experimental-strip-types scripts/progress/usage.ts --from AAAA-MM-DD --to AAAA-MM-DD [opções]

  --from, --to      primeiro e último dia (São Paulo), os dois incluídos
  --method          real (padrão: cada resposta da API uma vez) ou stats (como o painel /stats)
  --include id      força uma sessão para dentro do escopo (8 primeiros caracteres do id; repetível)
  --exclude id      força uma sessão para fora do escopo (repetível)
  --note "AAAA-MM-DD=texto"   nota de cobertura do dia (repetível)
  --label "texto"   título da imagem de uso (até 60 caracteres); também vale usageLabel em config.json
  --root pasta      pasta .claude (padrão: a do seu usuário; o script só lê projects/)
  --out pasta       onde gravar (padrão: .frontlights/progress)

Decisões de escopo, notas e o título também podem ficar em scope.json, notes.json e config.json na pasta de saída.
scope.json também aceita "products": [{ "name": "...", "roots": ["C:/pasta"] }, ...] (até 8): o uso de todos eles é somado.`;

class CliError extends Error {}

const VALUE_FLAGS = new Set(["from", "to", "method", "include", "exclude", "note", "label", "root", "out"]);

/** Errors of the person's own input (a file they wrote, an id they typed) stop the run with code 2. */
function asCliError<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : "valor inválido");
  }
}

function parseArgs(argv: string[]): Map<string, string[]> {
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new CliError(`argumento inesperado: ${arg}`);
    const name = arg.slice(2);
    if (name === "help") {
      flags.set("help", []);
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new CliError(`opção desconhecida: --${name}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new CliError(`--${name} precisa de um valor`);
    flags.set(name, [...(flags.get(name) ?? []), value]);
    i++;
  }
  return flags;
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new CliError(`não consegui ler ${path.basename(file)} (JSON inválido)`);
  }
}

function readNotes(file: string): { date: string; text: string }[] {
  if (!existsSync(file)) return [];
  const raw = readJsonFile(file);
  const valid = Array.isArray(raw) && raw.every((n) => n && typeof n === "object" && typeof n.date === "string" && typeof n.text === "string");
  if (!valid) throw new CliError('notes.json deve ser uma lista de { "date": "AAAA-MM-DD", "text": "..." }');
  return (raw as { date: string; text: string }[]).map((n) => ({ date: n.date, text: n.text }));
}

function readConfigLabel(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  const raw = readJsonFile(file);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CliError("config.json deve ser um objeto");
  const label = (raw as { usageLabel?: unknown }).usageLabel;
  if (label !== undefined && typeof label !== "string") throw new CliError("config.json: usageLabel deve ser um texto");
  return label;
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    console.log(HELP);
    return;
  }
  const one = (name: string): string | undefined => flags.get(name)?.[flags.get(name)!.length - 1];
  const from = one("from");
  const to = one("to");
  if (!from) throw new CliError("--from é obrigatório (AAAA-MM-DD)");
  if (!to) throw new CliError("--to é obrigatório (AAAA-MM-DD)");
  const method = (one("method") ?? "real") as CountMethod;
  if (method !== "real" && method !== "stats") throw new CliError("--method deve ser real ou stats");

  const cliNotes = (flags.get("note") ?? []).map((raw) => {
    const match = /^(\d{4}-\d{2}-\d{2})=([\s\S]+)$/.exec(raw);
    if (!match) throw new CliError('--note deve ter a forma "AAAA-MM-DD=texto"');
    return { date: match[1], text: match[2].trim() };
  });

  const claudeDir = path.resolve(one("root") ?? path.join(os.homedir(), ".claude"));
  const projectsDir = path.join(claudeDir, "projects");
  if (!existsSync(projectsDir)) throw new CliError(`não encontrei a pasta projects em ${claudeDir}; use --root para apontar a pasta .claude`);
  const outDir = path.resolve(one("out") ?? path.join(".frontlights", "progress"));

  const scopeFile = path.join(outDir, "scope.json");
  const scopeRaw = existsSync(scopeFile) ? readJsonFile(scopeFile) : undefined;
  const fromFile = scopeRaw === undefined ? { include: [], exclude: [] } : asCliError(() => readOverrides(scopeRaw));
  // Without "products" the scope is GeoCloud alone, as before.
  const products = (scopeRaw === undefined ? undefined : asCliError(() => readProducts(scopeRaw))) ?? [GEOCLOUD_RULE];
  const fromCli = asCliError(() => readOverrides({ include: flags.get("include") ?? [], exclude: flags.get("exclude") ?? [] }));
  // The title is set by the person, never written in the code: the option wins, config.json is the fallback.
  const label = cleanLabel(one("label")) ?? cleanLabel(readConfigLabel(path.join(outDir, "config.json")));

  // Validate the dates before reading anything big: an unknown day is the most likely typo.
  const windowStart = Date.parse(`${from}T00:00:00-03:00`);
  if (Number.isNaN(windowStart)) throw new CliError(`--from: data inválida («${from}»); use AAAA-MM-DD`);

  const stats: ReadStats = { read: 0, skipped: 0, unreadable: 0 };
  const events = readUsageEvents(projectsDir, { modifiedSince: windowStart - 2 * DAY_MS, repos: [...new Set(products.flatMap((p) => p.repos))] }, stats);
  let result;
  try {
    result = buildUsage(events, {
      from,
      to,
      method,
      scope: mergeOverrides(fromFile, fromCli),
      products,
      notes: [...readNotes(path.join(outDir, "notes.json")), ...cliNotes],
      label,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("--")) throw new CliError(error.message);
    throw error;
  }

  mkdirSync(outDir, { recursive: true });
  const files = {
    usage: path.join(outDir, "usage.json"),
    activity: path.join(outDir, "activity.json"),
    review: path.join(outDir, "scope-review.json"),
  };
  writeFileSync(files.usage, `${JSON.stringify(result.usage, null, 2)}\n`);
  writeFileSync(files.activity, `${JSON.stringify(result.activity)}\n`);
  writeFileSync(
    files.review,
    `${JSON.stringify({ generatedAt: result.usage.generatedAt, window: result.usage.window, method, borderline: result.borderline, sessions: result.sessions }, null, 2)}\n`
  );

  console.log(formatUsageReport(result).join("\n"));
  console.log("");
  console.log(`Arquivos de histórico lidos: ${stats.read} (ignorados: ${stats.skipped}${stats.unreadable ? `; sem permissão de leitura: ${stats.unreadable}` : ""}).`);
  console.log("Gravado:");
  for (const file of Object.values(files)) console.log(`  ${file}`);
}

try {
  main();
} catch (error) {
  if (error instanceof CliError) {
    console.error(`erro: ${error.message}`);
    console.error("use --help para ver as opções.");
    process.exitCode = 2;
  } else {
    console.error(`erro inesperado: ${error instanceof Error ? error.message : "falha desconhecida"}`);
    process.exitCode = 1;
  }
}
