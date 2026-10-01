-- A second reserved admin address, for the automated test account (RoadS Tester). It is a
-- plus-address of the founding admin's own mailbox, so any e-mail sent to it reaches him.
-- Everything else from 0007 stays: only an admin changes roles, and the admin role can still
-- only sit on one of the addresses below. Delete the test account and drop its address from the
-- list here (new migration) if it is ever retired.

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
