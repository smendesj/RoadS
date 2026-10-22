// The Roadmap's screen texts (issue #23), in English; the words every screen shares are in common.ts.

export const ROADMAP = {
  loading: "Loading...",
  newItem: "+ New item",
  moveTo: "Move to",
  moveToPlaceholder: "Move to…",
  kanbanNoWeek: "Kanban (no week)",
  done: "Done",
  showMore: "Show more",
  showLess: "Show less",
  addComment: "+ Comment",
  newComment: "New Comment",
  commentPlaceholder: "Write a Comment (optional)...",
  editComment: "Edit Comment",
  edited: "edited",
  deleteCommentConfirm: "Delete this Comment? It is also deleted on the issue.",
  noOpenIssues: "No open issues.",
  noIssuesHere: "No issues here.",
  allDone: "All issues in Done on the Project",
  /** Beside the title of a sprint over its limit (MAX_ITEMS_PER_SPRINT). */
  sprintOverLimit: "⚠️ This sprint has too many issues",
} as const;

/**
 * The Description a "+ New item" is born with (issue #28): the Problema › Solução template its issue's body opens with,
 * in Portuguese like the issue. Once the issue exists, the item keeps only the Solução's summary.
 */
export const NEW_ITEM_DESCRIPTION = "## Problema\n\nO que acontece hoje e quem sente.\n\n## Solução\n\nO que passa a acontecer, em uma ou duas frases.";

/** The confirm dialog before an item is deleted. */
export const deleteItemConfirm = (title: string): string => `Delete "${title}"? This can't be undone.`;

/** The line under Done: what it lists. */
export const recentDone = (days: number): string => `Went to Done in the last ${days} days`;

/** The button that switches Done between the last days and all of it. */
export const showRecentDone = (days: number): string => `Show only the last ${days} days`;
export const showAllDone = (count: number): string => `Show all (${count})`;

/** The ELIMS cards of the Project, which the Roadmap never shows. */
export const elimsNote = (count: number): string =>
  count === 1 ? "1 ELIMS issue on Project #7 is not shown here." : `${count} ELIMS issues on Project #7 are not shown here.`;
