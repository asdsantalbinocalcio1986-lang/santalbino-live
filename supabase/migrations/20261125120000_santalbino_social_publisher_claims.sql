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
security definer
set search_path = ''
as $$
declare
  v_row public.santalbino_social_publications%rowtype;
  v_token uuid := gen_random_uuid();
  v_facebook boolean := coalesce((p_platforms ->> 'facebook')::boolean, false);
  v_instagram boolean := coalesce((p_platforms ->> 'instagram')::boolean, false);
begin
  if p_event_id is null or length(p_event_id) = 0 or length(p_event_id) > 180
     or p_event_type not in ('goal', 'red', 'halftime', 'fulltime')
     or p_caption is null or length(p_caption) = 0
     or not (v_facebook or v_instagram) then
    raise exception 'invalid publication claim input' using errcode = '22023';
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

  if v_row.overall_status = 'published'
     or ((not v_facebook or v_row.facebook_status = 'published')
         and (not v_instagram or v_row.instagram_status = 'published')) then
    return jsonb_build_object('result', 'already_published', 'row', to_jsonb(v_row));
  end if;

  if v_row.facebook_status in ('unknown', 'processing')
     or v_row.instagram_status in ('unknown', 'processing')
     or v_row.overall_status = 'reconciliation_required'
     or v_row.claim_token is not null then
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
