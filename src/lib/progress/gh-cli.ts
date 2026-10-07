// The command behind `scripts/progress/github.ts`, with every outside thing (environment, network, files,
// clock, output) passed in so it can be exercised without touching any of them. Read-only on GitHub.
import { parseArgs } from "node:util";
import { BOARD_REPO } from "../board.ts";
import { ENTRY_STATUSES, STATUS_LABEL } from "../progress-report.ts";
import type { UsageModel } from "../progress-report.ts";
import { findCoverageGaps, messageTimesFromUsage } from "./gaps.ts";
import { GithubError, collectGithubData, createGithubClient } from "./gh-client.ts";
import { buildFacts, parseHideList, windowFromDates } from "./gh-facts.ts";

export const DEFAULT_FACTS_PATH = ".frontlights/progress/facts.json";
export const DEFAULT_HIDE_PATH = ".frontlights/progress/hide.json";

export type CliDeps = {
  env: Record<string, string | undefined>;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  now: () => Date;
  /** Reads a text file; null when it does not exist. */
  readText: (path: string) => string | null;
  /** Writes a text file, creating its folder. */
  writeText: (path: string, text: string) => void;
  log: (line: string) => void;
  error: (line: string) => void;
};

const USAGE = [
  "Uso: node --experimental-strip-types scripts/progress/github.ts --from AAAA-MM-DD --to AAAA-MM-DD [--messages usage.json] [--out arquivo.json]",
  "  --from, --to   dias de São Paulo; --to entra no período",
  "  --messages     JSON do coletor de uso, para calcular as lacunas de cobertura",
  `  --out          onde gravar os fatos (padrão: ${DEFAULT_FACTS_PATH})`,
].join("\n");

export async function runGithubCli(argv: string[], deps: CliDeps): Promise<number> {
  let values: { from?: string; to?: string; messages?: string; out?: string; help?: boolean };
  try {
    values = parseArgs({
      args: argv,
      options: { from: { type: "string" }, to: { type: "string" }, messages: { type: "string" }, out: { type: "string" }, help: { type: "boolean" } },
      strict: true,
    }).values;
  } catch {
    deps.error(`Opção desconhecida ou sem valor.\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    deps.log(USAGE);
    return 0;
  }
  const range = values.from && values.to ? windowFromDates(values.from, values.to) : null;
  if (!range) {
    deps.error(`Faltam --from e --to.\n${USAGE}`);
    return 2;
  }
  if (!range.ok) {
    deps.error(`${range.error}\n${USAGE}`);
    return 2;
  }
  const window = range.window;
  const out = values.out ?? DEFAULT_FACTS_PATH;

  try {
    const client = createGithubClient({ token: deps.env.GITHUB_TOKEN ?? "", fetch: deps.fetch });

    // The usage file is read first: a typo there should not cost a whole GitHub collection.
    let usage: Pick<UsageModel, "days"> | null = null;
    if (values.messages) {
      const text = deps.readText(values.messages);
      if (text === null) {
        deps.error(`Não encontrei o arquivo de uso em ${values.messages}.`);
        return 1;
      }
      try {
        usage = JSON.parse(text);
      } catch {
        usage = null;
      }
      if (!usage || !Array.isArray(usage.days)) {
        deps.error(`O arquivo ${values.messages} não parece o JSON do coletor de uso (falta a lista de dias).`);
        return 1;
      }
    }

    let hide = parseHideList(null);
    const hideText = deps.readText(DEFAULT_HIDE_PATH);
    if (hideText !== null) {
      try {
        hide = parseHideList(JSON.parse(hideText));
      } catch {
        deps.error(`Aviso: ${DEFAULT_HIDE_PATH} não é um JSON válido e foi ignorado.`);
      }
    }

    const author = await client.viewerLogin();
    const data = await collectGithubData(client, { repository: BOARD_REPO, window, author });
    const facts = buildFacts({ repository: BOARD_REPO, window, generatedAt: deps.now().toISOString(), hide, author, ...data });
    if (usage) facts.gaps = findCoverageGaps(facts.gitWork, messageTimesFromUsage(usage));

    deps.writeText(out, `${JSON.stringify(facts, null, 2)}\n`);

    const count = (s: string) => facts.entries.filter((e) => e.status === s && !e.hidden).length;
    deps.log(`Fatos do GitHub (GeoCloud) de ${values.from} a ${values.to}, horário de São Paulo.`);
    deps.log(`Entradas visíveis: ${facts.entries.filter((e) => !e.hidden).length} (${ENTRY_STATUSES.map((s) => `${STATUS_LABEL[s]} ${count(s)}`).join(", ")}).`);
    deps.log(`Ocultas por sugestão: ${facts.entries.filter((e) => e.hidden).length}. Internos: ${facts.internal.count}.`);
    if (facts.ignored.cut > 0) {
      deps.log(`Atenção: ${facts.ignored.cut} issue${facts.ignored.cut > 1 ? "s" : ""} com sub-issues não lidas por inteiro (árvore funda ou grande demais, ou sub-issues de outro repositório): a contagem de partes pode estar abaixo do real.`);
    }
    deps.log(facts.gaps ? `Lacunas de cobertura: ${facts.gaps.length}.` : "Sem --messages: as lacunas de cobertura não foram calculadas.");
    deps.log(`Gravado em ${out}.`);
    return 0;
  } catch (e) {
    // A GithubError is already a safe, Portuguese sentence; anything else is reported by name only.
    deps.error(e instanceof GithubError ? e.message : `Erro inesperado (${e instanceof Error ? e.name : "desconhecido"}) ao montar os fatos do GitHub.`);
    return 1;
  }
}
