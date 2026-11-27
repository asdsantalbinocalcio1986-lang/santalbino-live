import assert from 'node:assert/strict';
import { chromium, createBackend, openPage, matchState, archiveRow } from './harness.mjs';

const PAGES = { regia: '/regia.html', index: '/index.html?view=live' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tests = [];
const test = (name, fn, pages = ['regia', 'index']) => pages.forEach(p => tests.push({ name: `[${p}] ${name}`, fn, url: PAGES[p], p }));
const S = page => page.evaluate(() => JSON.parse(JSON.stringify(S)));
const admin = async page => page.waitForSelector('[data-rtab]');
const tab = (page, name) => page.click(`[data-rtab="${name}"]`);
const addNote = (page, note) => page.evaluate(n => { addEvent({ type: 'note', team: 'home', min: '10', note: n }); }, note);

test('ogni scheda si apre senza errori JavaScript', async ({ open }) => {
  const state = matchState();
  const { page } = await open(createBackend(state, [archiveRow('a1', matchState({ match: { ...state.match, pollId: 'old' } }))]));
  await admin(page);
  for (const name of await page.$$eval('[data-rtab]', els => els.map(e => e.dataset.rtab))) { await tab(page, name); await sleep(150); }
  await page.click('.top-actions-desktop [data-a="mode"]');
  for (const name of await page.$$eval('[data-tab]', els => els.map(e => e.dataset.tab))) { await page.click(`[data-tab="${name}"]`); await sleep(150); }
  assert.deepEqual(page.errors, []);
});

test('modifica fatta offline viene inviata al ritorno della rete', async ({ open }) => {
  const backend = createBackend(matchState());
  const { page, ctx } = await open(backend); await admin(page);
  backend.offline = true; await ctx.setOffline(true);
  await addNote(page, 'nota offline'); await sleep(500);
  backend.offline = false; await ctx.setOffline(false); await sleep(1200);
  assert.ok(backend.state.events.some(e => e.note === 'nota offline'), 'evento non arrivato al server');
});

test('al ritorno della rete una versione remota più nuova non cancella le modifiche locali', async ({ open }) => {
  const backend = createBackend(matchState());
  const { page, ctx } = await open(backend); await admin(page);
  backend.offline = true; await ctx.setOffline(true);
  await addNote(page, 'nota offline'); await sleep(500);
  backend.state = matchState({ rev: 20, events: [] });
  backend.offline = false; await ctx.setOffline(false); await sleep(1200);
  assert.ok((await S(page)).events.some(e => e.note === 'nota offline'), 'modifica locale sovrascritta');
  assert.equal(await page.evaluate(() => syncState), 'error', 'il conflitto deve essere segnalato');
});

test('una lettura remota tardiva non sovrascrive una modifica fatta nel frattempo', async ({ open }) => {
  const backend = createBackend(matchState());
  const { page } = await open(backend); await admin(page); await sleep(300);
  backend.state = matchState({ rev: 30, events: [] });
  const release = backend.hold('live_state');
  await page.evaluate(() => { void refreshRemoteState('test'); });
  await sleep(100);
  await addNote(page, 'inserita durante la lettura');
  release(); await sleep(800);
  assert.ok((await S(page)).events.some(e => e.note === 'inserita durante la lettura'));
});

test('la verifica archivio di una partita precedente non marca archiviata quella nuova', async ({ open }) => {
  const state = matchState();
  const backend = createBackend(state, [archiveRow('a1', state)]);
  const { page } = await open(backend); await admin(page);
  const release = backend.hold('match_archive');
  await page.evaluate(() => { void refreshCurrentArchiveStatus(); });
  await sleep(100);
  await page.evaluate(() => resetMatch());
  release(); await sleep(300);
  assert.equal(await page.evaluate(() => currentArchived), false);
});

test('la nuova partita non eredita dati dalla precedente', async ({ open }) => {
  const state = matchState({
    clock: { phase: 'ft', t0: 0, finishedAt: Date.now() },
    mvp: { votes: { x: 1 }, link: 'x', candidateKeys: ['home|Rossi'], candidatePlayers: [{ key: 'home|Rossi', side: 'home', name: 'Rossi' }] },
    socialDrafts: { matchDay: 'vecchio', convocati: 'vecchio' }
  });
  const { page } = await open(createBackend(state)); await admin(page);
  const out = await page.evaluate(() => {
    photos.home = { url: 'data:,', blob: new Blob() };
    resetMatch();
    return { S: JSON.parse(JSON.stringify(S)), photo: photos.home };
  });
  assert.deepEqual(out.S.events, []);
  assert.deepEqual(out.S.mvp.candidateKeys, []);
  assert.deepEqual(out.S.mvp.candidatePlayers, []);
  assert.equal(out.photo, null, 'foto della distinta precedente ancora presente');
  assert.ok(!out.S.socialDrafts?.matchDay && !out.S.socialDrafts?.convocati);
  assert.equal(out.S.convocati, '');
});

test('nuova partita: convocati e formazioni si inseriscono, salvano e si ricaricano senza residui precedenti', async ({ open }) => {
  const old = matchState({
    convocati: 'VecchioConvocato',
    rosters: { home: '1 VecchioTitolare', away: '1 VecchioAvversario' },
    publication: { published: { convocati: 'VecchioConvocato', rosters: { home: '1 VecchioTitolare', away: '1 VecchioAvversario' } }, pending: null, publishedAt: '2026-11-20T12:00:00Z' }
  });
  const backend = createBackend(old);
  const { page, ctx } = await open(backend); await admin(page);
  await page.evaluate(() => resetMatch());
  await tab(page, 'convocati');
  assert.equal(await page.inputValue('[data-convocati]'), '');
  await page.fill('[data-convocati]', 'NuovoConvocato Uno\\nNuovoConvocato Due');
  await page.click('[data-a="saveconvocati"]'); await sleep(900);
  await tab(page, 'lineup');
  assert.equal(await page.inputValue('[data-roster="home"]'), '');
  assert.equal(await page.inputValue('[data-roster="away"]'), '');
  await page.fill('[data-roster="home"]', '1 NuovoPortiere\\n2 NuovoDifensore\\n---\\n12 NuovaRiserva');
  await page.click('[data-a="savelineup"][data-s="home"]'); await sleep(700);
  await page.fill('[data-roster="away"]', '1 PortiereOspite\\n2 DifensoreOspite');
  await page.click('[data-a="savelineup"][data-s="away"]'); await sleep(900);
  const saved = backend.state;
  assert.equal(saved.convocati, 'NuovoConvocato Uno\\nNuovoConvocato Due');
  assert.equal(saved.rosters.home, '1 NuovoPortiere\\n2 NuovoDifensore\\n---\\n12 NuovaRiserva');
  assert.equal(saved.rosters.away, '1 PortiereOspite\\n2 DifensoreOspite');
  assert.equal(saved.publication.pending.status, 'draft');
  assert.equal(saved.publication.pending.content.convocati, saved.convocati);
  assert.equal(saved.publication.pending.content.rosters.home, saved.rosters.home);
  assert.equal(saved.publication.published.convocati, '');
  assert.equal(saved.publication.published.rosters.home, '');
  await page.reload(); await admin(page); await tab(page, 'lineup');
  assert.equal(await page.inputValue('[data-roster="home"]'), saved.rosters.home);
  assert.equal(await page.inputValue('[data-roster="away"]'), saved.rosters.away);
  await tab(page, 'convocati');
  assert.equal(await page.inputValue('[data-convocati]'), saved.convocati);
  assert.deepEqual(page.errors, []);
});
 
test('una bozza già sincronizzata non viene riproposta al riavvio', async ({ open }) => {
  const backend = createBackend(matchState());
  const { page, ctx } = await open(backend); await admin(page);
  await page.evaluate(() => { commit(false); commit(false); commit(true); });
  await sleep(700);
  const second = await open(backend, { context: ctx }); await admin(second.page); await sleep(300);
  assert.deepEqual(second.page.dialogs, []);
});

test('la bozza non sincronizzata viene proposta dopo la chiusura', async ({ open }) => {
  const backend = createBackend(matchState());
  const { page, ctx } = await open(backend); await admin(page);
  backend.offline = true; await addNote(page, 'da recuperare'); await sleep(500); await page.close();
  backend.offline = false;
  const second = await open(backend, { context: ctx }); await admin(second.page); await sleep(800);
  assert.equal(second.page.dialogs.length, 1);
  assert.ok(backend.state.events.some(e => e.note === 'da recuperare'));
});

test('la bozza di un’altra partita non viene proposta automaticamente', async ({ open }) => {
  const backend = createBackend(matchState());
  const { page, ctx } = await open(backend); await admin(page);
  backend.offline = true; await addNote(page, 'partita A'); await sleep(500); await page.close();
  backend.offline = false;
  const b = matchState({ rev: 5, events: [] }); b.match.pollId = 'match-B'; backend.state = b;
  const second = await open(backend, { context: ctx }); await admin(second.page); await sleep(800);
  assert.deepEqual(second.page.dialogs, []);
  assert.equal(backend.state.match.pollId, 'match-B');
});

test('il pubblico non vede distinte e convocati mai pubblicati, anche in archivio', async ({ open }) => {
  const old = matchState(); old.match.pollId = 'old'; old.convocati = 'SegretoConvocato'; old.rosters.home = '1 SegretoTitolare';
  const backend = createBackend(matchState(), [archiveRow('a1', old)]); backend.admin = false;
  const { page } = await open(backend);
  for (const name of ['archive', 'archiveForms', 'form']) {
    await page.click(`[data-tab="${name}"]`); await sleep(250);
    const html = await page.innerHTML('#main');
    assert.ok(!/Segreto/.test(html), `contenuto non pubblicato visibile nella scheda ${name}`);
  }
});

test('la regia continua a consultare lo snapshot storico completo, senza tabellone', async ({ open }) => {
  const old = matchState(); old.match.pollId = 'old'; old.rosters.home = '1 StoricoTitolare';
  const { page } = await open(createBackend(matchState(), [archiveRow('a1', old)])); await admin(page);
  await tab(page, 'archive'); await sleep(300);
  assert.match(await page.innerHTML('#main'), /StoricoTitolare/);
  assert.equal(await page.isVisible('#hero'), false);
});

test('eliminare una gara archiviata richiede di digitare ELIMINA', async ({ open }) => {
  const old = matchState(); old.match.pollId = 'old';
  const backend = createBackend(matchState(), [archiveRow('a1', old)]);
  const { page } = await open(backend); await admin(page);
  await tab(page, 'archive'); await sleep(300);
  await page.evaluate(() => deleteArchivedMatch('a1')); await sleep(200);
  assert.equal(backend.archive.length, 1, 'un solo OK non deve cancellare');
  page.answer = (_m, type) => type === 'prompt' ? 'ELIMINA' : true;
  await page.evaluate(() => deleteArchivedMatch('a1')); await sleep(200);
  assert.equal(backend.archive.length, 0);
});

test('salvare formazione o convocati non annulla la programmazione', async ({ open }) => {
  const at = new Date(Date.now() + 86400000).toISOString();
  const state = matchState({ publication: { published: null, publishedAt: '', pending: { status: 'scheduled', scheduledAt: at, content: { rosters: { home: '', away: '' }, convocati: '' } } } });
  const { page } = await open(createBackend(state)); await admin(page);
  await tab(page, 'lineup');
  await page.fill('[data-roster="home"]', '1 Modificato');
  await page.click('[data-a="savelineup"][data-s="home"]');
  const pending = (await S(page)).publication.pending;
  assert.equal(pending.status, 'scheduled');
  assert.equal(pending.scheduledAt, at);
  assert.equal(pending.content.rosters.home, '1 Modificato');
});

test('un testo digitato non va perso quando la pagina si ridisegna', async ({ open }) => {
  const { page } = await open(createBackend(matchState())); await admin(page);
  await tab(page, 'lineup');
  await page.fill('[data-roster="home"]', '1 NonAncoraSalvato');
  await page.evaluate(() => renderMain());
  assert.equal(await page.inputValue('[data-roster="home"]'), '1 NonAncoraSalvato');
  await page.evaluate(() => { resetMatch(); });
  assert.equal(await page.inputValue('[data-roster="home"]'), '', 'il testo non deve passare alla partita successiva');
});

test('un rinnovo di sessione non riporta forzatamente in regia', async ({ open }) => {
  const { page } = await open(createBackend(matchState())); await admin(page);
  await page.click('.top-actions-desktop [data-a="mode"]');
  await page.evaluate(() => window.__authEvent('TOKEN_REFRESHED')); await sleep(300);
  assert.equal(await page.evaluate(() => L.mode), 'public');
});

test('la modifica di un evento aggiorna cronaca e punteggio anche con testo social personalizzato', async ({ open }) => {
  const { page } = await open(createBackend(matchState())); await admin(page);
  await page.evaluate(() => { socialOf('e1').text = 'TESTO VECCHIO Rossi'; saveL(); renderMain(); });
  await page.click('.ev[data-id="e1"] [data-a="editevent"]');
  await page.fill('#sheet [data-d="player"]', 'Verdi');
  await page.click('#sheet [data-sub]'); await sleep(200);
  const text = await page.innerText('.ev[data-id="e1"] .t');
  assert.match(text, /Verdi/); assert.doesNotMatch(text, /TESTO VECCHIO/);
});

test('la cronaca pubblica contiene tutti gli eventi della regia', async ({ open }) => {
  const types = ['goal','foul','yellow','red','sub','save','miss','shot','crossbar','corner','freekick','offside','injury','note'];
  const events = types.map((type, i) => ({ id: 'x' + i, type, team: 'home', min: String(i + 1), note: 'n' + i, ts: i }));
  const backend = createBackend(matchState({ events })); backend.admin = false;
  const { page } = await open(backend);
  assert.equal(await page.locator('.tl-list > li').count(), types.length);
  assert.ok(await page.isVisible('.match-timeline'));
  assert.match(await page.innerText('.match-timeline'), /⚽1′/);
  assert.match(await page.innerHTML('.match-timeline'), /🟥4′/);
});

test('sostituzione: suggerimenti coerenti e rifiuto di dati impossibili', async ({ open }) => {
  const events = [{ id: 's1', type: 'sub', team: 'home', out: 'Rossi', inn: 'Riserva', min: '30', ts: 1 }];
  const { page } = await open(createBackend(matchState({ events }))); await admin(page);
  await page.click('[data-q="sub"]');
  const options = async key => {
    const id = await page.getAttribute(`#sheet [data-d="${key}"]`, 'list');
    return page.$$eval(`#${id} option`, els => els.map(e => e.value));
  };
  const out = await options('out'), inn = await options('inn');
  assert.ok(out.includes('Riserva') && !out.includes('Rossi') && !out.includes('Panchina'), 'in campo: ' + out);
  assert.deepEqual(inn, ['Panchina']);
  for (const [o, i] of [['Bianchi', 'Bianchi'], ['Rossi', 'Panchina'], ['Bianchi', 'Riserva']]) {
    await page.fill('#sheet [data-d="out"]', o); await page.fill('#sheet [data-d="inn"]', i);
    await page.click('#sheet [data-sub]'); await sleep(100);
    assert.equal((await S(page)).events.length, 1, `accettata sostituzione impossibile ${o} -> ${i}`);
  }
  await page.fill('#sheet [data-d="out"]', 'Bianchi'); await page.fill('#sheet [data-d="inn"]', 'Panchina');
  await page.click('#sheet [data-sub]'); await sleep(200);
  assert.equal((await S(page)).events.length, 2);
});

test('il tasto Indietro torna alla sezione precedente senza uscire dall’app', async ({ open }) => {
  const { page } = await open(createBackend(matchState()));
  await admin(page);
  const selected = attr => page.getAttribute(`[${attr}][aria-selected="true"]`, attr);
  const walk = async attr => {
    const names = await page.$$eval(`[${attr}]`, els => [...new Set(els.map(e => e.dataset.tab || e.dataset.rtab))]);
    const start = await selected(attr), others = names.filter(n => n !== start).slice(0, 2);
    for (const name of others) await page.click(`[${attr}="${name}"]`);
    for (const expected of [others[0], start]) {
      await page.goBack(); await sleep(250);
      assert.equal(await selected(attr), expected);
    }
    assert.match(page.url(), /(regia|index)\.html/);
  };
  await walk('data-rtab');
  await page.click('.top-actions-desktop [data-a="mode"]');
  await walk('data-tab');
  assert.deepEqual(page.errors, []);
});

test('la scheda MVP si aggiorna senza errori e il layout non sborda su smartphone', async ({ open }) => {
  const old = matchState(); old.match.pollId = 'old'; old.match.away = 'Unione Sportiva Dilettantistica Nome Molto Lungo';
  const { page } = await open(createBackend(matchState(), [archiveRow('a1', old)]), { viewport: { width: 360, height: 740 } }); await admin(page);
  const overflow = async label => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, 'scorrimento orizzontale: ' + label);
  for (const name of await page.$$eval('[data-rtab]', els => els.map(e => e.dataset.rtab))) { await tab(page, name); await sleep(150); await overflow(name); }
  await page.click('.mobile-primary[data-a="mode"]');
  for (const name of await page.$$eval('[data-tab]', els => els.map(e => e.dataset.tab))) { await page.click(`[data-tab="${name}"]`); await sleep(150); await overflow(name); }
  assert.deepEqual(page.errors, []);
});

test('sponsor: bianco in rilievo solo quando il logo resta riconoscibile', async ({ open }) => {
  const { page } = await open(createBackend(matchState())); await admin(page);
  const out = await page.evaluate(async () => {
    const make = draw => new Promise(done => { const c = document.createElement('canvas'); c.width = c.height = 200; draw(c.getContext('2d')); const img = new Image(); img.onload = () => done(createWhiteEmbossedSponsor(img) !== null); img.src = c.toDataURL(); });
    return {
      wordmark: await make(x => { x.fillStyle = '#0a5'; for (let i = 0; i < 6; i++) x.fillRect(10 + i * 30, 60, 12, 80); }),
      opaque: await make(x => { x.fillStyle = '#0a5'; x.fillRect(0, 0, 200, 200); }),
      rounded: await make(x => { x.fillStyle = '#0a5'; x.beginPath(); x.roundRect(0, 0, 200, 200, 30); x.fill(); x.fillStyle = '#fff'; x.fillRect(60, 80, 80, 30); }),
      badge: await make(x => { x.fillStyle = '#012'; x.beginPath(); x.arc(100, 100, 80, 0, 7); x.fill(); x.fillStyle = '#ff0'; x.fillRect(50, 70, 100, 60); })
    };
  });
  assert.deepEqual(out, { wordmark: true, opaque: false, rounded: false, badge: false });
});

test('sponsor: la grafica finale usa lo stesso logo scelto per l’anteprima', async ({ open }) => {
  const sponsors = Array.from({ length: 8 }, (_, i) => './assets/logo-home.png?s=' + i);
  const { page } = await open(createBackend(matchState({ media: { library: { goal: '', formation: '', sponsors } } }))); await admin(page);
  await tab(page, 'editor');
  for (let round = 0; round < 5; round++) {
    const [preview, final] = await page.evaluate(async () => { await openGraphicEditorPreview(); const a = activeSponsorGraphicUrl; beginSponsorGraphicForOutput(); await renderMatchGraphic(S.events[0]); return [a, activeSponsorGraphicUrl]; });
    assert.ok(preview); assert.equal(final, preview);
  }
});

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let failed = 0;
const only = process.env.ONLY || '';
for (const t of tests.filter(t => t.name.includes(only))) {
  const contexts = [];
  const open = async (backend, options = {}) => {
    const page = await openPage(browser, backend, t.url, options);
    contexts.push(page.context());
    return { page, ctx: page.context() };
  };
  try {
    await Promise.race([t.fn({ open }), sleep(30000).then(() => { throw new Error('timeout'); })]);
    console.log('ok   ' + t.name);
  } catch (error) {
    failed++; console.log('FAIL ' + t.name + ' — ' + String(error.message).split('\n')[0].slice(0, 220));
  }
  for (const c of new Set(contexts)) await c.close().catch(() => {});
}

// Pagine pubbliche statiche: home e scheda partita archiviata.
{
  const old = matchState(); old.match.pollId = 'old'; old.convocati = 'SegretoConvocato'; old.rosters.home = '1 SegretoTitolare';
  for (const [name, url] of [['home', '/home.html'], ['preview archivio', '/preview.html?match=old']]) {
    const page = await openPage(browser, createBackend(matchState(), [archiveRow('a1', old)]), url, { viewport: { width: 360, height: 740 } });
    try {
      assert.deepEqual(page.errors, []);
      assert.ok(!/Segreto/.test(await page.content()));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1);
      if (url.includes('preview')) { assert.match(await page.innerText('body'), /RIEPILOGO/); assert.equal(await page.locator('#hero').count(), 0); }
      console.log('ok   ' + name);
    } catch (error) { failed++; console.log('FAIL ' + name + ' — ' + error.message.split('\n')[0]); }
    await page.context().close();
  }
}
await browser.close();
console.log(failed ? `${failed} test falliti` : 'Tutti i test browser superati');
process.exit(failed ? 1 : 0);
