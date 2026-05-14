-- Transcritor Local - Supabase schema
-- Run this in your Supabase SQL Editor after creating a new project.

create table if not exists transcriptions (
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

create table if not exists atas (
  id text primary key,
  title text not null,
  created_at timestamptz default now(),
  source_id text references transcriptions(id) on delete set null,
  content text,
  prompt text,
  provider text,
  model text,
  metadata jsonb,
  client text
);

create table if not exists jobs (
  id text primary key,
  status text not null,
  progress float default 0,
  error text,
  file_name text,
  created_at timestamptz default now(),
  transcription_id text references transcriptions(id) on delete set null,
  metadata jsonb
);

create index if not exists transcriptions_created_at_idx on transcriptions (created_at desc);
create index if not exists transcriptions_client_idx on transcriptions (client);
create index if not exists atas_created_at_idx on atas (created_at desc);
create index if not exists atas_client_idx on atas (client);
create index if not exists atas_source_id_idx on atas (source_id);
create index if not exists jobs_status_idx on jobs (status);

-- The app uses the Supabase anon key from a single trusted machine and
-- doesn't model multi-tenant auth. RLS is disabled so the anon role can
-- read/write directly. If you expose this to untrusted clients, enable
-- RLS and write proper policies first.
alter table transcriptions disable row level security;
alter table atas disable row level security;
alter table jobs disable row level security;

grant all on transcriptions to anon, authenticated;
grant all on atas to anon, authenticated;
grant all on jobs to anon, authenticated;
