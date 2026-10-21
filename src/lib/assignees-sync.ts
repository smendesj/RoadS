import "server-only";

import { assigneeKey, decideAssignees } from "@/lib/assignee-sync";
import { readIssueAssignees, setIssueAssignees, type GitHubPort } from "@/lib/github";
import { createAdminClient } from "@/lib/supabase/admin";
import { inPool } from "@/lib/pool";
import { isTestData } from "@/lib/test-data";

// The sync step of an item's Assignees with its issue's (issue #23), for the items whose issue is open: reads both
// sides, decides with assignee-sync.ts and applies it. Writing to GitHub only happens when `push` is set (a dev's
// press only pulls). The base is kept with the other two-way fields, in github_seen under "assignees". One item
// failing is counted and the others go on.

export type AssigneesSummary = { pulled: number; pushed: number; failed: number; error?: string };

const ISSUE_URL = /github\.com\/Essencis-Labs\/GeoCloudAI\/issues\/(\d+)/i;
const BATCH = 20;
// Items written at once, as the other two-way fields (board-sync.ts): a few at a time, within GitHub's write limits.
const POOL = 6;

export async function syncItemAssignees(token: string, openNumbers: number[], push: boolean, port: GitHubPort = {}): Promise<AssigneesSummary> {
  const admin = createAdminClient();
  const { data: items, error } = await admin.from("roadmap_items").select("id, title, github_issue_url, assignees, github_seen, field_changed_at");
  if (error) throw error;

  const open = new Set(openNumbers);
  type Row = { id: string; number: number; assignees: string[]; seen: Record<string, string>; changedAt: Record<string, string> };
  const rows: Row[] = [];
  for (const item of items ?? []) {
    if (isTestData(item.title)) continue;
    const number = Number(item.github_issue_url?.match(ISSUE_URL)?.[1]);
    if (!open.has(number)) continue;
    rows.push({
      id: item.id,
      number,
      assignees: (item.assignees as string[] | null) ?? [],
      seen: (item.github_seen as Record<string, string> | null) ?? {},
      changedAt: (item.field_changed_at as Record<string, string> | null) ?? {},
    });
  }

  const theirs = new Map<number, { logins: string[]; changedAt: string | null }>();
  const numbers = rows.map((r) => r.number);
  for (let i = 0; i < numbers.length; i += BATCH) {
    for (const [n, side] of await readIssueAssignees(token, numbers.slice(i, i + BATCH), port)) theirs.set(n, side);
  }

  const summary: AssigneesSummary = { pulled: 0, pushed: 0, failed: 0 };
  await inPool(rows, POOL, async (row) => {
    const side = theirs.get(row.number);
    if (!side) return;
    const github = side.logins;
    try {
      const decision = decideAssignees({
        roads: row.assignees,
        base: "assignees" in row.seen ? row.seen.assignees : null,
        github,
        roadsAt: row.changedAt.assignees ?? null,
        githubAt: side.changedAt,
      });
      if (decision === "push" && !push) return;
      const value = decision === "push" ? row.assignees : github;
      if (decision === "push") await setIssueAssignees(token, row.number, value, port);
      const update: Record<string, unknown> = { github_seen: { ...row.seen, assignees: assigneeKey(value) } };
      if (decision === "pull") update.assignees = value.map((l) => l.toLowerCase());
      if (decision !== "none" || row.seen.assignees !== assigneeKey(value)) {
        const { error: updateError } = await admin.from("roadmap_items").update(update).eq("id", row.id);
        if (updateError) throw updateError;
      }
      if (decision === "pull") summary.pulled++;
      if (decision === "push") summary.pushed++;
    } catch (e) {
      console.error("syncBoard: Assignees failed for an item", e);
      summary.failed++;
    }
  });
  return summary;
}
