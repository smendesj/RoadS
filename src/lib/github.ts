import "server-only";

// GitHub writes the Roadmap needs. GeoCloud items are GeoCloud issues: born in
// Essencis-Labs/GeoCloudAI and placed on Project #7 with Status "Open", the backlog column a
// Scrum Master picks sprint work from. Uses the same GITHUB_TOKEN as the board sync (a classic PAT
// with repo + read:org + project).

export const GEOCLOUD_REPO = "Essencis-Labs/GeoCloudAI";
const PROJECT_ID = "PVT_kwDODk7xnc4BGkj4"; // Essencis-Labs Project #7
const STATUS_FIELD_ID = "PVTSSF_lADODk7xnc4BGkj4zg3k_9Q";
const STATUS_OPEN_OPTION = "f130aaf8";

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

function issueBody(description: string): string {
  return [
    "## Por que entrou na fila",
    "",
    description.trim() || "Item criado no Roadmap do RoadS; descrição ainda por escrever.",
    "",
    "## Critérios de aceite",
    "",
    "- [ ] A definir antes de entrar em uma sprint.",
    "",
    "_Criada pelo RoadS a partir do Roadmap._",
  ].join("\n");
}

/** Opens the issue and puts it on Project #7 as Open. Returns its URL and number. */
export async function createGeoCloudIssue(token: string, title: string, description: string): Promise<{ url: string; number: number }> {
  const issue = await github(token, `/repos/${GEOCLOUD_REPO}/issues`, {
    method: "POST",
    body: { title, body: issueBody(description) },
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
  await github(token, "/graphql", {
    method: "POST",
    body: {
      query: `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
        updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) { projectV2Item { id } }
      }`,
      variables: { project: PROJECT_ID, item: added.data.addProjectV2ItemById.item.id, field: STATUS_FIELD_ID, option: STATUS_OPEN_OPTION },
    },
  });

  return { url: issue.html_url, number: issue.number };
}
