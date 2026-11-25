import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../../regia.html', import.meta.url), 'utf8');

assert.match(source, /const canShare = !!edition && edition\.status === 'approved' && !TEST_MODE;/,
  'WhatsApp sharing must be enabled only for approved revisions outside test mode');
assert.match(source, /if \(!approved \|\| approved\.status !== 'approved'\)/,
  'The share action must independently reject unapproved revisions');
assert.match(source, /txt !== String\(approved\.caption \|\| ''\)\.trim\(\)/,
  'The share action must reject unsaved caption edits');
assert.match(source, /editedCaption !== String\(edition\.caption \|\| ''\)\.trim\(\)/,
  'Approval must reject a caption that differs from the saved revision');
assert.match(source, /if \(TEST_MODE\) \{ toast\('Condivisione esterna disattivata in modalità prova\.'\); break; \}/,
  'Test mode must not allow external sharing');
assert.match(source, /matchResultEditor\.snapshot \|\| capturePostmatchSnapshot\(\)/,
  'A missing editor snapshot must fall back to the reduced match snapshot, never the full application state.');
assert.doesNotMatch(source, /matchResultEditor\.snapshot \|\| JSON\.parse\(JSON\.stringify\(S\)\)/,
  'Post-match revisions must not persist the entire live application state as a snapshot.');
assert.match(source, /Snapshot partita non valido/,
  'The post-match save flow must reject malformed snapshots before uploading or persisting them.');
assert.match(source, /case 'saveMatchResultGraphic':[\s\S]{0,650}catch \(error\) \{ toast\('Download grafica non riuscito:/,
  'Post-match graphic download failures must be handled locally and shown to the operator.');
assert.match(source, /remove\(\[uploadedPath\]\)[\s\S]{0,550}cleanupError/,
  'A failed Storage cleanup must be detected, including Supabase SDK returned errors.');
assert.match(source, /caricamento temporaneo non è stato eliminato/,
  'The operator must be told when an uploaded orphan may remain and given its storage path.');




console.log('Post-match editorial UI guard tests passed');
