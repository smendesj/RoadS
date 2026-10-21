import "server-only";

import { planComments, type CommentAction, type NoteSide } from "@/lib/comment-sync";
import { createIssueComment, deleteIssueComment, readIssueComments, updateIssueComment, type GitHubPort } from "@/lib/github";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTestData } from "@/lib/test-data";

// The sync step of an item's Comments with its issue's comments (issue #23): reads both sides for the items whose
// issue is open, plans with comment-sync.ts and applies the plan. Writing to GitHub (create, edit, delete) only
// happens when `push` is set, the same rule as the fields of issue #22 (a dev's press only pulls). One item failing
// is counted and the others go on.

export type CommentsSummary = { pulled: number; pushed: number; failed: number; error?: string };

const ISSUE_URL = /github\.com\/Essencis-Labs\/GeoCloudAI\/issues\/(\d+)/i;
const BATCH = 20;
const WRITES: CommentAction["kind"][] = ["create", "update", "delete"];

type NoteRow = {
  id: string;
  body: string;
  github_seen: string | null;
  github_comment_id: number | null;
  deleted_at: string | null;
  updated_at: string | null;
  author_name: string | null;
};

export async function syncItemComments(token: string, openNumbers: number[], push: boolean, port: GitHubPort = {}): Promise<CommentsSummary> {
  const admin = createAdminClient();
  const { data: items, error } = await admin
    .from("roadmap_items")
    .select("id, title, github_issue_url, notes:item_notes(id, body, github_seen, github_comment_id, deleted_at, updated_at, author_name)");
  if (error) throw error;

  const open = new Set(openNumbers);
  const byNumber = new Map<number, { id: string; notes: NoteRow[] }>();
  for (const item of (items ?? []) as unknown as { id: string; title: string; github_issue_url: string | null; notes: NoteRow[] }[]) {
    if (isTestData(item.title)) continue;
    const number = Number(item.github_issue_url?.match(ISSUE_URL)?.[1]);
    if (open.has(number)) byNumber.set(number, { id: item.id, notes: item.notes ?? [] });
  }

  const numbers = [...byNumber.keys()];
  const comments = new Map<number, Awaited<ReturnType<typeof readIssueComments>> extends Map<number, infer C> ? C : never>();
  for (let i = 0; i < numbers.length; i += BATCH) {
    for (const [n, list] of await readIssueComments(token, numbers.slice(i, i + BATCH), port)) comments.set(n, list);
  }

  const summary: CommentsSummary = { pulled: 0, pushed: 0, failed: 0 };
  for (const [number, item] of byNumber) {
    const theirs = comments.get(number);
    if (!theirs) continue; // not read (too many comments): its Comments are left alone this time
    const sides: NoteSide[] = item.notes.map((n) => ({
      id: n.id,
      body: n.body,
      base: n.github_seen,
      githubId: n.github_comment_id === null ? null : Number(n.github_comment_id),
      deleted: Boolean(n.deleted_at),
      updatedAt: n.updated_at,
      authorName: n.author_name,
    }));
    for (const action of planComments(sides, theirs)) {
      if (!push && WRITES.includes(action.kind)) continue;
      try {
        await apply(admin, token, number, item.id, action, port);
        if (WRITES.includes(action.kind)) summary.pushed++;
        else if (action.kind !== "seen") summary.pulled++;
      } catch (e) {
        console.error("syncBoard: a Comment failed to sync", e);
        summary.failed++;
      }
    }
  }
  return summary;
}

async function apply(admin: ReturnType<typeof createAdminClient>, token: string, number: number, itemId: string, action: CommentAction, port: GitHubPort) {
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
    case "update":
      await updateIssueComment(token, action.commentId, action.body, port);
      return done(notes.update({ github_seen: action.text }).eq("id", action.noteId));
    case "delete":
      await deleteIssueComment(token, action.commentId, port);
      return done(notes.delete().eq("id", action.noteId));
    case "pull":
      return done(notes.update({ body: action.text, github_seen: action.text }).eq("id", action.noteId));
    case "seen":
      return done(notes.update({ github_seen: action.text }).eq("id", action.noteId));
    case "forget":
      return done(notes.delete().eq("id", action.noteId));
    case "import":
      return done(
        notes.insert({
          item_id: itemId,
          author_id: null,
          author_role: null,
          github_login: action.login ?? "github",
          github_comment_id: action.commentId,
          github_seen: action.text,
          body: action.text,
          created_at: action.at,
        })
      );
  }
}
