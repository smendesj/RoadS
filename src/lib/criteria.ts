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
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const LINE_CAP = 2000;
const FENCE = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const ITEM = /^([ \t]*)(?:[-*+]|[0-9]{1,9}[.)])[ \t]+\[([ xX])\](?=[ \t]|$)(.*)$/;
const LIST_LINE = /^([ \t]*)(?:[-*+]|[0-9]{1,9}[.)])[ \t]+(.*)$/;

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
    if (sub && last && indentOf(sub[1]) > last.indent && last.box.blocked === null) {
      const said = plain(sub[2]);
      if (said.startsWith("bloqueada:") || said.startsWith("bloqueada :")) {
        const colon = sub[2].indexOf(":");
        last.box.blocked = sub[2].slice(colon + 1).replace(/^[\s*_]+/, "").trim() || "sem motivo escrito";
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

// The same box across versions of a body: the same text, or one text that grew from the other (ticking a box often
// appends its evidence to the line). Short texts must match exactly.
const sameBox = (a: string, b: string): boolean => {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 8 && long.startsWith(short);
};

/**
 * When each box of the LAST version of a body was ticked, from the body's versions in time order (the first one as
 * the issue was written: it stands for the issue's creation). GitHub keeps no date for a tick, so a box's date is
 * the edit that ticked it the last time it went from open to ticked (or that added it already ticked). Null for an
 * open box.
 */
export function boxCheckedAt(versions: { at: string; body: string }[], createdAt: string): (string | null)[] {
  if (versions.length === 0) return [];
  const read = versions.map((v) => (criteriaBoxes(v.body) ?? []).map((b) => ({ key: plain(b.text), checked: b.checked })));
  const final = read[read.length - 1];
  return final.map((box) => {
    if (!box.checked) return null;
    let since = read.length - 1;
    for (let k = read.length - 2; k >= 0; k--) {
      const same = read[k].find((b) => sameBox(b.key, box.key));
      if (!same || !same.checked) break;
      since = k;
    }
    return since === 0 ? createdAt : versions[since].at;
  });
}
