import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync('index.html', 'utf8');
const regia = fs.readFileSync('regia.html', 'utf8');
const testMigration = fs.readFileSync('supabase/migrations/20261120133534_isolated_test_match_mode.sql', 'utf8');
const testGrantMigration = fs.readFileSync('supabase/migrations/20261120133845_tighten_test_state_grants.sql', 'utf8');
const testRpcGrantMigration = fs.readFileSync('supabase/migrations/20261120133923_restrict_test_state_rpc_to_authenticated.sql', 'utf8');
const sql = fs.readFileSync('supabase-phase1-security.sql', 'utf8');
const home = fs.readFileSync('home.html', 'utf8');
const preview = fs.readFileSync('preview.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

for (const file of ['home.html', 'preview.html']) {
  const page = fs.readFileSync(file, 'utf8');
  const pageScripts = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  let pageChecked = 0;
  for (const [index, attrs, body] of pageScripts) {
    if (/\bsrc\s*=/.test(attrs) || !body.trim()) continue;
    new vm.Script(body, { filename: file + ':inline-script-' + index });
    pageChecked++;
  }
  assert.ok(pageChecked >= 1, 'Script inline mancante o non verificabile in ' + file);
}
new vm.Script(fs.readFileSync('sw.js', 'utf8'), { filename: 'sw.js' });
const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
assert.ok(manifest.icons?.some(icon => icon.src.split('?')[0] === './santa-live-icon.svg' && icon.sizes === '192x192'), 'Icona PWA SVG 192px mancante');
assert.ok(manifest.icons?.some(icon => icon.src.split('?')[0] === './santa-live-icon.svg' && icon.sizes === '512x512'), 'Icona PWA SVG 512px mancante');
assert.ok(fs.existsSync('santa-live-icon.svg'), 'Asset logo SVG mancante');
for (const [file, source] of [['home.html', home], ['preview.html', preview], ['index.html', html], ['regia.html', regia]]) {
  assert.match(source, /@supabase\/supabase-js@2\.119\.1/, 'Versione Supabase JS non fissata in ' + file);
}
assert.match(home, /\.range\(start,start\+PAGE_SIZE-1\)/, 'Archivio non paginato');
assert.match(sw, /'\.\/index\.html'/, 'Shell offline senza pagina regia');
assert.match(sw, /'\.\/config\.js'/, 'Shell offline senza configurazione');
assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
assert.match(html, /<img src="\$\{esc\(lg\)\}" alt="">/, 'I loghi devono essere escapati negli attributi HTML');
assert.match(html, /const endMinute = curMinute\(\); c\.phase = 'ht'; addPhase\('halftime', endMinute\)/, 'Il recupero del primo tempo deve essere conservato');
assert.match(html, /const endMinute = curMinute\(\); c\.phase = 'ft'; addPhase\('fulltime', endMinute\)/, 'Il recupero del secondo tempo deve essere conservato');
assert.match(html, /Per \$\{ourName\}, \$\{resultLabel\}/, 'Il mini riepilogo deve usare una frase grammaticalmente corretta');
assert.match(html, /if \(!S\.match\.pollId\) S\.match\.pollId = uid\(\);/);


const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
let checked = 0;
for (const [index, attrs, body] of scripts) {
  if (/\bsrc\s*=/.test(attrs) || /application\/json/i.test(attrs) || !body.trim()) continue;
  new vm.Script(body, { filename: 'index.html:inline-script-' + index });
  checked++;
}
assert.ok(checked >= 2, 'Attesi gli script inline di avvio e applicazione');

const stateMatch = html.match(/<script\b[^>]*type=["']application\/json["'][^>]*id=["']app-state["'][^>]*>([\s\S]*?)<\/script>/i);
assert.ok(stateMatch, 'Stato iniziale JSON non trovato');
JSON.parse(stateMatch[1]);

assert.match(html, /rpc\(['"]cast_santalbino_mvp_vote['"]/);
assert.match(html, /rpc\(['"]get_santalbino_mvp_vote_counts['"]/);
assert.match(html, /async function refreshMvpVotes\(\)\s*\{\s*if \(TEST_MODE \|\| !db \|\| !CAN_EDIT\) return;/, 'I conteggi MVP non devono essere richiesti da visitatori anonimi o dalla simulazione');
assert.match(html, /const STATE_TABLE = TEST_MODE \? ['"]live_test_state['"] : ['"]live_state['"]/);
assert.match(html, /const SAVE_RPC = TEST_MODE \? ['"]save_santalbino_test_state['"] : ['"]save_santalbino_live_state['"]/);
assert.match(html, /const expectedRev = remoteRev;\s*S\.rev = expectedRev \+ 1;/, 'La pubblicazione deve normalizzare la revisione dopo più modifiche ravvicinate');
assert.match(regia, /const expectedRev = remoteRev;\s*S\.rev = expectedRev \+ 1;/, 'La regia deve normalizzare la revisione prima del salvataggio');
assert.match(html, /const sizes=\{event:\{w:430,h:100,bottom:125\},phase:\{w:430,h:100,bottom:125\},formation:\{w:470,h:120,bottom:20\},matchday:\{w:430,h:90,bottom:20\},convocati:\{w:430,h:100,bottom:30\}\}/, 'Gli sponsor devono avere dimensioni e fascia inferiore dedicate');
assert.match(regia, /const sizes=\{event:\{w:430,h:100,bottom:125\},phase:\{w:430,h:100,bottom:125\},formation:\{w:470,h:120,bottom:20\},matchday:\{w:430,h:90,bottom:20\},convocati:\{w:430,h:100,bottom:30\}\}/, 'La regia deve mantenere il layout sponsor coerente');
assert.match(html, /p=\{x:\(canvas\.width-slot\.w\)\/2,y:canvas\.height-slot\.h-slot\.bottom,w:slot\.w,h:slot\.h\}/, 'Lo sponsor deve essere centrato orizzontalmente');
assert.match(regia, /p=\{x:\(canvas\.width-slot\.w\)\/2,y:canvas\.height-slot\.h-slot\.bottom,w:slot\.w,h:slot\.h\}/, 'Lo sponsor della regia deve essere centrato orizzontalmente');
assert.match(html, /return\{x:\(w-s\.w\)\/2,y:h-s\.h-s\.bottom,w:s\.w,h:s\.h\}/, 'L’anteprima editor deve coincidere con la posizione dello sponsor');
assert.match(regia, /return\{x:\(w-s\.w\)\/2,y:h-s\.h-s\.bottom,w:s\.w,h:s\.h\}/, 'L’anteprima editor della regia deve coincidere con la posizione dello sponsor');
assert.match(html, /W = 1600, H = 1120, canvas = document\.createElement\('canvas'\)/, 'Il Match Day deve riservare una fascia sponsor inferiore');
assert.match(regia, /W = 1600, H = 1120, canvas = document\.createElement\('canvas'\)/, 'Il Match Day della regia deve riservare una fascia sponsor inferiore');
assert.match(html, /W=1600, H=1320, canvas=document\.createElement\('canvas'\)/, 'La grafica convocati deve riservare una fascia sponsor inferiore');
assert.match(regia, /W=1600, H=1320, canvas=document\.createElement\('canvas'\)/, 'La grafica convocati della regia deve riservare una fascia sponsor inferiore');
assert.ok(html.includes("L.fbUrl = L.fbUrl || 'https://www.facebook.com/share/1CLqXZn5YS/'"), 'Il link Facebook ufficiale deve essere predefinito');
assert.ok(regia.includes("L.fbUrl = L.fbUrl || 'https://www.facebook.com/share/1CLqXZn5YS/'"), 'Il link Facebook ufficiale deve essere predefinito nella regia');
assert.ok(html.includes("hashtag: '#SANTALive'"), 'L’hashtag ufficiale deve essere il valore predefinito');
assert.ok(regia.includes("hashtag: '#SANTALive'"), 'L’hashtag ufficiale deve essere il valore predefinito nella regia');
assert.match(html, /db\.rpc\(SAVE_RPC,/);
assert.match(html, /case ['"]startTest['"]/);
assert.match(html, /case ['"]resetTest['"]/);
assert.match(html, /if \(TEST_MODE \|\| !db \|\| !CAN_EDIT\) return;/);
assert.match(html, /const FORCE_PUBLIC_TEST = TEST_MODE && TEST_PARAMS\.get\(['"]view['"]\) === ['"]public['"]/);
assert.doesNotMatch(html, /from\(['"]mvp_votes['"]\)\.(?:select|insert)/, 'L’app non deve leggere o inserire voti direttamente');
assert.doesNotMatch(html, /from\(['"]live_state['"]\)\.upsert/, 'L’app deve usare il salvataggio con controllo revisione');

for (const fn of ['cast_santalbino_mvp_vote','get_santalbino_mvp_vote_counts','save_santalbino_live_state']) {
  assert.ok(sql.includes('function public.' + fn), 'Funzione SQL mancante: ' + fn);
}
assert.match(sql, /revoke all on table public\.mvp_votes from public, anon, authenticated/i);
assert.match(sql, /create policy ["']Only SantAlbino admin can read MVP votes["']/i);
assert.match(sql, /if not public\.is_santalbino_admin\(\) then return; end if;/i, 'I conteggi MVP devono restare riservati all’amministratore');
assert.match(sql, /create policy ["']Admin can read own admin record["']/i, 'La tabella amministratori deve avere una policy RLS per il solo record proprio');
assert.match(sql, /function public\.is_santalbino_admin\(\)[\s\S]*?security invoker/i, 'La funzione di verifica admin deve rispettare RLS');
assert.match(sql, /function public\.get_santalbino_mvp_vote_counts\(p_match_key text\)[\s\S]*?security invoker/i, 'I conteggi MVP devono rispettare RLS');
assert.match(sql, /function public\.save_santalbino_live_state\([\s\S]*?security invoker/i, 'Il salvataggio deve rispettare RLS');
assert.match(sql, /revoke all on function public\.get_santalbino_mvp_vote_counts\(text\) from public, anon, authenticated/i);
assert.match(sql, /grant execute on function public\.get_santalbino_mvp_vote_counts\(text\) to authenticated/i);
assert.match(sql, /revoke all on function public\.save_santalbino_live_state\(bigint,jsonb\) from public, anon, authenticated/i);

assert.match(testMigration, /create table if not exists public\.live_test_state/i);
assert.match(testMigration, /alter table public\.live_test_state enable row level security/i);
assert.match(testMigration, /create policy ["']Public can read SANTA Live test state["']/i);
assert.match(testMigration, /create policy ["']Only SANTA Live admin can update test state["']/i);
assert.match(testMigration, /create or replace function public\.save_santalbino_test_state\(p_expected_rev bigint, p_state jsonb\)/i);
assert.match(testMigration, /alter publication supabase_realtime add table public\.live_test_state/i);
assert.match(testGrantMigration, /revoke all on table public\.live_test_state from public, anon, authenticated/i);
assert.match(testGrantMigration, /grant select on table public\.live_test_state to anon, authenticated/i);
assert.match(testRpcGrantMigration, /revoke all on function public\.save_santalbino_test_state\(bigint, jsonb\) from public, anon/i);
assert.match(testRpcGrantMigration, /grant execute on function public\.save_santalbino_test_state\(bigint, jsonb\) to authenticated/i);

const regiaScripts = [...regia.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
let regiaChecked = 0;
for (const [index, attrs, body] of regiaScripts) {
  if (/\bsrc\s*=/.test(attrs) || /application\/json/i.test(attrs) || !body.trim()) continue;
  new vm.Script(body, { filename: 'regia.html:inline-script-' + index });
  regiaChecked++;
}
assert.ok(regiaChecked >= 1, 'Script inline della regia mancante o non verificabile');



console.log('Validazione Sant’Albino Live superata: ' + checked + ' script inline, JSON iniziale, RPC MVP/salvataggio e migrazione SQL.');
