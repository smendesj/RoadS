// A stand-in for the few Supabase calls the Frontlights stores make, for tests: every query is a chain that
// ends when it is awaited. The test says what a table answers and afterwards sees what was asked of it, step
// by step ("select", "is", "lte"...), so a store's filters are checked without a database.
import type { SupabaseClient } from "@supabase/supabase-js";

export type Step = [method: string, ...args: unknown[]];
export type Answer = { data?: unknown; error?: unknown };
export type FakeClient = { client: SupabaseClient; asked: { table: string; steps: Step[] }[] };

export function fakeClient(answers: Record<string, Answer>): FakeClient {
  const asked: FakeClient["asked"] = [];
  const client = {
    from(table: string) {
      const query = { table, steps: [] as Step[] };
      asked.push(query);
      const chain: unknown = new Proxy(
        {},
        {
          get(_target, method) {
            if (method === "then") {
              const answer = answers[table] ?? { data: null, error: null };
              return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
                Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null }).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              query.steps.push([String(method), ...args]);
              return chain;
            };
          },
        }
      );
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, asked };
}
