/* Supabase simulato per i test browser: nessuna richiesta raggiunge un backend reale. */
(() => {
  const call = (op, payload) => window.__backend({ op, payload });
  const channels = [];
  const authCallbacks = [];
  window.__emit = (table, row) => channels.filter(c => c.table === table).forEach(c => c.cb({ new: row }));
  window.__authEvent = async event => {
    const session = await call('session');
    authCallbacks.forEach(cb => cb(event, session));
  };
  window.supabase = {
    createClient() {
      const from = table => {
        const q = { table, filters: [], action: 'select', single: false, range: null };
        const b = {
          select() { return b; }, order() { return b; }, limit() { return b; },
          gte() { return b; }, lte() { return b; }, gt() { return b; }, lt() { return b; }, in() { return b; },
          range(a, z) { q.range = [a, z]; return b; },
          eq(k, v) { q.filters.push([k, v]); return b; },
          delete() { q.action = 'delete'; return b; },
          maybeSingle() { q.single = true; return b; },
          then(ok, ko) { return call('query', q).then(ok, ko); }
        };
        return b;
      };
      return {
        from,
        rpc: (name, args) => call('rpc', { name, args }),
        channel() {
          const ch = {
            on(_type, filter, cb) { channels.push({ table: filter.table, cb }); return ch; },
            subscribe(cb) { if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return ch; }
          };
          return ch;
        },
        auth: {
          onAuthStateChange(cb) { authCallbacks.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
          async getSession() { return { data: { session: await call('session') } }; },
          async getUser() { const s = await call('session'); return { data: { user: s?.user || null } }; },
          async signOut() { return {}; }
        },
        storage: { from: () => ({ async upload() { return {}; }, async remove() { return {}; }, getPublicUrl: () => ({ data: { publicUrl: '' } }), async createSignedUrl() { return { data: { signedUrl: '' } }; } }) },
        functions: { async invoke() { return { data: {} }; } }
      };
    }
  };
})();
