create or replace function public.archive_santalbino_match()
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_state jsonb;
  v_poll_id text;
  v_id uuid;
  v_home_score integer;
  v_away_score integer;
begin
  if not public.is_santalbino_admin() then
    raise exception using errcode='42501', message='Amministratore non autorizzato';
  end if;

  select state into v_state from public.live_state where id = 1;
  if v_state is null then
    raise exception using errcode='P0001', message='Partita non disponibile';
  end if;

  if coalesce(v_state #>> '{clock,phase}', '') <> 'ft'
     or not exists (
       select 1 from jsonb_array_elements(coalesce(v_state->'events','[]'::jsonb)) ev
       where ev->>'type' = 'fulltime'
     ) then
    raise exception using errcode='P0001', message='Puoi archiviare la partita solo dopo il fischio finale';
  end if;

  v_poll_id := nullif(btrim(v_state #>> '{match,pollId}'), '');
  if v_poll_id is null then
    raise exception using errcode='22023', message='Identificativo partita mancante: salva la partita e riprova';
  end if;

  select
    count(*) filter (where case when ev->>'kind' = 'autogol'
                                then case when ev->>'team' = 'home' then 'away' else 'home' end
                                else ev->>'team' end = 'home')::integer,
    count(*) filter (where case when ev->>'kind' = 'autogol'
                                then case when ev->>'team' = 'home' then 'away' else 'home' end
                                else ev->>'team' end = 'away')::integer
  into v_home_score, v_away_score
  from jsonb_array_elements(coalesce(v_state->'events','[]'::jsonb)) ev
  where ev->>'type' = 'goal';

  insert into public.match_archive (
    poll_id, match_date, competition, venue, home_team, away_team,
    home_score, away_score, state
  )
  values (
    v_poll_id,
    coalesce(v_state #>> '{match,date}', ''),
    coalesce(v_state #>> '{match,comp}', ''),
    coalesce(v_state #>> '{match,venue}', ''),
    coalesce(nullif(v_state #>> '{match,home}', ''), 'Casa'),
    coalesce(nullif(v_state #>> '{match,away}', ''), 'Ospiti'),
    coalesce(v_home_score, 0),
    coalesce(v_away_score, 0),
    v_state #- '{mvp,votes}'
  )
  on conflict (poll_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.match_archive where poll_id = v_poll_id;
  end if;
  return v_id;
end;
$function$;

revoke all on function public.archive_santalbino_match() from public, anon;
grant execute on function public.archive_santalbino_match() to authenticated;