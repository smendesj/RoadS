-- Single persisted snapshot of the last GitHub Project #7 sync, written by the
-- service_role client (manual button click or the hourly cron route) and read
-- by the Dashboard so a page reload doesn't lose the last real sync.
create table public.board_sync_state (
  id boolean primary key default true,
  columns jsonb not null,
  synced_at timestamptz not null,
  constraint board_sync_state_singleton check (id)
);

alter table public.board_sync_state enable row level security;

create policy "board_sync_state: read all" on public.board_sync_state for select using (true);
