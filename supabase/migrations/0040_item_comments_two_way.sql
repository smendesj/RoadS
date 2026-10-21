-- Comments (issue #23): an item's notes become Comments that go both ways with its issue's comments
-- (src/lib/comment-sync.ts has the rule). Per Comment:
--   github_comment_id  the comment it became on GitHub (or came from); null until the sync sends it;
--   github_seen        the text both sides last agreed on (the base), unsigned;
--   github_login       who wrote it on GitHub, for a comment that came from there: it has no RoadS author;
--   author_name        the name a Comment written in RoadS is signed with on GitHub;
--   updated_at         when it was last edited in RoadS, to settle a comment both sides edited;
--   deleted_at         deleted in RoadS, kept until the sync deletes its comment on GitHub (then the row goes).
-- Numbered from 0040: migrations 0033–0039 are left to issue #22, worked at the same time.
alter table public.item_notes alter column author_id drop not null;
alter table public.item_notes alter column author_role drop not null;
alter table public.item_notes add column if not exists author_name text;
alter table public.item_notes add column if not exists github_login text;
alter table public.item_notes add column if not exists github_comment_id bigint;
alter table public.item_notes add column if not exists github_seen text;
alter table public.item_notes add column if not exists updated_at timestamptz;
alter table public.item_notes add column if not exists deleted_at timestamptz;

create unique index if not exists item_notes_github_comment_id on public.item_notes (github_comment_id)
  where github_comment_id is not null;

alter table public.item_notes drop constraint if exists item_notes_has_author;
alter table public.item_notes
  add constraint item_notes_has_author check (author_id is not null or github_login is not null);

-- Who wrote a Comment and the admin edit and delete it; a Comment that came from GitHub changes there, or by the admin.
drop policy if exists "item_notes: author or admin updates" on public.item_notes;
create policy "item_notes: author or admin updates" on public.item_notes
  for update using (auth.uid() = author_id or public.is_admin())
  with check (auth.uid() = author_id or public.is_admin());
drop policy if exists "item_notes: author or admin deletes" on public.item_notes;
create policy "item_notes: author or admin deletes" on public.item_notes
  for delete using (auth.uid() = author_id or public.is_admin());

-- What ties a Comment to GitHub, and who wrote it, are the sync's to write (the service role): a signed-in user only
-- writes the text and the times of their own edit or deletion.
create or replace function public.guard_item_note()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.github_comment_id is not null or new.github_seen is not null or new.github_login is not null or new.deleted_at is not null then
      raise exception 'only the sync ties a Comment to GitHub';
    end if;
  elsif new.item_id is distinct from old.item_id
     or new.author_id is distinct from old.author_id
     or new.author_role is distinct from old.author_role
     or new.author_name is distinct from old.author_name
     or new.github_comment_id is distinct from old.github_comment_id
     or new.github_seen is distinct from old.github_seen
     or new.github_login is distinct from old.github_login
     or new.created_at is distinct from old.created_at then
    raise exception 'only the text of a Comment can be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists item_notes_guard on public.item_notes;
create trigger item_notes_guard
  before insert or update on public.item_notes
  for each row execute function public.guard_item_note();
