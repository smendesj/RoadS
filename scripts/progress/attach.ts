// Adds prints to a Resumo that was already SENT, so the week can be presented with them.
//
//   node --experimental-strip-types scripts/progress/attach.ts --report <id> --shots-dir <pasta>
//        [--endpoint https://.../api/frontlights] [--dry-run]
//
// The folder holds the prints and a captions.json listing [{ file, caption, issue? }], like the push's. A print
// names the delivery it shows (`issue`), or none: a general print, which the e-mail and the week place at the
// end (a plan for the week, say). Each print is uploaded on its own (the same door the push uses), then the
// report receives the list. Only prints are added: the text, the numbers and the prints the report already had
// stay as they were, and a print already there is skipped, so the run can be repeated.
//
// The secret comes only from FRONTLIGHTS_API_SECRET (.env.local is loaded when it exists). Nothing printed
// ever contains the secret: only counts, the HTTP status and the names of the files.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isUuid } from "../../src/lib/progress/report-view.ts";
import { configuredEndpoint, dirShots, loadShots, uploadShots, type PushDeps } from "./push.ts";

const USAGE = [
  "Uso: node --experimental-strip-types scripts/progress/attach.ts --report <id> --shots-dir <pasta> [opções]",
  "  --report <id>         o id do resumo já enviado (o endereço /resumo/<id> mostra)",
  "  --shots-dir <pasta>   pasta dos prints, com captions.json listando arquivo, legenda e, se houver, a entrega (issue); sem issue, o print é geral",
  "  --endpoint <url>      base da API (padrão: roadmapSync.endpoint de .frontlights/config.json)",
  "  --dry-run             só confere a pasta e os prints; não envia nada",
];

type Args = { report: string; shotsDir: string; endpoint: string | null; dryRun: boolean };

function parseArgs(argv: string[]): Args | null {
  const args: Args = { report: "", shotsDir: "", endpoint: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (!["--report", "--shots-dir", "--endpoint"].includes(flag)) return null;
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) return null;
    if (flag === "--report") args.report = value;
    else if (flag === "--shots-dir") args.shotsDir = value;
    else args.endpoint = value;
  }
  return args.report && args.shotsDir ? args : null;
}

/** Runs the command line; returns the exit code (0 done or valid, 1 refused or failed, 2 wrong command line). */
export async function runAttach(argv: string[], deps: PushDeps): Promise<number> {
  const fail = (line: string) => {
    deps.print(line, "err");
    return 1;
  };
  const args = parseArgs(argv);
  if (!args) {
    for (const line of USAGE) deps.print(line, "err");
    return 2;
  }
  if (!isUuid(args.report)) return fail("O --report precisa ser o id do resumo (o que aparece no endereço /resumo/<id>).");

  const listed = dirShots(args.shotsDir, deps);
  if (typeof listed === "string") return fail(listed);
  if (listed.length === 0) return fail("Nenhum print listado: a pasta precisa de um captions.json com os prints a acrescentar.");
  const loaded = await loadShots({ shots: listed, badIssue: null }, deps);
  if (typeof loaded === "string") return fail(loaded);

  if (args.dryRun) {
    deps.print("Simulação: a pasta está válida e nada foi enviado.");
    deps.print(`Resumo: ${args.report}`);
    deps.print(`Prints: ${loaded.length} (${[...new Set(loaded.map((s) => (s.shot.issue === undefined ? "geral" : `#${s.shot.issue}`)))].join(", ")})`);
    return 0;
  }

  const secret = deps.env.FRONTLIGHTS_API_SECRET;
  if (!secret) return fail("Falta FRONTLIGHTS_API_SECRET no ambiente (o .env.local do RoadS tem esse valor).");
  const base = args.endpoint ?? configuredEndpoint(deps.readConfig());
  if (!base) return fail("Sem endereço: informe --endpoint <url base> ou configure roadmapSync.endpoint em .frontlights/config.json.");
  const root = base.replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json", "user-agent": "roads-script/attach" };

  const upload = await uploadShots(root, headers, loaded, deps);
  if (upload) return fail(`${upload} Nada foi acrescentado ao resumo.`);

  let response: Response;
  try {
    response = await deps.fetch(`${root}/progress-report/${args.report}/shots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ shots: loaded.map(({ shot }) => ({ caption: shot.caption, mime: shot.mime, issue: shot.issue, path: shot.path })) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return fail("Não consegui falar com o servidor (confira a internet e o endereço). Nada foi confirmado.");
  }
  const answer = (await response.json().catch(() => null)) as { added?: unknown; existing?: unknown; error?: unknown } | null;
  const status = `HTTP ${response.status}`;
  if (response.status === 200) {
    deps.print(`Prints acrescentados: ${Number(answer?.added) || 0}; já existiam: ${Number(answer?.existing) || 0} (${status}).`);
    return 0;
  }
  if (response.status === 401) return fail(`O servidor recusou o segredo (${status}). Confira FRONTLIGHTS_API_SECRET.`);
  if (response.status === 404) return fail(`Esse resumo não existe (${status}). Confira o --report.`);
  if (response.status === 409) {
    return answer?.error === "not_sent"
      ? fail(`Esse resumo ainda é um rascunho: ele não foi enviado (${status}). Os prints de um rascunho vão pelo push.`)
      : fail(`O resumo mudou enquanto os prints eram acrescentados (${status}). Rode de novo.`);
  }
  if (response.status === 400) {
    const why = typeof answer?.error === "string" && answer.error.length <= 300 ? answer.error.replace(/[\u0000-\u001F]/g, " ") : "motivo não informado";
    return fail(`O servidor recusou os prints (${status}): ${why}`);
  }
  return fail(`O servidor respondeu ${status}. Tente de novo em instantes; se continuar, veja os logs do RoadS.`);
}

// Run as a command (not when a test imports it).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  process.exitCode = await runAttach(process.argv.slice(2), {
    env: process.env,
    readFile: (path) => readFileSync(path),
    readConfig: () => {
      try {
        return JSON.parse(readFileSync(".frontlights/config.json", "utf8"));
      } catch {
        return null;
      }
    },
    fetch,
    print: (line, stream) => (stream === "err" ? console.error(line) : console.log(line)),
  });
}
