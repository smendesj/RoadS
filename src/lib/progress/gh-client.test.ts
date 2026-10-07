import { test } from "node:test";
import assert from "node:assert/strict";
import { GithubError, TREE_LIMITS, collectGithubData, createGithubClient } from "./gh-client.ts";
import { buildFacts } from "./gh-facts.ts";

// A sentinel that must never come out of anything the client prints or throws.
const TOKEN = "ghp_SENTINEL_TOKEN_0123456789";
const BODY_SECRET = "SECRET-IN-THE-RESPONSE-BODY";

type Call = { method: string; url: URL; body: { query?: string; variables?: Record<string, unknown> } | null; auth: string | null };

/** A fake GitHub: `handler` answers every request; the calls are recorded for the assertions. */
function fakeGithub(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      method: init?.method ?? "GET",
      url: new URL(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      auth: headers.get("authorization"),
    };
    calls.push(call);
    return handler(call);
  };
  return { calls, fetch };
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

const rest = (n: number) => ({ number: n, title: `Item ${n}`, state: "open", labels: [], assignees: [], created_at: "2026-03-09T12:00:00Z" });

test("a listing is read page by page until a short page ends it", async () => {
  const pages = [100, 100, 37];
  const gh = fakeGithub((call) => {
    const page = Number(call.url.searchParams.get("page"));
    return json(Array.from({ length: pages[page - 1] ?? 0 }, (_, k) => rest((page - 1) * 100 + k)));
  });
  const client = createGithubClient({ token: TOKEN, fetch: gh.fetch });
  const items = await client.list("/repos/acme/app/issues", { state: "all" });
  assert.equal(items.length, 237);
  assert.equal(gh.calls.length, 3);
  assert.ok(gh.calls.every((c) => c.method === "GET" && c.auth === `Bearer ${TOKEN}` && c.url.searchParams.get("per_page") === "100"));
});

test("the listing stops at once when GitHub says there is no next page", async () => {
  const gh = fakeGithub(() => json(Array.from({ length: 100 }, (_, k) => rest(k)), { headers: { link: '<https://api.github.com/x?page=1>; rel="prev"' } }));
  const items = await createGithubClient({ token: TOKEN, fetch: gh.fetch }).list("/repos/acme/app/issues");
  assert.equal(items.length, 100);
  assert.equal(gh.calls.length, 1);
});

const failures: [string, number, Record<string, string>, RegExp][] = [
  ["a refused token", 401, {}, /token/i],
  ["a rate limit", 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Date.parse("2026-03-09T18:30:00Z") / 1000) }, /limite.*15:30/i],
  ["a secondary rate limit", 429, { "retry-after": "60" }, /limite/i],
  ["a token without permission", 403, {}, /acesso|permiss|escopos/i],
  ["something not found", 404, {}, /n[ãa]o encontr/i],
  ["a GitHub outage", 502, {}, /problemas|indispon/i],
];
for (const [name, status, headers, expected] of failures) {
  test(`${name} becomes a Portuguese message with no echo of the token or of the response`, async () => {
    const gh = fakeGithub(() => json({ message: BODY_SECRET, documentation_url: BODY_SECRET }, { status, headers }));
    const client = createGithubClient({ token: TOKEN, fetch: gh.fetch });
    await assert.rejects(client.get("/repos/acme/app/issues/1"), (error: unknown) => {
      assert.ok(error instanceof GithubError);
      assert.match(error.message, expected);
      assert.ok(!error.message.includes(TOKEN) && !error.message.includes(BODY_SECRET));
      assert.ok(!String(error.stack).includes(TOKEN));
      return true;
    });
  });
}

test("a network failure is explained without repeating what the network said", async () => {
  const fetch = async () => {
    throw new Error(`connect ECONNREFUSED api.github.com ${TOKEN}`);
  };
  const client = createGithubClient({ token: TOKEN, fetch });
  await assert.rejects(client.get("/user"), (error: unknown) => {
    assert.ok(error instanceof GithubError);
    assert.match(error.message, /conex|rede/i);
    assert.ok(!error.message.includes(TOKEN) && !error.message.includes("ECONNREFUSED"));
    return true;
  });
});

test("the token is required, and an empty one is refused before any request", () => {
  assert.throws(() => createGithubClient({ token: "  ", fetch: async () => json({}) }), (e: unknown) => e instanceof GithubError && /GITHUB_TOKEN/.test(e.message) && !e.message.includes(TOKEN));
});

test("GraphQL answers come back as data, its errors as a message, and a mutation never leaves the machine", async () => {
  const gh = fakeGithub((call) =>
    call.body?.variables?.fail ? json({ errors: [{ type: "FORBIDDEN", message: BODY_SECRET }] }) : json({ data: { viewer: { login: "someone" } } })
  );
  const client = createGithubClient({ token: TOKEN, fetch: gh.fetch });
  assert.deepEqual(await client.graphql("query { viewer { login } }"), { viewer: { login: "someone" } });
  await assert.rejects(client.graphql("query($fail: Boolean) { viewer { login } }", { fail: true }), (e: unknown) => {
    assert.ok(e instanceof GithubError);
    assert.ok(!e.message.includes(BODY_SECRET));
    assert.match(e.message, /token|permiss/i);
    return true;
  });
  const before = gh.calls.length;
  await assert.rejects(client.graphql('mutation { addComment(input: {subjectId: "x", body: "y"}) { clientMutationId } }'), /somente leitura/i);
  assert.equal(gh.calls.length, before);
});

/* ---------- The whole collection, against a fake GitHub ---------- */

const REPO = "acme/app";
const WINDOW = { start: "2026-03-09T00:00:00-03:00", end: "2026-03-11T00:00:00-03:00" };

const issueNode = (n: number, over: Record<string, unknown> = {}) => ({
  subIssues: { nodes: [] },
  closedByPullRequestsReferences: { nodes: [] },
  timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
  number: n,
  ...over,
});

const prNode = (n: number, over: Record<string, unknown> = {}) => ({
  number: n,
  title: `Entrega (#${n - 1})`,
  url: `https://github.com/${REPO}/pull/${n}`,
  state: "OPEN",
  isDraft: true,
  merged: false,
  mergedAt: null,
  createdAt: "2026-03-09T14:00:00Z",
  closedAt: null,
  baseRefName: "main",
  author: { login: "dev-a" },
  mergeCommit: null,
  closingIssuesReferences: { nodes: [] },
  commits: { totalCount: 1, nodes: [{ commit: { oid: `c0ffee${n}`, committedDate: "2026-03-09T13:00:00Z", author: { user: { login: "dev-a" } } } }] },
  ...over,
});

function scenario() {
  const issues = [
    { ...rest(50), title: "Tela nova", labels: [{ name: "type:feature" }], assignees: [{ login: "dev-a" }], user: { login: "dev-a" }, html_url: `https://github.com/${REPO}/issues/50`, body: "", sub_issues_summary: { total: 0, completed: 0, percent_completed: 0 } },
    {
      ...rest(60), title: "Guarda-chuva", state: "closed", state_reason: "completed", closed_at: "2026-03-10T15:00:00Z",
      user: { login: "dev-a" }, html_url: `https://github.com/${REPO}/issues/60`, body: "", sub_issues_summary: { total: 1, completed: 1, percent_completed: 100 },
    },
    { ...rest(51), title: "Tela nova (#50)", pull_request: { merged_at: null }, html_url: `https://github.com/${REPO}/pull/51`, user: { login: "dev-a" } },
  ];
  return fakeGithub((call) => {
    const path = call.url.pathname;
    if (path === "/user") return json({ login: "dev-a" });
    if (path === `/repos/${REPO}/issues`) {
      assert.equal(call.url.searchParams.get("since"), "2026-03-09T03:00:00Z"); // window start, in UTC
      return json(issues);
    }
    if (path === `/repos/${REPO}/commits`) return json([{ sha: "abc1234567", commit: { committer: { date: "2026-03-09T20:00:00Z" } }, author: { login: "dev-a" } }]);
    if (path !== "/graphql") return json({ message: BODY_SECRET }, { status: 404 });
    const query = call.body?.query ?? "";
    assert.ok(!/mutation/i.test(query));
    if (/projectV2\(number/.test(query)) {
      return json({
        data: {
          organization: {
            projectV2: {
              items: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  { content: { __typename: "Issue", number: 50, repository: { nameWithOwner: REPO } }, fieldValueByName: { name: "Development", updatedAt: "2026-03-08T13:00:00Z" } },
                  { content: { __typename: "Issue", number: 60, repository: { nameWithOwner: REPO } }, fieldValueByName: { name: "Done", updatedAt: "2026-03-10T15:00:00Z" } },
                  { content: { __typename: "Issue", number: 50, repository: { nameWithOwner: "acme/other-product" } }, fieldValueByName: { name: "Blocker", updatedAt: "2026-03-08T13:00:00Z" } },
                  { content: { __typename: "Issue", number: 99, repository: { nameWithOwner: "acme/other-product" } }, fieldValueByName: { name: "Development", updatedAt: "2026-03-08T13:00:00Z" } },
                  { content: null, fieldValueByName: null },
                ],
              },
            },
          },
        },
      });
    }
    if (/issue\(number/.test(query)) {
      const n = Number(call.body?.variables?.n);
      const nodes: Record<number, unknown> = {
        50: issueNode(50),
        60: issueNode(60, { subIssues: { nodes: [{ number: 61, title: "Passo", state: "CLOSED", stateReason: "COMPLETED", createdAt: "2026-03-09T12:00:00Z", closedAt: "2026-03-10T14:00:00Z", url: `https://github.com/${REPO}/issues/61` }] } }),
        61: issueNode(61, {
          timelineItems: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              { __typename: "CrossReferencedEvent", willCloseTarget: false, source: { __typename: "PullRequest", number: 62, repository: { nameWithOwner: REPO } } },
              { __typename: "CrossReferencedEvent", willCloseTarget: false, source: { __typename: "PullRequest", number: 70, repository: { nameWithOwner: "acme/other-product" } } },
              { __typename: "ReferencedEvent", commit: { oid: "9999999aaa", committedDate: "2026-03-09T12:30:00Z", author: { user: { login: "dev-a" } } } },
            ],
          },
        }),
      };
      return json({ data: { repository: { issue: nodes[n] ?? null } } });
    }
    if (/pullRequest\(number/.test(query)) {
      const wanted = [...query.matchAll(/p(\d+): pullRequest/g)].map((m) => Number(m[1]));
      const byNumber: Record<number, unknown> = {
        51: prNode(51),
        62: prNode(62, { title: "Passo (#61)", state: "MERGED", isDraft: false, merged: true, mergedAt: "2026-03-09T18:00:00Z", closedAt: "2026-03-09T18:00:00Z", mergeCommit: { oid: "beef000" } }),
      };
      return json({ data: { repository: Object.fromEntries(wanted.map((n) => [`p${n}`, byNumber[n] ?? null])) } });
    }
    return json({ errors: [{ type: "OTHER" }] });
  });
}

test("collecting reads issues, the board, sub-issues and PRs, and the facts come out right", async () => {
  const gh = scenario();
  const client = createGithubClient({ token: TOKEN, fetch: gh.fetch });
  const author = await client.viewerLogin();
  const data = await collectGithubData(client, { repository: REPO, window: WINDOW, author });

  const facts = buildFacts({ repository: REPO, window: WINDOW, generatedAt: "2026-03-11T12:00:00-03:00", author, ...data });
  // 50: Development with an open draft PR; 60: umbrella whose only step was merged; 61 is rolled up; 51 is a PR.
  assert.deepEqual(facts.entries.map((e) => [e.issue, e.status]), [[50, "em_validacao"], [60, "concluido"]]);
  assert.equal(facts.entries[1].deliveredAt, "2026-03-09T15:00:00-03:00");
  assert.deepEqual(facts.entries[1].subIssues, { total: 1, done: 1 });
  assert.equal(facts.internal.count, 0);
  // Git work: the merge of PR 62, the commits found, and the direct commit on the default branch.
  assert.deepEqual(
    facts.gitWork.map((w) => w.ref),
    ["commit 9999999", "commit c0ffee5", "commit c0ffee6", "PR #62 mesclado", "commit abc1234"]
  );
});

test("collecting only ever reads: GET requests and GraphQL queries, and the token travels only in the header", async () => {
  const gh = scenario();
  const client = createGithubClient({ token: TOKEN, fetch: gh.fetch });
  await collectGithubData(client, { repository: REPO, window: WINDOW, author: "dev-a" });
  assert.ok(gh.calls.length > 0);
  for (const call of gh.calls) {
    assert.ok(call.method === "GET" || (call.method === "POST" && call.url.pathname === "/graphql"));
    assert.ok(!call.url.href.includes(TOKEN));
    assert.ok(!JSON.stringify(call.body ?? {}).includes(TOKEN));
    if (call.body?.query) assert.ok(!/mutation/i.test(call.body.query));
  }
});

/* ---------- The whole tree of sub-issues, against a fake GitHub ---------- */

type Kid = { number: number; state?: string; stateReason?: string | null; closedAt?: string | null; labels?: string[]; repo?: string };
const kidNode = (k: Kid) => ({
  number: k.number,
  title: `Parte ${k.number}`,
  state: k.state ?? "OPEN",
  stateReason: k.stateReason ?? null,
  createdAt: "2026-02-20T12:00:00Z",
  closedAt: k.closedAt ?? null,
  url: `https://github.com/${REPO}/issues/${k.number}`,
  repository: { nameWithOwner: k.repo ?? REPO },
  labels: { nodes: (k.labels ?? []).map((name) => ({ name })) },
});
const closedKid = (number: number, closedAt: string): Kid => ({ number, state: "CLOSED", stateReason: "COMPLETED", closedAt });
const boardNode = (number: number, status: string) => ({
  content: { __typename: "Issue", number, repository: { nameWithOwner: REPO } },
  fieldValueByName: { name: status, updatedAt: "2026-03-08T13:00:00Z" },
});
const oldIssue = (n: number, over: Record<string, unknown> = {}) => ({ ...rest(n), title: `Guarda-chuva ${n}`, created_at: "2026-02-20T12:00:00Z", user: { login: "dev-a" }, ...over });

/** A GitHub whose issues hang in a tree: `kids` says what each issue's sub-issues are. Records what was read. */
function treeGithub(t: {
  listed: unknown[];
  rest?: Record<number, unknown>;
  kids?: Record<number, Kid[]>;
  totals?: Record<number, number>;
  events?: Record<number, unknown[]>;
  prs?: Record<number, unknown>;
  board?: unknown[];
}) {
  const reads: number[] = [];
  const gets: number[] = [];
  const queries: string[] = [];
  const gh = fakeGithub((call) => {
    const path = call.url.pathname;
    if (path === `/repos/${REPO}/issues`) return json(t.listed);
    const one = new RegExp(`^/repos/${REPO}/issues/(\\d+)$`).exec(path);
    if (one) {
      gets.push(Number(one[1]));
      const found = t.rest?.[Number(one[1])];
      return found ? json(found) : json({ message: BODY_SECRET }, { status: 404 });
    }
    if (path === `/repos/${REPO}/commits`) return json([]);
    if (path !== "/graphql") return json({ message: BODY_SECRET }, { status: 404 });
    const query = call.body?.query ?? "";
    if (/projectV2\(number/.test(query)) {
      return json({ data: { organization: { projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: t.board ?? [] } } } } });
    }
    if (/issue\(number/.test(query)) {
      const n = Number(call.body?.variables?.n);
      reads.push(n);
      queries.push(query);
      const kids = t.kids?.[n] ?? [];
      return json({
        data: {
          repository: {
            issue: issueNode(n, { subIssues: { totalCount: t.totals?.[n] ?? kids.length, nodes: kids.map(kidNode) }, timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: t.events?.[n] ?? [] } }),
          },
        },
      });
    }
    if (/pullRequest\(number/.test(query)) {
      const wanted = [...query.matchAll(/p(\d+): pullRequest/g)].map((m) => Number(m[1]));
      return json({ data: { repository: Object.fromEntries(wanted.map((n) => [`p${n}`, t.prs?.[n] ?? null])) } });
    }
    return json({ errors: [{ type: "OTHER" }] });
  });
  return { ...gh, reads, gets, queries };
}

async function factsOf(gh: ReturnType<typeof treeGithub>) {
  const client = createGithubClient({ token: TOKEN, fetch: gh.fetch });
  const data = await collectGithubData(client, { repository: REPO, window: WINDOW, author: "dev-a" });
  return { data, facts: buildFacts({ repository: REPO, window: WINDOW, generatedAt: "2026-03-11T12:00:00-03:00", author: "dev-a", ...data }) };
}

test("the grandchildren are read too: their PRs and their closures are the umbrella's, and its parts are the leaves", async () => {
  const gh = treeGithub({
    listed: [oldIssue(70, { created_at: "2026-03-09T12:00:00Z", sub_issues_summary: { total: 2, completed: 1 } })],
    kids: { 70: [{ number: 71 }, closedKid(72, "2026-03-08T12:00:00Z")], 71: [closedKid(73, "2026-03-10T12:00:00Z"), { number: 74, labels: ["status:blocker"] }] },
    events: { 73: [{ __typename: "CrossReferencedEvent", willCloseTarget: true, source: { __typename: "PullRequest", number: 80, repository: { nameWithOwner: REPO } } }] },
    prs: { 80: prNode(80, { title: "Parte (#73)", state: "MERGED", isDraft: false, merged: true, mergedAt: "2026-03-10T15:00:00Z", closedAt: "2026-03-10T15:00:00Z", mergeCommit: { oid: "beef000" } }) },
    board: [boardNode(70, "Development")],
  });
  const { facts, data } = await factsOf(gh);

  assert.deepEqual([...gh.reads].sort(), [70, 71, 72, 73, 74]); // every issue of the tree, once
  assert.deepEqual(data.prs.map((p) => p.number), [80]);
  const [entry] = facts.entries;
  assert.deepEqual([entry.issue, entry.status], [70, "em_andamento"]); // a part merged, but 2 of 3 parts are done
  assert.deepEqual(entry.subIssues, { total: 3, done: 2 }); // 72, 73 and 74: the step 71 counts through its parts
  assert.ok(entry.sources.includes(`https://github.com/${REPO}/pull/80`));
  assert.deepEqual(entry.slices, { closed: [{ title: "Parte 73", closedAt: "2026-03-10T09:00:00-03:00" }], blocked: [{ title: "Parte 74" }] });
  assert.equal(facts.ignored.children, 4);
  assert.equal(facts.ignored.cut, 0);
  assert.ok(facts.gitWork.some((w) => w.ref === "PR #80 mesclado"));
});

test("the sub-issue query asks for what the report needs and stays a read", async () => {
  const gh = treeGithub({ listed: [oldIssue(75, { created_at: "2026-03-09T12:00:00Z" })], kids: { 75: [{ number: 76 }] } });
  await factsOf(gh);
  assert.ok(gh.queries.length > 0);
  for (const q of gh.queries) {
    assert.match(q, /subIssues\(first: 100\) \{ totalCount nodes \{[^}]*repository \{ nameWithOwner \}/);
    assert.match(q, /labels\(first: \d+\) \{ nodes \{ name \} \}/);
    assert.ok(!/mutation/i.test(q));
  }
});

test("a sub-issue touched in the window brings its quiet umbrella with it, however far up it hangs", async () => {
  const gh = treeGithub({
    listed: [oldIssue(302, { state: "closed", state_reason: "completed", closed_at: "2026-03-10T12:00:00Z", parent_issue_url: `https://api.github.com/repos/${REPO}/issues/301` })],
    rest: {
      301: oldIssue(301, { parent_issue_url: `https://api.github.com/repos/${REPO}/issues/300` }),
      300: oldIssue(300),
    },
    kids: { 300: [{ number: 301 }], 301: [closedKid(302, "2026-03-10T12:00:00Z")] },
    board: [boardNode(300, "Open")],
  });
  const { facts } = await factsOf(gh);
  assert.deepEqual([...gh.gets].sort(), [300, 301]); // each ancestor fetched once
  assert.deepEqual(facts.entries.map((e) => [e.issue, e.status, e.subIssues]), [[300, "em_andamento", { total: 1, done: 1 }]]);
  assert.equal(facts.ignored.quiet, 0);
});

test("a tree is followed only so deep: the last level is read, what is below it is not, and `ignored` says so", async () => {
  const bottom = 90 + TREE_LIMITS.depth;
  const chain = Object.fromEntries(Array.from({ length: bottom + 3 - 90 }, (_, k) => [90 + k, [{ number: 91 + k }]]));
  const gh = treeGithub({ listed: [oldIssue(90, { created_at: "2026-03-09T12:00:00Z" })], kids: chain, board: [boardNode(90, "Development")] });
  const { facts } = await factsOf(gh);
  assert.deepEqual([...gh.reads].sort((a, b) => a - b), Array.from({ length: TREE_LIMITS.depth + 1 }, (_, k) => 90 + k));
  assert.ok(!gh.reads.includes(bottom + 1));
  assert.equal(facts.ignored.cut, 1);
  const [entry] = facts.entries;
  assert.deepEqual(entry.subIssues, { total: 1, done: 0 }); // the last level read stands for the one part GitHub counts under it
  assert.ok(entry.evidence.some((l) => /cortad/i.test(l)));
});

test("a tree is read only up to its size limit, whole issues at a time, and `ignored` says so", async () => {
  const per = Math.floor(TREE_LIMITS.family / 3);
  const many = (from: number) => Array.from({ length: per }, (_, k) => ({ number: from + k }));
  const gh = treeGithub({
    listed: [oldIssue(200, { created_at: "2026-03-09T12:00:00Z" })],
    kids: { 200: [{ number: 201 }, { number: 202 }, { number: 203 }], 201: many(1000), 202: many(3000), 203: many(5000) },
    board: [boardNode(200, "Development")],
  });
  const { facts } = await factsOf(gh);
  assert.equal(gh.reads.length, 1 + 3 + 2 * per); // the third step's sub-issues would pass the limit: none of them is read
  assert.ok(gh.reads.every((n) => n < 5000));
  assert.equal(facts.ignored.cut, 1);
  assert.deepEqual(facts.entries[0].subIssues, { total: 3 * per, done: 0 }); // the unread step stands for the parts GitHub counts under it
  assert.ok(facts.entries[0].evidence.some((l) => /cortad/i.test(l)));
});

test("sub-issues of another repository are not read (their numbers mean other issues), and `ignored` says so", async () => {
  const gh = treeGithub({
    listed: [oldIssue(400, { created_at: "2026-03-09T12:00:00Z" })],
    kids: { 400: [{ number: 401 }, { number: 402, repo: "acme/other-product" }] },
    board: [boardNode(400, "Development")],
  });
  const { facts } = await factsOf(gh);
  assert.deepEqual([...gh.reads].sort(), [400, 401]);
  assert.deepEqual(facts.entries[0].subIssues, { total: 1, done: 0 });
  assert.equal(facts.ignored.cut, 1);
});

test("a tree is collected with GET requests and GraphQL queries only, token in the header", async () => {
  const gh = treeGithub({ listed: [oldIssue(500, { created_at: "2026-03-09T12:00:00Z" })], kids: { 500: [{ number: 501 }] }, board: [boardNode(500, "Development")] });
  await factsOf(gh);
  for (const call of gh.calls) {
    assert.ok(call.method === "GET" || (call.method === "POST" && call.url.pathname === "/graphql"));
    assert.ok(!call.url.href.includes(TOKEN) && !JSON.stringify(call.body ?? {}).includes(TOKEN));
  }
});

/* ---------- Epics above the deliveries ---------- */

const EPIC = { labels: [{ name: "type:epic" }] };
const upTo = (n: number) => ({ parent_issue_url: `https://api.github.com/repos/${REPO}/issues/${n}` });

test("an epic is read to find its deliveries, but only the deliveries with news are read down to their parts", async () => {
  const gh = treeGithub({
    listed: [oldIssue(2001, { state: "closed", state_reason: "completed", closed_at: "2026-03-10T12:00:00Z", ...upTo(2000) })],
    rest: { 2000: oldIssue(2000, EPIC) },
    kids: {
      2000: [closedKid(2001, "2026-03-10T12:00:00Z"), { number: 2002 }, closedKid(2003, "2026-02-01T12:00:00Z")],
      2001: [closedKid(2011, "2026-03-10T12:00:00Z")],
      2002: [{ number: 2012 }],
    },
  });
  const { facts } = await factsOf(gh);
  assert.deepEqual([...gh.reads].sort((a, b) => a - b), [2000, 2001, 2011]); // not 2002, 2003 or 2012: nothing happened there
  assert.deepEqual(facts.entries.map((e) => e.issue), [2001]);
  assert.deepEqual(facts.entries[0].epic, { issue: 2000, title: "Guarda-chuva 2000", parts: { total: 3, done: 2 } }); // 2002 is still known, and open
  assert.equal(facts.ignored.epics, 1);
  assert.equal(facts.ignored.quiet, 2); // 2002 and 2003
  assert.equal(facts.ignored.cut, 0);
});

test("the epics above a delivery cost it neither depth nor size: its own parts keep the whole allowance", async () => {
  const above = Array.from({ length: TREE_LIMITS.depth }, (_, k) => 3000 + k); // as many epics as parts levels are allowed
  const work = 3100;
  const chain = Object.fromEntries(Array.from({ length: TREE_LIMITS.depth + 3 }, (_, k) => [work + k, [{ number: work + k + 1 }]]));
  const gh = treeGithub({
    listed: [oldIssue(work, { created_at: "2026-03-09T12:00:00Z", ...upTo(above[above.length - 1]) })],
    rest: Object.fromEntries(above.map((n, k) => [n, oldIssue(n, { ...EPIC, ...(k > 0 ? upTo(n - 1) : {}) })])),
    kids: {
      ...Object.fromEntries(above.map((n, k) => [n, [k + 1 < above.length ? { number: above[k + 1], labels: ["type:epic"] } : { number: work }]])),
      ...chain,
    },
    board: [boardNode(work, "Development")],
  });
  const { facts } = await factsOf(gh);
  const reads = [...gh.reads].sort((a, b) => a - b);
  assert.deepEqual(reads, [...above, ...Array.from({ length: TREE_LIMITS.depth + 1 }, (_, k) => work + k)]);
  assert.deepEqual(facts.entries.map((e) => [e.issue, e.epicPath?.length, e.epic?.issue]), [[work, above.length, above[above.length - 1]]]);
  assert.equal(facts.ignored.cut, 1); // the part at the last level read still has one below it
  assert.equal(facts.ignored.epics, above.length);
});
