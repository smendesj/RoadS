// Every GeoCloud issue RoadS creates is born with all the fields it can fill, so nothing is left
// empty on GitHub or on Project #7 (traceability). This module holds the choices and their ids.

import type { Effort, Prioridade } from "./types.ts";

export const TIPOS = ["feature", "bug", "chore", "spike"] as const;
export type Tipo = (typeof TIPOS)[number];

export const TIPO_LABELS: Record<Tipo, string> = { feature: "Feature", bug: "Bug", chore: "Chore", spike: "Spike" };

// Project #7 "Stack" options RoadS offers (option id on the board). RoadS names them in English (issue #22); the
// board's own names may still be the old Portuguese ones until they are renamed there: the id is what matches.
export const STACK_OPTION_IDS = {
  Modeling: "e09b0f03",
  Backend: "eae17178",
  Database: "8c95d28a",
  Frontend: "2713499c",
  General: "13d92ab6",
  "General Tests": "4e16cabd",
  "Frontend Tests": "d4d18955",
  "Backend Tests": "c9989fe9",
  Documentation: "5c6b368a",
  "Frontend/Backend": "a5e4159d",
  "Backend/IA": "887e719b",
  Tests: "de89f648",
  "Security Tests": "a0c84fd1",
  Infra: "08898dea",
  Mobile: "1f5e972d",
} as const;
export type Stack = keyof typeof STACK_OPTION_IDS;
export const STACKS = Object.keys(STACK_OPTION_IDS) as Stack[];

export const PRIORIDADE_OPTION_IDS: Record<Prioridade, string> = {
  Critical: "313dc1cb",
  High: "3b456fae",
  Medium: "6acd6fa8",
  Low: "77fe47cd",
};

/** The Stack a board option is, or null for an option RoadS doesn't offer (or no option at all). */
export function stackOfOption(id: string | undefined): Stack | null {
  return STACKS.find((s) => STACK_OPTION_IDS[s] === id) ?? null;
}

/** The Priority a board option is, or null. */
export function prioridadeOfOption(id: string | undefined): Prioridade | null {
  return (Object.keys(PRIORIDADE_OPTION_IDS) as Prioridade[]).find((p) => PRIORIDADE_OPTION_IDS[p] === id) ?? null;
}

const AREAS: Partial<Record<Stack, ("frontend" | "backend")[]>> = {
  Backend: ["backend"],
  Database: ["backend"],
  "Backend/IA": ["backend"],
  "Backend Tests": ["backend"],
  Frontend: ["frontend"],
  "Frontend Tests": ["frontend"],
  "Frontend/Backend": ["frontend", "backend"],
};

/** The area: labels a Stack implies. */
export function areaLabels(stack: Stack): string[] {
  return (AREAS[stack] ?? []).map((a) => `area:${a}`);
}

/** Whether a Priority implies the priority:high label. */
export function isHighPriority(prioridade: Prioridade): boolean {
  return prioridade === "Critical" || prioridade === "High";
}

/** The labels an issue is created with: its type, the area its stack implies, and priority:high when it is. */
export function issueLabels(tipo: Tipo, stack: Stack, prioridade: Prioridade): string[] {
  return [`type:${tipo}`, ...areaLabels(stack), ...(isHighPriority(prioridade) ? ["priority:high"] : [])];
}

export function isTipo(v: unknown): v is Tipo {
  return typeof v === "string" && (TIPOS as readonly string[]).includes(v);
}
export const EFFORTS: readonly Effort[] = ["Low", "Medium", "High"];
export function isEffort(v: unknown): v is Effort {
  return typeof v === "string" && (EFFORTS as readonly string[]).includes(v);
}
export function isStack(v: unknown): v is Stack {
  return typeof v === "string" && Object.hasOwn(STACK_OPTION_IDS, v);
}

export type NewIssueFields = {
  title: string;
  description: string;
  prioridade: Prioridade;
  effort: Effort;
  tipo: Tipo;
  stack: Stack;
};
