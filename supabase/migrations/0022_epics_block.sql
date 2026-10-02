-- Issues labelled type:epic get their own block, after Spikes and before "Sem tipo".
update public.lanes set sort_order = 9 where id = 'triagem';

insert into public.lanes (id, title, kind, start_date, end_date, sort_order)
values ('tipo-epic', 'Epics', 'group', null, null, 8)
on conflict (id) do nothing;
