-- Profile picture: the id of one of the generic avatars in /public/avatars (null = default icon).
alter table public.profiles add column if not exists avatar text;
