create table if not exists public.booking_flow_records (
  kind text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);
alter table public.booking_flow_records disable row level security;
grant all on public.booking_flow_records to anon, authenticated, service_role;
notify pgrst, 'reload schema';