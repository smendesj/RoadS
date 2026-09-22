-- RoadS — initial schema
-- Roles: 'scrum_master' (CEO or Coordenador Dev Senior) and 'dev'. Chosen at first login, not tied to a name.

create type public.roads_role as enum ('scrum_master', 'dev');
create type public.roads_produto as enum ('GeoCloud', 'ELIMS');
create type public.roads_prioridade as enum ('Critical', 'High', 'Medium', 'Low');
create type public.roads_effort as enum ('Low', 'Medium', 'High', 'Very High');

-- One row per authenticated user, created on first login. role is chosen during onboarding (nullable until then).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.roads_role,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: update own role once" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- New auth user -> empty profile row, role set later during onboarding.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- A sprint lane: the 3 active dated sprints, plus arbitrary "roadmap completo" groups.
-- kind='sprint' rows carry start_date/end_date; kind='group' rows are the undated catalog sections.
create table public.lanes (
  id text primary key,
  title text not null,
  kind text not null check (kind in ('sprint', 'group')),
  start_date date,
  end_date date,
  sort_order int not null default 0
);

alter table public.lanes enable row level security;
create policy "lanes: read all authenticated" on public.lanes for select using (auth.role() = 'authenticated');
create policy "lanes: scrum_master writes" on public.lanes for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'scrum_master')
);

create table public.roadmap_items (
  id uuid primary key default gen_random_uuid(),
  lane_id text not null references public.lanes (id) on delete cascade,
  sort_order int not null default 0,
  title text not null,
  description text not null default '',
  produto public.roads_produto not null default 'GeoCloud',
  prioridade public.roads_prioridade not null default 'Medium',
  effort public.roads_effort not null default 'Medium',
  github_issue_url text,
  github_issue_number int,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roadmap_items enable row level security;
create policy "roadmap_items: read all authenticated" on public.roadmap_items for select using (auth.role() = 'authenticated');
create policy "roadmap_items: scrum_master writes" on public.roadmap_items for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'scrum_master')
);

create table public.item_notes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.roadmap_items (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  author_role public.roads_role not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.item_notes enable row level security;
create policy "item_notes: read all authenticated" on public.item_notes for select using (auth.role() = 'authenticated');
create policy "item_notes: authenticated insert own" on public.item_notes for insert with check (auth.uid() = author_id);

-- Queue consumed by GuardianS's /update-roads: every roadmap_items change a SCRUM MASTER makes gets
-- appended here; GuardianS reads what's pending, writes ROADMAP.md/SPRINT.md, then calls ack.
create table public.guardians_sync_queue (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.roadmap_items (id) on delete set null,
  action text not null check (action in ('add', 'modify', 'remove', 'move_lane')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  acked_at timestamptz
);

alter table public.guardians_sync_queue enable row level security;
create policy "sync_queue: scrum_master and service role only" on public.guardians_sync_queue for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'scrum_master')
);

-- Seed the three active sprint lanes (dates follow the Mon-Fri cadence already in use).
insert into public.lanes (id, title, kind, start_date, end_date, sort_order) values
  ('atual', 'Sprint atual', 'sprint', '2026-09-21', '2026-09-25', 1),
  ('proxima', 'Próxima sprint', 'sprint', '2026-09-28', '2026-10-02', 2),
  ('terceira', 'Sprint seguinte', 'sprint', '2026-10-05', '2026-10-09', 3),
  ('roadmap', 'Roadmap completo', 'group', null, null, 4);
