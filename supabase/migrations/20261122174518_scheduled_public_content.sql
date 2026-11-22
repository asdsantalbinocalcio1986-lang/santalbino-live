create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create or replace function public.publish_santalbino_scheduled_content()
returns integer
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  published_count integer := 0;
  changed_count integer := 0;
begin
  update public.live_state
  set state = jsonb_set(
        jsonb_set(
          state,
          '{publication}',
          coalesce(state->'publication', '{}'::jsonb) ||
            jsonb_build_object(
              'published', state #> '{publication,pending,content}',
              'pending', null,
              'publishedAt', clock_timestamp()::text
            ),
          true
        ),
        '{rev}',
        to_jsonb(coalesce(nullif(state->>'rev', '')::bigint, 0) + 1),
        true
      ),
      updated_at = now()
  where id = 1
    and state #>> '{publication,pending,status}' = 'scheduled'
    and (state #>> '{publication,pending,scheduledAt}')::timestamptz <= now()
    and state #> '{publication,pending,content}' is not null;
  get diagnostics changed_count = row_count;
  published_count := published_count + changed_count;

  update public.live_test_state
  set state = jsonb_set(
        jsonb_set(
          state,
          '{publication}',
          coalesce(state->'publication', '{}'::jsonb) ||
            jsonb_build_object(
              'published', state #> '{publication,pending,content}',
              'pending', null,
              'publishedAt', clock_timestamp()::text
            ),
          true
        ),
        '{rev}',
        to_jsonb(coalesce(nullif(state->>'rev', '')::bigint, 0) + 1),
        true
      ),
      updated_at = now()
  where id = 1
    and state #>> '{publication,pending,status}' = 'scheduled'
    and (state #>> '{publication,pending,scheduledAt}')::timestamptz <= now()
    and state #> '{publication,pending,content}' is not null;
  get diagnostics changed_count = row_count;
  published_count := published_count + changed_count;

  return published_count;
end;
$$;

revoke all on function public.publish_santalbino_scheduled_content() from public, anon, authenticated;
grant execute on function public.publish_santalbino_scheduled_content() to postgres;

select cron.schedule(
  'santalbino-publish-scheduled-content',
  '* * * * *',
  'select public.publish_santalbino_scheduled_content();'
);