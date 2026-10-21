import "server-only";

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
const STATUS_OPEN_OPTION = "f130aaf8";
const STATUS_DEVELOPMENT_OPTION = "4e4b0563";
// The two Statuses RoadS ever writes: Development is "in the current sprint", Open is everything else it plans.
const STATUS_OPTIONS = { Open: STATUS_OPEN_OPTION, Development: STATUS_DEVELOPMENT_OPTION } as const;
export type WritableStatus = keyof typeof STATUS_OPTIONS;
const PRIORIDADE_FIELD_ID = "PVTSSF_lADODk7xnc4BGkj4zhf1oXA";
const STACK_FIELD_ID = "PVTSSF_lADODk7xnc4BGkj4zhfusOE";
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
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}${json?.message ? `: ${json.message}` : ""}`);
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
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status} ao ler a issue`);
  const json: { labels?: (string | { name?: string })[] } = await res.json();
  return (json.labels ?? []).map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean);
}

function issueBody(description: string, effort: Effort): string {
  return [
    "## Por que entrou na fila",
    "",
    description.trim() || "Item criado no Roadmap do RoadS; descrição ainda por escrever.",
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
  const nodes: { id?: string; options?: { id: string }[] }[] = json?.data?.node?.fields?.nodes ?? [];
  return new Map(nodes.filter((n) => n.id).map((n) => [n.id!, n.options ? new Set(n.options.map((o) => o.id)) : null]));
}

type FieldValue = { singleSelectOptionId: string } | { text: string };

/**
 * Opens the issue with its labels and puts it on Project #7 with every field it can fill: Status (Open
 * unless it is born in the current sprint), Prioridade, Stack and Description, each matched by id against the
 * live board. Effort has no options on the board yet, so it goes in the issue body. Returns its URL, number and
 * the names of the fields it skipped because the board no longer has the field or the option.
 */
export async function createGeoCloudIssue(
  token: string,
  fields: NewIssueFields,
  status: WritableStatus = "Open",
  port: GitHubPort = {}
): Promise<{ url: string; number: number; skipped: string[] }> {
  const { title, description, prioridade, effort, tipo, stack } = fields;
  const issue = await github(
    token,
    `/repos/${GEOCLOUD_REPO}/issues`,
    { method: "POST", body: { title, body: issueBody(description, effort), labels: issueLabels(tipo, stack, prioridade) } },
    port
  );

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
    ["Prioridade", PRIORIDADE_FIELD_ID, { singleSelectOptionId: PRIORIDADE_OPTION_IDS[prioridade] }],
    ["Stack", STACK_FIELD_ID, { singleSelectOptionId: STACK_OPTION_IDS[stack] }],
    ["Description", DESCRIPTION_FIELD_ID, { text: description.trim() || title }],
  ];
  const skipped: string[] = [];
  for (const [name, field, value] of wanted) {
    if (!fitsBoard(layout, field, value)) skipped.push(name);
    else await setField(token, item, field, value, port);
  }

  return { url: issue.html_url, number: issue.number, skipped };
}

/** Writes an issue's title and/or body (the two-way sync of issue #22); nothing else of the issue is sent. */
export async function updateIssue(token: string, number: number, change: { title?: string; body?: string }, port: GitHubPort = {}): Promise<void> {
  const body: { title?: string; body?: string } = {};
  if (change.title !== undefined) body.title = change.title;
  if (change.body !== undefined) body.body = change.body;
  await github(token, `/repos/${GEOCLOUD_REPO}/issues/${number}`, { method: "PATCH", body }, port);
}

/** When each issue was last renamed and its body last edited, read in one request; null when it never was. */
export async function readIssueChangeTimes(
  token: string,
  numbers: number[],
  port: GitHubPort = {}
): Promise<Map<number, { titleAt: string | null; bodyAt: string | null }>> {
  const times = new Map<number, { titleAt: string | null; bodyAt: string | null }>();
  if (!numbers.length) return times;
  const [owner, name] = GEOCLOUD_REPO.split("/");
  const fields = numbers
    .map(
      (n) => `i${n}: issue(number: ${Number(n)}) { lastEditedAt
        timelineItems(itemTypes: [RENAMED_TITLE_EVENT], last: 1) { nodes { ... on RenamedTitleEvent { createdAt } } } }`
    )
    .join("\n");
  const json = await github(
    token,
    "/graphql",
    { method: "POST", body: { query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, variables: { owner, name } } },
    port
  );
  const repo: Record<string, { lastEditedAt: string | null; timelineItems?: { nodes: { createdAt?: string }[] } } | null> =
    json?.data?.repository ?? {};
  for (const n of numbers) {
    const issue = repo[`i${n}`];
    times.set(n, { titleAt: issue?.timelineItems?.nodes?.[0]?.createdAt ?? null, bodyAt: issue?.lastEditedAt ?? null });
  }
  return times;
}

/** One comment of an issue, as the two-way sync of Comments reads it (comment-sync.ts). */
export type IssueComment = { id: number; body: string; updatedAt: string; login: string | null; bot: boolean };

const COMMENTS_PAGE = 100;

/**
 * The comments of each issue, read in one request. An issue with more comments than one page holds is left out of
 * the map: the sync then leaves its Comments alone, since a comment it did not read would look deleted.
 */
export async function readIssueComments(token: string, numbers: number[], port: GitHubPort = {}): Promise<Map<number, IssueComment[]>> {
  const comments = new Map<number, IssueComment[]>();
  if (!numbers.length) return comments;
  const [owner, name] = GEOCLOUD_REPO.split("/");
  const fields = numbers
    .map(
      (n) => `i${n}: issue(number: ${Number(n)}) { comments(first: ${COMMENTS_PAGE}) { totalCount
        nodes { databaseId body updatedAt author { login __typename } } } }`
    )
    .join("\n");
  const json = await github(
    token,
    "/graphql",
    { method: "POST", body: { query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, variables: { owner, name } } },
    port
  );
  type Node = { databaseId: number; body: string; updatedAt: string; author: { login: string; __typename: string } | null };
  const repo: Record<string, { comments: { totalCount: number; nodes: Node[] } } | null> = json?.data?.repository ?? {};
  for (const n of numbers) {
    const issue = repo[`i${n}`];
    if (!issue || issue.comments.totalCount > issue.comments.nodes.length) continue;
    comments.set(
      n,
      issue.comments.nodes.map((c) => ({
        id: c.databaseId,
        body: c.body,
        updatedAt: c.updatedAt,
        login: c.author?.login ?? null,
        bot: c.author?.__typename === "Bot",
      }))
    );
  }
  return comments;
}

/** Writes a new comment on an issue; answers its id and time, which the Comment keeps so it never comes back as new. */
export async function createIssueComment(token: string, number: number, body: string, port: GitHubPort = {}): Promise<{ id: number; updatedAt: string }> {
  const json = await github(token, `/repos/${GEOCLOUD_REPO}/issues/${number}/comments`, { method: "POST", body: { body } }, port);
  return { id: json.id, updatedAt: json.updated_at };
}

export async function updateIssueComment(token: string, commentId: number, body: string, port: GitHubPort = {}): Promise<void> {
  await github(token, `/repos/${GEOCLOUD_REPO}/issues/comments/${commentId}`, { method: "PATCH", body: { body } }, port);
}

export async function deleteIssueComment(token: string, commentId: number, port: GitHubPort = {}): Promise<void> {
  await github(token, `/repos/${GEOCLOUD_REPO}/issues/comments/${commentId}`, { method: "DELETE", body: undefined }, port);
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
