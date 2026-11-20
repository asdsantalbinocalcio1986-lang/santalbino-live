import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync('index.html', 'utf8');
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
assert.ok(manifest.icons?.some(icon => icon.src === './santa-live-icon.svg' && icon.sizes === '192x192'), 'Icona PWA SVG 192px mancante');
assert.ok(manifest.icons?.some(icon => icon.src === './santa-live-icon.svg' && icon.sizes === '512x512'), 'Icona PWA SVG 512px mancante');
assert.ok(fs.existsSync('santa-live-icon.svg'), 'Asset logo SVG mancante');
for (const [file, source] of [['home.html', home], ['preview.html', preview], ['index.html', html]]) {
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
assert.match(html, /async function refreshMvpVotes\(\)\s*\{\s*if \(!db \|\| !CAN_EDIT\) return;/, 'I conteggi MVP non devono essere richiesti dai visitatori anonimi');
assert.match(html, /rpc\(['"]save_santalbino_live_state['"]/);
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


console.log('Validazione Sant’Albino Live superata: ' + checked + ' script inline, JSON iniziale, RPC MVP/salvataggio e migrazione SQL.');
