// An issue renamed on GitHub renames its item in the Roadmap, and only that. RoadS remembers the title the issue
// had the last time the sync looked (`githubTitle`): the item follows when the issue's title is no longer that.
// A title a person wrote in the Roadmap, different from the issue's, is left alone while the issue's title is
// unchanged; a rename on GitHub is the later word and takes it back. An item RoadS has never compared with its
// issue (`githubTitle` null) only learns what the issue is called, so it is never renamed on first sight.
//
// Pure on purpose: board-sync.ts reads the rows and the issues, applies the plan and queues each rename.

export type TitleCandidate = {
  id: string;
  /** What the Roadmap item says now. */
  title: string;
  /** What the issue was called when the sync last looked; null if it never did. */
  githubTitle: string | null;
  /** What the issue is called now. */
  issueTitle: string;
};

export type TitlePlan = {
  /** The issue was renamed on GitHub: the item takes the new title. */
  rename: { id: string; from: string; to: string }[];
  /** The issue's title to remember for next time: first sights and renames alike. */
  seen: { id: string; githubTitle: string }[];
};

export function planTitleFollow(items: TitleCandidate[]): TitlePlan {
  const plan: TitlePlan = { rename: [], seen: [] };
  for (const it of items) {
    const issue = it.issueTitle.trim();
    if (!issue) continue;
    if (it.githubTitle === null) {
      plan.seen.push({ id: it.id, githubTitle: issue });
    } else if (it.githubTitle.trim() !== issue) {
      plan.seen.push({ id: it.id, githubTitle: issue });
      if (it.title.trim() !== issue) plan.rename.push({ id: it.id, from: it.title, to: issue });
    }
  }
  return plan;
}
