-- A week's lane (a sprint named sprint-DD-MM-AAAA by its Monday, migration 0030) exists only while it holds an
-- item: the server creates it when the first item is dropped in it, and deletes it when it empties
-- (src/lib/week-lanes.ts). roadmap_items.lane_id is "on delete cascade", so counting the items and then deleting
-- the lane in two calls could take down an item moved in between. This function deletes the lane only when it is
-- a sprint lane and holds no item, in one call: it locks the lane row first, so an item being moved into it is
-- either already there when the emptiness is read (each statement reads after the lock) or waits and then fails
-- on its foreign key; it is never deleted with the lane. Answers whether the lane was deleted.
--
-- Any sprint lane will do (the positional ones too, while migration 0030 has not run), never a group lane nor the
-- e2e fixture (zz-test-*). Which weeks may go (a future one that emptied, one the rotation emptied after it ended)
-- is the server's rule, not this function's. Only the server calls it, with the service role; the lanes policy
-- (admin writes, 0016) is unchanged.
create or replace function public.delete_week_lane_if_empty(p_lane_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
     from public.lanes l
    where l.id = p_lane_id
      and l.kind = 'sprint'
      and l.id not like 'zz-test-%'
      for update;
  if not found then
    return false;
  end if;

  if exists (select 1 from public.roadmap_items i where i.lane_id = p_lane_id) then
    return false;
  end if;

  delete from public.lanes where id = p_lane_id;
  return true;
end;
$$;

revoke all on function public.delete_week_lane_if_empty(text) from public, anon, authenticated;
grant execute on function public.delete_week_lane_if_empty(text) to service_role;
