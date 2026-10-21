import type { SprintSyncSummary } from "./sprint-status-sync.ts";

/** The generic line of a sync that failed without a message of its own. */
export const SYNC_FAILED = "Sync failed.";

// The line shown when a GitHub sync didn't run, the same wherever it was started from.
export function syncFailureMessage(result: { reason: string; message?: string }): string {
  if (result.reason === "not_configured") return "GitHub Sync is not configured yet (GITHUB_TOKEN is missing on the server).";
  if (result.reason === "unauthenticated") return result.message ?? "Sign in to sync the board.";
  return result.message ?? SYNC_FAILED;
}

// How the current sprint and the Project's Development followed each other; nothing when neither had to.
function sprintLine(sprint: SprintSyncSummary): string {
  if (sprint.error) return ` The current sprint did not follow the Project: ${sprint.error}.`;
  const parts = [
    sprint.pulled ? `${sprint.pulled} issue(s) pulled into the current sprint` : "",
    sprint.released ? `${sprint.released} returned to the Roadmap` : "",
    sprint.written ? `${sprint.written} status(es) written to the Project` : "",
    sprint.wouldWrite ? `${sprint.wouldWrite} status(es) would be written to the Project, but writing is off` : "",
    sprint.failed ? `${sprint.failed} failed` : "",
    sprint.stuck ? `${sprint.stuck} with no Roadmap block to return to` : "",
  ].filter(Boolean);
  return parts.length ? ` Current sprint and Project: ${parts.join(", ")}.` : "";
}

// What the Sync buttons say after a sync that ran: how many issues the Roadmap took in and let go.
export function roadmapSyncMessage(roadmap: {
  added: number;
  removed: number;
  issuesCreated: number;
  untyped?: number;
  error?: string;
  sprint?: SprintSyncSummary;
  retitled?: number;
  fields?: { pulled: number; pushed: number; failed: number; error?: string };
  comments?: { pulled: number; pushed: number; failed: number; error?: string };
  assignees?: { pulled: number; pushed: number; failed: number; error?: string };
}): string {
  if (roadmap.error) return roadmap.error;
  return (
    `${roadmap.added} issue(s) added, ${roadmap.removed} closed or off the Project removed` +
    (roadmap.issuesCreated ? `, ${roadmap.issuesCreated} issue(s) created for items without an issue.` : ".") +
    (roadmap.untyped ? ` ${roadmap.untyped} open issue(s) without a type:* label left out until they get a type.` : "") +
    (roadmap.fields ? fieldsLine(roadmap.fields) : roadmap.retitled ? ` ${roadmap.retitled} Roadmap title(s) followed the issue's rename on GitHub.` : "") +
    (roadmap.comments ? commentsLine(roadmap.comments) : "") +
    (roadmap.assignees ? assigneesLine(roadmap.assignees) : "") +
    (roadmap.sprint ? sprintLine(roadmap.sprint) : "")
  );
}

// The two-way sync of Assignees (issue #23): items whose Assignees came from GitHub or went there.
function assigneesLine(assignees: { pulled: number; pushed: number; failed: number; error?: string }): string {
  if (assignees.error) return ` Assignees did not sync: ${assignees.error}.`;
  const parts = [
    assignees.pulled ? `${assignees.pulled} item(s) pulled from GitHub` : "",
    assignees.pushed ? `${assignees.pushed} pushed to GitHub` : "",
    assignees.failed ? `${assignees.failed} failed` : "",
  ].filter(Boolean);
  return parts.length ? ` Assignees: ${parts.join(", ")}.` : "";
}

// The two-way sync of Comments (issue #23): created, edited or deleted on either side.
function commentsLine(comments: { pulled: number; pushed: number; failed: number; error?: string }): string {
  if (comments.error) return ` Comments did not sync: ${comments.error}.`;
  const parts = [
    comments.pulled ? `${comments.pulled} pulled from GitHub` : "",
    comments.pushed ? `${comments.pushed} pushed to GitHub` : "",
    comments.failed ? `${comments.failed} failed` : "",
  ].filter(Boolean);
  return parts.length ? ` Comments: ${parts.join(", ")}.` : "";
}

// The two-way sync of Title and Description (issue #22): what came from GitHub, what went there, what failed.
function fieldsLine(fields: { pulled: number; pushed: number; failed: number; error?: string }): string {
  if (fields.error) return ` Issue fields did not sync: ${fields.error}.`;
  const parts = [
    fields.pulled ? `${fields.pulled} field(s) pulled from GitHub` : "",
    fields.pushed ? `${fields.pushed} field(s) pushed to GitHub` : "",
    fields.failed ? `${fields.failed} item(s) failed` : "",
  ].filter(Boolean);
  return parts.length ? ` Issue fields: ${parts.join(", ")}.` : "";
}

// Whether a sync did anything worth telling: a page that syncs by itself every few minutes says nothing otherwise.
export function roadmapChanged(roadmap: Parameters<typeof roadmapSyncMessage>[0]): boolean {
  const s = roadmap.sprint;
  return Boolean(
    roadmap.error || roadmap.added || roadmap.removed || roadmap.issuesCreated || roadmap.retitled || roadmap.fields || roadmap.comments || roadmap.assignees ||
      (s && (s.error || s.pulled || s.released || s.written || s.wouldWrite || s.failed || s.stuck))
  );
}
// What the button says when the brake answered (a sync started less than 30 s ago, or is still running): nothing
// was read now, and that sync may have failed, so it never says it worked.
export function brakeMessage(retryInMs: number | undefined): string {
  if (retryInMs === undefined) return "A sync started less than 30 s ago or is still running; try again in a moment.";
  return `A sync started less than 30 s ago or is still running; the next one can run in ${Math.max(1, Math.ceil(retryInMs / 1000))} s.`;
}
