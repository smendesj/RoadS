// The log of what Frontlights asks of RoadS: one row per call that got through the shared secret, so it can be
// shown who called, how often, and how long each door takes (the number a maxDuration is chosen from).
//
// What a row holds: the method, the route PATTERN (never the address: "/progress-report/[id]/shots", not a real
// id), the status, the client the caller says it is (User-Agent) and the duration. Nothing of the request:
// no body, no query string, no address of the caller, and never the secret. The client is only DECLARED by
// the caller, so a row shows which client and version said it called, not who holds the secret.
//
// Calls without the secret are not written down (they go to the server's log only), so nobody outside can fill
// the table. Writing is best effort and happens after the answer was sent; a failure is logged and never raised.
// Pure on purpose: the store comes in through CallStore, so every rule here runs under test without a database.

export const CALL_RETENTION_DAYS = 90;
export const USER_AGENT_MAX = 200;

export type CallRecord = { method: string; route: string; status: number; user_agent: string | null; duration_ms: number };

export type CallStore = {
  insert(record: CallRecord): Promise<void>;
  /** Drops every call made before `cutoff`; says how many. */
  deleteOlderThan(cutoff: string): Promise<number>;
};

const CONTROL = /[\u0000-\u001f\u007f]/g;

/** What a caller says about itself, cleaned (no control characters) and cut to USER_AGENT_MAX; null when blank. */
function cleanUserAgent(raw: string | null): string | null {
  const text = (raw ?? "").replace(CONTROL, "").trim().slice(0, USER_AGENT_MAX);
  return text === "" ? null : text;
}

export function describeCall(call: { method: string; route: string; status: number; userAgent: string | null; startedAt: number; endedAt: number }): CallRecord {
  return {
    method: call.method,
    route: call.route,
    status: call.status,
    user_agent: cleanUserAgent(call.userAgent),
    duration_ms: Math.max(0, Math.round(call.endedAt - call.startedAt)),
  };
}

/** Writes a call down. Never raises: the answer was sent already, and a log must not turn it into a failure. */
export async function recordCall(store: Pick<CallStore, "insert">, record: CallRecord): Promise<void> {
  try {
    await store.insert(record);
  } catch (error) {
    console.error("frontlights call log failed", error);
  }
}

export function pruneCutoff(now: Date): string {
  return new Date(now.getTime() - CALL_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export async function pruneCalls(store: Pick<CallStore, "deleteOlderThan">, now: Date): Promise<number> {
  return store.deleteOlderThan(pruneCutoff(now));
}
