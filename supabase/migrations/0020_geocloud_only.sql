-- RoadS handles GeoCloud only: any Roadmap item still marked ELIMS leaves the groups (queued first
-- so FrontlightS takes it out of ROADMAP.md). Sprint items are left alone. The enum value stays
-- because progress_reports shares the type; the app no longer offers or reads it.

insert into public.roadmap_sync_queue (item_id, action, payload)
select i.id, 'remove', jsonb_build_object('item_id', i.id, 'lane_id', i.lane_id, 'title', i.title, 'github_issue_url', i.github_issue_url, 'reason', 'ELIMS is out of RoadS')
from public.roadmap_items i
join public.lanes l on l.id = i.lane_id and l.kind = 'group'
where i.produto = 'ELIMS';

delete from public.roadmap_items i
using public.lanes l
where l.id = i.lane_id and l.kind = 'group' and i.produto = 'ELIMS';
