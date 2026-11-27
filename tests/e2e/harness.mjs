import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ORIGIN = 'http://santalive.test';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

/** Backend in memoria con lo stesso controllo di revisione della RPC di salvataggio. */
export function createBackend(state, archive = []) {
  const backend = { state, archive, admin: true, offline: false, gates: {}, saves: [] };
  backend.hold = name => { let release; const wait = new Promise(r => { release = r; }); backend.gates[name] = wait; return () => { delete backend.gates[name]; release(); }; };
  backend.handle = async ({ op, payload }) => {
    if (op === 'session') return backend.admin ? { user: { id: 'admin' } } : null;
    const name = op === 'rpc' ? payload.name : payload.table;
    // La lettura viene fotografata subito: la risposta trattenuta resta "vecchia".
    const gate = backend.gates[name];
    const result = backend.offline ? { data: null, error: { message: 'Failed to fetch' } } : run(op, payload);
    if (gate) await gate;
    return result;
  };
  function run(op, p) {
    if (op === 'rpc') {
      if (p.name === 'is_santalbino_admin') return { data: backend.admin, error: null };
      if (p.name.startsWith('save_santalbino')) {
        const current = Number(backend.state.rev || 0);
        if (Number(p.args.p_expected_rev) !== current) return { data: null, error: { code: '40001', message: 'conflict' } };
        backend.state = structuredClone(p.args.p_state); backend.saves.push(backend.state);
        return { data: true, error: null };
      }
      return { data: [], error: null };
    }
    if (p.table === 'live_state' || p.table === 'live_test_state') return { data: { state: structuredClone(backend.state) }, error: null };
    if (p.table === 'match_archive') {
      let rows = backend.archive.filter(row => p.filters.every(([k, v]) => String(row[k]) === String(v)));
      if (p.action === 'delete') { backend.archive = backend.archive.filter(row => !rows.includes(row)); return { data: rows.map(r => ({ id: r.id })), error: null }; }
      const count = rows.length;
      if (p.range) rows = rows.slice(p.range[0], p.range[1] + 1);
      return { data: structuredClone(p.single ? rows[0] || null : rows), count, error: null };
    }
    return { data: p.single ? null : [], count: 0, error: null };
  }
  return backend;
}

export async function openPage(browser, backend, url, { viewport = { width: 1280, height: 900 }, context } = {}) {
  const ctx = context || await browser.newContext({ viewport, serviceWorkers: 'block' });
  if (!context) {
    await ctx.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.href.includes('@supabase/supabase-js')) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(path.join(ROOT, 'tests/e2e/mock-supabase.js')) });
      if (u.origin !== ORIGIN) return route.fulfill({ status: 204, body: '' });
      if (u.pathname === '/config.js') return route.fulfill({ contentType: 'text/javascript', body: "window.SANTALBINO_CONFIG={supabaseUrl:'https://mock.invalid',supabaseAnonKey:'mock'};" });
      const file = path.join(ROOT, decodeURIComponent(u.pathname));
      if (!file.startsWith(ROOT) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: readFileSync(file) });
    });
    await ctx.exposeFunction('__backend', message => backend.handle(message));
  }
  const page = await ctx.newPage();
  page.errors = [];
  page.dialogs = [];
  page.answer = () => true;
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', async d => {
    page.dialogs.push(d.message());
    const reply = page.answer(d.message(), d.type());
    if (reply === false || reply === null) await d.dismiss();
    else await d.accept(typeof reply === 'string' ? reply : undefined);
  });
  await page.goto(ORIGIN + url);
  await page.waitForTimeout(500);
  return page;
}

export function matchState(overrides = {}) {
  return {
    rev: 5,
    match: { pollId: 'match-A', home: "ASD Sant'Albino Terme", away: 'Avversari A', comp: 'Terza Categoria', venue: 'Campo', date: '2026-11-22', time: '14:30', ourSide: 'home', hashtag: '#SANTALive', attackDirectionFirst: 'left' },
    logos: { home: '', away: '' },
    rosters: { home: '1 Rossi\n2 Bianchi\n3 Verdi\n4 Neri\n5 Gialli\n6 Blu\n7 Viola\n8 Rosa\n9 Bruni\n10 Conti\n11 Greco\n---\n12 Riserva\n13 Panchina', away: '1 Portiere\n2 Terzino' },
    convocati: 'Rossi\nBianchi',
    publication: { published: { rosters: { home: '', away: '' }, convocati: '' }, pending: null, publishedAt: '' },
    clock: { phase: 'p1', t0: Date.now() - 600000, finishedAt: 0 },
    mvp: { votes: {}, candidateKeys: [], candidatePlayers: [] },
    media: {},
    events: [{ id: 'e1', type: 'goal', kind: 'azione', team: 'home', min: '5', player: 'Rossi', ts: 1 }],
    ...overrides
  };
}

export function archiveRow(id, state) {
  return { id, poll_id: state.match.pollId, match_date: state.match.date, competition: state.match.comp, venue: state.match.venue, home_team: state.match.home, away_team: state.match.away, home_score: 1, away_score: 0, state, archived_at: '2026-11-22T17:00:00Z' };
}
