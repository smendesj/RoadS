export type Role = "admin" | "scrum_master" | "dev";

/** Sprint lanes should hold at most this many items (the type lanes, where an item with no week sits, have no limit).
 *  Not enforced: a sprint over it shows n/4 and a warning asking for the overflow to move out. */
export const MAX_ITEMS_PER_SPRINT = 4;
/** Title a "+ New item" card starts with; it gets no GitHub issue until someone writes a real one. */
export const NEW_ITEM_TITLE = "Novo item — edite a descrição";
/** The two working views a Roadmap card can render as. Admin can look through either one, or Config. */
export type ViewAs = "dev" | "scrum_master";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  title: string;
  role: Role;
  mustResetPassword: boolean;
  /** The GitHub login this profile is, which ties it to Assignees and to the comments on the issues (issue #23). */
  githubLogin: string | null;
};
export type Produto = "GeoCloud"; // RoadS only handles GeoCloud; ELIMS issues are never pulled in.
export type Prioridade = "Critical" | "High" | "Medium" | "Low";
export type Effort = "Low" | "Medium" | "High" | "Very High";

/** A Comment of an item: written in RoadS by a profile, or on the issue by a GitHub login (issue #23). */
export type Note = {
  id: string;
  author: ViewAs;
  when: string;
  text: string;
  /** The profile that wrote it in RoadS; null for a comment that came from GitHub. */
  authorId?: string | null;
  /** The name it is shown and signed with: the profile's name, or the GitHub login of a comment from there. */
  authorName?: string | null;
  /** Edited after it was written. */
  edited?: boolean;
};

export type RoadmapItem = {
  id: string;
  title: string;
  produto: Produto;
  prioridade: Prioridade;
  effort: Effort;
  desc: string;
  url: string | null;
  /** GitHub issue number, taken from the issue URL; null for items with no issue. */
  number?: number | null;
  /** Issue type (label type:*) and Project #7 Stack, kept to create the issue with every field filled. */
  tipo?: "feature" | "bug" | "chore" | "spike" | null;
  stack?: string | null;
  /** Profile that created the item from RoadS; null for the seeded/GitHub-backed items. */
  createdBy?: string | null;
  /** When the item was stored: the Kanban's Open lists the items with no issue on the board newest first. */
  createdAt?: string;
  /** The issue's Status on Project #7 (last snapshot), set only on sprint items; "done" shows as Done. */
  status?: "open" | "dev" | "blocker" | "done";
  /** The item's Assignees, as GitHub logins (issue #23); shown by the name of the profile with that login. */
  assignees?: string[];
  /** The item's own Status (issue #22), kept equal to its issue's by the sync: Done closes it, Blocker blocks it. */
  state?: "Open" | "Blocker" | "Done";
  notes: Note[];
};

/** A sprint lane: a week, titled by its dates ("Sprint 12–16/10"). */
export type Lane = {
  id: string;
  title: string;
  dates: string;
  /** The week's first day ("2026-10-12"), which names it on a Kanban card planned in it ("▸ Sprint 12/10"). */
  start?: string;
  /** The week whose dates hold today in São Paulo (src/lib/sprint-week.ts); at most one lane has it. */
  current?: boolean;
  /** A week shown on the Roadmap that the database doesn't have (a gap, or the empty one at the end of the row): it
   *  becomes a lane when an item is dropped on it (src/lib/week-plan.ts). */
  virtual?: boolean;
  items: RoadmapItem[];
};

export type RoadmapGroup = {
  id: string;
  title: string;
  items: RoadmapItem[];
};
