-- PROPOSAL ONLY — not applied to Supabase.
-- Foundation for persistent, versioned post-match editorial drafts.
-- Apply only after review and after creating a timestamped migration with the Supabase CLI.

create table if not exists public.santalbino_postmatch_editions (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('production', 'test')),
  match_id text not null check (match_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  revision integer not null check (revision > 0),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'superseded')),
  caption text not null check (char_length(caption) <= 10000),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'object'
    and pg_catalog.pg_column_size(snapshot) <= 65536
  ),
  source_state_rev bigint,
  graphic_path text not null,
  graphic_sha256 text not null check (graphic_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  unique (environment, match_id, revision),
  check (
    graphic_path like
      ('postmatch/' || environment || '/' || match_id || '/%')
  ),
  check (
    (status = 'approved' and approved_by is not null and approved_at is not null)
    or
    (status <> 'approved' and (
      (approved_by is null and approved_at is null)
      or (approved_by is not null and approved_at is not null)
    ))
  )
);

comment on column public.santalbino_postmatch_editions.environment is
  'Logical UI namespace only; not a security boundary when test and production share one Supabase project.';

create index if not exists santalbino_postmatch_editions_match_history_idx
  on public.santalbino_postmatch_editions (environment, match_id, revision desc);

create unique index if not exists santalbino_postmatch_one_draft_per_match_idx
  on public.santalbino_postmatch_editions (environment, match_id)
  where status = 'draft';

alter table public.santalbino_postmatch_editions enable row level security;
revoke all on public.santalbino_postmatch_editions from anon, authenticated;
grant select on public.santalbino_postmatch_editions to authenticated;
grant all on public.santalbino_postmatch_editions to service_role;

drop policy if exists "SANTA Live admins can read post-match editions"
  on public.santalbino_postmatch_editions;
create policy "SANTA Live admins can read post-match editions"
  on public.santalbino_postmatch_editions
  for select to authenticated
  using (public.is_santalbino_admin());

-- Keep approved/superseded revision content immutable, even if a future grant
-- accidentally allows direct UPDATE access.
create or replace function public.guard_santalbino_postmatch_edition_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'superseded' then
    raise exception 'Superseded post-match revisions are immutable';
  end if;

  if (
    new.environment is distinct from old.environment
    or new.match_id is distinct from old.match_id
    or new.revision is distinct from old.revision
    or new.caption is distinct from old.caption
    or new.snapshot is distinct from old.snapshot
    or new.source_state_rev is distinct from old.source_state_rev
    or new.graphic_path is distinct from old.graphic_path
    or new.graphic_sha256 is distinct from old.graphic_sha256
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Post-match revision content is immutable';
  end if;

  if (new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at)
     and not (
       old.status = 'draft' and new.status = 'approved'
       and new.approved_by is not null and new.approved_at is not null
     ) then
    raise exception 'Approval metadata can only be set when approving a draft';
  end if;

  if old.status = 'approved' and new.status <> 'superseded' then
    raise exception 'An approved revision can only be superseded';
  end if;

  if old.status = 'draft' and new.status not in ('draft', 'approved', 'superseded') then
    raise exception 'Invalid post-match revision transition';
  end if;

  return new;
end;
$$;

drop trigger if exists santalbino_postmatch_edition_immutable
  on public.santalbino_postmatch_editions;
create trigger santalbino_postmatch_edition_immutable
before update on public.santalbino_postmatch_editions
for each row execute function public.guard_santalbino_postmatch_edition_update();

-- One call creates a new revision and supersedes the previous unapproved draft.
-- The graphic must already have been uploaded to the private bucket.
create or replace function public.save_santalbino_postmatch_revision(
  p_environment text,
  p_match_id text,
  p_caption text,
  p_snapshot jsonb,
  p_source_state_rev bigint,
  p_graphic_path text,
  p_graphic_sha256 text
)
returns table (id uuid, revision integer, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision integer;
begin
  if auth.uid() is null or not public.is_santalbino_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_environment is null
     or p_environment not in ('production', 'test')
     or p_match_id is null
     or p_match_id !~ '^[A-Za-z0-9_-]{1,120}$'
     or p_caption is null
     or char_length(p_caption) > 10000
     or p_snapshot is null
     or jsonb_typeof(p_snapshot) <> 'object'
     or pg_catalog.pg_column_size(p_snapshot) > 65536
     or p_graphic_path is null
     or p_graphic_path not like ('postmatch/' || p_environment || '/' || p_match_id || '/%')
     or p_graphic_sha256 is null
     or p_graphic_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'Invalid post-match revision payload' using errcode = '22023';
  end if;

  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'santalbino-postmatch'
       and o.name = p_graphic_path
  ) then
    raise exception 'Post-match graphic object not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_environment || ':' || p_match_id, 0));

  update public.santalbino_postmatch_editions e
     set status = 'superseded'
   where e.environment = p_environment
     and e.match_id = p_match_id
     and e.status = 'draft';

  select coalesce(max(e.revision), 0) + 1
    into v_revision
    from public.santalbino_postmatch_editions e
   where e.environment = p_environment
     and e.match_id = p_match_id;

  return query
  insert into public.santalbino_postmatch_editions (
    environment, match_id, revision, status, caption, snapshot,
    source_state_rev, graphic_path, graphic_sha256, created_by
  )
  values (
    p_environment, p_match_id, v_revision, 'draft', p_caption, p_snapshot,
    p_source_state_rev, p_graphic_path, p_graphic_sha256, auth.uid()
  )
  returning santalbino_postmatch_editions.id,
            santalbino_postmatch_editions.revision,
            santalbino_postmatch_editions.status;
end;
$$;

-- Approval is bound to the exact current draft revision; it never regenerates
-- the caption, snapshot, or image.
create or replace function public.approve_santalbino_postmatch_revision(
  p_id uuid,
  p_expected_revision integer
)
returns table (id uuid, revision integer, status text, approved_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_environment text;
  v_match_id text;
  v_current_revision integer;
begin
  if auth.uid() is null or not public.is_santalbino_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select e.environment, e.match_id
    into v_environment, v_match_id
    from public.santalbino_postmatch_editions e
   where e.id = p_id;

  if not found then
    raise exception 'Post-match revision not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(v_environment || ':' || v_match_id, 0));

  perform 1
    from public.santalbino_postmatch_editions e
   where e.id = p_id
   for update;

  if not found then
    raise exception 'Post-match revision not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'santalbino-postmatch'
       and o.name = (
         select e.graphic_path from public.santalbino_postmatch_editions e where e.id = p_id
       )
  ) then
    raise exception 'Post-match graphic object not found' using errcode = 'P0002';
  end if;

  select max(e.revision)
    into v_current_revision
    from public.santalbino_postmatch_editions e
   where e.environment = v_environment
     and e.match_id = v_match_id
     and e.status = 'draft';

  if v_current_revision is distinct from p_expected_revision then
    raise exception 'Post-match draft changed; reload before approval' using errcode = '40001';
  end if;

  update public.santalbino_postmatch_editions e
     set status = 'superseded'
   where e.environment = v_environment
     and e.match_id = v_match_id
     and e.status = 'approved';

  return query
  update public.santalbino_postmatch_editions e
     set status = 'approved',
         approved_at = now(),
         approved_by = auth.uid()
   where e.id = p_id
     and e.revision = p_expected_revision
     and e.status = 'draft'
  returning e.id, e.revision, e.status, e.approved_at;

  if not found then
    raise exception 'Only the current draft can be approved' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.save_santalbino_postmatch_revision(text, text, text, jsonb, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.save_santalbino_postmatch_revision(text, text, text, jsonb, bigint, text, text)
  to authenticated;

revoke all on function public.approve_santalbino_postmatch_revision(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.approve_santalbino_postmatch_revision(uuid, integer)
  to authenticated;

-- Dedicated private bucket: draft graphics are not publicly addressable.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('santalbino-postmatch', 'santalbino-postmatch', false, 8388608, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "SANTA Live admins can read post-match graphics" on storage.objects;
create policy "SANTA Live admins can read post-match graphics"
  on storage.objects for select to authenticated
  using (bucket_id = 'santalbino-postmatch' and public.is_santalbino_admin());

drop policy if exists "SANTA Live admins can upload post-match graphics" on storage.objects;
create policy "SANTA Live admins can upload post-match graphics"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'santalbino-postmatch' and public.is_santalbino_admin());

-- Graphic bytes are immutable once uploaded. Revisions use unique object paths;
-- do not permit replacing an image after its SHA-256 has been recorded.
drop policy if exists "SANTA Live admins can update post-match graphics" on storage.objects;

-- Failed saves may clean up an orphan upload, but a referenced graphic can
-- never be deleted (including after editorial approval).
drop policy if exists "SANTA Live admins can delete post-match graphics" on storage.objects;
create policy "SANTA Live admins can delete unreferenced post-match graphics"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'santalbino-postmatch'
    and public.is_santalbino_admin()
    and not exists (
      select 1
        from public.santalbino_postmatch_editions e
       where e.graphic_path = storage.objects.name
    )
  );

