// Runs `work` over `items` with at most `size` of them in flight, and answers the results in the items' order. The
// sync's per-item steps go through it: one by one they made a round of a hundred items take tens of seconds, and all
// at once they would trip GitHub's limits on writes.
export async function inPool<T, R>(items: readonly T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
  return results;
}
