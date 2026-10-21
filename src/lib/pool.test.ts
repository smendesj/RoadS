import { test } from "node:test";
import assert from "node:assert/strict";

import { inPool } from "./pool.ts";

test("every item is handled once, and the results come back in the items' order", async () => {
  const out = await inPool([3, 1, 2], 2, async (n) => {
    await new Promise((r) => setTimeout(r, n * 5));
    return n * 10;
  });
  assert.deepEqual(out, [30, 10, 20]);
});

test("never more than `size` items are in flight at once", async () => {
  let running = 0;
  let most = 0;
  await inPool([1, 2, 3, 4, 5, 6, 7], 3, async () => {
    running++;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
  });
  assert.equal(most, 3);
});

test("an empty list is done at once", async () => {
  assert.deepEqual(await inPool([], 4, async () => 1), []);
});
