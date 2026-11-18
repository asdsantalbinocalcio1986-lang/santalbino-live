-- Sant'Albino Live · Fase 1 · migrazione sicurezza e integrità
-- Eseguire in Supabase SQL Editor PRIMA di pubblicare la versione applicativa
-- contenuta nel branch phase1-security-reliability.
-- Non elimina né modifica i voti MVP già registrati.

begin;

-- 1) La tabella dei voti non è più leggibile né scrivibile direttamente dal pubblico.
alter table public.mvp_votes enable row level security;
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname='public' and tablename='mvp_votes'
  loop
    execute format('drop policy if exists %I on public.mvp_votes',p.policyname);
  end loop;
end $$;
create policy "Only SantAlbino admin can read MVP votes"
  on public.mvp_votes for select to authenticated
  using (public.is_santalbino_admin());
revoke all on table public.mvp_votes from anon, authenticated;
grant select on table public.mvp_votes to authenticated;

-- 2) Voto anonimo: il server ricava partita, scadenza, candidato e dati del giocatore
-- dallo stato live. Il browser non può scegliere nome, squadra o numero da registrare.
create or replace function public.cast_santalbino_mvp_vote(
  p_candidate_key text,
  p_voter_hash text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;
revoke all on function public.cast_santalbino_mvp_vote(text,text) from public;
grant execute on function public.cast_santalbino_mvp_vote(text,text) to anon, authenticated;

-- 3) I visitatori ricevono esclusivamente conteggi aggregati della votazione corrente.
create or replace function public.get_santalbino_mvp_vote_counts(p_match_key text)
returns table(candidate_key text, votes bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_state jsonb;
  v_current_key text;
begin
  select state into v_state from public.live_state where id=1;
  if v_state is null then return; end if;
  v_current_key := nullif(v_state #>> '{match,pollId}','');
  if v_current_key is null then
    v_current_key := lower(
      coalesce(nullif(v_state #>> '{match,date}',''),'senza-data') || '|' ||
      coalesce(v_state #>> '{match,home}','') || '|' ||
      coalesce(v_state #>> '{match,away}','')
    );
  end if;
  if p_match_key is distinct from v_current_key then return; end if;
  return query
    select v.candidate_key,count(*)::bigint
    from public.mvp_votes v
    where v.match_key=v_current_key
    group by v.candidate_key;
end;
$$;
revoke all on function public.get_santalbino_mvp_vote_counts(text) from public;
grant execute on function public.get_santalbino_mvp_vote_counts(text) to anon, authenticated;

-- 4) Salvataggio condizionale: una revisione obsoleta non può sovrascrivere quella remota.
create or replace function public.save_santalbino_live_state(
  p_expected_rev bigint,
  p_state jsonb
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_rev bigint;
begin
  if not public.is_santalbino_admin() then
    raise exception using errcode='42501', message='Amministratore non autorizzato';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception using errcode='22023', message='Stato partita non valido';
  end if;
  v_new_rev := coalesce((p_state->>'rev')::bigint,-1);
  if v_new_rev <> p_expected_rev + 1 then
    raise exception using errcode='22023', message='Revisione non valida';
  end if;

  update public.live_state
     set state=p_state, updated_at=now()
   where id=1
     and coalesce((state->>'rev')::bigint,0)=p_expected_rev;
  if not found then
    raise exception using errcode='40001', message='Conflitto: la partita è stata modificata da un''altra sessione. Ricarica i dati.';
  end if;
  return v_new_rev;
end;
$$;
revoke all on function public.save_santalbino_live_state(bigint,jsonb) from public;
grant execute on function public.save_santalbino_live_state(bigint,jsonb) to authenticated;

commit;
