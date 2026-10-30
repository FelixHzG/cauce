// cauce. router — module Web Worker host for router-core.js (spawned by router.js).
import { createCore } from './router-core.js';
let corePromise = null;
self.onmessage = async (ev) => {
  const { id, cmd, args = [] } = ev.data || {};
  try {
    let result;
    if (cmd === 'init') { corePromise ||= createCore(args[0]); result = (await corePromise).info; }
    else {
      const core = await corePromise;
      if (cmd === 'route') result = await core.route(args[0], args[1], args[2] || {});
      else if (cmd === 'nearest') result = core.nearest(args[0]);
      else if (cmd === 'hazards') result = await core.hazards();
      else if (cmd === 'preload') result = await core.preload(args[0]);
      else if (cmd === 'reloadHazards') result = await core.reloadHazards();
      else throw new Error('comando desconocido: ' + cmd);
    }
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: { message: String((e && e.message) || e), code: e && e.code } });
  }
};
