-- SANTA Live: revisione autorevole lato database e sincronizzazione delle partite già archiviate.
-- La modifica è atomica: live_state e match_archive vengono aggiornati nella stessa transazione.

begin;

-- Consente l'aggiornamento dell'archivio esclusivamente all'amministratore designato.
drop policy if exists "Only SantAlbino admin can update archived matches" on public.match_archive;
create policy "Only SantAlbino admin can update archived matches"
on public.match_archive
for update
to authenticated
using (public.is_santalbino_admin())
with check (public.is_santalbino_admin());
grant update on table public.match_archive to authenticated;

create or replace function public.save_santalbino_live_state(
  p_expected_rev bigint,
  p_state jsonb
) returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_new_rev bigint;
  v_state jsonb;
  v_archive_state jsonb;
  v_poll_id text;
  v_home_score integer := 0;
  v_away_score integer := 0;
begin
  if not public.is_santalbino_admin() then
    raise exception using errcode='42501', message='Amministratore non autorizzato';
  end if;

  if p_expected_rev is null or p_expected_rev < 0 then
    raise exception using errcode='22023', message='Revisione attesa non valida';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception using errcode='22023', message='Stato partita non valido';
  end if;

  -- La revisione viene assegnata dal database: non dipende dal valore
  -- eventualmente presente nel JSON inviato dal browser.
  v_new_rev := p_expected_rev + 1;
  v_state := jsonb_set(p_state, '{rev}', to_jsonb(v_new_rev), true);

  update public.live_state
     set state = v_state, updated_at = now()
   where id = 1
     and coalesce((state->>'rev')::bigint, 0) = p_expected_rev;

  if not found then
    raise exception using errcode='40001',
      message='Conflitto: la partita è stata modificata da un''altra sessione. Ricarica i dati.';
  end if;

  -- Se la partita è già archiviata, aggiorna la copia storica nella stessa
  -- transazione, mantenendo gli ID degli eventi e ricalcolando il punteggio.
  v_poll_id := nullif(btrim(v_state #>> '{match,pollId}'), '');
  if v_poll_id is not null then
    select
      count(*) filter (
        where (case
          when ev->>'kind' = 'autogol'
            then case when ev->>'team' = 'home' then 'away' else 'home' end
          else ev->>'team'
        end) = 'home'
      )::integer,
      count(*) filter (
        where (case
          when ev->>'kind' = 'autogol'
            then case when ev->>'team' = 'home' then 'away' else 'home' end
          else ev->>'team'
        end) = 'away'
      )::integer
    into v_home_score, v_away_score
    from jsonb_array_elements(
      case when jsonb_typeof(v_state->'events') = 'array'
        then v_state->'events' else '[]'::jsonb end
    ) ev
    where ev->>'type' = 'goal';

    -- L'archivio è pubblico: non deve contenere la cronaca testuale riservata
    -- alla regia né i conteggi privati dei voti MVP.
    v_archive_state := v_state #- '{mvp,votes}';
    v_archive_state := jsonb_set(
      v_archive_state,
      '{events}',
      coalesce((
        select jsonb_agg(
          case when ev->>'type' = 'mvp' then ev - 'votes' else ev end
          order by ord
        )
        from jsonb_array_elements(
          case when jsonb_typeof(v_state->'events') = 'array'
            then v_state->'events' else '[]'::jsonb end
        ) with ordinality as x(ev, ord)
      ), '[]'::jsonb),
      true
    );
    v_archive_state := jsonb_set(
      v_archive_state,
      '{match}',
      coalesce(v_archive_state->'match', '{}'::jsonb)
        - 'chronicleDraft' - 'chroniclePublished' - 'chronicleNeedsReview',
      true
    );

    update public.match_archive
       set match_date = coalesce(v_state #>> '{match,date}', ''),
           competition = coalesce(v_state #>> '{match,comp}', ''),
           venue = coalesce(v_state #>> '{match,venue}', ''),
           home_team = coalesce(nullif(v_state #>> '{match,home}', ''), 'Casa'),
           away_team = coalesce(nullif(v_state #>> '{match,away}', ''), 'Ospiti'),
           home_score = coalesce(v_home_score, 0),
           away_score = coalesce(v_away_score, 0),
           state = v_archive_state
     where poll_id = v_poll_id;
  end if;

  return v_new_rev;
end;
$$;

revoke all on function public.save_santalbino_live_state(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.save_santalbino_live_state(bigint,jsonb) to authenticated;

-- La simulazione usa la stessa regola di revisione, senza toccare dati ufficiali.
create or replace function public.save_santalbino_test_state(
  p_expected_rev bigint,
  p_state jsonb
) returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_new_rev bigint;
  v_state jsonb;
begin
  if not public.is_santalbino_admin() then
    raise exception using errcode='42501', message='Amministratore non autorizzato';
  end if;
  if p_expected_rev is null or p_expected_rev < 0 then
    raise exception using errcode='22023', message='Revisione di prova attesa non valida';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception using errcode='22023', message='Stato partita di prova non valido';
  end if;

  v_new_rev := p_expected_rev + 1;
  v_state := jsonb_set(p_state, '{rev}', to_jsonb(v_new_rev), true);

  update public.live_test_state
     set state = v_state, updated_at = now()
   where id = 1
     and coalesce((state->>'rev')::bigint, 0) = p_expected_rev;

  if not found then
    raise exception using errcode='40001',
      message='Conflitto: la simulazione è stata modificata da un''altra sessione. Ricarica i dati.';
  end if;
  return v_new_rev;
end;
$$;

revoke all on function public.save_santalbino_test_state(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.save_santalbino_test_state(bigint,jsonb) to authenticated;

commit;
