// The parts of an issue (decided on 15/10/2026, once the MVP's issues became top-level issues with at most five
// acceptance criteria): the boxes of its acceptance criteria, always, plus every sub-issue still open. A closed
// sub-issue (completed, not planned or a duplicate) is no part: the conversion closed them. A box is done when ticked;
// an open sub-issue is not done. Shared by the Dashboard's Sprint block (slices.ts) and the Resumo's collector, so
// both say the same "x de y".

import { criteriaBoxes, type Box } from "./criteria.ts";

export type Parts<S> = {
  /** The boxes of the acceptance criteria, in the order of the body. */
  boxes: Box[];
  /** The sub-issues still open, in the order given. */
  open: S[];
  total: number;
  done: number;
};

/** GraphQL says "OPEN", REST says "open"; anything else (closed, missing) is not open. */
export const isOpenIssue = (s: { state?: unknown }): boolean => typeof s.state === "string" && s.state.toLowerCase() === "open";

/** The parts of an issue from boxes already read. */
export function partsOf<S extends { state?: unknown }>(boxes: readonly Box[], subIssues: readonly S[]): Parts<S> {
  const open = subIssues.filter(isOpenIssue);
  return { boxes: [...boxes], open, total: boxes.length + open.length, done: boxes.filter((b) => b.checked).length };
}

/** The parts of an issue from its body and its sub-issues. */
export function issueParts<S extends { state?: unknown }>(body: string | null | undefined, subIssues: readonly S[]): Parts<S> {
  return partsOf(typeof body === "string" ? criteriaBoxes(body) ?? [] : [], subIssues);
}
