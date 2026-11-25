-- Atomic claim, retry gating and stale-worker fencing.
-- Run only against an ephemeral local Supabase/PostgreSQL database.
\set ON_ERROR_STOP on

do $test$
declare
  v_first jsonb;
  v_second jsonb;
  v_expired jsonb;
  v_third jsonb;
  v_fourth jsonb;
  v_id uuid;
  v_old_token uuid;
  v_new_token uuid;
  v_rows integer;
  v_event text := 'publisher-claim-test-' || gen_random_uuid()::text;
  v_event2 text := 'publisher-platform-expansion-' || gen_random_uuid()::text;
  v_expansion jsonb;
  v_missing jsonb;
  v_event3 text := 'publisher-missing-claim-test-' || gen_random_uuid()::text;
begin
  -- The RPC must reject NULL event types and non-boolean platform values
  -- with the documented validation SQLSTATE.
  begin
    perform public.claim_santalbino_social_publication(
      'publisher-invalid-' || gen_random_uuid()::text, 'local-test', null,
      'Invalid event type', 'https://example.test/invalid.jpg',
      '{"facebook":true,"instagram":false}'::jsonb
    );
    raise exception 'NULL event type was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.claim_santalbino_social_publication(
      'publisher-invalid-' || gen_random_uuid()::text, 'local-test', 'goal',
      'Invalid platform type', 'https://example.test/invalid.jpg',
      '{"facebook":"true","instagram":false}'::jsonb
    );
    raise exception 'Non-boolean platform value was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  if (select p.prosecdef
        from pg_catalog.pg_proc p
       where p.oid = 'public.claim_santalbino_social_publication(text,text,text,text,text,jsonb)'::regprocedure) then
    raise exception 'Claim RPC must run as invoker, not security definer';
  end if;

  if has_function_privilege('anon',
       'public.claim_santalbino_social_publication(text,text,text,text,text,jsonb)',
       'EXECUTE') then
    raise exception 'anon must not execute the privileged claim RPC';
  end if;
  if has_function_privilege('authenticated',
       'public.claim_santalbino_social_publication(text,text,text,text,text,jsonb)',
       'EXECUTE') then
    raise exception 'authenticated must not execute the privileged claim RPC';
  end if;
  if not has_function_privilege('service_role',
       'public.claim_santalbino_social_publication(text,text,text,text,text,jsonb)',
       'EXECUTE') then
    raise exception 'service_role must execute the privileged claim RPC';
  end if;
  if has_table_privilege('anon', 'public.santalbino_social_publications', 'SELECT') then
    raise exception 'anon must not read the social publication log';
  end if;
  if not has_table_privilege('authenticated', 'public.santalbino_social_publications', 'SELECT') then
    raise exception 'authenticated role needs SELECT grant for the admin-only RLS policy';
  end if;
  if has_table_privilege('authenticated', 'public.santalbino_social_publications', 'INSERT') then
    raise exception 'authenticated must not write social publication records';
  end if;
  if not has_table_privilege('service_role', 'public.santalbino_social_publications', 'INSERT') then
    raise exception 'service_role must write social publication records';
  end if;

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
  if v_second ->> 'result' <> 'processing' then
    raise exception 'An active claim was not reported as processing: %', v_second;
  end if;

  -- An abandoned worker must be fenced after its lease expires. Its in-flight
  -- platform outcome becomes unknown and must never be retried automatically.
  update public.santalbino_social_publications
     set lease_expires_at = now() - interval '1 second'
   where id = v_id and claim_token = v_old_token;

  v_expired := public.claim_santalbino_social_publication(
    v_event, 'local-test', 'goal', 'Test caption', 'https://example.test/test.jpg',
    '{"facebook":true,"instagram":false}'::jsonb
  );
  if v_expired ->> 'result' <> 'reconciliation_required'
     or v_expired #>> '{row,facebook_status}' <> 'unknown'
     or v_expired #>> '{row,overall_status}' <> 'reconciliation_required'
     or v_expired #>> '{row,claim_token}' is not null then
    raise exception 'Expired claim was not safely fenced for reconciliation: %', v_expired;
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

  -- A processing row without a fencing token must be durably moved to unknown.
  v_missing := public.claim_santalbino_social_publication(
    v_event3, 'local-test', 'goal', 'Missing claim token test', 'https://example.test/missing.jpg',
    '{"facebook":true,"instagram":false}'::jsonb
  );
  if v_missing ->> 'result' <> 'claimed' then
    raise exception 'Initial claim for missing-token fixture failed: %', v_missing;
  end if;
  v_id := (v_missing ->> 'id')::uuid;
  update public.santalbino_social_publications
     set claim_token = null, lease_expires_at = null
   where id = v_id;
  v_missing := public.claim_santalbino_social_publication(
    v_event3, 'local-test', 'goal', 'Missing claim token test', 'https://example.test/missing.jpg',
    '{"facebook":true,"instagram":false}'::jsonb
  );
  if v_missing ->> 'result' <> 'reconciliation_required'
     or v_missing #>> '{row,facebook_status}' <> 'unknown'
     or v_missing #>> '{row,overall_status}' <> 'reconciliation_required'
     or v_missing #>> '{row,claim_token}' is not null then
    raise exception 'Processing row without a fencing token was not durably reconciled: %', v_missing;
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
