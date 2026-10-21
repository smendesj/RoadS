// The Dashboard's screen texts, in English (issue #23). The words every screen shares are in common.ts; what the
// Sync buttons say after a sync is in src/lib/sync-message.ts.

import type { StatusKey } from "../board.ts";
import type { Tone } from "../tones.ts";

export const DASHBOARD = {
  title: "Dashboard",
  sprint: "Sprint",
  noSprintItems: "No items in the current sprint.",
  lastSync: "Last sync",
  footer: "RoadS · live data from GitHub Projects, Essencis-Labs #7",
} as const;

/** "x of y": the parts of an issue done, and the sprint's issues done. */
export const ofTotal = (done: number, total: number): string => `${done} of ${total}`;

/** An issue's (or a part's) pill in the Sprint block, by its column on the board: the Project's own Status names. */
export const STATUS_PILL: Record<StatusKey, { status: string; tone: Tone }> = {
  open: { status: "OPEN", tone: "neutral" },
  dev: { status: "DEVELOPMENT", tone: "brand" },
  blocker: { status: "BLOCKER", tone: "red" },
  done: { status: "DONE", tone: "green" },
};
/** A sprint item with no issue yet. */
export const NO_ISSUE_PILL = { status: "NO ISSUE", tone: "neutral" as Tone };

export const KPI = {
  development: "Development",
  noSprintThisWeek: "No sprint this week",
  done: "Done",
  committedThisWeek: "Committed this week",
  blockers: "Blockers",
  noneNow: "None now",
  inThisSprint: (n: number) => `${n} in this sprint`,
  outsideThisSprint: "Outside this sprint",
} as const;
