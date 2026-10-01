// The plain-language ruler of "Resumo para a diretoria": the CEO reads this e-mail in a minute and
// knows no repository vocabulary, so a sentence that sounds like engineering gets a warning (never a
// block: the person editing decides). Pure on purpose: no "server-only", no "@/" imports.
import type { LintIssue, LintSection } from "../progress-report.ts";

/** Past this many characters a sentence stops being "one sentence the CEO reads at a glance". */
export const MAX_SENTENCE = 280;

/**
 * Words a director should not meet in the e-mail. This list is a product decision, so it lives here
 * alone and is meant to be edited. Matching ignores case and accents and takes whole words only (a
 * trailing "s"/"es" still counts, so "bugs" and "branches" are caught, "apito" and "capital" are not).
 */
export const JARGON_TERMS: readonly string[] = [
  "API",
  "endpoint",
  "backend",
  "back-end",
  "frontend",
  "front-end",
  "PR",
  "pull request",
  "merge",
  "branch",
  "deploy",
  "commit",
  "bug",
  "refactor",
  "teste unitário",
  "RLS",
  "JWT",
  "cache",
  "token",
  "webhook",
  "pipeline",
  "CI",
  "repositório",
  "issue",
  "hotfix",
  "script",
  "banco de dados",
];

/** The usage section ("ia") is literally about tokens, so the word is fine there and only there. */
const ALLOWED_IN_IA = new Set(["token"]);

const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Ruler = { pattern: RegExp; original: Map<string, string> };

function ruler(terms: readonly string[]): Ruler {
  const original = new Map(terms.map((t) => [fold(t), t]));
  // Longest first, so a term never loses to a shorter one that starts the same way.
  const alternatives = [...original.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return { pattern: new RegExp(`(?<![a-z0-9_])(${alternatives.join("|")})(?:e?s)?(?![a-z0-9_])`, "g"), original };
}

const RULERS: Record<LintSection, Ruler> = {
  geral: ruler(JARGON_TERMS),
  ia: ruler(JARGON_TERMS.filter((t) => !ALLOWED_IN_IA.has(fold(t)))),
};

const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
// "#123" but not "C#" or an HTML entity like "&#39;".
const ISSUE_NUMBER = /(?<![\w&])#\d+\b/;
const CODE_EXTENSION = /\.(?:tsx?|jsx?|mjs|cjs|cs|py|sql|json|md|s?css|html|ya?ml|sh|java|go|rb|php)\b/i;
const SOURCE_FOLDER = /(?<!\w)\.{0,2}\/?(?:src|app|lib|components|scripts|node_modules|supabase|public|docs|dist|build|packages)\/[\w./-]*/i;
const DRIVE_PATH = /\b[a-z]:\\\S*/i;

// The extension is found first and the file name is read backwards from it. A pattern that tried to read
// the whole name from every position took quadratic time on a long pasted token, and the editor lints
// on every keystroke.
function codeFile(text: string): string | undefined {
  const m = CODE_EXTENSION.exec(text);
  if (!m) return undefined;
  let from = m.index;
  while (from > 0 && /[\w./\\-]/.test(text[from - 1])) from--;
  return text.slice(from, m.index + m[0].length);
}

const shorten = (s: string): string => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

/**
 * Warnings for one sentence of the report, in Portuguese, ready to show next to the field. An empty
 * list means the sentence is fine. `section` is "geral" for the text meant for the CEO and "ia" for
 * the usage numbers.
 */
export function lintSentence(text: string, section: LintSection = "geral"): LintIssue[] {
  const issues: LintIssue[] = [];

  const length = [...text].length;
  if (length > MAX_SENTENCE) {
    issues.push({ code: "muito_longo", message: `frase muito longa: ${length} caracteres (o máximo recomendado é ${MAX_SENTENCE})` });
  }

  // A link is reported once, as a link: the words and folders inside it are not judged again.
  const link = text.match(URL)?.[0];
  const rest = text.replace(URL, " ");

  const { pattern, original } = RULERS[section];
  const seen = new Set<string>();
  for (const match of fold(rest).matchAll(pattern)) {
    const term = original.get(match[1])!;
    if (seen.has(term)) continue;
    seen.add(term);
    issues.push({ code: "jargao", message: `termo técnico: «${term}»` });
  }

  const issue = rest.match(ISSUE_NUMBER)?.[0];
  if (issue) issues.push({ code: "numero_de_issue", message: `número de issue no texto: «${issue}»` });

  const file = codeFile(rest) ?? (rest.match(SOURCE_FOLDER) ?? rest.match(DRIVE_PATH))?.[0];
  if (file) issues.push({ code: "caminho_de_arquivo", message: `arquivo ou caminho de código: «${shorten(file.trim())}»` });

  if (text.includes("`")) issues.push({ code: "codigo", message: "trecho de código entre crases" });

  if (link) issues.push({ code: "url", message: `endereço de internet no texto: «${shorten(link)}»` });

  return issues;
}
