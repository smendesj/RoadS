// Every GeoCloud issue RoadS creates is born with all the fields it can fill, so nothing is left
// empty on GitHub or on Project #7 (traceability). This module holds the choices and their ids.

import type { Effort, Prioridade } from "./types.ts";

export const TIPOS = ["feature", "bug", "chore", "spike"] as const;
export type Tipo = (typeof TIPOS)[number];

export const TIPO_LABELS: Record<Tipo, string> = { feature: "Feature", bug: "Bug", chore: "Chore", spike: "Spike" };

// Project #7 "Stack" options RoadS offers (option id on the board).
export const STACK_OPTION_IDS = {
  Modelagem: "e09b0f03",
  Backend: "eae17178",
  "Banco de dados": "8c95d28a",
  Frontend: "2713499c",
  Geral: "13d92ab6",
  "Teste Geral": "4e16cabd",
  "Teste Frontend": "d4d18955",
  "Teste Backend": "c9989fe9",
  Documentação: "5c6b368a",
  "Frontend/Backend": "a5e4159d",
  "Backend/IA": "887e719b",
  Testes: "de89f648",
  "Testes/Segurança": "a0c84fd1",
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

export const REPOSITORIO_GEOCLOUD_OPTION_ID = "80e4e855";

const AREAS: Partial<Record<Stack, ("frontend" | "backend")[]>> = {
  Backend: ["backend"],
  "Banco de dados": ["backend"],
  "Backend/IA": ["backend"],
  "Teste Backend": ["backend"],
  Frontend: ["frontend"],
  "Teste Frontend": ["frontend"],
  "Frontend/Backend": ["frontend", "backend"],
};

/** The labels an issue is created with: its type, the area its stack implies, and priority:high when it is. */
export function issueLabels(tipo: Tipo, stack: Stack, prioridade: Prioridade): string[] {
  return [
    `type:${tipo}`,
    ...(AREAS[stack] ?? []).map((a) => `area:${a}`),
    ...(prioridade === "Critical" || prioridade === "High" ? ["priority:high"] : []),
  ];
}

export function isTipo(v: unknown): v is Tipo {
  return typeof v === "string" && (TIPOS as readonly string[]).includes(v);
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
