import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const run = promisify(execFile);
const dbUrl = process.env.DB_URL;
assert.ok(dbUrl, 'DB_URL is required; use only the disposable local Supabase database.');

const eventId = `publisher-concurrent-${randomUUID()}`;
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const claimSql = `select public.claim_santalbino_social_publication(
  ${sqlString(eventId)}, 'local-concurrency', 'goal', 'Concurrency test',
  'https://example.test/concurrency.jpg',
  '{"facebook":true,"instagram":false}'::jsonb
);`;

try {
  // Separate psql processes mean separate PostgreSQL transactions/sessions.
  const results = await Promise.all([
    run('psql', [dbUrl, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', claimSql]),
    run('psql', [dbUrl, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', claimSql]),
  ]);
  const parsed = results.map(({ stdout }) => JSON.parse(stdout.trim()));
  const winners = parsed.filter((value) => value.result === 'claimed');
  const blocked = parsed.filter((value) => value.result === 'reconciliation_required');
  assert.equal(winners.length, 1, `Expected exactly one winning claim, got ${JSON.stringify(parsed)}`);
  assert.equal(blocked.length, 1, `Expected exactly one blocked claim, got ${JSON.stringify(parsed)}`);
  console.log('Concurrent claim test passed: one winner, one blocked request.');
} finally {
  await run('psql', [
    dbUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-c',
    `delete from public.santalbino_social_publications where event_id = ${sqlString(eventId)};`,
  ]);
}
