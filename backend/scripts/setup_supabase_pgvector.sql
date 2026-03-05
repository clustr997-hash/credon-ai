-- Credon AI: Supabase Postgres + pgvector setup
-- Run in Supabase SQL Editor

create extension if not exists vector;

create table if not exists public.knowledge_chunks (
  id text primary key,
  user_id text not null,
  document_id text not null,
  chunk_index integer not null,
  text text not null,
  embedding vector(256) not null,
  source_type text not null default 'note',
  subject text not null default 'general',
  tags text[] not null default '{}',
  board text not null default '',
  university text not null default '',
  semester text not null default '',
  filename text not null default 'uploaded-document',
  created_at timestamptz not null default now()
);

create index if not exists idx_knowledge_chunks_user_id
  on public.knowledge_chunks (user_id);

create index if not exists idx_knowledge_chunks_user_subject
  on public.knowledge_chunks (user_id, subject);

create index if not exists idx_knowledge_chunks_embedding
  on public.knowledge_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

analyze public.knowledge_chunks;
