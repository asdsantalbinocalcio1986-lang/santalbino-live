import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../regia.html', import.meta.url), 'utf8');

assert.match(source, /\.\.\.\(!TEST_MODE \? \[\['editorial', 'Editoriale'\]\] : \[\]\)/,
  'The editorial tab must only be exposed outside the isolated simulation.');
assert.match(source, /function loadEditorialQueue\(\)[\s\S]*?from\('santalbino_editorial_posts'\)[\s\S]*?from\('santalbino_editorial_deliveries'\)/,
  'The admin UI must read the editorial posts and independent platform deliveries.');
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
assert.ok(source.includes(String.raw`const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec`), 'Europe/Rome scheduling must parse the datetime-local value as numeric date/time components.');
assert.match(source, /new Date\(scheduledAt\)\.getTime\(\) <= Date\.now\(\)/,
  'Scheduled publication must reject past timestamps.');
assert.match(source, /La pubblicazione automatica resta disattivata/,
  'The UI must explicitly distinguish approval/queueing from actual publication.');
assert.match(source, /unknown: 'Esito incerto · verifica necessaria'/,
  'Unknown outcomes must be clearly labelled as requiring reconciliation.');
assert.match(source, /Anteprima grafica da approvare/,
  'The admin must see the actual uploaded graphic before approving a revision.');
assert.match(source, /editorialResolvePublished[\s\S]*?editorialResolveRetry/,
  'Unknown delivery outcomes must offer explicit admin reconciliation actions.');
assert.match(source, /editorialDefaultLogicalKey\(t\.value\)/,
  'Changing the editorial content type must update the default revision key.');
assert.match(source, /Per Instagram è necessario un file JPEG/,
  'Instagram uploads must be restricted to JPEG images.');
assert.match(source, /resolve_santalbino_editorial_delivery/,
  'Editorial unknown outcomes must be reconciled through the audited admin RPC.');
assert.doesNotMatch(source, /db\.rpc\('claim_santalbino_editorial_queue'/,
  'The browser must never claim editorial deliveries or dispatch the worker.');
assert.doesNotMatch(source, /SOCIAL_EDITORIAL_DISPATCH_ENABLED\s*=\s*true/,
  'The admin UI must not enable the dispatch kill switch.');
assert.match(source, /editorialSafeKey\([\s\S]*?normalize\('NFKD'\)/,
  'Logical revision keys must be normalized before submission.');


const queueSql = readFileSync(new URL('../../supabase/proposals/social_editorial_queue.sql', import.meta.url), 'utf8');
assert.match(queueSql, /lower\(asset_path\) ~ '\[\.\]jpe\?g\/,
  'Instagram JPEG validation must use a psql-safe character class, not a backslash escape that psql parses as a meta-command.');
assert.doesNotMatch(queueSql, /lower\(asset_path\) ~ '\\\\?\./,
  'The editorial SQL must not reintroduce a backslash-dot regex that breaks psql execution.');

console.log('Editorial queue admin UI guard tests passed');
