// What "Copiar para o e-mail" puts on the clipboard, and how. A pure module on purpose: the browser's own
// pieces (navigator.clipboard, ClipboardItem, the document) are handed in, so the order of attempts and
// the clean-up can be tested under `node --test`. No "server-only", no "@/" imports.
import type { EmailBuild } from "../progress-report.ts";

export type ClipboardPayload = { html: string; text: string };

/* ---------- the payload ---------- */

// The e-mail is built with every dynamic text already escaped. These guards are for the day a bug lets
// something through: what is pasted into a mail client (and, in the fallback, into a live element of
// this page) must never carry script.
const DANGEROUS = "script|iframe|object|embed";
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href"]);
// One attribute: name, then optionally "= value" (quoted or bare). Walking attributes (rather than searching
// the tag text) keeps a value like title="clique onclick=x" from being mistaken for a handler.
const ATTRIBUTE = /\s+([^\s"'<>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

function cleanTag(tag: string): string {
  return tag.replace(ATTRIBUTE, (whole: string, name: string, raw?: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith("on")) return "";
    if (raw && URL_ATTRIBUTES.has(lower)) {
      // Browsers ignore whitespace and control characters inside the scheme ("java\tscript:").
      const target = raw.replace(/^["']|["']$/g, "").replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
      if (target.startsWith("javascript:") || target.startsWith("vbscript:")) return ` ${name}="#"`;
    }
    return whole;
  });
}

/** The inside of the document's <body>, or the whole string when it is already a fragment. */
function fragmentOf(html: string): string {
  let body = html.replace(/<!doctype[^>]*>/gi, "").replace(/<head\b[\s\S]*?<\/head\s*>/gi, "");
  const open = /<body\b[^>]*>/i.exec(body);
  if (open) {
    body = body.slice(open.index + open[0].length);
    const close = body.search(/<\/body\s*>/i);
    if (close >= 0) body = body.slice(0, close);
  }
  return body.replace(/<\/?html\b[^>]*>/gi, "").trim();
}

function sanitize(fragment: string): string {
  return fragment
    .replace(new RegExp(`<(${DANGEROUS})\\b[\\s\\S]*?</\\1\\s*>`, "gi"), "")
    // An opening tag with no closing one would swallow the rest of the page as its content: drop it all.
    .replace(new RegExp(`<(?:${DANGEROUS})\\b[\\s\\S]*$`, "i"), "")
    .replace(new RegExp(`</(?:${DANGEROUS})\\b[^>]*>`, "gi"), "")
    .replace(/<[a-zA-Z][^>]*>/g, cleanTag);
}

// Only used when the e-mail builder gave no plain version. Tags go first and entities last, so text the
// user typed ("&lt;b&gt;") comes out as the characters they typed, not as markup.
function htmlToText(fragment: string): string {
  return fragment
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|table|ul|ol|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n")
    .trim();
}

/**
 * The two flavors the clipboard carries. The HTML is the e-mail's body wrapped the way Windows clipboards
 * (and so Outlook's paste) expect: html/body with the fragment markers around the content.
 */
export function buildClipboardPayload(build: EmailBuild): ClipboardPayload {
  const fragment = sanitize(fragmentOf(build.html));
  return {
    html: `<html><body><!--StartFragment-->${fragment}<!--EndFragment--></body></html>`,
    text: build.text.trim() === "" ? htmlToText(fragment) : build.text,
  };
}

/* ---------- copying ---------- */

export type CopyResult = { ok: true; via: "clipboard" | "selection" } | { ok: false };

export type ClipboardPorts = {
  /** navigator.clipboard.write with a ClipboardItem carrying both flavors; rejects when the browser says no. */
  writeRich?: (payload: ClipboardPayload) => Promise<void>;
  /** Plan B: select a hidden editable copy of the HTML and run the copy command. */
  copyRichSelection?: (payload: ClipboardPayload) => boolean;
  writeText?: (text: string) => Promise<void>;
  copyTextSelection?: (text: string) => boolean;
};

/** Never throws: a refusal from the browser is an answer, not an error. */
export async function copyRich(payload: ClipboardPayload, ports: ClipboardPorts): Promise<CopyResult> {
  if (ports.writeRich) {
    try {
      await ports.writeRich(payload);
      return { ok: true, via: "clipboard" };
    } catch {
      // Old browser, no permission, no user gesture: the selection fallback may still work.
    }
  }
  try {
    if (ports.copyRichSelection?.(payload)) return { ok: true, via: "selection" };
  } catch {
    // Nothing left to try.
  }
  return { ok: false };
}

export async function copyText(text: string, ports: ClipboardPorts): Promise<CopyResult> {
  if (ports.writeText) {
    try {
      await ports.writeText(text);
      return { ok: true, via: "clipboard" };
    } catch {
      // Same story as above.
    }
  }
  try {
    if (ports.copyTextSelection?.(text)) return { ok: true, via: "selection" };
  } catch {
    // Nothing left to try.
  }
  return { ok: false };
}

/* ---------- the real browser, behind small structural types so tests can hand in a fake ---------- */

type ElementLike = {
  style: { cssText: string };
  innerHTML: string;
  value: string;
  setAttribute(name: string, value: string): void;
  select(): void;
  remove(): void;
};

type DocumentLike = {
  body: { appendChild(node: ElementLike): unknown };
  createElement(tag: string): ElementLike;
  createRange(): { selectNodeContents(node: ElementLike): void };
  getSelection(): { removeAllRanges(): void; addRange(range: unknown): void } | null;
  execCommand(command: string): boolean;
};

export type BrowserEnv = {
  navigator?: { clipboard?: { write?(items: unknown[]): Promise<void>; writeText?(text: string): Promise<void> } };
  ClipboardItem?: new (items: Record<string, Blob>) => unknown;
  document?: DocumentLike;
};

const OFF_SCREEN = "position:fixed;left:-10000px;top:0;width:640px;opacity:0;pointer-events:none";

// Runs `work` on a temporary element that is always taken out of the page again.
function withTemporary(doc: DocumentLike | undefined, tag: string, work: (el: ElementLike) => boolean): boolean {
  if (!doc?.body) return false;
  const el = doc.createElement(tag);
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = OFF_SCREEN;
  try {
    return work(el);
  } catch {
    return false;
  } finally {
    doc.getSelection()?.removeAllRanges();
    el.remove();
  }
}

/** The ports of the page the code is running in. Read at call time, so importing this on a server is harmless. */
export function browserPorts(env: BrowserEnv = globalThis as unknown as BrowserEnv): ClipboardPorts {
  return {
    async writeRich({ html, text }) {
      const clipboard = env.navigator?.clipboard;
      const Item = env.ClipboardItem;
      if (!clipboard?.write || !Item) throw new Error("rich clipboard unavailable");
      const blob = (type: string, body: string) => new Blob([body], { type });
      await clipboard.write([new Item({ "text/html": blob("text/html", html), "text/plain": blob("text/plain", text) })]);
    },

    copyRichSelection({ html }) {
      const doc = env.document;
      return withTemporary(doc, "div", (holder) => {
        holder.setAttribute("contenteditable", "true");
        holder.innerHTML = html;
        doc!.body.appendChild(holder);
        const range = doc!.createRange();
        range.selectNodeContents(holder);
        const selection = doc!.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return doc!.execCommand("copy") === true;
      });
    },

    async writeText(text) {
      const clipboard = env.navigator?.clipboard;
      if (!clipboard?.writeText) throw new Error("clipboard unavailable");
      await clipboard.writeText(text);
    },

    copyTextSelection(text) {
      const doc = env.document;
      return withTemporary(doc, "textarea", (area) => {
        area.setAttribute("readonly", "");
        area.value = text;
        doc!.body.appendChild(area);
        area.select();
        return doc!.execCommand("copy") === true;
      });
    },
  };
}
