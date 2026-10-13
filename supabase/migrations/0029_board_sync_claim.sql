-- When the last sync asked for by a signed-in page claimed the run (src/lib/sync-claim.ts): a sync reaches GitHub
-- only by moving this forward with a conditional update, so two never run at once and a failed one still holds
-- the brake. Written only by the server with the admin client; the read policy of the table is unchanged.
alter table public.board_sync_state add column if not exists sync_claimed_at timestamptz;
