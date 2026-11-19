-- SANTA Live: contatore pubblico visite/installazioni con lettura riservata alla regia.
-- La funzione pubblica accetta solo due tipi di evento e non raccoglie IP o dati personali.
create table if not exists public.santalbino_analytics_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('visit', 'download')),
  page text not null check (page in ('home', 'match', 'pwa')),
  created_at timestamptz not null default now(),
  constraint santalbino_analytics_event_page_check check (
    (event_type = 'visit' and page in ('home', 'match'))
    or (event_type = 'download' and page = 'pwa')
  )
);
create index if not exists santalbino_analytics_events_type_created_idx
  on public.santalbino_analytics_events (event_type, created_at desc);
alter table public.santalbino_analytics_events enable row level security;
drop policy if exists "Only SantAlbino admins can read analytics" on public.santalbino_analytics_events;
create policy "Only SantAlbino admins can read analytics"
  on public.santalbino_analytics_events for select to authenticated
  using (public.is_santalbino_admin());
revoke all on table public.santalbino_analytics_events from anon, authenticated;
grant select on table public.santalbino_analytics_events to authenticated;
create or replace function public.track_santalbino_analytics(p_event_type text, p_page text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_event_type not in ('visit', 'download')
     or p_page not in ('home', 'match', 'pwa')
     or (p_event_type = 'visit' and p_page not in ('home', 'match'))
     or (p_event_type = 'download' and p_page <> 'pwa') then
    raise exception 'Evento analytics non valido';
  end if;
  insert into public.santalbino_analytics_events (event_type, page)
  values (p_event_type, p_page);
end;
$$;
revoke all on function public.track_santalbino_analytics(text, text) from public, anon, authenticated;
grant execute on function public.track_santalbino_analytics(text, text) to anon, authenticated;
