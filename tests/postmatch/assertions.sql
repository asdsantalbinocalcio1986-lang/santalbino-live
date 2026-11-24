-- Integration assertions run against an ephemeral PostgreSQL instance.
\set ON_ERROR_STOP on

insert into storage.objects(bucket_id, name)
values
  ('santalbino-postmatch', 'postmatch/test/match_01/rev1.jpg'),
  ('santalbino-postmatch', 'postmatch/test/match_01/rev2.jpg'),
  ('santalbino-postmatch', 'postmatch/test/match_01/rev3.jpg');

set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set role authenticated;

select * from public.save_santalbino_postmatch_revision(
  'test', 'match_01', 'Prima bozza', '{"score":"1-0"}'::jsonb, 10,
  'postmatch/test/match_01/rev1.jpg',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);

select * from public.save_santalbino_postmatch_revision(
  'test', 'match_01', 'Seconda bozza', '{"score":"2-0"}'::jsonb, 11,
  'postmatch/test/match_01/rev2.jpg',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
);

do $$
begin
  if (select status from public.santalbino_postmatch_editions where revision = 1) <> 'superseded' then
    raise exception 'Saving a second draft did not supersede the first draft';
  end if;
  if (select status from public.santalbino_postmatch_editions where revision = 2) <> 'draft' then
    raise exception 'The newest revision is not a draft';
  end if;
end $$;

select * from public.approve_santalbino_postmatch_revision(
  (select id from public.santalbino_postmatch_editions where revision = 2), 2
);

do $$
begin
  if (select status from public.santalbino_postmatch_editions where revision = 2) <> 'approved' then
    raise exception 'Current draft was not approved';
  end if;
  if (select approved_by from public.santalbino_postmatch_editions where revision = 2)
     <> '11111111-1111-4111-8111-111111111111'::uuid then
    raise exception 'Approval actor was not recorded';
  end if;
end $$;

-- Test the immutability trigger as the table owner: the authenticated
-- application role is intentionally denied direct UPDATE by table grants,
-- which would otherwise prevent the trigger itself from being exercised.
reset role;
do $
begin
  begin
    update public.santalbino_postmatch_editions set caption = 'Alterata'
     where revision = 2;
    raise exception 'Approved revision content was mutable';
  exception when raise_exception then
    if sqlerrm = 'Approved revision content was mutable' then raise; end if;
    if sqlerrm <> 'Post-match revision content is immutable' then raise; end if;
  end;
end $;
set role authenticated;

-- A new draft supersedes the approved edition but preserves its audit metadata.
select * from public.save_santalbino_postmatch_revision(
  'test', 'match_01', 'Terza bozza', '{"score":"3-0"}'::jsonb, 12,
  'postmatch/test/match_01/rev3.jpg',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
);

do $$
begin
  if (select status from public.santalbino_postmatch_editions where revision = 2) <> 'superseded' then
    raise exception 'Previous approved revision was not superseded';
  end if;
  if (select approved_by from public.santalbino_postmatch_editions where revision = 2)
     <> '11111111-1111-4111-8111-111111111111'::uuid then
    raise exception 'Superseding erased approval audit metadata';
  end if;
end $$;

-- Stale approval must fail and leave the current draft unchanged.
do $$
begin
  begin
    perform * from public.approve_santalbino_postmatch_revision(
      (select id from public.santalbino_postmatch_editions where revision = 3), 2
    );
    raise exception 'Stale approval unexpectedly succeeded';
  exception when sqlstate '40001' then
    null;
  end;
  if (select status from public.santalbino_postmatch_editions where revision = 3) <> 'draft' then
    raise exception 'Stale approval changed the current draft';
  end if;
end $$;

reset role;
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
set role authenticated;

do $$
begin
  begin
    perform * from public.save_santalbino_postmatch_revision(
      'test', 'unauthorized', 'No', '{}'::jsonb, 1,
      'postmatch/test/unauthorized/rev1.jpg',
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    );
    raise exception 'Non-admin was able to create a revision';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
select 'Post-match SQL integration tests passed' as result;
