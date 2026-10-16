// The Roadmap's Kanban on a narrow screen (below lg): one column at a time, picked by the tabs Open and Done. From lg
// both columns sit side by side and the tabs are not shown. While a card taken out of a week is carried (mouse or
// finger), Open shows whatever tab was picked, since dropping it there is how it is unplanned.
// Pure, so the rules run under test without a screen.

export type KanbanTab = "open" | "done";

export const KANBAN_TABS: { id: KanbanTab; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "done", label: "Done" },
];

/** The tab a narrow screen shows: the one picked, or Open while a card taken out of a week is carried. */
export function shownTab(picked: KanbanTab, carryingWeekCard: boolean): KanbanTab {
  return carryingWeekCard ? "open" : picked;
}

/** The display of a Kanban column: below lg only the shown tab's column, from lg every column. */
export function columnClass(column: KanbanTab, shown: KanbanTab): string {
  return column === shown ? "flex" : "hidden lg:flex";
}
