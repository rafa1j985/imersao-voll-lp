-- Rode este SQL uma vez no Supabase do projeto:
-- Project: qgyaeuirhxqekmnfklsj
-- SQL Editor → New query → Run

create extension if not exists pgcrypto;

create table if not exists public.quiz_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text,
  whatsapp text,
  cidade text,
  dores text[] default '{}',
  ordem text[] default '{}',
  dores_labels text,
  ordem_labels text,
  alunos text,
  numeros text,
  momento text,
  dor_principal text,
  rota text,
  origem text,
  payload jsonb not null default '{}'::jsonb,
  crm_submission_ok boolean not null default false,
  crm_deal_ok boolean not null default false,
  crm_error text
);

create index if not exists quiz_leads_created_at_idx on public.quiz_leads (created_at desc);
create index if not exists quiz_leads_whatsapp_idx on public.quiz_leads (whatsapp);

alter table public.quiz_leads enable row level security;

-- Sem policies para anon/authenticated: só service_role / secret key acessa.
revoke all on table public.quiz_leads from anon, authenticated;
grant all on table public.quiz_leads to service_role;

comment on table public.quiz_leads is 'Leads do quiz da LP Imersão Presencial VOLL';
