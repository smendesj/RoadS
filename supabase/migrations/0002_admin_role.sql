-- Adding an enum value must land in its own migration/transaction before anything can reference it.
alter type public.roads_role add value if not exists 'admin';
