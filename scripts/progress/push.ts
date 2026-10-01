// Pushes the draft of "Resumo para a diretoria" to RoadS: the last step of the Frontlights flow, after the
// collectors (Claude usage, GitHub facts) and the plain-language text written by Claude are in one JSON file.
//
//   node --experimental-strip-types scripts/progress/push.ts --draft .frontlights/progress/draft.json
//        [--produto GeoCloud] [--shot print.jpg --caption "Tela de exemplo"]... (at most 10)
//        [--endpoint https://.../api/frontlights] [--dry-run]
//
// The secret comes only from FRONTLIGHTS_API_SECRET (.env.local is loaded when it exists). Nothing printed
// ever contains the secret or the text of the draft: only counts, dates, the HTTP status and the report id.
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_PAYLOAD_BYTES, MAX_SHOTS, MAX_SHOT_BYTES, parseDraft } from "../../src/lib/progress/draft.ts";
import type { ProgressContent, Shot } from "../../src/lib/progress-report.ts";

/** Everything the script touches in the world, so a test can hand it a fake one. */
export type PushDeps = {
  env: Record<string, string | undefined>;
  readFile: (path: string) => Buffer;
  /** The parsed .frontlights/config.json, or null when there is none. */
  readConfig: () => unknown;
  fetch: typeof fetch;
  print: (line: string, stream?: "err") => void;
};

const USAGE = [
  "Uso: node --experimental-strip-types scripts/progress/push.ts --draft <arquivo.json> [opções]",
  "  --draft <arquivo>     o rascunho (um ProgressContent em JSON)",
  "  --produto <nome>      padrão: GeoCloud",
  '  --shot <imagem>       um print JPEG ou PNG de até 256 KB; repita para cada print (no máximo 10)',
  '  --caption "<texto>"   a legenda do print que vem logo antes',
  "  --endpoint <url>      base da API (padrão: roadmapSync.endpoint de .frontlights/config.json)",
  "  --dry-run             só valida e mostra um resumo; não envia nada",
];

type Args = { draft: string; produto: string; shots: { file: string; caption: string | null }[]; endpoint: string | null; dryRun: boolean };

/** null when the command line itself is wrong (unknown option, option without its value, no --draft). */
function parseArgs(argv: string[]): Args | null {
  const args: Args = { draft: "", produto: "GeoCloud", shots: [], endpoint: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (!["--draft", "--produto", "--shot", "--caption", "--endpoint"].includes(flag)) return null;
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) return null;
    if (flag === "--draft") args.draft = value;
    else if (flag === "--produto") args.produto = value;
    else if (flag === "--endpoint") args.endpoint = value;
    else if (flag === "--shot") args.shots.push({ file: value, caption: null });
    else {
      // A caption belongs to the print right before it.
      const last = args.shots[args.shots.length - 1];
      if (!last || last.caption !== null) args.shots.push({ file: "", caption: value });
      else last.caption = value;
    }
  }
  return args.draft ? args : null;
}

const kb = (bytes: number) => Math.ceil(bytes / 1024);

function imageType(bytes: Buffer): Shot["mime"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((byte, i) => bytes[i] === byte)) return "image/png";
  return null;
}

/** The prints named on the command line as contract Shots, or the sentence that says what is wrong with them. */
function loadShots(args: Args, deps: PushDeps): Shot[] | string {
  if (args.shots.length > MAX_SHOTS) return `São aceitos no máximo ${MAX_SHOTS} prints (--shot).`;
  const shots: Shot[] = [];
  for (const [i, { file, caption }] of args.shots.entries()) {
    if (!file) return "Uma legenda (--caption) veio sem o print (--shot) a que pertence.";
    const name = basename(file);
    if (caption === null) return `O print «${name}» precisa de uma legenda: acrescente --caption "<texto>" logo depois dele.`;
    let bytes: Buffer;
    try {
      bytes = deps.readFile(file);
    } catch {
      return `Não consegui ler o print «${name}».`;
    }
    const mime = imageType(bytes);
    if (!mime) return `O print «${name}» precisa ser uma imagem JPEG ou PNG.`;
    if (bytes.length > MAX_SHOT_BYTES) {
      return `O print «${name}» tem ${kb(bytes.length)} KB e o limite é ${kb(MAX_SHOT_BYTES)} KB. Reduza a imagem (por exemplo, 1280 px de largura em JPEG) e tente de novo.`;
    }
    shots.push({ id: `shot-${i + 1}`, caption, mime, data: bytes.toString("base64") });
  }
  return shots;
}

function summary(produto: string, content: ProgressContent, payloadBytes: number): string[] {
  const hidden = content.entries.filter((e) => e.hidden).length;
  const sessions = content.usage.days.reduce((total, d) => total + d.sessions.length, 0);
  return [
    "Simulação: o rascunho está válido e nada foi enviado.",
    `Produto: ${produto}`,
    `Período: ${content.window.start} até ${content.window.end}`,
    `Entradas: ${content.entries.length} (${hidden} oculta${hidden === 1 ? "" : "s"})`,
    `Dificuldades: ${content.difficulties.length} · Próximos passos: ${content.nextSteps.length}`,
    `Uso do Claude: ${content.usage.days.length} dia(s), ${sessions} sessão(ões)`,
    `Prints: ${content.shots?.length ?? 0}`,
    `Tamanho do envio: ${kb(payloadBytes)} KB de ${kb(MAX_PAYLOAD_BYTES)} KB`,
  ];
}

function configuredEndpoint(config: unknown): string | null {
  const endpoint = (config as { roadmapSync?: { endpoint?: unknown } } | null)?.roadmapSync?.endpoint;
  return typeof endpoint === "string" && endpoint ? endpoint : null;
}

/** Runs the command line; returns the exit code (0 sent or valid, 1 refused or failed, 2 wrong command line). */
export async function runPush(argv: string[], deps: PushDeps): Promise<number> {
  const fail = (line: string) => {
    deps.print(line, "err");
    return 1;
  };

  const args = parseArgs(argv);
  if (!args) {
    for (const line of USAGE) deps.print(line, "err");
    return 2;
  }

  let content: unknown;
  try {
    content = JSON.parse(deps.readFile(args.draft).toString("utf8"));
  } catch (error) {
    // Never print the parser's message: it quotes the start of the file.
    const unreadable = !(error instanceof SyntaxError);
    return fail(unreadable ? `Não consegui ler o arquivo do rascunho «${basename(args.draft)}».` : `O arquivo «${basename(args.draft)}» não é um JSON válido.`);
  }

  if (args.shots.length > 0) {
    const shots = loadShots(args, deps);
    if (typeof shots === "string") return fail(shots);
    if (typeof content === "object" && content !== null) content = { ...content, shots };
  }

  // The very check the server runs: what passes here is not refused there for its shape.
  const parsed = parseDraft({ produto: args.produto, content });
  if (!parsed.ok) return fail(`Rascunho recusado: ${parsed.error}`);
  const body = JSON.stringify({ produto: parsed.produto, content: parsed.content });

  if (args.dryRun) {
    for (const line of summary(parsed.produto, parsed.content, Buffer.byteLength(body))) deps.print(line);
    return 0;
  }

  const secret = deps.env.FRONTLIGHTS_API_SECRET;
  if (!secret) return fail("Falta FRONTLIGHTS_API_SECRET no ambiente (o .env.local do RoadS tem esse valor).");
  const base = args.endpoint ?? configuredEndpoint(deps.readConfig());
  if (!base) return fail("Sem endereço: informe --endpoint <url base> ou configure roadmapSync.endpoint em .frontlights/config.json.");

  let response: Response;
  try {
    response = await deps.fetch(`${base.replace(/\/+$/, "")}/progress-report`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return fail("Não consegui falar com o servidor (confira a internet e o endereço). Nada foi confirmado.");
  }

  const answer = (await response.json().catch(() => null)) as { id?: unknown; created?: unknown; url?: unknown; error?: unknown } | null;
  const status = `HTTP ${response.status}`;
  if (response.status === 200) {
    const id = typeof answer?.id === "string" && /^[\w-]{1,64}$/.test(answer.id) ? answer.id : "(sem id)";
    deps.print(`Rascunho ${answer?.created === true ? "criado" : "atualizado"} (${status}). id: ${id}`);
    if (typeof answer?.url === "string" && answer.url.startsWith("https://")) deps.print(`Abra para revisar: ${answer.url}`);
    return 0;
  }
  if (response.status === 409) {
    return answer?.error === "period_already_sent"
      ? fail(`Esse período já foi enviado por e-mail e está congelado (${status}); o rascunho não foi alterado. Gere o resumo da janela seguinte.`)
      : fail(`Outro envio estava acontecendo ao mesmo tempo (${status}). Tente de novo.`);
  }
  if (response.status === 401) return fail(`O servidor recusou o segredo (${status}). Confira FRONTLIGHTS_API_SECRET.`);
  if (response.status === 400) {
    const why = typeof answer?.error === "string" && answer.error.length <= 300 ? answer.error.replace(/[\u0000-\u001F]/g, " ") : "motivo não informado";
    return fail(`O servidor recusou o rascunho (${status}): ${why}`);
  }
  return fail(`O servidor respondeu ${status}. Tente de novo em instantes; se continuar, veja os logs do RoadS.`);
}

// Run as a command (not when a test imports it).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  process.exitCode = await runPush(process.argv.slice(2), {
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
