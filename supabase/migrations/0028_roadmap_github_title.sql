-- The title the issue had on GitHub the last time the sync looked: the sync renames a Roadmap item only when the
-- issue was renamed there since (a title a person reworded in the Roadmap is left alone while the issue's title
-- is unchanged). Null until the first sync after this migration sees the item.
alter table public.roadmap_items add column if not exists github_title text;
