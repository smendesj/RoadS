import type { Effort, Prioridade, Produto } from "./types";

export type Tone = "neutral" | "red" | "amber" | "green" | "brand" | "indigo" | "teal" | "pink";

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  green: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  brand: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300",
};

export function prioridadeTone(p: Prioridade): Tone {
  return { Critical: "red", High: "brand", Medium: "amber", Low: "neutral" }[p] as Tone;
}

export function effortTone(e: Effort): Tone {
  return { Low: "green", Medium: "amber", High: "red", "Very High": "pink" }[e] as Tone;
}

export function produtoTone(p: Produto): Tone {
  return p === "ELIMS" ? "teal" : "indigo";
}

export function badgeClass(tone: Tone): string {
  return `inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ${TONE_CLASSES[tone]}`;
}
