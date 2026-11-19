-- Riduce ulteriormente i privilegi: la RPC opera come SECURITY INVOKER.
-- Gli anonimi possono soltanto inserire eventi con le combinazioni ammesse da RLS.
drop policy if exists "Public can submit valid analytics events" on public.santalbino_analytics_events;
create policy "Public can submit valid analytics events"
  on public.santalbino_analytics_events
  for insert to anon, authenticated
  with check (
    (event_type = 'visit' and page in ('home', 'match'))
    or (event_type = 'download' and page = 'pwa')
  );
grant insert on table public.santalbino_analytics_events to anon, authenticated;
alter function public.track_santalbino_analytics(text, text) security invoker;
