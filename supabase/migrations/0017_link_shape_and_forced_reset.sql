-- Two more gaps from the role-by-role audit.
--
-- 1. github_issue_url could hold any text, written through the API by the Scrum Master who owns the
--    item, and it renders as a link everyone clicks (React 19 neutralises javascript: URLs, but a
--    phishing link to any site was fine). Only GitHub issue links of the org are accepted now; every
--    one of the 150+ stored links already has this shape, and the app only ever writes such links.
--
-- 2. A forced password reset could be skipped: the flag lived in a column the user may update on their
--    own row, so one API call cleared it without choosing a new password. A signed-in non-admin can no
--    longer turn it off; the server action that sets the new password (completePasswordReset) clears
--    it as the service role, after the password has really changed.

alter table public.roadmap_items
  add constraint roadmap_items_github_issue_url_shape
  check (github_issue_url is null or github_issue_url ~ '^https://github\.com/Essencis-Labs/[A-Za-z0-9_.-]+/issues/[0-9]+$');

create or replace function public.guard_must_reset_password()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.must_reset_password and not new.must_reset_password
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'only changing the password clears this flag';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_must_reset_password on public.profiles;
create trigger profiles_guard_must_reset_password
  before update on public.profiles
  for each row execute function public.guard_must_reset_password();
