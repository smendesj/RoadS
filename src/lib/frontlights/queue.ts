// The sync queue's two doors for Frontlights: what is still waiting to be written into ROADMAP.md and the
// SPRINT files (GET /pending-changes) and the receipt that closes it (POST /ack). A pure module with the
// database behind a small port (QueueStore); queue-store.ts plugs Supabase into it and the routes glue it
// to HTTP, so every rule here runs under test without a server.
import { isIsoTimestamp } from "../timestamp.ts";
import { unsupportedSchema } from "./contract.ts";
import type { Answer } from "./contract.ts";

type Lane = { title: string };
type ItemJoin = {
  title: string;
  description: string;
  produto: string;
  prioridade: string;
  effort: string;
  github_issue_url: string | null;
  lane_id: string;
  lanes: Lane | Lane[] | null;
};

/** A queue row with the item it points to and that item's lane (null/absent when the item is gone). */
export type QueueRow = {
  id: string;
  item_id: string | null;
  action: string;
  payload: unknown;
  created_at: string;
  roadmap_items: ItemJoin | ItemJoin[] | null;
};

export type QueueStore = {
  /** The rows nobody acked yet, oldest first; with `since`, only those created after it. */
  listPending(since: string | null): Promise<QueueRow[]>;
  /** Closes every row still pending that was created at or before `asOf`; says how many. */
  ackThrough(asOf: string, ackedAt: string): Promise<number>;
};

const first = <T>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

/**
 * GET /pending-changes?since=<ISO timestamp, optional> -> { asOf, changes }. A "remove" arrives with item and
 * itemId null (the row is gone and the queue's FK is "on delete set null"); its payload carries item_id,
 * lane_id and title. Every other change of an item deleted since has nothing left to write and is skipped.
 * `asOf` is the creation time of the newest pending row (never "now"), so an ack with it can't swallow a
 * change queued between this fetch and the ack, and it also consumes the skipped orphans; null when nothing
 * is pending.
 */
export async function pendingChanges(store: Pick<QueueStore, "listPending">, since: string | null): Promise<Answer> {
  if (since && !isIsoTimestamp(since)) return { status: 400, body: { error: "since must be an ISO timestamp string" } };

  const rows = await store.listPending(since || null);
  const changes = rows.flatMap((row) => {
    const item = first(row.roadmap_items);
    if (!item && row.action !== "remove") return [];
    const lane = item ? first(item.lanes) : null;
    return [
      {
        id: row.id,
        itemId: row.item_id,
        action: row.action,
        payload: row.payload,
        createdAt: row.created_at,
        item: item
          ? {
              title: item.title,
              description: item.description,
              produto: item.produto,
              prioridade: item.prioridade,
              effort: item.effort,
              githubIssueUrl: item.github_issue_url,
              lane: lane?.title ?? null,
              laneId: item.lane_id,
            }
          : null,
      },
    ];
  });

  const asOf = rows.length ? rows[rows.length - 1].created_at : null;
  return { status: 200, body: { asOf, changes } };
}

/**
 * POST /ack { asOf, schemaVersion? } -> { acked }. Closes every pending row created at or before asOf, so the
 * next /pending-changes (with ?since=asOf) doesn't return them again. A request that names another version of
 * the contract, or whose asOf is not an ISO timestamp, is a 400 and closes nothing.
 */
export async function ackUpTo(store: Pick<QueueStore, "ackThrough">, body: unknown, now: Date): Promise<Answer> {
  const refused = unsupportedSchema(body);
  if (refused) return refused;

  const asOf = typeof body === "object" && body !== null ? (body as { asOf?: unknown }).asOf : undefined;
  if (!isIsoTimestamp(asOf)) return { status: 400, body: { error: "asOf must be an ISO timestamp string" } };

  return { status: 200, body: { acked: await store.ackThrough(asOf, now.toISOString()) } };
}
