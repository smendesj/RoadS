// Builders of synthetic Claude Code transcript lines, shared by the usage tests. Everything here is made
// up (ids, paths, texts): the repository is public, so no real session may ever be copied in. Not a test
// file on purpose, so `node --test` does not run it and several test files can import it.
import type { TranscriptSource } from "./usage-parse.ts";

/** Put it in any text a test feeds in: it must never come out of the collector. */
export const SENTINEL = "SENTINEL-7c1d";

export const SCOPE_CWD = "C:\\Software\\GeoCloud\\GeoCloudAI";
export const OTHER_CWD = "C:\\Software\\Elsewhere\\App";

export function source(session: string, kind: TranscriptSource["kind"] = "main", project = "C--Software-Demo"): TranscriptSource {
  return { project, session, kind };
}

type UserOptions = {
  at: string;
  cwd?: string;
  text?: string;
  /** The content as the transcript keeps it, when a test needs a precise shape. */
  content?: unknown;
  toolResult?: string;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  origin?: unknown;
};

export function userLine(o: UserOptions): string {
  let content: unknown = o.content;
  if (content === undefined) {
    content = o.toolResult !== undefined ? [{ type: "tool_result", tool_use_id: "toolu_1", content: o.toolResult }] : (o.text ?? "olá");
  }
  const line: Record<string, unknown> = {
    type: "user",
    timestamp: o.at,
    cwd: o.cwd ?? SCOPE_CWD,
    sessionId: "fixture",
    message: { role: "user", content },
  };
  if (o.isMeta) line.isMeta = true;
  if (o.isCompactSummary) line.isCompactSummary = true;
  if (o.origin !== undefined) line.origin = o.origin;
  return JSON.stringify(line);
}

type AssistantOptions = {
  at: string;
  cwd?: string;
  model?: string | null;
  id?: string | null;
  requestId?: string | null;
  /** [input, output, cacheRead, cacheWrite] */
  usage?: [number, number, number, number];
  text?: string;
  /** The `input` of each tool call the line makes. */
  tools?: unknown[];
};

export function assistantLine(o: AssistantOptions): string {
  const [input, output, cacheRead, cacheWrite] = o.usage ?? [0, 0, 0, 0];
  const content: unknown[] = [{ type: "text", text: o.text ?? "pronto" }];
  for (const input of o.tools ?? []) content.push({ type: "tool_use", id: "toolu_1", name: "Bash", input });
  const message: Record<string, unknown> = {
    role: "assistant",
    content,
    usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite },
  };
  if (o.model !== null) message.model = o.model ?? "claude-opus-5-5";
  if (o.id !== null) message.id = o.id ?? "msg_1";
  const line: Record<string, unknown> = { type: "assistant", timestamp: o.at, cwd: o.cwd ?? SCOPE_CWD, sessionId: "fixture", message };
  if (o.requestId !== null) line.requestId = o.requestId ?? `req_${o.id ?? "msg_1"}`;
  return JSON.stringify(line);
}
