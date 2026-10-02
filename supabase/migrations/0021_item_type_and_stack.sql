-- Type (the GitHub label type:*) and Stack (Project #7 field) of a Roadmap item, so the issue RoadS
-- creates is born with every field filled. Null on items whose issue already exists: GitHub holds it.
alter table public.roadmap_items
  add column if not exists tipo text check (tipo in ('feature', 'bug', 'chore', 'spike')),
  add column if not exists stack text;
