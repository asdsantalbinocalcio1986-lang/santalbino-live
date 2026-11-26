import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../../regia.html', import.meta.url), 'utf8');
const publicSource = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('../../preview.html', import.meta.url), 'utf8');
const homeSource = readFileSync(new URL('../../home.html', import.meta.url), 'utf8');

assert.match(source, /const canShare = !!edition && edition\.status === 'approved' && !TEST_MODE && !stale;/,
  'WhatsApp sharing must be enabled only for approved revisions whose scorer and chronology snapshot still matches the current match.');
assert.match(source, /if \(!matchResultSnapshotMatchesCurrent\(approved\.snapshot\)\)/,
  'The share action must independently reject an approved graphic whose scorer or chronology has changed.');
assert.match(source, /if \(!matchResultSnapshotMatchesCurrent\(edition\.snapshot\)\)/,
  'Approval must independently reject a stale revision after a scorer or chronology edit.');
assert.match(source, /function matchResultSnapshotKey\(snapshot\)[\s\S]*?const \{ rev, \.\.\.content \} = snapshot[\s\S]*?Object\.keys\(value\)\.sort\(\)[\s\S]*?JSON\.stringify\(canonical\(content\)\)/,
  'Freshness checks must canonicalize nested object keys for PostgreSQL JSONB round-trips while ignoring unrelated state revision numbers.');
assert.match(source, /PostgreSQL JSONB does not preserve JavaScript object-key insertion order/,
  'Snapshot freshness comparison must account for JSONB key ordering so saved current revisions reopen as current.');
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





assert.ok(publicSource.includes("function resetMatch() {") && publicSource.includes("S.publication = { published: { rosters: { home: '', away: '' }, convocati: '' }, pending: null, publishedAt: '' }"),
  'Starting a new match from the public/index control room must clear the previous published convocati, formations and pending publication.');
assert.ok(['RIEPILOGO','CRONACA','FORMAZIONI','CONVOCATI'].every(label => previewSource.includes(label)) && previewSource.includes('data-archive-panel=') && previewSource.includes('SOLA CONSULTAZIONE'),
  'The archived match preview must use live-style sections and remain read-only.');
assert.ok(previewSource.includes("const published=state.publication?.published;") && previewSource.includes("const publishedRosters=publicData.rosters"),
  'The public archive preview must read published content, not a pending editorial draft.');
assert.ok(previewSource.includes("const publicData=published&&typeof published==='object'?published:{rosters:{},convocati:''};"),
  'The archive preview must not reconstruct missing published content from mutable match data.');
assert.ok(publicSource.includes(": { rosters: {home:'',away:''}, convocati: '' };"),
  'The live public view must show no convocati or lineups when the current match has no published snapshot.');
assert.ok(publicSource.includes('localStorage.removeItem(DK)'),
  'Resetting a match must discard any stale local draft before saving the new empty match.');
assert.ok(source.includes('localStorage.removeItem(DK)') && source.includes("S.publication = { published: { rosters: { home: '', away: '' }, convocati: '' }, pending: null, publishedAt: '' }"),
  'The actual control-room page must clear the old draft and reset published convocati/formations for a new match.');
assert.doesNotMatch(source, /if \(!S\.publication\.published\) S\.publication\.published\s*=|if \(!state\.publication\.published\) state\.publication\.published\s*=/,
  'The control room must not recreate a missing publication snapshot from the previous mutable roster/convocati fields.');
assert.doesNotMatch(publicSource, /if \(!S\.publication\.published\) S\.publication\.published\s*=|if \(!state\.publication\.published\) state\.publication\.published\s*=/,
  'The public/index page must not recreate a missing publication snapshot from mutable roster/convocati fields.');
assert.ok(source.includes(": { rosters: {home:'',away:''}, convocati: '' };"),
  'The control room public-content helper must return empty published content if no snapshot exists.');
assert.ok(previewSource.includes("db.from('match_archive').select('state')"),
  'The public preview must load the immutable archived state when the match is no longer live.');
assert.ok(homeSource.includes("CONSULTA PARTITA ARCHIVIATA"),
  'Archived public match cards must clearly indicate that the historical match can be consulted.');

console.log('Post-match editorial UI guard tests passed');


assert.match(source, /\.eq\('graphic_path', uploadedPath\)\s*\.maybeSingle\(\)/, 'Ambiguous RPC failures must verify whether the uploaded graphic is already referenced before cleanup.');
assert.match(source, /if \(verificationError\)[\s\S]{0,500}Il file è stato conservato/, 'If persistence cannot be checked, keep the upload rather than risking deletion of a committed revision.');
assert.match(source, /refreshWarning = 'La bozza è stata salvata, ma lo storico non si è aggiornato/, 'A refresh failure after a successful save must not be treated as a persistence failure.');
assert.match(source, /function releaseMatchResultPreviewUrl\(\)/, 'The generated preview object URL must have a cleanup helper.');
assert.match(source, /dlg\.addEventListener\('close', releaseMatchResultPreviewUrl\)/, 'Closing MATCH RESULT must release its generated preview object URL.');
assert.match(source, /displayMatchResultEdition\(edition\) \{\s*releaseMatchResultPreviewUrl\(\)/, 'Switching to a saved revision must release the generated preview object URL.');

assert.match(source, /if \(button\?\.isConnected\) \{ button\.disabled = false; button\.textContent = 'Salva nuova bozza'; \}/, 'The save control must be re-enabled after a failed or recovered save attempt.');
