-- Config screen support: who's admin, and the forced-reset flag the login flow checks.

alter table public.profiles add column if not exists must_reset_password boolean not null default false;

-- security definer so RLS on profiles doesn't recurse into itself when a policy calls this.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Whoever signs up with the founding admin's address becomes admin automatically; everyone else
-- starts with no role (chosen during onboarding, or set by an admin from Config).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role)
  values (
    new.id,
    case when new.email = 'sergio.mendes@essencislabs.com' then 'admin'::public.roads_role else null end
  );
  return new;
end;
$$;

-- Admin sees and edits every profile (Config's user list + password-reset flag).
create policy "profiles: admin reads all" on public.profiles
  for select using (public.is_admin());

create policy "profiles: admin updates all" on public.profiles
  for update using (public.is_admin());

-- Admin gets the same write access as scrum_master everywhere that role was checked.
drop policy if exists "lanes: scrum_master writes" on public.lanes;
create policy "lanes: scrum_master writes" on public.lanes
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('scrum_master', 'admin'))
  );

drop policy if exists "roadmap_items: scrum_master writes" on public.roadmap_items;
create policy "roadmap_items: scrum_master writes" on public.roadmap_items
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('scrum_master', 'admin'))
  );

drop policy if exists "sync_queue: scrum_master and service role only" on public.guardians_sync_queue;
create policy "sync_queue: scrum_master and service role only" on public.guardians_sync_queue
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('scrum_master', 'admin'))
  );
