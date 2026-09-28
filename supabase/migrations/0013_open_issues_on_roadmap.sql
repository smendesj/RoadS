-- Every open GeoCloud issue lives on the Roadmap, and the future sprints start empty.
--
-- 1. A new first group, "Issues abertas, a organizar": the sync (syncBoard in
--    src/lib/actions/sync.ts) drops there every open issue of Essencis-Labs/GeoCloudAI the Roadmap
--    doesn't have yet, and takes off the groups every item whose issue got closed.
-- 2. "Próxima sprint" and "Sprint seguinte" are emptied into that group, so the next sprints can
--    be planned from scratch; the current sprint keeps its items. Each move is queued for
--    FrontlightS, so /frontlights updates ROADMAP.md and the SPRINT files.
-- 3. One Roadmap item per issue URL, so two syncs running at once can't import an issue twice
--    (only when the data already holds that; otherwise the sync's own check is what guards it).

-- 1.
insert into public.lanes (id, title, kind, start_date, end_date, sort_order)
values ('triagem', 'Issues abertas, a organizar', 'group', null, null, 4)
on conflict (id) do nothing;

-- 2. Queue before moving, while lane_id still says where each item came from.
insert into public.roadmap_sync_queue (item_id, action, payload)
select i.id, 'move_lane', jsonb_build_object('lane_id', 'triagem', 'from_lane_id', i.lane_id, 'title', i.title, 'reason', 'future sprints emptied for replanning')
from public.roadmap_items i
where i.lane_id in ('proxima', 'terceira');

update public.roadmap_items i
set lane_id = 'triagem',
    sort_order = s.rn,
    updated_at = now()
from (
  select id, row_number() over (order by case lane_id when 'proxima' then 0 else 1 end, sort_order) - 1 as rn
  from public.roadmap_items
  where lane_id in ('proxima', 'terceira')
) s
where i.id = s.id;

-- 3.
do $$
begin
  if not exists (
    select github_issue_url from public.roadmap_items
    where github_issue_url is not null
    group by github_issue_url having count(*) > 1
  ) then
    create unique index if not exists roadmap_items_github_issue_url_key
      on public.roadmap_items (github_issue_url) where github_issue_url is not null;
  else
    raise notice 'roadmap_items has duplicate github_issue_url values; unique index not created';
  end if;
end;
$$;
