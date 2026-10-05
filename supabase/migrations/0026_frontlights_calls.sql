-- The log of what Frontlights asks of RoadS (issue #10): one row per call that got through the shared secret,
-- so it can be shown which client called, how often, and how long each door takes (the number a maxDuration
-- is chosen from).
--
--   * What a row holds: the method, the route PATTERN ("/progress-report/[id]/shots", never a real id), the
--     status, the client the caller says it is (its User-Agent, cut at 200 characters) and the duration. No
--     body, no query string, no address of the caller, never the secret.
--   * The client is only DECLARED by the caller: a row shows which client and version said it called, not who
--     holds the secret.
--   * Only the service role touches it (the Frontlights doors write, the daily cron drops what is older than
--     90 days). RLS is on and there is NO policy, so nobody signed in and nobody anonymous reads or writes it;
--     the privileges of anon and authenticated are taken away as well.
-- Purely additive: a new table and its index.

create table public.frontlights_calls (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  method text not null,
  route text not null,
  status integer not null,
  user_agent text,
  duration_ms integer not null,
  constraint frontlights_calls_method_len check (char_length(method) between 1 and 10),
  constraint frontlights_calls_route_len check (char_length(route) between 1 and 120),
  constraint frontlights_calls_status_range check (status between 100 and 599),
  constraint frontlights_calls_user_agent_len check (user_agent is null or char_length(user_agent) <= 200),
  constraint frontlights_calls_duration_nonneg check (duration_ms >= 0)
);

-- The retention sweep and any "latest calls" look read by time.
create index frontlights_calls_created_at_idx on public.frontlights_calls (created_at desc);

alter table public.frontlights_calls enable row level security;
revoke all on public.frontlights_calls from anon, authenticated;
