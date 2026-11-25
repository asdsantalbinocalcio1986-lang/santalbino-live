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
assert.match(source, /data-a="sharefb">Condividi su Facebook/, 'Event sharing must offer Facebook sharing.');
assert.match(source, /'sharewa','sharefb'/, 'External event sharing must be blocked in test mode.');
assert.match(source, /case 'sharefb':[\s\S]{0,500}facebook\.com\/sharer\/sharer\.php/, 'Event Facebook sharing must open the share dialog.');
assert.match(source, /S\.socialDrafts\s*=\s*\{\s*matchDay:\s*'',\s*convocati:\s*''\s*\}/, 'Starting a new match must clear previous social drafts.');
assert.match(source, /escapedHashtag = hashtag\.replace\(/, 'Sharing must escape the configured hashtag before building a safe matcher.');
assert.match(source, /new RegExp\('\(\^\|\[\\\\s\(\[\{\]\)' \+ escapedHashtag/, 'Sharing must remove an existing hashtag token even when it is inline in edited text.');
assert.match(source, /textWithoutHashtag[\s\S]{0,500}replace\(\/\\n\{3,\}\//, 'Hashtag removal must normalize excess blank lines before appending the hashtag once.');
assert.match(source, /window\.open\([^\n]*'_blank'\);\s*if \(facebookWindow\) facebookWindow\.opener = null/, 'Facebook popup detection must not rely on noopener return semantics and must sever opener immediately.');
assert.match(source, /window\.open\([^\n]*'_blank'\);\s*if \(whatsappWindow\) whatsappWindow\.opener = null/, 'WhatsApp popup must sever opener immediately.');
assert.match(source, /case 'sharefb':[\s\S]{0,420}window\.open\([^\n]*'_blank'\);\s*if \(popup\) popup\.opener = null/,
  'Event Facebook sharing must detect the popup without noopener return ambiguity and sever opener immediately.');
assert.match(source, /case 'sharewa':[\s\S]{0,1800}window\.open\(waUrl, '_blank'\);\s*if \(whatsappWindow\) whatsappWindow\.opener = null/,
  'WhatsApp event-sharing fallbacks must sever opener without relying on noopener.');



console.log('Social copy editor guard tests passed');
