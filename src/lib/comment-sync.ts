// The Comments of an item only go up to its issue (issue #34, which narrows the two-way sync of issue #23). A Comment
// written in RoadS and never sent is created on the issue once, signed with its author's name (the token is one
// person's), and from then on the sync leaves it alone: an edit in RoadS after it went up is not taken to GitHub, an
// edit or a deletion on GitHub is not brought back, and nothing written on GitHub ever becomes a Comment in RoadS.
// The one other step is housekeeping: a Comment deleted before it was ever sent is forgotten, since nothing on GitHub
// stands for it. A Comment deleted after it went up deletes nothing there.
//
// Pure on purpose: comments-sync.ts reads RoadS's side, applies the plan and remembers the id each new comment got.
// The rule is given RoadS's Comments alone, so GitHub's comments cannot reach it even by mistake.

export type NoteSide = {
  id: string;
  /** The Comment's text in RoadS, unsigned. */
  body: string;
  /** The id of the comment it became on GitHub; null for a Comment never sent. */
  githubId: number | null;
  /** Deleted in RoadS. */
  deleted: boolean;
  /** The name it is signed with on GitHub; null when RoadS does not know it (it is then signed "RoadS"). */
  authorName: string | null;
};

export type CommentAction = { kind: "create"; noteId: string; body: string; text: string } | { kind: "forget"; noteId: string };

/** The comment's text on GitHub: the Comment, then the name of who wrote it in RoadS. */
export function signComment(name: string, text: string): string {
  return `${text.trim()}\n\n— ${name} (RoadS)`;
}

export function planComments(notes: NoteSide[]): CommentAction[] {
  const plan: CommentAction[] = [];
  for (const n of notes) {
    if (n.githubId !== null) continue; // already sent: never touched again
    plan.push(
      n.deleted
        ? { kind: "forget", noteId: n.id }
        : { kind: "create", noteId: n.id, body: signComment(n.authorName ?? "RoadS", n.body), text: n.body }
    );
  }
  return plan;
}
