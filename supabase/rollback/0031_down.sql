-- The way back from supabase/migrations/0031_sprint_lanes_by_date.sql: the week lanes go back to the three
-- positional ones. Kept outside supabase/migrations on purpose, so `db push` never runs it; it is run by hand
-- (SQL editor or psql), and only together with going back to code that reads the positional lanes.
--
-- The earliest week becomes `atual`, the one 7 days later `proxima`, 14 days later `terceira` (each created with
-- its dates when no week lane held it). It refuses, changing nothing, when a week lane falls outside those three
-- weeks: folding more weeks into three positions is a decision, not a rollback. Like 0031, in one statement, with
-- the same checks: items per week and in all, nothing left in a week lane, no unacked change naming one.
-- Moves are not queued, because no item changes week. The e2e fixture lanes (`zz-test-*`) are not touched.
--
-- It aborts, safely (it raises, so nothing it did stays), in two cases that are expected, not faults:
--   * An unacked change names a week whose lane is already gone (the rotation deleted the week that ended, or a
--     move emptied a future week). Only the changes naming a lane that still exists are translated, so that one
--     keeps naming a week and the last check raises "an unacked change still names a week lane". What to do: wait
--     for Frontlights to ack the pending changes (POST /ack) and run it again.
--   * A week lane starts on a day other than the earliest week's first day or the days 7 and 14 after it (more
--     than three weeks, or a week past the third): the check right after the one for week lanes with no dates
--     raises "week lanes beyond three consecutive weeks", before anything is written. A gap is not refused: with
--     weeks on the first day and 14 days later only, `proxima` is created empty between them. What to do: join
--     the weeks by hand, moving the items in the Roadmap into those three weeks (each move queued as usual), wait
--     for the acks, and run it again. Which weeks join which is a decision about the plan, not a rollback, so
--     this script never makes it.

do $$
declare
  first_monday date;
  slot record;
  week record;
  offset_by int;
  weeks_before jsonb;
  weeks_after jsonb;
  items_before bigint;
  items_after bigint;
begin
  if not exists (select 1 from public.lanes where id like 'sprint-__-__-____' and kind = 'sprint') then
    raise notice '0031_down: no week lane, nothing to do';
    return;
  end if;
  if exists (select 1 from public.lanes where id like 'sprint-__-__-____' and (start_date is null or end_date is null)) then
    raise exception '0031_down: a week lane has no dates; nothing was changed';
  end if;

  select min(start_date) into first_monday from public.lanes where id like 'sprint-__-__-____' and kind = 'sprint';
  if exists (
    select 1 from public.lanes
    where id like 'sprint-__-__-____' and kind = 'sprint'
      and start_date not in (first_monday, first_monday + 7, first_monday + 14)
  ) then
    raise exception '0031_down: there are week lanes beyond three consecutive weeks from %; nothing was changed', first_monday;
  end if;

  select coalesce(jsonb_object_agg(w.start_date, w.items), '{}'::jsonb) into weeks_before
  from (
    select l.start_date::text as start_date, count(i.id) as items
    from public.lanes l
    left join public.roadmap_items i on i.lane_id = l.id
    where l.kind = 'sprint' and l.id not like 'zz-test-%' and l.start_date is not null
    group by l.start_date
  ) w;
  select count(*) into items_before from public.roadmap_items;

  for slot in
    select * from (values
      ('atual', 'Sprint atual', first_monday, 1),
      ('proxima', 'Próxima sprint', first_monday + 7, 2),
      ('terceira', 'Sprint seguinte', first_monday + 14, 3)
    ) as s(id, title, start_date, sort_order)
  loop
    insert into public.lanes (id, title, kind, start_date, end_date, sort_order)
    values (slot.id, slot.title, 'sprint', slot.start_date, slot.start_date + 4, slot.sort_order)
    on conflict (id) do nothing;

    for week in
      select id from public.lanes
      where id like 'sprint-__-__-____' and kind = 'sprint' and start_date = slot.start_date
    loop
      select coalesce(max(sort_order) + 1, 0) into offset_by from public.roadmap_items where lane_id = slot.id;
      update public.roadmap_items set lane_id = slot.id, sort_order = sort_order + offset_by where lane_id = week.id;
      update public.roadmap_sync_queue
      set payload = jsonb_set(payload, '{lane_id}', to_jsonb(slot.id))
      where acked_at is null and payload ->> 'lane_id' = week.id;
      update public.roadmap_sync_queue
      set payload = jsonb_set(payload, '{from_lane_id}', to_jsonb(slot.id))
      where acked_at is null and payload ->> 'from_lane_id' = week.id;
    end loop;
  end loop;

  delete from public.lanes l
  where l.id like 'sprint-__-__-____' and l.kind = 'sprint'
    and not exists (select 1 from public.roadmap_items i where i.lane_id = l.id);

  if exists (select 1 from public.roadmap_items i join public.lanes l on l.id = i.lane_id where l.id like 'sprint-__-__-____') then
    raise exception '0031_down: an item is still in a week lane; everything was undone';
  end if;
  if exists (select 1 from public.lanes where id like 'sprint-__-__-____' and kind = 'sprint') then
    raise exception '0031_down: a week lane is left; everything was undone';
  end if;
  if exists (
    select 1 from public.roadmap_sync_queue
    where acked_at is null and (payload ->> 'lane_id' like 'sprint-__-__-____' or payload ->> 'from_lane_id' like 'sprint-__-__-____')
  ) then
    raise exception '0031_down: an unacked change still names a week lane; everything was undone';
  end if;

  select count(*) into items_after from public.roadmap_items;
  if items_after <> items_before then
    raise exception '0031_down: % items before and % after; everything was undone', items_before, items_after;
  end if;

  select coalesce(jsonb_object_agg(w.start_date, w.items), '{}'::jsonb) into weeks_after
  from (
    select l.start_date::text as start_date, count(i.id) as items
    from public.lanes l
    left join public.roadmap_items i on i.lane_id = l.id
    where l.kind = 'sprint' and l.id not like 'zz-test-%' and l.start_date is not null
    group by l.start_date
  ) w;
  -- The positional lanes created for an empty week add a week with 0 items; only the weeks that had items must match.
  if (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(weeks_after) where value <> '0'::jsonb)
     <> (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(weeks_before) where value <> '0'::jsonb) then
    raise exception '0031_down: items per week changed (before %, after %); everything was undone', weeks_before, weeks_after;
  end if;
end;
$$;
