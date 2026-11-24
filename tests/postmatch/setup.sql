-- Disposable PostgreSQL fixtures for the post-match SQL proposal.
-- This is not a Supabase project and contains no production data.
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;

create table auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

create table public.santalbino_admins (
  user_id uuid primary key references auth.users(id)
);

alter table public.santalbino_admins enable row level security;
grant select on public.santalbino_admins to authenticated;
drop policy if exists "Admin can read own admin record" on public.santalbino_admins;
create policy "Admin can read own admin record"
  on public.santalbino_admins for select to authenticated
  using ((select auth.uid()) = user_id);

-- Match production: this helper is SECURITY INVOKER, not a definer function.
create or replace function public.is_santalbino_admin()
returns boolean
language sql
stable
set search_path = public, pg_temp
as 'select exists (select 1 from public.santalbino_admins where user_id = (select auth.uid()))';
grant execute on function public.is_santalbino_admin() to authenticated;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  unique (bucket_id, name)
);

grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant select, insert, update, delete on storage.buckets to authenticated;

insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.santalbino_admins(user_id)
values ('11111111-1111-4111-8111-111111111111');
