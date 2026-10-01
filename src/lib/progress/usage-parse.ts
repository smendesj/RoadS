// Turns one line of a Claude Code transcript (JSONL) into a neutral "usage event": when, which session,
// which model, how many tokens, what kind of request. This is where privacy is decided: the event keeps
// instants, ids, model names, token counts, the working-directory ROOT and the roots/repositories a tool
// call pointed at. It never keeps a prompt, an answer, code, a command or a file path. Pure on purpose:
// no "server-only", no "@/" imports, so `node --experimental-strip-types` runs it (the collector CLI and
// the tests).
import type { TokenCount } from "../progress-report.ts";

/**
 * main = <project>/<session>.jsonl; subagent = <project>/<session>/subagents/agent-*.jsonl (belongs to
 * the parent session); workflow = <project>/<session>/subagents/workflows/**.jsonl (the /stats panel
 * ignores them, and so do we).
 */
export type TranscriptKind = "main" | "subagent" | "workflow";
export type TranscriptSource = { project: string; session: string; kind: TranscriptKind };

/** What a user line is: something the person typed, a slash command, an automatic notice, or a tool result. */
export type RequestKind = "human" | "command" | "automatic" | "tool_result";

/** What one tool call pointed at: directory roots ("C:/Software/App") and watched GitHub repositories. */
export type ToolTarget = { roots: string[]; repos: string[] };

export type UsageEvent = {
  source: TranscriptSource;
  type: "user" | "assistant";
  /** Epoch milliseconds of the line. */
  at: number;
  /** Working-directory root of the line, never a deeper path. */
  cwd: string | null;
  /** User lines only. */
  request: RequestKind | null;
  /** Assistant lines only: the raw model id. */
  model: string | null;
  messageId: string | null;
  requestId: string | null;
  /** null when there is nothing to count: a user line, a line without message, or a <synthetic> answer. */
  usage: TokenCount | null;
  /** One entry per tool call of an assistant line. */
  tools: ToolTarget[];
};

export const SYNTHETIC_MODEL = "<synthetic>";

export function sourceOfPath(relativePath: string): TranscriptSource | null {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  if (parts.length < 2 || parts.some((p) => p === "")) return null;
  const last = parts[parts.length - 1];
  if (!last.endsWith(".jsonl")) return null;
  const [project, second] = parts;
  if (parts.length === 2) return { project, session: second.slice(0, -".jsonl".length), kind: "main" };
  if (parts[2] !== "subagents") return null;
  if (parts.length === 4) return { project, session: second, kind: "subagent" };
  if (parts.length >= 6 && parts[3] === "workflows") return { project, session: second, kind: "workflow" };
  return null;
}

/* ---------- working directory and tool targets ---------- */

const rootCache = new Map<string, string>();

/**
 * "C:\Software\GeoCloud\Repo\src\deep" -> "C:\Software\GeoCloud\Repo"; a Claude worktree keeps its name
 * ("...\Repo\.claude\worktrees\issue-12"); anything else under C:\Software keeps one folder.
 */
export function workingRoot(cwd: string): string {
  const cached = rootCache.get(cwd);
  if (cached !== undefined) return cached;
  const n = cwd.replace(/\\/g, "/");
  const m =
    /^([a-z]:\/software\/geocloud\/[^/]+)(\/\.claude\/worktrees\/[^/]+)?/i.exec(n) ??
    /^([a-z]:\/software\/[^/]+)(\/\.claude\/worktrees\/[^/]+)?/i.exec(n);
  const root = m ? (m[1] + (m[2] ?? "")).replace(/\//g, "\\") : n.split("/").slice(0, 3).join("\\");
  rootCache.set(cwd, root);
  return root;
}

// A root is "<drive>:/Software/GeoCloud/<repo>", "<drive>:/Software/<dir>" or "<drive>:/Users/<name>",
// found in any string of a tool call, with Windows separators or the Git Bash form (/c/...).
const WINDOWS_ROOT =
  /(?:^|[^A-Za-z0-9])([A-Za-z]):[\\/]+(Software[\\/]+GeoCloud[\\/]+[^\\/\s"'`;|&)]+|Software[\\/]+[^\\/\s"'`;|&)]+|Users[\\/]+[^\\/\s"'`;|&)]+)/gi;
const BASH_ROOT =
  /(?:^|[\s"'=(:])\/([a-z])\/(Software\/GeoCloud\/[^/\s"'`;|&)]+|Software\/[^/\s"'`;|&)]+|Users\/[^/\s"'`;|&)]+)/gi;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Owner/Repo" -> a case-insensitive pattern that accepts either separator. */
const repoPattern = (slug: string): RegExp => new RegExp(slug.split("/").map(escapeRegExp).join("[\\\\/]+"), "i");

function collectStrings(value: unknown, out: string[], depth = 0): string[] {
  if (depth > 6) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out, depth + 1);
  else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) collectStrings((value as Record<string, unknown>)[key], out, depth + 1);
  }
  return out;
}

function targetOf(input: unknown, watched: { slug: string; pattern: RegExp }[]): ToolTarget {
  const roots = new Set<string>();
  const repos = new Set<string>();
  for (const text of collectStrings(input, [])) {
    for (const m of text.matchAll(WINDOWS_ROOT)) roots.add(`${m[1].toUpperCase()}:/${m[2].replace(/[\\/]+/g, "/")}`);
    for (const m of text.matchAll(BASH_ROOT)) roots.add(`${m[1].toUpperCase()}:/${m[2]}`);
    for (const w of watched) if (w.pattern.test(text)) repos.add(w.slug);
  }
  return { roots: [...roots].sort(), repos: [...repos].sort() };
}

/* ---------- user lines ---------- */

type TextKind = "text" | "empty" | "command" | "automatic";

function textKind(text: string): TextKind {
  const s = text.trimStart();
  if (s.startsWith("<command-name>") || s.startsWith("<command-message>")) return "command";
  if (s.length === 0) return "empty";
  // Everything the harness writes in the person's turn: output of local commands, task notices, reminders,
  // interruption marks, the summary that opens a compacted conversation, any other tagged block.
  if (s.startsWith("<") || s.startsWith("Caveat:") || s.startsWith("[Request interrupted by user") || s.startsWith("This session is being continued")) {
    return "automatic";
  }
  return "text";
}

function requestOf(line: Record<string, unknown>): RequestKind {
  const message = line.message as { content?: unknown } | undefined;
  const content = message && typeof message === "object" ? message.content : undefined;
  let toolResults = 0;
  const kinds: TextKind[] = [];
  if (typeof content === "string") kinds.push(textKind(content));
  else if (Array.isArray(content)) {
    for (const block of content as { type?: unknown; text?: unknown }[]) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "tool_result") toolResults++;
      else if (block.type === "text") kinds.push(textKind(typeof block.text === "string" ? block.text : ""));
    }
  }
  if (toolResults > 0) return "tool_result";
  if (line.isMeta || line.isCompactSummary) return "automatic";
  const origin = line.origin;
  const originKind = origin ? (typeof origin === "object" ? (origin as { kind?: unknown }).kind : String(origin)) : null;
  if (originKind && originKind !== "human") return "automatic";
  // One plain-text block makes it a human request; otherwise the first block decides. A line with no
  // text at all (a pasted picture) is the person's too.
  const kind: TextKind | "image" = kinds.length ? (kinds.includes("text") ? "text" : kinds[0]) : "image";
  if (kind === "command") return "command";
  return kind === "automatic" ? "automatic" : "human";
}

/* ---------- assistant lines ---------- */

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function usageOf(message: Record<string, unknown>): TokenCount {
  const u = (message.usage && typeof message.usage === "object" ? message.usage : {}) as Record<string, unknown>;
  return {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cacheRead: count(u.cache_read_input_tokens),
    cacheWrite: count(u.cache_creation_input_tokens),
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * Reads one transcript line. Returns null for anything that is not a user/assistant message with a valid
 * instant (other line types, damaged or half-written lines): a bad line must never stop the whole read.
 * `repos` lists the GitHub repositories ("Owner/Repo") whose mention in a tool call is worth keeping.
 */
export function parseUsageLine(
  line: string,
  source: TranscriptSource,
  options: { repos?: readonly string[] } = {}
): UsageEvent | null {
  // Cheap test first: most lines of a transcript are neither, and some are huge.
  if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (o.type !== "user" && o.type !== "assistant") return null;
  const at = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
  if (!Number.isFinite(at)) return null;

  const cwd = typeof o.cwd === "string" && o.cwd !== "" ? workingRoot(o.cwd) : null;
  if (o.type === "user") {
    return { source, type: "user", at, cwd, request: requestOf(o), model: null, messageId: null, requestId: null, usage: null, tools: [] };
  }

  const message = o.message && typeof o.message === "object" && !Array.isArray(o.message) ? (o.message as Record<string, unknown>) : null;
  const model = message ? str(message.model) : null;
  const tools: ToolTarget[] = [];
  if (message && Array.isArray(message.content)) {
    const watched = (options.repos ?? []).map((slug) => ({ slug, pattern: repoPattern(slug) }));
    for (const block of message.content as { type?: unknown; input?: unknown }[]) {
      if (block && typeof block === "object" && block.type === "tool_use") tools.push(targetOf(block.input, watched));
    }
  }
  return {
    source,
    type: "assistant",
    at,
    cwd,
    request: null,
    model,
    messageId: message ? str(message.id) : null,
    requestId: str(o.requestId),
    usage: message === null || model === SYNTHETIC_MODEL ? null : usageOf(message),
    tools,
  };
}

/* ---------- model names ---------- */

/** "claude-opus-5-5" -> "Opus 5.5", "claude-haiku-4-5-20251001" -> "Haiku 4.5"; an unknown id stays as it is. */
export function friendlyModel(id: string | null | undefined): string {
  if (!id) return "Desconhecido";
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  let m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/.exec(id);
  if (m) return `${cap(m[1])} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
  // The older naming puts the family last: claude-3-5-sonnet-20241022.
  m = /^claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku|fable)(?:-\d{8})?$/.exec(id);
  if (m) return `${cap(m[3])} ${m[1]}${m[2] ? `.${m[2]}` : ""}`;
  return id;
}
