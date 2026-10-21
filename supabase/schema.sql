-- Transcritor Local: instalação das tabelas acessadas somente pelo backend.
-- Execute no SQL Editor do projeto Supabase correto, como postgres.
-- A transação aplica o schema e as permissões juntos, preservando os dados.

begin;

create table if not exists public.transcriptions (
  id text primary key,
  file_name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  duration text,
  status text,
  markdown_content text,
  metadata jsonb,
  client text
);

create table if not exists public.atas (
  id text primary key,
  title text not null,
  created_at timestamptz default now(),
  source_id text references public.transcriptions(id) on delete set null,
  content text,
  prompt text,
  provider text,
  model text,
  metadata jsonb,
  client text
);

create table if not exists public.jobs (
  id text primary key,
  status text not null,
  progress float default 0,
  error text,
  file_name text,
  created_at timestamptz default now(),
  transcription_id text references public.transcriptions(id) on delete set null,
  metadata jsonb
);

create index if not exists transcriptions_created_at_idx on public.transcriptions (created_at desc);
create index if not exists transcriptions_client_idx on public.transcriptions (client);
create index if not exists atas_created_at_idx on public.atas (created_at desc);
create index if not exists atas_client_idx on public.atas (client);
create index if not exists atas_source_id_idx on public.atas (source_id);
create index if not exists jobs_status_idx on public.jobs (status);

-- O navegador usa a API local. Somente o backend acessa estas tabelas com
-- service_role, que ignora RLS mas também precisa dos grants SQL explícitos.
-- Sem policies de cliente: anon/authenticated não acessam os dados pela Data API.
alter table public.transcriptions enable row level security;
alter table public.atas enable row level security;
alter table public.jobs enable row level security;

-- Corrige também instalações antigas, sem alterar outras tabelas ou defaults
-- do projeto compartilhado. Não concede TRUNCATE, REFERENCES nem TRIGGER.
revoke all on table public.transcriptions, public.atas, public.jobs
  from public, anon, authenticated, service_role;
grant usage on schema public to service_role;
grant select, insert, update, delete
  on table public.transcriptions, public.atas, public.jobs to service_role;

commit;
