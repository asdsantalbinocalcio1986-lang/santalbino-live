-- Sant'Albino Live: tabella stato partita e policy di sicurezza
create table if not exists public.live_state (
  id integer primary key check (id = 1),
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.live_state enable row level security;

-- Tutti possono leggere la pagina live.
drop policy if exists "Public can read live state" on public.live_state;
create policy "Public can read live state"
  on public.live_state for select
  to anon, authenticated
  using (true);

-- Solo utenti autenticati possono inserire/aggiornare lo stato.
-- Le registrazioni pubbliche devono essere disattivate nel pannello Auth.
drop policy if exists "Authenticated admins can insert live state" on public.live_state;
create policy "Authenticated admins can insert live state"
  on public.live_state for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists "Authenticated admins can update live state" on public.live_state;
create policy "Authenticated admins can update live state"
  on public.live_state for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

insert into public.live_state (id, state) values (1, '{"rev":0}')
on conflict (id) do nothing;

-- Abilita gli aggiornamenti realtime della tabella.
alter publication supabase_realtime add table public.live_state;
