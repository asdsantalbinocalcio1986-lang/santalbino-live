-- SANTA Live · registrazione volontaria dei dispositivi e registro idempotente delle notifiche push.
begin;

create table if not exists public.santalbino_push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  match_id text,
  event_types text[] not null default array['kickoff','halftime','fulltime','goal']::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint santalbino_push_endpoint_https check (endpoint like 'https://%'),
  constraint santalbino_push_event_types_valid check (
    event_types <@ array['kickoff','halftime','fulltime','goal','yellow','red','sub','mvp']::text[]
  )
);

create index if not exists santalbino_push_subscriptions_event_types_idx
  on public.santalbino_push_subscriptions using gin (event_types);
create index if not exists santalbino_push_subscriptions_match_id_idx
  on public.santalbino_push_subscriptions (match_id);

create table if not exists public.santalbino_push_deliveries (
  event_id text primary key,
  event_type text not null,
  status text not null default 'queued'
    check (status in ('queued','sending','sent','no_subscribers','failed')),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.santalbino_push_subscriptions enable row level security;
alter table public.santalbino_push_deliveries enable row level security;

revoke all on table public.santalbino_push_subscriptions from public, anon, authenticated;
revoke all on table public.santalbino_push_deliveries from public, anon, authenticated;


create table if not exists public.santalbino_live_notifications (
  event_id text primary key,
  match_id text not null,
  event_type text not null,
  title text not null,
  body text not null,
  url text not null,
  created_at timestamptz not null default now()
);

alter table public.santalbino_live_notifications enable row level security;
revoke all on table public.santalbino_live_notifications from public, anon, authenticated;
grant select on table public.santalbino_live_notifications to anon, authenticated;
create policy "Public can read approved SANTA Live notifications"
  on public.santalbino_live_notifications for select to anon, authenticated
  using (true);

alter publication supabase_realtime add table public.santalbino_live_notifications;

commit;
