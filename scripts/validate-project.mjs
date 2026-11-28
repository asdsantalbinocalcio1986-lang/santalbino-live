import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync('index.html', 'utf8');
const regia = fs.readFileSync('regia.html', 'utf8');
const testMigration = fs.readFileSync('supabase/migrations/20261120133534_isolated_test_match_mode.sql', 'utf8');
const testGrantMigration = fs.readFileSync('supabase/migrations/20261120133845_tighten_test_state_grants.sql', 'utf8');
const testRpcGrantMigration = fs.readFileSync('supabase/migrations/20261120133923_restrict_test_state_rpc_to_authenticated.sql', 'utf8');
const sql = fs.readFileSync('supabase-phase1-security.sql', 'utf8');
const mvpCandidateMigration = fs.readFileSync('supabase-phase2-mvp-candidates.sql', 'utf8');
const home = fs.readFileSync('home.html', 'utf8');
const preview = fs.readFileSync('preview.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const workflow = fs.readFileSync('.github/workflows/pages.yml', 'utf8');
const socialFunction = fs.readFileSync('supabase/functions/santalive-social-publish/index.ts', 'utf8');
const socialMigration = fs.readFileSync('supabase/migrations/20261123160000_santalbino_social_publications.sql', 'utf8');

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
assert.match(sw, /const CACHE_PREFIX = 'santa-live-shell-';/, 'Il service worker deve usare un namespace cache dedicato');
assert.match(sw, /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE/, 'Il service worker deve eliminare soltanto le proprie cache obsolete');
assert.doesNotMatch(sw, /caches\.match\(/, 'Il service worker non deve leggere cache di altre applicazioni sullo stesso dominio');
assert.match(sw, /cache\.match\(request\)/, 'Le richieste offline devono leggere dalla cache SANTA Live');
assert.match(workflow, /^permissions:\n  contents: read$/m, 'I permessi globali del workflow devono restare in sola lettura');
assert.match(workflow, /^  deploy:[\s\S]*?^    permissions:\n      contents: read\n      pages: write\n      id-token: write/m, 'I permessi di pubblicazione devono essere assegnati soltanto al job deploy');
assert.doesNotMatch(workflow, /^  pages: write$/m, 'pages:write non deve essere globale');
assert.doesNotMatch(workflow, /^  id-token: write$/m, 'id-token:write non deve essere globale');

assert.match(html, /<div id="root" role="main" aria-label="Contenuto SANTA Live">/, 'La pagina pubblica deve esporre un landmark main');
assert.match(regia, /<div id="root" role="main" aria-label="Contenuto SANTA Live">/, 'La regia deve esporre un landmark main');
assert.match(html, /<textarea data-convocati-preview rows="10" readonly aria-label="Testo del post pre-partita">/, 'L’anteprima del post deve avere un nome accessibile');
assert.doesNotMatch(html, /function reportHtml\(|data-tab="report"|\['report',\s*'Resoconto'\]/, 'La pagina pubblica non deve avere la scheda Resoconto');
assert.doesNotMatch(regia, /function reportHtml\(|data-tab="report"|\['report',\s*'Resoconto'\]/, 'La modalità pubblica della regia non deve avere la scheda Resoconto');
assert.doesNotMatch(html, /<textarea id="matchReport"/, 'La pagina pubblica non deve contenere un editor di resoconto');
assert.match(regia, /if \(S\.clock\?\.phase === 'ft' \|\| voteInfo\(\)\.state !== 'none'\) tabs\.push\(\['mvp', 'MVP'\]\)/, 'La modalità pubblica della regia deve mostrare MVP a fine partita');
for (const [file, source] of [['index.html', html], ['regia.html', regia]]) {
  assert.match(source, /S\.clock\?\.finishedAt/, 'Il timer MVP deve avere un timestamp persistente in ' + file);
  assert.match(source, /c\.finishedAt = Date\.now\(\); addPhase\('fulltime'/, 'Il fischio finale deve salvare il timestamp in ' + file);
}
assert.match(html, /<textarea data-edtext rows="5" aria-label="Modifica testo dell’evento">/, 'L’editor del testo evento deve avere un nome accessibile');
assert.doesNotMatch(regia, /Articolo di fine partita|Resoconto finale completo/, 'La regia non deve mostrare l’articolo della cronaca nel resoconto finale');
assert.equal((html.match(/<meta name="theme-color"/g) || []).length, 1, 'La pagina pubblica non deve duplicare theme-color');
assert.equal((regia.match(/<meta name="theme-color"/g) || []).length, 1, 'La regia non deve duplicare theme-color');
for (const [file, source] of [['home.html', home], ['preview.html', preview], ['index.html', html], ['regia.html', regia]]) {
  assert.match(source, /@supabase\/supabase-js@2\.119\.2/, 'Versione Supabase JS non fissata in ' + file);
}
assert.match(home, /\.range\(start,start\+PAGE_SIZE-1\)/, 'Archivio non paginato');
assert.match(sw, /'\.\/index\.html'/, 'Shell offline senza pagina regia');
assert.match(sw, /'\.\/config\.js'/, 'Shell offline senza configurazione');
assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
assert.match(html, /<img src="\$\{esc\(lg\)\}" alt="">/, 'I loghi devono essere escapati negli attributi HTML');
assert.match(html, /const endMinute = curMinute\(\); c\.phase = 'ht'; addPhase\('halftime', endMinute\)/, 'Il recupero del primo tempo deve essere conservato');
assert.match(html, /const endMinute = curMinute\(\); c\.phase = 'ft'; c\.finishedAt = Date\.now\(\); addPhase\('fulltime', endMinute\)/, 'Il recupero del secondo tempo deve essere conservato e datato');
assert.match(html, /const scorerLine = scorers\.length \? 'Marcatori: '/, 'Il riepilogo MATCH RESULT deve preparare la riga dei marcatori');
assert.ok(html.includes("return result + '\\n' + scorerLine;"), 'Il riepilogo MATCH RESULT deve contenere risultato e marcatori');
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
assert.match(html, /function allMvpCandidates\(\)/, 'La pagina pubblica deve ricavare i candidati selezionati dalla regia');
assert.match(html, /state: 'unconfigured'/, 'Il voto pubblico deve restare chiuso se mancano i quattro candidati');
assert.match(mvpCandidateMigration, /jsonb_array_length\(v_state #> '\{mvp,candidateKeys\}'\),0\) <> 4/i, 'Il database deve richiedere esattamente quattro candidati');
assert.match(mvpCandidateMigration, /count\(distinct split_part\(value,'\|',1\)\)[\s\S]*?<> 2/i, 'Il database deve richiedere almeno un candidato per squadra');
assert.match(mvpCandidateMigration, /selected\.value = p_candidate_key/i, 'Il database deve accettare voti soltanto per i candidati selezionati');
assert.match(html, /function allMvpCandidates\(\)/, 'La pagina pubblica deve ricavare i candidati selezionati dalla regia');
assert.match(html, /state: 'unconfigured'/, 'Il voto pubblico deve restare chiuso se mancano i quattro candidati');
assert.match(html, /rpc\(['"]get_santalbino_mvp_vote_counts['"]/);
assert.match(html, /async function refreshMvpVotes\(\)\s*\{\s*if \(TEST_MODE \|\| !db \|\| !CAN_EDIT\) return;/, 'I conteggi MVP non devono essere richiesti da visitatori anonimi o dalla simulazione');
assert.match(html, /const STATE_TABLE = TEST_MODE \? ['"]live_test_state['"] : ['"]live_state['"]/);
assert.ok(html.includes("const convocatiPanel = parseRoster(publicContent().convocati).length ? convocatiPublicHtml() : ''"), 'La pagina pubblica deve mostrare soltanto i convocati pubblicati');
assert.match(html, /function publicContent\(\)/, 'I contenuti pubblici devono essere separati dalle bozze');
assert.match(html, /function saveContentDraft\(\)/, 'Deve essere disponibile il salvataggio in bozza');
assert.match(html, /function scheduleContentPublication\(\)/, 'Deve essere disponibile la programmazione della pubblicazione');
assert.match(html, /function publishContentImmediately\(\)/, 'Deve essere disponibile la pubblicazione immediata');
assert.match(html, /function cancelContentPublication\(\)/, 'Deve essere disponibile l’annullamento della bozza o programmazione');
assert.match(html, /family=Inter:wght@400;500;600;700;800;900/, 'La pagina pubblica deve caricare Inter per le grafiche');
assert.match(html, /FB="\'Inter\',sans-serif",FD="\'Inter\',sans-serif"/, 'La grafica evento pubblica deve usare Inter come font predefinito');
assert.match(html, /fontFamily:'Inter',fontScale:1/, 'L’editor pubblico deve avere Inter come font predefinito');
assert.match(html, /<option value="Inter"/, 'L’editor pubblico deve offrire Inter nella selezione dei caratteri');
assert.match(html, /teamLabelFamily=\(\{Inter:/, 'Le intestazioni delle squadre devono supportare Inter');
assert.match(regia, /function editEvent\(id\)/, 'La regia deve consentire la modifica di un evento già registrato');
assert.match(regia, /function resetMatch\(\) \{[\s\S]*?S = defaults\(\);[\s\S]*?S\.teamLogos = \{ club: clubLogo, opponent: '' \};[\s\S]*?syncTeamLogoPositions\(\);[\s\S]*?clearMatchLocalState\(\);/, 'L’azzeramento della regia deve ricreare lo stato predefinito, conservando soltanto il logo del Sant’Albino associato alla sua identità e cancellando i dati locali della gara precedente');
assert.match(regia, /function normalizeTeamLogoBindings\(state\)/, 'I loghi devono essere associati all’identità delle squadre');
assert.match(regia, /function setLogoForSide\(side, url\)/, 'Il caricamento e la rimozione dei loghi devono seguire la squadra selezionata');
assert.match(regia, /const scorerPhrase = player \? player \+ ' firma la rete per ' \+ team : 'la rete arriva per ' \+ team;/, 'Un gol senza marcatore non deve inventare un autore generico');
assert.ok(regia.includes(".replace(/\\(([a-z])\\)/giu, (_, letter) => '(' + letter.toLocaleUpperCase('it') + ')')"), 'Le sigle tra parentesi nei nomi devono mantenere le maiuscole, ad esempio (C)');
assert.match(regia, /possibleSubs: String\(d\.possibleSubs \|\| ''\)\.trim\(\)/, 'Le sostituzioni devono conservare le possibili alternative');
assert.match(regia, /data-a="editevent"/, 'La timeline della regia deve esporre il comando di modifica evento');
assert.match(regia, /window\.addEventListener\('offline'/, 'La regia deve segnalare la perdita di connessione');
assert.match(regia, /window\.__santalbinoConnectionWatch/, 'La regia deve controllare periodicamente il riallineamento');
const publicationMigration = fs.readFileSync('supabase/migrations/20261122174518_scheduled_public_content.sql', 'utf8');
assert.match(publicationMigration, /create extension if not exists pg_cron/i, 'La pubblicazione programmata deve usare il cron server-side');
assert.match(publicationMigration, /function public\.publish_santalbino_scheduled_content\(\)/i, 'Funzione server-side di pubblicazione programmata mancante');
assert.match(publicationMigration, /cron\.schedule\([\s\S]*?\* \* \* \* \*/i, 'Job cron di pubblicazione al minuto mancante');
assert.match(publicationMigration, /state #>> '\{publication,pending,status\}' = 'scheduled'/i, 'Il job deve pubblicare soltanto contenuti programmati');
assert.match(html, /const SAVE_RPC = TEST_MODE \? ['"]save_santalbino_test_state['"] : ['"]save_santalbino_live_state['"]/);
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
assert.match(regia, /function mvpDraftSelectorHtml\(\)/, 'La regia deve mostrare il selettore dei quattro candidati MVP');
assert.match(regia, /S\.mvp\.candidateKeys = keys/, 'La selezione MVP deve essere salvata nello stato della partita');
assert.match(regia, /publicationControlsHtml\(\) \+ mvpDraftSelectorHtml\(\)/, 'Il selettore MVP deve essere presente nella scheda Formazioni');
assert.match(regia, /story \? 1080 : 1600[\s\S]*story \? 1920 : 1100/, 'La grafica singola deve supportare il formato Storie Instagram 9:16');
assert.match(regia, /const watermarkLogo = panel\.key === 'home' \? homeLogo : awayLogo/, 'La grafica singola deve usare il logo della squadra come filigrana');
assert.match(regia, /x\.fillText\(p\.name \|\| '', textX, yy\)/, 'I nomi devono essere collocati accanto ai numeri di maglia');
assert.match(regia, /panelY \+ \(story \? 102 : 72\)/, 'Le intestazioni e i conteggi delle colonne devono avere righe separate');
assert.match(regia, /const columnTextInset = story \? 22 : 18/, 'Le colonne devono mantenere un margine interno uniforme e simmetrico rispetto alla filigrana');
assert.match(regia, /x\.textAlign = 'left'; x\.textBaseline = 'middle';[\s\S]*drawColumnTitle/, 'Titoli e conteggi delle colonne devono essere allineati a sinistra');
assert.match(regia, /const numberX = left \+ columnTextInset \+ radius/, 'Numeri e nomi devono partire da un asse sinistro comune in ciascuna colonna');
assert.match(regia, /previewLineupStory[\s\S]*instagram-story-1080x1920/, 'La regia deve consentire anteprima e salvataggio del formato Storie');




assert.match(regia, /function autoPublishSocialEvent\(ev\)/, 'La regia deve avere la pubblicazione automatica degli eventi');
assert.match(regia, /if \(TEST_MODE \|\| !CAN_EDIT \|\| !dbReady \|\| !db \|\| !cfg\.enabled \|\| !cfg\.ready \|\| !cfg\.publishingEnabled\) return;/, 'La pubblicazione automatica deve restare bloccata in prova e finché Meta non è verificato e autorizzato');
assert.match(regia, /SOCIAL_AUTO_EVENT_TYPES = \['kickoff', 'goal', 'red', 'halftime', 'fulltime'\]/, 'Gli eventi social automatici devono includere solo le tipologie approvate, compreso il calcio d’inizio');
assert.match(regia, /db\.functions\.invoke\(['"]santalive-social-publish['"]/, 'La regia deve invocare la Edge Function social');
assert.match(regia, /case ['"]retrySocialPublication['"]/, 'Il registro deve consentire un nuovo tentativo senza ripubblicare i canali già riusciti');
assert.match(socialFunction, /auth\.getUser\(bearer\)/, 'La Edge Function deve verificare la sessione autenticata');
assert.match(socialFunction, /META_PUBLISH_ENABLED/, 'La pubblicazione deve avere un interruttore di sicurezza lato server');
assert.match(socialFunction, /if \(!publishingEnabled\)[\s\S]*?403/, 'La Edge Function deve rifiutare ogni pubblicazione finché il blocco server è attivo');
assert.match(socialFunction, /connected_instagram_account/, 'La verifica Meta deve leggere l’account Instagram collegato alla Pagina');
assert.match(socialFunction, /linkedInstagramId !== instagramId/, 'La verifica Meta deve confrontare gli ID di Pagina e account Instagram');
assert.doesNotMatch(socialFunction, /account_type/, 'La verifica non deve dipendere dal campo account_type non documentato');
assert.match(socialFunction, /from\(['"]santalbino_admins['"]\)/, 'La Edge Function deve verificare l’amministratore autorizzato');
assert.match(socialFunction, /santalbino_social_publications/, 'La Edge Function deve registrare gli esiti');
assert.match(socialFunction, /instagramId\}\/media_publish/, 'La Edge Function deve pubblicare i contenuti Instagram');
assert.match(socialFunction, /pageId\}\/photos/, 'La Edge Function deve pubblicare le immagini sulla Pagina Facebook');
assert.match(socialFunction, /santalbino-media\/social\//, 'La Edge Function deve accettare solo immagini nell’archivio social pubblico');
assert.match(socialMigration, /alter table public\.santalbino_social_publications enable row level security/i, 'Il registro social deve avere RLS attivo');
assert.match(socialMigration, /public\.is_santalbino_admin\(\)/i, 'Il registro social deve essere leggibile soltanto dall’amministratore');
assert.match(socialMigration, /unique/i, 'Il registro social deve impedire duplicati per ID evento');
assert.match(fs.readFileSync('README-SOCIAL-META.md', 'utf8'), /META_PAGE_ACCESS_TOKEN/, 'La guida deve descrivere i segreti Meta richiesti');
assert.match(fs.readFileSync('README-SOCIAL-META.md', 'utf8'), /META_PUBLISH_ENABLED/, 'La guida deve descrivere il blocco server che impedisce pubblicazioni premature');

// Marcatori: separa la classifica storica dai marcatori della partita corrente.
assert.match(regia, /function archiveScorersHtml\(\)/, 'La classifica marcatori deve avere un renderer storico dedicato.');
assert.match(regia, /function scorersHtml\(side\)/, 'I marcatori della partita corrente devono mantenere il renderer per squadra.');
assert.match(regia, /t === 'scorers' \? archiveScorersHtml\(\)/, 'La scheda Marcatori deve richiamare la classifica storica e non il renderer della partita corrente.');
assert.doesNotMatch(regia, /function scorersHtml\(\)/, 'La funzione storica non deve essere sovrascritta dalla funzione dei marcatori della partita.');
assert.equal((regia.match(/async function renderPhaseCard\(ev\)/g) || []).length, 1, 'La grafica delle fasi deve avere una sola funzione renderPhaseCard attiva.');

assert.match(regia, /const archiveView = controlRoom \? L\.rtab === 'archive' : \['archive','archiveForms'\]\.includes\(L\.tab\);[\s\S]*?if \(hero\) hero\.hidden = archiveView;/, 'Il tabellone della partita corrente deve sparire quando si consulta lo storico.');
// La pagina pubblica deve separare anche lei i marcatori storici da quelli della gara corrente.
assert.match(html, /function archiveScorersHtml\(\)/, 'La pagina pubblica deve avere un renderer dedicato alla classifica storica.');
assert.match(html, /function scorersHtml\(side\)/, 'La pagina pubblica deve mantenere il renderer dei marcatori della gara corrente.');
assert.match(html, /t === 'scorers' \? archiveScorersHtml\(\)/, 'La scheda Marcatori pubblica deve richiamare la classifica storica.');
assert.doesNotMatch(html, /function scorersHtml\(\)/, 'La pagina pubblica non deve avere due renderer con lo stesso nome.');
assert.equal((html.match(/async function renderPhaseCard\(ev\)/g) || []).length, 1, 'La pagina pubblica deve avere una sola funzione renderPhaseCard attiva.');

// Sponsor: trasformazione conservativa, selezione coerente e fallback sicuro.
assert.match(regia, /function sponsorGraphicSources\(\)/, 'La libreria sponsor deve filtrare i riferimenti in ingresso.');
assert.match(regia, /function createWhiteEmbossedSponsor\(img\)/, 'I loghi trasparenti devono poter essere convertiti in bianco con rilievo.');
assert.match(regia, /transparentPixels < totalPixels \* \.003/, 'La trasformazione bianca deve essere limitata ai loghi con trasparenza reale.');
assert.match(regia, /context\.shadowColor = 'rgba\(0,0,0,\.72\)'/, 'Il logo bianco deve avere un rilievo leggibile.');
assert.match(regia, /function sponsorImageIsCanvasSafe\(img\)/, 'I loghi non leggibili dal canvas devono essere esclusi prima del rendering.');
assert.match(regia, /async function resolveSponsorGraphicImage\(\)[\s\S]*?for \(const url of \[preferred, \.\.\.remaining\]\)/, 'Il generatore deve provare gli sponsor disponibili se il riferimento selezionato non è valido.');
assert.match(regia, /function beginSponsorGraphicForOutput\(\)[\s\S]*?reuseSponsorGraphicOnce = false/, 'La selezione sponsor deve essere riutilizzabile una sola volta tra anteprima e grafica finale.');
assert.match(regia, /reuseSponsorGraphicOnce = true/, 'L’anteprima editor deve conservare la selezione per la generazione finale.');
assert.doesNotMatch(regia, /if\(!activeSponsorGraphicUrl\)\{const list=.*Math\.random\(\).*\}/, 'Il renderer non deve effettuare una seconda estrazione casuale non controllata.');
assert.match(regia, /if \(style\.sponsor === false\) return canvas;/, 'La disattivazione sponsor nell’editor deve essere rispettata.');

console.log('Validazione Sant’Albino Live superata: ' + checked + ' script inline, JSON iniziale, RPC MVP/salvataggio e migrazione SQL.');
