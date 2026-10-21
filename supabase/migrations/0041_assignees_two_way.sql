-- Assignees (issue #23): an item's Assignees go both ways with its issue's (src/lib/assignee-sync.ts has the rule).
--   profiles.github_login   the GitHub login a profile is, filled by the admin in Config; one login, one profile;
--   roadmap_items.assignees the item's Assignees, as GitHub logins (a login with no profile still counts).
-- The base and the time of the edit live, as for every two-way field, in github_seen and field_changed_at (0032),
-- under the key "assignees".
alter table public.profiles add column if not exists github_login text;
create unique index if not exists profiles_github_login on public.profiles (lower(github_login)) where github_login is not null;
alter table public.profiles drop constraint if exists profiles_github_login_shape;
alter table public.profiles
  add constraint profiles_github_login_shape check (github_login is null or github_login ~ '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$');

alter table public.roadmap_items add column if not exists assignees text[] not null default '{}';

-- Every user may update their own profile row (policy "update own role once", 0001): the login is the admin's to
-- write, so who a Comment or an Assignee is cannot be claimed by the user.
create or replace function public.guard_github_login()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.github_login is distinct from old.github_login
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'only the admin sets a GitHub login';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_github_login on public.profiles;
create trigger profiles_guard_github_login
  before update on public.profiles
  for each row execute function public.guard_github_login();
