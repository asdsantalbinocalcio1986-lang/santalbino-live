import assert from 'node:assert/strict';
import vm from 'node:vm';
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

function harness({ dialogs = [], mobileOpen = false, sheetOpen = false } = {}) {
  let onPopState = null;
  const history = {
    state: null, pushes: 0, backs: 0,
    pushState(state) { this.state = state; this.pushes++; },
    back() { this.backs++; }
  };
  const sheet = { open: sheetOpen, closed: false, close() { this.open = false; this.closed = true; } };
  const mobileMenu = {
    open: mobileOpen,
    removeAttribute(name) { if (name === 'open') this.open = false; }
  };
  const context = {
    history,
    location: { href: 'https://example.test/regia.html' },
    window: { addEventListener(name, callback) { if (name === 'popstate') onPopState = callback; } },
    document: { querySelectorAll(selector) { return selector === 'dialog[open]' ? dialogs.filter(item => item.open) : []; } },
    $: selector => selector === '#sheet' ? sheet : selector === '.mobile-actions[open]' && mobileMenu.open ? mobileMenu : null
  };
  const start = source.indexOf('let draft = null, textManual = false, sheetHistoryEntry = false;');
  const end = source.indexOf('function openSheet(', start);
  assert.ok(start >= 0 && end > start, 'Could not isolate the regia history handler.');
  const snippet = source.slice(start, end) + '\nglobalThis.__state = () => ({ sheetHistoryEntry, appHistoryGuardReady });';
  vm.runInNewContext(snippet, context);
  return { context, history, sheet, mobileMenu, dialogs, pop: () => onPopState(), state: () => context.__state() };
}

{
  const h = harness();
  assert.equal(h.history.pushes, 1, 'Initial load must install exactly one app guard.');
  h.pop();
  assert.equal(h.history.pushes, 2, 'Back with no overlays must restore the app guard.');
  assert.equal(h.history.state.santaliveAppGuard, true);
}
{
  const h = harness({ sheetOpen: true });
  h.context.pushSheetHistory();
  h.pop();
  assert.equal(h.sheet.closed, true, 'Back must close the event sheet.');
  assert.equal(h.state().sheetHistoryEntry, false);
  assert.equal(h.history.state.santaliveAppGuard, true);
}
{
  const dialogs = [{ open: true, closed: false, close() { this.open = false; this.closed = true; } },
    { open: true, closed: false, close() { this.open = false; this.closed = true; } }];
  const h = harness({ dialogs });
  h.pop();
  assert.equal(dialogs[0].open, true, 'Back must not close dialogs below the topmost one.');
  assert.equal(dialogs[1].closed, true, 'Back must close only the topmost dialog.');
}
{
  const h = harness({ mobileOpen: true });
  h.pop();
  assert.equal(h.mobileMenu.open, false, 'Back must close the mobile actions menu.');
}
{
  const h = harness({ sheetOpen: true });
  h.context.pushSheetHistory();
  h.context.closeSheet();
  assert.equal(h.sheet.closed, true, 'Manual close must close the event sheet.');
  assert.equal(h.history.backs, 1, 'Manual close must consume the sheet history entry.');
  assert.equal(h.state().sheetHistoryEntry, false);
}

console.log('Regia back-navigation guard tests passed (static and behavioral simulations)');
