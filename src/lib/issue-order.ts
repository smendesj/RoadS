// Every block of RoadS lists its issues from the highest number to the lowest: the newest first. Items with no
// issue yet go last, in the order they had. The exceptions: the Roadmap's Kanban follows the order of the Kanban
// view on GitHub (kanbanSort in board.ts), and a week (the Roadmap's sprints and the Dashboard's Sprint block) keeps
// the order the scrum master gave it by dragging (sort_order).
export function newestIssueFirst<T>(items: T[], numberOf: (item: T) => number | null | undefined): T[] {
  const key = (item: T) => numberOf(item) ?? -Infinity;
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => key(b.item) - key(a.item) || a.i - b.i)
    .map(({ item }) => item);
}
