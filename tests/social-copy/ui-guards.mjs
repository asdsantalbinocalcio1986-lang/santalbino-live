import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../../regia.html', import.meta.url), 'utf8');

assert.match(source, /function buildMatchDayText\(\)/, 'A dedicated MATCH DAY text template must exist.');
assert.match(source, /function buildConvocatiText\(\)/, 'A dedicated convocati text template must exist.');
assert.match(source, /data-matchday-preview[^>]*aria-label="Testo MATCH DAY"/, 'MATCH DAY text must be editable in the regia.');
assert.match(source, /data-convocati-preview[^>]*aria-label="Testo del post convocati"/, 'Convocati text must be editable in the regia.');
assert.doesNotMatch(source, /data-matchday-preview[^>]*readonly/, 'MATCH DAY text must not be read-only.');
assert.doesNotMatch(source, /data-convocati-preview[^>]*readonly/, 'Convocati text must not be read-only.');
assert.match(source, /S\.socialDrafts\s*=\s*Object\.assign\(\{\s*matchDay:\s*'',\s*convocati:\s*''\s*\}/, 'Social drafts must be initialized in app state.');
assert.match(source, /case 'regenerateMatchDayText':[\s\S]{0,240}buildMatchDayText\(\)/, 'MATCH DAY draft must be refreshable from current match data.');
assert.match(source, /case 'regenerateConvocatiText':[\s\S]{0,240}buildConvocatiText\(\)/, 'Convocati draft must be refreshable from current match data.');
assert.match(source, /case 'copyMatchDayText':[\s\S]{0,500}copyText\(text\)/, 'MATCH DAY action must save and copy the exact edited text.');
assert.match(source, /case 'copyconvocati':[\s\S]{0,500}copyText\(text\)/, 'Convocati action must save and copy the exact edited text.');
assert.ok(source.includes('<h2>Testo MATCH DAY</h2>'), 'The MATCH DAY editor must be clearly labelled.');
assert.match(source, /data-a="shareSocialWhatsApp" data-kind="matchDay"/, 'MATCH DAY must offer WhatsApp sharing.');
assert.match(source, /data-a="shareSocialFacebook" data-kind="matchDay"/, 'MATCH DAY must offer Facebook sharing.');
assert.match(source, /data-a="shareSocialWhatsApp" data-kind="convocati"/, 'Convocati must offer WhatsApp sharing.');
assert.match(source, /data-a="shareSocialFacebook" data-kind="convocati"/, 'Convocati must offer Facebook sharing.');
assert.match(source, /if \(TEST_MODE\) \{ toast\('Condivisione esterna disattivata nella simulazione\.'/,
  'External sharing must remain blocked in test mode.');
assert.match(source, /facebook\.com\/sharer\/sharer\.php\?u=/, 'Facebook must open its link-sharing dialog.');
assert.match(source, /wa\.me\/\?text=/, 'WhatsApp must open with a prefilled message.');

console.log('Social copy editor guard tests passed');
