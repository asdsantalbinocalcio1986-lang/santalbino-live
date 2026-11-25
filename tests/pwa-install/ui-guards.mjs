import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const home = readFileSync(new URL('../../home.html', import.meta.url), 'utf8');

assert.match(home, /id="installAndroid"[^>]*>[^<]*ANDROID/,
  'The public home page must expose a dedicated Android install button.');
assert.match(home, /id="installIos"[^>]*>[^<]*IPHONE \/ IPAD/,
  'The public home page must expose a dedicated iPhone/iPad install button.');
assert.match(home, /window\.addEventListener\('beforeinstallprompt'/,
  'Android Chrome must use the native PWA install prompt when it is available.');
assert.match(home, /platform==='ios'[\\s\\S]*?Safari[\\s\\S]*?Aggiungi alla schermata Home/,
  'iOS users must receive accurate Safari Add to Home Screen instructions.');
assert.match(home, /platform==='android'[\\s\\S]*?Google Chrome[\\s\\S]*?Installa app[\\s\\S]*?Aggiungi a schermata Home/,
  'Android users without a native install prompt must receive browser installation instructions.');
assert.match(home, /id="installHelp"[^>]*aria-labelledby=/[^>]*role=/,
  'Install instructions must be exposed in an accessible dialog.');
assert.match(home, /id="closeInstallHelp"/,
  'Install instructions must provide a visible close control.');
assert.doesNotMatch(home, /href="https:\/\/(play\.google\.com|apps\.apple\.com)/,
  'Do not advertise fictitious app-store listings: SANTA Live is currently installed as a PWA.');

console.log('PWA install UI guards: OK');
