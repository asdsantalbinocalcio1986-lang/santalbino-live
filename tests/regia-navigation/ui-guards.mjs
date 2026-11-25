import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../regia.html', import.meta.url), 'utf8');

assert.ok(source.includes('function ensureAppHistoryGuard()'), 'Regia must define an in-app history guard.');
assert.ok(source.includes("history.pushState({ santaliveAppGuard: true }, '', location.href);"), 'The guard must create an in-app history entry.');
assert.ok(source.includes("window.addEventListener('popstate'"), 'Regia must handle browser Back.');
assert.ok(source.includes('if (sheetHistoryEntry) {'), 'Back must prioritize the event sheet.');
assert.ok(source.includes("const openDialogs = document.querySelectorAll('dialog[open]');"), 'Back must inspect all open dialogs.');
assert.ok(source.includes('if (topDialog) topDialog.close();'), 'Back must close the topmost open dialog.');
assert.ok(source.includes("const mobileMenu = $('.mobile-actions[open]');"), 'Back must inspect the mobile actions menu.');
assert.ok(source.includes("mobileMenu.removeAttribute('open');"), 'Back must close the mobile actions menu.');
assert.ok(source.includes('ensureAppHistoryGuard();\n  history.pushState({ santaliveAppGuard: true }'), 'Back must restore the app history guard after closing transient UI.');

console.log('Regia back-navigation guard tests passed');
