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
const { LABELS_TIMEOUT_MS, readIssueLabels } = await import("./github.ts");

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
