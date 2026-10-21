-- An item's own Status (issue #22): Open, Blocker or Done, the same as its issue after a sync (Done closes the issue,
-- leaving Done reopens it). Development is not stored: it is being in the current sprint (src/lib/bilateral-sync.ts).
-- Every item starts Open with no base for the field, so its first sync copies the issue's Status and writes nothing.
alter table public.roadmap_items
  add column if not exists status text not null default 'Open' check (status in ('Open', 'Blocker', 'Done'));
