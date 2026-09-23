export type Role = "scrum_master" | "dev";
export type Produto = "GeoCloud" | "ELIMS";
export type Prioridade = "Critical" | "High" | "Medium" | "Low";
export type Effort = "Low" | "Medium" | "High" | "Very High";

export type Note = {
  id: string;
  author: Role;
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
