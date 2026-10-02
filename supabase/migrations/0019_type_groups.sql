-- Open issues are filed in one block per type (the GitHub label type:*), never in a catch-all.
-- The sync (reconcileRoadmapWithIssues in src/lib/board-sync.ts) puts each new issue in its
-- type block and moves the ones still in "triagem" (now the block for issues with no type label).
-- Blocks come first among the groups; the curated ones (g1..g6, roadmap) keep their order after.

update public.lanes set sort_order = sort_order + 10 where kind = 'group' and id <> 'triagem';

insert into public.lanes (id, title, kind, start_date, end_date, sort_order) values
  ('tipo-feature', 'Features', 'group', null, null, 4),
  ('tipo-bug', 'Bugs', 'group', null, null, 5),
  ('tipo-chore', 'Chores', 'group', null, null, 6),
  ('tipo-spike', 'Spikes', 'group', null, null, 7)
on conflict (id) do nothing;

update public.lanes set title = 'Sem tipo', sort_order = 8 where id = 'triagem';
