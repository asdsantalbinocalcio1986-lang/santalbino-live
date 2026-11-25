-- Hardening additivo del publisher social.
-- Non pubblica contenuti e non modifica configurazioni Meta.

alter table public.santalbino_social_publications
  add column if not exists claim_token uuid,
  add column if not exists lease_expires_at timestamptz;

alter table public.santalbino_social_publications
  drop constraint if exists santalbino_social_publications_overall_status_check;
alter table public.santalbino_social_publications
  drop constraint if exists santalbino_social_publications_facebook_status_check;
alter table public.santalbino_social_publications
  drop constraint if exists santalbino_social_publications_instagram_status_check;

-- Gli esiti "failed" creati dalla vecchia implementazione non distinguono
-- un rifiuto certo da un timeout dopo accettazione: li trattiamo conservativamente.
update public.santalbino_social_publications
set facebook_status = case when facebook_status = 'failed' then 'unknown' else facebook_status end,
    instagram_status = case when instagram_status = 'failed' then 'unknown' else instagram_status end,
    overall_status = case
      when facebook_status = 'failed' or instagram_status = 'failed'
        then 'reconciliation_required'
      else overall_status
    end
where facebook_status = 'failed' or instagram_status = 'failed';

alter table public.santalbino_social_publications
  add constraint santalbino_social_publications_overall_status_check
  check (overall_status in ('processing', 'published', 'partial', 'failed',
                            'reconciliation_required'));
alter table public.santalbino_social_publications
  add constraint santalbino_social_publications_facebook_status_check
  check (facebook_status in ('pending', 'processing', 'published',
                             'failed', 'failed_retryable', 'unknown', 'skipped'));
alter table public.santalbino_social_publications
  add constraint santalbino_social_publications_instagram_status_check
  check (instagram_status in ('pending', 'processing', 'published',
                              'failed', 'failed_retryable', 'unknown', 'skipped'));

create index if not exists santalbino_social_publications_claim_idx
  on public.santalbino_social_publications (event_id, claim_token);

-- Unico punto di acquisizione: INSERT concorrenti sono serializzati dal vincolo
-- UNIQUE(event_id); i record con stato incerto non vengono mai riacquisiti.
create or replace function public.claim_santalbino_social_publication(
  p_event_id text,
  p_match_id text,
  p_event_type text,
  p_caption text,
  p_image_url text,
  p_platforms jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.santalbino_social_publications%rowtype;
  v_token uuid := gen_random_uuid();
  v_facebook boolean;
  v_instagram boolean;
begin
  -- Validate JSON types before deriving booleans: malformed service-role input
  -- must fail with a controlled validation error, not a cast exception.
  if p_event_id is null or length(btrim(p_event_id)) = 0 or length(p_event_id) > 180
     or p_event_type is null or p_event_type not in ('goal', 'red', 'halftime', 'fulltime')
     or p_caption is null or length(btrim(p_caption)) = 0 or length(p_caption) > 2200
     or p_image_url is null or length(btrim(p_image_url)) = 0
     or (p_match_id is not null and length(p_match_id) > 180)
     or p_platforms is null or jsonb_typeof(p_platforms) <> 'object'
     or (p_platforms ? 'facebook' and jsonb_typeof(p_platforms -> 'facebook') <> 'boolean')
     or (p_platforms ? 'instagram' and jsonb_typeof(p_platforms -> 'instagram') <> 'boolean') then
    raise exception 'invalid publication claim input' using errcode = '22023';
  end if;

  v_facebook := coalesce((p_platforms -> 'facebook') = 'true'::jsonb, false);
  v_instagram := coalesce((p_platforms -> 'instagram') = 'true'::jsonb, false);
  if not (v_facebook or v_instagram) then
    raise exception 'at least one publication platform is required' using errcode = '22023';
  end if;

  insert into public.santalbino_social_publications (
    event_id, match_id, event_type, caption, image_url, platforms,
    overall_status, facebook_status, instagram_status,
    claim_token, lease_expires_at, updated_at
  ) values (
    p_event_id, nullif(p_match_id, ''), p_event_type, p_caption, p_image_url, p_platforms,
    'processing',
    case when v_facebook then 'processing' else 'skipped' end,
    case when v_instagram then 'processing' else 'skipped' end,
    v_token, now() + interval '5 minutes', now()
  )
  on conflict (event_id) do nothing
  returning * into v_row;

  if found then
    return jsonb_build_object('result', 'claimed', 'id', v_row.id,
                              'claim_token', v_token, 'row', to_jsonb(v_row));
  end if;

  select * into v_row
  from public.santalbino_social_publications
  where event_id = p_event_id
  for update;

  if not found then
    return jsonb_build_object('result', 'unavailable');
  end if;

  if ((not v_facebook or v_row.facebook_status = 'published')
      and (not v_instagram or v_row.instagram_status = 'published')) then
    return jsonb_build_object('result', 'already_published', 'row', to_jsonb(v_row));
  end if;

  -- An active lease means another worker owns this publication. Report it as
  -- processing, not as a reconciliation incident.
  if v_row.claim_token is not null
     and v_row.lease_expires_at is not null
     and v_row.lease_expires_at > now() then
    return jsonb_build_object('result', 'processing', 'row', to_jsonb(v_row));
  end if;

  -- An expired/missing lease cannot be retried safely: Meta may have accepted
  -- the request before the worker died. Fence the stale worker and require
  -- operator reconciliation instead of silently leaving the row locked forever.
  if v_row.claim_token is not null then
    update public.santalbino_social_publications
    set facebook_status = case when facebook_status = 'processing' then 'unknown' else facebook_status end,
        instagram_status = case when instagram_status = 'processing' then 'unknown' else instagram_status end,
        overall_status = 'reconciliation_required',
        facebook_error = case when facebook_status = 'processing'
          then coalesce(facebook_error || ' · ', '') || 'Lease scaduta: verificare su Meta prima di riprovare.'
          else facebook_error end,
        instagram_error = case when instagram_status = 'processing'
          then coalesce(instagram_error || ' · ', '') || 'Lease scaduta: verificare su Meta prima di riprovare.'
          else instagram_error end,
        claim_token = null,
        lease_expires_at = null,
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
    return jsonb_build_object('result', 'reconciliation_required', 'row', to_jsonb(v_row));
  end if;

  -- Legacy or malformed in-flight rows may have lost their fencing token.
  -- A processing state without a live token is ambiguous and must be persisted
  -- as unknown, not merely returned as a transient reconciliation response.
  if v_row.facebook_status = 'processing' or v_row.instagram_status = 'processing' then
    update public.santalbino_social_publications
    set facebook_status = case when facebook_status = 'processing' then 'unknown' else facebook_status end,
        instagram_status = case when instagram_status = 'processing' then 'unknown' else instagram_status end,
        overall_status = 'reconciliation_required',
        facebook_error = case when facebook_status = 'processing'
          then coalesce(facebook_error || ' · ', '') || 'Claim senza token valido: verificare su Meta prima di riprovare.'
          else facebook_error end,
        instagram_error = case when instagram_status = 'processing'
          then coalesce(instagram_error || ' · ', '') || 'Claim senza token valido: verificare su Meta prima di riprovare.'
          else instagram_error end,
        claim_token = null,
        lease_expires_at = null,
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
    return jsonb_build_object('result', 'reconciliation_required', 'row', to_jsonb(v_row));
  end if;

  if v_row.facebook_status = 'unknown' or v_row.instagram_status = 'unknown'
     or v_row.overall_status = 'reconciliation_required' then
    return jsonb_build_object('result', 'reconciliation_required', 'row', to_jsonb(v_row));
  end if;

  if (v_facebook and v_row.facebook_status not in ('pending', 'failed_retryable', 'skipped', 'published'))
     or (v_instagram and v_row.instagram_status not in ('pending', 'failed_retryable', 'skipped', 'published')) then
    return jsonb_build_object('result', 'reconciliation_required', 'row', to_jsonb(v_row));
  end if;

  update public.santalbino_social_publications
  set match_id = coalesce(nullif(p_match_id, ''), match_id),
      event_type = p_event_type,
      caption = p_caption,
      image_url = p_image_url,
      platforms = p_platforms,
      overall_status = 'processing',
      facebook_status = case
        when not v_facebook and facebook_status <> 'published' then 'skipped'
        when facebook_status = 'published' then 'published'
        else 'processing' end,
      instagram_status = case
        when not v_instagram and instagram_status <> 'published' then 'skipped'
        when instagram_status = 'published' then 'published'
        else 'processing' end,
      facebook_error = null,
      instagram_error = null,
      claim_token = v_token,
      lease_expires_at = now() + interval '5 minutes',
      updated_at = now()
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object('result', 'claimed', 'id', v_row.id,
                            'claim_token', v_token, 'row', to_jsonb(v_row));
end;
$$;

revoke all on function public.claim_santalbino_social_publication(
  text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.claim_santalbino_social_publication(
  text, text, text, text, text, jsonb
) to service_role;
