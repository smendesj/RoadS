import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FACTS_PATH, DEFAULT_HIDE_PATH, runGithubCli } from "./gh-cli.ts";
import type { CliDeps } from "./gh-cli.ts";
import type { ProgressFacts } from "./gh-facts.ts";

const TOKEN = "ghp_CLI_SENTINEL_TOKEN_42";
const REPO = "Essencis-Labs/GeoCloudAI"; // the product repository the CLI is fixed on

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

/** A GitHub with one sprint issue (7, Development, nothing done) and one direct commit on main. */
function githubWithGraphql(opts: { unauthorized?: boolean } = {}) {
  const urls: string[] = [];
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    urls.push(input);
    if (opts.unauthorized) return json({ message: "Bad credentials" }, { status: 401 });
    const url = new URL(input);
    if (url.pathname === "/user") return json({ login: "dev-a" });
    if (url.pathname === `/repos/${REPO}/issues`) {
      return json([{ number: 7, title: "Tela de exemplo", state: "open", labels: [], assignees: [{ login: "dev-a" }], user: { login: "dev-a" }, created_at: "2026-03-09T12:00:00Z", body: "" }]);
    }
    if (url.pathname === `/repos/${REPO}/commits`) {
      return json([{ sha: "abcdef1234", commit: { committer: { date: "2026-03-09T20:00:00Z" } }, author: { login: "dev-a" } }]);
    }
    const query = (JSON.parse(String(init?.body)) as { query: string }).query;
    if (/projectV2\(number/.test(query)) {
      return json({
        data: {
          organization: {
            projectV2: {
              items: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ content: { __typename: "Issue", number: 7, repository: { nameWithOwner: REPO } }, fieldValueByName: { name: "Development", updatedAt: "2026-03-08T13:00:00Z" } }],
              },
            },
          },
        },
      });
    }
    return json({ data: { repository: { issue: { number: 7, subIssues: { nodes: [] }, closedByPullRequestsReferences: { nodes: [] }, timelineItems: { pageInfo: { hasNextPage: false }, nodes: [] } } } } });
  };
  return { urls, fetch };
}

function harness(files: Record<string, string> = {}, env: Record<string, string | undefined> = { GITHUB_TOKEN: TOKEN }) {
  const written = new Map<string, string>();
  const out: string[] = [];
  const err: string[] = [];
  const gh = githubWithGraphql();
  const deps: CliDeps = {
    env,
    fetch: gh.fetch,
    now: () => new Date("2026-03-11T15:00:00Z"),
    readText: (path) => files[path] ?? null,
    writeText: (path, text) => void written.set(path, text),
    log: (line) => void out.push(line),
    error: (line) => void err.push(line),
  };
  return { deps, written, out, err, gh };
}

const facts = (written: Map<string, string>): ProgressFacts => JSON.parse(written.get(DEFAULT_FACTS_PATH) ?? "null");

test("a run writes the facts of the window and prints a Portuguese summary without the token", async () => {
  const h = harness();
  const code = await runGithubCli(["--from", "2026-03-09", "--to", "2026-03-10"], h.deps);
  assert.equal(code, 0);
  const written = facts(h.written);
  assert.equal(written.scope, "GeoCloud");
  assert.deepEqual(written.window, { start: "2026-03-09T00:00:00-03:00", end: "2026-03-11T00:00:00-03:00" });
  assert.deepEqual(written.entries.map((e) => [e.issue, e.status]), [[7, "proximo"]]);
  assert.equal("gaps" in written, false); // no usage file given: not computed, not "no gaps"
  const printed = [...h.out, ...h.err].join("\n");
  assert.match(printed, /Próximo/);
  assert.match(printed, /facts\.json/);
  assert.ok(!printed.includes(TOKEN) && !h.written.get(DEFAULT_FACTS_PATH)?.includes(TOKEN));
});

test("with a usage file the coverage gaps are computed against the sessions", async () => {
  const usage = (sessionEnd: string) =>
    JSON.stringify({
      days: [{ date: "2026-03-09", sessions: [{ start: "2026-03-09T09:00:00-03:00", end: sessionEnd, messages: 4, tokens: 10 }], firstPromptAt: "2026-03-09T09:00:00-03:00", lastPromptAt: sessionEnd }],
    });
  // The direct commit on main is at 17:00 São Paulo.
  const far = harness({ "usage.json": usage("2026-03-09T10:00:00-03:00") });
  assert.equal(await runGithubCli(["--from", "2026-03-09", "--to", "2026-03-10", "--messages", "usage.json"], far.deps), 0);
  assert.deepEqual(facts(far.written).gaps?.map((g) => g.ref), ["commit abcdef1"]);
  const near = harness({ "usage.json": usage("2026-03-09T16:30:00-03:00") });
  assert.equal(await runGithubCli(["--from", "2026-03-09", "--to", "2026-03-10", "--messages", "usage.json"], near.deps), 0);
  assert.deepEqual(facts(near.written).gaps, []);
});

test("the local hide list is read from its default place", async () => {
  const h = harness({ [DEFAULT_HIDE_PATH]: JSON.stringify({ issues: [7] }) });
  assert.equal(await runGithubCli(["--from", "2026-03-09", "--to", "2026-03-10"], h.deps), 0);
  const written = facts(h.written);
  assert.deepEqual(written.entries, []);
  assert.equal(written.internal.count, 1);
});

test("wrong arguments are explained in Portuguese and nothing is sent to GitHub", async () => {
  for (const argv of [[], ["--from", "2026-03-09"], ["--from", "09/03/2026", "--to", "2026-03-10"], ["--from", "2026-03-10", "--to", "2026-03-09"], ["--nonsense"]]) {
    const h = harness();
    assert.equal(await runGithubCli(argv, h.deps), 2, JSON.stringify(argv));
    assert.ok(h.err.length > 0 && /--from|--to|opção|Use/i.test(h.err.join(" ")));
    assert.equal(h.gh.urls.length, 0);
    assert.equal(h.written.size, 0);
  }
});

test("a missing token stops the run before any request", async () => {
  const h = harness({}, {});
  assert.equal(await runGithubCli(["--from", "2026-03-09", "--to", "2026-03-10"], h.deps), 1);
  assert.match(h.err.join(" "), /GITHUB_TOKEN/);
  assert.equal(h.gh.urls.length, 0);
});

test("a refused token is reported without echoing the token or what GitHub said", async () => {
  const h = harness();
  h.deps.fetch = githubWithGraphql({ unauthorized: true }).fetch;
  assert.equal(await runGithubCli(["--from", "2026-03-09", "--to", "2026-03-10"], h.deps), 1);
  const printed = h.err.join(" ");
  assert.match(printed, /token/i);
  assert.ok(!printed.includes(TOKEN) && !printed.includes("Bad credentials"));
  assert.equal(h.written.size, 0);
});

test("a usage file that is missing or not a usage file is a clear error, not a crash", async () => {
  const missing = harness();
  assert.equal(await runGithubCli(["--from", "2026-03-09", "--to", "2026-03-10", "--messages", "nope.json"], missing.deps), 1);
  assert.match(missing.err.join(" "), /nope\.json/);
  const wrong = harness({ "usage.json": '{"hello": "world"}' });
  assert.equal(await runGithubCli(["--from", "2026-03-09", "--to", "2026-03-10", "--messages", "usage.json"], wrong.deps), 1);
  assert.match(wrong.err.join(" "), /uso/i);
  assert.equal(wrong.written.size, 0);
});
