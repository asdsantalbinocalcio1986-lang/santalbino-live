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

do $block$
begin
  if (select count(*) from public.santalbino_postmatch_editions) <> 2 then
    raise exception 'Admin could not read the expected post-match revisions through RLS';
  end if;
end $block$;

do $block$
begin
  if (select status from public.santalbino_postmatch_editions where revision = 1) <> 'superseded' then
    raise exception 'Saving a second draft did not supersede the first draft';
  end if;
  if (select status from public.santalbino_postmatch_editions where revision = 2) <> 'draft' then
    raise exception 'The newest revision is not a draft';
  end if;
end $block$;

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
do $$
begin
  begin
    update public.santalbino_postmatch_editions set caption = 'Alterata'
     where revision = 2;
    raise exception 'Approved revision content was mutable';
  exception when raise_exception then
    if sqlerrm = 'Approved revision content was mutable' then raise; end if;
    if sqlerrm <> 'Post-match revision content is immutable' then raise; end if;
  end;
end $$;
set role authenticated;

-- A new draft must not replace the currently approved edition until the new draft is explicitly approved.
select * from public.save_santalbino_postmatch_revision(
  'test', 'match_01', 'Terza bozza', '{"score":"3-0"}'::jsonb, 12,
  'postmatch/test/match_01/rev3.jpg',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
);

do $$
begin
  if (select status from public.santalbino_postmatch_editions where revision = 2) <> 'approved' then
    raise exception 'Saving a draft prematurely superseded the current approved revision';
  end if;
  if (select status from public.santalbino_postmatch_editions where revision = 3) <> 'draft' then
    raise exception 'The new revision is not awaiting approval as a draft';
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

-- Approving the new revision atomically supersedes the previously approved one.
select * from public.approve_santalbino_postmatch_revision(
  (select id from public.santalbino_postmatch_editions where revision = 3), 3
);

do $
begin
  if (select status from public.santalbino_postmatch_editions where revision = 2) <> 'superseded' then
    raise exception 'Previous approved revision was not superseded on replacement approval';
  end if;
  if (select approved_by from public.santalbino_postmatch_editions where revision = 2)
     <> '11111111-1111-4111-8111-111111111111'::uuid then
    raise exception 'Superseding erased previous approval audit metadata';
  end if;
  if (select status from public.santalbino_postmatch_editions where revision = 3) <> 'approved' then
    raise exception 'New revision was not approved';
  end if;
end $;

-- Storage must preserve the exact graphic referenced by an approved revision.
-- Admins may clean up orphan uploads after a failed save, but cannot replace or
-- delete an object already referenced by any revision.
insert into storage.objects(bucket_id, name)
values ('santalbino-postmatch', 'postmatch/test/orphan/unused.jpg');

update storage.objects
   set name = 'postmatch/test/match_01/tampered.jpg'
 where bucket_id = 'santalbino-postmatch'
   and name = 'postmatch/test/match_01/rev3.jpg';
delete from storage.objects
 where bucket_id = 'santalbino-postmatch'
   and name = 'postmatch/test/match_01/rev3.jpg';
delete from storage.objects
 where bucket_id = 'santalbino-postmatch'
   and name = 'postmatch/test/orphan/unused.jpg';

do $block$
begin
  if not exists (
    select 1 from storage.objects
     where bucket_id = 'santalbino-postmatch'
       and name = 'postmatch/test/match_01/rev3.jpg'
  ) then
    raise exception 'Referenced approved graphic was changed or deleted';
  end if;
  if exists (
    select 1 from storage.objects
     where bucket_id = 'santalbino-postmatch'
       and name = 'postmatch/test/orphan/unused.jpg'
  ) then
    raise exception 'An unreferenced orphan graphic could not be cleaned up';
  end if;
  if exists (
    select 1 from storage.objects
     where bucket_id = 'santalbino-postmatch'
       and name = 'postmatch/test/match_01/tampered.jpg'
  ) then
    raise exception 'A referenced graphic was replaced';
  end if;
end $block$;

reset role;
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
set role authenticated;

do $block$
begin
  if (select count(*) from public.santalbino_postmatch_editions) <> 0 then
    raise exception 'Non-admin could read post-match revisions through RLS';
  end if;
end $block$;

do $block$
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
end $block$;

reset role;
select 'Post-match SQL integration tests passed' as result;
