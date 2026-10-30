// cauce. router — in-browser, hazard-aware driving router for the Guadalajara metro area (ZMG).
// Same API as the former OSRM-demo stub, plus extras. Docs: /labs/shared/router/README.md
//   const router = await loadRouter();
//   const r = await router.route([lon,lat], [lon,lat], { avoid, hazardIds, mode, compare });
//   -> { coordinates, distance_m, duration_s, steps:[{instruction, distance_m, location, ...}], avoided:[...], exposure:[...], engine, ... }
// Road data © OpenStreetMap contributors, ODbL 1.0. Runs in a module Web Worker; falls back to the main thread (and works in Node 18+).
const HERE = new URL('./', import.meta.url).href;
let shared = null;

export async function loadRouter(opts = {}) {
  const key = JSON.stringify([opts.worker !== false, opts.hazardIndexUrl || '', opts.base || '']);
  if (!opts.fresh && shared && shared.key === key) return shared.promise;
  const promise = create(opts);
  shared = { key, promise };
  promise.catch(() => { if (shared && shared.promise === promise) shared = null; });
  return promise;
}

async function create(opts) {
  const base = opts.base || HERE;
  const canWorker = opts.worker !== false && typeof Worker !== 'undefined' && typeof window !== 'undefined';
  if (canWorker) {
    try { return await viaWorker(base, opts); }
    catch (e) { console.warn('[cauce router] Web Worker no disponible, uso hilo principal:', e && e.message); }
  }
  const { createCore } = await import('./router-core.js');
  const core = await createCore({ base, hazardIndexUrl: opts.hazardIndexUrl });
  return api(core.info, 'main-thread', {
    route: async (a, b, o) => core.route(a, b, o || {}),
    nearest: async p => core.nearest(p),
    hazards: () => core.hazards(),
    preload: ids => core.preload(ids),
    reloadHazards: () => core.reloadHazards(),
    close: () => {}
  });
}

function viaWorker(base, opts) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./router-worker.js', import.meta.url), { type: 'module', name: 'cauce-router' });
    let seq = 0, done = false; const pending = new Map();
    w.onmessage = ev => {
      const { id, ok, result, error } = ev.data || {}; const p = pending.get(id); if (!p) return; pending.delete(id);
      if (ok) p.resolve(result); else { const e = new Error((error && error.message) || 'router error'); if (error && error.code) e.code = error.code; p.reject(e); }
    };
    w.onerror = ev => {
      const msg = 'router worker: ' + ((ev && ev.message) || 'error');
      for (const p of pending.values()) p.reject(new Error(msg)); pending.clear();
      if (!done) { done = true; w.terminate(); reject(new Error(msg)); }
    };
    const call = (cmd, ...args) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { resolve: res, reject: rej }); w.postMessage({ id, cmd, args }); });
    call('init', { base, hazardIndexUrl: opts.hazardIndexUrl }).then(info => {
      done = true;
      resolve(api(info, 'worker', {
        route: (a, b, o) => call('route', a, b, cloneOpts(o)),
        nearest: p => call('nearest', p),
        hazards: () => call('hazards'),
        preload: ids => call('preload', ids),
        reloadHazards: () => call('reloadHazards'),
        close: () => w.terminate()
      }));
    }, e => { if (!done) { done = true; w.terminate(); reject(e); } });
  });
}

function cloneOpts(o) {
  const c = { ...(o || {}) };
  if (typeof c.hazardCost === 'function') c.hazardCost = { source: c.hazardCost.toString() }; // must be self-contained (no closures)
  return c;
}

function api(info, thread, impl) {
  return { engine: info.engine, ready: true, thread, info: () => info, ...impl };
}
