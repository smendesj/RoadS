// What the collector prints for the person: the "conferência" table (one line per day) to check the numbers
// against what they remember of the week, and the sessions the scope rule was not sure about. Portuguese,
// numbers and instants only. Pure on purpose: no "server-only", no "@/" imports.
import { instantRangeLabel } from "./period.ts";
import type { UsageResult, SessionSummary } from "./usage-aggregate.ts";

const SAO_PAULO_MS = -3 * 3_600_000;
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const number = new Intl.NumberFormat("pt-BR");

/** HH:MM in São Paulo. */
export const formatClock = (iso: string): string => new Date(Date.parse(iso) + SAO_PAULO_MS).toISOString().slice(11, 16);

/** 45600 -> "45,6k", 7800000 -> "7,8M", 12300000000 -> "12,3B": the way the /stats panel shortens them. */
export function formatTokens(n: number): string {
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (let i = 0; i < units.length; i++) {
    const [size, suffix] = units[i];
    if (n < size) continue;
    let value = Math.round((n / size) * 10) / 10;
    let unit = suffix;
    if (value >= 1000 && i > 0) {
      value = Math.round((n / units[i - 1][0]) * 10) / 10;
      unit = units[i - 1][1];
    }
    return `${String(value).replace(".", ",").replace(/,0$/, "")}${unit}`;
  }
  return String(n);
}

const plural = (n: number, one: string, many: string): string => `${number.format(n)} ${n === 1 ? one : many}`;
const percent = (share: number | null): string => `${Math.round((share ?? 0) * 100)}%`;
const dayLabel = (date: string): string => {
  const [, m, d] = date.split("-");
  return `${WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${d}/${m}`;
};
const shortDate = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const longDate = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

function table(rows: string[][], align: ("l" | "r")[]): string[] {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  return rows.map((row) =>
    row
      .map((cell, c) => (align[c] === "r" ? cell.padStart(widths[c]) : cell.padEnd(widths[c])))
      .join("  ")
      .trimEnd()
  );
}

/** Why the rule was not sure, in the words the person needs to decide. */
function reasonOf(s: SessionSummary, several: boolean): string {
  const { calls } = s;
  const where = several ? "de um dos projetos" : "do GeoCloud";
  const touch = several ? "os projetos" : "o GeoCloud";
  const explicit = calls.scope + calls.both + calls.other;
  switch (s.basis) {
    case "cwd":
      return `aberta na pasta ${where}, mas só ${percent(s.shares.explicit)} das ${explicit} chamadas com alvo explícito tocam ${touch}`;
    case "tools_majority":
      return `aberta noutra pasta, mas ${percent(s.shares.effective)} das ${calls.total} chamadas de ferramenta tocam ${touch}`;
    default:
      return `aberta noutra pasta; ${percent(s.shares.effective)} das ${calls.total} chamadas de ferramenta tocam ${touch} (${calls.scope + calls.both} com alvo explícito)`;
  }
}

export function formatUsageReport(result: UsageResult): string[] {
  const { usage } = result;
  const real = usage.method !== "stats";
  const first = usage.days[0].date;
  const last = usage.days[usage.days.length - 1].date;
  const lines: string[] = [];
  const several = (usage.products?.length ?? 0) > 1;
  const names = usage.products ?? [];
  const subject = several ? `em ${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}` : `no ${usage.scope}`;

  // A window cut at an instant (--start/--end) says its hours: its first and last day are partial.
  const atMidnight = (iso: string): boolean => formatClock(iso) === "00:00" && Date.parse(iso) % 60_000 === 0;
  const span =
    atMidnight(usage.window.start) && atMidnight(usage.window.end)
      ? `${longDate(first)} a ${longDate(last)}`
      : `${instantRangeLabel(usage.window) ?? `${longDate(first)} a ${longDate(last)}`} (o fim não entra)`;
  lines.push(
    `Uso do Claude ${subject}, ${span} (${
      real ? "contagem real: cada resposta da API uma vez" : "contagem do /stats: cada linha do histórico, como o painel do Claude Code"
    })`
  );
  lines.push("");
  const header = ["Dia", "Sessões (início-fim)", "1º pedido", "Últ. pedido", "Mensagens", "Tokens", "Outra contagem"];
  const rows = usage.days.map((d) => [
    dayLabel(d.date),
    d.sessions.length ? d.sessions.map((s) => `${formatClock(s.start)}-${formatClock(s.end)}`).join(", ") : "-",
    d.firstPromptAt ? formatClock(d.firstPromptAt) : "-",
    d.lastPromptAt ? formatClock(d.lastPromptAt) : "-",
    number.format(d.messages),
    formatTokens(d.tokens.input + d.tokens.output + d.tokens.cacheRead + d.tokens.cacheWrite),
    `${real ? "/stats" : "real"}: ${formatTokens(d.otherMethodTokens ?? 0)}`,
  ]);
  lines.push(...table([header, ...rows], ["l", "l", "l", "l", "r", "r", "l"]).map((l) => `  ${l}`));
  lines.push("");

  const t = usage.totals;
  const tokens = t.tokens.input + t.tokens.output + t.tokens.cacheRead + t.tokens.cacheWrite;
  lines.push(
    `Total: ${plural(t.sessions, "sessão", "sessões")}, ${plural(t.messages, "mensagem", "mensagens")} (${plural(t.humanPrompts ?? 0, "pedido digitado", "pedidos digitados")}), ${formatTokens(tokens)} tokens`
  );
  if (several) {
    lines.push("", "Por projeto (a sessão conta onde foi aberta; as de outra pasta, onde mais apontou):");
    const perProject = result.byProduct.map((p) => [p.name, number.format(p.sessions), number.format(p.messages), formatTokens(p.tokens)]);
    lines.push(...table([["Projeto", "Sessões", "Mensagens", "Tokens"], ...perProject], ["l", "r", "r", "r"]).map((l) => `  ${l}`));
  }
  lines.push(`Modelo favorito: ${usage.favoriteModel ?? "-"}; hora com mais mensagens: ${usage.peakHour === null ? "-" : `${usage.peakHour}h`}`);
  if (usage.notes?.length) {
    lines.push("", "Notas de cobertura:");
    for (const n of usage.notes) lines.push(`  ${shortDate(n.date)}: ${n.text}`);
  }

  lines.push("");
  if (result.borderline.length === 0) {
    lines.push("Nenhuma sessão para confirmar: a regra de escopo não ficou em dúvida.");
  } else {
    lines.push(`Sessões para você confirmar (${result.borderline.length}); a regra não tem certeza:`);
    for (const s of result.borderline) {
      const decided = s.forced ? ` (decidido por você: --${s.forced})` : "";
      lines.push(`  ${s.id}  ${s.included ? "ENTRA" : "FORA "}  ${s.root ?? "?"}  ${plural(s.messages, "mensagem", "mensagens")}, ${formatTokens(s.tokens)} tokens${decided}`);
      lines.push(`      ${reasonOf(s, several)}`);
      lines.push(`      para decidir: --include ${s.id}   ou   --exclude ${s.id}   (ou no scope.json)`);
    }
  }
  const outside = result.sessions.filter((s) => !s.included && !s.borderline).length;
  lines.push("", `Sessões vistas na janela: ${result.sessions.length}; no escopo: ${result.sessions.filter((s) => s.included).length}; fora, sem dúvida: ${outside}.`);
  return lines;
}
