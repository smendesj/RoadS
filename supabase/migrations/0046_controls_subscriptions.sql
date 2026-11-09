-- ControlS — the subscription vault, a new section of RoadS used by exactly two people.
--
-- Access is an e-mail allowlist, not a role: one of the two members is an admin, the other is an
-- ordinary user, so a role check wouldn't fit. The list of addresses is the real security boundary,
-- enforced here in the database (RLS) and re-checked in the server actions (src/lib/controls/access.ts
-- carries the same list — keep the two in step). The test admin's plus-address is Sérgio's own mailbox,
-- kept here like migration 0015 so the automated admin account can reach the section too.
--
-- The vault: `secret_password` never holds a real password in plain text. The app encrypts each secret
-- (AES-256-GCM, key from CONTROLS_VAULT_KEY, src/lib/controls/vault.ts) before it is stored, so a database
-- dump without that key can't read them. RLS is the second wall: only the two members ever select the row,
-- and the listing action never ships the ciphertext to the browser — a secret is revealed only by its own
-- action, re-checking the caller. No real password is seeded here; the seed is the non-secret fields only.

create or replace function public.is_controls_member()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(u.email) in (
        'sergio.mendes@essencislabs.com',
        'sergio.mendes+roads-test@essencislabs.com',
        'joao.fiori@essencistech.com.br'
      )
  );
$$;

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  access_url text,
  login_identifier text,
  login_email text,
  -- Ciphertext written by the app (AES-256-GCM). Never a plain password, never seeded.
  secret_password text,
  amount numeric(12, 2),
  currency text not null default 'BRL',
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'annual', 'one_off')),
  billing_day int check (billing_day between 1 and 31),
  next_charge_date date,
  status text not null default 'active' check (status in ('active', 'inactive', 'to_register')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

alter table public.subscriptions enable row level security;

-- One policy, the whole surface: only a member reads or writes, and only a member's own id may be written
-- as created_by on insert/update. created_by is otherwise free (service role seeds with null).
create policy "subscriptions: members read" on public.subscriptions
  for select using (public.is_controls_member());

create policy "subscriptions: members insert" on public.subscriptions
  for insert with check (public.is_controls_member() and (created_by is null or created_by = auth.uid()));

create policy "subscriptions: members update" on public.subscriptions
  for update using (public.is_controls_member()) with check (public.is_controls_member());

create policy "subscriptions: members delete" on public.subscriptions
  for delete using (public.is_controls_member());

-- Non-secret seed (the company's current subscriptions). Only runs on an empty table, so a re-push never
-- duplicates it. Passwords are never here: a member types them into the vault from the UI afterwards.
-- Amounts are BRL. Where a price is still being collected, amount is null and the dashboard tolerates it.
insert into public.subscriptions (name, category, access_url, login_identifier, login_email, amount, billing_cycle, status, notes)
select * from (values
  ('Microsoft 365', 'Productivity', 'https://myaccount.microsoft.com/', 'luiz.damore@essencislabs.com', 'luiz.damore@essencislabs.com', 596.22, 'monthly', 'active', '6x email+Office + 2x email'),
  ('Replit', 'Dev/AI', 'https://replit.com/account', 'adm@essencislabs.com', 'adm@essencislabs.com', null, 'monthly', 'active', null),
  ('Claude', 'AI', 'https://claude.ai/settings/account', 'adm@essencislabs.com', 'adm@essencislabs.com', 1376.00, 'monthly', 'active', 'Team plan, 2 seats. Next invoice Dec 4.'),
  ('Cursor', 'Dev/AI', 'https://cursor.com/dashboard/settings', 'adm@essencislabs.com', 'adm@essencislabs.com', 0.00, 'monthly', 'active', 'Free plan.'),
  ('ChatGPT', 'AI', 'https://chatgpt.com/', 'adm@essencislabs.com', 'adm@essencislabs.com', 650.00, 'monthly', 'active', 'Business plan, 5 seats. Drops to 260.00 from Dec 9 (3 seats removed).'),
  ('GitHub', 'Dev', 'https://github.com/settings/billing', 'adm-essencislabs', null, 0.00, 'monthly', 'active', 'Free plan.'),
  ('Velzon', 'Template/UI', 'https://themesbrand.com/', 'luiz.damore@essencis.com', 'luiz.damore@essencis.com', null, 'annual', 'active', null),
  ('Infojobs', 'HR', 'https://www.infojobs.com.br/', 'luiz.damore@essencislabs.com', 'luiz.damore@essencislabs.com', 269.99, 'monthly', 'active', 'Seasonal: Sep/Oct/Nov.'),
  ('Locaweb', 'Infra/Hosting', 'https://login.locaweb.com.br/', 'essencislabs', null, 387.00, 'monthly', 'active', 'Hosting. 298 + 89.'),
  ('USP Multi', 'Academic', null, 'luiz.damore@essencislabs.com', 'luiz.damore@essencislabs.com', null, 'annual', 'active', null),
  ('Kemiolab', 'Lab/SaaS', null, 'luiz.damore@essencislabs.com', 'luiz.damore@essencislabs.com', null, 'monthly', 'active', null),
  ('Norton', 'Security', 'https://my.norton.com/', 'adm@essencislabs.com', 'adm@essencislabs.com', null, 'annual', 'active', null),
  ('MyDISC', 'HR/Assessment', null, 'luiz.damore@essencislabs.com', 'luiz.damore@essencislabs.com', null, 'one_off', 'active', null),
  ('Sympla', 'Events', 'https://www.sympla.com.br/', 'luiz.damore@essencislabs.com', 'luiz.damore@essencislabs.com', null, 'one_off', 'active', null),
  ('Scale Quality', 'Quality/Process', null, null, null, null, 'monthly', 'to_register', null)
) as seed(name, category, access_url, login_identifier, login_email, amount, billing_cycle, status, notes)
where not exists (select 1 from public.subscriptions);
