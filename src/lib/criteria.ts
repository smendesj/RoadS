// The acceptance criteria of an issue body: one box per slice of a delivery, the way Frontlights writes them since it
// stopped creating sub-issues (its issue #23). The reading rules are Frontlights' own (`scan` in its
// skills/frontlights/scripts/closeout.py), so both sides count the same boxes:
//   - the section is a markdown heading of any level whose text, without accents and in lower case, starts with
//     "acceptance criteria", "criterios de aceitacao" or "criterios de aceite"; it runs to the next heading of the
//     same or a higher level (deeper headings belong to it), and several such sections add up;
//   - the items are `- [ ]`, `* [x]`, `+ [X]` and numbered `1. [ ]` / `1) [ ]`, indented or not;
//   - fenced code and HTML comments are skipped, items outside the section never count, and a sub-item without a
//     box ("Entrega:", "Seams:", ...) is no item;
//   - a legacy "pendências conhecidas" / "known pending" section is no criteria (a criteria heading nested in it
//     still opens the criteria, as in Frontlights).
// Agreed with Frontlights on 13/10/2026: a sub-item "Bloqueada: <what is missing, from whom>" right under a box
// says that slice is parked.
// Pure, used by the Resumo's collector (scripts/progress/github.ts) and the Dashboard's Slices block.

export type Box = {
  /** The box's line after the `[ ]`, trimmed. */
  text: string;
  checked: boolean;
  /** What a "Bloqueada:" sub-item under the box says, or null when there is none. */
  blocked: string | null;
};

const PHRASES = ["acceptance criteria", "criterios de aceitacao", "criterios de aceite"];
const LEGACY_PHRASES = ["pendencias conhecidas", "known pending"];
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+([\s\S]*))?$/;
const LINE_CAP = 2000;
const FENCE = /^[ \t]*(`{3,}|~{3,})([\s\S]*)$/;
const ITEM = /^([ \t]*)(?:[-*+]|[0-9]{1,9}[.)])[ \t]+\[([ xX])\](?=[ \t]|$)([\s\S]*)$/;
const LIST_LINE = /^([ \t]*)(?:[-*+]|[0-9]{1,9}[.)])[ \t]+([\s\S]*)$/;

/** Lower case, no accents, single spaces, and no leading decoration (emphasis marks, emoji). */
function plain(text: string): string {
  const bare = text.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
  return bare.split(/\s+/).filter(Boolean).join(" ").replace(/^[^\p{L}\p{N}]+/u, "");
}

/** A heading's text without its optional closing sequence of `#` (which must follow a space). */
function headingText(text: string): string {
  let t = text.replace(/[ \t]+$/, "");
  const bare = t.replace(/#+$/, "");
  if (bare !== t && (bare === "" || bare.endsWith(" ") || bare.endsWith("\t"))) t = bare.replace(/[ \t]+$/, "");
  return t;
}

function stripComments(line: string): [string, boolean] {
  for (;;) {
    const start = line.indexOf("<!--");
    if (start < 0) return [line, false];
    const end = line.indexOf("-->", start + 4);
    if (end < 0) return [line.slice(0, start), true];
    line = line.slice(0, start) + line.slice(end + 3);
  }
}

/** Every line outside fenced code and HTML comments, without its comments and cut at LINE_CAP. */
function visibleLines(body: string): string[] {
  const out: string[] = [];
  let fence: { ch: string; len: number } | null = null;
  let comment = false;
  for (let raw of body.split(/\r\n|\r|\n/)) {
    if (comment) {
      const end = raw.indexOf("-->");
      if (end < 0) continue;
      raw = raw.slice(end + 3);
      comment = false;
    }
    if (fence) {
      if (new RegExp(`^[ \\t]*\\${fence.ch}{${fence.len},}[ \\t]*$`).test(raw)) fence = null;
      continue;
    }
    const [line, open] = stripComments(raw);
    comment = open;
    const opened = FENCE.exec(line);
    if (opened && !(opened[1][0] === "`" && opened[2].includes("`"))) {
      fence = { ch: opened[1][0], len: opened[1].length };
      continue;
    }
    out.push(line.slice(0, LINE_CAP));
  }
  return out;
}

const indentOf = (s: string): number => [...s].reduce((w, c) => w + (c === "\t" ? 4 - (w % 4) : 1), 0);

/** The boxes of the body's acceptance-criteria sections, in order; null when the body has no such section. */
export function criteriaBoxes(body: string): Box[] | null {
  if (typeof body !== "string") return null;
  const boxes: Box[] = [];
  let found = false;
  let level: number | null = null;
  let kind: "criteria" | "pending" | null = null;
  let last: { box: Box; indent: number } | null = null;
  for (const line of visibleLines(body)) {
    const heading = HEADING.exec(line);
    if (heading) {
      const depth = heading[1].length;
      const name = plain(headingText(heading[2] ?? ""));
      const opensCriteria = PHRASES.some((p) => name.startsWith(p));
      if (level !== null && depth > level && !(kind === "pending" && opensCriteria)) continue;
      level = null;
      kind = null;
      last = null;
      if (opensCriteria) {
        level = depth;
        kind = "criteria";
        found = true;
      } else if (LEGACY_PHRASES.some((p) => name.startsWith(p))) {
        level = depth;
        kind = "pending";
      }
      continue;
    }
    if (kind !== "criteria") continue;
    const item = ITEM.exec(line);
    if (item) {
      const box: Box = { text: item[3].trim(), checked: item[2] !== " ", blocked: null };
      boxes.push(box);
      last = { box, indent: indentOf(item[1]) };
      continue;
    }
    const sub = LIST_LINE.exec(line);
    if (sub && last && indentOf(sub[1]) <= last.indent) {
      last = null; // a list line at the box's level or above: what follows is no longer under that box
      continue;
    }
    if (sub && last && last.box.blocked === null) {
      // "Bloqueada:", with or without bold or italics anywhere around the word.
      if (/^bloqueada\s*:/.test(plain(sub[2].replace(/[*_~]/g, "")))) {
        const colon = sub[2].indexOf(":");
        last.box.blocked = sub[2].slice(colon + 1).replace(/^[\s*_~]+|[\s*_~]+$/g, "") || "sem motivo escrito";
      }
    }
  }
  return found ? boxes : null;
}

const TITLE_MAX = 120;

/**
 * A box's title: its text up to the end of its first sentence (a short leading label such as "S1." is no sentence),
 * at most 120 characters, cut at a word.
 */
export function boxTitle(text: string): string {
  let t = text.trim().replace(/\s+/g, " ");
  for (const m of t.matchAll(/[.!?](?=\s|$)/g)) {
    const word = t.slice(0, m.index).split(" ").at(-1) ?? "";
    if (word.length > 3) {
      t = t.slice(0, (m.index as number) + 1);
      break;
    }
  }
  if (t.length <= TITLE_MAX) return t;
  const cut = t.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, "")}…`;
}

type Seen = { key: string; label: string | null; checked: boolean };
const LABEL = /^(s\d+)[.):]/;

/**
 * Which box of the older version each box of the newer one is, one to one (no box is used twice): the same text
 * first; then the same slice label ("S2."); then a text that grew from the other (ticking often appends evidence to
 * the line; short texts never match this way); then, only when both versions have as many boxes, the same place (a
 * reworded box). Null: the box is new in the newer version.
 */
function matchBoxes(newer: Seen[], older: Seen[]): (number | null)[] {
  const pick: (number | null)[] = newer.map(() => null);
  const used = new Set<number>();
  const pass = (fits: (n: Seen, o: Seen, j: number, k: number) => boolean) => {
    newer.forEach((n, j) => {
      if (pick[j] !== null) return;
      const k = older.findIndex((o, i) => !used.has(i) && fits(n, o, j, i));
      if (k >= 0) {
        pick[j] = k;
        used.add(k);
      }
    });
  };
  pass((n, o) => n.key === o.key);
  pass((n, o) => n.label !== null && n.label === o.label);
  pass((n, o) => {
    const [short, long] = n.key.length <= o.key.length ? [n.key, o.key] : [o.key, n.key];
    return short.length >= 8 && long.startsWith(short);
  });
  // The same place only says "the same box" when no box was added or removed between the two versions.
  if (newer.length === older.length) pass((_n, _o, j, k) => j === k);
  return pick;
}

/**
 * When each box of the LAST version of a body was ticked, from the body's versions in time order. GitHub keeps no
 * date for a tick, so a box's date is the edit that ticked it the last time it went from open to ticked (or that
 * added it already ticked). A box already ticked in the FIRST version is dated `createdAt` (pass the issue's
 * creation when that version is the body as written, or null when the history does not reach it: then that box has
 * no date). Null for an open box.
 */
export function boxCheckedAt(versions: { at: string; body: string }[], createdAt: string | null): (string | null)[] {
  if (versions.length === 0) return [];
  const read: Seen[][] = versions.map((v) =>
    (criteriaBoxes(v.body) ?? []).map((b) => {
      const key = plain(b.text);
      return { key, label: LABEL.exec(key)?.[1] ?? null, checked: b.checked };
    })
  );
  // links[k][j]: the box of version k that box j of version k + 1 is.
  const links = read.slice(1).map((newer, k) => matchBoxes(newer, read[k]));
  const last = read.length - 1;
  return read[last].map((box, j) => {
    if (!box.checked) return null;
    let since = last;
    let at: number | null = j;
    for (let k = last - 1; k >= 0 && at !== null; k--) {
      at = links[k][at];
      if (at === null || !read[k][at].checked) break;
      since = k;
    }
    return since === 0 ? createdAt : versions[since].at;
  });
}
