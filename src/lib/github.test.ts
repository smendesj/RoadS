import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// github.ts is server-only and imports through the "@/" alias, which plain Node resolves neither of. Two resolve
// hooks, for this file only: "server-only" becomes an empty module and "@/x" becomes src/x.ts.
const src = new URL("../", import.meta.url).href;
const hooks = `
export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  if (specifier.startsWith("@/")) return next(${JSON.stringify(src)} + specifier.slice(2) + ".ts", context);
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
const { LABELS_TIMEOUT_MS, readIssueLabels, createGeoCloudIssue, updateIssue, readIssueChangeTimes, setProjectOption, readBoardOptions, setProjectStatus, closeIssueAsNotPlanned, readIssueState, setProjectDate, clearProjectField, readBoardFields, readIssueComments, createIssueComment, updateIssueComment, deleteIssueComment, readIssueAssignees, setIssueAssignees, readIssueEfforts, setIssueEffort, issueBody } =
  await import("./github.ts");
const { NEW_ITEM_DESCRIPTION } = await import("./text/roadmap.ts");

test("closing and reopening an issue sends its state and the reason in the same edit", async () => {
  const gh = recordingGitHub();
  await updateIssue("token-sintetico", 900001, { state: "closed", state_reason: "completed" }, { fetch: gh.fetch });
  await updateIssue("token-sintetico", 900001, { state: "open", state_reason: "reopened" }, { fetch: gh.fetch });
  assert.deepEqual(gh.calls.map((c) => [c.method, c.body]), [
    ["PATCH", { state: "closed", state_reason: "completed" }],
    ["PATCH", { state: "open", state_reason: "reopened" }],
  ]);
});

test("Blocker and Done are written to the card's Status by their option ids", async () => {
  const gh = recordingGitHub();
  await setProjectStatus("token-sintetico", "PVTI_card", "Blocker", { fetch: gh.fetch });
  await setProjectStatus("token-sintetico", "PVTI_card", "Done", { fetch: gh.fetch });
  const values = gh.calls.map((c) => (c.body as { variables: { value: unknown } }).variables.value);
  assert.deepEqual(values, [{ singleSelectOptionId: "95ee425e" }, { singleSelectOptionId: "9487135d" }]);
});

test("a Delete comments first and then closes the issue as not planned", async () => {
  const gh = recordingGitHub();
  await closeIssueAsNotPlanned("token-sintetico", 900001, "Deleted in RoadS by an admin.", { fetch: gh.fetch });
  assert.deepEqual(gh.calls.map((c) => [c.method, c.url.replace(/^.*\/issues\//, ""), c.body]), [
    ["POST", "900001/comments", { body: "Deleted in RoadS by an admin." }],
    ["PATCH", "900001", { state: "closed", state_reason: "not_planned" }],
  ]);
});

test("an issue's state is read as closed or open", async () => {
  const closed = recordingGitHub(() => ({ state: "closed" }));
  assert.equal(await readIssueState("token-sintetico", 900001, { fetch: closed.fetch }), "closed");
  assert.equal(closed.calls[0].method, "GET");
  const open = recordingGitHub(() => ({ state: "open" }));
  assert.equal(await readIssueState("token-sintetico", 900001, { fetch: open.fetch }), "open");
});

/** A GitHub that records each request (method, path, body) and answers with `answer`. */
function recordingGitHub(answer: (url: string, body: { query?: string; variables?: Record<string, unknown> }) => unknown = () => ({})) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", url, body });
    return new Response(JSON.stringify(answer(url, body ?? {})), { status: 200 });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

test("pushing a title and a body edits exactly those two fields of the issue, and nothing else", async () => {
  const gh = recordingGitHub();
  await updateIssue("token-sintetico", 900001, { title: "Título novo", body: "## Solução\n\nTexto." }, { fetch: gh.fetch });
  assert.equal(gh.calls.length, 1);
  assert.equal(gh.calls[0].method, "PATCH");
  assert.match(gh.calls[0].url, /\/repos\/[^/]+\/[^/]+\/issues\/900001$/);
  assert.deepEqual(gh.calls[0].body, { title: "Título novo", body: "## Solução\n\nTexto." });
});

test("the time of each issue's last rename and last body edit is read in one request", async () => {
  const gh = recordingGitHub(() => ({
    data: {
      repository: {
        i900001: { lastEditedAt: "2026-10-21T10:00:00Z", timelineItems: { nodes: [{ createdAt: "2026-10-21T09:00:00Z" }] } },
        i900002: { lastEditedAt: null, timelineItems: { nodes: [] } },
      },
    },
  }));
  const times = await readIssueChangeTimes("token-sintetico", [900001, 900002], { fetch: gh.fetch });
  assert.equal(gh.calls.length, 1);
  assert.deepEqual(times.get(900001), { titleAt: "2026-10-21T09:00:00Z", bodyAt: "2026-10-21T10:00:00Z", labelAt: null });
  assert.deepEqual(times.get(900002), { titleAt: null, bodyAt: null, labelAt: null });
});

test("the last label change of each issue is read with its rename and body edit", async () => {
  const gh = recordingGitHub(() => ({
    data: {
      repository: {
        i900001: {
          lastEditedAt: null,
          timelineItems: { nodes: [{ createdAt: "2026-10-21T09:00:00Z" }] },
          labelEvents: { nodes: [{ createdAt: "2026-10-21T11:00:00Z" }] },
        },
      },
    },
  }));
  const times = await readIssueChangeTimes("token-sintetico", [900001], { fetch: gh.fetch });
  assert.deepEqual(times.get(900001), { titleAt: "2026-10-21T09:00:00Z", bodyAt: null, labelAt: "2026-10-21T11:00:00Z" });
  assert.match((gh.calls[0].body as { query: string }).query, /LABELED_EVENT/);
});

test("pushing labels and the native type sends them in the same edit of the issue", async () => {
  const gh = recordingGitHub();
  await updateIssue("token-sintetico", 900001, { labels: ["type:bug", "area:backend"], type: "Bug" }, { fetch: gh.fetch });
  assert.equal(gh.calls.length, 1);
  assert.equal(gh.calls[0].method, "PATCH");
  assert.deepEqual(gh.calls[0].body, { labels: ["type:bug", "area:backend"], type: "Bug" });
});

test("a board field is written by its id with the option's id", async () => {
  const gh = recordingGitHub();
  await setProjectOption("token-sintetico", "PVTI_card", "PVTSSF_campo", "opcao-1", { fetch: gh.fetch });
  assert.equal(gh.calls.length, 1);
  const v = (gh.calls[0].body as { variables: Record<string, unknown> }).variables;
  assert.deepEqual({ item: v.item, field: v.field, value: v.value }, { item: "PVTI_card", field: "PVTSSF_campo", value: { singleSelectOptionId: "opcao-1" } });
});

test("the board's options are read with their ids and names", async () => {
  const gh = recordingGitHub(() => ({
    data: {
      node: {
        fields: {
          nodes: [
            { id: "PVTSSF_x", name: "Stack", options: [{ id: "o1", name: "Backend" }, { id: "o2", name: "Frontend" }] },
            { id: "PVTF_texto", name: "Description" },
            {},
          ],
        },
      },
    },
  }));
  const options = await readBoardOptions("token-sintetico", { fetch: gh.fetch });
  assert.deepEqual(
    [...options.entries()].map(([k, v]) => [k, v && [...v.entries()]]),
    [
      ["PVTSSF_x", [["o1", "Backend"], ["o2", "Frontend"]]],
      ["PVTF_texto", null],
    ]
  );
});

// Synthetic ids of a board like Project #7: what matters is that the fields are matched by these ids.
const BOARD = {
  status: { id: "PVTSSF_lADODk7xnc4BGkj4zg3k_9Q", options: ["f130aaf8", "4e4b0563"] },
  prioridade: { id: "PVTSSF_lADODk7xnc4BGkj4zhf1oXA", options: ["313dc1cb", "3b456fae", "6acd6fa8", "77fe47cd"] },
  repositorio: { id: "PVTSSF_lADODk7xnc4BGkj4zhf1mt4", options: ["80e4e855"] },
  stack: { id: "PVTSSF_lADODk7xnc4BGkj4zhfusOE", options: ["eae17178", "2713499c"] },
  description: { id: "PVTF_lADODk7xnc4BGkj4zhfubog", options: null },
};

/** A GitHub that answers the creation of an issue and records every write to a card's field, by field id. */
function creatingGitHub(board: Record<string, { id: string; options: string[] | null }> = BOARD) {
  const written: Record<string, unknown> = {};
  const issueFields: unknown[] = [];
  const opened: { body?: string } = {};
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
    if (url.endsWith("/issues")) Object.assign(opened, body);
    if (url.endsWith("/issues")) return ok({ html_url: "https://example.test/issues/900001", number: 900001, node_id: "I_sint" });
    if (/fields\(/.test(body.query ?? "")) {
      const nodes = Object.values(board).map((f) => ({ id: f.id, name: "x", ...(f.options ? { options: f.options.map((id) => ({ id, name: id })) } : {}) }));
      return ok({ data: { node: { fields: { nodes } } } });
    }
    if (/addProjectV2ItemById/.test(body.query)) return ok({ data: { addProjectV2ItemById: { item: { id: "PVTI_sint" } } } });
    if (/updateProjectV2ItemFieldValue/.test(body.query)) {
      written[body.variables.field] = body.variables.value;
      return ok({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_sint" } } } });
    }
    if (/setIssueFieldValue/.test(body.query)) {
      issueFields.push(body.variables);
      return ok({ data: { setIssueFieldValue: { issue: { number: 900001 } } } });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchImpl, written, issueFields, opened };
}

const NEW_ITEM = { title: "Item sintético", description: "Texto", prioridade: "High", effort: "Low", tipo: "feature", stack: "Backend" } as const;

test("creating an issue fills the board's fields by their ids and never writes the board's own Repositório field", async () => {
  const gh = creatingGitHub();
  const created = await createGeoCloudIssue("token-sintetico", NEW_ITEM, "Open", { fetch: gh.fetch });
  assert.deepEqual(created, { url: "https://example.test/issues/900001", number: 900001, skipped: [], resumo: "Texto" });
  assert.deepEqual(gh.written, {
    [BOARD.status.id]: { singleSelectOptionId: "f130aaf8" },
    [BOARD.prioridade.id]: { singleSelectOptionId: "3b456fae" },
    [BOARD.stack.id]: { singleSelectOptionId: "eae17178" },
    [BOARD.description.id]: { text: "Texto" },
  });
});

test("creating an issue sets its Effort on the issue itself, the organization's issue field, by the option's id", async () => {
  const gh = creatingGitHub();
  await createGeoCloudIssue("token-sintetico", NEW_ITEM, "Open", { fetch: gh.fetch });
  assert.deepEqual(gh.issueFields, [{ issueId: "I_sint", fieldId: "IFSS_kgDOAjkpfQ", optionId: "IFSSO_kgDOA-PwtQ" }]);
});

test("an Effort GitHub refuses on a new issue is skipped and reported, and the issue and its card stay", async () => {
  const gh = creatingGitHub();
  const refusing = (async (url: string, init?: RequestInit) =>
    /setIssueFieldValue/.test(String(init?.body)) ? new Response(JSON.stringify({ errors: [{ message: "refused" }] }), { status: 200 }) : gh.fetch(url, init)) as typeof fetch;
  const created = await createGeoCloudIssue("token-sintetico", NEW_ITEM, "Open", { fetch: refusing });
  assert.deepEqual(created, { url: "https://example.test/issues/900001", number: 900001, skipped: ["Effort"], resumo: "Texto" });
  assert.deepEqual(gh.written[BOARD.status.id], { singleSelectOptionId: "f130aaf8" });
});

test("an option the live board no longer has is skipped and reported, instead of failing the creation", async () => {
  const gh = creatingGitHub({ ...BOARD, stack: { id: BOARD.stack.id, options: ["2713499c"] } });
  const created = await createGeoCloudIssue("token-sintetico", NEW_ITEM, "Open", { fetch: gh.fetch });
  assert.deepEqual(created.skipped, ["Stack"]);
  assert.equal(gh.written[BOARD.stack.id], undefined);
  assert.deepEqual(gh.written[BOARD.prioridade.id], { singleSelectOptionId: "3b456fae" });
});

// What follows the opening text of every new issue (issue #28): the effort line, the criteria and the footer.
const BODY_TAIL = ["", "**Esforço estimado:** Low", "", "## Critérios de aceite", "", "- [ ] A definir antes de entrar em uma sprint.", "", "_Criada pelo RoadS a partir do Roadmap._"];

test("a new item's Problema › Solução text opens its issue's body, before the effort line and the criteria", () => {
  const draft = "## Problema\n\nO relatório sintético demora a abrir.\n\n## Solução\n\nO relatório sintético abre em segundos.";
  assert.equal(issueBody(draft, "Low"), [draft, ...BODY_TAIL].join("\n"));
  assert.equal(issueBody(NEW_ITEM_DESCRIPTION, "Low"), [NEW_ITEM_DESCRIPTION, ...BODY_TAIL].join("\n"));
});

test("a text without a Solução heading becomes the Solução, under a Problema still to be written", () => {
  assert.equal(
    issueBody("  Um texto sintético antigo.  ", "Low"),
    ["## Problema", "", "Item criado no Roadmap do RoadS; problema ainda por escrever.", "", "## Solução", "", "Um texto sintético antigo.", ...BODY_TAIL].join("\n")
  );
});

test("an empty text still gives the body its Problema and a Solução placeholder", () => {
  assert.equal(
    issueBody(" ", "Low"),
    ["## Problema", "", "Item criado no Roadmap do RoadS; problema ainda por escrever.", "", "## Solução", "", "Solução ainda por escrever.", ...BODY_TAIL].join("\n")
  );
});

test("creating an issue from the template sends the whole text as its body and only the summary to the board", async () => {
  const gh = creatingGitHub();
  const created = await createGeoCloudIssue("token-sintetico", { ...NEW_ITEM, description: NEW_ITEM_DESCRIPTION }, "Open", { fetch: gh.fetch });
  assert.equal(gh.opened.body, issueBody(NEW_ITEM_DESCRIPTION, "Low"));
  assert.deepEqual(gh.written[BOARD.description.id], { text: "O que passa a acontecer, em uma ou duas frases." });
  assert.equal(created.resumo, "O que passa a acontecer, em uma ou duas frases.");
});

/**
 * A GitHub that never answers: the request hangs until its signal aborts it, as a real fetch does. Like the open
 * socket of a real one, it holds the event loop meanwhile (AbortSignal.timeout's own timer does not).
 */
const silentGitHub = ((_url: string, init?: RequestInit) =>
  new Promise((_resolve, reject) => {
    const socket = setInterval(() => {}, 1000);
    init?.signal?.addEventListener("abort", () => {
      clearInterval(socket);
      reject(init.signal!.reason);
    });
  })) as typeof fetch;

test("reading the labels gives up after a short timeout, so a slow GitHub never holds the unplanning", async () => {
  assert.ok(LABELS_TIMEOUT_MS > 0 && LABELS_TIMEOUT_MS <= 5000);
  const started = Date.now();
  await assert.rejects(readIssueLabels("token-sintetico", 900001, { fetch: silentGitHub, timeoutMs: 30 }), (e: Error) => e.name === "TimeoutError");
  assert.ok(Date.now() - started < 1000);
});

test("the labels are read from the issue, strings or objects", async () => {
  let asked = "";
  const github = (async (url: string) => {
    asked = url;
    return new Response(JSON.stringify({ labels: ["type:bug", { name: "stack:web" }, { name: "" }] }), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(await readIssueLabels("token-sintetico", 900001, { fetch: github }), ["type:bug", "stack:web"]);
  assert.match(asked, /\/issues\/900001$/);
});

test("the comments of each issue are read in one request, with who wrote them and whether it was a bot", async () => {
  const gh = recordingGitHub(() => ({
    data: {
      repository: {
        i900001: {
          comments: {
            totalCount: 2,
            nodes: [
              { databaseId: 501, body: "Um", updatedAt: "2026-10-21T09:00:00Z", author: { login: "conta-teste", __typename: "User" } },
              { databaseId: 502, body: "Dois", updatedAt: "2026-10-21T10:00:00Z", author: { login: "um-bot", __typename: "Bot" } },
            ],
          },
        },
        i900002: { comments: { totalCount: 0, nodes: [] } },
      },
    },
  }));
  const comments = await readIssueComments("token-sintetico", [900001, 900002], { fetch: gh.fetch });
  assert.equal(gh.calls.length, 1);
  assert.deepEqual(comments.get(900001), [
    { id: 501, body: "Um", updatedAt: "2026-10-21T09:00:00Z", login: "conta-teste", bot: false },
    { id: 502, body: "Dois", updatedAt: "2026-10-21T10:00:00Z", login: "um-bot", bot: true },
  ]);
  assert.deepEqual(comments.get(900002), []);
});

test("an issue with more comments than one page holds is left out, so its missing comments never read as deleted", async () => {
  const gh = recordingGitHub(() => ({ data: { repository: { i900001: { comments: { totalCount: 101, nodes: [] } } } } }));
  const comments = await readIssueComments("token-sintetico", [900001], { fetch: gh.fetch });
  assert.equal(comments.has(900001), false);
});

test("creating, editing and deleting a comment send exactly those requests", async () => {
  const gh = recordingGitHub((url) => (url.endsWith("/comments") ? { id: 601, updated_at: "2026-10-21T11:00:00Z" } : {}));
  const created = await createIssueComment("token-sintetico", 900001, "Texto\n\n— Pessoa (RoadS)", { fetch: gh.fetch });
  await updateIssueComment("token-sintetico", 601, "Texto novo", { fetch: gh.fetch });
  await deleteIssueComment("token-sintetico", 601, { fetch: gh.fetch });
  assert.deepEqual(created, { id: 601, updatedAt: "2026-10-21T11:00:00Z" });
  assert.deepEqual(
    gh.calls.map((c) => [c.method, c.url.replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+/, ""), c.body]),
    [
      ["POST", "/issues/900001/comments", { body: "Texto\n\n— Pessoa (RoadS)" }],
      ["PATCH", "/issues/comments/601", { body: "Texto novo" }],
      ["DELETE", "/issues/comments/601", undefined],
    ]
  );
});

test("the assignees of each issue and when they last changed are read in one request", async () => {
  const gh = recordingGitHub(() => ({
    data: {
      repository: {
        i900001: { assignees: { nodes: [{ login: "ana-y" }, { login: "Bia-Z" }] }, timelineItems: { nodes: [{ createdAt: "2026-10-21T09:00:00Z" }] } },
        i900002: { assignees: { nodes: [] }, timelineItems: { nodes: [] } },
      },
    },
  }));
  const assignees = await readIssueAssignees("token-sintetico", [900001, 900002], { fetch: gh.fetch });
  assert.equal(gh.calls.length, 1);
  assert.deepEqual(assignees.get(900001), { logins: ["ana-y", "Bia-Z"], changedAt: "2026-10-21T09:00:00Z" });
  assert.deepEqual(assignees.get(900002), { logins: [], changedAt: null });
});

test("setting an issue's assignees sends the whole list, and nothing else of the issue", async () => {
  const gh = recordingGitHub();
  await setIssueAssignees("token-sintetico", 900001, ["ana-y"], { fetch: gh.fetch });
  assert.equal(gh.calls[0].method, "PATCH");
  assert.match(gh.calls[0].url, /\/issues\/900001$/);
  assert.deepEqual(gh.calls[0].body, { assignees: ["ana-y"] });
});

// ---- Week (S5): a date field of the card

test("a Week is written to the card's date field by its id, and cleared when the item leaves its week", async () => {
  const gh = recordingGitHub();
  await setProjectDate("token-sintetico", "PVTI_card", "PVTF_week", "2026-10-26", { fetch: gh.fetch });
  await clearProjectField("token-sintetico", "PVTI_card", "PVTF_week", { fetch: gh.fetch });
  const [set, clear] = gh.calls.map((c) => c.body as { query: string; variables: Record<string, unknown> });
  assert.deepEqual({ item: set.variables.item, field: set.variables.field, value: set.variables.value }, { item: "PVTI_card", field: "PVTF_week", value: { date: "2026-10-26" } });
  assert.match(clear.query, /clearProjectV2ItemFieldValue/);
  assert.deepEqual({ item: clear.variables.item, field: clear.variables.field }, { item: "PVTI_card", field: "PVTF_week" });
});

test("the board's fields are read with their names, so a field created on the board (Week) is found by its name", async () => {
  const gh = recordingGitHub(() => ({
    data: { node: { fields: { nodes: [{ id: "PVTF_week", name: "Week", dataType: "DATE" }, { id: "PVTSSF_x", name: "Stack", dataType: "SINGLE_SELECT", options: [{ id: "o1", name: "Backend" }] }] } } },
  }));
  const fields = await readBoardFields("token-sintetico", { fetch: gh.fetch });
  assert.equal(fields.byName.get("Week"), "PVTF_week");
  assert.deepEqual([...(fields.options.get("PVTSSF_x") ?? [])], [["o1", "Backend"]]);
  assert.equal(fields.options.get("PVTF_week"), null);
});

// ---- Effort (P1): the organization's issue field, on the issue itself

test("the Effort of each issue is read from its issue field in one request, with the issue's node id", async () => {
  const gh = recordingGitHub(() => ({
    data: {
      repository: {
        i900001: {
          id: "I_um",
          issueFieldValues: {
            nodes: [
              { __typename: "IssueFieldTextValue" },
              { __typename: "IssueFieldSingleSelectValue", name: "Medium", optionId: "IFSSO_kgDOA-PwtA", field: { id: "IFSS_kgDOAjkpfQ", name: "Effort" } },
            ],
          },
        },
        i900002: { id: "I_dois", issueFieldValues: { nodes: [] } },
        i900003: {
          id: "I_tres",
          issueFieldValues: { nodes: [{ __typename: "IssueFieldSingleSelectValue", name: "High", optionId: "IFSSO_outro", field: { id: "IFSS_outro", name: "Risk" } }] },
        },
      },
    },
  }));
  const efforts = await readIssueEfforts("token-sintetico", [900001, 900002, 900003, 900004], { fetch: gh.fetch });
  assert.equal(gh.calls.length, 1);
  const query = (gh.calls[0].body as { query: string }).query;
  assert.match(query, /i900001: issue\(number: 900001\)/);
  assert.match(query, /issueFieldValues/);
  assert.deepEqual(efforts.get(900001), { issueId: "I_um", effort: "Medium" });
  // No Effort on the issue (another field doesn't count): an empty Effort, a gap RoadS may fill.
  assert.deepEqual(efforts.get(900002), { issueId: "I_dois", effort: null });
  assert.deepEqual(efforts.get(900003), { issueId: "I_tres", effort: null });
  // An issue not found is left out.
  assert.equal(efforts.has(900004), false);
});

test("an Effort holding an option RoadS doesn't know leaves the issue out, so it is never overwritten", async () => {
  const gh = recordingGitHub(() => ({
    data: {
      repository: {
        i900001: {
          id: "I_um",
          issueFieldValues: { nodes: [{ __typename: "IssueFieldSingleSelectValue", name: "Huge", optionId: "IFSSO_novo", field: { id: "IFSS_kgDOAjkpfQ", name: "Effort" } }] },
        },
      },
    },
  }));
  const efforts = await readIssueEfforts("token-sintetico", [900001], { fetch: gh.fetch });
  assert.equal(efforts.has(900001), false);
});

test("no issue to read is no request", async () => {
  const gh = recordingGitHub();
  assert.equal((await readIssueEfforts("token-sintetico", [], { fetch: gh.fetch })).size, 0);
  assert.equal(gh.calls.length, 0);
});

test("an Effort is written to the issue's field by the option's id, and an empty one clears the field", async () => {
  const gh = recordingGitHub();
  await setIssueEffort("token-sintetico", "I_um", "High", { fetch: gh.fetch });
  await setIssueEffort("token-sintetico", "I_um", "Medium", { fetch: gh.fetch });
  await setIssueEffort("token-sintetico", "I_um", null, { fetch: gh.fetch });
  const [high, medium, clear] = gh.calls.map((c) => c.body as { query: string; variables: Record<string, unknown> });
  assert.match(high.query, /setIssueFieldValue\(input: \{ issueId: \$issueId, issueFields: \[\{ fieldId: \$fieldId, singleSelectOptionId: \$optionId \}\] \}\)/);
  assert.deepEqual(high.variables, { issueId: "I_um", fieldId: "IFSS_kgDOAjkpfQ", optionId: "IFSSO_kgDOA-Pwsw" });
  assert.deepEqual(medium.variables, { issueId: "I_um", fieldId: "IFSS_kgDOAjkpfQ", optionId: "IFSSO_kgDOA-PwtA" });
  assert.match(clear.query, /deleteIssueFieldValue\(input: \{ issueId: \$issueId, fieldId: \$fieldId \}\)/);
  assert.deepEqual(clear.variables, { issueId: "I_um", fieldId: "IFSS_kgDOAjkpfQ" });
});
