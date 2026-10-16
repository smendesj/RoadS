// The e2e runs against the hosted database, the production one, and marks every item it creates with "[TESTE]" at the
// start of the title (scripts/e2e/lib.cjs cleans them up by that mark). Test data never reaches GitHub: an item so
// marked gets no issue, neither from the board sync nor on save, and an issue so marked on the Project is never imported
// into the Roadmap. The mark is reserved for test data; a real item whose title starts with it would get no issue.
import { NEW_ITEM_TITLE } from "./types.ts";

export const TEST_MARK = "[TESTE]";

/** Whether a title marks test data: it starts with "[TESTE]", leading whitespace tolerated. */
export function isTestData(title: string): boolean {
  return title.trimStart().startsWith(TEST_MARK);
}

/** Whether an item may get a GitHub issue created for it: it has none yet, has a real title (not the one "+ Novo item"
 *  starts with) and is not test data. The board sync also requires the item's product to be GeoCloud. */
export function mayGetIssue(item: { title: string; github_issue_url: string | null }): boolean {
  return !item.github_issue_url && item.title !== NEW_ITEM_TITLE && !isTestData(item.title);
}

/** The open issues the board sync may import into the Roadmap, in the order given: all but test data. */
export function importableIssues<T extends { title: string }>(issues: T[]): T[] {
  return issues.filter((i) => !isTestData(i.title));
}
