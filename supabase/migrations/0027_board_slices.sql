-- The Dashboard's Slices block: the sub-issues of every issue in the current sprint, read from GitHub by the
-- same sync that takes the board snapshot and stored beside it, so a page reload doesn't need GitHub.
-- A list of groups (parent issue + its sub-issues), empty until the first sync after this migration.
alter table public.board_sync_state add column if not exists slices jsonb not null default '[]'::jsonb;
