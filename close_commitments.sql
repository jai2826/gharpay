create table if not exists public.close_commitments (
  id text primary key,
  lead_id text not null,
  status text not null,
  due_at timestamptz,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.close_commitments disable row level security;
grant all on public.close_commitments to anon, authenticated, service_role;
notify pgrst, 'reload schema';