-- Moving an item into a sprint that already has 4 items is allowed again: the board shows the
-- count as 5/4, 6/4... with a warning asking for the overflow to be moved out. Creating a new
-- item in a full sprint is still refused, here and in createRoadmapItem (src/lib/actions/roadmap.ts).
-- Replaces the insert-or-move trigger from 0008.

create or replace function public.enforce_sprint_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.lanes l where l.id = new.lane_id and l.kind = 'sprint')
     and (select count(*) from public.roadmap_items i where i.lane_id = new.lane_id) >= 4 then
    raise exception 'sprint % already has 4 items', new.lane_id;
  end if;
  return new;
end;
$$;

drop trigger if exists roadmap_items_sprint_capacity on public.roadmap_items;
create trigger roadmap_items_sprint_capacity
  before insert on public.roadmap_items
  for each row execute function public.enforce_sprint_capacity();
