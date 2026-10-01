import { test } from "node:test";
import assert from "node:assert/strict";
import { browserPorts, buildClipboardPayload, copyRich, copyText } from "./clipboard.ts";
import type { BrowserEnv, ClipboardPayload } from "./clipboard.ts";

const TABLE = '<table width="600" bgcolor="#ffffff"><tr><td style="font-family:Arial">Olá</td></tr></table>';

/* ---------- what goes on the clipboard ---------- */

test("the e-mail travels as a fragment inside html/body with fragment markers", () => {
  const { html } = buildClipboardPayload({ html: TABLE, text: "Olá" });
  assert.match(html, /^<html><body><!--StartFragment-->/);
  assert.match(html, /<!--EndFragment--><\/body><\/html>$/);
  assert.ok(html.includes(TABLE), "the e-mail's own markup is untouched");
});

test("a full document is reduced to its body, not pasted inside another html/body", () => {
  const doc = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Assunto</title></head><body bgcolor="#eeeeee">${TABLE}</body></html>`;
  const { html } = buildClipboardPayload({ html: doc, text: "Olá" });
  assert.equal((html.match(/<html/gi) ?? []).length, 1);
  assert.equal((html.match(/<body/gi) ?? []).length, 1);
  assert.ok(!/doctype|<head|<title|<meta/i.test(html), html);
  assert.ok(html.includes(TABLE));
});

test("escaped text stays escaped: what the user typed is never turned back into markup", () => {
  const typed = "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;aspas&quot; &lt;b&gt;";
  const { html } = buildClipboardPayload({ html: `<table><tr><td>${typed}</td></tr></table>`, text: "" });
  assert.ok(html.includes(typed), html);
  assert.ok(!/<script/i.test(html));
});

test("a script that slipped into the markup is dropped, with everything inside it", () => {
  const dirty = `<table><tr><td>Antes</td></tr></table><script>alert('x')</script><SCRIPT src="https://evil.example/a.js"></SCRIPT><table><tr><td>Depois</td></tr></table>`;
  const { html } = buildClipboardPayload({ html: dirty, text: "" });
  assert.ok(!/<\/?script/i.test(html), html);
  assert.ok(!html.includes("alert('x')"));
  assert.ok(!html.includes("evil.example"));
  assert.ok(html.includes("Antes") && html.includes("Depois"));
});

test("an unclosed script tag cannot survive either", () => {
  const { html } = buildClipboardPayload({ html: "<p>oi</p><script>alert(1)", text: "" });
  assert.ok(!/<script/i.test(html), html);
  assert.ok(!html.includes("alert(1)"), "an unclosed script would have swallowed the rest as code");
});

test("inline event handlers and javascript: links are stripped, ordinary links are kept", () => {
  const dirty =
    '<table><tr><td><img src="https://roads-psi.vercel.app/a.png" alt="x" onerror="alert(1)" ONLOAD=alert(2)>' +
    '<a href="javascript:alert(3)" title="clique onclick=nao em mim">ruim</a>' +
    '<a href="https://roads-psi.vercel.app/resumo">bom</a></td></tr></table>';
  const { html } = buildClipboardPayload({ html: dirty, text: "" });
  assert.ok(!/onerror|onload/i.test(html), html);
  assert.ok(!/javascript:/i.test(html), html);
  assert.ok(html.includes('href="https://roads-psi.vercel.app/resumo"'));
  assert.ok(html.includes('src="https://roads-psi.vercel.app/a.png"'));
  // A word that merely looks like a handler, inside an attribute's value, is not an attribute.
  assert.ok(html.includes('title="clique onclick=nao em mim"'));
});

test("the plain-text version is the builder's text as it is", () => {
  const text = "Resumo\n\n- Login mais rápido\n- Relatório novo";
  assert.equal(buildClipboardPayload({ html: TABLE, text }).text, text);
});

test("without a text version, one is read off the markup: no tags, entities decoded, rows on their own lines", () => {
  const html =
    "<table><tr><td><b>Título</b></td></tr><tr><td>Frase &amp; mais &lt;b&gt;texto&lt;/b&gt;<br>segunda linha</td></tr></table>" +
    "<script>alert(1)</script><style>td{color:red}</style>";
  const { text } = buildClipboardPayload({ html, text: "" });
  assert.equal(text, "Título\nFrase & mais <b>texto</b>\nsegunda linha");
  assert.ok(!/<(table|tr|td|script|style|br)/i.test(text));
  assert.ok(!text.includes("alert(1)") && !text.includes("color:red"));
});

/* ---------- copying, with the browser's own pieces replaced by fakes ---------- */

const payload: ClipboardPayload = { html: "<html><body>oi</body></html>", text: "oi" };
const boom = () => {
  throw new Error("recusado");
};

test("the rich clipboard is tried first and the fallback is left alone", async () => {
  const calls: string[] = [];
  const result = await copyRich(payload, {
    writeRich: async () => void calls.push("rich"),
    copyRichSelection: () => (calls.push("selection"), true),
  });
  assert.deepEqual(result, { ok: true, via: "clipboard" });
  assert.deepEqual(calls, ["rich"]);
});

test("when the browser refuses the rich clipboard, the selection fallback takes over", async () => {
  const calls: string[] = [];
  const result = await copyRich(payload, {
    writeRich: async () => {
      calls.push("rich");
      throw new Error("NotAllowedError");
    },
    copyRichSelection: () => (calls.push("selection"), true),
  });
  assert.deepEqual(result, { ok: true, via: "selection" });
  assert.deepEqual(calls, ["rich", "selection"]);
});

test("a browser with no rich clipboard at all goes straight to the fallback", async () => {
  assert.deepEqual(await copyRich(payload, { copyRichSelection: () => true }), { ok: true, via: "selection" });
});

test("when nothing works the answer is a plain failure, never an exception", async () => {
  assert.deepEqual(await copyRich(payload, {}), { ok: false });
  assert.deepEqual(await copyRich(payload, { writeRich: async () => boom(), copyRichSelection: () => false }), { ok: false });
  assert.deepEqual(await copyRich(payload, { writeRich: async () => boom(), copyRichSelection: boom }), { ok: false });
});

test("plain text (the subject line) follows the same order: clipboard, then fallback, then failure", async () => {
  assert.deepEqual(await copyText("Assunto", { writeText: async () => {} }), { ok: true, via: "clipboard" });
  assert.deepEqual(await copyText("Assunto", { writeText: async () => boom(), copyTextSelection: () => true }), { ok: true, via: "selection" });
  assert.deepEqual(await copyText("Assunto", { writeText: async () => boom(), copyTextSelection: () => false }), { ok: false });
});

/* ---------- the real ports, against a fake browser ---------- */

type FakeEl = {
  tag: string;
  attrs: Record<string, string>;
  style: { cssText: string };
  innerHTML: string;
  value: string;
  selected: boolean;
  removed: boolean;
  setAttribute(name: string, value: string): void;
  select(): void;
  remove(): void;
};

function fakeBrowser(opts: { clipboard?: boolean; execResult?: boolean; execThrows?: boolean } = {}) {
  const log = {
    items: [] as { parts: Record<string, Blob> }[],
    written: [] as unknown[][],
    text: [] as string[],
    elements: [] as FakeEl[],
    appended: [] as FakeEl[],
    selectedNodes: [] as unknown[],
    ranges: [] as unknown[],
    cleared: 0,
    executed: [] as string[],
  };
  class FakeItem {
    parts: Record<string, Blob>;
    constructor(parts: Record<string, Blob>) {
      this.parts = parts;
      log.items.push(this);
    }
  }
  const selection = {
    removeAllRanges: () => void log.cleared++,
    addRange: (r: unknown) => void log.ranges.push(r),
  };
  const env: BrowserEnv = {
    navigator:
      opts.clipboard === false
        ? {}
        : {
            clipboard: {
              write: async (items) => void log.written.push(items),
              writeText: async (t) => void log.text.push(t),
            },
          },
    ClipboardItem: opts.clipboard === false ? undefined : (FakeItem as unknown as BrowserEnv["ClipboardItem"]),
    document: {
      body: { appendChild: (el: FakeEl) => void log.appended.push(el) },
      createElement: (tag: string): FakeEl => {
        const el: FakeEl = {
          tag,
          attrs: {},
          style: { cssText: "" },
          innerHTML: "",
          value: "",
          selected: false,
          removed: false,
          setAttribute(name, value) {
            this.attrs[name] = value;
          },
          select() {
            this.selected = true;
          },
          remove() {
            this.removed = true;
          },
        };
        log.elements.push(el);
        return el;
      },
      createRange: () => ({ selectNodeContents: (el: unknown) => void log.selectedNodes.push(el) }),
      getSelection: () => selection,
      execCommand: (cmd: string) => {
        log.executed.push(cmd);
        if (opts.execThrows) throw new Error("recusado");
        return opts.execResult ?? true;
      },
    },
  };
  return { env, log };
}

test("the rich write hands the browser ONE item with exactly the html and the plain flavors", async () => {
  const { env, log } = fakeBrowser();
  await browserPorts(env).writeRich!(payload);
  assert.equal(log.written.length, 1);
  assert.equal(log.written[0].length, 1);
  const parts = log.items[0].parts;
  assert.deepEqual(Object.keys(parts).sort(), ["text/html", "text/plain"]);
  assert.equal(parts["text/html"].type, "text/html");
  assert.equal(await parts["text/html"].text(), payload.html);
  assert.equal(parts["text/plain"].type, "text/plain");
  assert.equal(await parts["text/plain"].text(), payload.text);
});

test("a browser without ClipboardItem rejects the rich write, so the caller falls back", async () => {
  const { env } = fakeBrowser({ clipboard: false });
  await assert.rejects(browserPorts(env).writeRich!(payload));
});

test("the selection fallback copies from a hidden editable element and cleans up after itself", () => {
  const { env, log } = fakeBrowser();
  assert.equal(browserPorts(env).copyRichSelection!(payload), true);
  const [holder] = log.elements;
  assert.equal(holder.tag, "div");
  assert.equal(holder.attrs.contenteditable, "true");
  assert.equal(holder.attrs["aria-hidden"], "true");
  assert.equal(holder.innerHTML, payload.html);
  assert.deepEqual(log.appended, [holder]);
  assert.deepEqual(log.selectedNodes, [holder], "its whole content is what gets selected");
  assert.equal(log.ranges.length, 1, "and that selection is made the current one");
  assert.deepEqual(log.executed, ["copy"]);
  assert.equal(holder.removed, true);
  assert.ok(log.cleared >= 1, "the user's selection is not left on the hidden element");
});

test("the hidden element is removed even when the copy command throws or says no", () => {
  for (const opts of [{ execThrows: true }, { execResult: false }]) {
    const { env, log } = fakeBrowser(opts);
    assert.equal(browserPorts(env).copyRichSelection!(payload), false);
    assert.equal(log.elements[0].removed, true);
  }
});

test("with no document at all the fallback reports failure instead of throwing", () => {
  assert.equal(browserPorts({}).copyRichSelection!(payload), false);
  assert.equal(browserPorts({}).copyTextSelection!("x"), false);
});

test("plain text goes through writeText, and its fallback uses a hidden textarea", async () => {
  const { env, log } = fakeBrowser();
  const ports = browserPorts(env);
  await ports.writeText!("GeoCloud: andamento de 28/09 a 29/09");
  assert.deepEqual(log.text, ["GeoCloud: andamento de 28/09 a 29/09"]);

  assert.equal(ports.copyTextSelection!("Assunto"), true);
  const area = log.elements[0];
  assert.equal(area.tag, "textarea");
  assert.equal(area.value, "Assunto");
  assert.equal(area.selected, true);
  assert.equal(area.removed, true);
  assert.deepEqual(log.executed, ["copy"]);
});
