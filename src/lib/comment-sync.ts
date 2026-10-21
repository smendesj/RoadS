// The two-way sync of an item's Comments with its issue's comments (issue #23), one comment at a time. Each Comment
// written in RoadS keeps the id of the comment it became on GitHub and the text both sides last agreed on (the base),
// so the field rule of issue #22 (bilateral-sync.ts) settles an edit: only one side moved, it goes to the other; both
// moved, the last one to edit wins. Beyond editing:
//   - a Comment never sent is created on the issue, signed with its author's name (the token is one person's);
//   - a Comment deleted in RoadS deletes its comment; one deleted on GitHub leaves RoadS too;
//   - a comment written on GitHub becomes a Comment whose author is the GitHub login; bots stay out, and the comments
//     RoadS created are known by their id, so they never come back as new.
//
// Pure on purpose: board-sync.ts reads both sides, applies the plan and remembers each new base and id.

import { decideField } from "./bilateral-sync.ts";

export type NoteSide = {
  id: string;
  /** The Comment's text in RoadS, unsigned. */
  body: string;
  /** The text both sides last agreed on; null for a Comment never sent. */
  base: string | null;
  /** The id of the comment it became on GitHub; null for a Comment never sent. */
  githubId: number | null;
  /** Deleted in RoadS and waiting for the sync to delete its comment on GitHub. */
  deleted: boolean;
  /** When it was last edited in RoadS (ISO), if it was. */
  updatedAt: string | null;
  /** The name it is signed with on GitHub; null for a Comment that came from GitHub. */
  authorName: string | null;
};

export type GitHubComment = { id: number; body: string; updatedAt: string; login: string | null; bot: boolean };

export type CommentAction =
  | { kind: "create"; noteId: string; body: string; text: string }
  | { kind: "update"; noteId: string; commentId: number; body: string; text: string }
  | { kind: "delete"; noteId: string; commentId: number }
  | { kind: "pull"; noteId: string; text: string }
  | { kind: "seen"; noteId: string; text: string }
  | { kind: "forget"; noteId: string }
  | { kind: "import"; commentId: number; text: string; login: string | null; at: string };

const SIGNATURE = /\n\n— (.+) \(RoadS\)\s*$/;

/** The comment's text on GitHub: the Comment, then the name of who wrote it in RoadS. */
export function signComment(name: string, text: string): string {
  return `${text.trim()}\n\n— ${name} (RoadS)`;
}

/** The Comment's text without the RoadS signature (a comment written on GitHub has none). */
export function unsignComment(body: string): string {
  return body.replace(SIGNATURE, "").trim();
}

export function planComments(notes: NoteSide[], comments: GitHubComment[]): CommentAction[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const known = new Set(notes.flatMap((n) => (n.githubId === null ? [] : [n.githubId])));
  const plan: CommentAction[] = [];

  for (const n of notes) {
    const sign = (text: string) => signComment(n.authorName ?? "RoadS", text);
    if (n.githubId === null) {
      plan.push(n.deleted ? { kind: "forget", noteId: n.id } : { kind: "create", noteId: n.id, body: sign(n.body), text: n.body });
      continue;
    }
    const c = byId.get(n.githubId);
    if (!c) {
      plan.push({ kind: "forget", noteId: n.id });
      continue;
    }
    if (n.deleted) {
      plan.push({ kind: "delete", noteId: n.id, commentId: c.id });
      continue;
    }
    const github = unsignComment(c.body);
    const decision = decideField({ roads: n.body, base: n.base, github, roadsAt: n.updatedAt, githubAt: c.updatedAt });
    if (decision === "push") plan.push({ kind: "update", noteId: n.id, commentId: c.id, body: sign(n.body), text: n.body });
    else if (decision === "pull") plan.push({ kind: "pull", noteId: n.id, text: github });
    else if (n.base !== github) plan.push({ kind: "seen", noteId: n.id, text: github });
  }

  for (const c of comments) {
    if (known.has(c.id) || c.bot) continue;
    plan.push({ kind: "import", commentId: c.id, text: unsignComment(c.body), login: c.login, at: c.updatedAt });
  }
  return plan;
}
