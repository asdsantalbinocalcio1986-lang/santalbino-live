-- PROPOSAL ONLY — not applied to Supabase.
-- Server-side editorial queue foundation. Requires the existing SANTA Live admin helper.
-- Apply only to an isolated development database after review.
 
create table if not exists public.santalbino_editorial_posts (
  id uuid primary key default gen_random_uuid(),
  logical_key text not null check (logical_key ~ '^[a-z0-9:_-]{3,180}$'),
  match_id text,
  content_type text not null
    check (content_type in ('match_day', 'convocati', 'formation', 'post_match', 'club_notice', 'custom')),
  revision integer not null check (revision > 0),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'scheduled', 'publishing', 'published',
                      'partial', 'failed', 'unknown', 'cancelled', 'superseded')),
  caption text not null check (char_length(btrim(caption)) between 1 and 2200),
  asset_path text not null check (asset_path like 'social-editorial/%'),
  asset_sha256 text not null check (asset_sha256 ~ '^[a-f0-9]{64}$'),
  platforms jsonb not null
    check (
      jsonb_typeof(platforms) = 'object'
      and (not (platforms ? 'facebook') or jsonb_typeof(platforms -> 'facebook') = 'boolean')
      and (not (platforms ? 'instagram') or jsonb_typeof(platforms -> 'instagram') = 'boolean')
      and ((platforms -> 'facebook') = 'true'::jsonb or (platforms -> 'instagram') = 'true'::jsonb)
    ),
  snapshot jsonb not null
    check (jsonb_typeof(snapshot) = 'object' and pg_catalog.pg_column_size(snapshot) <= 65536),
  scheduled_at timestamptz,
  timezone text not null default 'Europe/Rome' check (timezone = 'Europe/Rome'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  claim_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  published_at timestamptz,
  last_error_safe text,
  unique (logical_key, revision),
  check (
    (status in ('approved', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'unknown')
      and approved_by is not null and approved_at is not null)
    or status in ('draft', 'cancelled', 'superseded')
  ),
  check ((status = 'scheduled' and scheduled_at is not null) or status <> 'scheduled'),
  check ((status = 'published' and published_at is not null) or status <> 'published')
);

create index if not exists santalbino_editorial_queue_due_idx
  on public.santalbino_editorial_posts (scheduled_at, created_at)
  where status in ('approved', 'scheduled', 'partial', 'failed');

create table if not exists public.santalbino_editorial_deliveries (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.santalbino_editorial_posts(id) on delete restrict,
  platform text not null check (platform in ('facebook', 'instagram')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'published', 'failed_retryable', 'unknown')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claim_token uuid,
  lease_expires_at timestamptz,
  external_container_id text,
  external_post_id text,
  last_error_safe text,
  last_attempt_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, platform),
  check ((status = 'published' and external_post_id is not null and published_at is not null) or status <> 'published')
);

create index if not exists santalbino_editorial_deliveries_claim_idx
  on public.santalbino_editorial_deliveries (post_id, status, lease_expires_at);

alter table public.santalbino_editorial_posts enable row level security;
alter table public.santalbino_editorial_deliveries enable row level security;

revoke all on public.santalbino_editorial_posts from anon, authenticated;
revoke all on public.santalbino_editorial_deliveries from anon, authenticated;
grant select, insert, update on public.santalbino_editorial_posts to authenticated;
grant select on public.santalbino_editorial_deliveries to authenticated;
grant all on public.santalbino_editorial_posts to service_role;
grant all on public.santalbino_editorial_deliveries to service_role;

drop policy if exists "SANTA Live admins can read editorial posts" on public.santalbino_editorial_posts;
create policy "SANTA Live admins can read editorial posts"
  on public.santalbino_editorial_posts for select to authenticated
  using (public.is_santalbino_admin());

drop policy if exists "SANTA Live admins can create editorial drafts" on public.santalbino_editorial_posts;
create policy "SANTA Live admins can create editorial drafts"
  on public.santalbino_editorial_posts for insert to authenticated
  with check (
    public.is_santalbino_admin()
    and created_by = (select auth.uid())
    and status = 'draft'
    and approved_by is null
    and approved_at is null
  );

drop policy if exists "SANTA Live admins can update editorial drafts" on public.santalbino_editorial_posts;
create policy "SANTA Live admins can update editorial drafts"
  on public.santalbino_editorial_posts for update to authenticated
  using (public.is_santalbino_admin() and status in ('draft', 'approved', 'scheduled'))
  with check (public.is_santalbino_admin() and status in ('draft', 'approved', 'scheduled', 'cancelled', 'superseded'));

drop policy if exists "SANTA Live admins can read editorial deliveries" on public.santalbino_editorial_deliveries;
create policy "SANTA Live admins can read editorial deliveries"
  on public.santalbino_editorial_deliveries for select to authenticated
  using (public.is_santalbino_admin());

create or replace function public.guard_santalbino_editorial_post()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'service_role' then
    return new;
  end if;

  if old.status not in ('draft', 'approved', 'scheduled') then
    raise exception 'editorial post is immutable in status %', old.status using errcode = '55000';
  end if;

  if old.status <> 'draft' and (
    new.logical_key is distinct from old.logical_key
    or new.match_id is distinct from old.match_id
    or new.content_type is distinct from old.content_type
    or new.revision is distinct from old.revision
    or new.caption is distinct from old.caption
    or new.asset_path is distinct from old.asset_path
    or new.asset_sha256 is distinct from old.asset_sha256
    or new.platforms is distinct from old.platforms
    or new.snapshot is distinct from old.snapshot
    or new.scheduled_at is distinct from old.scheduled_at
    or new.timezone is distinct from old.timezone
    or new.created_by is distinct from old.created_by
  ) then
    raise exception 'approved editorial snapshot is immutable; create a new revision' using errcode = '55000';
  end if;

  if old.status = 'draft' and new.status not in ('draft', 'approved', 'scheduled', 'cancelled', 'superseded') then
    raise exception 'invalid draft state transition' using errcode = '55000';
  end if;
  if old.status = 'approved' and new.status not in ('approved', 'scheduled', 'cancelled') then
    raise exception 'invalid approved state transition' using errcode = '55000';
  end if;
  if old.status = 'scheduled' and new.status not in ('scheduled', 'cancelled') then
    raise exception 'invalid scheduled state transition' using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger if exists santalbino_editorial_post_guard on public.santalbino_editorial_posts;
create trigger santalbino_editorial_post_guard
  before update on public.santalbino_editorial_posts
  for each row execute function public.guard_santalbino_editorial_post();

create or replace function public.save_santalbino_editorial_draft(
  p_logical_key text,
  p_content_type text,
  p_match_id text,
  p_caption text,
  p_asset_path text,
  p_asset_sha256 text,
  p_platforms jsonb,
  p_snapshot jsonb
)
returns public.santalbino_editorial_posts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_revision integer;
  v_row public.santalbino_editorial_posts%rowtype;
begin
  if auth.uid() is null or not public.is_santalbino_admin() then
    raise exception 'SANTA Live admin required' using errcode = '42501';
  end if;
  if p_logical_key is null or p_logical_key !~ '^[a-z0-9:_-]{3,180}$'
     or p_content_type not in ('match_day', 'convocati', 'formation', 'post_match', 'club_notice', 'custom')
     or p_caption is null or char_length(btrim(p_caption)) not between 1 and 2200
     or p_asset_path is null or p_asset_path not like 'social-editorial/%'
     or p_asset_sha256 is null or p_asset_sha256 !~ '^[a-f0-9]{64}$'
     or p_platforms is null or jsonb_typeof(p_platforms) <> 'object'
     or (p_platforms ? 'facebook' and jsonb_typeof(p_platforms -> 'facebook') <> 'boolean')
     or (p_platforms ? 'instagram' and jsonb_typeof(p_platforms -> 'instagram') <> 'boolean')
     or ((p_platforms -> 'facebook') <> 'true'::jsonb and (p_platforms -> 'instagram') <> 'true'::jsonb)
     or p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
     or pg_catalog.pg_column_size(p_snapshot) > 65536 then
    raise exception 'invalid editorial draft input' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_logical_key, 0));
  update public.santalbino_editorial_posts
     set status = 'superseded', updated_at = now()
   where logical_key = p_logical_key and status = 'draft';

  select coalesce(max(revision), 0) + 1 into v_revision
    from public.santalbino_editorial_posts
   where logical_key = p_logical_key;

  insert into public.santalbino_editorial_posts (
    logical_key, match_id, content_type, revision, status, caption,
    asset_path, asset_sha256, platforms, snapshot, created_by
  ) values (
    p_logical_key, nullif(p_match_id, ''), p_content_type, v_revision, 'draft',
    btrim(p_caption), p_asset_path, p_asset_sha256, p_platforms, p_snapshot, auth.uid()
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.approve_santalbino_editorial_post(
  p_post_id uuid,
  p_expected_revision integer,
  p_scheduled_at timestamptz default null
)
returns public.santalbino_editorial_posts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.santalbino_editorial_posts%rowtype;
  v_latest integer;
begin
  if auth.uid() is null or not public.is_santalbino_admin() then
    raise exception 'SANTA Live admin required' using errcode = '42501';
  end if;

  select * into v_row from public.santalbino_editorial_posts where id = p_post_id for update;
  if not found or v_row.status <> 'draft' or v_row.revision <> p_expected_revision then
    raise exception 'stale or non-draft editorial revision' using errcode = '40001';
  end if;
  select max(revision) into v_latest from public.santalbino_editorial_posts where logical_key = v_row.logical_key;
  if v_latest <> p_expected_revision then
    raise exception 'a newer editorial revision exists' using errcode = '40001';
  end if;

  update public.santalbino_editorial_posts
     set status = case when p_scheduled_at is not null and p_scheduled_at > now() then 'scheduled' else 'approved' end,
         scheduled_at = p_scheduled_at,
         approved_by = auth.uid(),
         approved_at = now(),
         updated_at = now()
   where id = p_post_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.cancel_santalbino_editorial_post(p_post_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or not public.is_santalbino_admin() then
    raise exception 'SANTA Live admin required' using errcode = '42501';
  end if;
  update public.santalbino_editorial_posts
     set status = 'cancelled', updated_at = now()
   where id = p_post_id and status in ('draft', 'approved', 'scheduled');
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.claim_santalbino_editorial_queue(
  p_limit integer default 10,
  p_dispatch_enabled boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_post public.santalbino_editorial_posts%rowtype;
  v_token uuid;
  v_deliveries jsonb;
  v_claims jsonb := '[]'::jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'invalid queue claim limit' using errcode = '22023';
  end if;
  if not p_dispatch_enabled then
    return v_claims;
  end if;

  -- A stale worker may have reached Meta before crashing. Expiry therefore
  -- converts in-flight deliveries to unknown; it never creates an automatic retry.
  update public.santalbino_editorial_deliveries
     set status = 'unknown',
         last_error_safe = 'Lease scaduta: verificare il risultato remoto prima di riprovare.',
         claim_token = null,
         lease_expires_at = null,
         updated_at = now()
   where status = 'processing' and lease_expires_at <= now();

  update public.santalbino_editorial_posts
     set status = 'unknown',
         last_error_safe = 'Lease scaduta: riconciliazione richiesta.',
         claim_token = null,
         lease_expires_at = null,
         updated_at = now()
   where status = 'publishing' and lease_expires_at <= now();

  for v_post in
    select * from public.santalbino_editorial_posts
     where status in ('approved', 'scheduled', 'partial', 'failed')
       and (scheduled_at is null or scheduled_at <= now())
       and claim_token is null
     order by scheduled_at nulls first, created_at
     limit p_limit
     for update skip locked
  loop
    v_token := gen_random_uuid();
    update public.santalbino_editorial_posts
       set status = 'publishing',
           claim_token = v_token,
           lease_expires_at = now() + interval '5 minutes',
           attempt_count = attempt_count + 1,
           updated_at = now()
     where id = v_post.id
    returning * into v_post;

    insert into public.santalbino_editorial_deliveries (post_id, platform, status)
    select v_post.id, item.key, 'pending'
      from jsonb_each(v_post.platforms) as item
     where item.value = 'true'::jsonb
    on conflict (post_id, platform) do nothing;

    update public.santalbino_editorial_deliveries
       set status = 'processing',
           claim_token = v_token,
           lease_expires_at = now() + interval '5 minutes',
           attempt_count = attempt_count + 1,
           last_attempt_at = now(),
           updated_at = now()
     where post_id = v_post.id and status in ('pending', 'failed_retryable');

    select coalesce(jsonb_agg(to_jsonb(d) order by d.platform), '[]'::jsonb)
      into v_deliveries
      from public.santalbino_editorial_deliveries d
     where d.post_id = v_post.id and d.claim_token = v_token;

    if jsonb_array_length(v_deliveries) > 0 then
      v_claims := v_claims || jsonb_build_array(
        jsonb_build_object('post', to_jsonb(v_post), 'deliveries', v_deliveries)
      );
    else
      update public.santalbino_editorial_posts
         set status = 'unknown', claim_token = null, lease_expires_at = null,
             last_error_safe = 'Nessuna delivery idonea al claim; riconciliazione richiesta.',
             updated_at = now()
       where id = v_post.id;
    end if;
  end loop;

  return v_claims;
end;
$$;

create or replace function public.record_santalbino_editorial_container(
  p_post_id uuid,
  p_platform text,
  p_claim_token uuid,
  p_container_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_platform not in ('facebook', 'instagram') or p_container_id is null or length(p_container_id) > 300 then
    raise exception 'invalid external container' using errcode = '22023';
  end if;
  update public.santalbino_editorial_deliveries
     set external_container_id = p_container_id, updated_at = now()
   where post_id = p_post_id and platform = p_platform
     and claim_token = p_claim_token and status = 'processing';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.complete_santalbino_editorial_delivery(
  p_post_id uuid,
  p_platform text,
  p_claim_token uuid,
  p_status text,
  p_external_post_id text default null,
  p_error_safe text default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_post public.santalbino_editorial_posts%rowtype;
  v_processing boolean;
  v_unknown boolean;
  v_failed boolean;
  v_all_published boolean;
  v_new_status text;
  v_count integer;
begin
  if p_status not in ('published', 'failed_retryable', 'unknown')
     or p_platform not in ('facebook', 'instagram')
     or (p_status = 'published' and (p_external_post_id is null or length(p_external_post_id) > 300)) then
    raise exception 'invalid delivery completion' using errcode = '22023';
  end if;

  update public.santalbino_editorial_deliveries
     set status = p_status,
         external_post_id = case when p_status = 'published' then p_external_post_id else external_post_id end,
         last_error_safe = left(p_error_safe, 300),
         published_at = case when p_status = 'published' then now() else null end,
         claim_token = null,
         lease_expires_at = null,
         updated_at = now()
   where post_id = p_post_id and platform = p_platform
     and claim_token = p_claim_token and status = 'processing';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'stale editorial delivery claim' using errcode = '40001';
  end if;

  select * into v_post from public.santalbino_editorial_posts where id = p_post_id for update;
  if not found or v_post.claim_token is distinct from p_claim_token then
    raise exception 'stale editorial post claim' using errcode = '40001';
  end if;

  select
    coalesce(bool_or(status = 'processing'), false),
    coalesce(bool_or(status = 'unknown'), false),
    coalesce(bool_or(status = 'failed_retryable'), false),
    coalesce(bool_and(status = 'published'), false)
  into v_processing, v_unknown, v_failed, v_all_published
  from public.santalbino_editorial_deliveries
  where post_id = p_post_id;

  v_new_status := case
    when v_unknown then 'unknown'
    when v_processing then 'publishing'
    when v_all_published then 'published'
    when exists (select 1 from public.santalbino_editorial_deliveries where post_id = p_post_id and status = 'published') then 'partial'
    when v_failed then 'failed'
    else 'unknown'
  end;

  update public.santalbino_editorial_posts
     set status = v_new_status,
         published_at = case when v_new_status = 'published' then now() else null end,
         claim_token = case when v_processing then p_claim_token else null end,
         lease_expires_at = case when v_processing then lease_expires_at else null end,
         last_error_safe = left(p_error_safe, 300),
         updated_at = now()
   where id = p_post_id;

  return v_new_status;
end;
$$;

revoke all on function public.save_santalbino_editorial_draft(text,text,text,text,text,text,jsonb,jsonb) from public, anon;
grant execute on function public.save_santalbino_editorial_draft(text,text,text,text,text,text,jsonb,jsonb) to authenticated;
revoke all on function public.approve_santalbino_editorial_post(uuid,integer,timestamptz) from public, anon;
grant execute on function public.approve_santalbino_editorial_post(uuid,integer,timestamptz) to authenticated;
revoke all on function public.cancel_santalbino_editorial_post(uuid) from public, anon;
grant execute on function public.cancel_santalbino_editorial_post(uuid) to authenticated;

revoke all on function public.claim_santalbino_editorial_queue(integer,boolean) from public, anon, authenticated;
grant execute on function public.claim_santalbino_editorial_queue(integer,boolean) to service_role;
revoke all on function public.record_santalbino_editorial_container(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.record_santalbino_editorial_container(uuid,text,uuid,text) to service_role;
revoke all on function public.complete_santalbino_editorial_delivery(uuid,text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.complete_santalbino_editorial_delivery(uuid,text,uuid,text,text,text) to service_role;
