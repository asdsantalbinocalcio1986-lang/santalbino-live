import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../regia.html', import.meta.url), 'utf8');

assert.match(source, /function ensureAppHistoryGuard\(\)[\s\S]*?history\.pushState\(\{ santaliveAppGuard: true \}/,
  'Regia must install an in-app history entry that prevents accidental navigation away from the active match.');
assert.match(source, /ensureAppHistoryGuard\(\);[\s\S]*?window\.addEventListener\('popstate'/,
  'The navigation guard must be installed before handling Back.');
assert.match(source, /if \(sheetHistoryEntry\)[\s\S]*?sh\?\.open\) sh\.close\(\)/,
  'Back must close the event sheet before other transient UI.');
assert.match(source, /const openDialogs = \$\$\('dialog\[open\]'\)[\s\S]*?topDialog\.close\(\)/,
  'Back must close the topmost open dialog.');
assert.match(source, /const mobileMenu = \$\('\.mobile-actions\[open\]'\)[\s\S]*?mobileMenu\.removeAttribute\('open'\)/,
  'Back must close the mobile actions menu before leaving the match.');
assert.match(source, /ensureAppHistoryGuard\(\);\s*history\.pushState\(\{ santaliveAppGuard: true \}/,
  'After handling Back, the app must restore its history guard.');

console.log('Regia back-navigation guard tests passed');
