-- The time of a push ("pushed_at") is the database's own, like "numbers checked" (checked_at) and "sent"
-- (sent_at) already are (issue #6). The ingest route used to send the clock of the machine that pushed;
-- a few hundred milliseconds ahead of the database, a check made right after a push read as older than
-- the push, and sending was refused. The stamp is set on every new report and every time a DRAFT's content
-- is refreshed. A sent report keeps its time: the version in its image links never moves.
create or replace function public.stamp_progress_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.pushed_at := now();
  elsif old.status = 'draft' and new.content is distinct from old.content then
    new.pushed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists progress_reports_push_clock on public.progress_reports;
create trigger progress_reports_push_clock
  before insert or update on public.progress_reports
  for each row execute function public.stamp_progress_push();
