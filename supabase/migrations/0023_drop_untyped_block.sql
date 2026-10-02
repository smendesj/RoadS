-- The "Sem tipo" block is gone: an open issue without a type:* label stays out of the Roadmap until
-- it gets one. Only dropped while empty, so no item is ever deleted along with it.
delete from public.lanes l
where l.id = 'triagem'
  and not exists (select 1 from public.roadmap_items i where i.lane_id = l.id);
