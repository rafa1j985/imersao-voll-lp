-- Rode no Supabase do projeto (qgyaeuirhxqekmnfklsj)
-- SQL Editor → New query → Run

create extension if not exists pgcrypto;

-- Perfis (admin / consultor)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'consultant')),
  name text not null default '',
  consultant_id uuid,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant all on table public.profiles to service_role;

-- Conteúdo publicado da LP (JSON do CONTEUDO)
create table if not exists public.lp_content (
  id text primary key default 'oficial',
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.lp_content enable row level security;
revoke all on table public.lp_content from anon, authenticated;
grant all on table public.lp_content to service_role;

insert into public.lp_content (id, content)
values ('oficial', '{}'::jsonb)
on conflict (id) do nothing;

-- Consultores de venda / conversa
create table if not exists public.consultants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  note text default '',
  created_at timestamptz not null default now()
);

alter table public.consultants enable row level security;
revoke all on table public.consultants from anon, authenticated;
grant all on table public.consultants to service_role;

alter table public.profiles
  drop constraint if exists profiles_consultant_id_fkey;
alter table public.profiles
  add constraint profiles_consultant_id_fkey
  foreign key (consultant_id) references public.consultants(id) on delete set null;

-- Slots abertos pelos consultores (ex.: 30 em 30 min; reunião = 20 min dentro do slot)
create table if not exists public.open_slots (
  id uuid primary key default gen_random_uuid(),
  consultant_id uuid not null references public.consultants(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'booked', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (consultant_id, starts_at)
);

create index if not exists open_slots_starts_at_idx on public.open_slots (starts_at);
create index if not exists open_slots_status_idx on public.open_slots (status);

alter table public.open_slots enable row level security;
revoke all on table public.open_slots from anon, authenticated;
grant all on table public.open_slots to service_role;

-- Agendamentos reais e fakes (prova social)
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid references public.open_slots(id) on delete set null,
  consultant_id uuid references public.consultants(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  nome text,
  whatsapp text,
  cidade text,
  is_fake boolean not null default false,
  display_name text,
  lead_id uuid,
  quiz_payload jsonb not null default '{}'::jsonb,
  crm_deal_id text,
  crm_ok boolean not null default false,
  crm_error text,
  created_at timestamptz not null default now()
);

create index if not exists bookings_starts_at_idx on public.bookings (starts_at);
create index if not exists bookings_slot_id_idx on public.bookings (slot_id);

alter table public.bookings enable row level security;
revoke all on table public.bookings from anon, authenticated;
grant all on table public.bookings to service_role;

comment on table public.lp_content is 'JSON publicado da LP Imersão VOLL';
comment on table public.open_slots is 'Horários liberados pelos consultores';
comment on table public.bookings is 'Agendamentos reais + fakes de prova social';
