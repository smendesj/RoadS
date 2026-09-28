-- 1. The sync queue is consumed by FrontlightS's /update-roads, so it gets a neutral name.
--    0001/0003 already create it under the new name on a fresh database; this renames the table
--    on databases created before that (the old name appears here only because a rename has to
--    say what it renames). The RLS policy follows the table.
alter table if exists public.guardians_sync_queue rename to roadmap_sync_queue;

-- 2. A sixth Roadmap group for product, commercial and interface items that aren't a Single View,
--    AI, data, debt or future-module topic.
insert into public.lanes (id, title, kind, start_date, end_date, sort_order)
values ('g6', 'Produto, comercial e interface', 'group', null, null, 10)
on conflict (id) do nothing;
