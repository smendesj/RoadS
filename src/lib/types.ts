export type Role = "admin" | "scrum_master" | "dev";

/** Sprint lanes should hold at most this many items (the Roadmap groups below have no limit).
 *  Not enforced: a sprint over it shows n/4 and a warning asking for the overflow to move out. */
export const MAX_ITEMS_PER_SPRINT = 4;
/** Title a "+ Novo item" card starts with; it gets no GitHub issue until someone writes a real one. */
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
};
export type Produto = "GeoCloud"; // RoadS only handles GeoCloud; ELIMS issues are never pulled in.
export type Prioridade = "Critical" | "High" | "Medium" | "Low";
export type Effort = "Low" | "Medium" | "High" | "Very High";

export type Note = {
  id: string;
  author: ViewAs;
  when: string;
  text: string;
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
  /** Profile that created the item from RoadS; null for the seeded/GitHub-backed items. */
  createdBy?: string | null;
  /** The issue's Status on Project #7 (last snapshot), set only on sprint items; "done" shows as Concluído. */
  status?: "open" | "dev" | "blocker" | "done";
  notes: Note[];
};

export type Lane = {
  id: string;
  title: string;
  dates: string;
  items: RoadmapItem[];
};

export type RoadmapGroup = {
  id: string;
  title: string;
  items: RoadmapItem[];
};
