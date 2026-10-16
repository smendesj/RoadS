-- The sprints are weeks named by their date, no longer by their position.
--
-- The three sprint lanes were called by where they stood: `atual`, `proxima`, `terceira`. Every turn of the week
-- moved every item of `proxima` into `atual` without it changing week, and that false move went into the queue and
-- into the files Frontlights writes. From here on a sprint lane is a week: its id is `sprint-DD-MM-AAAA` (its
-- Monday), its title its dates ("Sprint 12–16/10"), and the current week is the one whose dates hold today in
-- São Paulo (src/lib/sprint-week.ts). The code already reads both forms by kind and dates, so it can be deployed
-- before or after this migration.
--
-- In one statement, so all of it or none of it:
--   1. each positional lane gets its week lane (same dates and order) and hands it its items, same sort_order;
--      no move is queued, because no item changed week;
--   2. the changes Frontlights has not acked yet are translated: `lane_id` and `from_lane_id` of their payload
--      name the week instead of the position (the acked ones are history and stay as they were);
--   3. the positional lanes are deleted, only when empty (roadmap_items.lane_id is on delete cascade);
--   4. it checks itself and raises (undoing everything) if the number of items of any week changed, if the total
--      changed, if an item is still in a positional lane, if a positional lane is left, or if an unacked change
--      still names one.
-- Idempotent: with no positional lane left it does nothing. The e2e fixture lanes (`zz-test-*`) are not touched.
-- The way back is supabase/rollback/0030_down.sql, kept outside the migrations on purpose.

do $$
declare
  positional constant text[] := array['atual', 'proxima', 'terceira'];
  lane record;
  week_id text;
  offset_by int;
  weeks_before jsonb;
  weeks_after jsonb;
  items_before bigint;
  items_after bigint;
begin
  if not exists (select 1 from public.lanes where id = any (positional)) then
    raise notice '0030: no positional sprint lane left, nothing to do';
    return;
  end if;

  if exists (
    select 1 from public.lanes
    where id = any (positional) and (kind <> 'sprint' or start_date is null or end_date is null)
  ) then
    raise exception '0030: a positional lane is not a dated sprint, so it cannot be named by its week; nothing was changed';
  end if;

  if (select count(distinct start_date) from public.lanes where id = any (positional))
     <> (select count(*) from public.lanes where id = any (positional)) then
    raise exception '0030: two positional lanes start on the same day; nothing was changed';
  end if;

  -- What must hold after: the items of every week (the sprint lanes outside the e2e fixture, by start date) and
  -- all the items.
  select coalesce(jsonb_object_agg(w.start_date, w.items), '{}'::jsonb) into weeks_before
  from (
    select l.start_date::text as start_date, count(i.id) as items
    from public.lanes l
    left join public.roadmap_items i on i.lane_id = l.id
    where l.kind = 'sprint' and l.id not like 'zz-test-%' and l.start_date is not null
    group by l.start_date
  ) w;
  select count(*) into items_before from public.roadmap_items;

  for lane in
    select id, start_date, end_date, sort_order from public.lanes where id = any (positional) order by start_date
  loop
    week_id := 'sprint-' || to_char(lane.start_date, 'DD-MM-YYYY');

    -- 1. The week lane. It may exist already (the app creates this week's lane when it needs one): then it is kept.
    insert into public.lanes (id, title, kind, start_date, end_date, sort_order)
    values (
      week_id,
      'Sprint ' || case
        when to_char(lane.start_date, 'MM') = to_char(lane.end_date, 'MM') then to_char(lane.start_date, 'DD') || '–' || to_char(lane.end_date, 'DD/MM')
        else to_char(lane.start_date, 'DD/MM') || '–' || to_char(lane.end_date, 'DD/MM')
      end,
      'sprint',
      lane.start_date,
      lane.end_date,
      lane.sort_order
    )
    on conflict (id) do nothing;

    -- The items keep their order, after whatever the week lane already held.
    select coalesce(max(sort_order) + 1, 0) into offset_by from public.roadmap_items where lane_id = week_id;
    update public.roadmap_items set lane_id = week_id, sort_order = sort_order + offset_by where lane_id = lane.id;

    -- 2. The unacked changes name the week.
    update public.roadmap_sync_queue
    set payload = jsonb_set(payload, '{lane_id}', to_jsonb(week_id))
    where acked_at is null and payload ->> 'lane_id' = lane.id;
    update public.roadmap_sync_queue
    set payload = jsonb_set(payload, '{from_lane_id}', to_jsonb(week_id))
    where acked_at is null and payload ->> 'from_lane_id' = lane.id;
  end loop;

  -- 3. Only an empty lane is deleted.
  delete from public.lanes l
  where l.id = any (positional)
    and not exists (select 1 from public.roadmap_items i where i.lane_id = l.id);

  -- 4. The checks.
  if exists (select 1 from public.roadmap_items where lane_id = any (positional)) then
    raise exception '0030: an item is still in a positional lane; everything was undone';
  end if;
  if exists (select 1 from public.lanes where id = any (positional)) then
    raise exception '0030: a positional lane is left; everything was undone';
  end if;
  if exists (
    select 1 from public.roadmap_sync_queue
    where acked_at is null and (payload ->> 'lane_id' = any (positional) or payload ->> 'from_lane_id' = any (positional))
  ) then
    raise exception '0030: an unacked change still names a positional lane; everything was undone';
  end if;

  select count(*) into items_after from public.roadmap_items;
  if items_after <> items_before then
    raise exception '0030: % items before and % after; everything was undone', items_before, items_after;
  end if;

  select coalesce(jsonb_object_agg(w.start_date, w.items), '{}'::jsonb) into weeks_after
  from (
    select l.start_date::text as start_date, count(i.id) as items
    from public.lanes l
    left join public.roadmap_items i on i.lane_id = l.id
    where l.kind = 'sprint' and l.id not like 'zz-test-%' and l.start_date is not null
    group by l.start_date
  ) w;
  if weeks_after <> weeks_before then
    raise exception '0030: items per week changed (before %, after %); everything was undone', weeks_before, weeks_after;
  end if;
end;
$$;
