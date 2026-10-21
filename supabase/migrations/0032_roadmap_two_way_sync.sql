-- The two-way sync of issue #22 (src/lib/bilateral-sync.ts has the rule). Per item and per field:
--   github_seen      what the issue said the last time the sync looked (the base); a field missing from it was never
--                    looked at, and its first sync copies GitHub into RoadS without writing anything there;
--   field_changed_at when the field was last edited in RoadS (ISO text), to settle a field both sides changed.
-- The title's base starts from github_title (migration 0028), so titles the sync already knew keep their history.
alter table public.roadmap_items add column if not exists github_seen jsonb not null default '{}'::jsonb;
alter table public.roadmap_items add column if not exists field_changed_at jsonb not null default '{}'::jsonb;

update public.roadmap_items
  set github_seen = jsonb_build_object('title', github_title)
  where github_title is not null and not (github_seen ? 'title');
