-- SANTALive — Fase 3: infrastruttura notifiche partita.
-- Script di setup da revisionare e applicare manualmente in ambiente di test.
-- NON abilita invii automatici: ogni push passa dall'azione esplicita della regia.

begin;

create table if not exists public.santalbino_notification_settings (
  match_key text primary key,
  enabled_categories text[] not null default array['kickoff','halftime','fulltime','goal','yellow_card','red_card','substitution','injury','mvp']::text[],
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint santalbino_notification_settings_categories_check check (
    enabled_categories <@ array[
      'kickoff','halftime','fulltime','goal',
      'yellow_card','red_card','substitution','injury','mvp'
    ]::text[]
  )
);

create table if not exists public.santalbino_notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  match_key text not null,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  subscription_token_hash text not null unique,
  enabled_categories text[] not null default array['kickoff','halftime','fulltime','goal']::text[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint santalbino_notification_subscriptions_categories_check check (
    enabled_categories <@ array[
      'kickoff','halftime','fulltime','goal',
      'yellow_card','red_card','substitution','injury','mvp'
    ]::text[]
  ),
  constraint santalbino_notification_subscriptions_endpoint_check check (endpoint like 'https://%'),
  constraint santalbino_notification_subscriptions_match_endpoint_key unique (match_key, endpoint)
);

create index if not exists santalbino_notification_subscriptions_match_active_idx
  on public.santalbino_notification_subscriptions(match_key, active)
  where active = true;

create table if not exists public.santalbino_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  match_key text not null,
  event_id text not null,
  category text not null check (category in (
    'kickoff','halftime','fulltime','goal',
    'yellow_card','red_card','substitution','injury','mvp'
  )),
  title text not null check (length(title) between 1 and 120),
  body text not null check (length(body) between 1 and 500),
  target_url text not null default '/',
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  status text not null default 'sending' check (status in ('sending','sent','sent_with_errors','failed')),
  recipient_count integer not null default 0,
  delivered_count integer not null default 0,
  failed_count integer not null default 0,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(match_key, event_id, category)
);

create index if not exists santalbino_notification_outbox_match_created_idx
  on public.santalbino_notification_outbox(match_key, created_at desc);

alter table public.santalbino_notification_settings enable row level security;
alter table public.santalbino_notification_subscriptions enable row level security;
alter table public.santalbino_notification_outbox enable row level security;

-- Le tabelle non sono API pubbliche: accesso esclusivamente tramite Edge Function
-- con service-role custodita lato server.
revoke all on table public.santalbino_notification_settings from public, anon, authenticated;
revoke all on table public.santalbino_notification_subscriptions from public, anon, authenticated;
revoke all on table public.santalbino_notification_outbox from public, anon, authenticated;
grant all on table public.santalbino_notification_settings to service_role;
grant all on table public.santalbino_notification_subscriptions to service_role;
grant all on table public.santalbino_notification_outbox to service_role;

commit;
