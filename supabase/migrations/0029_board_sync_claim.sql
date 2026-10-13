-- Every sync of the board claims its run here before it reaches GitHub (src/lib/sync-claim.ts): two never run at
-- once, and a run that failed still holds the brake. sync_claimed_at is when the last run was claimed,
-- sync_finished_at when the last claimed run ended (well or not). Only the server, with the service role, calls
-- the two functions; the table's read policy is unchanged.
alter table public.board_sync_state add column if not exists sync_claimed_at timestamptz;
alter table public.board_sync_state add column if not exists sync_finished_at timestamptz;

-- Granted when the brake has passed since the last claim AND that run has finished, or has been going for longer
-- than p_max_run_ms (stuck: a function killed by its timeout never reaches its finally). One conditional update,
-- so of two callers at the same instant only one is granted. Answers the claim that stands either way.
create or replace function public.claim_board_sync(p_brake_ms integer, p_max_run_ms integer)
returns table (claimed boolean, claimed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  granted timestamptz;
begin
  update public.board_sync_state s
     set sync_claimed_at = now()
   where s.id
     and (
       s.sync_claimed_at is null
       or (
         s.sync_claimed_at < now() - make_interval(secs => p_brake_ms / 1000.0)
         and (
           (s.sync_finished_at is not null and s.sync_finished_at >= s.sync_claimed_at)
           or s.sync_claimed_at < now() - make_interval(secs => p_max_run_ms / 1000.0)
         )
       )
     )
  returning s.sync_claimed_at into granted;

  if granted is not null then
    return query select true, granted;
  else
    return query select false, s.sync_claimed_at from public.board_sync_state s where s.id;
  end if;
end;
$$;

-- Marks the run claimed at p_claimed_at as finished; a later claim is left alone.
create or replace function public.finish_board_sync(p_claimed_at timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  update public.board_sync_state set sync_finished_at = now() where id and sync_claimed_at = p_claimed_at;
$$;

revoke all on function public.claim_board_sync(integer, integer) from public, anon, authenticated;
revoke all on function public.finish_board_sync(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_board_sync(integer, integer) to service_role;
grant execute on function public.finish_board_sync(timestamptz) to service_role;
