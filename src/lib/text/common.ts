// The words every screen shares, in English with the names GitHub uses (issue #23). Each area keeps its own texts in a
// module beside this one (roadmap.ts, dashboard.ts, account.ts, resumo.ts); the Resumo's Prévia stays in Portuguese
// and keeps its texts where they are.

export const ACTION = {
  sync: "Sync",
  syncing: "Syncing...",
  edit: "Edit",
  delete: "Delete",
  save: "Save",
  saving: "Saving...",
  cancel: "Cancel",
  close: "Close",
  back: "Back",
} as const;

/** The issue's and the board's field names, as GitHub shows them. */
export const FIELD = {
  title: "Title",
  description: "Description",
  type: "Type",
  stack: "Stack",
  priority: "Priority",
  effort: "Effort",
  status: "Status",
  week: "Week",
  assignees: "Assignees",
  comment: "Comment",
  comments: "Comments",
  product: "Product",
} as const;

export const VISITOR = "Visitor";
