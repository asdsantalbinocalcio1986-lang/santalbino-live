-- Minimal legacy publisher table fixture for the additive claim-hardening migration.
-- Run only after tests/postmatch/setup.sql in disposable PostgreSQL.
create table public.santalbino_social_publications (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  match_id text,
  event_type text not null,
  caption text not null,
  image_url text not null,
  platforms jsonb not null,
  overall_status text not null default 'processing'
    check (overall_status in ('processing', 'published', 'partial', 'failed')),
  facebook_status text not null default 'pending'
    check (facebook_status in ('pending', 'processing', 'published', 'failed', 'skipped')),
  instagram_status text not null default 'pending'
    check (instagram_status in ('pending', 'processing', 'published', 'failed', 'skipped')),
  facebook_error text,
  instagram_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.santalbino_social_publications enable row level security;
revoke all on public.santalbino_social_publications from anon, authenticated;
grant select on public.santalbino_social_publications to authenticated;
grant all on public.santalbino_social_publications to service_role;

drop policy if exists "SANTA Live admins can read social publications" on public.santalbino_social_publications;
create policy "SANTA Live admins can read social publications"
  on public.santalbino_social_publications for select to authenticated
  using (public.is_santalbino_admin());
