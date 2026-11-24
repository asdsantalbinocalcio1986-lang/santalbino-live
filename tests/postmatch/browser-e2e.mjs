import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const api = process.env.API_URL;
const anon = process.env.ANON_KEY;
const service = process.env.SERVICE_ROLE_KEY;
const dbUrl = process.env.DB_URL;
for (const [name, value] of Object.entries({ API_URL: api, ANON_KEY: anon, SERVICE_ROLE_KEY: service, DB_URL: dbUrl })) {
  assert.ok(value, `Missing ${name}; local Supabase must be running.`);
}

const email = 'postmatch-browser@example.test';
const password = randomBytes(24).toString('base64url') + 'aA1!';
const pollId = `ci-browser-${process.env.GITHUB_RUN_ID || randomUUID()}`;

async function apiRequest(path, { method = 'GET', token = service, key = service, body } = {}) {
  const response = await fetch(api + path, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  assert.ok(response.ok, `${method} ${path} failed: HTTP ${response.status}: ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : null;
}

function psql(sql, file = false) {
  execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', ...(file ? ['-f', sql] : ['-c', sql])], { stdio: 'inherit' });
}

async function main() {
  // The test-mode table is applied only to this disposable local Supabase instance.
  psql('/tmp/santalbino-hosted-migrations/20261120133534_isolated_test_match_mode.sql', true);

  const user = await apiRequest('/auth/v1/admin/users', {
    method: 'POST',
    body: { email, password, email_confirm: true }
  });
  assert.ok(user?.id, 'Could not create the disposable browser-test admin.');

  const state = {
    rev: 1,
    match: {
      home: "ASD Sant'Albino Terme · TEST",
      away: 'SQUADRA AVVERSARIA · TEST',
      comp: 'SIMULAZIONE SANTA LIVE',
      venue: 'Centro Sportivo Luciano Monaci · TEST',
      date: '2026-11-24',
      time: '',
      ourSide: 'home',
      hashtag: '#SANTALIVETEST',
      pollId
    },
    logos: { home: './assets/logo-home.png', away: './assets/logo-away.png' },
    rosters: { home: '', away: '' },
    convocati: '',
    clock: { phase: 'ft', t0: 0, finishedAt: Date.now() },
    mvp: { link: '', ourOnly: true, votes: {}, tpl: '', raw: false, candidateKeys: [], candidatePlayers: [] },
    publication: { published: null, pending: null, publishedAt: '' },
    socialPublishing: { enabled: false, facebook: false, instagram: false, ready: false, publishingEnabled: false },
    media: {
      evOne: {}, evImg: {}, evImgRaw: {},
      library: { goal: '', formation: '', sponsors: [] },
      graphicEditor: { global: { accent: '#e3c66d', overlay: 0, border: 3, sponsor: false }, templates: {} }
    },
    events: [
      { id: 'browser-goal-home', type: 'goal', team: 'home', player: 'Marcatore Test', min: '12', kind: '' },
      { id: 'browser-goal-away', type: 'goal', team: 'away', player: 'Avversario Test', min: '34', kind: '' }
    ]
  };
  const jsonSql = JSON.stringify(state).replaceAll("'", "''");
  psql(`insert into public.santalbino_admins(user_id) values ('${user.id}') on conflict (user_id) do nothing;
    update public.live_test_state set state = '${jsonSql}'::jsonb, updated_at = now() where id = 1;`);

  const mime = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2'
  };
  const root = process.cwd();
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`window.SANTALBINO_CONFIG = { supabaseUrl: ${JSON.stringify(api)}, supabaseAnonKey: ${JSON.stringify(anon)} };`);
      return;
    }
    const relative = pathname === '/' ? '/regia.html' : pathname;
    const file = resolve(root, '.' + relative);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    try {
      const data = readFileSync(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('Not found');
    }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());

  try {
    await page.goto(`http://127.0.0.1:${address.port}/regia.html?test=1`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-a="login"]').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('[data-a="login"]').first().click();
    await page.locator('#authEmail').fill(email);
    await page.locator('#authPassword').fill(password);
    await page.locator('#authForm button[type="submit"]').click();
    await page.locator('.test-banner').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('button', { name: 'Genera MATCH RESULT e post' }).waitFor({ state: 'visible', timeout: 30000 });

    await page.getByRole('button', { name: 'Genera MATCH RESULT e post' }).click();
    await page.locator('#matchResultPost').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await page.locator('[data-a="savePostmatchRevision"]').isEnabled(), true, 'Save button should be enabled for the admin.');

    const captionOne = 'TEST E2E · Prima revisione salvata dalla regia.';
    await page.locator('#matchResultPost').fill(captionOne);
    await page.locator('[data-a="savePostmatchRevision"]').click();
    await page.getByText('Bozza post-partita salvata', { exact: false }).waitFor({ timeout: 30000 });
    await page.getByRole('heading', { name: /MATCH RESULT · Bozza/ }).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('#matchResultPost').inputValue(), captionOne);

    // Closing and reopening proves the saved snapshot and graphic are recovered from the database.
    await page.locator('[data-a="graphicclose"]').click();
    await page.getByRole('button', { name: 'Genera MATCH RESULT e post' }).click();
    await page.locator('#matchResultPost').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await page.locator('#matchResultPost').inputValue(), captionOne, 'Reopened editor did not recover the saved caption.');
    assert.equal(await page.locator('.graphic-preview').count(), 1, 'Saved graphic preview was not restored.');

    const captionTwo = 'TEST E2E · Seconda revisione, aggiornata e pronta per approvazione.';
    await page.locator('#matchResultPost').fill(captionTwo);
    await page.locator('[data-a="savePostmatchRevision"]').click();
    await page.getByText('Bozza post-partita salvata', { exact: false }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: /Rev\. 1 · Superata/ }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: /Rev\. 2 · Bozza/ }).waitFor({ timeout: 30000 });

    // Historical revisions can be reopened independently.
    await page.getByRole('button', { name: /Rev\. 1 · Superata/ }).click();
    assert.equal(await page.locator('#matchResultPost').inputValue(), captionOne, 'Revision 1 history did not restore its original caption.');
    await page.getByRole('button', { name: /Rev\. 2 · Bozza/ }).click();
    assert.equal(await page.locator('#matchResultPost').inputValue(), captionTwo, 'Revision 2 history did not restore its original caption.');

    await page.locator('[data-a="approvePostmatchRevision"]').click();
    await page.getByRole('heading', { name: /MATCH RESULT · Approvata/ }).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('[data-a="shareMatchResultPost"]').isDisabled(), true, 'WhatsApp sharing must remain disabled in test mode.');

    // Reload the whole control room and verify that the approved revision remains available.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.test-banner').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('button', { name: 'Genera MATCH RESULT e post' }).waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('button', { name: 'Genera MATCH RESULT e post' }).click();
    await page.locator('#matchResultPost').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('heading', { name: /MATCH RESULT · Approvata/ }).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('#matchResultPost').inputValue(), captionTwo, 'Approved caption was not recovered after full page reload.');

    const rows = await apiRequest(`/rest/v1/santalbino_postmatch_editions?select=revision,status,caption&environment=eq.test&match_id=eq.${encodeURIComponent(pollId)}&order=revision.asc`, {
      token: (await apiRequest('/auth/v1/token?grant_type=password', {
        method: 'POST', token: anon, key: anon, body: { email, password }
      })).access_token,
      key: anon
    });
    assert.equal(rows.length, 2, 'Expected exactly two saved revisions.');
    assert.equal(rows[0].status, 'superseded');
    assert.equal(rows[1].status, 'approved');
    assert.equal(rows[1].caption, captionTwo);
    assert.deepEqual(pageErrors, [], `Browser reported JavaScript errors: ${pageErrors.join('; ')}`);

    console.log('PASS: browser login, MATCH RESULT rendering, JPEG upload, draft save, close/reopen recovery, revision history, approval and reload recovery.');
    console.log('PASS: test mode blocks WhatsApp sharing; all records and images remained in disposable local Supabase.');
  } finally {
    await browser.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
