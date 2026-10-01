-- Closes the gaps a role-by-role audit of the public API found (every role, plus anonymous, against
-- every table, with real JWTs). The app's own screens never exercised any of these, but the
-- publishable key is public, so what RLS allows is what counts.
--
-- 1. The last GitHub board snapshot (issue titles and links of a private project) was readable by
--    anyone, signed in or not. Now it needs a session, like every other table.
-- 2. Any signed-in user, a Dev included, could write item notes, claiming any author role. Notes
--    are now written by a Scrum Master (always as scrum_master) or an admin (as either hat) only.
-- 3. A Scrum Master could create, rename and delete lanes, and deleting a lane cascades to every
--    item in it, including items other people own. Lanes are admin-only now; no screen writes them.
-- 4. An admin could take another admin's role away (or their own). An admin role is fixed from
--    inside the app now; only the service role / migrations can change it.
-- 5. The signup page only lets @essencislabs.com and @essencistech.com.br addresses in, but that
--    check lives in the browser: anyone could create an account straight through the API and read
--    the whole Roadmap as a Dev. The database now refuses any other domain. Keep the list in step
--    with ALLOWED_DOMAINS in src/lib/validation.ts (a unit test compares them).

-- 1
drop policy if exists "board_sync_state: read all" on public.board_sync_state;
create policy "board_sync_state: read authenticated" on public.board_sync_state
  for select using (auth.role() = 'authenticated');

-- 2
drop policy if exists "item_notes: authenticated insert own" on public.item_notes;
create policy "item_notes: scrum_master and admin insert own" on public.item_notes
  for insert with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          (p.role = 'scrum_master' and item_notes.author_role = 'scrum_master')
          or p.role = 'admin'
        )
    )
  );

-- 3
drop policy if exists "lanes: scrum_master writes" on public.lanes;
create policy "lanes: admin writes" on public.lanes
  for all using (public.is_admin()) with check (public.is_admin());

-- 4: same function as 0007/0015 plus the "admin is fixed" rule.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    -- Signed-in callers need to be admin to change anyone's role (their own included).
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'only admin changes roles';
    end if;
    -- An admin's role can't be taken away from inside the app.
    if old.role = 'admin' and auth.uid() is not null then
      raise exception 'admin role is fixed';
    end if;
    -- Nobody, not even an admin or service_role, hands out the admin role to another address.
    if new.role = 'admin' and not exists (
      select 1 from auth.users u
      where u.id = new.id
        and u.email in ('sergio.mendes@essencislabs.com', 'sergio.mendes+roads-test@essencislabs.com')
    ) then
      raise exception 'admin role is reserved';
    end if;
  end if;
  return new;
end;
$$;

-- 5
create or replace function public.enforce_allowed_email_domain()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Exactly one "@", so what follows it is the whole domain ("a@essencislabs.com@evil.com" is out).
  if new.email is null
     or new.email !~ '^[^@]+@[^@]+$'
     or lower(split_part(new.email, '@', 2)) not in ('essencislabs.com', 'essencistech.com.br') then
    raise exception 'email domain not allowed';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_allowed_email_domain on auth.users;
create trigger enforce_allowed_email_domain
  before insert or update of email on auth.users
  for each row execute function public.enforce_allowed_email_domain();
