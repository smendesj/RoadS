-- The Priority has only High, Medium and Low (issue #38), the same three values the product's issues now carry as
-- priority: labels: RoadS drops "Critical", and the items that held it become High.
update public.roadmap_items
  set prioridade = 'High'
  where prioridade = 'Critical';

-- The two-way sync's base keeps the same name, so the change is not read as an edit on either side (a card still on
-- the board's Critical option already reads as High).
update public.roadmap_items
  set github_seen = jsonb_set(github_seen, '{prioridade}', '"High"')
  where github_seen->>'prioridade' = 'Critical';

-- Postgres can't take a value out of an enum, so the type is made again without it and the column moves to it (no
-- stored value is 'Critical' any more, so the cast can't fail). The default is dropped around the change, since it is
-- typed by the old enum.
alter type public.roads_prioridade rename to roads_prioridade_old;
create type public.roads_prioridade as enum ('High', 'Medium', 'Low');
alter table public.roadmap_items alter column prioridade drop default;
alter table public.roadmap_items
  alter column prioridade type public.roads_prioridade using prioridade::text::public.roads_prioridade;
alter table public.roadmap_items alter column prioridade set default 'Medium';
drop type public.roads_prioridade_old;
