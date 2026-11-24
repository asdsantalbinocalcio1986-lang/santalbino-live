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

console.log('Post-match editorial UI guard tests passed');
