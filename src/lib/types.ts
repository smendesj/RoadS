export type Role = "admin" | "scrum_master" | "dev";
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
