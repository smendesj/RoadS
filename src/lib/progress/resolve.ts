// What the user sees is what the collectors pushed with the user's edits applied on top. The edits are
// kept apart (`overrides`) so pushing a new draft can never overwrite them; this module is the one
// place that knows how the two meet. Pure on purpose: no "server-only", no "@/" imports.
import {
  ENTRY_STATUSES,
  type EntryStatus,
  type Overrides,
  type ProgressContent,
  type ProgressEntry,
  type ProgressReportRow,
} from "../progress-report.ts";

/* ---------- the grammar of the override keys ---------- */

export type KeyScope = "headline" | "internal" | "entry" | "difficulty" | "nextStep";

export type KeyInfo = {
  scope: KeyScope;
  /** The entry, difficulty or next step the key points at; null for the two report-wide keys. */
  id: string | null;
  field: string;
  /** "flag" is a boolean (hidden), "status" one of the five statuses, "text" a line the user writes. */
  type: "text" | "status" | "flag";
  /** Longest text accepted, in characters; 0 when the key is not text. */
  max: number;
  /** Whether the user may clear the line (to drop it from the e-mail) instead of rewriting it. */
  allowEmpty: boolean;
};

/** Hard limits of what the user may type: a title is a few words, a sentence one breath. */
const TITLE_MAX = 80;
const SENTENCE_MAX = 280;
const HEADLINE_MAX = 320;

type Spec = Pick<KeyInfo, "type" | "max" | "allowEmpty">;
const text = (max: number, allowEmpty = false): Spec => ({ type: "text", max, allowEmpty });
const STATUS: Spec = { type: "status", max: 0, allowEmpty: false };
const FLAG: Spec = { type: "flag", max: 0, allowEmpty: false };

const SCOPED_FIELDS: Record<"entry" | "difficulty" | "nextStep", Record<string, Spec>> = {
  entry: { title: text(TITLE_MAX), summary: text(SENTENCE_MAX), status: STATUS, hidden: FLAG },
  difficulty: { text: text(SENTENCE_MAX), needs: text(SENTENCE_MAX, true), hidden: FLAG },
  nextStep: { text: text(SENTENCE_MAX), hidden: FLAG },
};

// Ids are whatever the draft brought ("gc-123", "d1"); the colon is the separator and whitespace is
// never part of an id. Whether the id exists is checked against the content (see locateKey).
const SCOPED_KEY = /^(entry|difficulty|nextStep):([^:\s]{1,64}):([A-Za-z]+)$/;

/**
 * Understands a key of the contract: headline | internal | entry:<id>:(title|summary|status|hidden) |
 * difficulty:<id>:(text|needs|hidden) | nextStep:<id>:(text|hidden). Anything else is null.
 */
export function parseKey(key: string): KeyInfo | null {
  if (typeof key !== "string") return null;
  if (key === "headline") return { scope: "headline", id: null, field: "headline", ...text(HEADLINE_MAX) };
  if (key === "internal") return { scope: "internal", id: null, field: "internal", ...text(SENTENCE_MAX, true) };
  const m = SCOPED_KEY.exec(key);
  if (!m) return null;
  const scope = m[1] as "entry" | "difficulty" | "nextStep";
  const fields = SCOPED_FIELDS[scope];
  if (!Object.hasOwn(fields, m[3])) return null;
  return { scope, id: m[2], field: m[3], ...fields[m[3]] };
}

export type PushedContent = Pick<ProgressContent, "headline" | "internal" | "entries" | "difficulties" | "nextSteps">;

/**
 * What the collectors currently push for the thing a key edits: its text (the status as its code), or
 * `{ pushed: null }` when the key is a yes/no switch. A key that points at nothing (an entry that is
 * gone, or a key that is not in the grammar) gives null as a whole: "no such target".
 */
export function locateKey(content: PushedContent, key: string): { pushed: string | null } | null {
  const info = parseKey(key);
  if (!info) return null;
  switch (info.scope) {
    case "headline":
      return { pushed: content.headline };
    case "internal":
      return { pushed: content.internal.text };
    case "entry": {
      const e = content.entries.find((x) => x.id === info.id);
      if (!e) return null;
      if (info.field === "title") return { pushed: e.title };
      if (info.field === "summary") return { pushed: e.summary };
      if (info.field === "status") return { pushed: e.status };
      return { pushed: null };
    }
    case "difficulty": {
      const d = content.difficulties.find((x) => x.id === info.id);
      if (!d) return null;
      if (info.field === "text") return { pushed: d.text };
      if (info.field === "needs") return { pushed: d.needs };
      return { pushed: null };
    }
    case "nextStep": {
      const n = content.nextSteps.find((x) => x.id === info.id);
      if (!n) return null;
      return { pushed: info.field === "text" ? n.text : null };
    }
  }
}

/* ---------- reading the stored edits (defensively: they come out of a jsonb column) ---------- */

type Source = Pick<ProgressReportRow, "content" | "overrides">;

function storedValue(overrides: Overrides | null | undefined, key: string): unknown {
  if (!overrides || !Object.hasOwn(overrides, key)) return undefined;
  const slot = overrides[key];
  return slot && typeof slot === "object" ? slot.value : undefined;
}

const isStatus = (v: unknown): v is EntryStatus => (ENTRY_STATUSES as readonly unknown[]).includes(v);

function editedText(overrides: Overrides | null | undefined, key: string): string | undefined {
  const v = storedValue(overrides, key);
  if (typeof v !== "string") return undefined;
  return v !== "" || parseKey(key)?.allowEmpty ? v : undefined;
}

function editedStatus(overrides: Overrides | null | undefined, key: string): EntryStatus | undefined {
  const v = storedValue(overrides, key);
  return isStatus(v) ? v : undefined;
}

function editedFlag(overrides: Overrides | null | undefined, key: string): boolean | undefined {
  const v = storedValue(overrides, key);
  return typeof v === "boolean" ? v : undefined;
}

/* ---------- the three things the screens and the e-mail ask ---------- */

/**
 * The content the user sees: what the collectors pushed with the user's edits applied on top. An edit
 * whose target is gone is ignored (and comes back if the target returns in a later push). An entry the
 * user hid stays hidden whatever the next push says; one the user showed again wins over a pushed
 * "hidden". Difficulties and next steps have no "hidden" field, so a hidden one leaves the list (see
 * resolveHidden to bring it back); ones without an id cannot be addressed and stay as pushed. Nothing
 * of the input is changed.
 */
export function resolveContent(row: Source): ProgressContent {
  const { content } = row;
  const o = row.overrides;

  const entries: ProgressEntry[] = content.entries.map((e) => {
    const k = (field: string) => `entry:${e.id}:${field}`;
    const title = editedText(o, k("title"));
    const summary = editedText(o, k("summary"));
    const status = editedStatus(o, k("status"));
    return {
      ...e,
      title: title ?? e.title,
      summary: summary ?? e.summary,
      status: status ?? e.status,
      hidden: editedFlag(o, k("hidden")) ?? e.hidden,
      edited: e.edited || title !== undefined || summary !== undefined || status !== undefined,
    };
  });

  const difficulties = content.difficulties.flatMap((d) => {
    if (!d.id) return [d];
    if (editedFlag(o, `difficulty:${d.id}:hidden`) === true) return [];
    return [{ ...d, text: editedText(o, `difficulty:${d.id}:text`) ?? d.text, needs: editedText(o, `difficulty:${d.id}:needs`) ?? d.needs }];
  });

  const nextSteps = content.nextSteps.flatMap((n) => {
    if (!n.id) return [n];
    if (editedFlag(o, `nextStep:${n.id}:hidden`) === true) return [];
    return [{ ...n, text: editedText(o, `nextStep:${n.id}:text`) ?? n.text }];
  });

  return {
    ...content,
    headline: editedText(o, "headline") ?? content.headline,
    internal: { ...content.internal, text: editedText(o, "internal") ?? content.internal.text },
    entries,
    difficulties,
    nextSteps,
  };
}

/** The difficulties and next steps the user hid (with their edits), so the screen can offer to show them again. */
export function resolveHidden(row: Source): { difficulties: ProgressContent["difficulties"]; nextSteps: ProgressContent["nextSteps"] } {
  const { content } = row;
  const o = row.overrides;
  return {
    difficulties: content.difficulties.flatMap((d) =>
      d.id && editedFlag(o, `difficulty:${d.id}:hidden`) === true
        ? [{ ...d, text: editedText(o, `difficulty:${d.id}:text`) ?? d.text, needs: editedText(o, `difficulty:${d.id}:needs`) ?? d.needs }]
        : []
    ),
    nextSteps: content.nextSteps.flatMap((n) =>
      n.id && editedFlag(o, `nextStep:${n.id}:hidden`) === true ? [{ ...n, text: editedText(o, `nextStep:${n.id}:text`) ?? n.text }] : []
    ),
  };
}

/**
 * The keys the user edited whose pushed text has changed since ("nova sugestão"): the edit is kept and
 * shown, and the screen points out that the collectors now suggest something else. Not flagged: yes/no
 * switches (nothing to compare), edits whose target is gone, and edits that already equal the new text.
 */
export function resolveFlags(row: Source): string[] {
  const o = row.overrides;
  if (!o) return [];
  return Object.keys(o).filter((key) => {
    const slot = o[key];
    const base = slot && typeof slot === "object" ? slot.base : undefined;
    if (typeof base !== "string") return false;
    const target = locateKey(row.content, key);
    return target?.pushed != null && target.pushed !== base && target.pushed !== slot.value;
  });
}
