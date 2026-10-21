// The Roadmap's screen texts (issue #23), in English; the words every screen shares are in common.ts.

export const ROADMAP = {
  subtitleScrumMaster: "GeoCloud · decide what goes in and when",
  loading: "Loading...",
  newItem: "+ New item",
  moveTo: "Move to",
  moveToPlaceholder: "Move to…",
  kanbanNoWeek: "Kanban (no week)",
  done: "Done",
  addComment: "+ Comment",
  newComment: "New Comment",
  commentPlaceholder: "Write a Comment (optional)...",
  editComment: "Edit Comment",
  edited: "edited",
  deleteCommentConfirm: "Delete this Comment? It is also deleted on the issue.",
  noOpenIssues: "No open issues.",
  noIssuesHere: "No issues here.",
  allDone: "All issues in Done on the Project",
  planHint:
    "Drag a card from Open to a week to plan it; it stays in Open with the week marked. In a week, drop it on a card to put " +
    "the item before it. To unplan it, drag the card from the week back to Open. On a phone, hold the card and drag.",
} as const;

/** The confirm dialog before an item is deleted. */
export const deleteItemConfirm = (title: string): string => `Delete "${title}"? This can't be undone.`;

/** The line under Done: what it lists. */
export const recentDone = (days: number): string => `Went to Done in the last ${days} days`;

/** The button that switches Done between the last days and all of it. */
export const showRecentDone = (days: number): string => `Show only the last ${days} days`;
export const showAllDone = (count: number): string => `Show all (${count})`;

/** A sprint over its limit asks for the overflow to move out. */
export function sprintOverLimit(items: number, max: number): string {
  const extra = items - max;
  return `⚠️ This sprint has ${items} items, and the limit is ${max} issues per sprint. Move ${extra} ${extra === 1 ? "item" : "items"} to another sprint.`;
}

/** The ELIMS cards of the Project, which the Roadmap never shows. */
export const elimsNote = (count: number): string =>
  count === 1 ? "1 ELIMS issue on Project #7 is not shown here." : `${count} ELIMS issues on Project #7 are not shown here.`;
