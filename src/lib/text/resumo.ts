// The texts of the Resumo screens (the Report) around the Prévia, and of the week's presentation, in
// English (issue #23). The Prévia (ProgressReportPreview and everything inside it, the e-mail it builds) and
// the report's own content (what the generator wrote for the board) stay in Portuguese and keep their texts
// where they are. Pure on purpose: no "server-only", no "@/" imports.
import type { EntryStatus } from "../progress-report.ts";

/** The name of the screen: the report for the board. */
export const RESUMO_NAME = "Report";

export const RESUMO = {
  pageTitle: `RoadS — ${RESUMO_NAME}`,
  heading: RESUMO_NAME,
  intro: "GeoCloud progress.",
  introReadOnly: "GeoCloud progress. Read only.",
  loadFailed: "The report could not be loaded right now. Reload the page in a moment.",
  /** What an admin sees when no report exists yet (nothing was ever pushed). */
  emptyDraft: "No draft yet. Start Frontlights and choose to update the report.",
  /** What a scrum master sees when nothing has been sent yet: they never see drafts. */
  emptySent: "No report sent yet.",
  latestSent: "This is the last report sent. When Frontlights sends a new draft, it shows up here.",
  sentHeading: "Sent",
  sentListFailed: "The list of sent reports could not be loaded.",
  sentOn: (stamp: string) => `sent on ${stamp}`,
  presentWeek: "Present the week",
} as const;

/** A delivery's status as the week's presentation names it (the e-mail keeps STATUS_LABEL, in Portuguese). */
export const STATUS: Record<EntryStatus, string> = {
  concluido: "Done",
  em_validacao: "In validation",
  em_andamento: "In progress",
  bloqueado: "Blocked",
  proximo: "Next",
};

export const WEEK = {
  pageTitle: "RoadS — Week",
  back: `← ${RESUMO_NAME}`,
  sections: "Week sections",
  fullScreen: "Full screen",
  exitFullScreen: "Exit full screen",
  heading: (product: string) => `${product}: the week's progress`,
  period: (label: string) => `Period: ${label}`,
  sprint: "In progress in the sprint",
  difficulties: "Difficulties",
  difficultiesHeading: "Difficulties and blockers",
  noBlockers: "No blockers.",
  needs: "What we need:",
  nextSteps: "Next steps",
  usage: "Claude usage",
  coverParts: (done: number, total: number) => `${done} of ${total} ${total === 1 ? "part" : "parts"}`,
  left: "Left:",
  otherShots: "Other screenshots",
  enlarge: (caption: string) => `Enlarge: ${caption || "screenshot"}`,
  enlarged: "Enlarged screenshot",
  /** The toggle above a print that has its before (the same screen before the change): the user's word, kept in Portuguese. */
  before: "antes",
  beforeOf: (caption: string) => `${caption || "screenshot"} (antes)`,
  screenOf: (product: string) => `${product} screen`,
  sessions: "sessions",
  messages: "messages",
  delivered: "deliveries done",
} as const;
