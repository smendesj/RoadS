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
const { LABELS_TIMEOUT_MS, readIssueLabels, createGeoCloudIssue, updateIssue, readIssueChangeTimes } = await import("./github.ts");

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
  assert.deepEqual(times.get(900001), { titleAt: "2026-10-21T09:00:00Z", bodyAt: "2026-10-21T10:00:00Z" });
  assert.deepEqual(times.get(900002), { titleAt: null, bodyAt: null });
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
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
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
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchImpl, written };
}

const NEW_ITEM = { title: "Item sintético", description: "Texto", prioridade: "High", effort: "Low", tipo: "feature", stack: "Backend" } as const;

test("creating an issue fills the board's fields by their ids and never writes the board's own Repositório field", async () => {
  const gh = creatingGitHub();
  const created = await createGeoCloudIssue("token-sintetico", NEW_ITEM, "Open", { fetch: gh.fetch });
  assert.deepEqual(created, { url: "https://example.test/issues/900001", number: 900001, skipped: [] });
  assert.deepEqual(gh.written, {
    [BOARD.status.id]: { singleSelectOptionId: "f130aaf8" },
    [BOARD.prioridade.id]: { singleSelectOptionId: "3b456fae" },
    [BOARD.stack.id]: { singleSelectOptionId: "eae17178" },
    [BOARD.description.id]: { text: "Texto" },
  });
});

test("an option the live board no longer has is skipped and reported, instead of failing the creation", async () => {
  const gh = creatingGitHub({ ...BOARD, stack: { id: BOARD.stack.id, options: ["2713499c"] } });
  const created = await createGeoCloudIssue("token-sintetico", NEW_ITEM, "Open", { fetch: gh.fetch });
  assert.deepEqual(created.skipped, ["Stack"]);
  assert.equal(gh.written[BOARD.stack.id], undefined);
  assert.deepEqual(gh.written[BOARD.prioridade.id], { singleSelectOptionId: "3b456fae" });
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
