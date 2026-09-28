-- The 4-items-per-sprint rule is now a warning only: new items can be created in a full sprint
-- too (moves already could, since 0011). The board shows 5/4, 6/4... and asks for the overflow
-- to be moved out; MAX_ITEMS_PER_SPRINT in src/lib/types.ts drives that warning.

drop trigger if exists roadmap_items_sprint_capacity on public.roadmap_items;
drop function if exists public.enforce_sprint_capacity();
