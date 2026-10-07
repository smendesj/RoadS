// Reads GitHub for the report: REST for the issue list and the default branch, GraphQL for timelines,
// pull requests and Project #7. READ-ONLY by construction (GET and GraphQL queries; a mutation is refused
// before it leaves the machine). The token comes from the caller and is only ever put in the Authorization
// header: errors are explained in Portuguese and never echo the token, the URL or what GitHub answered.
import type { ReportWindow } from "../progress-report.ts";
import { MAIN_BRANCH } from "./gh-status.ts";
import { isEpic } from "./gh-facts.ts";
import type { FactsInput, GhCommit, GhIssue, GhPr, GhProjectItem, GhTimeline } from "./gh-facts.ts";

const API = "https://api.github.com";
const PER_PAGE = 100;
const MAX_PAGES = 50;
const PROJECT_NUMBER = 7;
const PARALLEL = 4;
const PR_CHUNK = 20;

/**
 * How far the tree of sub-issues is followed below a DELIVERY (the highest issue that is not an epic: an epic only
 * groups, see isEpic): `depth` levels below it and `family` sub-issues read under it (GitHub allows a hundred under
 * each issue, and each one read costs a request). The epics above a delivery are read to find it and cost it
 * nothing. Past either limit the rest is NOT read, and the issue that was cut keeps what GitHub says it has, so
 * buildFacts shows the gap in `ignored.cut` and in the entry's evidence. Both leave about twice the room the
 * largest delivery of the product takes today, and the tree only grows.
 */
export const TREE_LIMITS = { depth: 6, family: 400 } as const;
/** GitHub's own limit on how deep sub-issues nest: no issue has more than seven above it. */
const MAX_NESTING = 8;

export type GithubErrorKind = "token" | "rate_limit" | "forbidden" | "not_found" | "server" | "network" | "graphql" | "http" | "parse" | "read_only";

export class GithubError extends Error {
  kind: GithubErrorKind;
  constructor(kind: GithubErrorKind, message: string) {
    super(message);
    this.name = "GithubError";
    this.kind = kind;
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type GithubClient = {
  viewerLogin(): Promise<string>;
  get<T>(path: string, query?: Record<string, string>): Promise<T>;
  /** Every page of a REST listing, until a short page (or a missing "next" link) ends it. */
  list<T>(path: string, query?: Record<string, string>): Promise<T[]>;
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
};

const SP_CLOCK = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function rateLimited(headers: Headers): GithubError {
  const reset = Number(headers.get("x-ratelimit-reset"));
  const wait = Number(headers.get("retry-after"));
  const when = Number.isFinite(reset) && reset > 0 ? ` Tente de novo depois das ${SP_CLOCK.format(new Date(reset * 1000))} (horário de São Paulo).` : Number.isFinite(wait) && wait > 0 ? ` Tente de novo em cerca de ${wait} s.` : " Tente de novo daqui a alguns minutos.";
  return new GithubError("rate_limit", `O GitHub atingiu o limite de requisições.${when}`);
}

function failure(res: Response): GithubError {
  const { status, headers } = res;
  if (status === 401) return new GithubError("token", "O GitHub recusou o token (HTTP 401). Confira o GITHUB_TOKEN em .env.local e se ele não expirou.");
  if (status === 429 || (status === 403 && (headers.get("x-ratelimit-remaining") === "0" || headers.get("retry-after")))) return rateLimited(headers);
  if (status === 403) {
    return new GithubError("forbidden", "O GitHub negou o acesso (HTTP 403). O token precisa dos escopos repo, read:org e project, e de uma conta da organização.");
  }
  if (status === 404) return new GithubError("not_found", "O GitHub não encontrou o que foi pedido (HTTP 404). Confira o nome do repositório e se o token enxerga o repositório e o projeto.");
  if (status >= 500) return new GithubError("server", `O GitHub está com problemas agora (HTTP ${status}). Tente de novo em alguns minutos.`);
  return new GithubError("http", `O GitHub respondeu HTTP ${status}.`);
}

function graphqlFailure(errors: { type?: string }[]): GithubError {
  const types = errors.map((e) => e.type ?? "");
  if (types.includes("RATE_LIMITED")) return new GithubError("rate_limit", "O GitHub atingiu o limite de requisições. Tente de novo daqui a alguns minutos.");
  if (types.some((t) => t === "FORBIDDEN" || t === "INSUFFICIENT_SCOPES" || t === "NOT_FOUND")) {
    return new GithubError("forbidden", "O token não tem permissão para ler o projeto ou o repositório (precisa dos escopos repo, read:org e project, numa conta da organização).");
  }
  return new GithubError("graphql", "O GitHub recusou uma consulta (erro de GraphQL). Tente de novo; se persistir, avise quem mantém o RoadS.");
}

export function createGithubClient(opts: { token: string; fetch?: Fetch }): GithubClient {
  const token = opts.token.trim();
  if (!token) throw new GithubError("token", "Falta o GITHUB_TOKEN: defina-o em .env.local (um token clássico com os escopos repo, read:org e project).");
  const doFetch: Fetch = opts.fetch ?? ((input, init) => fetch(input, init));

  async function request(method: "GET" | "POST", path: string, query: Record<string, string> = {}, body?: string) {
    const url = new URL(path, API);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await doFetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "roads-progress-report",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body,
      });
    } catch {
      throw new GithubError("network", "Não consegui falar com o GitHub (falha de conexão). Verifique a rede e tente de novo.");
    }
    if (!res.ok) throw failure(res);
    try {
      return { data: (await res.json()) as unknown, headers: res.headers };
    } catch {
      throw new GithubError("parse", "O GitHub devolveu uma resposta que não consegui ler.");
    }
  }

  const client: GithubClient = {
    async viewerLogin() {
      const user = await client.get<{ login?: string }>("/user");
      if (!user.login) throw new GithubError("parse", "O GitHub não disse a quem pertence o token.");
      return user.login;
    },
    async get<T>(path: string, query?: Record<string, string>) {
      return (await request("GET", path, query)).data as T;
    },
    async list<T>(path: string, query: Record<string, string> = {}) {
      const all: T[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { data, headers } = await request("GET", path, { ...query, per_page: String(PER_PAGE), page: String(page) });
        if (!Array.isArray(data)) throw new GithubError("parse", "O GitHub devolveu uma lista em formato inesperado.");
        all.push(...(data as T[]));
        const link = headers.get("link");
        if (data.length < PER_PAGE || (link !== null && !/rel="next"/.test(link))) return all;
      }
      throw new GithubError("http", `A lista tem páginas demais (mais de ${MAX_PAGES}); reduza o período.`);
    },
    async graphql<T>(query: string, variables: Record<string, unknown> = {}) {
      if (/\bmutation\b/i.test(query)) {
        throw new GithubError("read_only", "Este cliente é somente leitura: consultas de escrita não são enviadas ao GitHub.");
      }
      const { data } = await request("POST", "/graphql", {}, JSON.stringify({ query, variables }));
      const body = data as { data?: T | null; errors?: { type?: string }[] };
      // A missing item (NOT_FOUND on one alias) is not a failure of the whole query.
      if (body.errors?.length && !(body.data && body.errors.every((e) => e.type === "NOT_FOUND"))) throw graphqlFailure(body.errors);
      if (!body.data) throw new GithubError("parse", "O GitHub devolveu uma resposta GraphQL vazia.");
      return body.data;
    },
  };
  return client;
}

/* ---------- Normalizing what GitHub sends ---------- */

type RestIssue = {
  number: number;
  title?: string;
  html_url?: string;
  state?: string;
  state_reason?: string | null;
  created_at: string;
  closed_at?: string | null;
  labels?: ({ name?: string } | string)[];
  user?: { login?: string } | null;
  assignees?: { login?: string }[] | null;
  body?: string | null;
  pull_request?: unknown;
  parent_issue_url?: string | null;
  sub_issues_summary?: { total?: number; completed?: number } | null;
};

const reason = (r: string | null | undefined): GhIssue["stateReason"] => {
  const v = (r ?? "").toLowerCase();
  return v === "completed" || v === "not_planned" || v === "reopened" ? v : null;
};

function issueFromRest(i: RestIssue, repository: string): GhIssue {
  const parent = new RegExp(`/repos/${repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/issues/(\\d+)$`, "i").exec(i.parent_issue_url ?? "");
  return {
    number: i.number,
    title: i.title ?? "",
    url: i.html_url ?? `https://github.com/${repository}/issues/${i.number}`,
    state: i.state === "closed" ? "closed" : "open",
    stateReason: reason(i.state_reason),
    createdAt: i.created_at,
    closedAt: i.closed_at ?? null,
    labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean),
    author: i.user?.login ?? null,
    assignees: (i.assignees ?? []).map((a) => a.login ?? "").filter(Boolean),
    body: i.body ?? "",
    parent: parent ? Number(parent[1]) : null,
    subIssues: i.sub_issues_summary ? { total: i.sub_issues_summary.total ?? 0, completed: i.sub_issues_summary.completed ?? 0 } : null,
  };
}

/* ---------- GraphQL documents ---------- */

const PROJECT_QUERY = `query($owner: String!, $after: String) { organization(login: $owner) { projectV2(number: ${PROJECT_NUMBER}) {
  items(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes {
    content { __typename ... on Issue { number repository { nameWithOwner } } ... on PullRequest { number repository { nameWithOwner } } }
    fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt } }
  } } } } }`;

const ISSUE_QUERY = `query($owner: String!, $name: String!, $n: Int!, $cursor: String) { repository(owner: $owner, name: $name) { issue(number: $n) {
  number
  subIssues(first: 100) { totalCount nodes { number title state stateReason createdAt closedAt url repository { nameWithOwner } labels(first: 20) { nodes { name } } } }
  closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { number repository { nameWithOwner } } }
  timelineItems(first: 100, after: $cursor, itemTypes: [CROSS_REFERENCED_EVENT, REFERENCED_EVENT, CLOSED_EVENT, PROJECT_V2_ITEM_STATUS_CHANGED_EVENT, CONNECTED_EVENT]) {
    pageInfo { hasNextPage endCursor }
    nodes { __typename
      ... on CrossReferencedEvent { willCloseTarget source { __typename ... on PullRequest { number repository { nameWithOwner } } } }
      ... on ReferencedEvent { commit { oid committedDate author { user { login } } } }
      ... on ClosedEvent { closer { __typename ... on PullRequest { number repository { nameWithOwner } } } }
      ... on ProjectV2ItemStatusChangedEvent { createdAt status project { number } }
      ... on ConnectedEvent { subject { __typename ... on PullRequest { number repository { nameWithOwner } } } }
    }
  }
} } }`;

const PR_FIELDS = `number title url state isDraft merged mergedAt createdAt closedAt baseRefName
  author { login } mergeCommit { oid }
  closingIssuesReferences(first: 10) { nodes { number repository { nameWithOwner } } }
  commits(first: 100) { totalCount nodes { commit { oid committedDate author { user { login } } } } }`;

const prsQuery = (numbers: number[]) =>
  `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {\n${numbers.map((n) => `p${n}: pullRequest(number: ${n}) { ${PR_FIELDS} }`).join("\n")}\n} }`;

type Nodes<T> = { nodes?: (T | null)[] | null } | null | undefined;
function nodesOf<T>(c: Nodes<T>): T[] {
  return (c?.nodes ?? []).filter((n): n is T => n != null);
}
type RepoRef = { nameWithOwner?: string } | null | undefined;
const sameRepo = (r: RepoRef, repository: string): boolean => (r?.nameWithOwner ?? "").toLowerCase() === repository.toLowerCase();

type PrRef = { __typename?: string; number?: number; repository?: RepoRef } | null | undefined;
type TimelineEvent = {
  __typename?: string;
  createdAt?: string;
  status?: string;
  project?: { number?: number } | null;
  willCloseTarget?: boolean;
  source?: PrRef;
  closer?: PrRef;
  subject?: PrRef;
  commit?: { oid?: string; committedDate?: string; author?: { user?: { login?: string } | null } | null } | null;
};

type IssueDetail = {
  timeline: GhTimeline;
  /** Pull requests this issue's timeline points at (any link kind): their details are fetched next. */
  prNumbers: number[];
  /** The sub-issues of this repository that GitHub listed (a sub-issue of another repository is left out). */
  children: GhIssue[];
  /** What GitHub counts under this issue, all repositories together; null when GitHub did not answer for it. */
  childSummary: { total: number; completed: number } | null;
};

type SubIssueNode = {
  number: number;
  title?: string;
  state?: string;
  stateReason?: string | null;
  createdAt: string;
  closedAt?: string | null;
  url?: string;
  repository?: RepoRef;
  labels?: Nodes<{ name?: string }>;
};

async function fetchIssueDetail(client: GithubClient, repository: string, n: number): Promise<IssueDetail> {
  const [owner, name] = repository.split("/");
  const timeline: GhTimeline = { issue: n, commits: [], closers: [], statusHistory: [] };
  const prNumbers = new Set<number>();
  const closers = new Set<number>();
  let children: GhIssue[] = [];
  let childSummary: IssueDetail["childSummary"] = null;
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const data: {
      repository?: {
        issue?: {
          subIssues?: { totalCount?: number | null; nodes?: (SubIssueNode | null)[] | null } | null;
          closedByPullRequestsReferences?: Nodes<{ number: number; repository?: RepoRef }>;
          timelineItems?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: (TimelineEvent | null)[] };
        } | null;
      };
    } = await client.graphql(ISSUE_QUERY, { owner, name, n, cursor });
    const issue = data.repository?.issue;
    if (!issue) break;
    if (page === 0) {
      for (const ref of nodesOf(issue.closedByPullRequestsReferences)) {
        if (sameRepo(ref.repository, repository)) {
          prNumbers.add(ref.number);
          closers.add(ref.number);
        }
      }
      const kids = nodesOf(issue.subIssues);
      const closed = (k: SubIssueNode) => (k.state ?? "").toUpperCase() === "CLOSED";
      childSummary = { total: Math.max(issue.subIssues?.totalCount ?? 0, kids.length), completed: kids.filter(closed).length };
      // A sub-issue of another repository has a number that means some other issue here: it is not read.
      children = kids
        .filter((k) => !k.repository?.nameWithOwner || sameRepo(k.repository, repository))
        .map((k) => ({
          number: k.number,
          title: k.title ?? "",
          url: k.url ?? `https://github.com/${repository}/issues/${k.number}`,
          state: closed(k) ? "closed" : "open",
          stateReason: reason(k.stateReason),
          createdAt: k.createdAt,
          closedAt: k.closedAt ?? null,
          labels: nodesOf(k.labels).map((l) => l.name ?? "").filter(Boolean),
          author: null,
          assignees: [],
          body: "",
          parent: n,
          subIssues: null,
        }));
    }
    for (const e of (issue.timelineItems?.nodes ?? []).filter((x): x is TimelineEvent => x != null)) {
      const inRepo = (ref: PrRef) => ref?.__typename === "PullRequest" && typeof ref.number === "number" && sameRepo(ref.repository, repository);
      if (e.__typename === "CrossReferencedEvent" && inRepo(e.source)) {
        prNumbers.add(e.source?.number as number);
        if (e.willCloseTarget) closers.add(e.source?.number as number);
      } else if (e.__typename === "ConnectedEvent" && inRepo(e.subject)) {
        prNumbers.add(e.subject?.number as number);
      } else if (e.__typename === "ClosedEvent" && inRepo(e.closer)) {
        prNumbers.add(e.closer?.number as number);
        closers.add(e.closer?.number as number);
      } else if (e.__typename === "ReferencedEvent" && e.commit?.oid && e.commit.committedDate) {
        timeline.commits.push({ oid: e.commit.oid, at: e.commit.committedDate, author: e.commit.author?.user?.login ?? null });
      } else if (e.__typename === "ProjectV2ItemStatusChangedEvent" && e.project?.number === PROJECT_NUMBER && e.createdAt && e.status) {
        timeline.statusHistory.push({ at: e.createdAt, to: e.status });
      }
    }
    const info = issue.timelineItems?.pageInfo;
    if (!info?.hasNextPage || !info.endCursor) break;
    cursor = info.endCursor;
  }
  timeline.closers = [...closers];
  return { timeline, prNumbers: [...prNumbers], children, childSummary };
}

async function fetchPrs(client: GithubClient, repository: string, numbers: number[]): Promise<GhPr[]> {
  const [owner, name] = repository.split("/");
  const chunks: number[][] = [];
  for (let i = 0; i < numbers.length; i += PR_CHUNK) chunks.push(numbers.slice(i, i + PR_CHUNK));
  const pages = await mapPool(chunks, PARALLEL, (chunk) =>
    client.graphql<{ repository?: Record<string, PrNode | null> }>(prsQuery(chunk), { owner, name })
  );
  const prs: GhPr[] = [];
  for (const page of pages) {
    for (const node of Object.values(page.repository ?? {})) if (node) prs.push(prFromNode(node, repository));
  }
  return prs.sort((a, b) => a.number - b.number);
}

type PrNode = {
  number: number;
  title?: string;
  url?: string;
  state?: string;
  isDraft?: boolean;
  merged?: boolean;
  mergedAt?: string | null;
  createdAt: string;
  closedAt?: string | null;
  baseRefName?: string | null;
  author?: { login?: string } | null;
  mergeCommit?: { oid?: string } | null;
  closingIssuesReferences?: Nodes<{ number: number; repository?: RepoRef }>;
  commits?: Nodes<{ commit?: { oid?: string; committedDate?: string; author?: { user?: { login?: string } | null } | null } | null }>;
};

function prFromNode(n: PrNode, repository: string): GhPr {
  const commits: GhCommit[] = nodesOf(n.commits)
    .map((c) => c.commit)
    .filter((c): c is NonNullable<typeof c> => !!c?.oid && !!c.committedDate)
    .map((c) => ({ oid: c.oid as string, at: c.committedDate as string, author: c.author?.user?.login ?? null }));
  const first = commits.map((c) => c.at).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  return {
    number: n.number,
    title: n.title ?? "",
    url: n.url ?? `https://github.com/${repository}/pull/${n.number}`,
    state: n.merged ? "merged" : (n.state ?? "").toUpperCase() === "CLOSED" ? "closed" : "open",
    draft: !!n.isDraft,
    base: n.baseRefName ?? null,
    createdAt: n.createdAt,
    closedAt: n.closedAt ?? null,
    mergedAt: n.mergedAt ?? null,
    firstCommitAt: first,
    author: n.author?.login ?? null,
    closing: nodesOf(n.closingIssuesReferences).filter((r) => sameRepo(r.repository, repository)).map((r) => r.number),
    commits,
    mergeCommit: n.mergeCommit?.oid ?? null,
  };
}

async function scanProject(client: GithubClient, owner: string): Promise<GhProjectItem[]> {
  type Page = {
    organization?: {
      projectV2?: {
        items: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: ({ content?: { __typename?: string; number?: number; repository?: RepoRef } | null; fieldValueByName?: { name?: string; updatedAt?: string } | null } | null)[];
        };
      } | null;
    } | null;
  };
  const items: GhProjectItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < 30; page++) {
    const data: Page = await client.graphql(PROJECT_QUERY, { owner, after });
    const project = data.organization?.projectV2;
    if (!project) {
      throw new GithubError("forbidden", "O token não enxerga o Project #7 da organização (precisa dos escopos repo, read:org e project, numa conta da organização).");
    }
    for (const node of project.items.nodes) {
      const c = node?.content;
      if (!c?.repository?.nameWithOwner || typeof c.number !== "number") continue; // draft items belong to no repository
      items.push({
        repository: c.repository.nameWithOwner,
        number: c.number,
        kind: c.__typename === "PullRequest" ? "PullRequest" : "Issue",
        status: node?.fieldValueByName?.name ?? null,
        statusUpdatedAt: node?.fieldValueByName?.updatedAt ?? null,
      });
    }
    if (!project.items.pageInfo.hasNextPage) return items;
    after = project.items.pageInfo.endCursor;
  }
  throw new GithubError("http", "O Project #7 tem itens demais para ler.");
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping the order of the results. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const utc = (instant: string): string => new Date(instant).toISOString().replace(/\.\d{3}Z$/, "Z");

export type CollectedData = Pick<FactsInput, "issues" | "prs" | "timelines" | "projectItems" | "mainCommits">;

/**
 * Everything buildFacts needs, for one repository and one window: the issues and PRs touched since the
 * window opened, the sprint issues that were quiet, the issues above a touched sub-issue, every issue's
 * timeline (and that of every sub-issue under it, at any depth up to TREE_LIMITS), the PR details with their
 * commits, Project #7, and the commits on the default branch.
 */
export async function collectGithubData(
  client: GithubClient,
  opts: { repository: string; window: ReportWindow; author?: string | null }
): Promise<CollectedData> {
  const { repository, window } = opts;
  const [owner] = repository.split("/");
  const since = utc(window.start);

  const listed = await client.list<RestIssue>(`/repos/${repository}/issues`, { state: "all", since, sort: "created", direction: "asc" });
  const issues = new Map<number, GhIssue>();
  const prNumbers = new Set<number>();
  for (const item of listed) {
    if (item.pull_request) prNumbers.add(item.number);
    else issues.set(item.number, issueFromRest(item, repository));
  }

  const projectItems = await scanProject(client, owner);
  // A sprint issue nobody touched in the window still belongs in the report: it is "proximo".
  const quiet = projectItems.filter(
    (it) =>
      it.kind === "Issue" &&
      it.repository.toLowerCase() === repository.toLowerCase() &&
      (it.status === "Development" || it.status === "Blocker") &&
      !issues.has(it.number)
  );
  for (const it of quiet) {
    const one = await client.get<RestIssue>(`/repos/${repository}/issues/${it.number}`);
    if (!one.pull_request) issues.set(one.number, issueFromRest(one, repository));
  }

  // A sub-issue touched in the window brings the issues above it, quiet or not: the delivery is the entry, and
  // its parts (this one among them) are what the report counts; the epics above it are only its header.
  const asked = new Set<number>();
  for (let hop = 0; hop < MAX_NESTING - 1; hop++) {
    const above = [...new Set([...issues.values()].map((i) => i.parent))].filter((p): p is number => p != null && !issues.has(p) && !asked.has(p));
    if (above.length === 0) break;
    await mapPool(above, PARALLEL, async (n) => {
      asked.add(n);
      const one = await client.get<RestIssue>(`/repos/${repository}/issues/${n}`);
      if (!one.pull_request) issues.set(one.number, issueFromRest(one, repository));
    });
  }

  // Where an issue hangs inside a delivery: the highest issue above it (or itself) that is not an epic, and how many
  // levels down it is. Null for an epic with nothing but epics above it: it only groups.
  const placeOf = (n: number): { root: number; below: number } | null => {
    const chain = [n];
    const seen = new Set([n]);
    for (let p = issues.get(n)?.parent; p != null && issues.has(p) && !seen.has(p); p = issues.get(p)?.parent) {
      chain.push(p);
      seen.add(p);
    }
    let top = -1;
    chain.forEach((m, k) => {
      if (!isEpic(issues.get(m) as GhIssue)) top = k;
    });
    return top < 0 ? null : { root: chain[top], below: top };
  };
  // The deliveries that have news (touched in the window, on the sprint board, or with a touched part below): the
  // others are known by name and state, so an epic can count its parts, but are not read.
  const wanted = new Set<number>();
  const familySize = new Map<number, number>();
  for (const i of issues.values()) {
    const place = placeOf(i.number);
    if (!place) continue;
    wanted.add(place.root);
    if (place.below > 0) familySize.set(place.root, (familySize.get(place.root) ?? 0) + 1);
  }

  // Every issue that matters is read (its timeline is where its PRs and commits are), level by level: what the list
  // showed first, then the sub-issues each one names, and theirs. Inside a delivery an issue's sub-issues come in
  // whole or not at all when they would pass TREE_LIMITS; what GitHub counts under it stays on the issue, so the gap
  // shows. An epic names its deliveries, all of them, and only those with news are read down.
  const timelines = new Map<number, GhTimeline>();
  const details = new Map<number, IssueDetail>();
  const read = async (n: number): Promise<void> => {
    const detail = await fetchIssueDetail(client, repository, n);
    details.set(n, detail);
    timelines.set(n, detail.timeline);
    detail.prNumbers.forEach((p) => prNumbers.add(p));
  };
  // What hangs from an item of the sprint (Project #7 on Development) is read whole, news or not: the sprint block
  // says how many parts of it are left, and that needs every one of them.
  const covers = new Set(
    projectItems.filter((it) => it.kind === "Issue" && it.status === "Development" && it.repository.toLowerCase() === repository.toLowerCase()).map((it) => it.number)
  );
  const covered = new Set<number>();
  const expanded = new Set<number>();
  let level = [...issues.keys()];
  while (level.length > 0) {
    level.sort((a, b) => a - b);
    await mapPool(level.filter((n) => !details.has(n)), PARALLEL, read);
    const next: number[] = [];
    for (const n of level) {
      if (expanded.has(n)) continue;
      expanded.add(n);
      const issue = issues.get(n) as GhIssue;
      const detail = details.get(n) as IssueDetail;
      if (issue.subIssues === null && detail.childSummary) issue.subIssues = detail.childSummary;
      const fresh = detail.children.filter((k) => !issues.has(k.number));
      if (fresh.length === 0) continue;
      const place = placeOf(n);
      const inCover = covers.has(n) || covered.has(n);
      if (place) {
        if (place.below >= TREE_LIMITS.depth || (familySize.get(place.root) ?? 0) + fresh.length > TREE_LIMITS.family) continue;
        familySize.set(place.root, (familySize.get(place.root) ?? 0) + fresh.length);
      }
      for (const kid of fresh) {
        issues.set(kid.number, kid);
        if (inCover) covered.add(kid.number);
        if (place || inCover || isEpic(kid) || wanted.has(kid.number)) next.push(kid.number);
      }
    }
    level = next;
  }

  const prs = await fetchPrs(client, repository, [...prNumbers].sort((a, b) => a - b));

  const rawCommits = await client.list<{ sha: string; commit?: { committer?: { date?: string } | null; author?: { date?: string } | null }; author?: { login?: string } | null }>(
    `/repos/${repository}/commits`,
    { sha: MAIN_BRANCH, since, until: utc(window.end), ...(opts.author ? { author: opts.author } : {}) }
  );
  const mainCommits: GhCommit[] = rawCommits
    .map((c) => ({ oid: c.sha, at: c.commit?.committer?.date ?? c.commit?.author?.date ?? "", author: c.author?.login ?? null }))
    .filter((c) => c.at);

  return { issues: [...issues.values()], prs, timelines: [...timelines.values()], projectItems, mainCommits };
}
