-- The prints of the "Resumo para a diretoria" (issue #2): one private bucket, written and read only by the
-- service role (the push route stores each print, the public image link reads it by the report's share
-- token). No policy is created on storage.objects for this bucket, so signed-in users and anonymous
-- visitors can neither list, read nor write it. The size and type limits repeat the ones the code checks.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-shots', 'progress-shots', false, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
