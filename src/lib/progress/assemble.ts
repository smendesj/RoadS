// Builds the draft of "Resumo" from its three honest sources: the collected facts (which issues, their status,
// the dates, the links), the collected Claude usage, and the short plain-language texts the person driving the
// Frontlights flow writes. A status can only come from the facts, so a text can never turn a blocked delivery
// into a done one. The result is handed to parseDraft (draft.ts), the very check the server runs: this module
// only joins, it does not validate field by field. Pure on purpose (no "server-only", no "@/" imports).
//
// The texts file, documented for people in docs/progress-draft.md:
//   { headline, entries: [{ issue, title, summary, hidden? }], internal?, difficulties?: [{ text, needs? }],
//     nextSteps?: [string | { text }] }
import type { ProgressContent } from "../progress-report.ts";

export type AssembleInput = {
  /** The texts file, as parsed. */
  texts: unknown;
  /** The facts file of the GitHub collector, as parsed. */
  facts: unknown;
  /** The usage file of the Claude collector, as parsed. */
  usage: unknown;
  /** The reader's account and temporary password, from a local file; left out when there is none. */
  access?: { account: string; password: string };
};

export type AssembleResult = { ok: true; content: ProgressContent | Record<string, unknown> } | { ok: false; error: string };

/** Same limit the draft parser puts on the links of one entry. */
const MAX_SOURCES = 20;
const HIDDEN_TITLE = "Item fora do período";
const HIDDEN_SUMMARY = "Sem texto escrito para o resumo.";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const issues = (numbers: number[]): string => numbers.map((n) => `#${n}`).join(", ");

type Fact = Record<string, unknown> & { issue: number };
const isFact = (v: unknown): v is Fact => isObject(v) && typeof v.issue === "number" && Number.isInteger(v.issue);

export function assembleDraft({ texts, facts, usage, access }: AssembleInput): AssembleResult {
  if (!isObject(texts)) return { ok: false, error: "Falta o arquivo de textos do resumo (ou ele não é um objeto JSON)." };
  if (!isObject(facts) || !Array.isArray(facts.entries)) return { ok: false, error: "Faltam os fatos do GitHub: rode o coletor de fatos antes de montar o resumo." };
  if (!isObject(usage)) return { ok: false, error: "Falta o arquivo de uso do Claude: rode o coletor de uso antes de montar o resumo." };
  if (typeof texts.headline !== "string" || texts.headline.trim() === "") return { ok: false, error: "Falta a frase de abertura (headline) nos textos." };

  const written = new Map<number, Record<string, unknown>>();
  for (const t of list(texts.entries)) {
    if (isObject(t) && typeof t.issue === "number") written.set(t.issue, t);
  }

  const known = new Set<number>();
  const entries: Record<string, unknown>[] = [];
  const missing: number[] = [];
  for (const f of facts.entries.filter(isFact)) {
    known.add(f.issue);
    const text = written.get(f.issue);
    // The collector's own hiding (delivered before the window, internal) holds unless the text says otherwise.
    const hidden = typeof text?.hidden === "boolean" ? text.hidden : f.hidden === true;
    if (!text && !hidden) missing.push(f.issue);
    entries.push({
      id: typeof f.id === "string" ? f.id : `gc-${f.issue}`,
      issue: f.issue,
      status: f.status,
      title: text ? text.title : HIDDEN_TITLE,
      summary: text ? text.summary : HIDDEN_SUMMARY,
      deliveredAt: f.deliveredAt ?? null,
      subIssues: f.subIssues ?? null,
      hidden,
      edited: false,
      sources: list(f.sources).slice(0, MAX_SOURCES),
    });
  }
  if (missing.length > 0) return { ok: false, error: `Faltam os textos destas entregas: ${issues(missing)}.` };
  const unknown = [...written.keys()].filter((n) => !known.has(n));
  if (unknown.length > 0) return { ok: false, error: `Há texto para ${issues(unknown)}, que não está nos fatos coletados.` };

  const count = isObject(facts.internal) && typeof facts.internal.count === "number" ? facts.internal.count : 0;
  const internalText = typeof texts.internal === "string" && texts.internal.trim() !== "" ? texts.internal : `Também houve ${count} ajustes internos de organização.`;

  const content: Record<string, unknown> = {
    window: facts.window,
    headline: texts.headline,
    entries,
    internal: { count, text: count > 0 ? internalText : "" },
    difficulties: list(texts.difficulties).map((d) => (isObject(d) ? { text: d.text, needs: typeof d.needs === "string" ? d.needs : "" } : d)),
    nextSteps: list(texts.nextSteps).map((n) => (typeof n === "string" ? { text: n } : n)),
    usage,
  };
  if (access) content.access = access;
  return { ok: true, content };
}
