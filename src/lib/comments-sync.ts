import "server-only";

import { planComments, type CommentAction, type NoteSide } from "@/lib/comment-sync";
import { createIssueComment, type GitHubPort } from "@/lib/github";
import { createAdminClient } from "@/lib/supabase/admin";
import { inPool } from "@/lib/pool";
import { isTestData } from "@/lib/test-data";

// The sync step that takes an item's Comments up to its issue (issue #34, which narrows the two-way sync of issue
// #23): for the items whose issue is open it reads RoadS's Comments only, plans with comment-sync.ts and applies the
// plan. GitHub's comments are never read, so nothing comes down: `pulled` stays in the summary for board-sync.ts and is
// always 0. Creating a comment on GitHub only happens when `push` is set, the same rule as the fields of issue #22 (a
// dev's press only pulls); forgetting a Comment deleted before it was sent touches RoadS alone and always happens. One
// Comment failing is counted and the others go on.

export type CommentsSummary = { pulled: number; pushed: number; failed: number; error?: string };

const ISSUE_URL = /github\.com\/Essencis-Labs\/GeoCloudAI\/issues\/(\d+)/i;
// Items written at once, as the other two-way fields (board-sync.ts): a few at a time, within GitHub's write limits.
const POOL = 6;

type NoteRow = {
  id: string;
  body: string;
  github_comment_id: number | null;
  deleted_at: string | null;
  author_name: string | null;
};

export async function syncItemComments(token: string, openNumbers: number[], push: boolean, port: GitHubPort = {}): Promise<CommentsSummary> {
  const admin = createAdminClient();
  const { data: items, error } = await admin
    .from("roadmap_items")
    .select("id, title, github_issue_url, notes:item_notes(id, body, github_comment_id, deleted_at, author_name)");
  if (error) throw error;

  const open = new Set(openNumbers);
  const byNumber = new Map<number, NoteRow[]>();
  for (const item of (items ?? []) as unknown as { id: string; title: string; github_issue_url: string | null; notes: NoteRow[] }[]) {
    if (isTestData(item.title)) continue;
    const number = Number(item.github_issue_url?.match(ISSUE_URL)?.[1]);
    if (open.has(number)) byNumber.set(number, item.notes ?? []);
  }

  const summary: CommentsSummary = { pulled: 0, pushed: 0, failed: 0 };
  await inPool([...byNumber], POOL, async ([number, notes]) => {
    const sides: NoteSide[] = notes.map((n) => ({
      id: n.id,
      body: n.body,
      githubId: n.github_comment_id === null ? null : Number(n.github_comment_id),
      deleted: Boolean(n.deleted_at),
      authorName: n.author_name,
    }));
    for (const action of planComments(sides)) {
      if (!push && action.kind === "create") continue;
      try {
        await apply(admin, token, number, action, port);
        if (action.kind === "create") summary.pushed++;
      } catch (e) {
        console.error("syncBoard: a Comment failed to sync", e);
        summary.failed++;
      }
    }
  });
  return summary;
}

async function apply(admin: ReturnType<typeof createAdminClient>, token: string, number: number, action: CommentAction, port: GitHubPort) {
  const notes = admin.from("item_notes");
  const done = (q: PromiseLike<{ error: unknown }>) =>
    Promise.resolve(q).then(({ error }) => {
      if (error) throw error;
    });
  switch (action.kind) {
    case "create": {
      const created = await createIssueComment(token, number, action.body, port);
      return done(notes.update({ github_comment_id: created.id, github_seen: action.text }).eq("id", action.noteId));
    }
    case "forget":
      return done(notes.delete().eq("id", action.noteId));
  }
}
