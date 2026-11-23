-- SANTA Live · la votazione accetta esclusivamente i quattro candidati scelti dalla regia.
begin;
create or replace function public.cast_santalbino_mvp_vote(
  p_candidate_key text,
  p_voter_hash text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $vote$
declare
  v_state jsonb;
  v_match_key text;
  v_side text;
  v_candidate_name text;
  v_roster text;
  v_line text;
  v_parts text[];
  v_player_name text;
  v_player_num text;
  v_found boolean := false;
  v_fulltime_ms numeric;
  v_now_ms numeric;
begin
  if p_voter_hash !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    raise exception using errcode='22023', message='Identificativo votante non valido';
  end if;
  if length(coalesce(p_candidate_key,'')) not between 3 and 180
     or position('|' in p_candidate_key)=0 then
    raise exception using errcode='22023', message='Candidato non valido';
  end if;

  select state into v_state from public.live_state where id=1;
  if v_state is null then
    raise exception using errcode='P0001', message='Partita non disponibile';
  end if;

  v_match_key := nullif(v_state #>> '{match,pollId}','');
  if v_match_key is null then
    v_match_key := lower(
      coalesce(nullif(v_state #>> '{match,date}',''),'senza-data') || '|' ||
      coalesce(v_state #>> '{match,home}','') || '|' ||
      coalesce(v_state #>> '{match,away}','')
    );
  end if;

  select (ev->>'ts')::numeric into v_fulltime_ms
  from jsonb_array_elements(coalesce(v_state->'events','[]'::jsonb))
       with ordinality as x(ev,ord)
  where ev->>'type'='fulltime'
  order by ord desc limit 1;

  if v_fulltime_ms is null then
    raise exception using errcode='P0001', message='La votazione non è aperta';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_state->'events','[]'::jsonb)) ev
    where ev->>'type'='mvp'
  ) then
    raise exception using errcode='P0001', message='La votazione è già stata conclusa';
  end if;
  v_now_ms := extract(epoch from clock_timestamp()) * 1000;
  if v_now_ms >= v_fulltime_ms + 43200000 then
    raise exception using errcode='P0001', message='La votazione è scaduta';
  end if;

  v_side := split_part(p_candidate_key,'|',1);
  v_candidate_name := substring(p_candidate_key from position('|' in p_candidate_key)+1);
  if v_side not in ('home','away') or v_candidate_name='' then
    raise exception using errcode='22023', message='Candidato non valido';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_state #> '{mvp,selectedCandidates}', '[]'::jsonb)) as selected(candidate_key)
    where selected.candidate_key = p_candidate_key
  ) then
    raise exception using errcode='22023', message='Candidato non selezionato dalla regia';
  end if;

  if coalesce((v_state #>> '{mvp,ourOnly}')::boolean,false)
     and v_side <> coalesce(v_state #>> '{match,ourSide}','home') then
    raise exception using errcode='22023', message='Candidato non ammesso';
  end if;

  v_roster := coalesce(v_state #>> array['rosters',v_side],'');
  foreach v_line in array string_to_array(v_roster,E'\n') loop
    v_line := btrim(v_line);
    if v_line='' or v_line ~ '^[-–—=]{3,}$' or v_line ~* '^panchina\b' then
      continue;
    end if;
    v_parts := regexp_match(v_line,'^\s*(\d{1,2})?[\s.\-–)\]]*(.+)$');
    if v_parts is not null then
      v_player_num := coalesce(v_parts[1],'');
      v_player_name := btrim(v_parts[2]);
      if v_player_name <> '' and v_side || '|' || v_player_name = p_candidate_key then
        v_found := true;
        exit;
      end if;
    end if;
  end loop;
  if not v_found then
    raise exception using errcode='22023', message='Candidato non presente nella rosa';
  end if;

  insert into public.mvp_votes(match_key,voter_hash,candidate_key,candidate_name,team,shirt_number)
  values(v_match_key,lower(p_voter_hash),p_candidate_key,v_candidate_name,v_side,v_player_num);
exception
  when unique_violation then
    raise exception using errcode='23505', message='Hai già espresso il tuo voto per questa partita';
end;
$vote$;
revoke all on function public.cast_santalbino_mvp_vote(text,text) from public;
grant execute on function public.cast_santalbino_mvp_vote(text,text) to anon, authenticated;
commit;
