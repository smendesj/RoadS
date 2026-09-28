-- Item ownership rules, plus locking down who can hold the admin role.
--
-- roadmap_items:
--   * admin has full control — edits and deletes anything;
--   * scrum_master edits and deletes only the items they created themselves;
--   * scrum_master never edits or deletes an item another user created;
--   * on the seeded items (created_by null) a scrum_master still adjusts prioridade/effort/lane,
--     as before, but can't delete them or change their title/description/produto (they mirror GitHub).
-- The server actions in src/lib/actions/roadmap.ts check the same rules; this is the DB backstop.
--
-- profiles:
--   * "profiles: update own role once" (0001) let any signed-in user rewrite their own row,
--     role included — i.e. promote themselves to admin straight through the REST API with the
--     public key. Role changes now require an admin caller, and the admin role itself is
--     reserved for the founding admin's address.

drop policy if exists "roadmap_items: scrum_master writes" on public.roadmap_items;

create policy "roadmap_items: scrum_master inserts" on public.roadmap_items
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('scrum_master', 'admin'))
    and created_by = auth.uid()
  );

create policy "roadmap_items: admin or owner updates" on public.roadmap_items
  for update using (
    public.is_admin()
    or (
      (created_by is null or created_by = auth.uid())
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'scrum_master')
    )
  );

create policy "roadmap_items: admin or creator deletes" on public.roadmap_items
  for delete using (
    public.is_admin()
    or (
      created_by = auth.uid()
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'scrum_master')
    )
  );

-- Only applies to requests made as a signed-in non-admin (auth.uid() set); admin, migrations,
-- the SQL editor and the service_role client can still change anything.
create or replace function public.guard_seeded_item_content()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.created_by is distinct from old.created_by then
      raise exception 'created_by is immutable';
    end if;
    if old.created_by is null and (
      new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.produto is distinct from old.produto
    ) then
      raise exception 'seeded roadmap items keep their title, description and produto';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists roadmap_items_guard_seeded_content on public.roadmap_items;
create trigger roadmap_items_guard_seeded_content
  before update on public.roadmap_items
  for each row execute function public.guard_seeded_item_content();

-- security definer so it can read auth.users for the email check.
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
    -- Nobody, not even an admin or service_role, hands out the admin role to another address.
    if new.role = 'admin' and not exists (
      select 1 from auth.users u where u.id = new.id and u.email = 'sergio.mendes@essencislabs.com'
    ) then
      raise exception 'admin role is reserved';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();
