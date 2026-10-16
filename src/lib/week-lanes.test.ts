import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// week-lanes.ts is server-only and imports through the "@/" alias, which plain Node resolves neither of. Two
// resolve hooks, for this file only: "server-only" becomes an empty module and "@/x" becomes src/x.ts.
const src = new URL("../", import.meta.url).href;
const hooks = `
export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  if (specifier.startsWith("@/")) return next(${JSON.stringify(src)} + specifier.slice(2) + ".ts", context);
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
const { deleteWeekIfEmpty } = await import("./week-lanes.ts");

/** A stand-in for the service-role client that keeps every call to a database function and answers it deleted. */
function fakeAdmin() {
  const calls: { fn: string; args: unknown }[] = [];
  const admin = {
    async rpc(fn: string, args: unknown) {
      calls.push({ fn, args });
      return { data: true, error: null };
    },
  };
  return { admin: admin as unknown as Parameters<typeof deleteWeekIfEmpty>[0], calls };
}

test("a positional lane is never deleted for being empty: the database function is not even called", async () => {
  for (const id of ["atual", "proxima", "terceira"]) {
    const { admin, calls } = fakeAdmin();
    assert.equal(await deleteWeekIfEmpty(admin, id), false, id);
    assert.deepEqual(calls, [], id);
  }
});

test("an empty lane by date goes through the database function, which has the last word", async () => {
  const { admin, calls } = fakeAdmin();
  assert.equal(await deleteWeekIfEmpty(admin, "sprint-19-10-2026"), true);
  assert.deepEqual(calls, [{ fn: "delete_week_lane_if_empty", args: { p_lane_id: "sprint-19-10-2026" } }]);
});
