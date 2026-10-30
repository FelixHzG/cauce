// cauce. nav-neon — storm-night navigation prototype.
// MapLibre (OpenFreeMap vector tiles, night style) + three.js custom layer (car, beams, beacons)
// + canvas rain + DOM HUD. One render function `renderFrame(state)` draws everything; the demo
// director maps t → state deterministically, the drive director integrates wall time.
import { buildHazardIndex, exposure, cumulative, clean, searchDetour, hazardDistance } from './hazards.js';
import { createNeonLayer, KIND_COLORS } from './scene3d.js';
import { createRain, lightning } from './rain.js';

const Q = new URLSearchParams(location.search);
const DEMO = Q.get('demo') === '1';
const $ = s => document.querySelector(s);
document.body.classList.toggle('demo', DEMO);
const DEMO_DURATION = 25;

const PRESETS = [
  { id: 'minerva-aeropuerto', label: 'Glorieta Minerva → Aeropuerto GDL', from: [-103.3925, 20.6743], to: [-103.3111, 20.5218], fromName: 'Glorieta Minerva', toName: 'Aeropuerto GDL', snapshot: './data/minerva-aeropuerto.json' },
  { id: 'chapultepec-plaza-sol', label: 'Av. Chapultepec → Plaza del Sol', from: [-103.3700, 20.6745], to: [-103.4010, 20.6505], fromName: 'Av. Chapultepec', toName: 'Plaza del Sol' },
  { id: 'centro-tlaquepaque', label: 'Catedral → Centro de Tlaquepaque', from: [-103.3474, 20.6767], to: [-103.3115, 20.6405], fromName: 'Catedral de Guadalajara', toName: 'Centro de Tlaquepaque' },
];

// ---------------------------------------------------------------------------------------------
// geometry helpers
const R2D = 180 / Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, w) => a + (b - a) * w;
const smooth = w => { w = clamp(w, 0, 1); return w * w * (3 - 2 * w); };
const lerpAngle = (a, b, w) => a + ((((b - a) % 360) + 540) % 360 - 180) * w;
const bump = (t, a, b, edge = 0.6) => smooth((t - a) / edge) * (1 - smooth((t - (b - edge)) / edge));
function bearing(a, b) { const kx = 111320 * Math.cos(a[1] * Math.PI / 180); return Math.atan2((b[0] - a[0]) * kx, (b[1] - a[1]) * 110540) * R2D; }

class Path {
  constructor(coords) { this.c = clean(coords); this.cum = cumulative(this.c); this.len = this.cum[this.cum.length - 1]; }
  idx(s) { let lo = 0, hi = this.cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; } return lo; }
  pointAt(s) {
    s = clamp(s, 0, this.len); const i = this.idx(s); const j = Math.min(i + 1, this.c.length - 1);
    const seg = this.cum[j] - this.cum[i] || 1; const w = (s - this.cum[i]) / seg;
    return [lerp(this.c[i][0], this.c[j][0], w), lerp(this.c[i][1], this.c[j][1], w)];
  }
  bearingAt(s, back = 8, ahead = 12) {
    let a = s - back, b = s + ahead;
    if (b > this.len) { a -= b - this.len; b = this.len; }
    if (a < 0) { b = Math.min(this.len, b - a); a = 0; }
    return bearing(this.pointAt(a), this.pointAt(b));
  }
  project(ll, from = 0, to = Infinity) {
    let best = Infinity, bs = 0;
    const kx = 111320 * Math.cos(ll[1] * Math.PI / 180), ky = 110540;
    for (let i = 0; i < this.c.length - 1; i++) {
      if (this.cum[i + 1] < from || this.cum[i] > to) continue;
      const ax = (this.c[i][0] - ll[0]) * kx, ay = (this.c[i][1] - ll[1]) * ky, bx = (this.c[i + 1][0] - ll[0]) * kx, by = (this.c[i + 1][1] - ll[1]) * ky;
      const dx = bx - ax, dy = by - ay; let w = -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1); w = clamp(w, 0, 1);
      const d = Math.hypot(ax + dx * w, ay + dy * w);
      if (d < best) { best = d; bs = this.cum[i] + w * (this.cum[i + 1] - this.cum[i]); }
    }
    return { s: bs, d: best };
  }
  slice(s0, s1) {
    const out = [this.pointAt(s0)];
    for (let i = 0; i < this.c.length; i++) if (this.cum[i] > s0 && this.cum[i] < s1) out.push(this.c[i]);
    out.push(this.pointAt(s1)); return out;
  }
}

// ---------------------------------------------------------------------------------------------
// OSRM-style instruction → Spanish
const TYPES = ['new name', 'end of road', 'exit rotary', 'exit roundabout', 'roundabout turn', 'on ramp', 'off ramp', 'use lane', 'depart', 'arrive', 'turn', 'continue', 'merge', 'fork', 'rotary', 'roundabout', 'notification'];
const MODS = ['slight left', 'slight right', 'sharp left', 'sharp right', 'uturn', 'straight', 'left', 'right'];
function parseInstruction(str) {
  let rest = (str || '').trim(), type = '', mod = '';
  for (const t of TYPES) if (rest === t || rest.startsWith(t + ' ')) { type = t; rest = rest.slice(t.length).trim(); break; }
  for (const m of MODS) if (rest === m || rest.startsWith(m + ' ')) { mod = m; rest = rest.slice(m.length).trim(); break; }
  if (!type) return { type: 'raw', mod: '', name: '', text: str };
  return { type, mod, name: rest };
}
const MOD_ES = { left: 'a la izquierda', right: 'a la derecha', 'slight left': 'ligeramente a la izquierda', 'slight right': 'ligeramente a la derecha', 'sharp left': 'cerrado a la izquierda', 'sharp right': 'cerrado a la derecha', straight: 'derecho', uturn: 'en U' };
function instructionEs(p) {
  if (p.es) {
    let verb = p.text || '', street = '';
    if (p.name && verb.includes(p.name)) { verb = verb.replace(p.name, '').replace(/\s+(en|por|hacia|a)\s*$/i, '').replace(/\s{2,}/g, ' ').trim(); street = p.name; }
    return { verb, street };
  }
  if (p.type === 'raw') return { verb: p.text, street: '' };
  const m = MOD_ES[p.mod] || '';
  switch (p.type) {
    case 'depart': return { verb: 'Sal', street: p.name };
    case 'arrive': return { verb: 'Llegas a tu destino', street: '' };
    case 'turn': return { verb: p.mod === 'uturn' ? 'Da vuelta en U' : p.mod === 'straight' ? 'Sigue derecho' : `Gira ${m}`, street: p.name };
    case 'new name': case 'continue': return { verb: p.mod && p.mod !== 'straight' ? `Continúa ${m}` : 'Continúa', street: p.name };
    case 'end of road': return { verb: `Al final, ${m}`, street: p.name };
    case 'fork': return { verb: `En la bifurcación, ${m}`, street: p.name };
    case 'merge': return { verb: 'Incorpórate', street: p.name };
    case 'on ramp': return { verb: `Toma la entrada ${m}`, street: p.name };
    case 'off ramp': return { verb: `Toma la salida ${m}`, street: p.name };
    case 'rotary': case 'roundabout': case 'roundabout turn': return { verb: 'Entra a la glorieta', street: p.name };
    case 'exit rotary': case 'exit roundabout': return { verb: 'Sal de la glorieta', street: p.name };
    default: return { verb: `Sigue ${m}`.trim(), street: p.name };
  }
}
const ARROWS = {
  straight: 'M24 42V8M11 21L24 8l13 13',
  left: 'M32 42V26q0-9-9-9H9M18 8l-9 9 9 9',
  right: 'M16 42V26q0-9 9-9h14M30 8l9 9-9 9',
  'slight left': 'M30 42V28L15 13M13 25V11h14',
  'slight right': 'M18 42V28l15-15M21 11h14v14',
  'sharp left': 'M32 8v20q0 8-8 8H12M10 24l-2 12 12 2',
  'sharp right': 'M16 8v20q0 8 8 8h12M38 24l2 12-12 2',
  uturn: 'M32 42V18a8 8 0 0 0-16 0v16M9 27l7 7 7-7',
  arrive: 'M24 44S11 31 11 20a13 13 0 0 1 26 0c0 11-13 24-13 24zM24 15v8',
  rotary: 'M24 44V31M24 31a8 8 0 1 1 8-8M32 23V9M26 15l6-6 6 6',
  warn: 'M24 7L44 41H4zM24 19v10M24 35v1',
};
function arrowFor(p) {
  if (p.type === 'arrive') return ARROWS.arrive;
  if (p.type === 'rotary' || p.type === 'roundabout' || p.type === 'roundabout turn' || p.type === 'exit rotary') return ARROWS.rotary;
  return ARROWS[p.mod] || ARROWS.straight;
}
const ICONS = {
  site: '<svg viewBox="0 0 48 48"><path d="M24 5C24 5 11 20 11 29a13 13 0 0 0 26 0C37 20 24 5 24 5z"/><path d="M5 43q5-4 10 0t10 0 10 0 9-1"/></svg>',
  critical: '<svg viewBox="0 0 48 48"><path d="M24 5L45 42H3z"/><path d="M24 18v11M24 35v1"/></svg>',
  underpass: '<svg viewBox="0 0 48 48"><path d="M3 13h42M3 13q21 26 42 0"/><path d="M8 33q4-3 8 0t8 0 8 0 8 0M10 40q4-3 8 0t8 0 8 0"/></svg>',
  modeled: '<svg viewBox="0 0 48 48"><path d="M4 30q5-5 10 0t10 0 10 0 10 0M4 38q5-5 10 0t10 0 10 0 10 0"/><path d="M14 8h20v12H14z"/></svg>',
};
const KIND_TITLE = { site: 'Encharcamiento registrado', critical: 'Zona crítica IMEPLAN', underpass: 'Paso a desnivel inundable', modeled: 'Agua modelada' };
const KIND_RANK = { underpass: 3, critical: 2, site: 1, modeled: 1 };
const fmtDist = m => m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;
const fmtKm = m => `${(m / 1000).toFixed(1)} km`;
const fmtMin = s => `${Math.max(0, Math.round(s / 60))} min`;
const fmtClock = sec => { const d = new Date(Math.round(sec) * 1000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };

// ---------------------------------------------------------------------------------------------
// data
async function getJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }
async function loadHazards() {
  let index = { layers: [] };
  try { index = await getJSON('/labs/shared/hazard/index.json'); } catch (e) { console.warn('hazard index missing', e.message); }
  const layers = (index.layers || []).filter(l => l && l.id && l.url);
  const loaded = await Promise.all(layers.map(async layer => {
    if (layer.type !== 'geojson') return { layer, data: null };
    try { return { layer, data: await getJSON(layer.url) }; } catch (e) { console.warn('hazard layer failed', layer.id, e.message); return { layer, data: null, failed: true }; }
  }));
  return loaded;
}
async function loadRouterModule() {
  let status = null;
  try { status = await getJSON('/labs/shared/status/router.json'); } catch { /* not published yet */ }
  try {
    const mod = await import('/labs/shared/router/router.js');
    const router = await mod.loadRouter();
    const stub = /stub/i.test(router.engine || '') || router.ready === false;
    const ready = !stub && (!status || ['ready', 'done'].includes(status.state));
    return { router, status, ready, engine: router.engine || 'desconocido' };
  } catch (e) { console.warn('router unavailable', e.message); return { router: null, status, ready: false, engine: 'no disponible' }; }
}
function rainOf(layer) {
  const v = layer.rain_mm_h ?? layer.rainfall_mm_h ?? layer.intensity_mm_h ?? layer.scenario?.rain_mm_h ?? layer.params?.rain_mm_h;
  if (Number.isFinite(+v)) return +v;
  const m = /(\d+)\s*mm\s*\/\s*h/i.exec(`${layer.label || ''} ${layer.id || ''}`); return m ? +m[1] : null;
}

// ---------------------------------------------------------------------------------------------
// trip model
function groupHits(hits) {
  const g = new Map();
  for (const h of hits) {
    const key = `${h.hazard.layerId}:${h.hazard.base || h.hazard.name}`;
    const cur = g.get(key);
    if (!cur) { g.set(key, { key, hits: [h], hazard: h.hazard, on: h.onRoute, at: h.at, closestAt: h.closestAt, minDist: h.minDist, kind: h.hazard.kind }); continue; }
    cur.hits.push(h); cur.on = cur.on || h.onRoute; cur.at = Math.min(cur.at, h.at); if (h.minDist < cur.minDist) { cur.minDist = h.minDist; cur.closestAt = h.closestAt; }
    if ((KIND_RANK[h.hazard.kind] || 0) > (KIND_RANK[cur.kind] || 0)) { cur.kind = h.hazard.kind; cur.hazard = h.hazard; }
  }
  // Prefer the point reference/range from any member.
  for (const v of g.values()) { const withRef = v.hits.find(x => x.hazard.reference); v.reference = withRef ? withRef.hazard.reference : ''; const withRange = v.hits.find(x => x.hazard.range); v.range = withRange ? withRange.hazard.range : ''; }
  return [...g.values()].sort((a, b) => a.at - b.at);
}

function stepsOnPath(path, steps, s0 = 0, offset = 0) {
  const out = []; let from = s0;
  for (const st of steps || []) {
    if (!st.location) continue;
    let sAlong;
    if (Number.isFinite(st.along_m)) sAlong = st.along_m;   // real router gives the along-route distance
    else { const p = path.project(st.location, Math.max(0, from - 30), from + Math.max(400, (st.distance_m || 0) * 3 + 2000)); sAlong = p.s; }
    from = sAlong; out.push({ ...st, s: sAlong + offset, p: parseStep(st) });
  }
  return out;
}
// Real-router steps carry type/modifier/name and Spanish text; stub steps are "type modifier name".
function parseStep(st) {
  if (st.type) {
    const type = st.type === 'roundabout' ? 'rotary' : st.type === 'exit roundabout' ? 'exit rotary' : st.type;
    return { type, mod: st.modifier || '', name: st.name || '', text: st.instruction || '', es: true };
  }
  return parseInstruction(st.instruction);
}

const ROUTE_TIMEOUT = 25000;
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: tiempo agotado`)), ms))]);

async function buildTrip(preset, hazards, routerInfo, routingIds, log = () => {}) {
  if (routerInfo.ready && Q.get('router') !== 'snapshot') {
    try { return await buildTripReal(preset, hazards, routerInfo, routingIds, log); }
    catch (e) { console.warn('real router failed, falling back', e); if (!preset.snapshot && !routerInfo.router) throw e; }
  }
  if (preset.snapshot) return buildTripSnapshot(preset, hazards, routerInfo);
  return buildTripStub(preset, hazards, routerInfo, log);
}

// Real hazard-aware router: fastest vs safe from A; if the safe route still crosses a registered critical place
// further on, block that place and re-route from 1 km before it (the "reroute moment").
async function buildTripReal(preset, hazards, routerInfo, routingIds, log) {
  const r = routerInfo.router;
  log('Calculando ruta más rápida y ruta segura…');
  const c = await withTimeout(r.route(preset.from, preset.to, { hazardIds: routingIds, compare: true }), ROUTE_TIMEOUT, 'ruteador');
  const fast = c.normal || c, plan = c.safe || c;
  const planPath = new Path(plan.coordinates);
  const planGroups = groupHits(exposure(planPath.c, hazards));
  const severe = g => g.kind === 'critical' || g.kind === 'underpass';
  const target = planGroups.find(g => g.on && severe(g) && g.at > 1500 && g.at < planPath.len - 1500) || planGroups.find(g => g.on && g.at > 1500 && g.at < planPath.len - 1500);
  let sP = null, after = null, rerouteNote = '', blocked = [];
  if (target) {
    const blockGroups = planGroups.filter(g => g.on && g.at >= target.at && g.at - target.at < 1500);
    const avoid = { type: 'FeatureCollection', features: blockGroups.flatMap(g => g.hits.map(h => h.hazard.feature)) };
    log('Recalculando sin cruzar la zona crítica…');
    // Reroute 1.2–2.6 km before the place; keep the option with the shortest total time (fewer loops).
    let best = null;
    for (const off of [1200, 2000, 2600]) {
      const sTry = target.at - off; if (sTry < 300) continue;
      try {
        const r2 = await withTimeout(r.route(planPath.pointAt(sTry), preset.to, { hazardIds: routingIds, avoid }), ROUTE_TIMEOUT, 'ruteador');
        const still = groupHits(exposure(new Path(r2.coordinates).c, hazards)).some(g => g.on && g.key === target.key);
        const remain = plan.duration_s * (1 - sTry / planPath.len);
        if (r2.blocked_fallback || still || r2.duration_s > remain * 1.7 + 300) continue;
        const total = plan.duration_s * (sTry / planPath.len) + r2.duration_s;
        if (!best || total < best.total - 20) best = { sP: sTry, r2, total };
      } catch (e) { console.warn('reroute failed', e); }
    }
    if (best) { sP = best.sP; after = best.r2; blocked = blockGroups; rerouteNote = `bloquea ${blockGroups.map(g => g.hazard.base).join(', ')}`; }
  }
  const engineLabel = `ruteador: <b>${escapeHtml(routerInfo.engine)}</b> · capas: ${routingIds.map(id => id.replace('observed-', '')).join(', ')}${after ? ' · desvío al bloquear zona crítica' : ''}`;
  return finishTrip(preset, hazards, { fast, plan, sP, after, provisional: false, engineLabel, rerouteNote, real: true, blocked });
}

async function buildTripSnapshot(preset, hazards, routerInfo) {
  const snap = await getJSON(preset.snapshot);
  const base = snap.base, safe = snap.safeFromReroute;
  const sP = new Path(base.coordinates).project(snap.reroute.point).s;
  const engineLabel = `ruteador: <b>${routerInfo.ready ? 'captura (forzada)' : 'stub OSRM demo'}</b> · ruta segura: desvío provisional (captura ${snap.capturedAt.slice(0, 10)})`;
  return finishTrip(preset, hazards, { fast: base, plan: base, sP, after: safe, provisional: true, engineLabel });
}

async function buildTripStub(preset, hazards, routerInfo, log) {
  if (!routerInfo.router) throw new Error('No hay ruteador disponible');
  const r = routerInfo.router;
  log('Calculando ruta más rápida…');
  const base = await withTimeout(r.route(preset.from, preset.to, { avoid: null, hazardIds: [] }), ROUTE_TIMEOUT, 'ruteador');
  const bp = new Path(base.coordinates);
  const firstOn = groupHits(exposure(bp.c, hazards)).find(g => g.on);
  let sP = null, after = null;
  if (firstOn) {
    sP = Math.max(0, firstOn.at - 1000);
    log('Buscando desvío provisional…');
    const res = await searchDetour((a, b, o) => r.route(a, b, o), bp.pointAt(sP), preset.to, hazards, { maxCalls: 14 });
    after = res.safe;
  }
  return finishTrip(preset, hazards, { fast: base, plan: base, sP, after, provisional: true, engineLabel: 'ruteador: <b>stub OSRM demo</b> · ruta segura: desvío provisional en el navegador' });
}

function finishTrip(preset, hazards, { fast, plan, sP, after, provisional, engineLabel, rerouteNote = '', real = false, blocked = null }) {
  const fastPath = new Path(fast.coordinates), planPath = new Path(plan.coordinates);
  const hasReroute = !!(after && sP !== null);
  const drivenCoords = hasReroute ? (sP > 1 ? planPath.slice(0, sP) : []).concat(after.coordinates) : planPath.c;
  const driven = new Path(drivenCoords);
  if (hasReroute) sP = driven.project(planPath.pointAt(sP), Math.max(0, sP - 200), sP + 200).s;
  const planDur = plan.duration_s;
  const drivenDur = hasReroute ? planDur * (sP / planPath.len) + after.duration_s : planDur;
  const fastGroups = groupHits(exposure(fastPath.c, hazards));
  const planGroups = groupHits(exposure(planPath.c, hazards));
  const drivenGroups = groupHits(exposure(driven.c, hazards));
  const drivenOn = new Set(drivenGroups.filter(g => g.on).map(g => g.key));
  const avoided = fastGroups.filter(g => g.on && !drivenOn.has(g.key));
  const planOn = new Set(planGroups.filter(g => g.on).map(g => g.key));
  const planAvoided = fastGroups.filter(g => g.on && !planOn.has(g.key));
  // places the reroute itself dodges (on the plan ahead of the reroute point, not on the driven route)
  const rerouteAvoided = blocked && blocked.length ? blocked : (hasReroute ? planGroups.filter(g => g.on && g.at > sP && !drivenOn.has(g.key)) : []);
  const planSteps = stepsOnPath(planPath, plan.steps);
  const afterSteps = hasReroute ? stepsOnPath(new Path(after.coordinates), after.steps, 0, sP) : [];
  const drivenSteps = hasReroute ? planSteps.filter(st => st.s < sP - 5).concat(afterSteps.filter((st, i) => i > 0 || st.p.type !== 'depart')) : planSteps;
  const trip = {
    preset, from: preset.from, to: preset.to, fromName: preset.fromName, toName: preset.toName,
    fast: fastPath, plan: planPath, driven, sP: hasReroute ? sP : null, hasReroute, provisional, engineLabel, rerouteNote, real,
    fastDur: fast.duration_s, planDur, drivenDur, planSteps, drivenSteps, fastGroups, planGroups, drivenGroups, avoided, planAvoided, rerouteAvoided,
    planIsFast: plan === fast, avgMs: driven.len / Math.max(1, drivenDur),
  };
  trip.events = buildEvents(trip);
  trip.beaconHazards = pickBeacons(trip);
  return trip;
}

function buildEvents(trip) {
  const ev = [];
  if (trip.hasReroute) {
    const ahead = trip.planGroups.filter(g => g.on && g.at >= trip.sP - 10);
    const first = ahead[0];
    const cards = first ? ahead.filter(g => g.at - first.at < 2600).sort((a, b) => (KIND_RANK[b.kind] || 0) - (KIND_RANK[a.kind] || 0) || a.at - b.at).slice(0, 2).sort((a, b) => a.at - b.at) : [];
    if (cards.length) ev.push({ type: 'alert', scope: 'ahead', s: Math.max(0, trip.sP - 420), cards, path: 'plan' });
    ev.push({ type: 'reroute', s: trip.sP });
  }
  const after = trip.hasReroute ? trip.sP + 200 : 0;
  for (const g of trip.drivenGroups) {
    if (g.at < after && trip.hasReroute && !(g.minDist <= 90 && (g.kind === 'critical' || g.kind === 'underpass'))) continue;
    if (g.on) ev.push({ type: 'alert', scope: 'on', s: Math.max(0, g.at - 520), cards: [g], path: 'driven' });
    else if ((g.kind === 'critical' || g.kind === 'underpass') && g.minDist <= 90) ev.push({ type: 'alert', scope: 'near', s: Math.max(0, g.closestAt - 380), cards: [g], path: 'driven' });
  }
  ev.sort((a, b) => a.s - b.s);
  const merged = [];
  for (const e of ev) {
    const last = merged[merged.length - 1];
    if (last && e.type === 'alert' && last.type === 'alert' && last.scope !== 'ahead' && e.s - last.s < 260 && last.cards.length < 2) { last.cards.push(...e.cards); continue; }
    merged.push(e);
  }
  merged.forEach((e, i) => { e.id = `ev${i}`; });
  return merged;
}

function pickBeacons(trip) {
  const set = new Map();
  const add = g => { for (const h of g.hits) set.set(h.hazard.id, h.hazard); };
  trip.fastGroups.filter(g => g.on).forEach(add);
  trip.planGroups.filter(g => g.on).forEach(add);
  trip.drivenGroups.filter(g => g.on || (g.minDist <= 130 && g.kind !== 'site') || g.minDist <= 45).forEach(add);
  return [...set.values()].slice(0, 48);
}

// ---------------------------------------------------------------------------------------------
// map style (night, wet, neon)
function nightStyle() {
  const dem = { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'AWS Terrain Tiles' };
  const roadW = (a, b, c) => ['interpolate', ['exponential', 1.6], ['zoom'], 10, a, 14, b, 18, c];
  const major = ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false];
  const mid = ['match', ['get', 'class'], ['secondary', 'tertiary'], true, false];
  return {
    version: 8,
    sky: { 'sky-color': '#05060f', 'horizon-color': '#2a1658', 'fog-color': '#120c2c', 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.5, 'atmosphere-blend': 0 },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © OpenMapTiles © OpenStreetMap' },
      dem,
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#05060d' } },
      { id: 'landuse', type: 'fill', source: 'ofm', 'source-layer': 'landuse', paint: { 'fill-color': ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood'], '#080a15', ['industrial', 'commercial', 'retail'], '#0a0a19', '#07080f'], 'fill-opacity': 0.9 } },
      { id: 'park', type: 'fill', source: 'ofm', 'source-layer': 'park', paint: { 'fill-color': '#05120f', 'fill-opacity': 0.9 } },
      { id: 'landcover', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood', 'farmland', 'scrub']]], paint: { 'fill-color': '#06100e', 'fill-opacity': 0.7 } },
      { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#000000', 'hillshade-highlight-color': '#1b2350', 'hillshade-accent-color': '#0a0d20', 'hillshade-illumination-direction': 315 } },
      { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', paint: { 'fill-color': '#04202c', 'fill-outline-color': '#0d6f86' } },
      { id: 'waterway-glow', type: 'line', source: 'ofm', 'source-layer': 'waterway', paint: { 'line-color': '#00c8ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 10], 'line-blur': 5, 'line-opacity': 0.22 } },
      { id: 'waterway', type: 'line', source: 'ofm', 'source-layer': 'waterway', paint: { 'line-color': '#29d3ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 2], 'line-opacity': 0.75 } },
      { id: 'aeroway', type: 'line', source: 'ofm', 'source-layer': 'aeroway', filter: ['in', ['get', 'class'], ['literal', ['runway', 'taxiway']]], paint: { 'line-color': '#7a5cff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 14], 'line-opacity': 0.5, 'line-blur': 1 } },
      // wet asphalt: sodium-light bloom + cold sheen + dark core
      { id: 'road-sodium', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: major, paint: { 'line-color': '#ff7a1a', 'line-width': roadW(4, 18, 80), 'line-blur': roadW(3, 14, 56), 'line-opacity': 0.3 } },
      { id: 'road-sheen', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: ['any', major, mid], paint: { 'line-color': '#3a63ff', 'line-width': roadW(2, 9, 34), 'line-blur': roadW(2, 6, 20), 'line-opacity': 0.16 } },
      { id: 'road-minor', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 12, filter: ['match', ['get', 'class'], ['minor', 'service', 'track'], true, false], paint: { 'line-color': '#1b2244', 'line-width': roadW(0.4, 1.6, 10), 'line-opacity': 0.95 } },
      { id: 'road-mid', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: mid, paint: { 'line-color': '#29356e', 'line-width': roadW(0.6, 2.6, 16) } },
      { id: 'road-major', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: major, paint: { 'line-color': '#3a4492', 'line-width': roadW(1, 4.2, 26) } },
      { id: 'road-major-edge', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: major, minzoom: 14, paint: { 'line-color': '#ffb267', 'line-width': 0.6, 'line-opacity': 0.25, 'line-gap-width': roadW(1, 4.2, 26) } },
      { id: 'rail', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]], paint: { 'line-color': '#5b3a8a', 'line-width': 1.2, 'line-dasharray': [3, 2], 'line-opacity': 0.7 } },
    ],
  };
}
function addUpperLayers(map) {
  // buildings above routes so they occlude correctly at street level
  map.addLayer({ id: 'buildings', type: 'fill-extrusion', source: 'ofm', 'source-layer': 'building', minzoom: 13.5,
    paint: { 'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 4], 0, '#121735', 12, '#1c2150', 40, '#2c2672', 90, '#46288e'],
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 4], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, 0.88], 'fill-extrusion-vertical-gradient': true } });
  // the route stays readable behind buildings: a faint "x-ray" copy drawn above the extrusions
  map.addLayer({ id: 'r-plan-xray', type: 'line', source: 'r-plan', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#7df9ff', 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 1.5, 15, 3, 18, 7], 'line-opacity': 0.4 } });
  map.addLayer({ id: 'r-safe-xray', type: 'line', source: 'r-safe', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 1.5, 15, 3, 18, 7], 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,240,255,0)', 1, 'rgba(0,240,255,0)'] } });
  map.addLayer({ id: 'road-labels', type: 'symbol', source: 'ofm', 'source-layer': 'transportation_name', minzoom: 14,
    filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
    layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:es'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 11.5, 'text-letter-spacing': 0.06, 'text-max-angle': 30 },
    paint: { 'text-color': '#8ea4dd', 'text-halo-color': '#05060d', 'text-halo-width': 1.6 } });
  map.addLayer({ id: 'place-labels', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 13.2, maxzoom: 15.8,
    filter: ['in', ['get', 'class'], ['literal', ['suburb', 'neighbourhood', 'quarter', 'town']]],
    layout: { 'text-field': ['upcase', ['coalesce', ['get', 'name:es'], ['get', 'name']]], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9.5, 15, 12], 'text-letter-spacing': 0.22, 'text-max-width': 8 },
    paint: { 'text-color': '#7c6cff', 'text-opacity': 0.7, 'text-halo-color': '#05060d', 'text-halo-width': 1.4 } });
}

function addHazardLayers(map, sources) {
  const legendModeled = [];
  const POLY = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
  const LINE = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
  for (const { layer, data } of sources) {
    const sid = `hz-${layer.id}`, kind = layer.kind || 'observed';
    const vis = activeLayers.has(layer.id) ? 'visible' : 'none';
    if (layer.type === 'geojson' && data) {
      map.addSource(sid, { type: 'geojson', data, attribution: kind === 'observed' ? 'IMEPLAN MUI 2026' : (layer.producer || '') });
      if (kind === 'observed') {
        const col = ['match', ['get', '_kind'], 'underpass', KIND_COLORS.underpass, 'critical', KIND_COLORS.critical, KIND_COLORS.site];
        map.addLayer({ id: `${sid}-fill`, type: 'fill', source: sid, filter: POLY, layout: { visibility: vis }, paint: { 'fill-color': col, 'fill-opacity': 0.16 } }, 'road-minor');
        map.addLayer({ id: `${sid}-glow`, type: 'line', source: sid, filter: POLY, layout: { visibility: vis }, paint: { 'line-color': col, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 9], 'line-blur': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 7], 'line-opacity': 0.55 } });
        map.addLayer({ id: `${sid}-line`, type: 'line', source: sid, filter: POLY, layout: { visibility: vis }, paint: { 'line-color': col, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 1.6], 'line-opacity': 0.95 } });
      } else if (kind === 'modeled') {
        legendModeled.push(layer);
        map.addLayer({ id: `${sid}-fill`, type: 'fill', source: sid, filter: POLY, layout: { visibility: vis }, paint: { 'fill-color': KIND_COLORS.modeled, 'fill-opacity': 0.22 } }, 'road-minor');
        map.addLayer({ id: `${sid}-line`, type: 'line', source: sid, layout: { visibility: vis }, paint: { 'line-color': KIND_COLORS.modeled, 'line-width': 1.2, 'line-dasharray': [2, 2], 'line-opacity': 0.9 } });
      } else if (kind === 'hotspot') {
        // mapped (OSM-derived) places that can flood: drawn as dashed amber road segments, never as observed zones
        map.addLayer({ id: `${sid}-glow`, type: 'line', source: sid, filter: LINE, minzoom: 12, layout: { visibility: vis, 'line-cap': 'round' }, paint: { 'line-color': '#ffb020', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 17, 12], 'line-blur': 5, 'line-opacity': 0.18 } });
        map.addLayer({ id: `${sid}-line`, type: 'line', source: sid, filter: LINE, minzoom: 12, layout: { visibility: vis }, paint: { 'line-color': '#ffc75a', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 17, 2.2], 'line-dasharray': [1.2, 1.4], 'line-opacity': 0.75 } });
        map.addLayer({ id: `${sid}-fill`, type: 'fill', source: sid, filter: POLY, layout: { visibility: vis }, paint: { 'fill-color': '#ffb020', 'fill-opacity': 0.1 } }, 'road-minor');
      } else {
        map.addLayer({ id: `${sid}-fill`, type: 'fill', source: sid, filter: POLY, layout: { visibility: vis }, paint: { 'fill-color': kind === 'water' ? '#0a5a78' : '#7a5cff', 'fill-opacity': 0.25 } }, 'road-minor');
        map.addLayer({ id: `${sid}-line`, type: 'line', source: sid, layout: { visibility: vis }, paint: { 'line-color': kind === 'water' ? '#29d3ff' : '#7a5cff', 'line-width': 0.8, 'line-opacity': 0.5 } });
      }
    } else if (layer.type === 'raster-tiles') {
      map.addSource(sid, { type: 'raster', tiles: [layer.url], tileSize: layer.tileSize || 256, minzoom: layer.minzoom || 0, maxzoom: layer.maxzoom || 18, ...(layer.bounds ? { bounds: layer.bounds } : {}), attribution: layer.producer || '' });
      map.addLayer({ id: `${sid}-raster`, type: 'raster', source: sid, layout: { visibility: vis }, paint: { 'raster-opacity': kind === 'modeled' ? 0.75 : 0.5 } }, 'road-minor');
      if (kind === 'modeled') legendModeled.push(layer);
    } else if (layer.type === 'vector' && (layer.sourceLayer || layer.source_layer)) {
      map.addSource(sid, { type: 'vector', tiles: [layer.url], attribution: layer.producer || '' });
      map.addLayer({ id: `${sid}-fill`, type: 'fill', source: sid, 'source-layer': layer.sourceLayer || layer.source_layer, layout: { visibility: vis }, paint: { 'fill-color': kind === 'modeled' ? KIND_COLORS.modeled : KIND_COLORS.site, 'fill-opacity': 0.3 } }, 'road-minor');
      if (kind === 'modeled') legendModeled.push(layer);
    } else {
      console.info('hazard layer not drawable here', layer.id, layer.type);
    }
  }
  if (legendModeled.length) $('#lg-modeled').hidden = false;
}

// Mapped (not observed) flood-prone points for the radar: OSM underpass sites.
function mappedPointsFrom(sources) {
  const out = [], seen = new Set();
  for (const { layer, data } of sources) {
    if (!data || layer.kind !== 'hotspot' || !activeLayers.has(layer.id)) continue;
    for (const f of data.features || []) {
      const p = f.properties || {}; const key = `${layer.id}:${p.site ?? p.id}`;
      if (seen.has(key)) continue; seen.add(key);
      let ll = Array.isArray(p.marker) ? p.marker : null;
      if (!ll && f.geometry) { const c = f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.type === 'Point' ? [f.geometry.coordinates] : null; if (c) ll = c[Math.floor(c.length / 2)]; }
      if (ll) out.push({ ll, label: p.label || p.name || '', confidence: p.confidence || '' });
    }
  }
  return out;
}

function routeLayers(map) {
  map.addSource('r-base', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('r-base-hz', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('r-safe', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, lineMetrics: true });
  const zw = (a, b, c) => ['interpolate', ['exponential', 1.5], ['zoom'], 11, a, 15, b, 18, c];
  map.addLayer({ id: 'r-base-glow', type: 'line', source: 'r-base', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff2b55', 'line-width': zw(4, 11, 28), 'line-blur': zw(3, 8, 20), 'line-opacity': 0.35 } });
  map.addLayer({ id: 'r-base-line', type: 'line', source: 'r-base', layout: { 'line-join': 'round' }, paint: { 'line-color': '#ff4d6d', 'line-width': zw(2, 4, 9), 'line-dasharray': [1.6, 1.3], 'line-opacity': 0.9 } });
  map.addLayer({ id: 'r-base-hz-glow', type: 'line', source: 'r-base-hz', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ff1f6a', 'line-width': zw(10, 26, 60), 'line-blur': zw(6, 16, 36), 'line-opacity': 0.7 } });
  map.addLayer({ id: 'r-base-hz-line', type: 'line', source: 'r-base-hz', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ff6b9a', 'line-width': zw(3, 7, 14), 'line-opacity': 1 } });
  map.addSource('r-plan', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'r-plan-glow', type: 'line', source: 'r-plan', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#00f0ff', 'line-width': zw(6, 18, 44), 'line-blur': zw(3, 10, 26), 'line-opacity': 0.6 } });
  map.addLayer({ id: 'r-plan-line', type: 'line', source: 'r-plan', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#7df9ff', 'line-width': zw(2.4, 6, 14), 'line-opacity': 1 } });
  map.addLayer({ id: 'r-safe-reflect', type: 'line', source: 'r-safe', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#00e1ff', 'line-width': zw(14, 46, 120), 'line-blur': zw(10, 34, 90), 'line-opacity': 0.0 } });
  map.addLayer({ id: 'r-safe-glow', type: 'line', source: 'r-safe', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': zw(6, 18, 44), 'line-blur': zw(3, 10, 26), 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,240,255,0)', 1, 'rgba(0,240,255,0)'] } });
  map.addLayer({ id: 'r-safe-core', type: 'line', source: 'r-safe', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': zw(2.4, 6, 14), 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,240,255,0)', 1, 'rgba(0,240,255,0)'] } });
  map.addLayer({ id: 'r-safe-hot', type: 'line', source: 'r-safe', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': zw(0.8, 1.8, 4), 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(255,255,255,0)', 1, 'rgba(255,255,255,0)'] } });
}

function setRouteData(map, trip) {
  const ls = c => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } });
  // fastest route: when it is also the initial plan (stub), draw it only from the reroute point on
  map.getSource('r-base').setData(ls(trip.hasReroute && trip.planIsFast ? trip.fast.slice(Math.max(0, trip.sP - 20), trip.fast.len) : trip.fast.c));
  map.getSource('r-plan').setData(trip.hasReroute && !trip.planIsFast ? ls(trip.plan.slice(Math.max(0, trip.sP - 5), trip.plan.len)) : { type: 'FeatureCollection', features: [] });
  map.getSource('r-safe').setData(ls(trip.driven.c));
  // Segments of the fast route that run inside registered polygons.
  const segs = [];
  for (const g of trip.fastGroups.filter(g => g.on)) {
    for (const h of g.hits.filter(h => h.onRoute)) {
      const s0 = Math.max(0, h.at - 25), s1 = Math.min(trip.fast.len, h.at + Math.max(50, h.insideLen) + 25);
      segs.push(trip.fast.slice(s0, s1));
    }
  }
  map.getSource('r-base-hz').setData({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: segs } });
}

// line-gradient for the driven route: dim behind the car, bright ahead, a pulse running forward,
// transparent beyond the "grow" front (used for the reroute draw-in).
function safeGradient(pCar, pGrow, pPulse, alpha, kind) {
  const stops = [];
  const push = (p, c) => { p = clamp(p, 0, 1); if (stops.length && p <= stops[stops.length - 2]) p = Math.min(1, stops[stops.length - 2] + 1e-6); if (p > 1) return; stops.push(p, c); };
  const a = v => (v * alpha).toFixed(3);
  const C = kind === 'hot' ? [255, 255, 255] : [0, 240, 255];
  const rgba = v => (kind === 'core' && v === 'dim') ? `rgba(8,74,92,${a(1)})` : `rgba(${C[0]},${C[1]},${C[2]},${a(v)})`;
  const dim = kind === 'glow' ? 0.14 : kind === 'hot' ? 0.0 : 'dim';
  const bright = kind === 'glow' ? 0.7 : kind === 'hot' ? 0.75 : 1.0;
  push(0, rgba(pCar > 0.0005 ? dim : bright));
  if (pGrow <= 0.0005) return ['interpolate', ['linear'], ['line-progress'], 0, rgba(0), 1, rgba(0)];
  const g = clamp(pGrow, 0, 1);
  if (pCar > 0.0005 && pCar < g) { push(pCar - 0.0004, rgba(dim)); push(pCar, rgba(bright)); }
  if (pPulse > pCar + 0.002 && pPulse < g - 0.002) { const w = 0.004; push(pPulse - w, rgba(bright)); push(pPulse, kind === 'core' ? 'rgba(220,255,255,1)' : rgba(1)); push(pPulse + w * 0.5, rgba(bright)); }
  if (g < 1) { push(g - 0.0005, rgba(bright)); push(g, rgba(0)); push(1, rgba(0)); } else push(1, rgba(bright));
  if (stops[stops.length - 2] < 1) stops.push(1, stops[stops.length - 1]);
  return ['interpolate', ['linear'], ['line-progress'], ...stops];
}

// ---------------------------------------------------------------------------------------------
// HUD
const hud = {
  alerts: $('#alerts'), cards: new Map(), labels: new Map(),
  radar: $('#radar'), radarCtx: $('#radar').getContext('2d'),
};
function setText(el, v) { if (el.textContent !== v) el.textContent = v; }
function rainBars(mm) { const el = $('#rain-bars'); if (!el.children.length) for (let i = 0; i < 12; i++) el.append(document.createElement('i')); [...el.children].forEach((b, i) => { b.style.height = `${30 + i * 6}%`; b.classList.toggle('on', i < Math.round(mm / 100 * 12)); }); }

function cardHTML(g, scope) {
  const h = g.hazard;
  const title = scope === 'on' && g.kind === 'site' ? 'Encharcamiento en tu ruta' : KIND_TITLE[g.kind] || 'Zona registrada';
  const ref = g.reference || (h.name ? `Sitio ${h.base}` : '');
  const parts = [];
  if (h.depthText) parts.push(h.depthText);
  else if (g.range) parts.push(`${g.range.replace(/\s*-\s*/, '–')} cm registrados`);
  else if (h.reportedMax) parts.push(`altura máx. reportada ${h.reportedMax}`);
  parts.push(h.layerKind === 'observed' ? `IMEPLAN ${h.base}` : `${h.layerId} · modelo exploratorio`);
  const kicker = scope === 'ahead' ? 'EN TU RUTA · BUSCANDO OTRA' : scope === 'on' ? 'EN TU RUTA · SIN DESVÍO' : 'A UN COSTADO · PRECAUCIÓN';
  return `<div class="a-icon">${ICONS[g.kind] || ICONS.site}</div><div class="a-body"><div class="a-kicker"><span>${kicker}</span><b class="a-dist" data-dist>—</b></div>
    <div class="a-title">${title}</div><div class="a-ref">${escapeHtml(ref)}</div><div class="a-meta">${escapeHtml(parts.join(' · '))}</div></div><div class="a-bar"></div>`;
}
function shortRef(r) { r = r.split(/[,(]/)[0].trim(); if (r.length <= 30) return r; const cut = r.slice(0, 30); return cut.slice(0, cut.lastIndexOf(' ')) + '…'; }
function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function updateAlerts(list, carLL, s, trip) {
  const want = new Set();
  let shown = 0;
  for (const a of list.slice().reverse()) {
    a.ev.cards.forEach((g, k) => {
      if (shown >= 2) return; shown++;
      const id = `${a.ev.id}-${k}`; want.add(id);
      let el = hud.cards.get(id);
      if (!el) { el = document.createElement('div'); el.className = `alert ${g.kind}`; el.innerHTML = cardHTML(g, a.ev.scope); hud.alerts.append(el); hud.cards.set(id, el); }
      const d = a.ev.scope === 'near' ? hazardDistance(g.hazard, carLL) : Math.max(0, g.at - s);
      setText(el.querySelector('[data-dist]'), a.ev.scope === 'near' ? `${Math.round(d / 10) * 10} m` : d < 15 ? 'aquí' : fmtDist(d));
      const k2 = clamp(a.age / 0.35, 0, 1), out = clamp((a.life - a.age) / 0.35, 0, 1);
      el.style.opacity = String(Math.min(k2, out));
      el.style.transform = `translateX(${(1 - smooth(k2)) * 60}px)`;
      el.querySelector('.a-bar').style.transform = `scaleX(${clamp(1 - a.age / a.life, 0, 1)})`;
    });
  }
  for (const [id, el] of hud.cards) if (!want.has(id)) { el.remove(); hud.cards.delete(id); }
}

function drawRadar(st) {
  const c = hud.radar, ctx = hud.radarCtx, W = c.width, R = W / 2 - 8, cx = W / 2, cy = W / 2;
  ctx.clearRect(0, 0, W, W);
  const range = st.radarRange;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  g.addColorStop(0, 'rgba(0,60,90,.55)'); g.addColorStop(1, 'rgba(0,20,40,.35)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(125,249,255,.22)'; ctx.lineWidth = 2;
  for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(cx, cy, R * k / 3, 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  ctx.font = '600 18px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(125,249,255,.55)'; ctx.textAlign = 'left';
  ctx.fillText(fmtDist(range), cx + 6, cy - R + 22);
  // project lon/lat → radar px (heading-up)
  const kx = 111320 * Math.cos(st.carLL[1] * Math.PI / 180), ky = 110540, hr = -st.heading * Math.PI / 180;
  const toR = ll => { const dx = (ll[0] - st.carLL[0]) * kx, dy = (ll[1] - st.carLL[1]) * ky; const x = dx * Math.cos(hr) - dy * Math.sin(hr), y = dx * Math.sin(hr) + dy * Math.cos(hr); return [cx + x / range * R, cy - y / range * R]; };
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  const drawPath = (path, s0, s1, color, width, dash) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.beginPath();
    const n = 60; for (let i = 0; i <= n; i++) { const p = toR(path.pointAt(lerp(s0, s1, i / n))); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); } ctx.stroke(); ctx.setLineDash([]);
  };
  if (st.trip) {
    const t = st.trip;
    if (st.showBase) drawPath(t.fast, Math.max(0, st.fastS - range * 1.2), Math.min(t.fast.len, st.fastS + range * 1.2), 'rgba(255,60,100,.75)', 3, [8, 6]);
    if (st.planOpacity > 0.05 && t.hasReroute && !t.planIsFast) drawPath(t.plan, Math.max(t.sP, st.s - range * 0.3), Math.min(t.plan.len, st.s + range * 1.2), `rgba(0,240,255,${0.9 * st.planOpacity})`, 4);
    if (st.showSafe) drawPath(t.driven, Math.max(0, st.s - range * 0.3), Math.min(st.safeEnd, st.s + range * 1.2), 'rgba(0,240,255,.95)', 4);
  }
  // sweep
  const sw = (st.t * 2.4) % (Math.PI * 2);
  const sg = ctx.createConicGradient ? ctx.createConicGradient(sw - Math.PI / 2 - 0.9, cx, cy) : null;
  if (sg) { sg.addColorStop(0, 'rgba(0,240,255,0)'); sg.addColorStop(0.14, 'rgba(0,240,255,.28)'); sg.addColorStop(0.1401, 'rgba(0,240,255,0)'); ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); }
  let nearest = null;
  for (const h of st.radarHazards) {
    const d = hazardDistance(h, st.carLL);
    if (!nearest || d < nearest.d) nearest = { h, d };
    if (d > range * 1.05) continue;
    const p = toR(h.centroid);
    const ang = Math.atan2(p[0] - cx, -(p[1] - cy)); const diff = ((sw - ang) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const lit = 0.45 + 0.55 * Math.exp(-diff * 2.2);
    const col = KIND_COLORS[h.kind] || '#fff';
    ctx.globalAlpha = lit; ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 16;
    const rr = h.kind === 'site' ? 7 : 9; ctx.beginPath(); ctx.arc(p[0], p[1], rr, 0, Math.PI * 2); ctx.fill();
    if (st.activeHazards.get(h.id)) { ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(p[0], p[1], rr + 6 + 6 * ((st.t * 2) % 1), 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }
  // mapped (OSM) underpasses: hollow diamonds, no alerts
  ctx.strokeStyle = 'rgba(255,190,80,.75)'; ctx.lineWidth = 2;
  for (const m of mappedPoints) {
    const kx2 = Math.abs(m.ll[0] - st.carLL[0]) * kx, ky2 = Math.abs(m.ll[1] - st.carLL[1]) * ky; if (kx2 > range || ky2 > range) continue;
    const p = toR(m.ll); ctx.beginPath(); ctx.moveTo(p[0], p[1] - 6); ctx.lineTo(p[0] + 6, p[1]); ctx.lineTo(p[0], p[1] + 6); ctx.lineTo(p[0] - 6, p[1]); ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
  // car
  ctx.fillStyle = '#fff'; ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.moveTo(cx, cy - 15); ctx.lineTo(cx + 10, cy + 11); ctx.lineTo(cx, cy + 5); ctx.lineTo(cx - 10, cy + 11); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(0,240,255,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  const lab = $('#radar-near');
  if (nearest) setText(lab, `${nearest.d < 20 ? 'DENTRO' : fmtDist(nearest.d)} · ${(KIND_TITLE[nearest.h.kind] || '').split(' ')[0].toLowerCase()}${nearest.h.kind === 'critical' ? ' crítica' : nearest.h.kind === 'underpass' ? ' a desnivel' : ''}`);
  else setText(lab, 'sin zonas cerca');
}

function updateLabels(map, items) {
  const want = new Set(); const boxes = [];
  const placed = items.map(it => ({ it, p: map.project(it.ll) })).sort((a, b) => b.p.y - a.p.y);
  for (const { it, p } of placed) {
    want.add(it.id);
    let el = hud.labels.get(it.id);
    if (!el) { el = document.createElement('div'); el.className = `mlabel ${it.cls || ''}`; if (it.color) el.style.setProperty('--c', it.color); $('#labels').append(el); hud.labels.set(it.id, el); }
    if (el._html !== it.html) { el.innerHTML = it.html; el._html = it.html; }
    const visible = (it.opacity ?? 1) > 0.01 && p.x > 30 && p.x < innerWidth - 30 && p.y > (it.minY ?? 120) && p.y < innerHeight - 60;
    el.style.display = visible ? '' : 'none';
    if (!visible) continue;
    const w = el.offsetWidth || 120, h = el.offsetHeight || 30;
    let y = p.y - (it.lift || 18);
    for (let k = 0; k < 6; k++) {
      const hx = clamp(p.x, w / 2 + 6, innerWidth - w / 2 - 6);
      const hit = boxes.find(b => Math.abs(b.x - hx) < (b.w + w) / 2 + 6 && y > b.y - h - 6 && y - h < b.y + 6);
      if (!hit) break; y = hit.y - hit.h - 8;
    }
    const x = clamp(p.x, w / 2 + 6, innerWidth - w / 2 - 6);
    boxes.push({ x, y, w, h });
    el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.opacity = String(it.opacity ?? 1);
    el.style.setProperty('--sx', `${p.x - x}px`);
    el.style.setProperty('--stem', `${Math.max(8, p.y - y)}px`);
  }
  for (const [id, el] of hud.labels) if (!want.has(id)) { el.remove(); hud.labels.delete(id); }
}

// ---------------------------------------------------------------------------------------------
// boot
const rain = createRain($('#rain'));
let map, neon, trip, hazards, hazardSources, routerInfo, activeLayers = new Set(), mappedPoints = [];
let rainMm = 40, mode = DEMO ? 'demo' : 'browse';
const toast = (msg, ms = 2600) => { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast._t); if (ms) toast._t = setTimeout(() => el.classList.remove('show'), ms); };

async function main() {
  const preset = PRESETS.find(p => p.id === Q.get('route')) || PRESETS[0];
  setText($('#m-inst'), 'Cargando mapa y ruteador');
  // data (hazard layers + ~5 MB router graph) and the map load in parallel
  const dataP = Promise.all([loadHazards(), loadRouterModule()]);
  map = new maplibregl.Map({
    container: 'map', style: nightStyle(), center: preset.from, zoom: 12, pitch: 50, bearing: 150, maxPitch: 80,
    attributionControl: false, canvasContextAttributes: { antialias: true }, fadeDuration: 0,
    interactive: !DEMO,
  });
  window.__map = map;
  const loadP = new Promise(r => map.on('load', r));
  [hazardSources, routerInfo] = await dataP;
  console.info('[nav-neon] data', hazardSources.length, routerInfo.engine);
  for (const { layer, data } of hazardSources) {
    if (data) for (const f of data.features || []) { f.properties = f.properties || {}; }
    if (layer.kind === 'observed' || layer.kind === 'modeled' || layer.kind === 'hotspot' || layer.kind === 'water' || !layer.kind) activeLayers.add(layer.id);
    if (Q.get('layers')) { activeLayers.clear(); for (const id of Q.get('layers').split(',')) activeLayers.add(id); }
  }
  rebuildHazardIndex();
  await loadP;
  console.info('[nav-neon] map loaded');
  routeLayers(map);
  addHazardLayers(map, hazardSources);
  addUpperLayers(map);
  const origin = [(preset.from[0] + preset.to[0]) / 2, (preset.from[1] + preset.to[1]) / 2];
  neon = createNeonLayer(map, origin);
  map.addLayer(neon.layer);
  setupPanel();
  await selectTrip(preset);
  console.info('[nav-neon] trip ready');
  if (DEMO) startDemo(); else startBrowse();
}

// Layers used for routing and for alerts. The demo is pinned to the observed IMEPLAN inventory so the filmed
// sequence does not change when new layers are registered (override with ?layers=a,b).
function routingIds() {
  const known = new Set(hazardSources.map(s => s.layer.id));
  if (DEMO) return (Q.get('layers') ? Q.get('layers').split(',') : ['observed-imeplan-2026']).filter(id => known.has(id));
  return [...activeLayers].filter(id => known.has(id));
}
function rebuildHazardIndex() {
  const rIds = new Set(routingIds());
  const srcs = hazardSources.filter(s => s.data && rIds.has(s.layer.id) && ['observed', 'modeled'].includes(s.layer.kind || 'observed'));
  mappedPoints = mappedPointsFrom(hazardSources);
  hazards = buildHazardIndex(srcs.map(s => ({ layer: s.layer, data: s.data })));
  // tag features with _kind for MapLibre styling
  for (const s of hazardSources) if (s.data) for (const f of s.data.features) {
    const h = hazards.find(x => x.feature === f); if (h) f.properties._kind = h.kind;
  }
  if (map) for (const s of hazardSources) { const src = map.getSource(`hz-${s.layer.id}`); if (src && s.data) src.setData(s.data); }
  const tags = $('#layer-tags'); tags.innerHTML = '';
  for (const { layer, data, failed } of hazardSources) {
    if (!activeLayers.has(layer.id) && layer.kind !== 'observed' && layer.kind !== 'modeled') continue;
    const sp = document.createElement('span'); sp.className = `${layer.kind === 'modeled' ? 'modeled' : layer.kind === 'hotspot' ? 'hotspot' : ''} ${activeLayers.has(layer.id) ? '' : 'off'}`;
    const short = (layer.label || layer.id).replace(/\s*\(.*?\)\s*/g, ' ').trim();
    const kindEs = { observed: 'observado', modeled: 'modelado', hotspot: 'mapeado OSM', water: 'mapeado OSM', 'terrain-index': 'índice de terreno' }[layer.kind] || layer.kind || '';
    sp.textContent = layer.kind === 'observed' ? `IMEPLAN 2026 · observado` : `${short.length > 26 ? short.slice(0, 25) + '…' : short} · ${kindEs}`;
    if (failed) sp.textContent += ' (no cargó)';
    tags.append(sp);
  }
  if (!hazardSources.length) { const sp = document.createElement('span'); sp.className = 'off'; sp.textContent = 'sin capas de peligro'; tags.append(sp); }
}

async function selectTrip(preset) {
  setText($('#m-inst'), 'Calculando ruta');
  try {
    trip = await buildTrip(preset, hazards, routerInfo, routingIds(), m => !DEMO && toast(m, 0));
  } catch (e) {
    console.error(e); toast(`No se pudo calcular la ruta: ${e.message}`, 6000); throw e;
  }
  $('#toast').classList.remove('show');
  $('#engine-tag').innerHTML = trip.engineLabel;
  setText($('.attrib .src'), `© OpenStreetMap (ODbL) · OpenFreeMap · OpenMapTiles · AWS Terrain · IMEPLAN 2026 · ${trip.real ? 'cauce-router' : 'OSRM demo'}`);
  setText($('.attrib .disc'), `Zonas: inventario histórico IMEPLAN 2026, no pronóstico · lluvia y velocidad simuladas${trip.provisional ? ' · ruta segura provisional' : ' · rutas: cauce-router (OSM)'}`);
  setText($('#p-note'), trip.provisional ? 'Registros históricos IMEPLAN MUI 2026: no son pronóstico. Ruta segura provisional (el ruteador con riesgo no está disponible).' : 'Registros históricos IMEPLAN MUI 2026: no son pronóstico. La ruta segura la calcula cauce-router (OSM) evitando las capas marcadas; si aún cruza una zona crítica, se bloquea y se recalcula.');
  setRouteData(map, trip);
  for (const h of hazards) h._visible = true;
  neon.setHazards(trip.beaconHazards);
  setText($('#trip-from'), trip.fromName); setText($('#trip-to'), trip.toName);
  setText($('#tc-sub'), `${trip.fromName} → ${trip.toName}`);
  // progress ticks for every registered place along the driven route
  const ticks = $('#tb-ticks'); ticks.innerHTML = '';
  for (const g of trip.drivenGroups) { if (!g.on && g.minDist > 130) continue; const i = document.createElement('i'); i.className = g.on ? '' : 'near'; i.style.left = `${g.at / trip.driven.len * 100}%`; i.style.setProperty('--c', KIND_COLORS[g.kind]); ticks.append(i); }
  fillCompare('start');
  plan = DEMO ? demoPlan(trip) : null;
  window.__cauceTrip = { fast_m: trip.fast.len, plan_m: trip.plan.len, driven_m: trip.driven.len, sP: trip.sP, events: trip.events.map(e => ({ type: e.type, scope: e.scope, s: e.s, cards: e.cards ? e.cards.map(c => c.hazard.name) : [] })), avoided: trip.avoided.map(g => g.hazard.base), engine: trip.engineLabel };
}

function fillCompare(which) {
  const t = trip;
  const fastOn = t.fastGroups.filter(g => g.on).length;
  const end = which !== 'start' || !t.hasReroute;
  const sGroups = end ? t.drivenGroups : t.planGroups;
  const safeOn = sGroups.filter(g => g.on).length;
  const sLen = end ? t.driven.len : t.plan.len, sDur = end ? t.drivenDur : t.planDur;
  setText($('#cmp-head'), `${t.fromName.toUpperCase()} → ${t.toName.toUpperCase()}`);
  setText($('#cmp-fast'), `${fmtKm(t.fast.len)} · ${fmtMin(t.fastDur)}`);
  setText($('#cmp-fast-h'), fastOn ? `cruza ${fastOn} ${fastOn === 1 ? 'zona' : 'zonas'}` : 'sin zonas');
  const safeRow = $('.cmp-row.safe');
  const same = t.planIsFast && !t.hasReroute;
  safeRow.style.display = which === 'start' && t.planIsFast ? 'none' : '';
  const extra = Math.round((sDur - t.fastDur) / 60);
  setText($('#cmp-safe'), same ? 'misma ruta' : `${fmtKm(sLen)} · ${fmtMin(sDur)} (${extra >= 0 ? '+' : ''}${extra} min)`);
  setText($('#cmp-safe-h'), safeOn ? `cruza ${safeOn}` : 'sin cruces');
  const fastNames = t.fastGroups.filter(g => g.on).sort((a, b) => (KIND_RANK[b.kind] || 0) - (KIND_RANK[a.kind] || 0)).slice(0, 3).map(g => shortRef(g.reference || g.hazard.base));
  if (which === 'start') {
    setText($('#cmp-note'), fastOn ? `La más rápida cruza zonas registradas por IMEPLAN: ${fastNames.join(' · ')}${fastOn > 3 ? ` y ${fastOn - 3} más` : ''}.` : 'La ruta más rápida no cruza polígonos registrados.');
  } else {
    const av = t.avoided.sort((a, b) => (KIND_RANK[b.kind] || 0) - (KIND_RANK[a.kind] || 0)).slice(0, 4).map(g => shortRef(g.reference || g.hazard.base));
    const still = t.drivenGroups.filter(g => g.on).map(g => shortRef(g.reference || g.hazard.base));
    setText($('#cmp-note'), `Evita ${t.avoided.length}: ${av.join(' · ') || '—'}${t.avoided.length > 4 ? ` y ${t.avoided.length - 4} más` : ''}.${still.length ? ` Sin alternativa razonable: ${still.join(' · ')}.` : ''}${t.provisional ? ' Ruta segura provisional (desvío por puntos de paso).' : ''}`);
  }
}

// ---------------------------------------------------------------------------------------------
// camera helpers
function viewport() { return { W: innerWidth, H: innerHeight, phone: innerWidth < 700 }; }
function mppAt(zoom, lat) { return 78271.517 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom); }
let overviewCam = null, divergeCam = null;
// Oblique camera that fits a set of points into a screen box (fractions of W/H), keeping bearing and pitch.
function fitOblique(points, bearingDeg, pitch, box) {
  const { W, H } = viewport();
  const saved = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), padding: map.getPadding() };
  let lon = 0, lat = 0; for (const p of points) { lon += p[0]; lat += p[1]; }
  let center = [lon / points.length, lat / points.length], zoom = 12;
  for (let it = 0; it < 12; it++) {
    map.jumpTo({ center, zoom, bearing: bearingDeg, pitch, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of points) { const q = map.project(p); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const bw = (box[1] - box[0]) * W, bh = (box[3] - box[2]) * H;
    zoom += clamp(Math.log2(Math.min(bw / Math.max(1, x1 - x0), bh / Math.max(1, y1 - y0))), -1.5, 1.5) * 0.85;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, tx = (box[0] + box[1]) / 2 * W, ty = (box[2] + box[3]) / 2 * H;
    const c2 = map.unproject([W / 2 + (cx - tx), H / 2 + (cy - ty)]); center = [c2.lng, c2.lat];
  }
  map.jumpTo(saved);
  return { center, zoom, bearing: bearingDeg, pitch, padTop: 0 };
}
function computeOverview() {
  const { phone } = viewport();
  const brg = bearing(trip.from, trip.to);
  const all = []; for (let i = 0; i <= 60; i++) all.push(trip.fast.pointAt(trip.fast.len * i / 60), trip.driven.pointAt(trip.driven.len * i / 60), trip.plan.pointAt(trip.plan.len * i / 60));
  overviewCam = fitOblique(all, brg, phone ? 50 : 54, phone ? [0.1, 0.9, 0.22, 0.56] : [0.22, 0.68, 0.25, 0.84]);
  // where the fast route and the driven/planned routes differ: the part of the trip that tells the story
  const diff = [trip.from];
  const far = (path, others) => { for (let s = 0; s <= path.len; s += 60) { const p = path.pointAt(s); if (others.every(o => o.project(p).d > 70)) diff.push(p); } };
  far(trip.fast, [trip.driven, trip.plan]); far(trip.driven, [trip.fast]); far(trip.plan, [trip.fast]);
  divergeCam = diff.length > 8 ? fitOblique(diff, brg, phone ? 52 : 56, phone ? [0.1, 0.9, 0.22, 0.56] : [0.20, 0.68, 0.26, 0.84]) : overviewCam;
  return overviewCam;
}
function smoothBearing(path, s, tau) {
  let sx = 0, sy = 0;
  for (let k = 0; k < 16; k++) {
    const u = (k / 15) * 3 * tau, w = Math.exp(-u / tau);
    const b = path.bearingAt(s - u, 6, 10) * Math.PI / 180; sx += Math.sin(b) * w; sy += Math.cos(b) * w;
  }
  const ba = path.bearingAt(s + tau * 0.7, 6, 10) * Math.PI / 180; sx += Math.sin(ba) * 0.6; sy += Math.cos(ba) * 0.6;
  return Math.atan2(sx, sy) * R2D;
}
function followCam(s, zoom, pitch) {
  const ll = trip.driven.pointAt(s);
  const mpp = mppAt(zoom, ll[1]);
  const k = Math.max(1, mpp / 0.7);
  const brg = smoothBearing(trip.driven, s, 16 * k);
  const { H, phone } = viewport();
  return { center: ll, zoom, bearing: brg, pitch, padTop: H * (phone ? 0.28 : 0.34) };
}
function blendCam(a, b, w) {
  const ma = maplibregl.MercatorCoordinate.fromLngLat(a.center), mb = maplibregl.MercatorCoordinate.fromLngLat(b.center);
  const m = new maplibregl.MercatorCoordinate(lerp(ma.x, mb.x, w), lerp(ma.y, mb.y, w), 0);
  const ll = m.toLngLat();
  return { center: [ll.lng, ll.lat], zoom: lerp(a.zoom, b.zoom, w), bearing: lerpAngle(a.bearing, b.bearing, w), pitch: lerp(a.pitch, b.pitch, w), padTop: lerp(a.padTop, b.padTop, w) };
}
function applyCam(cam) {
  map.jumpTo({ center: cam.center, zoom: cam.zoom, bearing: cam.bearing, pitch: cam.pitch, padding: { top: cam.padTop, bottom: 0, left: 0, right: 0 } });
}
const zoomForSpeed = v => clamp(17.25 - Math.log2(Math.max(v, 100) / 100) * 0.92, 12.6, 17.0);

// ---------------------------------------------------------------------------------------------
// demo director
let plan = null;
function hermite(keys) {
  // keys: [{t, s, v}] → s(t), v(t)
  const seg = t => { let i = 0; while (i < keys.length - 2 && t > keys[i + 1].t) i++; return i; };
  const at = t => {
    t = clamp(t, keys[0].t, keys[keys.length - 1].t);
    const i = seg(t), a = keys[i], b = keys[i + 1], h = b.t - a.t, u = (t - a.t) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    const d00 = 6 * u ** 2 - 6 * u, d10 = 3 * u ** 2 - 4 * u + 1, d01 = -6 * u ** 2 + 6 * u, d11 = 3 * u ** 2 - 2 * u;
    return { s: h00 * a.s + h10 * h * a.v + h01 * b.s + h11 * h * b.v, v: (d00 * a.s + d10 * h * a.v + d01 * b.s + d11 * h * b.v) / h };
  };
  return at;
}
function demoPlan(t) {
  const ev = t.events;
  const a1 = ev.find(e => e.type === 'alert' && e.scope === 'ahead') || ev.find(e => e.type === 'alert');
  const rr = ev.find(e => e.type === 'reroute');
  const sP = rr ? rr.s : (a1 ? a1.s + 400 : t.driven.len * 0.2);
  const sF = Math.max(0, (a1 ? a1.s : sP) - 140);
  const sAend = Math.min(t.driven.len * 0.6, sP + 700);
  const a2 = ev.find(e => e.type === 'alert' && e.s > sAend + 2500 && e.scope === 'on') || ev.find(e => e.type === 'alert' && e.s > sAend + 2500);
  const keys = [{ t: 0, s: 0, v: 0 }, { t: 3.5, s: 0, v: 0 }, { t: 5.4, s: sF, v: 150 }, { t: 12.6, s: sAend, v: 150 }];
  let tB0 = null, tB1 = null;
  if (a2) {
    const g = a2.cards[0]; const sHz = a2.scope === 'near' ? g.closestAt : g.at;
    const sB0 = a2.s - 120, sB1 = Math.min(t.driven.len - 300, sHz + 420);
    keys.push({ t: 16.9, s: sB0, v: 140 }, { t: 21.2, s: sB1, v: 140 });
    tB0 = 16.9; tB1 = 21.2;
  }
  keys.push({ t: 23.3, s: t.driven.len, v: 0 }, { t: DEMO_DURATION, s: t.driven.len, v: 0 });
  const sv = hermite(keys);
  const tOfS = s => { let lo = 0, hi = DEMO_DURATION; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (sv(m).s < s) lo = m; else hi = m; } return hi; };
  const tReroute = rr ? tOfS(rr.s) : null;
  const tB0x = tB0 ?? 99, tB1x = tB1 ?? 99;
  const evTimes = ev.map(e => ({ e, t: tOfS(e.s) })).filter(({ e, t }) => e.type === 'reroute' || (t >= 5.2 && t <= 12.2) || (t >= tB0x && t <= tB1x - 0.6));
  return { keys, sv, tOfS, tReroute, evTimes, tB0, tB1, a2 };
}

function demoState(T) {
  const p = plan; const t = trip;
  const { s, v } = p.sv(T);
  const ov = overviewCam || computeOverview(); const dv = divergeCam || ov;
  let cam, phase;
  const zv = zoomForSpeed(v);
  let zoom = zv, pitch = 63 - (17 - zv) * 2.4;
  if (p.tReroute !== null) { const b = bump(T, p.tReroute - 0.2, p.tReroute + 3.2, 0.9); zoom -= 1.05 * b; pitch -= 9 * b; }
  if (p.tB0 !== null) { const b = bump(T, p.tB0 + 1.0, p.tB1, 0.8); zoom -= 0.35 * b; }
  const fc = followCam(s, zoom, pitch);
  const drift = (x, k) => ({ ...x, bearing: x.bearing + k });
  if (T < 3.5) { phase = 'overview'; cam = blendCam(drift(ov, T * 1.5), drift(dv, T * 1.5), smooth((T - 1.0) / 1.8)); }
  else if (T < 5.4) { phase = 'fly'; const w = smooth((T - 3.5) / 1.9); cam = blendCam(drift(dv, 3.5 * 1.5), fc, w); }
  else if (T < 21.3) { phase = (T > 12.6 && (p.tB0 === null || T < p.tB0)) ? 'ff' : 'follow'; cam = fc; }
  else if (T < 23.3) { phase = 'outro'; cam = blendCam(fc, ov, smooth((T - 21.3) / 2.0)); }
  else { phase = 'outro'; cam = blendCam(ov, drift(dv, -(T - 23.3) * 1.2), smooth((T - 23.3) / 1.5)); }
  // alerts by time windows
  const alerts = [];
  let rerouted = false, rerouteAge = -1;
  for (const { e, t: te } of p.evTimes) {
    if (e.type === 'reroute') { if (T >= te) { rerouted = true; rerouteAge = T - te; } continue; }
    const life = 3.6, age = T - te;
    if (age >= 0 && age < life && phase !== 'overview' && phase !== 'outro') alerts.push({ ev: e, age, life });
  }
  const rain = 25 + 15 * smooth((T - 1) / 4) + 15 * bump(T, (p.tB0 ?? 30) - 0.5, (p.tB1 ?? 30) + 0.5, 1.0);
  return { t: T, s, v, cam, phase, alerts, rerouted, rerouteAge, rainMm: rain, flash: lightning(T, [1.4, 16.95]),
    titleO: bump(T, 0.1, 3.3, 0.5), compare: T > 22.6 ? 'end' : (T < 3.6 ? 'start' : null), compareO: Math.max(bump(T, 0.6, 3.5, 0.45), smooth((T - 22.6) / 0.7)),
    speedVisible: phase !== 'overview' && phase !== 'outro' ? 1 : 0, legendO: phase === 'overview' || T > 22.6 ? 1 : 0.0 };
}

// ---------------------------------------------------------------------------------------------
// shared frame renderer
let lastManeuverKey = '';
function renderFrame(st) {
  const p0 = performance.now();
  renderFrameInner(st);
  const perf = window.__perf || (window.__perf = { n: 0, ms: 0, max: 0 });
  const dt = performance.now() - p0; perf.n++; perf.ms += dt; perf.max = Math.max(perf.max, dt);
}
function renderFrameInner(st) {
  const t = trip;
  const T = st.t;
  if (st.cam) applyCam(st.cam);
  const zoom = map.getZoom();
  const carLL = t.driven.pointAt(st.s);
  const mpp = mppAt(zoom, carLL[1]);
  const heading = t.driven.bearingAt(st.s, 6, 9);
  const camHeading = map.getBearing();
  // car scale: ~ 58 px long on screen (phone 46), never smaller than real size.
  const wideCar = st.phase === 'overview' || st.phase === 'outro' || st.phase === 'browse';
  const carScale = Math.max(1, (viewport().phone ? 84 : 120) * (wideCar ? 0.45 : 1) * mpp / 4.6);
  const inHz = t.drivenGroups.some(g => g.on && st.s > g.at - 15 && st.s < g.at + Math.max(40, g.hits[0].insideLen) + 15);
  // which hazards are emphasised: those in visible alerts (+ the avoided ones after reroute)
  const active = new Map();
  for (const a of st.alerts) for (const g of a.ev.cards) for (const h of g.hits) active.set(h.hazard.id, 1);
  if (!st.rerouted) for (const g of t.planGroups.filter(g => g.on)) for (const h of g.hits) if (!active.has(h.hazard.id)) active.set(h.hazard.id, 0.5);
  if (st.rerouted && st.rerouteAge < 4) for (const g of t.avoided) for (const h of g.hits) active.set(h.hazard.id, 1);
  const vReal = simSpeed(st.s, inHz);
  neon.update({ t: T, mpp, carLL, heading, carScale, speedFactor: clamp(st.v / 300, 0, 1), visibleCar: true, path: t.driven, s: st.s,
    trailLen: clamp(18 * carScale + st.v * 0.9, 20, 2600), inHazard: inHz, activeHazards: active, hazardBoost: 1 + (st.flash || 0), flash: st.flash || 0,
    rainLevel: clamp(st.rainMm / 60, 0.2, 1.4), pillarScale: wideCar ? 0.45 : 1, carFx: wideCar ? 0 : 1,
    aheadEnd: (t.hasReroute && !st.rerouted) ? t.sP : (t.hasReroute ? t.sP + (t.driven.len - t.sP) * smooth((st.rerouteAge || 0) / 1.4) : t.driven.len), aheadPath: (t.hasReroute && !st.rerouted && !t.planIsFast) ? t.plan : null });
  // route gradient
  const planOpacity = !t.hasReroute || t.planIsFast ? 0 : st.rerouted ? 1 - smooth(st.rerouteAge / 1.2) : 1;
  map.setPaintProperty('r-plan-line', 'line-opacity', planOpacity);
  map.setPaintProperty('r-plan-glow', 'line-opacity', planOpacity * 0.6);
  map.setPaintProperty('r-plan-xray', 'line-opacity', planOpacity * 0.4);
  const len = t.driven.len;
  const wideNow = st.phase === 'overview' || st.phase === 'outro' || st.phase === 'browse';
  const pCar = wideNow ? 0 : st.s / len;
  const pReroute = t.hasReroute ? t.sP / len : 1;
  const grow = !t.hasReroute ? 1 : st.rerouted ? lerp(pReroute, 1, smooth(st.rerouteAge / 1.4)) : pReroute;
  // line-gradient re-rasterises a texture per tile, so it is only updated when the reroute front moves
  // (or the traveled part changes by > 0.5 %); the moving pulse/chevrons ahead of the car are drawn in three.js.
  const pCarQ = Math.floor(pCar * 200) / 200;
  const gKey = `${grow.toFixed(4)}|${pCarQ}`;
  if (gKey !== renderFrameInner._gKey) {
    renderFrameInner._gKey = gKey;
    map.setPaintProperty('r-safe-core', 'line-gradient', safeGradient(pCarQ, grow, -1, 1, 'core'));
    map.setPaintProperty('r-safe-glow', 'line-gradient', safeGradient(pCarQ, grow, -1, 1, 'glow'));
    map.setPaintProperty('r-safe-hot', 'line-gradient', safeGradient(pCarQ, grow, -1, 1, 'hot'));
    map.setPaintProperty('r-safe-xray', 'line-gradient', safeGradient(pCarQ, grow, -1, 0.42, 'glow'));
  }
  map.setPaintProperty('r-safe-reflect', 'line-opacity', 0.07 + 0.03 * Math.sin(T * 2));
  const hzPulse = 0.55 + 0.45 * Math.sin(T * 4.5);
  const wideRoute = st.phase === 'overview' || st.phase === 'outro' || st.phase === 'browse';
  map.setPaintProperty('r-base-line', 'line-opacity', st.rerouted && !wideRoute ? 0.55 : 0.95);
  map.setPaintProperty('r-base-glow', 'line-opacity', st.rerouted && !wideRoute ? 0.18 : 0.45);
  if (wideRoute !== renderFrameInner._wide) { renderFrameInner._wide = wideRoute; map.setPaintProperty('r-base-line', 'line-width', ['interpolate', ['exponential', 1.5], ['zoom'], 11, wideRoute ? 3 : 2, 15, wideRoute ? 5 : 4, 18, 9]); }
  map.setPaintProperty('r-base-hz-glow', 'line-opacity', 0.35 + 0.45 * hzPulse);
  // lightning lifts the whole map a touch
  document.getElementById('map').style.filter = st.flash ? `brightness(${1 + st.flash * 1.3}) saturate(${1 - st.flash * 0.3})` : '';
  $('#flash').style.opacity = String((st.flash || 0) * 0.55);
  // rain
  rain.draw(T, { intensity: clamp(st.rainMm / 70, 0.15, 1.2), motion: clamp(st.v / 4000, 0, 0.6) });
  setText($('#rain-val'), String(Math.round(st.rainMm))); rainBars(st.rainMm);
  // maneuver banner
  const steps = (t.hasReroute && !st.rerouted) ? t.planSteps : t.drivenSteps;
  const next = steps.find(x => x.s > st.s + 8 && x.p.type !== 'depart') || steps[steps.length - 1];
  const man = $('#maneuver');
  const banner = st.alerts.find(a => a.ev.scope === 'on');
  if (st.phase === 'overview' || st.phase === 'outro' || st.phase === 'browse' || !next) {
    man.style.opacity = '0';
  } else {
    man.style.opacity = '1';
    const es = instructionEs(next.p);
    const key = next.instruction + (banner ? 'w' : '');
    if (key !== lastManeuverKey) { lastManeuverKey = key; $('#arrow-path').setAttribute('d', banner ? ARROWS.warn : arrowFor(next.p)); }
    man.classList.toggle('warn', !!banner);
    if (banner) {
      const g = banner.ev.cards[0]; const d = Math.max(0, g.at - st.s);
      const inside = st.s >= g.at - 10 && st.s <= g.at + Math.max(40, g.hits[0].insideLen) + 10;
      setText($('#m-dist'), inside ? 'DENTRO' : fmtDist(d));
      setText($('#m-inst'), inside ? 'Cruza despacio · 18 km/h' : 'Precaución · agua registrada');
      setText($('#m-street'), g.reference || g.hazard.base);
    } else {
      setText($('#m-dist'), fmtDist(Math.max(0, next.s - st.s)));
      setText($('#m-inst'), es.verb);
      setText($('#m-street'), es.street || (next.p.type === 'arrive' ? t.toName : ' '));
    }
  }
  // speed
  $('#speed').style.opacity = String(st.speedVisible ?? 1);
  setText($('#speed-val'), String(Math.round(vReal)));
  $('#g-fill').style.strokeDashoffset = String(245 * (1 - clamp(vReal / 110, 0, 1)));
  const factor = st.v / Math.max(1, vReal / 3.6);
  const xf = `×${factor < 20 ? Math.round(factor) : Math.round(factor / 10) * 10}`;
  setText($('#speed-sub'), st.v > 1 ? (viewport().phone ? `simulada · ${xf}` : `vel. simulada · reproducción ${xf}`) : 'vel. simulada');
  // trip panel
  const headDur = t.hasReroute ? t.planDur * (t.sP / t.plan.len) : 0;
  const durAt = s => t.hasReroute && s > t.sP ? headDur + (t.drivenDur - headDur) * ((s - t.sP) / (len - t.sP)) : t.planDur * (s / t.plan.len);
  const total = t.hasReroute && !st.rerouted ? t.planDur : t.drivenDur;
  const remainingLen = t.hasReroute && !st.rerouted ? t.plan.len - st.s : len - st.s;
  const elapsed = durAt(st.s);
  setText($('#eta-clock'), fmtClock(START_CLOCK + total));
  setText($('#eta-km'), fmtKm(Math.max(0, remainingLen)));
  setText($('#eta-min'), fmtMin(Math.max(0, total - elapsed)));
  setText($('#eta-avoid'), String(st.rerouted || !t.hasReroute ? t.avoided.length : t.planAvoided.length));
  const etaEl = $('#eta-clock');
  etaEl.style.color = st.rerouted && st.rerouteAge < 3.5 ? '#ffb020' : '';
  $('#tb-fill').style.width = `${st.s / len * 100}%`;
  $('#tb-car').style.left = `${st.s / len * 100}%`;
  $('#tb-ticks').style.opacity = st.rerouted || !t.hasReroute ? '1' : '0.35';
  // alerts + reroute banner
  updateAlerts(st.alerts, carLL, st.s, t);
  const rr = $('#reroute');
  if (st.rerouted && st.rerouteAge < 2.4) {
    const a = st.rerouteAge; const o = Math.min(smooth(a / 0.2), smooth((2.4 - a) / 0.4));
    rr.style.opacity = String(o);
    const glitch = a < 0.5 ? Math.sin(a * 90) * 6 * (1 - a / 0.5) : 0;
    rr.style.transform = `translate(calc(-50% + ${glitch}px), -50%) scale(${1 + 0.06 * (1 - smooth(a / 0.4))})`;
    setText($('#rr-title'), a < 1.2 ? 'RECALCULANDO' : 'RUTA SEGURA');
    setText($('.rr-kicker'), a < 1.2 ? '◢ ALERTA EN TU RUTA ◣' : '◢ NUEVA RUTA ◣');
    const extra = Math.round((t.drivenDur - t.planDur) / 60);
    const ra = t.rerouteAvoided.length ? t.rerouteAvoided : t.avoided;
    setText($('#rr-sub'), a < 1.2 ? (ra.length === 1 ? `evitando ${shortRef(ra[0].reference || ra[0].hazard.base).toLowerCase()}` : `evitando ${ra.length} zonas registradas`) : `${extra >= 0 ? '+' : ''}${extra} min · ${fmtKm(len - st.s)} restantes`);
  } else rr.style.opacity = '0';
  // title / compare cards
  if (DEMO) {
    $('#title-card').style.opacity = String(st.titleO || 0);
    if (st.compare && st.compare !== fillCompare._last) { fillCompare(st.compare); fillCompare._last = st.compare; }
    $('#compare').style.opacity = String(st.compareO || 0);
    document.body.style.setProperty('--legend-o', String(st.legendO ?? 1));
    $('#legend').style.opacity = String(st.legendO ?? 1);
  }
  // radar
  $('#radar-box').style.opacity = String(st.speedVisible ?? 1);
  const radarRange = clamp(1000 * Math.max(1, mpp / 0.75), 1000, 6000);
  drawRadar({ t: T, carLL, heading: camHeading, s: st.s, fastS: t.fast.project(carLL).s, planOpacity, trip: t, radarRange, radarHazards: hazards.length < 600 ? hazards : t.beaconHazards,
    activeHazards: active, showBase: true, showSafe: true, safeEnd: grow * len });
  // floating labels
  const wide = st.phase === 'overview' || st.phase === 'outro' || st.phase === 'browse';
  const items = [
    { id: 'A', ll: t.from, html: `A · ${escapeHtml(t.fromName)}`, cls: 'end', opacity: wide ? 1 : 0 },
    { id: 'B', ll: t.to, html: `B · ${escapeHtml(t.toName)}`, cls: 'end', opacity: wide || st.phase === 'ff' || st.phase === 'fly' ? 1 : 0, minY: 90 },
  ];
  const bannerOn = st.rerouted && st.rerouteAge >= 0 && st.rerouteAge < 2.4;
  const bySev = arr => arr.slice().sort((a, b) => (KIND_RANK[b.kind] || 0) - (KIND_RANK[a.kind] || 0) || a.at - b.at);
  const labelGroups = wide ? (st.rerouted || !t.hasReroute ? bySev(t.avoided).slice(0, 3).concat(t.rerouteAvoided.filter(g => !t.avoided.includes(g)), t.drivenGroups.filter(g => g.on)) : bySev(t.fastGroups.filter(g => g.on)).slice(0, 3).concat(t.planGroups.filter(g => g.on && !t.fastGroups.some(f => f.key === g.key))))
    : bannerOn ? [] : st.alerts.flatMap(a => a.ev.cards).filter(g => hazardDistance(g.hazard, carLL) < 2200);
  for (const g of labelGroups) {
    const avoidedG = t.avoided.includes(g) || t.rerouteAvoided.includes(g);
    items.push({ id: `hz-${g.key}`, ll: g.hazard.centroid, color: KIND_COLORS[g.kind], lift: wide ? 26 : 64, minY: wide ? 110 : 150,
      html: `${escapeHtml(g.reference && wide ? shortRef(g.reference) : g.hazard.base)}<small>${escapeHtml(wide && (st.rerouted || !t.hasReroute) ? (avoidedG ? 'evitada · ' + KIND_TITLE[g.kind].toLowerCase() : 'sin alternativa · precaución') : KIND_TITLE[g.kind])}</small>` });
  }
  updateLabels(map, items);
  document.body.classList.toggle('phase-overview', st.phase === 'overview');
  map.triggerRepaint();
}
const START_CLOCK = DEMO ? (23 * 3600 + 12 * 60) : (() => { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60; })();

function simSpeed(s, inHz) {
  const t = trip; const base = t.avgMs * 3.6;
  const turn = Math.abs(((t.driven.bearingAt(s + 20, 0, 25) - t.driven.bearingAt(s - 20, 25, 0)) % 360 + 540) % 360 - 180);
  let v = base * (1 - clamp(turn / 140, 0, 0.6)) * (0.92 + 0.08 * Math.sin(s / 140));
  if (inHz) v = Math.min(v, 18);
  for (const g of t.drivenGroups) if (g.on && s > g.at - 160 && s < g.at) v = Math.min(v, lerp(base, 18, (s - (g.at - 160)) / 160));
  if (s > t.driven.len - 120) v *= clamp((t.driven.len - s) / 120, 0, 1);
  if (s < 60) v *= clamp(s / 60, 0.2, 1);
  return Math.max(0, v);
}

// ---------------------------------------------------------------------------------------------
// demo mode
let autoplay = true;
function startDemo() {
  computeOverview();
  const t0q = Q.get('t');
  const renderAt = T => renderFrame(demoState(clamp(T, 0, DEMO_DURATION)));
  const nextRender = () => new Promise(res => { map.once('render', () => requestAnimationFrame(() => res())); map.triggerRepaint(); });
  async function settle(maxMs = 9000) {
    const t0 = performance.now();
    await nextRender();
    while (performance.now() - t0 < maxMs) { if (map.areTilesLoaded() && map.isStyleLoaded()) break; await nextRender(); }
  }
  window.__cauceDemo = {
    duration_s: DEMO_DURATION,
    async seek(T) { autoplay = false; renderAt(T); await settle(); renderAt(T); await nextRender(); return T; },
    play() { autoplay = true; start = performance.now() - (Q.get('t') ? +Q.get('t') : 0) * 1000; loop(); },
    pause() { autoplay = false; },
    trip: window.__cauceTrip,
    timeline: plan ? plan.evTimes.map(({ e, t }) => ({ t: Math.round(t * 100) / 100, type: e.type, scope: e.scope || null, places: (e.cards || []).map(c => c.hazard.base) })) : [],
  };
  let start = performance.now();
  const loop = () => {
    if (!autoplay) return;
    let T = (performance.now() - start) / 1000;
    if (T > DEMO_DURATION + 3) { start = performance.now(); T = 0; }
    renderAt(T);
    requestAnimationFrame(loop);
  };
  if (t0q !== null) { autoplay = false; window.__cauceDemo.seek(+t0q); }
  else document.fonts.ready.then(() => { start = performance.now(); loop(); });
  window.__cauceDemoReady = true;
}

// ---------------------------------------------------------------------------------------------
// browse + drive modes (interactive)
let driveState = null, pickState = null, playX = 30;
function browseState(T) {
  return { t: T, s: 0, v: 0, cam: null, phase: 'browse', alerts: [], rerouted: true, rerouteAge: 99, rainMm, flash: lightning(T % 37, [9.3]), speedVisible: 0 };
}
function startBrowse() {
  document.body.classList.add('mode-browse');
  const ov = computeOverview();
  map.jumpTo({ center: ov.center, zoom: ov.zoom, bearing: ov.bearing, pitch: ov.pitch });
  $('#compare').style.opacity = '1'; fillCompare('end');
  let t0 = performance.now(), last = t0;
  const loop = now => {
    const T = (now - t0) / 1000, dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (mode === 'drive' && driveState) renderFrame(driveStep(T, dt));
    else renderFrame(browseState(T));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
function driveStep(T, dt) {
  const d = driveState; const t = trip;
  const inHz = t.drivenGroups.some(g => g.on && d.s > g.at - 15 && d.s < g.at + 60);
  const vReal = Math.max(4, simSpeed(d.s, inHz)) / 3.6;
  d.v = vReal * playX; d.s = Math.min(t.driven.len, d.s + d.v * dt);
  if (!d.rerouteT && t.hasReroute && d.s >= t.sP) d.rerouteT = T;
  for (const e of t.events) if (e.type === 'alert' && !d.seen.has(e.id) && d.s >= e.s) d.seen.set(e.id, T);
  const alerts = [];
  for (const [id, te] of d.seen) { const e = t.events.find(x => x.id === id); const age = T - te; if (age < 4.5) alerts.push({ ev: e, age, life: 4.5 }); }
  const zoom = zoomForSpeed(d.v);
  const cam = followCam(d.s, zoom, 63 - (17 - zoom) * 2.4);
  if (d.s >= t.driven.len - 1 && !d.doneT) d.doneT = T;
  if (d.doneT && T - d.doneT > 1.5) { endDrive(); }
  return { t: T, s: d.s, v: d.v, cam, phase: 'follow', alerts: alerts.slice(-2), rerouted: !!d.rerouteT || !t.hasReroute, rerouteAge: d.rerouteT ? T - d.rerouteT : -1, rainMm, flash: lightning(T % 41, [12.2]), speedVisible: 1 };
}
function startDrive() {
  if (!trip) return;
  mode = 'drive'; driveState = { s: 0, v: 0, seen: new Map(), rerouteT: null, doneT: null };
  document.body.classList.remove('mode-browse');
  $('#compare').style.opacity = '0';
  for (const k of ['dragPan', 'scrollZoom', 'touchZoomRotate', 'dragRotate', 'keyboard', 'doubleClickZoom']) map[k].disable();
  $('#drive').textContent = '■ Detener';
  if (innerWidth < 700) { $('#panel').classList.add('collapsed'); }
}
function endDrive() {
  mode = 'browse'; driveState = null;
  document.body.classList.add('mode-browse');
  for (const k of ['dragPan', 'scrollZoom', 'touchZoomRotate', 'dragRotate', 'keyboard', 'doubleClickZoom']) map[k].enable();
  $('#drive').textContent = '▶ Conducir';
  const ov = computeOverview();
  map.easeTo({ center: ov.center, zoom: ov.zoom, bearing: ov.bearing, pitch: ov.pitch, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 1600 });
  $('#compare').style.opacity = '1'; fillCompare('end');
}
function setupPanel() {
  if (DEMO) return;
  const sel = $('#preset');
  for (const p of PRESETS) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.label; sel.append(o); }
  sel.value = (PRESETS.find(p => p.id === Q.get('route')) || PRESETS[0]).id;
  sel.addEventListener('change', async () => { if (mode === 'drive') endDrive(); await selectTrip(PRESETS.find(p => p.id === sel.value)); endDrive(); });
  $('#panel-toggle').addEventListener('click', () => { const c = $('#panel').classList.toggle('collapsed'); $('#panel-toggle').setAttribute('aria-expanded', String(!c)); });
  if (innerWidth < 700) $('#panel').classList.add('collapsed');
  $('#drive').addEventListener('click', () => mode === 'drive' ? endDrive() : startDrive());
  $('#overview').addEventListener('click', () => endDrive());
  document.querySelectorAll('#rain-chips button').forEach(b => b.addEventListener('click', () => {
    rainMm = +b.dataset.rain; document.querySelectorAll('#rain-chips button').forEach(x => x.classList.toggle('on', x === b));
    // modeled layers that declare a rainfall intensity follow the chip; observed layers do not depend on rain
    let changed = false;
    for (const { layer } of hazardSources) { const r = rainOf(layer); if (layer.kind === 'modeled' && r !== null) { const on = Math.abs(r - rainMm) < 1e-6 || nearestRain(r); if (on !== activeLayers.has(layer.id)) { changed = true; on ? activeLayers.add(layer.id) : activeLayers.delete(layer.id); } } }
    if (changed) refreshLayers(); else toast('El inventario IMEPLAN es histórico: no cambia con la lluvia. Los escenarios modelados aparecerán aquí cuando existan.', 4200);
  }));
  document.querySelectorAll('#speed-chips button').forEach(b => b.addEventListener('click', () => { playX = +b.dataset.x; document.querySelectorAll('#speed-chips button').forEach(x => x.classList.toggle('on', x === b)); }));
  const tg = $('#hazard-toggles');
  for (const { layer, data, failed } of hazardSources) {
    const l = document.createElement('label');
    const n = data ? (data.features || []).filter(f => f.geometry && /Polygon/.test(f.geometry.type)).length : 0;
    l.innerHTML = `<input type="checkbox" ${activeLayers.has(layer.id) ? 'checked' : ''}><span>${escapeHtml(layer.label || layer.id)}<small>${escapeHtml(layer.kind || '')} · ${layer.type}${n ? ` · ${n} polígonos` : ''}${failed ? ' · no cargó' : ''}${rainOf(layer) !== null ? ` · ${rainOf(layer)} mm/h` : ''}</small></span>`;
    l.querySelector('input').addEventListener('change', e => { e.target.checked ? activeLayers.add(layer.id) : activeLayers.delete(layer.id); refreshLayers(); });
    tg.append(l);
  }
  $('#pick').addEventListener('click', () => {
    if (mode === 'drive') endDrive();
    pickState = { a: null }; document.body.classList.add('picking'); $('#pick').classList.add('active'); toast('Toca el mapa para elegir el ORIGEN', 0);
  });
  map.on('click', async e => {
    if (!pickState) return;
    const ll = [e.lngLat.lng, e.lngLat.lat];
    if (!pickState.a) { pickState.a = ll; toast('Ahora toca el DESTINO', 0); return; }
    const preset = { id: 'custom', label: 'Ruta elegida', from: pickState.a, to: ll, fromName: 'Origen elegido', toName: 'Destino elegido' };
    pickState = null; document.body.classList.remove('picking'); $('#pick').classList.remove('active');
    try { await selectTrip(preset); endDrive(); } catch { /* toast shown */ }
  });
  function nearestRain(r) {
    const rs = hazardSources.map(s => rainOf(s.layer)).filter(v => v !== null);
    const best = rs.reduce((b, v) => Math.abs(v - rainMm) < Math.abs(b - rainMm) ? v : b, rs[0]);
    return r === best;
  }
}
async function refreshLayers() {
  rebuildHazardIndex();
  for (const { layer } of hazardSources) for (const suf of ['fill', 'glow', 'line', 'raster']) { const id = `hz-${layer.id}-${suf}`; if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', activeLayers.has(layer.id) ? 'visible' : 'none'); }
  const cur = trip ? trip.preset : PRESETS[0];
  await selectTrip(cur); endDrive();
}

main().catch(e => { console.error(e); setText($('#m-inst'), 'Error al iniciar'); toast(`Error: ${e.message}`, 0); });
