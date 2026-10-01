// Which Claude sessions belong to the product the report is about. Decided per SESSION, never per event:
// a session that wanders for a minute into another folder is still the same piece of work. The rule has
// two legs: where the session was opened (its working directory) and what its tool calls pointed at.
// Pure on purpose: no "server-only", no "@/" imports.
import type { ToolTarget } from "./usage-parse.ts";

/** One connected project: where it is checked out, and which GitHub repositories belong to it. */
export type ProductRule = {
  /** Display name ("GeoCloud"); also what the per-project table prints. */
  name: string;
  /** Folders (forward slashes, no drive letter) where the project's repositories are checked out. */
  folders: readonly string[];
  /** GitHub repositories ("Owner/Repo") whose mention in a tool call counts as touching the project. */
  repos: readonly string[];
};

/** GeoCloud, the product the report is about. The folder is where it is checked out on the collecting machine. */
export const GEOCLOUD_RULE: ProductRule = { name: "GeoCloud", folders: ["Software/GeoCloud"], repos: ["Essencis-Labs/GeoCloudAI"] };

export type TargetKind = "scope" | "other" | "both" | "none";

/** Tool calls of one session, by what they pointed at. */
export type ToolTally = {
  scope: number;
  other: number;
  both: number;
  none: number;
  /** Calls with no explicit target that were made from a working directory in scope. */
  noneInScopeCwd: number;
  total: number;
};

export const emptyTally = (): ToolTally => ({ scope: 0, other: 0, both: 0, none: 0, noneInScopeCwd: 0, total: 0 });

export type ScopeMatcher = {
  rules: readonly ProductRule[];
  /** Index of the project whose folder holds this working directory, -1 when none does. */
  productOfCwd(cwd: string | null | undefined): number;
  inCwd(cwd: string | null | undefined): boolean;
  classify(target: ToolTarget): TargetKind;
  /** Indexes of the projects a tool call touches. */
  touched(target: ToolTarget): number[];
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The rule is the set of connected projects: a session is in scope when it belongs to ANY of them. */
export function scopeMatcher(rules: ProductRule | readonly ProductRule[] = GEOCLOUD_RULE): ScopeMatcher {
  const list: readonly ProductRule[] = Array.isArray(rules) ? rules : [rules as ProductRule];
  // A whole folder name: "GeoCloudOther" is not "GeoCloud". Any drive letter, either separator.
  const patterns = list.map((rule) =>
    rule.folders.map((folder) => new RegExp(`^[a-z]:[\\\\/]+${folder.split("/").filter(Boolean).map(escapeRegExp).join("[\\\\/]+")}([\\\\/]|$)`, "i"))
  );
  const productOf = (path: string): number => patterns.findIndex((group) => group.some((re) => re.test(path)));
  const productOfCwd = (cwd: string | null | undefined): number => (cwd ? productOf(cwd) : -1);
  const touched = (target: ToolTarget): number[] => {
    const hit = new Set<number>();
    list.forEach((rule, i) => {
      if (target.repos.some((slug) => rule.repos.includes(slug))) hit.add(i);
    });
    for (const root of target.roots) {
      const i = productOf(root);
      if (i >= 0) hit.add(i);
    }
    return [...hit].sort((a, b) => a - b);
  };
  return {
    rules: list,
    productOfCwd,
    inCwd: (cwd) => productOfCwd(cwd) >= 0,
    touched,
    classify(target) {
      // A watched repository of any project is a scope hit even when it is not one of the folders.
      let scope = target.repos.some((slug) => list.some((rule) => rule.repos.includes(slug)));
      let other = false;
      for (const root of target.roots) {
        if (productOf(root) >= 0) scope = true;
        else other = true;
      }
      return scope && other ? "both" : scope ? "scope" : other ? "other" : "none";
    },
  };
}

/** What the rule needs to know about a session. */
export type SessionFacts = {
  /** Full session id. */
  id: string;
  /** Working directory of the session's first main line (or its most frequent one). */
  startCwd: string | null;
  /** Lines the share of the working directory is taken over, and how many of them were in scope. */
  lines: number;
  scopeLines: number;
  tools: ToolTally;
};

export type ScopeBasis = "cwd" | "tools_majority" | "tools_minority" | "outside";

export type ScopeDecision = {
  include: boolean;
  /** The person should confirm this one: the rule is not sure. */
  borderline: boolean;
  basis: ScopeBasis;
  /** Set when the person's own include/exclude overrode the rule. */
  forced: "include" | "exclude" | null;
  /** Share of the calls with an explicit target that touch the scope (null: no such call). */
  explicitShare: number | null;
  explicitCalls: number;
  /** Share of all calls that touch the scope, counting target-less calls made from a scope directory. */
  effectiveShare: number | null;
  totalCalls: number;
  cwdShare: number;
};

export type ScopeOverrides = { include: readonly string[]; exclude: readonly string[] };

/**
 * The thresholds were calibrated against the real /stats numbers and a hand check of the borderline
 * sessions; keep them together here.
 *  - Opened in scope (or most lines there): in. Flagged when 10+ calls have an explicit target and fewer
 *    than 25% of them touch the scope (the session works on something else, from this folder).
 *  - Opened elsewhere: in, and flagged, when 5+ calls and most (over 50%) touch the scope; out, and
 *    flagged, when 5+ calls and at least 15% touch the scope; otherwise out, unflagged.
 */
export function decideScope(facts: SessionFacts, matcher: ScopeMatcher, overrides: Partial<ScopeOverrides> = {}): ScopeDecision {
  const t = facts.tools;
  const explicitCalls = t.scope + t.both + t.other;
  const explicitShare = explicitCalls ? (t.scope + t.both) / explicitCalls : null;
  const effectiveShare = t.total ? (t.scope + t.both + t.noneInScopeCwd) / t.total : null;
  const cwdShare = facts.lines ? facts.scopeLines / facts.lines : 0;

  let include: boolean;
  let borderline = false;
  let basis: ScopeBasis;
  if (matcher.inCwd(facts.startCwd) || cwdShare >= 0.5) {
    include = true;
    basis = "cwd";
    borderline = explicitCalls >= 10 && (explicitShare ?? 0) < 0.25;
  } else if (t.total >= 5 && (effectiveShare ?? 0) > 0.5) {
    include = true;
    borderline = true;
    basis = "tools_majority";
  } else if (t.scope + t.both >= 5 && (effectiveShare ?? 0) >= 0.15) {
    include = false;
    borderline = true;
    basis = "tools_minority";
  } else {
    include = false;
    basis = "outside";
  }

  // The person's decision wins over the rule; when both lists name the session, leaving it out wins.
  const id = facts.id.toLowerCase();
  const named = (ids: readonly string[] | undefined): boolean => !!ids?.some((prefix) => id.startsWith(prefix.toLowerCase()));
  let forced: ScopeDecision["forced"] = null;
  if (named(overrides.include)) {
    include = true;
    forced = "include";
  }
  if (named(overrides.exclude)) {
    include = false;
    forced = "exclude";
  }
  return { include, borderline, basis, forced, explicitShare, explicitCalls, effectiveShare, totalCalls: t.total, cwdShare };
}

/** Validates the content of `scope.json`: `{ "include": ["aaaa1111"], "exclude": [...] }`, ids of 6+ characters. */
export function readOverrides(raw: unknown): ScopeOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error('decisões de escopo: o arquivo deve conter um objeto { "include": [...], "exclude": [...] }');
  }
  const read = (key: "include" | "exclude"): string[] => {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
      throw new Error(`decisões de escopo: «${key}» deve ser uma lista de ids de sessão`);
    }
    const ids = (value as string[]).map((v) => v.trim().toLowerCase());
    for (const id of ids) {
      // A short prefix would match half the sessions.
      if (!/^[0-9a-f-]{6,}$/.test(id)) throw new Error(`decisões de escopo: «${key}» tem um id inválido («${id}»); use os 8 primeiros caracteres do id da sessão`);
    }
    return [...new Set(ids)];
  };
  return { include: read("include"), exclude: read("exclude") };
}

/** Both lists combined; where they disagree about a session, `top` (the command line) wins over `base` (the file). */
export function mergeOverrides(base: ScopeOverrides, top: ScopeOverrides): ScopeOverrides {
  const unique = (ids: string[]): string[] => [...new Set(ids)];
  return {
    include: unique([...base.include.filter((id) => !top.exclude.includes(id)), ...top.include]),
    exclude: unique([...base.exclude.filter((id) => !top.include.includes(id)), ...top.exclude]),
  };
}

const MAX_PRODUCTS = 8;
const MAX_PRODUCT_NAME = 60;

/**
 * The `products` of `scope.json`: `[{ "name": "...", "roots": ["C:\dir", ...], "repos": ["Owner/Repo"] }]`
 * (`repos` is optional). undefined when the file names no projects, so the caller falls back to GeoCloud.
 */
export function readProducts(raw: unknown): ProductRule[] | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = (raw as Record<string, unknown>).products;
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('projetos de escopo: «products» deve ser uma lista com ao menos um projeto { "name", "roots" }');
  }
  if (value.length > MAX_PRODUCTS) throw new Error(`projetos de escopo: no máximo ${MAX_PRODUCTS} projetos em «products»`);
  const seen = new Set<string>();
  return value.map((item, index) => {
    const at = `projetos de escopo: projeto ${index + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${at} deve ser um objeto { "name", "roots" }; veja «products»`);
    }
    const entry = item as Record<string, unknown>;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (name === "") throw new Error(`${at}: o nome («name») deve ser um texto não vazio`);
    if ([...name].length > MAX_PRODUCT_NAME) throw new Error(`${at}: o nome deve ter no máximo ${MAX_PRODUCT_NAME} caracteres`);
    if (seen.has(name.toLowerCase())) throw new Error(`${at}: nome repetido («${name}»)`);
    seen.add(name.toLowerCase());

    if (!Array.isArray(entry.roots) || entry.roots.length === 0) {
      throw new Error(`${at} («${name}»): «roots» deve ser uma lista com ao menos uma pasta`);
    }
    const folders = entry.roots.map((root) => {
      // Drive letter plus at least one folder: a bare "C:\" would put every session in scope.
      const match = typeof root === "string" ? /^[A-Za-z]:[\\/]+(.*?)[\\/]*$/.exec(root.trim()) : null;
      const parts = match ? match[1].split(/[\\/]+/).filter(Boolean) : [];
      if (parts.length === 0) throw new Error(`${at} («${name}»): cada pasta de «roots» deve ser um caminho absoluto, como C:\\pasta\\projeto`);
      return parts.join("/");
    });

    // The one repository we know by heart follows the project of that name unless the file says otherwise.
    const repos = entry.repos === undefined ? (name.toLowerCase() === GEOCLOUD_RULE.name.toLowerCase() ? GEOCLOUD_RULE.repos : []) : entry.repos;
    if (!Array.isArray(repos) || repos.some((r) => typeof r !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(r.trim()))) {
      throw new Error(`${at} («${name}»): «repos» deve ser uma lista de repositórios no formato Dono/Repo`);
    }
    return { name, folders: [...new Set(folders)], repos: [...new Set((repos as string[]).map((r) => r.trim()))] };
  });
}
