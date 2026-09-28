export type Role = "admin" | "scrum_master" | "dev";

/** Sprint lanes hold at most this many items (the Roadmap groups below have no limit). Also
 *  enforced server-side in roadmap.ts and in the DB by migration 0008. */
export const MAX_ITEMS_PER_SPRINT = 4;
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
export type Produto = "GeoCloud" | "ELIMS";
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
  /** Profile that created the item from RoadS; null for the seeded/GitHub-backed items. */
  createdBy?: string | null;
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
