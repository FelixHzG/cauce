// nav-juguete · routing glue (browser + Node).
// Primary path: the shared cauce. router (/labs/shared/router/router.js) — fastest route with hazard accounting
// (`compare:true` → normal.crossed), a reroute point P before the first crossed hazard, and a safe route P → B
// (`hazardIds`), which reports `avoided`, `crossed` and `exposure`.
// Fallback path (only while the shared router is still the OSRM stub): public OSRM demo alternatives + via-points
// beside crossed hazards, scored as duration + penalty per crossed IMEPLAN polygon. Labelled "provisional" on screen.
import { Line, GF, exposure } from './geo.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

function rerouteAt(first, length) { return Math.max(0, clamp(first - 1500, Math.min(400, first * .5), first - 250)); }

export async function planRoutes(rt, from, to, { hazardIds = [], hazards = [], log = () => {} } = {}) {
  const real = rt && rt.ready && !/stub/i.test(rt.engine || '');
  if (!hazardIds.length) {
    const f = await rt.route(from, to, {});
    return { from, to, fastest: f, reroute: null, safe: null, method: real ? 'router' : 'stub', engine: f.engine, hazardIds, events: { fastCrossed: [], avoided: [], safeCrossed: [], safeNear: [] } };
  }
  return real ? viaRouter(rt, from, to, hazardIds, log) : provisional(rt, from, to, hazards, hazardIds, log);
}

const ev = (e, line) => ({
  layer: e.layer, kind: e.kind, id: e.id, label: e.label || '', location: e.location, feature_location: e.feature_location || e.location,
  props: e.properties || {}, distance_m: e.distance_m ?? 0, s: line ? line.project(GF.xy(e.location)).s : 0,
});

async function viaRouter(rt, from, to, hazardIds, log) {
  const cmp = await rt.route(from, to, { hazardIds, compare: true, exposureRadius_m: 60 });
  const normal = cmp.normal || cmp;
  const fl = new Line(normal.coordinates, GF);
  const crossed = (normal.crossed || []).map(e => ev(e, fl)).sort((a, b) => a.s - b.s);
  log(`ruta rápida: ${(normal.distance_m / 1000).toFixed(1)} km, cruza ${crossed.length}`);
  if (!crossed.length) {
    return { from, to, fastest: slim(normal), reroute: null, safe: null, method: 'router', engine: normal.engine, hazardIds, events: { fastCrossed: [], avoided: [], safeCrossed: [], safeNear: (normal.exposure || []).map(e => ev(e, fl)) } };
  }
  const sP = rerouteAt(crossed[0].s, fl.length); const P = fl.at(sP);
  const safe = await rt.route(P, to, { hazardIds, exposureRadius_m: 220 });
  const sl = new Line(safe.coordinates, GF);
  const stillCrossed = new Set((safe.crossed || []).map(e => e.layer + ':' + e.id));
  const avoided = crossed.filter(c => c.s > sP - 30 && !stillCrossed.has(c.layer + ':' + c.id));
  const safeCrossed = (safe.crossed || []).map(e => ev(e, sl));
  const safeNear = (safe.exposure || []).filter(e => !stillCrossed.has(e.layer + ':' + e.id) && (e.distance_m ?? 0) > 25).map(e => ev(e, sl));
  log(`ruta segura desde P: ${(safe.distance_m / 1000).toFixed(1)} km, evita ${avoided.length}, cruza ${safeCrossed.length}`);
  return { from, to, fastest: slim(normal), reroute: { s: sP, point: P }, safe: slim(safe), method: 'router', engine: safe.engine, hazardIds, events: { fastCrossed: crossed, avoided, safeCrossed, safeNear } };
}
function slim(r) { return { coordinates: r.coordinates, distance_m: r.distance_m, duration_s: r.duration_s, steps: (r.steps || []).map(s => ({ instruction: s.instruction, distance_m: s.distance_m, duration_s: s.duration_s, location: s.location, type: s.type, modifier: s.modifier, name: s.name })), engine: r.engine }; }

// ---- provisional fallback (stub router only) ---------------------------------------------------------
function osrmToRoute(r) {
  const steps = r.legs.flatMap((l, li) => (l.steps || []).filter(s => !(li < r.legs.length - 1 && s.maneuver.type === 'arrive') && !(li > 0 && s.maneuver.type === 'depart')))
    .map(s => ({ instruction: [s.maneuver.type, s.maneuver.modifier, s.name].filter(Boolean).join(' '), distance_m: s.distance, location: s.maneuver.location }));
  return { coordinates: r.geometry.coordinates, distance_m: r.distance, duration_s: r.duration, steps, engine: 'osrm-demo + desvío provisional cauce.' };
}
async function osrm(points, alternatives = false) {
  const u = `${OSRM}${points.map(p => p.map(v => v.toFixed(6)).join(',')).join(';')}?overview=full&geometries=geojson&steps=true${alternatives ? '&alternatives=3' : ''}`;
  for (let k = 0; k < 3; k++) {
    try { const j = await (await fetch(u)).json(); if (j.code === 'Ok') return j.routes.map(osrmToRoute); } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 900 * (k + 1)));
  }
  return [];
}
function reversals(line) { let n = 0; for (let s = 40; s < line.length - 40; s += 25) { const a = line.heading(s, 30, 0, 3), b = line.heading(s, 0, 30, 3); if (Math.abs(((b - a + 540) % 360) - 180) > 150) n++; } return n; }
function score(route, hazards) { const line = new Line(route.coordinates, GF); const ex = exposure(line, hazards); return { line, ex, cost: route.duration_s + ex.penalty + reversals(line) * 150 }; }
const hzEv = (n, line) => ({ layer: n.h.layerId, kind: n.h.kind, id: n.h.name, label: n.h.ref || n.h.name, location: line.at(n.s), feature_location: n.h.c, props: n.h.props, distance_m: n.d, s: n.s });
async function provisional(rt, from, to, hazards, hazardIds, log) {
  const fast = await rt.route(from, to, {});
  const fl = new Line(fast.coordinates, GF); const ef = exposure(fl, hazards);
  const crossed = ef.hits.map(n => hzEv(n, fl));
  if (!crossed.length) return { from, to, fastest: fast, reroute: null, safe: null, method: 'provisional', engine: fast.engine, hazardIds, events: { fastCrossed: [], avoided: [], safeCrossed: [], safeNear: [] } };
  const sP = rerouteAt(crossed[0].s, fl.length); const P = fl.at(sP);
  let cands = await osrm([P, to], true);
  let scored = cands.map(r => ({ r, ...score(r, hazards) })).sort((a, b) => a.cost - b.cost);
  for (let round = 0; round < 2 && scored.length && scored[0].ex.hits.length; round++) {
    const best = scored[0]; const vias = [];
    for (const hit of best.ex.hits.slice(0, 2)) {
      const hd = best.line.heading(hit.s, 60, 60) * Math.PI / 180, nx = Math.cos(hd), ny = -Math.sin(hd), rad = Math.sqrt(hit.h.area) / 2;
      for (const off of [rad + 350, rad + 800]) for (const side of [1, -1]) vias.push(GF.ll([hit.h.cxy[0] + nx * off * side, hit.h.cxy[1] + ny * off * side]));
    }
    const res = []; for (let i = 0; i < vias.length; i += 4) res.push(...(await Promise.all(vias.slice(i, i + 4).map(v => osrm([P, v, to]).then(r => r[0])))).filter(Boolean));
    scored = [...scored, ...res.map(r => ({ r, ...score(r, hazards) }))].sort((a, b) => a.cost - b.cost);
    log(`desvío provisional, ronda ${round + 1}: ${scored[0].ex.hits.length} zonas cruzadas`);
  }
  if (!scored.length) throw new Error('OSRM sin respuesta');
  const best = scored[0]; const sl = best.line;
  const safeHitNames = new Set(best.ex.hits.map(n => n.h.name));
  return {
    from, to, fastest: fast, reroute: { s: sP, point: P }, safe: best.r, method: 'provisional', engine: best.r.engine, hazardIds,
    events: { fastCrossed: crossed, avoided: crossed.filter(c => c.s > sP - 30 && !safeHitNames.has(c.id)), safeCrossed: best.ex.hits.map(n => hzEv(n, sl)), safeNear: best.ex.near.filter(n => n.d > 30).map(n => hzEv(n, sl)) },
  };
}
