import "server-only";

import { issueLabels, PRIORIDADE_OPTION_IDS, REPOSITORIO_GEOCLOUD_OPTION_ID, STACK_OPTION_IDS, type NewIssueFields } from "@/lib/issue-fields";
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
const REPOSITORIO_FIELD_ID = "PVTSSF_lADODk7xnc4BGkj4zhf1mt4";
const STACK_FIELD_ID = "PVTSSF_lADODk7xnc4BGkj4zhfusOE";
const DESCRIPTION_FIELD_ID = "PVTF_lADODk7xnc4BGkj4zhfubog";

async function github(token: string, path: string, init: { method: string; body: unknown }) {
  const res = await fetch(`https://api.github.com${path}`, {
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
 * Opens the issue with its labels and puts it on Project #7 with every field it can fill: Status (Open
 * unless it is born in the current sprint), Prioridade, Repositório GeoCloud, Stack and Description.
 * Effort has no options on the board yet, so it goes in the issue body. Returns its URL and number.
 */
export async function createGeoCloudIssue(
  token: string,
  fields: NewIssueFields,
  status: WritableStatus = "Open"
): Promise<{ url: string; number: number }> {
  const { title, description, prioridade, effort, tipo, stack } = fields;
  const issue = await github(token, `/repos/${GEOCLOUD_REPO}/issues`, {
    method: "POST",
    body: { title, body: issueBody(description, effort), labels: issueLabels(tipo, stack, prioridade) },
  });

  const added = await github(token, "/graphql", {
    method: "POST",
    body: {
      query: `mutation($project: ID!, $content: ID!) {
        addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
      }`,
      variables: { project: PROJECT_ID, content: issue.node_id },
    },
  });
  const item: string = added.data.addProjectV2ItemById.item.id;

  const select = (field: string, option: string) => setField(token, item, field, { singleSelectOptionId: option });
  await select(STATUS_FIELD_ID, STATUS_OPTIONS[status]);
  await select(PRIORIDADE_FIELD_ID, PRIORIDADE_OPTION_IDS[prioridade]);
  await select(REPOSITORIO_FIELD_ID, REPOSITORIO_GEOCLOUD_OPTION_ID);
  await select(STACK_FIELD_ID, STACK_OPTION_IDS[stack]);
  await setField(token, item, DESCRIPTION_FIELD_ID, { text: description.trim() || title });

  return { url: issue.html_url, number: issue.number };
}

/**
 * Writes a card's Status on Project #7: the sprint sync's one write to a card that already exists. `projectItemId`
 * is the card's id on the Project (projectCard in board.ts), not the issue's; callers only ever hold GeoCloud cards.
 */
export async function setProjectStatus(token: string, projectItemId: string, status: WritableStatus): Promise<void> {
  await setField(token, projectItemId, STATUS_FIELD_ID, { singleSelectOptionId: STATUS_OPTIONS[status] });
}

function setField(token: string, item: string, field: string, value: { singleSelectOptionId: string } | { text: string }) {
  return github(token, "/graphql", {
    method: "POST",
    body: {
      query: `mutation($project: ID!, $item: ID!, $field: ID!, $value: ProjectV2FieldValue!) {
        updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: $value }) { projectV2Item { id } }
      }`,
      variables: { project: PROJECT_ID, item, field, value },
    },
  });
}
