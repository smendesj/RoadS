-- Effort syncs with the organization's issue field on GitHub (issue #23), whose options are High, Medium and Low: RoadS
-- drops "Very High", and the items that held it become High.
update public.roadmap_items
  set effort = 'High'
  where effort = 'Very High';

-- The two-way sync's base keeps the same name, so the change is not read as an edit on either side.
update public.roadmap_items
  set github_seen = jsonb_set(github_seen, '{effort}', '"High"')
  where github_seen->>'effort' = 'Very High';

-- Postgres can't take a value out of an enum, so the type is made again without it and the column moves to it (no
-- stored value is 'Very High' any more, so the cast can't fail). The default is dropped around the change, since it
-- is typed by the old enum.
alter type public.roads_effort rename to roads_effort_old;
create type public.roads_effort as enum ('Low', 'Medium', 'High');
alter table public.roadmap_items alter column effort drop default;
alter table public.roadmap_items
  alter column effort type public.roads_effort using effort::text::public.roads_effort;
alter table public.roadmap_items alter column effort set default 'Medium';
drop type public.roads_effort_old;
