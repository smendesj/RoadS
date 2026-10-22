import "server-only";

import { extractResumo, extractSolucao } from "@/lib/bilateral-sync";
import { issueLabels, PRIORIDADE_OPTION_IDS, STACK_OPTION_IDS, type NewIssueFields } from "@/lib/issue-fields";
import type { Effort } from "@/lib/types";

// GitHub writes the Roadmap needs. GeoCloud items are GeoCloud issues: born in
// Essencis-Labs/GeoCloudAI and placed on Project #7 with Status "Open", the backlog column a
// Scrum Master picks sprint work from (or "Development" when the item is born in the current sprint,
// so its own creation doesn't read as a disagreement with the Project; see sprint-status-sync.ts).
// Uses the same GITHUB_TOKEN as the board sync (a classic PAT with repo + read:org + project).

export const GEOCLOUD_REPO = "Essencis-Labs/GeoCloudAI";
const PROJECT_ID = "PVT_kwDODk7xnc4BGkj4"; // Essencis-Labs Project #7
const STATUS_FIELD_ID = "PVTSSF_lADODk7xnc4BGkj4zg3k_9Q";
// The Statuses RoadS writes: Development is "in the current sprint", Open is everything else it plans, and an item's
// own Blocker and Done (issue #22).
const STATUS_OPTIONS = { Open: "f130aaf8", Development: "4e4b0563", Blocker: "95ee425e", Done: "9487135d" } as const;
export type WritableStatus = keyof typeof STATUS_OPTIONS;
export const PRIORIDADE_FIELD_ID = "PVTSSF_lADODk7xnc4BGkj4zhf1oXA";
export const STACK_FIELD_ID = "PVTSSF_lADODk7xnc4BGkj4zhfusOE";
// Effort is not a Project field: the board's Effort only mirrors the organization's issue field, whose value lives on the
// issue itself (issue #23). It is read and written there, its options by id.
const EFFORT_ISSUE_FIELD_ID = "IFSS_kgDOAjkpfQ";
const EFFORT_OPTION_IDS: Record<Effort, string> = { High: "IFSSO_kgDOA-Pwsw", Medium: "IFSSO_kgDOA-PwtA", Low: "IFSSO_kgDOA-PwtQ" };
const DESCRIPTION_FIELD_ID = "PVTF_lADODk7xnc4BGkj4zhfubog";
// The board's own "Repositório" field is never written: the product comes from the native Repository field, so the
// board can drop the custom one (issue #22).

/** The network, as a port: every GitHub call below takes it, so the tests run against a fake GitHub. */
export type GitHubPort = { fetch?: typeof fetch };

async function github(token: string, path: string, init: { method: string; body: unknown }, { fetch: fetchImpl = fetch }: GitHubPort = {}) {
  const res = await fetchImpl(`https://api.github.com${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify(init.body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GitHub answered ${res.status}${json?.message ? `: ${json.message}` : ""}`);
  if (json?.errors?.length) throw new Error(json.errors[0].message);
  return json;
}

/** How long unplanning waits for an issue's labels before it goes by the stored type instead. */
export const LABELS_TIMEOUT_MS = 5000;

/**
 * The labels of a GeoCloud issue, read now (a type:* label names the type lane its item goes back to). Gives up
 * after `timeoutMs` (a TimeoutError), so a slow GitHub never holds the move that waits on it; the caller then falls
 * back to the stored type, as with no token. `fetch` is a port for the tests.
 */
export async function readIssueLabels(
  token: string,
  number: number,
  { fetch: fetchImpl = fetch, timeoutMs = LABELS_TIMEOUT_MS }: { fetch?: typeof fetch; timeoutMs?: number } = {}
): Promise<string[]> {
  const res = await fetchImpl(`https://api.github.com/repos/${GEOCLOUD_REPO}/issues/${number}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} reading the issue`);
  const json: { labels?: (string | { name?: string })[] } = await res.json();
  return (json.labels ?? []).map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean);
}

/**
 * A new issue's body (issue #28): the item's Problema › Solução text opens it, then the effort and the criteria. A text
 * without a Solução heading (an old draft, or a template the user cleared) becomes the Solução, under a Problema still
 * to be written, so every body has the section the sync reads the item's summary from.
 */
export function issueBody(description: string, effort: Effort): string {
  const text = description.replace(/\r\n?/g, "\n").trim();
  const opening =
    extractSolucao(text) !== null
      ? text
      : ["## Problema", "", "Item criado no Roadmap do RoadS; problema ainda por escrever.", "", "## Solução", "", text || "Solução ainda por escrever."].join("\n");
  return [
    opening,
    "",
    `**Esforço estimado:** ${effort}`,
    "",
    "## Critérios de aceite",
    "",
    "- [ ] A definir antes de entrar em uma sprint.",
    "",
    "_Criada pelo RoadS a partir do Roadmap._",
  ].join("\n");
}

/**
 * The board as it is now: each field's id with the ids of its options (null for a field without options, such as
 * a text field). RoadS matches fields and options by id, and a value whose option the board no longer has is
 * skipped instead of written, so renaming a field or an option on GitHub never breaks RoadS.
 */
export async function readBoardLayout(token: string, port: GitHubPort = {}): Promise<Map<string, Set<string> | null>> {
  const options = await readBoardOptions(token, port);
  return new Map([...options].map(([field, opts]) => [field, opts ? new Set(opts.keys()) : null]));
}

/** The board's fields, each with its options' ids and names (null for a field without options). */
export async function readBoardOptions(token: string, port: GitHubPort = {}): Promise<Map<string, Map<string, string> | null>> {
  return (await readBoardFields(token, port)).options;
}

/**
 * The board's fields: each one's options (as readBoardOptions) and each field's id by its name, for a field the board
 * gets once by hand and whose id RoadS can't know beforehand (Week, issue #22).
 */
export async function readBoardFields(
  token: string,
  port: GitHubPort = {}
): Promise<{ options: Map<string, Map<string, string> | null>; byName: Map<string, string> }> {
  const json = await github(
    token,
    "/graphql",
    {
      method: "POST",
      body: {
        query: `query($project: ID!) { node(id: $project) { ... on ProjectV2 { fields(first: 50) { nodes {
          ... on ProjectV2FieldCommon { id name }
          ... on ProjectV2SingleSelectField { options { id name } }
        } } } } }`,
        variables: { project: PROJECT_ID },
      },
    },
    port
  );
  const nodes: { id?: string; name?: string; options?: { id: string; name: string }[] }[] = (json?.data?.node?.fields?.nodes ?? []).filter((n: { id?: string }) => n.id);
  return {
    options: new Map(nodes.map((n) => [n.id!, n.options ? new Map(n.options.map((o) => [o.id, o.name])) : null])),
    byName: new Map(nodes.filter((n) => n.name).map((n) => [n.name!, n.id!])),
  };
}

type FieldValue = { singleSelectOptionId: string } | { text: string } | { date: string };

/**
 * Opens the issue with its labels and its Effort (the issue's own field), and puts it on Project #7 with every field
 * it can fill: Status (Open unless it is born in the current sprint), Prioridade, Stack and Description, each matched
 * by id against the live board, the Description with the body's summary only. Returns its URL, number, the names of the
 * fields it skipped (an Effort GitHub refused, or a field or option the board no longer has) and that summary, the
 * item's Description from then on ("" for a body without one, as the sync reads it).
 */
export async function createGeoCloudIssue(
  token: string,
  fields: NewIssueFields,
  status: WritableStatus = "Open",
  port: GitHubPort = {}
): Promise<{ url: string; number: number; skipped: string[]; resumo: string }> {
  const { title, description, prioridade, effort, tipo, stack } = fields;
  const body = issueBody(description, effort);
  const resumo = extractResumo(body) ?? "";
  const issue = await github(
    token,
    `/repos/${GEOCLOUD_REPO}/issues`,
    { method: "POST", body: { title, body, labels: issueLabels(tipo, stack, prioridade) } },
    port
  );
  const skipped: string[] = [];
  await setIssueEffort(token, issue.node_id, effort, port).catch(() => skipped.push("Effort"));

  const added = await github(
    token,
    "/graphql",
    {
      method: "POST",
      body: {
        query: `mutation($project: ID!, $content: ID!) {
        addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
      }`,
        variables: { project: PROJECT_ID, content: issue.node_id },
      },
    },
    port
  );
  const item: string = added.data.addProjectV2ItemById.item.id;

  const layout = await readBoardLayout(token, port);
  const wanted: [string, string, FieldValue][] = [
    ["Status", STATUS_FIELD_ID, { singleSelectOptionId: STATUS_OPTIONS[status] }],
    ["Priority", PRIORIDADE_FIELD_ID, { singleSelectOptionId: PRIORIDADE_OPTION_IDS[prioridade] }],
    ["Stack", STACK_FIELD_ID, { singleSelectOptionId: STACK_OPTION_IDS[stack] }],
    ["Description", DESCRIPTION_FIELD_ID, { text: resumo || title }],
  ];
  for (const [name, field, value] of wanted) {
    if (!fitsBoard(layout, field, value)) skipped.push(name);
    else await setField(token, item, field, value, port);
  }

  return { url: issue.html_url, number: issue.number, skipped, resumo };
}

export type IssueChange = {
  title?: string;
  body?: string;
  labels?: string[];
  type?: string;
  state?: "open" | "closed";
  state_reason?: "completed" | "reopened" | "not_planned";
};

/**
 * Writes what changed of an issue (the two-way sync of issue #22): its title, body, the whole list of its labels, its
 * native type by name, and its state with the reason (closed as completed, reopened); only the keys given are sent.
 */
export async function updateIssue(token: string, number: number, change: IssueChange, port: GitHubPort = {}): Promise<void> {
  const body: IssueChange = {};
  for (const key of ["title", "body", "labels", "type", "state", "state_reason"] as const) {
    if (change[key] !== undefined) Object.assign(body, { [key]: change[key] });
  }
  await github(token, `/repos/${GEOCLOUD_REPO}/issues/${number}`, { method: "PATCH", body }, port);
}

/** A Delete in RoadS: the issue gets `comment` (who deleted it), then is closed as not planned. Reopening it brings the item back. */
export async function closeIssueAsNotPlanned(token: string, number: number, comment: string, port: GitHubPort = {}): Promise<void> {
  await github(token, `/repos/${GEOCLOUD_REPO}/issues/${number}/comments`, { method: "POST", body: { body: comment } }, port);
  await updateIssue(token, number, { state: "closed", state_reason: "not_planned" }, port);
}

/**
 * An issue's state and body now, in one request: an item whose issue is closed isn't among the open issues the sync
 * reads, and it still follows the issue's state and, since issue #34, its Description (the body's Solução), so both come
 * from this one read. A body GitHub leaves empty reads as "".
 */
export async function readIssue(token: string, number: number, { fetch: fetchImpl = fetch }: GitHubPort = {}): Promise<{ state: "open" | "closed"; body: string }> {
  const res = await fetchImpl(`https://api.github.com/repos/${GEOCLOUD_REPO}/issues/${number}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} reading the issue`);
  const json: { state?: string; body?: string | null } = await res.json();
  return { state: json.state === "closed" ? "closed" : "open", body: json.body ?? "" };
}

/** Whether an issue is open or closed now (an item RoadS moved out of Done may hold a closed issue the sync didn't list). */
export async function readIssueState(token: string, number: number, port: GitHubPort = {}): Promise<"open" | "closed"> {
  return (await readIssue(token, number, port)).state;
}

export type IssueChangeTimes = { titleAt: string | null; bodyAt: string | null; labelAt: string | null };

/** When each issue was last renamed, its body last edited and a label last put or taken, in one request; null when never. */
export async function readIssueChangeTimes(token: string, numbers: number[], port: GitHubPort = {}): Promise<Map<number, IssueChangeTimes>> {
  const times = new Map<number, IssueChangeTimes>();
  if (!numbers.length) return times;
  const [owner, name] = GEOCLOUD_REPO.split("/");
  const fields = numbers
    .map(
      (n) => `i${n}: issue(number: ${Number(n)}) { lastEditedAt
        timelineItems(itemTypes: [RENAMED_TITLE_EVENT], last: 1) { nodes { ... on RenamedTitleEvent { createdAt } } }
        labelEvents: timelineItems(itemTypes: [LABELED_EVENT, UNLABELED_EVENT], last: 1) {
          nodes { ... on LabeledEvent { createdAt } ... on UnlabeledEvent { createdAt } } } }`
    )
    .join("\n");
  const json = await github(
    token,
    "/graphql",
    { method: "POST", body: { query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, variables: { owner, name } } },
    port
  );
  type Events = { nodes: { createdAt?: string }[] };
  const repo: Record<string, { lastEditedAt: string | null; timelineItems?: Events; labelEvents?: Events } | null> = json?.data?.repository ?? {};
  for (const n of numbers) {
    const issue = repo[`i${n}`];
    times.set(n, {
      titleAt: issue?.timelineItems?.nodes?.[0]?.createdAt ?? null,
      bodyAt: issue?.lastEditedAt ?? null,
      labelAt: issue?.labelEvents?.nodes?.[0]?.createdAt ?? null,
    });
  }
  return times;
}

/** One comment of an issue, as the two-way sync of Comments reads it (comment-sync.ts). */
/** Writes a new comment on an issue; answers its id and time, which the Comment keeps so it never comes back as new. */
export async function createIssueComment(token: string, number: number, body: string, port: GitHubPort = {}): Promise<{ id: number; updatedAt: string }> {
  const json = await github(token, `/repos/${GEOCLOUD_REPO}/issues/${number}/comments`, { method: "POST", body: { body } }, port);
  return { id: json.id, updatedAt: json.updated_at };
}

/**
 * The assignees of each issue (their GitHub logins) and when someone last assigned or unassigned one, read in one
 * request; an issue not found is left out.
 */
export async function readIssueAssignees(
  token: string,
  numbers: number[],
  port: GitHubPort = {}
): Promise<Map<number, { logins: string[]; changedAt: string | null }>> {
  const assignees = new Map<number, { logins: string[]; changedAt: string | null }>();
  if (!numbers.length) return assignees;
  const [owner, name] = GEOCLOUD_REPO.split("/");
  const fields = numbers
    .map(
      (n) => `i${n}: issue(number: ${Number(n)}) { assignees(first: 20) { nodes { login } }
        timelineItems(itemTypes: [ASSIGNED_EVENT, UNASSIGNED_EVENT], last: 1) {
          nodes { ... on AssignedEvent { createdAt } ... on UnassignedEvent { createdAt } } } }`
    )
    .join("\n");
  const json = await github(
    token,
    "/graphql",
    { method: "POST", body: { query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, variables: { owner, name } } },
    port
  );
  type Issue = { assignees: { nodes: { login: string }[] }; timelineItems?: { nodes: { createdAt?: string }[] } };
  const repo: Record<string, Issue | null> = json?.data?.repository ?? {};
  for (const n of numbers) {
    const issue = repo[`i${n}`];
    if (issue) assignees.set(n, { logins: issue.assignees.nodes.map((a) => a.login), changedAt: issue.timelineItems?.nodes?.[0]?.createdAt ?? null });
  }
  return assignees;
}

/** Sets an issue's assignees to exactly these logins; nothing else of the issue is sent. */
export async function setIssueAssignees(token: string, number: number, logins: string[], port: GitHubPort = {}): Promise<void> {
  await github(token, `/repos/${GEOCLOUD_REPO}/issues/${number}`, { method: "PATCH", body: { assignees: logins } }, port);
}

/**
 * The Effort of each issue, from the organization's issue field, with the issue's node id (what a write needs), read
 * in one request; null when the issue leaves it empty. An issue not found, or whose Effort holds an option RoadS
 * doesn't offer, is left out, so its Effort is left alone.
 */
export async function readIssueEfforts(
  token: string,
  numbers: number[],
  port: GitHubPort = {}
): Promise<Map<number, { issueId: string; effort: Effort | null }>> {
  const efforts = new Map<number, { issueId: string; effort: Effort | null }>();
  if (!numbers.length) return efforts;
  const [owner, name] = GEOCLOUD_REPO.split("/");
  const fields = numbers
    .map(
      (n) => `i${n}: issue(number: ${Number(n)}) { id issueFieldValues(first: 20) { nodes { __typename
        ... on IssueFieldSingleSelectValue { name optionId field { ... on IssueFieldSingleSelect { id name } } } } } }`
    )
    .join("\n");
  const json = await github(
    token,
    "/graphql",
    { method: "POST", body: { query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, variables: { owner, name } } },
    port
  );
  type Value = { optionId?: string; name?: string; field?: { id?: string } };
  const repo: Record<string, { id: string; issueFieldValues?: { nodes: Value[] } } | null> = json?.data?.repository ?? {};
  for (const n of numbers) {
    const issue = repo[`i${n}`];
    if (!issue) continue;
    const value = issue.issueFieldValues?.nodes?.find((v) => v?.field?.id === EFFORT_ISSUE_FIELD_ID);
    if (!value) {
      efforts.set(n, { issueId: issue.id, effort: null });
      continue;
    }
    const effort = (Object.keys(EFFORT_OPTION_IDS) as Effort[]).find((e) => EFFORT_OPTION_IDS[e] === value.optionId);
    if (effort) efforts.set(n, { issueId: issue.id, effort });
  }
  return efforts;
}

/** Writes an issue's Effort to the organization's issue field by the option's id (`issueId` is the issue's node id); null clears it. */
export async function setIssueEffort(token: string, issueId: string, effort: Effort | null, port: GitHubPort = {}): Promise<void> {
  const body = effort
    ? {
        query: `mutation($issueId: ID!, $fieldId: ID!, $optionId: ID!) {
        setIssueFieldValue(input: { issueId: $issueId, issueFields: [{ fieldId: $fieldId, singleSelectOptionId: $optionId }] }) { issue { number } }
      }`,
        variables: { issueId, fieldId: EFFORT_ISSUE_FIELD_ID, optionId: EFFORT_OPTION_IDS[effort] },
      }
    : {
        query: `mutation($issueId: ID!, $fieldId: ID!) {
        deleteIssueFieldValue(input: { issueId: $issueId, fieldId: $fieldId }) { success }
      }`,
        variables: { issueId, fieldId: EFFORT_ISSUE_FIELD_ID },
      };
  await github(token, "/graphql", { method: "POST", body }, port);
}

function fitsBoard(layout: Map<string, Set<string> | null>, field: string, value: FieldValue): boolean {
  if (!layout.has(field)) return false;
  const options = layout.get(field);
  return "singleSelectOptionId" in value ? Boolean(options?.has(value.singleSelectOptionId)) : options === null;
}

/**
 * Writes a card's Status on Project #7: the sprint sync's one write to a card that already exists. `projectItemId`
 * is the card's id on the Project (projectCard in board.ts), not the issue's; callers only ever hold GeoCloud cards.
 */
export async function setProjectStatus(token: string, projectItemId: string, status: WritableStatus, port: GitHubPort = {}): Promise<void> {
  await setField(token, projectItemId, STATUS_FIELD_ID, { singleSelectOptionId: STATUS_OPTIONS[status] }, port);
}

/** Writes one single-select field of a card on Project #7, field and option by id (Stack, Priority). */
export async function setProjectOption(token: string, projectItemId: string, field: string, optionId: string, port: GitHubPort = {}): Promise<void> {
  await setField(token, projectItemId, field, { singleSelectOptionId: optionId }, port);
}

/** Writes a date field of a card on Project #7 (the Week: the Monday of the item's week). */
export async function setProjectDate(token: string, projectItemId: string, field: string, date: string, port: GitHubPort = {}): Promise<void> {
  await setField(token, projectItemId, field, { date }, port);
}

/** Empties a field of a card on Project #7 (the Week of an item taken out of its week). */
export async function clearProjectField(token: string, projectItemId: string, field: string, port: GitHubPort = {}): Promise<void> {
  await github(
    token,
    "/graphql",
    {
      method: "POST",
      body: {
        query: `mutation($project: ID!, $item: ID!, $field: ID!) {
        clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field }) { projectV2Item { id } }
      }`,
        variables: { project: PROJECT_ID, item: projectItemId, field },
      },
    },
    port
  );
}

function setField(token: string, item: string, field: string, value: FieldValue, port: GitHubPort = {}) {
  return github(
    token,
    "/graphql",
    {
      method: "POST",
      body: {
        query: `mutation($project: ID!, $item: ID!, $field: ID!, $value: ProjectV2FieldValue!) {
        updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: $value }) { projectV2Item { id } }
      }`,
        variables: { project: PROJECT_ID, item, field, value },
      },
    },
    port
  );
}
