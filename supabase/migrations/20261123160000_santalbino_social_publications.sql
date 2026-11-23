-- Registro idempotente delle pubblicazioni automatiche Facebook/Instagram.
-- Nessun contenuto viene pubblicato da questa migrazione: la tabella resta vuota.

create table if not exists public.santalbino_social_publications (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  match_id text,
  event_type text not null check (event_type in ('goal', 'red', 'halftime', 'fulltime')),
  caption text not null,
  image_url text not null,
  platforms jsonb not null default '{"facebook": true, "instagram": true}'::jsonb,
  overall_status text not null default 'processing'
    check (overall_status in ('processing', 'published', 'partial', 'failed')),
  facebook_status text not null default 'pending'
    check (facebook_status in ('pending', 'processing', 'published', 'failed', 'skipped')),
  instagram_status text not null default 'pending'
    check (instagram_status in ('pending', 'processing', 'published', 'failed', 'skipped')),
  facebook_post_id text,
  instagram_container_id text,
  instagram_media_id text,
  facebook_error text,
  instagram_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists santalbino_social_publications_created_at_idx
  on public.santalbino_social_publications (created_at desc);

alter table public.santalbino_social_publications enable row level security;

revoke all on public.santalbino_social_publications from anon, authenticated;
grant select on public.santalbino_social_publications to authenticated;
grant all on public.santalbino_social_publications to service_role;

drop policy if exists "Only SANTA Live admin can read social publication log"
  on public.santalbino_social_publications;

create policy "Only SANTA Live admin can read social publication log"
  on public.santalbino_social_publications
  for select
  to authenticated
  using (public.is_santalbino_admin());
