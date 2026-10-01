-- "Resumo para a diretoria": the short plain-language report the board gets by e-mail every two days.
-- One row per report. The Frontlights CLI pushes the draft through POST /api/frontlights/progress-report
-- (the service role); the screen only ever edits what sits apart from it.
--
--   * `content` is what the collectors pushed and ONLY the ingest route writes it. `overrides` holds what the
--     user changed on the screen, so pushing again can never erase an edit.
--   * The admin reads and edits every report. A scrum_master reads only the SENT ones and edits none; a dev
--     and anonymous read nothing. There is no INSERT or DELETE policy: only the service role creates rows.
--   * The trigger is the database backstop behind the server actions: a sent report is frozen, what was
--     pushed can't be rewritten through the API, the "checked" and "sent" stamps are the database's own, and a
--     report can only be sent once the numbers were checked AFTER the last push.
-- Purely additive: a new table, its policies and one trigger.

create table public.progress_reports (
  id uuid primary key default gen_random_uuid(),
  produto public.roads_produto not null default 'GeoCloud',
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'draft',
  content jsonb not null,
  overrides jsonb not null default '{}'::jsonb,
  -- The unguessable part of the public image link an e-mail client fetches (no cookies there).
  share_token uuid not null default gen_random_uuid(),
  checked_at timestamptz,
  checked_by uuid references public.profiles (id) on delete set null,
  sent_at timestamptz,
  sent_by uuid references public.profiles (id) on delete set null,
  pushed_at timestamptz not null default now(),
  -- Moves up on every change, so a screen holding an older copy knows it is stale.
  rev int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint progress_reports_status_check check (status in ('draft', 'sent')),
  constraint progress_reports_period_check check (period_end >= period_start),
  constraint progress_reports_content_is_object check (jsonb_typeof(content) = 'object'),
  constraint progress_reports_overrides_is_object check (jsonb_typeof(overrides) = 'object'),
  constraint progress_reports_share_token_key unique (share_token),
  -- A period is reported once per product.
  constraint progress_reports_produto_period_key unique (produto, period_start)
);

-- One draft per product at a time: the one the screen shows and the CLI refreshes.
create unique index progress_reports_one_draft_per_produto
  on public.progress_reports (produto)
  where status = 'draft';

alter table public.progress_reports enable row level security;

create policy "progress_reports: admin reads all, scrum_master reads sent" on public.progress_reports
  for select using (
    public.is_admin()
    or (
      status = 'sent'
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'scrum_master')
    )
  );

create policy "progress_reports: admin updates" on public.progress_reports
  for update using (public.is_admin()) with check (public.is_admin());

-- Only applies to requests made as a signed-in user (auth.uid() set); the service role (the ingest route),
-- migrations and the SQL editor have none and pass free. security definer like the other guards.
create or replace function public.guard_progress_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if auth.uid() is null then
    return new;
  end if;

  if old.status = 'sent' then
    raise exception 'a sent report is frozen';
  end if;

  if new.id is distinct from old.id
     or new.produto is distinct from old.produto
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.content is distinct from old.content
     or new.share_token is distinct from old.share_token
     or new.pushed_at is distinct from old.pushed_at
     or new.created_at is distinct from old.created_at then
    raise exception 'what the collectors pushed is written by the ingest route only';
  end if;

  -- "Numbers checked": when and by whom is the database's word, whatever was sent along.
  if new.checked_at is distinct from old.checked_at then
    if new.checked_at is null then
      new.checked_by := null;
    else
      new.checked_at := now();
      new.checked_by := auth.uid();
    end if;
  else
    new.checked_by := old.checked_by;
  end if;

  -- Sending: draft -> sent is the only move left here, and only after a check made since the last push.
  if new.status is distinct from old.status then
    if new.checked_at is null or new.checked_at < new.pushed_at then
      raise exception 'check the numbers after the last push before sending';
    end if;
    new.sent_at := now();
    new.sent_by := auth.uid();
  else
    new.sent_at := old.sent_at;
    new.sent_by := old.sent_by;
  end if;

  new.rev := old.rev + 1;
  return new;
end;
$$;

drop trigger if exists progress_reports_guard on public.progress_reports;
create trigger progress_reports_guard
  before update on public.progress_reports
  for each row execute function public.guard_progress_report();
