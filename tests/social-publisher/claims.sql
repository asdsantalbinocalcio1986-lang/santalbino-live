-- Atomic claim, retry gating and stale-worker fencing.
-- Run only against an ephemeral local Supabase/PostgreSQL database.
\set ON_ERROR_STOP on

do $test$
declare
  v_first jsonb;
  v_second jsonb;
  v_third jsonb;
  v_fourth jsonb;
  v_id uuid;
  v_old_token uuid;
  v_new_token uuid;
  v_rows integer;
  v_event text := 'publisher-claim-test-' || gen_random_uuid()::text;
  v_event2 text := 'publisher-platform-expansion-' || gen_random_uuid()::text;
  v_expansion jsonb;
begin
  v_first := public.claim_santalbino_social_publication(
    v_event, 'local-test', 'goal', 'Test caption', 'https://example.test/test.jpg',
    '{"facebook":true,"instagram":false}'::jsonb
  );
  if v_first ->> 'result' <> 'claimed' then
    raise exception 'First claim did not win: %', v_first;
  end if;
  v_id := (v_first ->> 'id')::uuid;
  v_old_token := (v_first ->> 'claim_token')::uuid;

  v_second := public.claim_santalbino_social_publication(
    v_event, 'local-test', 'goal', 'Test caption', 'https://example.test/test.jpg',
    '{"facebook":true,"instagram":false}'::jsonb
  );
  if v_second ->> 'result' <> 'reconciliation_required' then
    raise exception 'Concurrent/repeated claim was not blocked: %', v_second;
  end if;

  -- Simulate a response explicitly rejected by Meta: only this state is retryable.
  update public.santalbino_social_publications
     set facebook_status = 'failed_retryable',
         overall_status = 'failed',
         claim_token = null,
         lease_expires_at = null
   where id = v_id;

  v_third := public.claim_santalbino_social_publication(
    v_event, 'local-test', 'goal', 'Test caption', 'https://example.test/test.jpg',
    '{"facebook":true,"instagram":false}'::jsonb
  );
  if v_third ->> 'result' <> 'claimed' then
    raise exception 'Known rejection could not be retried: %', v_third;
  end if;
  v_new_token := (v_third ->> 'claim_token')::uuid;

  -- A worker holding an obsolete token must not be able to write.
  update public.santalbino_social_publications
     set facebook_status = 'published'
   where id = v_id and claim_token = v_old_token;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'A stale claim token modified the publication row';
  end if;

  -- A remote outcome that cannot be determined must never be retried automatically.
  update public.santalbino_social_publications
     set facebook_status = 'unknown',
         overall_status = 'reconciliation_required',
         claim_token = null,
         lease_expires_at = null
   where id = v_id and claim_token = v_new_token;

  v_fourth := public.claim_santalbino_social_publication(
    v_event, 'local-test', 'goal', 'Test caption', 'https://example.test/test.jpg',
    '{"facebook":true,"instagram":false}'::jsonb
  );
  if v_fourth ->> 'result' <> 'reconciliation_required' then
    raise exception 'Unknown remote outcome was incorrectly retried: %', v_fourth;
  end if;

  delete from public.santalbino_social_publications where id = v_id;

  -- A previously completed Facebook-only event may later enable Instagram.
  v_expansion := public.claim_santalbino_social_publication(
    v_event2, 'local-test', 'goal', 'Platform expansion test', 'https://example.test/expand.jpg',
    '{"facebook":true,"instagram":false}'::jsonb
  );
  if v_expansion ->> 'result' <> 'claimed' then
    raise exception 'Initial Facebook-only claim failed: %', v_expansion;
  end if;
  v_id := (v_expansion ->> 'id')::uuid;
  v_old_token := (v_expansion ->> 'claim_token')::uuid;
  update public.santalbino_social_publications
     set facebook_status = 'published',
         instagram_status = 'skipped',
         overall_status = 'published',
         claim_token = null,
         lease_expires_at = null
   where id = v_id and claim_token = v_old_token;

  v_expansion := public.claim_santalbino_social_publication(
    v_event2, 'local-test', 'goal', 'Platform expansion test', 'https://example.test/expand.jpg',
    '{"facebook":true,"instagram":true}'::jsonb
  );
  if v_expansion ->> 'result' <> 'claimed'
     or v_expansion #>> '{row,facebook_status}' <> 'published'
     or v_expansion #>> '{row,instagram_status}' <> 'processing' then
    raise exception 'New Instagram target was not safely claimed while preserving Facebook: %', v_expansion;
  end if;
  delete from public.santalbino_social_publications where id = (v_expansion ->> 'id')::uuid;
end
$test$;

select 'Social publisher claim integration tests passed' as result;
