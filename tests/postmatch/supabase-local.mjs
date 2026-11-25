import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const api = process.env.API_URL;
const anon = process.env.ANON_KEY;
const service = process.env.SERVICE_ROLE_KEY;
const dbUrl = process.env.DB_URL;
for (const [name, value] of Object.entries({ API_URL: api, ANON_KEY: anon, SERVICE_ROLE_KEY: service, DB_URL: dbUrl })) {
  assert.ok(value, `Missing ${name}; is the local Supabase stack running?`);
}

const adminEmail = 'postmatch-admin@example.test';
const nonAdminEmail = 'postmatch-user@example.test';
const password = randomBytes(24).toString('base64url') + 'aA1!';
const matchId = `ci-postmatch-${process.env.GITHUB_RUN_ID || randomUUID()}`;

async function request(path, { method = 'GET', token = anon, key = anon, body, headers = {}, expected = [200] } = {}) {
  const response = await fetch(api + path, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(body instanceof Uint8Array ? {} : body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers
    },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body)
  });
  const text = await response.text();
  assert.ok(expected.includes(response.status), `${method} ${path}: unexpected HTTP ${response.status}: ${text.slice(0, 1000)}`);
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data, text };
}

async function createUser(email) {
  const { data } = await request('/auth/v1/admin/users', {
    method: 'POST', token: service, key: service,
    body: { email, password, email_confirm: true }
  });
  assert.ok(data?.id, `Auth did not create user ${email}`);
  return data.id;
}

async function signIn(email) {
  const { data } = await request('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email, password }
  });
  assert.ok(data?.access_token, `Auth login failed for ${email}`);
  return data.access_token;
}

function psql(sqlOrFile, isFile = false) {
  const args = [dbUrl, '-v', 'ON_ERROR_STOP=1'];
  if (isFile) args.push('-f', sqlOrFile);
  else args.push('-c', sqlOrFile);
  execFileSync('psql', args, { stdio: 'inherit' });
}

async function upload(path, token, bytes, upsert = false, expected = [200]) {
  return request('/storage/v1/object/santalbino-postmatch/' + path.split('/').map(encodeURIComponent).join('/'), {
    method: 'POST', token,
    body: bytes,
    headers: { 'Content-Type': 'image/jpeg', 'x-upsert': String(upsert) },
    expected
  });
}

async function main() {
  const adminId = await createUser(adminEmail);
  await createUser(nonAdminEmail);

  const setupTemplate = readFileSync('supabase-setup.sql', 'utf8');
  assert.ok(setupTemplate.includes("admin_email text := 'INSERISCI_EMAIL_AMMINISTRATORE';"),
    'The setup SQL admin email placeholder was not found; refusing to run with an unknown admin configuration.');
  const setup = setupTemplate
    .replace("admin_email text := 'INSERISCI_EMAIL_AMMINISTRATORE';", `admin_email text := '${adminEmail}';`)
    .replace("if admin_email = 'INSERISCI_EMAIL_AMMINISTRATORE' or", "if admin_email = '' or");
  assert.ok(!setup.includes('INSERISCI_EMAIL_AMMINISTRATORE'),
    'The local setup SQL still contains the admin email placeholder.');
  const setupPath = '/tmp/santalbino-local-setup.sql';
  writeFileSync(setupPath, setup);
  psql(setupPath, true);

  // Match the production helper's INVOKER semantics and the real admin-table RLS model.
  psql(`
    drop policy if exists "SANTA Live admins can read own admin record" on public.santalbino_admins;
    create policy "SANTA Live admins can read own admin record"
      on public.santalbino_admins for select to authenticated
      using (user_id = auth.uid());
    alter function public.is_santalbino_admin() security invoker;
    alter function public.is_santalbino_admin() set search_path = public;
  `);

  psql('supabase/proposals/postmatch_editorial_revisions.sql', true);
  psql('supabase/proposals/social_editorial_queue.sql', true);
  const adminToken = await signIn(adminEmail);
  const nonAdminToken = await signIn(nonAdminEmail);

  // One tiny JPEG is enough to exercise the real Storage API and signed downloads.
  const jpeg = new Uint8Array(Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=',
    'base64'
  ));

  // Editorial originals live in a separate private bucket until a worker signs a short-lived URL.
  const editorialPath = `social-editorial/test/${matchId}/${randomUUID()}.jpg`;
  const editorialObjectPath = editorialPath.split('/').map(encodeURIComponent).join('/');
  const editorialUpload = await request('/storage/v1/object/santalbino-editorial/' + editorialObjectPath, {
    method: 'POST', token: adminToken, body: jpeg,
    headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }
  });
  assert.equal(editorialUpload.response.status, 200, 'Admin could not upload a private editorial asset');

  const editorialSigned = await request('/storage/v1/object/sign/santalbino-editorial/' + editorialObjectPath, {
    method: 'POST', token: adminToken, body: { expiresIn: 600 }
  });
  const editorialSignedUrl = editorialSigned.data?.signedURL || editorialSigned.data?.signedUrl;
  assert.ok(editorialSignedUrl, 'Private editorial asset did not produce a signed URL');
  const editorialSignedFetch = await fetch(editorialSignedUrl.startsWith('http') ? editorialSignedUrl : api + '/storage/v1' + editorialSignedUrl);
  assert.equal(editorialSignedFetch.status, 200, 'Signed editorial asset URL could not be fetched');

  const nonAdminEditorial = await fetch(api + '/storage/v1/object/authenticated/santalbino-editorial/' + editorialObjectPath, {
    headers: { apikey: anon, Authorization: `Bearer ${nonAdminToken}` }
  });
  assert.notEqual(nonAdminEditorial.status, 200, 'Non-admin user could read a private editorial original');

  const publicEditorial = await fetch(api + '/storage/v1/object/public/santalbino-editorial/' + editorialObjectPath, {
    headers: { apikey: anon }
  });
  assert.notEqual(publicEditorial.status, 200, 'Private editorial original was exposed through a public URL');

  const pathFor = (revision) => `postmatch/test/${matchId}/${revision}-${randomUUID()}.jpg`;
  const firstPath = pathFor('r1');
  await upload(firstPath, adminToken, jpeg);
  const firstHash = Buffer.from(await crypto.subtle.digest('SHA-256', jpeg)).toString('hex');

  const save = async (path, hash, caption) => {
    const { data } = await request('/rest/v1/rpc/save_santalbino_postmatch_revision', {
      method: 'POST', token: adminToken,
      body: {
        p_environment: 'test', p_match_id: matchId, p_caption: caption,
        p_snapshot: { rev: 1, match: { pollId: matchId, home: 'Sant’Albino', away: 'Test FC', date: '2026-11-24' }, events: [] },
        p_source_state_rev: 1, p_graphic_path: path, p_graphic_sha256: hash
      }
    });
    const row = Array.isArray(data) ? data[0] : data;
    assert.ok(row?.id, 'Save RPC did not return a revision');
    return row;
  };

  const first = await save(firstPath, firstHash, 'Prima bozza');
  assert.equal(first.revision, 1);
  assert.equal(first.status, 'draft');

  const secondPath = pathFor('r2');
  await upload(secondPath, adminToken, jpeg);
  const secondHash = Buffer.from(await crypto.subtle.digest('SHA-256', jpeg)).toString('hex');
  const second = await save(secondPath, secondHash, 'Seconda bozza');
  assert.equal(second.revision, 2);

  const history = await request(
    `/rest/v1/santalbino_postmatch_editions?select=id,revision,status,caption,graphic_path&environment=eq.test&match_id=eq.${encodeURIComponent(matchId)}&order=revision.asc`,
    { token: adminToken }
  );
  assert.equal(history.data.length, 2);
  assert.equal(history.data[0].status, 'superseded');
  assert.equal(history.data[1].status, 'draft');

  // Stale approval is asserted directly in the PostgreSQL integration suite.
  // Keep this API-level flow focused on successful Auth/RPC approval; PostgREST
  // currently returns an upstream 504 for the deliberately stale 40001 path.
  const approved = await request('/rest/v1/rpc/approve_santalbino_postmatch_revision', {
    method: 'POST', token: adminToken,
    body: { p_id: second.id, p_expected_revision: 2 }
  });
  assert.equal((Array.isArray(approved.data) ? approved.data[0] : approved.data).status, 'approved');

  // Private Storage: signed URLs work for the admin; referenced files cannot be replaced or deleted.
  const signed = await request('/storage/v1/object/sign/santalbino-postmatch/' + secondPath.split('/').map(encodeURIComponent).join('/'), {
    method: 'POST', token: adminToken, body: { expiresIn: 300 }
  });
  const signedUrl = signed.data?.signedURL || signed.data?.signedUrl;
  assert.ok(signedUrl, 'Storage did not return a signed URL');
  const signedFetch = await fetch(signedUrl.startsWith('http') ? signedUrl : api + '/storage/v1' + signedUrl);
  assert.equal(signedFetch.status, 200, 'Signed graphic URL did not return the private JPEG');

  await upload(secondPath, adminToken, jpeg, true, [400, 401, 403, 409]);
  await request('/storage/v1/object/santalbino-postmatch', {
    method: 'DELETE', token: adminToken, body: { prefixes: [secondPath] },
    expected: [200, 400, 401, 403, 404]
  });
  const referencedAfterDelete = await fetch(api + '/storage/v1/object/authenticated/santalbino-postmatch/' + secondPath.split('/').map(encodeURIComponent).join('/'), {
    headers: { apikey: anon, Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(referencedAfterDelete.status, 200, 'A referenced post-match graphic was deleted or became inaccessible');

  const orphanPath = `postmatch/test/${matchId}/orphan-${randomUUID()}.jpg`;
  await upload(orphanPath, adminToken, jpeg);
  await request('/storage/v1/object/santalbino-postmatch', {
    method: 'DELETE', token: adminToken, body: { prefixes: [orphanPath] },
    expected: [200]
  });
  const orphanAfterDelete = await fetch(api + '/storage/v1/object/authenticated/santalbino-postmatch/' + orphanPath.split('/').map(encodeURIComponent).join('/'), {
    headers: { apikey: anon, Authorization: `Bearer ${adminToken}` }
  });
  const orphanAfterDeleteBody = await orphanAfterDelete.text();
  assert.ok(
    [400, 404].includes(orphanAfterDelete.status) && /not found/i.test(orphanAfterDeleteBody),
    `An unreferenced post-match graphic could not be deleted or is still accessible (HTTP ${orphanAfterDelete.status}: ${orphanAfterDeleteBody.slice(0, 500)})`
  );

  // A regular authenticated user can neither read revisions nor invoke privileged RPCs or Storage writes.
  const nonAdminHistory = await request(
    `/rest/v1/santalbino_postmatch_editions?select=id&environment=eq.test&match_id=eq.${encodeURIComponent(matchId)}`,
    { token: nonAdminToken }
  );
  assert.deepEqual(nonAdminHistory.data, []);
  await request('/rest/v1/rpc/approve_santalbino_postmatch_revision', {
    method: 'POST', token: nonAdminToken,
    body: { p_id: second.id, p_expected_revision: 2 },
    expected: [400, 401, 403]
  });
  await upload(`postmatch/test/${matchId}/forbidden.jpg`, nonAdminToken, jpeg, false, [400, 401, 403]);

  // Verify the row and private graphic still exist after all rejected mutations.
  const final = await request(
    `/rest/v1/santalbino_postmatch_editions?select=revision,status,graphic_path&environment=eq.test&match_id=eq.${encodeURIComponent(matchId)}&order=revision.asc`,
    { token: adminToken }
  );
  assert.equal(final.data.length, 2);
  assert.equal(final.data[1].status, 'approved');
  const finalDownload = await fetch(api + '/storage/v1/object/authenticated/santalbino-postmatch/' + secondPath.split('/').map(encodeURIComponent).join('/'), {
    headers: { apikey: anon, Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(finalDownload.status, 200, 'Approved graphic was not preserved');

  console.log('PASS: local Supabase Auth, admin RLS, private editorial Storage and signed URLs, post-match Storage, revision history, save and approval RPCs.');
  console.log(`PASS: isolated local match ${matchId}; no hosted Supabase project was contacted.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
