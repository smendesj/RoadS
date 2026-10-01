// Reads the Claude Code transcripts from disk (READ ONLY) and hands them over as usage events. Only
// `<root>/projects/**/*.jsonl` is ever opened: never credentials, settings or anything else under ~/.claude.
// Node only (uses node:fs); the parsing it relies on lives in usage-parse.ts.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { parseUsageLine, sourceOfPath } from "./usage-parse.ts";
import type { UsageEvent } from "./usage-parse.ts";

export type ReadOptions = {
  /**
   * Files not written since before this instant (epoch ms) cannot hold a line of interest, because a
   * transcript is only appended to: they are skipped unread. It makes a read of months of history
   * as quick as a read of the last days.
   */
  modifiedSince: number;
  /** GitHub repositories ("Owner/Repo") whose mention in a tool call is worth keeping. */
  repos: readonly string[];
};

export type ReadStats = { read: number; skipped: number; unreadable: number };

function transcriptFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(path);
    }
  };
  walk(root);
  // A stable order matters: when the same answer sits in two session files, the first one read keeps it.
  return found.sort();
}

/**
 * Every user/assistant line of every main and subagent transcript under `projectsDir`, in path order.
 * Empty files, workflow files, files of an unknown shape and damaged lines are skipped, never fatal.
 */
export function* readUsageEvents(projectsDir: string, options: ReadOptions, stats?: ReadStats): Generator<UsageEvent> {
  const root = projectsDir.replace(/\\/g, "/").replace(/\/+$/, "");
  for (const path of transcriptFiles(root)) {
    const source = sourceOfPath(path.slice(root.length + 1));
    if (source === null || source.kind === "workflow") {
      if (stats) stats.skipped++;
      continue;
    }
    let text: string;
    try {
      const info = statSync(path);
      if (info.size === 0 || info.mtimeMs < options.modifiedSince) {
        if (stats) stats.skipped++;
        continue;
      }
      text = readFileSync(path, "utf8");
    } catch {
      if (stats) stats.unreadable++;
      continue;
    }
    if (stats) stats.read++;
    let position = 0;
    while (position < text.length) {
      let end = text.indexOf("\n", position);
      if (end < 0) end = text.length;
      const event = parseUsageLine(text.slice(position, end), source, { repos: options.repos });
      position = end + 1;
      if (event) yield event;
    }
  }
}
