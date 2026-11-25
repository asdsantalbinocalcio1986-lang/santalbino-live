import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../regia.html', import.meta.url), 'utf8');
const queueSql = readFileSync(new URL('../../supabase/proposals/social_editorial_queue.sql', import.meta.url), 'utf8');

assert.match(source, /\.{3}\(!TEST_MODE \? \[\['editorial', 'Editoriale'\]\] : \[\]\)/,
  'The editorial tab must only be exposed outside the isolated simulation.');
assert.match(source, /function loadEditorialQueue\(\)[\s\S]*?from\('santalbino_editorial_posts'\)[\s\S]*?from\('santalbino_editorial_deliveries'\)/,
  'The admin UI must read editorial posts and independent platform deliveries.');
assert.match(source, /function saveEditorialDraft\(\)[\s\S]*?!CAN_EDIT[\s\S]*?storage\.from\('santalbino-editorial'\)\.upload/,
  'Draft creation must require admin access and upload to the private editorial bucket.');
assert.match(source, /p_asset_sha256: sha256[\s\S]*?p_platforms: \{ facebook, instagram \}[\s\S]*?p_snapshot: snapshot/,
  'The saved revision must persist the client hash, selected platforms and immutable snapshot.');
assert.match(source, /db\.rpc\('save_santalbino_editorial_draft'/,
  'The UI must use the validated server-side draft RPC.');
assert.match(source, /db\.rpc\('approve_santalbino_editorial_post'/,
  'Approval and scheduling must use the dedicated admin RPC.');
assert.match(source, /db\.rpc\('cancel_santalbino_editorial_post'/,
  'Cancellation must use the dedicated admin RPC.');
assert.match(source, /Europe\/Rome/,
  'Editorial scheduling must use the Europe/Rome timezone.');
assert.match(source, /new Date\(scheduledAt\)\.getTime\(\) <= Date\.now\(\)/,
  'Scheduled publication must reject past timestamps.');
assert.match(source, /La pubblicazione automatica resta disattivata/,
  'The UI must distinguish approval/queueing from actual publication.');
assert.match(source, /expired: 'Scaduto · finestra di pubblicazione terminata'/,
  'Expired editorial posts must be clearly labelled in the admin queue.');
assert.match(source, /clock: \{ phase: String\(S\.clock\?\.phase \|\| 'pre'\), finishedAt: Number\(S\.clock\?\.finishedAt \|\| 0\) \}/,
  'The immutable post-match snapshot must preserve the recorded final-whistle timestamp.');
assert.match(queueSql, /expires_at timestamptz/,
  'Editorial posts must persist their server-calculated expiry timestamp.');
assert.match(queueSql, /v_local_kickoff at time zone 'Europe\/Rome'/,
  'Pre-match expiry must be calculated from the kickoff in Europe/Rome.');
assert.match(queueSql, /interval '72 hours'/,
  'Post-match expiry must be 72 hours after the recorded final whistle.');
assert.match(queueSql, /status = 'expired'/,
  'The queue must transition eligible stale posts into the expired state.');

assert.match(source, /unknown: 'Esito incerto · verifica necessaria'/,
  'Unknown outcomes must be clearly labelled as requiring reconciliation.');
assert.match(source, /Anteprima grafica da approvare/,
  'The admin must see the actual uploaded graphic before approving a revision.');
assert.match(source, /editorialResolvePublished[\s\S]*?editorialResolveRetry/,
  'Unknown delivery outcomes must offer explicit admin reconciliation actions.');
assert.match(source, /editorialDefaultLogicalKey\(t\.value\)/,
  'Changing the editorial content type must update the revision key.');
assert.match(source, /Per Instagram è necessario un file JPEG/,
  'Instagram uploads must be restricted to JPEG images.');
assert.match(source, /function resetMatch\(\)[\s\S]*?S\.publication = \{ published: \{ rosters: \{ home: '', away: '' \}, convocati: '' \}, pending: null, publishedAt: '' \}/,
  'Starting a new match must clear previously published convocati/formations and cancel any pending publication.');
assert.match(source, /function captureEditorialDraftForm\([\s\S]*?function restoreEditorialDraftForm\(/,
  'Editorial form state must be captured and restored across full UI renders.');
assert.match(source, /function renderMain\(\)[\s\S]*?captureEditorialDraftForm\(\)[\s\S]*?restoreEditorialDraftForm\(\)/,
  'Every control-room render must preserve the unsaved editorial form.');
assert.match(source, /editorialQueueState\.draft\?\.file/,
  'The selected image File object must survive UI refreshes.');
assert.match(source, /DataTransfer/,
  'The selected image must be restored into the file input when supported by the browser.');
assert.match(source, /e\.target\.matches\('#editorialLogicalKey, #editorialCaption'\)/,
  'Text edits in the editorial form must be captured immediately.');
assert.match(source, /t\.matches\('#editorialAsset, #editorialFacebook, #editorialInstagram'\)/,
  'File and channel changes in the editorial form must be captured.');
assert.doesNotMatch(source, /db\.rpc\('claim_santalbino_editorial_queue'/,
  'The browser must never claim editorial deliveries or dispatch the worker.');
assert.doesNotMatch(source, /SOCIAL_EDITORIAL_DISPATCH_ENABLED\s*=\s*true/,
  'The admin UI must not enable the dispatch kill switch.');

const jpegChecks = [...queueSql.matchAll(/lower\((?:asset_path|p_asset_path)\)\s*(?:!~|~)\s*'([^']*)'/g)].map(match => match[1]);
assert.equal(jpegChecks.length, 3, 'The SQL must define the Instagram JPEG rule at the table, idempotent constraint and RPC boundaries.');
assert.ok(jpegChecks.every(pattern => pattern === '[.]jpe?g$'),
  'Every Instagram SQL regex must use the psql-safe literal-dot pattern.');
const legacyBackslashRegex = "lower(p_asset_path) !~ '" + String.fromCharCode(92) + ".jpe?g$'";
assert.ok(!queueSql.includes(legacyBackslashRegex),
  'The SQL must not reintroduce a backslash-dot regex that psql parses as a meta-command.');

console.log('Editorial queue admin UI guard tests passed');
