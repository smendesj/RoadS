-- Every new signup starts as 'dev' (admin still auto-assigned by email); an admin promotes to
-- scrum_master from Config afterward.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role)
  values (
    new.id,
    case when new.email = 'sergio.mendes@essencislabs.com' then 'admin'::public.roads_role else 'dev'::public.roads_role end
  );
  return new;
end;
$$;
