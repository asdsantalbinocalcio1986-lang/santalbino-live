-- SANTA Live: ambiente persistente isolato per le partite di prova.
-- Non modifica live_state, match_archive, mvp_votes o l'archivio immagini ufficiale.

create table if not exists public.live_test_state (
  id integer primary key check (id = 1),
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.live_test_state enable row level security;

grant select on public.live_test_state to anon, authenticated;
grant update on public.live_test_state to authenticated;

drop policy if exists "Public can read SANTA Live test state" on public.live_test_state;
create policy "Public can read SANTA Live test state"
  on public.live_test_state for select to anon, authenticated
  using (true);

drop policy if exists "Only SANTA Live admin can update test state" on public.live_test_state;
create policy "Only SANTA Live admin can update test state"
  on public.live_test_state for update to authenticated
  using (public.is_santalbino_admin())
  with check (public.is_santalbino_admin());

insert into public.live_test_state (id, state)
values (
  1,
  jsonb_build_object(
    'rev', 0,
    'match', jsonb_build_object(
      'home', 'ASD Sant''Albino Terme · TEST',
      'away', 'SQUADRA AVVERSARIA · TEST',
      'comp', 'SIMULAZIONE SANTA LIVE',
      'venue', 'Centro Sportivo Luciano Monaci · TEST',
      'date', '',
      'time', '',
      'ourSide', 'home',
      'hashtag', '#SANTALIVETEST',
      'pollId', 'SANTALBINO-TEST'
    ),
    'logos', jsonb_build_object('home', './assets/logo-home.png', 'away', './assets/logo-away.png'),
    'rosters', jsonb_build_object('home', '', 'away', ''),
    'convocati', '',
    'clock', jsonb_build_object('phase', 'pre', 't0', 0),
    'mvp', jsonb_build_object('link', '', 'ourOnly', true, 'votes', jsonb_build_object(), 'tpl', '', 'raw', false),
    'media', jsonb_build_object(
      'evOne', jsonb_build_object(),
      'evImg', jsonb_build_object(),
      'evImgRaw', jsonb_build_object(),
      'library', jsonb_build_object('goal', '', 'formation', '', 'sponsors', jsonb_build_array()),
      'graphicEditor', jsonb_build_object('global', jsonb_build_object('accent', '#e3c66d', 'overlay', 0, 'border', 3, 'sponsor', false), 'templates', jsonb_build_object())
    ),
    'events', jsonb_build_array()
  )
)
on conflict (id) do nothing;

create or replace function public.save_santalbino_test_state(p_expected_rev bigint, p_state jsonb)
returns bigint
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_new_rev bigint;
begin
  if not public.is_santalbino_admin() then
    raise exception using errcode='42501', message='Amministratore non autorizzato';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception using errcode='22023', message='Stato partita di prova non valido';
  end if;
  v_new_rev := coalesce((p_state->>'rev')::bigint,-1);
  if v_new_rev <> p_expected_rev + 1 then
    raise exception using errcode='22023', message='Revisione di prova non valida';
  end if;

  update public.live_test_state
     set state=p_state, updated_at=now()
   where id=1
     and coalesce((state->>'rev')::bigint,0)=p_expected_rev;
  if not found then
    raise exception using errcode='40001', message='Conflitto: la simulazione è stata modificata da un''altra sessione. Ricarica i dati.';
  end if;
  return v_new_rev;
end;
$function$;

revoke all on function public.save_santalbino_test_state(bigint, jsonb) from public;
grant execute on function public.save_santalbino_test_state(bigint, jsonb) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_test_state'
  ) then
    alter publication supabase_realtime add table public.live_test_state;
  end if;
end $$;
