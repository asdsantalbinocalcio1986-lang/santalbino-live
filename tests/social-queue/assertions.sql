-- Run only against the disposable PostgreSQL fixtures from tests/postmatch/setup.sql.
\set ON_ERROR_STOP on

set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set role authenticated;

do $admin_tests$
declare
  v_first public.santalbino_editorial_posts%rowtype;
  v_second public.santalbino_editorial_posts%rowtype;
  v_third public.santalbino_editorial_posts%rowtype;
  v_queue public.santalbino_editorial_posts%rowtype;
  v_retry public.santalbino_editorial_posts%rowtype;
  v_approved_old public.santalbino_editorial_posts%rowtype;
  v_approved_new public.santalbino_editorial_posts%rowtype;
  v_exhausted public.santalbino_editorial_posts%rowtype;
  v_permanent public.santalbino_editorial_posts%rowtype;
  v_mixed public.santalbino_editorial_posts%rowtype;
  v_count integer;
begin
  if (select public from storage.buckets where id = 'santalbino-editorial') is distinct from false then
    raise exception 'Editorial Storage bucket must be private';
  end if;
  insert into storage.objects (bucket_id, name)
  values ('santalbino-editorial', 'social-editorial/test/admin-upload.jpg');

  select * into v_first from public.save_santalbino_editorial_draft(
    'match:ci-match:match_day', 'match_day', 'ci-match',
    'Prima bozza editoriale', 'social-editorial/test/match-day-r1.jpg',
    repeat('a', 64), '{"facebook":true,"instagram":true}'::jsonb,
    '{"score":"0-0","teams":["Sant’Albino","Test FC"]}'::jsonb
  );
  if v_first.revision <> 1 or v_first.status <> 'draft' then
    raise exception 'First editorial draft was not created as revision 1: %', row_to_json(v_first);
  end if;

  begin
    perform public.save_santalbino_editorial_draft(
      'match:ci-match:bad-platform:custom', 'custom', 'ci-match',
      'Invalid platform test', 'social-editorial/test/invalid.jpg', repeat('9', 64),
      '{"facebook":true,"tiktok":true}'::jsonb, '{}'::jsonb
    );
    raise exception 'Unsupported editorial platform was unexpectedly accepted';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.save_santalbino_editorial_draft(
      'match:ci-match:bad-instagram-image:custom', 'custom', 'ci-match',
      'Invalid Instagram image test', 'social-editorial/test/invalid.png', repeat('8', 64),
      '{"instagram":true}'::jsonb, '{}'::jsonb
    );
    raise exception 'Non-JPEG Instagram image was unexpectedly accepted';
  exception when sqlstate '22023' then null;
  end;

  select * into v_second from public.save_santalbino_editorial_draft(
    'match:ci-match:match_day', 'match_day', 'ci-match',
    'Seconda bozza editoriale', 'social-editorial/test/match-day-r2.jpg',
    repeat('b', 64), '{"facebook":true,"instagram":false}'::jsonb,
    '{"score":"1-0","teams":["Sant’Albino","Test FC"],"match":{"date":"2099-12-31","time":"18:00"}}'::jsonb
  );
  if v_second.revision <> 2 or v_second.status <> 'draft' then
    raise exception 'Second editorial draft was not revision 2: %', row_to_json(v_second);
  end if;

  insert into storage.objects (bucket_id, name)
  values ('santalbino-editorial', v_second.asset_path);
  delete from storage.objects
   where bucket_id = 'santalbino-editorial' and name = v_second.asset_path;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'An editorial asset referenced by a revision was deleted';
  end if;
  if (select status from public.santalbino_editorial_posts where id = v_first.id) <> 'superseded' then
    raise exception 'Saving a new draft did not supersede the previous unapproved draft';
  end if;

  select * into v_second from public.approve_santalbino_editorial_post(v_second.id, 2, now() - interval '1 minute');
  if v_second.status <> 'approved' or v_second.approved_by <> auth.uid() then
    raise exception 'Human approval was not recorded correctly: %', row_to_json(v_second);
  end if;

  begin
    update public.santalbino_editorial_posts
       set caption = 'Modified after approval'
     where id = v_second.id;
    raise exception 'Approved caption was unexpectedly mutable';
  exception when insufficient_privilege then
    null;
  end;

  if has_table_privilege('authenticated', 'public.santalbino_editorial_posts', 'INSERT')
     or has_table_privilege('authenticated', 'public.santalbino_editorial_posts', 'UPDATE') then
    raise exception 'Authenticated role still has direct editorial write privileges';
  end if;
  begin
    insert into public.santalbino_editorial_posts (
      logical_key, content_type, revision, caption, asset_path, asset_sha256,
      platforms, snapshot, created_by
    ) values (
      'direct:insert:test', 'custom', 1, 'Direct insert', 'social-editorial/test/direct.jpg',
      repeat('f', 64), '{"facebook":true}'::jsonb, '{}'::jsonb, auth.uid()
    );
    raise exception 'Authenticated role unexpectedly inserted an editorial post directly';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.approve_santalbino_editorial_post(v_first.id, 1, null);
    raise exception 'Superseded revision was unexpectedly approved';
  exception when sqlstate '40001' then
    null;
  end;

  if not public.cancel_santalbino_editorial_post(v_second.id) then
    raise exception 'Approved editorial revision could not be cancelled before worker claim';
  end if;

  select * into v_third from public.save_santalbino_editorial_draft(
    'match:ci-match:match_day', 'match_day', 'ci-match',
    'Terza bozza editoriale', 'social-editorial/test/match-day-r3.jpg',
    repeat('c', 64), '{"facebook":true,"instagram":false}'::jsonb,
    '{"score":"2-0","teams":["Sant’Albino","Test FC"],"match":{"date":"2099-12-31","time":"18:00"}}'::jsonb
  );
  select * into v_third from public.approve_santalbino_editorial_post(
    v_third.id, 3, now() + interval '1 day'
  );
  if v_third.status <> 'scheduled' or v_third.timezone <> 'Europe/Rome' then
    raise exception 'Future editorial post was not scheduled in Europe/Rome: %', row_to_json(v_third);
  end if;
  if not public.cancel_santalbino_editorial_post(v_third.id) then
    raise exception 'Scheduled editorial post could not be cancelled before claim';
  end if;

  select * into v_approved_old from public.save_santalbino_editorial_draft(
    'match:ci-match:approved-revision:custom', 'custom', 'ci-match',
    'Revisione approvata precedente', 'social-editorial/test/approved-r1.jpg',
    repeat('1', 64), '{"facebook":true}'::jsonb, '{"revision":1}'::jsonb
  );
  select * into v_approved_old from public.approve_santalbino_editorial_post(v_approved_old.id, 1, null);
  if v_approved_old.status <> 'approved' then
    raise exception 'Expected first approved revision before replacement';
  end if;
  select * into v_approved_new from public.save_santalbino_editorial_draft(
    'match:ci-match:approved-revision:custom', 'custom', 'ci-match',
    'Revisione aggiornata', 'social-editorial/test/approved-r2.jpg',
    repeat('2', 64), '{"facebook":true}'::jsonb, '{"revision":2}'::jsonb
  );
  if (select status from public.santalbino_editorial_posts where id = v_approved_old.id) <> 'superseded'
     or v_approved_new.revision <> 2 then
    raise exception 'A newly saved revision did not supersede the previous unclaimed approved revision';
  end if;

  select * into v_queue from public.save_santalbino_editorial_draft(
    'match:ci-match:post_match', 'post_match', 'ci-match',
    'Post partita approvato', 'social-editorial/test/post-match.jpg',
    repeat('d', 64), '{"facebook":true,"instagram":true}'::jsonb,
    jsonb_build_object('score', '2-0', 'scorers', jsonb_build_array('Rossi'), 'clock', jsonb_build_object('phase', 'ft', 'finishedAt', (extract(epoch from (now() - interval '1 hour')) * 1000)::bigint))
  );
  select * into v_queue from public.approve_santalbino_editorial_post(v_queue.id, 1, now() - interval '1 minute');

  select * into v_retry from public.save_santalbino_editorial_draft(
    'match:ci-match:retry_notice:club_notice', 'club_notice', null,
    'Avviso con retry controllato', 'social-editorial/test/retry-notice.jpg',
    repeat('e', 64), '{"facebook":true,"instagram":false}'::jsonb,
    '{"kind":"retry-test"}'::jsonb
  );
  select * into v_retry from public.approve_santalbino_editorial_post(v_retry.id, 1, now() + interval '1 hour');

  select * into v_exhausted from public.save_santalbino_editorial_draft(
    'match:ci-match:retry-limit:club_notice', 'club_notice', null,
    'Avviso con limite tentativi', 'social-editorial/test/retry-limit.jpg',
    repeat('3', 64), '{"facebook":true}'::jsonb, '{"kind":"retry-limit"}'::jsonb
  );
  select * into v_exhausted from public.approve_santalbino_editorial_post(v_exhausted.id, 1, now() + interval '1 hour');

  select * into v_permanent from public.save_santalbino_editorial_draft(
    'match:ci-match:permanent-error:club_notice', 'club_notice', null,
    'Avviso con rifiuto permanente Meta', 'social-editorial/test/permanent-error.jpg',
    repeat('4', 64), '{"facebook":true}'::jsonb, '{"kind":"permanent-error"}'::jsonb
  );
  select * into v_permanent from public.approve_santalbino_editorial_post(v_permanent.id, 1, now() + interval '1 hour');

  select * into v_mixed from public.save_santalbino_editorial_draft(
    'match:ci-match:mixed-retry-cap:club_notice', 'club_notice', null,
    'Avviso con una piattaforma esaurita', 'social-editorial/test/mixed-retry-cap.jpg',
    repeat('5', 64), '{"facebook":true,"instagram":true}'::jsonb, '{"kind":"mixed-retry-cap"}'::jsonb
  );
  select * into v_mixed from public.approve_santalbino_editorial_post(v_mixed.id, 1, now() + interval '1 hour');
end
$admin_tests$;

reset role;
set role service_role;

do $worker_tests$
declare
  v_claims jsonb;
  v_post_id uuid;
  v_token uuid;
  v_status text;
  v_retry_id uuid;
  v_retry_token uuid;
  v_exhausted_id uuid;
  v_exhausted_token uuid;
  v_permanent_id uuid;
  v_permanent_token uuid;
  v_mixed_id uuid;
  v_mixed_token uuid;
begin
  begin
    insert into public.santalbino_editorial_posts (
      logical_key, content_type, revision, caption, asset_path, asset_sha256,
      platforms, snapshot, created_by
    ) values (
      'worker:invalid-platform:custom', 'custom', 1, 'Invalid platform',
      'social-editorial/test/invalid.jpg', repeat('7', 64),
      '{"facebook":true,"tiktok":true}'::jsonb, '{}'::jsonb, '11111111-1111-4111-8111-111111111111'::uuid
    );
    raise exception 'Unsupported platform key bypassed the table constraint';
  exception when check_violation then null;
  end;

  v_claims := public.claim_santalbino_editorial_queue(5, false);
  if jsonb_array_length(v_claims) <> 0 then
    raise exception 'Queue dispatch kill switch did not block claims';
  end if;

  v_claims := public.claim_santalbino_editorial_queue(5, true);
  if jsonb_array_length(v_claims) <> 1 then
    raise exception 'Expected one due editorial post to be claimed: %', v_claims;
  end if;
  v_post_id := (v_claims -> 0 -> 'post' ->> 'id')::uuid;
  v_token := (v_claims -> 0 -> 'post' ->> 'claim_token')::uuid;
  if not public.renew_santalbino_editorial_claim(v_post_id, v_token) then
    raise exception 'Active editorial claim could not be renewed';
  end if;

  if (select count(*) from public.santalbino_editorial_deliveries
       where post_id = v_post_id and status = 'processing') <> 2 then
    raise exception 'Both selected platform deliveries were not claimed';
  end if;

  if not public.record_santalbino_editorial_container(v_post_id, 'instagram', v_token, 'mock-container-123') then
    raise exception 'Instagram container ID was not persisted under the active claim';
  end if;

  v_status := public.complete_santalbino_editorial_delivery(
    v_post_id, 'facebook', v_token, 'published', 'mock-facebook-post-123', null
  );
  if v_status <> 'publishing' then
    raise exception 'Post should remain publishing while Instagram is in flight: %', v_status;
  end if;

  v_status := public.complete_santalbino_editorial_delivery(
    v_post_id, 'instagram', v_token, 'unknown', null, 'Mock timeout after submit'
  );
  if v_status <> 'unknown' then
    raise exception 'Ambiguous Instagram outcome must make the post unknown: %', v_status;
  end if;
  if (select status from public.santalbino_editorial_deliveries where post_id = v_post_id and platform = 'facebook') <> 'published' then
    raise exception 'Facebook success was not preserved after Instagram uncertainty';
  end if;
  if jsonb_array_length(public.claim_santalbino_editorial_queue(5, true)) <> 0 then
    raise exception 'Unknown editorial post was automatically retried';
  end if;

  update public.santalbino_editorial_posts
     set scheduled_at = now() - interval '1 minute'
   where logical_key = 'match:ci-match:retry_notice:club_notice' and status = 'scheduled';
  v_claims := public.claim_santalbino_editorial_queue(5, true);
  if jsonb_array_length(v_claims) <> 1 then
    raise exception 'Expected the retryable editorial delivery to be claimed once: %', v_claims;
  end if;
  v_retry_id := (v_claims -> 0 -> 'post' ->> 'id')::uuid;
  v_retry_token := (v_claims -> 0 -> 'post' ->> 'claim_token')::uuid;
  v_status := public.complete_santalbino_editorial_delivery(
    v_retry_id, 'facebook', v_retry_token, 'failed_retryable', null, 'Mock explicit rejection'
  );
  if v_status <> 'failed' then
    raise exception 'Explicit rejection should remain retryable in failed state: %', v_status;
  end if;
  if jsonb_array_length(public.claim_santalbino_editorial_queue(5, true)) <> 0 then
    raise exception 'Retryable delivery ignored its exponential backoff';
  end if;

  update public.santalbino_editorial_deliveries
     set last_attempt_at = now() - interval '2 hours'
   where post_id = v_retry_id and platform = 'facebook';
  v_claims := public.claim_santalbino_editorial_queue(5, true);
  if jsonb_array_length(v_claims) <> 1 then
    raise exception 'Retryable delivery did not become eligible after its backoff: %', v_claims;
  end if;
  v_retry_token := (v_claims -> 0 -> 'post' ->> 'claim_token')::uuid;
  v_status := public.complete_santalbino_editorial_delivery(
    v_retry_id, 'facebook', v_retry_token, 'unknown', null, 'Stop retry test'
  );
  if v_status <> 'unknown' then
    raise exception 'Final retry test outcome should be held for reconciliation: %', v_status;
  end if;

  update public.santalbino_editorial_posts
     set scheduled_at = now() - interval '1 minute'
   where logical_key = 'match:ci-match:retry-limit:club_notice' and status = 'scheduled';
  select id into v_exhausted_id from public.santalbino_editorial_posts
   where logical_key = 'match:ci-match:retry-limit:club_notice';
  insert into public.santalbino_editorial_deliveries
    (post_id, platform, status, attempt_count, last_attempt_at)
  values (v_exhausted_id, 'facebook', 'failed_retryable', 4, now() - interval '2 hours');
  v_claims := public.claim_santalbino_editorial_queue(5, true);
  if jsonb_array_length(v_claims) <> 1 then
    raise exception 'Expected final allowed retry to be claimed';
  end if;
  v_exhausted_token := (v_claims -> 0 -> 'post' ->> 'claim_token')::uuid;
  v_status := public.complete_santalbino_editorial_delivery(
    v_exhausted_id, 'facebook', v_exhausted_token, 'failed_retryable', null, 'Final explicit rejection'
  );
  if v_status <> 'failed' or (select status from public.santalbino_editorial_deliveries where post_id = v_exhausted_id) <> 'failed' then
    raise exception 'Retry limit did not convert the fifth failed attempt into a terminal failure';
  end if;
  if jsonb_array_length(public.claim_santalbino_editorial_queue(5, true)) <> 0 then
    raise exception 'Terminally failed delivery was automatically retried';
  end if;

  select id into v_permanent_id from public.santalbino_editorial_posts
   where logical_key = 'match:ci-match:permanent-error:club_notice';
  update public.santalbino_editorial_posts
     set scheduled_at = now() - interval '1 minute'
   where id = v_permanent_id;
  v_claims := public.claim_santalbino_editorial_queue(5, true);
  if jsonb_array_length(v_claims) <> 1 then
    raise exception 'Permanent Meta rejection test post was not claimed';
  end if;
  v_permanent_token := (v_claims -> 0 -> 'post' ->> 'claim_token')::uuid;
  v_status := public.complete_santalbino_editorial_delivery(
    v_permanent_id, 'facebook', v_permanent_token, 'failed', null, 'Meta invalid token'
  );
  if v_status <> 'failed'
     or (select status from public.santalbino_editorial_deliveries where post_id = v_permanent_id and platform = 'facebook') <> 'failed' then
    raise exception 'Permanent Meta rejection was not stored as terminal failure: %', v_status;
  end if;
  if jsonb_array_length(public.claim_santalbino_editorial_queue(5, true)) <> 0 then
    raise exception 'Permanent Meta rejection was automatically retried';
  end if;

  select id into v_mixed_id from public.santalbino_editorial_posts
   where logical_key = 'match:ci-match:mixed-retry-cap:club_notice';
  update public.santalbino_editorial_posts
     set scheduled_at = now() - interval '1 minute'
   where id = v_mixed_id and status = 'scheduled';
  insert into public.santalbino_editorial_deliveries
    (post_id, platform, status, attempt_count, last_attempt_at)
  values (v_mixed_id, 'facebook', 'failed_retryable', 5, now() - interval '2 hours');
  insert into public.santalbino_editorial_deliveries (post_id, platform, status)
  values (v_mixed_id, 'instagram', 'pending');
  v_claims := public.claim_santalbino_editorial_queue(5, true);
  if jsonb_array_length(v_claims) <> 1
     or jsonb_array_length(v_claims -> 0 -> 'deliveries') <> 1
     or v_claims -> 0 -> 'deliveries' -> 0 ->> 'platform' <> 'instagram' then
    raise exception 'An exhausted Facebook delivery was claimed together with a due Instagram delivery: %', v_claims;
  end if;
  v_mixed_token := (v_claims -> 0 -> 'post' ->> 'claim_token')::uuid;
  if (select status from public.santalbino_editorial_deliveries where post_id = v_mixed_id and platform = 'facebook') <> 'failed_retryable'
     or (select attempt_count from public.santalbino_editorial_deliveries where post_id = v_mixed_id and platform = 'facebook') <> 5 then
    raise exception 'The exhausted Facebook delivery was changed by the mixed-platform claim';
  end if;
  v_status := public.complete_santalbino_editorial_delivery(
    v_mixed_id, 'instagram', v_mixed_token, 'unknown', null, 'Mixed-platform cap regression test'
  );
  if v_status <> 'unknown' then
    raise exception 'Mixed-platform cap fixture did not close in unknown state: %', v_status;
  end if;
end
$worker_tests$;

reset role;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set role authenticated;

do $reconciliation_tests$
declare
  v_post_id uuid;
  v_status text;
begin
  select id into v_post_id from public.santalbino_editorial_posts
   where logical_key = 'match:ci-match:post_match' and status = 'unknown';
  if v_post_id is null then raise exception 'Expected an unknown post for reconciliation'; end if;
  v_status := public.resolve_santalbino_editorial_delivery(
    v_post_id, 'instagram', 'published', 'mock-instagram-post-123',
    'Verificato manualmente il post remoto su Instagram'
  );
  if v_status <> 'published' then
    raise exception 'Reconciliation did not close the post as published: %', v_status;
  end if;
  if (select count(*) from public.santalbino_editorial_delivery_resolutions
       where post_id = v_post_id and platform = 'instagram' and resolution = 'published') <> 1 then
    raise exception 'Administrative reconciliation was not audited';
  end if;

  select id into v_post_id from public.santalbino_editorial_posts
   where logical_key = 'match:ci-match:retry-limit:club_notice' and status = 'failed';
  if v_post_id is null or not public.cancel_santalbino_editorial_post(v_post_id) then
    raise exception 'Terminal failed editorial post could not be cancelled';
  end if;
  if (select status from public.santalbino_editorial_posts where id = v_post_id) <> 'cancelled' then
    raise exception 'Terminal failed editorial post did not enter cancelled state';
  end if;
end
$reconciliation_tests$;

reset role;
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
set role authenticated;

do $non_admin_tests$
declare
  v_count integer;
begin
  select count(*) into v_count from public.santalbino_editorial_posts;
  if v_count <> 0 then
    raise exception 'Non-admin user can read editorial drafts';
  end if;
  select count(*) into v_count from storage.objects where bucket_id = 'santalbino-editorial';
  if v_count <> 0 then
    raise exception 'Non-admin user can read private editorial assets';
  end if;
  begin
    insert into storage.objects (bucket_id, name)
    values ('santalbino-editorial', 'social-editorial/test/non-admin-upload.jpg');
    raise exception 'Non-admin user unexpectedly uploaded a private editorial asset';
  exception when insufficient_privilege then
    null;
  end;
end
$non_admin_tests$;

reset role;
select 'Social editorial queue SQL tests passed' as result;
