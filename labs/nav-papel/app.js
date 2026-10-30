// cauce. · nav-papel — navigation prototype that avoids recorded flooding. Paper cut-out + risograph art direction.
// Data: OpenFreeMap vector tiles (OSM), IMEPLAN MUI 2026 via /labs/shared/hazard/index.json, routes via /labs/shared/router.
import { INK, patternSet, grainDataURL, paperImage, tornRing, rng } from './paper.js';
import { createCarLayer } from './car.js';

const Q = new URLSearchParams(location.search);
const DEMO = Q.get('demo') === '1';
const FORCE_SNAPSHOT = Q.get('snapshot') === '1';
const DUR = 26;
const PERF = new Set((Q.get('perf') || '').split(',')); // debug switches to profile subsystems
const ZO = +(Q.get('zo') || 0); // debug: extra zoom on the follow camera (inspect the car)
const $ = s => document.querySelector(s);
if (DEMO) document.body.classList.add('demo');

// ---------------------------------------------------------------- geometry helpers
const D2R = Math.PI / 180, LAT0 = 20.62, KX = 111320 * Math.cos(LAT0 * D2R), KY = 110574;
const fxy = p => [p[0] * KX, p[1] * KY], fll = q => [q[0] / KX, q[1] / KY];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeOutBack = t => { if (t <= 0) return 0; if (t >= 1) return 1; const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const angDiff = (a, b) => ((b - a + 540) % 360) - 180;
const mpp = z => 40075016.7 * Math.cos(LAT0 * D2R) / (512 * Math.pow(2, z));
const zoomForMpp = m => Math.log2(40075016.7 * Math.cos(LAT0 * D2R) / (512 * m));
function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0; t = clamp(t, 0, 1); return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]); }
function pip(pt, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c; } return c; }
const near = (a, b, m = 120) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY) < m;
const fmtKm = m => m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1).replace('.', ',') + ' km' : Math.round(m / 10) * 10 + ' m';
const fmtMin = s => Math.max(1, Math.round(s / 60)) + ' min';

class Path {
  constructor(coords) {
    this.c = coords; this.xy = coords.map(fxy); this.cum = [0];
    for (let i = 1; i < this.xy.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.xy[i][0] - this.xy[i - 1][0], this.xy[i][1] - this.xy[i - 1][1]));
    this.L = this.cum[this.cum.length - 1];
  }
  idx(s) { let lo = 0, hi = this.cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; } return lo; }
  xyAt(s) { s = clamp(s, 0, this.L); const i = this.idx(s), j = Math.min(i + 1, this.xy.length - 1), d = this.cum[j] - this.cum[i], f = d > 0 ? (s - this.cum[i]) / d : 0; return [lerp(this.xy[i][0], this.xy[j][0], f), lerp(this.xy[i][1], this.xy[j][1], f)]; }
  at(s) { return fll(this.xyAt(s)); }
  bearing(s, back, ahead, n = 10) {
    let vx = 0, vy = 0;
    for (let k = 0; k <= n; k++) { const u = s - back + (back + ahead) * k / n; const a = this.xyAt(u - 4), b = this.xyAt(u + 4); const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l > 0) { const w = 1 - Math.abs(k / n - .5) * .8; vx += w * dx / l; vy += w * dy / l; } }
    return Math.atan2(vx, vy) / D2R;
  }
  slice(s0, s1) { s0 = clamp(s0, 0, this.L); s1 = clamp(s1, 0, this.L); const out = [this.at(s0)]; for (let i = 0; i < this.c.length; i++) if (this.cum[i] > s0 && this.cum[i] < s1) out.push(this.c[i]); out.push(this.at(s1)); return out; }
  dense(step = 10) {
    if (this._dense) return this._dense; const pts = [], s = [];
    for (let i = 0; i < this.xy.length - 1; i++) { const a = this.xy[i], b = this.xy[i + 1], L = this.cum[i + 1] - this.cum[i], n = Math.max(1, Math.ceil(L / step)); for (let k = 0; k < n; k++) { pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); s.push(this.cum[i] + L * k / n); } }
    pts.push(this.xy[this.xy.length - 1]); s.push(this.L); return (this._dense = { pts, s });
  }
  project(ll, s0 = 0, s1 = Infinity) {
    const p = fxy(ll); let best = Infinity, bs = s0;
    for (let i = 0; i < this.xy.length - 1; i++) {
      if (this.cum[i + 1] < s0 - 30 || this.cum[i] > s1) continue;
      const a = this.xy[i], b = this.xy[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0; t = clamp(t, 0, 1);
      const d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]); if (d < best) { best = d; bs = this.cum[i] + t * Math.sqrt(l); }
    }
    return { s: bs, d: best };
  }
}

// Monotone cubic (Fritsch–Carlson) through keyframes; zero slope at both ends (car starts and stops).
function monotone(xs, ys) {
  const n = xs.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  for (let i = 1; i < n - 1; i++) { if (d[i - 1] * d[i] <= 0) m[i] = 0; else { const w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]), w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]); m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); } }
  return x => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// ---------------------------------------------------------------- hazards
// Registry kinds: observed / modeled are rain "scenarios" (toggle). water / hotspot are mapped supporting layers (OSM):
// hotspots are drawn while any rain scenario is on; both are passed to the router as hazards to avoid. terrain-index is
// treated like modeled when it is polygonal GeoJSON.
const isScenarioKind = k => k === 'observed' || k === 'modeled' || k === 'terrain-index';
const SEV = { desnivel: 3, critica: 2, sitio: 1, modeled: 1 };
const KIND_LABEL = { desnivel: 'Paso a desnivel inundable', critica: 'Zona crítica IMEPLAN', sitio: 'Encharcamiento reportado', modeled: 'Agua en el modelo' };
const shortRef = r => { const t = (r || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/^Paso a desnivel\s+/i, 'Desnivel ').replace(/\s+/g, ' ').trim(); if (t.length <= 42) return t; const c = t.slice(0, 41); return c.slice(0, Math.max(20, c.lastIndexOf(' '))).replace(/[\s,.;:y]+$/, '') + '…'; };
const fmtRange = r => r ? String(r).replace(/\s*-\s*/g, '–').replace(/\s+/g, '') + ' cm' : '';

function prepareHotspots(layer, fc) {
  const feats = (fc.features || []).filter(f => f.geometry && /LineString|Point/.test(f.geometry.type));
  return { layer, support: true, hotspot: { type: 'FeatureCollection', features: feats.map(f => ({ type: 'Feature', properties: { conf: f.properties?.confidence || 'media', site: f.properties?.site || '' }, geometry: f.geometry })) }, pieces: [], sites: new Map() };
}
function prepareSet(layer, fc) {
  const isObs = layer.kind === 'observed';
  const refs = {};
  for (const f of fc.features || []) if (f.geometry?.type === 'Point' && f.properties?.name) refs[f.properties.name] = f;
  const sites = new Map(), pieces = [], rim = [], piece = [], labelPts = [];
  let seed = 1;
  const big = (fc.features || []).length > 4000;
  for (const [i, f] of (fc.features || []).entries()) {
    const g = f.geometry; if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    const p = f.properties || {};
    const name = String(p.name ?? p.id ?? f.id ?? `${layer.id}-${i}`), base = name.split('/')[0];
    const txt = [p.Motivo, p['Infraestructura expuesta'], p['Sistema afectable']].join(' ');
    const kind = !isObs ? 'modeled' : /desnivel/i.test(txt) ? 'desnivel' : p.category === 'Zonas Criticas' ? 'critica' : 'sitio';
    const rp = refs[base]?.properties || {};
    let site = sites.get(base);
    if (!site) { site = { base, kind, ref: rp.Referencia || p.Referencia || p.nombre || p.label || '', range: rp['Rango de alturas de inundación (cm)'] || '', layer: layer.id, labelAt: refs[base]?.geometry?.coordinates || null, pieces: [] }; sites.set(base, site); }
    if (SEV[kind] > SEV[site.kind]) site.kind = kind;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      const ring = poly[0]; if (!ring || ring.length < 4) continue;
      const xy = ring.map(fxy); let bb = [1e18, 1e18, -1e18, -1e18]; for (const q of xy) { bb[0] = Math.min(bb[0], q[0]); bb[1] = Math.min(bb[1], q[1]); bb[2] = Math.max(bb[2], q[0]); bb[3] = Math.max(bb[3], q[1]); }
      const pc = { site, kind, xy, bbox: bb, ring }; pieces.push(pc); site.pieces.push(pc);
      const props = { kind, base, sev: SEV[kind] };
      if (big) { rim.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } }); piece.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } }); continue; }
      const per = Math.max(bb[2] - bb[0], bb[3] - bb[1]); const amp = clamp(per / 25, .6, 2.4);
      seed++;
      rim.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [tornRing(ring, seed * 31, { offset: clamp(per / 22, 2, 6), amp: amp * 1.3, step: 4, jag: 1.6 })] } });
      piece.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [tornRing(ring, seed * 17 + 5, { offset: -.3, amp: amp * .7, step: 4, jag: .7 })] } });
    }
  }
  for (const s of sites.values()) {
    if (!s.labelAt) { const pc = s.pieces.reduce((a, b) => (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]) > (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) ? b : a); s.labelAt = fll([(pc.bbox[0] + pc.bbox[2]) / 2, (pc.bbox[1] + pc.bbox[3]) / 2]); }
    labelPts.push({ type: 'Feature', properties: { base: s.base, kind: s.kind, label: shortRef(s.ref) || s.base, range: fmtRange(s.range) }, geometry: { type: 'Point', coordinates: s.labelAt } });
  }
  const avoidFC = { type: 'FeatureCollection', features: (fc.features || []).filter(f => f.geometry && /Polygon/.test(f.geometry.type)) };
  return { layer, sites, pieces, rim: { type: 'FeatureCollection', features: rim }, piece: { type: 'FeatureCollection', features: piece }, labels: { type: 'FeatureCollection', features: labelPts }, avoidFC };
}

function siteHits(path, hz, maxD = 45) {
  if (!hz || !hz.pieces?.length) return [];
  const D = path.dense(10); const rb = [1e18, 1e18, -1e18, -1e18];
  for (const p of D.pts) { rb[0] = Math.min(rb[0], p[0]); rb[1] = Math.min(rb[1], p[1]); rb[2] = Math.max(rb[2], p[0]); rb[3] = Math.max(rb[3], p[1]); }
  const res = new Map();
  for (const pc of hz.pieces) {
    const b = pc.bbox; if (b[2] < rb[0] - maxD || b[0] > rb[2] + maxD || b[3] < rb[1] - maxD || b[1] > rb[3] + maxD) continue;
    let inside = false, sIn = 0, best = Infinity, sBest = 0;
    for (let i = 0; i < D.pts.length; i++) {
      const p = D.pts[i]; if (p[0] < b[0] - maxD || p[0] > b[2] + maxD || p[1] < b[1] - maxD || p[1] > b[3] + maxD) continue;
      if (p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3] && pip(p, pc.xy)) { inside = true; sIn = D.s[i]; break; }
      for (let k = 1; k < pc.xy.length; k++) { const d = segDist(p, pc.xy[k - 1], pc.xy[k]); if (d < best) { best = d; sBest = D.s[i]; } }
    }
    const h = inside ? { site: pc.site, inside: true, s: sIn, d: 0 } : best <= maxD ? { site: pc.site, inside: false, s: sBest, d: best } : null;
    if (!h) continue; const prev = res.get(pc.site.base);
    if (!prev || (h.inside && !prev.inside) || (h.inside === prev.inside && (h.inside ? h.s < prev.s : h.d < prev.d))) res.set(pc.site.base, h);
  }
  return [...res.values()].sort((a, b) => a.s - b.s);
}

// ---------------------------------------------------------------- routing
const RT = { router: null, live: false, engine: 'sin ruteador', status: null };
async function initRouter() {
  try { RT.status = await (await fetch('/labs/shared/status/router.json', { cache: 'no-cache' })).json(); } catch { RT.status = null; }
  try { const mod = await import('/labs/shared/router/router.js'); RT.router = await mod.loadRouter(); RT.engine = RT.router.engine || 'router'; } catch (e) { console.warn('router unavailable', e); }
  const stub = !RT.router || /stub/i.test(RT.engine) || RT.router.ready === false;
  const statusReady = RT.status && ['ready', 'done'].includes(RT.status.state);
  RT.live = !!RT.router && (!stub || (statusReady && !/stub/i.test(RT.engine))) && !FORCE_SNAPSHOT;
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

function joinLegs(r1, r2) {
  const a = r1.coordinates, b = r2.coordinates; let k = 0;
  // remove the out-and-back spur around the via point
  while (k < Math.min(a.length, b.length) - 2 && near(a[a.length - 2 - k], b[1 + k], 18)) k++;
  const coords = a.slice(0, a.length - k).concat(b.slice(1 + k));
  const steps = (r1.steps || []).filter(s => !/^arrive/i.test(s.instruction)).concat((r2.steps || []).filter(s => !/^depart/i.test(s.instruction)));
  return { coordinates: coords, distance_m: r1.distance_m + r2.distance_m, duration_s: r1.duration_s + r2.duration_s, steps, avoided: [], engine: (r1.engine || 'router') + '+desvío' };
}
function routeScore(route, hz) { const hits = siteHits(new Path(route.coordinates), hz, 0).filter(h => h.inside); return hits.reduce((a, h) => a + SEV[h.site.kind] * 600, 0) + route.duration_s; }

async function heuristicSafe(A, B, normal, hz, onProgress) {
  const np = new Path(normal.coordinates); const crossed = siteHits(np, hz, 0).filter(h => h.inside);
  if (!crossed.length) return normal;
  let best = normal, bestScore = routeScore(normal, hz);
  const targets = [...new Set([crossed.slice().sort((a, b) => SEV[b.site.kind] - SEV[a.site.kind] || a.s - b.s)[0], crossed[0]])];
  const cands = [];
  for (const h of targets) { const p = np.xyAt(h.s), b = np.bearing(h.s, 60, 60) * D2R; const nx = Math.cos(b), ny = -Math.sin(b); for (const d of [650, -650, 1300, -1300]) cands.push(fll([p[0] + nx * d, p[1] + ny * d])); }
  let i = 0;
  for (const V of cands.slice(0, 8)) {
    onProgress?.(++i, Math.min(8, cands.length));
    try { const r = joinLegs(await RT.router.route(A, V, { avoid: null }), await RT.router.route(V, B, { avoid: null })); const sc = routeScore(r, hz); if (sc < bestScore) { best = r; bestScore = sc; } } catch (e) { console.warn('via failed', e); }
  }
  return best;
}

let SNAP = null;
async function computeTrip(A, B, labels, scenarioId, onProgress) {
  const hz = scenarioId !== 'seco' ? HZ[scenarioId] : null;
  const hzRoutable = hz && hz.pieces?.length;
  const isSnapPair = SNAP && near(A, SNAP.from.lonlat) && near(B, SNAP.to.lonlat);
  let normal = null, safe = null, note = '', extra = null;
  if (RT.live) {
    try {
      if (hzRoutable) {
        const support = HZ_INDEX.filter(l => l.kind === 'water' || l.kind === 'hotspot').map(l => l.id);
        const c = await withTimeout(RT.router.route(A, B, { hazardIds: [scenarioId, ...support], penalties: { observed: 'block' }, compare: true }), 30000);
        normal = c.normal || c; safe = c.safe || c; extra = c;
        note = `Ruteo: ${c.engine || RT.engine}. Ruta cauce = modo seguro: registros IMEPLAN bloqueados, pasos a desnivel y cuerpos de agua (OSM) penalizados${safe.blocked_fallback ? ' (sin salida limpia: cruza lo mínimo)' : ''}.`;
      } else { normal = await withTimeout(RT.router.route(A, B), 20000); note = `Ruteo: ${normal.engine || RT.engine} (ruta más rápida).`; }
    } catch (e) { console.warn('live router failed, falling back', e); normal = safe = null; }
  }
  if (!normal) {
    if (isSnapPair) { normal = SNAP.normal; note = `Ruteo: instantánea guardada de ${SNAP.engine || 'el ruteador'} (${(SNAP.generated || '').slice(0, 10)}).`; }
    else { normal = await RT.router.route(A, B, { avoid: null }); note = `Ruteo: ${normal.engine} (sin evasión).`; }
  }
  if (hzRoutable && !safe) {
    if (isSnapPair && hz.layer.kind === 'observed') { safe = SNAP.safe; note += ' Ruta cauce = modo seguro: registros IMEPLAN bloqueados, pasos a desnivel y agua (OSM) penalizados.'; }
    else { safe = await heuristicSafe(A, B, normal, hz, onProgress); note += ' Ruta cauce: desvío del prototipo con puntos de paso que esquivan los polígonos (ruteador sin evasión disponible).'; }
  }
  if (!safe) safe = normal;
  const trip = { A, B, labels, scenarioId, hz, note, normal: { r: normal, p: new Path(normal.coordinates) }, safe: { r: safe, p: new Path(safe.coordinates) } };
  trip.hitsN = siteHits(trip.normal.p, hz); trip.hitsS = siteHits(trip.safe.p, hz);
  trip.crossN = trip.hitsN.filter(h => h.inside); trip.crossS = trip.hitsS.filter(h => h.inside);
  trip.avoided = trip.crossN.filter(h => !trip.crossS.some(x => x.site === h.site));
  trip.rerouted = !!hz && safe !== normal && trip.avoided.length > 0;
  // where the safe route leaves the normal one
  let sD = 0; if (trip.rerouted) { const a = trip.normal.p, b = trip.safe.p; for (let s = 0; s <= b.L; s += 15) { const pa = a.xyAt(s), pb = b.xyAt(s); if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) > 25) { sD = Math.max(0, s - 15); break; } } }
  trip.sD = sD;
  trip.stepsN = mapSteps(normal, trip.normal.p); trip.stepsS = mapSteps(safe, trip.safe.p);
  // mapped underpasses the router also steered around (OSM hotspots; not observed records)
  const hsAv = new Set((safe.avoided || []).filter(a => a.kind === 'hotspot').map(a => a.label || a.id));
  const hsCr = new Set((safe.crossed || []).filter(a => a.kind === 'hotspot').map(a => a.label || a.id));
  trip.hotspots = { avoided: hsAv.size, crossed: hsCr.size };
  return trip;
}

const TYPE_ES = { 'turn': 'Gira', 'new name': 'Sigue por', 'continue': 'Continúa', 'merge': 'Incorpórate', 'on ramp': 'Toma la rampa', 'off ramp': 'Toma la salida', 'fork': 'En la bifurcación,', 'end of road': 'Al final de la calle, gira', 'roundabout': 'En la glorieta, sal', 'rotary': 'En la glorieta, sal', 'exit roundabout': 'Sal de la glorieta', 'exit rotary': 'Sal de la glorieta', 'arrive': 'Llegas a tu destino', 'depart': 'Arranca por', 'notification': 'Sigue', 'use lane': 'Usa el carril' };
const MOD_ES = { 'left': 'a la izquierda', 'right': 'a la derecha', 'slight left': 'ligeramente a la izquierda', 'slight right': 'ligeramente a la derecha', 'sharp left': 'cerrado a la izquierda', 'sharp right': 'cerrado a la derecha', 'straight': 'derecho', 'uturn': 'en U' };
function parseInstr(txt) {
  const m = /^(new name|on ramp|off ramp|end of road|exit roundabout|exit rotary|use lane|turn|continue|merge|fork|roundabout|rotary|arrive|depart|notification)\s*(sharp left|sharp right|slight left|slight right|left|right|straight|uturn)?\s*(.*)$/i.exec(txt || '');
  if (!m) return { type: 'other', mod: '', what: txt || '', street: '' };
  const type = m[1].toLowerCase(), mod = (m[2] || '').toLowerCase(), street = (m[3] || '').trim();
  let what = TYPE_ES[type] || 'Sigue';
  if (type === 'fork') what += ' mantente ' + (MOD_ES[mod] || 'derecho');
  else if (mod && !['new name', 'arrive', 'depart', 'exit roundabout', 'exit rotary'].includes(type)) what += ' ' + (MOD_ES[mod] || '');
  return { type, mod, what, street };
}
function stepInfo(st) {
  if (!st.type) return parseInstr(st.instruction);
  const type = String(st.type).toLowerCase(), mod = String(st.modifier || '').toLowerCase();
  if (type === 'arrive') return { type, mod, what: 'Llegas a tu destino', street: '' };
  let what = st.instruction || '', street = '';
  if (type !== 'uturn') { let m = /^(.*)\s(?:hacia|en|por)\s(.+)$/.exec(what); if (!m) m = /^(Incorpórate|Sigue|Continúa)\s+a\s+(.+)$/.exec(what); if (m) { what = m[1]; street = m[2]; } }
  if (!street && st.name) street = st.name;
  return { type, mod, what, street };
}
function mapSteps(route, path) {
  const out = []; let s0 = 0;
  for (const st of route.steps || []) {
    if (!st.location) continue; const pr = path.project(st.location, s0, s0 + 4000 + (st.distance_m || 0) * 3);
    const P = stepInfo(st); if (P.type === 'depart') { s0 = pr.s; continue; }
    if (P.type !== 'arrive' && (st.distance_m ?? 99) < 12 && !P.street) continue;
    out.push({ s: pr.s, ...P }); s0 = pr.s;
  }
  if (!out.length || out[out.length - 1].type !== 'arrive') out.push({ s: path.L, type: 'arrive', mod: '', what: 'Llegas a tu destino', street: '' });
  return out;
}

// ---------------------------------------------------------------- hand-drawn icons
function arrowSVG(type, mod) {
  const wrap = d => `<svg viewBox="0 0 64 64" fill="none" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(2.5 2.5)" stroke="${INK.pink}" stroke-width="7">${d}</g><g stroke="${INK.sheet}" stroke-width="6">${d}</g></svg>`;
  if (type === 'arrive') return wrap('<path d="M20 58V8M20 9c10-4 18 6 30 0v22c-12 6-20-4-30 0"/>');
  if (/roundabout|rotary/.test(type)) return wrap('<path d="M32 60V44"/><path d="M27 42.5A11 11 0 1 1 37 42.5" stroke-dasharray="5 5"/><path d="M32 19V5M25 12l7-7 7 7"/>');
  if (mod === 'uturn') return wrap('<path d="M40 58V26c0-16-22-16-22 0v12M10 31l8 9 8-9"/>');
  const rot = { 'left': -90, 'slight left': -45, 'sharp left': -135, 'right': 90, 'slight right': 45, 'sharp right': 135 }[mod] ?? 0;
  const r = rot * D2R, ex = 32 + 22 * Math.sin(r), ey = 30 - 22 * Math.cos(r), hx = Math.sin(r), hy = -Math.cos(r);
  const L = 10, a1 = [ex - L * (hx * Math.cos(.6) - hy * Math.sin(.6)), ey - L * (hy * Math.cos(.6) + hx * Math.sin(.6))], a2 = [ex - L * (hx * Math.cos(-.6) - hy * Math.sin(-.6)), ey - L * (hy * Math.cos(-.6) + hx * Math.sin(-.6))];
  return wrap(`<path d="M32 60V36Q32 30 ${(32 + ex) / 2 + hx * 2} ${(30 + ey) / 2} T${ex.toFixed(1)} ${ey.toFixed(1)}"/><path d="M${a1[0].toFixed(1)} ${a1[1].toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}L${a2[0].toFixed(1)} ${a2[1].toFixed(1)}"/>`);
}
function hazardIcon(kind) {
  const water = `<path d="M6 44c6-5 10 5 16 0s10 5 16 0 10 5 16 0" stroke="${INK.blue}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M6 54c6-5 10 5 16 0s10 5 16 0 10 5 16 0" stroke="${INK.blueDeep}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  if (kind === 'desnivel') return `<svg viewBox="0 0 64 64"><path d="M4 18h18l10 16h0l10-16h18" stroke="${INK.black}" stroke-width="5" fill="none" stroke-linejoin="round"/><path d="M10 34h44v24H10z" fill="${INK.blue}"/><path d="M12 42c5-4 9 4 14 0s9 4 14 0 9 4 12 0" stroke="#fff" stroke-width="3" fill="none"/><text x="50" y="16" font-family="Permanent Marker" font-size="18" fill="${INK.pink}">!</text></svg>`;
  if (kind === 'reroute') return `<svg viewBox="0 0 64 64" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 58V36c0-8 6-12 12-12h22"/><path d="M40 14l10 10-10 10"/><path d="M14 22V8" stroke-dasharray="2 8"/></svg>`;
  if (kind === 'modeled') return `<svg viewBox="0 0 64 64"><path d="M8 50l12-12 10 8 12-16 14 12" stroke="${INK.teal}" stroke-width="5" fill="none" stroke-linejoin="round"/>${water}</svg>`;
  if (kind === 'critica') return `<svg viewBox="0 0 64 64"><path d="M32 4l26 44H6z" fill="${INK.pink}"/><text x="27" y="40" font-family="Permanent Marker" font-size="24" fill="#fff">!</text>${water.replace(/44/g, '50').replace(/54/g, '60')}</svg>`;
  return `<svg viewBox="0 0 64 64"><path d="M32 6C24 18 18 26 18 34a14 14 0 0 0 28 0C46 26 40 18 32 6z" fill="${INK.blue}"/><path d="M26 34a7 7 0 0 0 7 7" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>${water.replace(/M6 44[^"]*"[^/]*\/>/, '')}</svg>`;
}

// ---------------------------------------------------------------- map style
const PATTERNS = patternSet();
const ROAD_CLASSES_MAJOR = ['motorway', 'trunk', 'primary', 'secondary'];
const ROAD_CLASSES_MINOR = ['tertiary', 'minor', 'service', 'track', 'unclassified', 'residential', 'living_street'];
const zexp = (stops, base = 1.6) => ['interpolate', ['exponential', base], ['zoom'], ...stops.flat()];
const majorW = ['match', ['get', 'class'], ['motorway', 'trunk'], 1.25, 'primary', 1, .82];
const minorW = ['match', ['get', 'class'], 'tertiary', 1, ['service', 'track'], .45, .7];
// zoom curves must be the top-level expression: fold the multiplier into every stop
const zexpM = (mult, stops, base = 1.6) => ['interpolate', ['exponential', base], ['zoom'], ...stops.flatMap(([z, v]) => [z, typeof mult === 'number' ? mult * v : ['*', mult, v]])];

function buildStyle() {
  const omt = { type: 'vector', url: 'https://tiles.openfreemap.org/planet' };
  const sh = (id, src, layer, filter, translate = [2, 3], opacity = .16) => ({ id, type: 'fill', source: src, 'source-layer': layer, ...(filter ? { filter } : {}), paint: { 'fill-color': INK.black, 'fill-opacity': opacity, 'fill-translate': translate, 'fill-translate-anchor': 'viewport' } });
  const greenF = ['in', ['get', 'class'], ['literal', ['grass', 'wood', 'forest', 'park', 'garden', 'recreation_ground', 'meadow', 'scrub']]];
  return {
    version: 8,
    sources: { omt },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-pattern': 'paper' } },
      { id: 'landuse-tint', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['cemetery', 'hospital', 'school', 'university', 'college', 'stadium', 'pitch', 'industrial', 'railway']]], paint: { 'fill-color': '#E7D9BE', 'fill-opacity': .75 } },
      sh('green-shadow', 'omt', 'landcover', greenF),
      { id: 'green', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: greenF, paint: { 'fill-pattern': ['match', ['get', 'class'], ['wood', 'forest'], 'wood', 'park'] } },
      sh('park-shadow', 'omt', 'park', null),
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-pattern': 'park' } },
      { id: 'aero-area', type: 'fill', source: 'omt', 'source-layer': 'aeroway', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-pattern': 'apron', 'fill-opacity': .9 } },
      { id: 'runway', type: 'line', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'class'], ['literal', ['runway', 'taxiway']]]], paint: { 'line-color': '#4A403A', 'line-width': zexp([[11, 2], [14, 14], [17, 70]], 2) } },
      { id: 'runway-dash', type: 'line', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], paint: { 'line-color': INK.sheet, 'line-width': zexp([[12, .6], [14, 1.6], [17, 4]], 2), 'line-dasharray': [4, 4] } },
      sh('water-shadow', 'omt', 'water', null, [2, 3], .2),
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-pattern': 'water' } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': INK.teal, 'line-opacity': .8, 'line-width': zexpM(['match', ['get', 'class'], 'river', 1.6, 'canal', 1.2, .8], [[10, .6], [14, 1.6], [17, 4]]) } },
      // roads: paper strips laid on the sheet with a soft offset shadow
      { id: 'road-minor-shadow', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12.5, filter: ['in', ['get', 'class'], ['literal', ROAD_CLASSES_MINOR]], paint: { 'line-color': INK.black, 'line-opacity': .2, 'line-blur': 1.5, 'line-translate': [1.5, 2.5], 'line-translate-anchor': 'viewport', 'line-width': zexpM(minorW, [[12.5, .5], [14, 2.5], [16, 8], [18, 22]]) } },
      { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12.5, filter: ['in', ['get', 'class'], ['literal', ROAD_CLASSES_MINOR]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFBF1', 'line-opacity': zexp([[12.5, 0], [13.5, 1]]), 'line-width': zexpM(minorW, [[12.5, .5], [14, 2.5], [16, 8], [18, 22]]) } },
      { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11, filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]], paint: { 'line-color': INK.black, 'line-opacity': .55, 'line-width': zexp([[11, .6], [16, 2.2]]), 'line-dasharray': [3, 2] } },
      { id: 'road-major-shadow', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9, filter: ['in', ['get', 'class'], ['literal', ROAD_CLASSES_MAJOR]], paint: { 'line-color': INK.black, 'line-opacity': .26, 'line-blur': 2, 'line-translate': [2, 3.5], 'line-translate-anchor': 'viewport', 'line-width': zexpM(majorW, [[9, .8], [12, 3], [14, 7], [16, 17], [18, 44]]) } },
      { id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9, filter: ['in', ['get', 'class'], ['literal', ROAD_CLASSES_MAJOR]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#FFF4DD', '#FFFDF7'], 'line-width': zexpM(majorW, [[9, .8], [12, 3], [14, 7], [16, 17], [18, 44]]) } },
      { id: 'anchor-hazards', type: 'background', layout: { visibility: 'none' }, paint: {} },
      { id: 'anchor-routes', type: 'background', layout: { visibility: 'none' }, paint: {} },
      { id: 'buildings', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14.5, paint: { 'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#FFFDF7', 30, '#FFF2F8', 80, '#FFD9EC'], 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': zexp([[14.5, 0], [15.3, .92]]), 'fill-extrusion-vertical-gradient': true } },
      { id: 'anchor-labels', type: 'background', layout: { visibility: 'none' }, paint: {} },
      { id: 'street-labels', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13.6, filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']]], layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:es'], ['get', 'name']], 'text-font': ['Patrick Hand'], 'text-size': zexp([[13.6, 12], [16, 16], [18, 20]]), 'text-max-angle': 28, 'text-padding': 6, 'symbol-spacing': 320 }, paint: { 'text-color': INK.black, 'text-halo-color': 'rgba(255,252,244,0.95)', 'text-halo-width': 2.4, 'text-halo-blur': .4 } },
      { id: 'place-labels', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 10, filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb', 'neighbourhood', 'quarter', 'village']]], layout: { 'text-field': ['coalesce', ['get', 'name:es'], ['get', 'name']], 'text-font': ['Permanent Marker'], 'text-size': ['match', ['get', 'class'], ['city', 'town'], 20, ['suburb'], 15, 13], 'text-transform': 'uppercase', 'text-letter-spacing': .06, 'text-max-width': 9, 'text-padding': 10 }, paint: { 'text-color': INK.teal, 'text-opacity': .78, 'text-halo-color': 'rgba(241,231,210,0.9)', 'text-halo-width': 2 } },
    ],
  };
}

// ---------------------------------------------------------------- state
const HZ = {}; let HZ_INDEX = [];
let map, car, trip = null, TL = null, scenario = 'seco';
let playing = false, playT0 = 0, playOffset = 0, curT = 0, idle = !DEMO, picking = 0, hzSwitchAt = -1e9;
const markers = { pins: [], hz: [] };
const isPhone = () => innerWidth <= 640;

function padding() {
  const W = innerWidth, H = innerHeight;
  if (isPhone()) { const sheet = DEMO ? 40 : 190; return { top: Math.round(H * .5), bottom: sheet, left: 0, right: 0 }; }
  const left = DEMO ? 0 : 380; return { top: Math.round(H * .4), bottom: 0, left, right: 0 };
}
function overviewPadding(end) {
  if (isPhone()) return end && DEMO ? { top: 500, bottom: 130, left: 40, right: 40 } : { top: DEMO ? 320 : 250, bottom: DEMO ? 250 : 330, left: 40, right: 40 };
  if (DEMO) return end ? { top: 130, bottom: 130, left: 420, right: 470 } : { top: 230, bottom: 175, left: 420, right: 200 };
  return { top: 120, bottom: 130, left: 440, right: 160 };
}
function overviewCam(lists, bearing, pitch, pad) {
  const b = bearing * D2R, cb = Math.cos(b), sb = Math.sin(b); let mu = 1e18, Mu = -1e18, mv = 1e18, Mv = -1e18;
  for (const L of lists) for (const p of L) { const [x, y] = fxy(p); const u = x * cb - y * sb, v = x * sb + y * cb; mu = Math.min(mu, u); Mu = Math.max(Mu, u); mv = Math.min(mv, v); Mv = Math.max(Mv, v); }
  const W = Math.max(120, innerWidth - pad.left - pad.right), H = Math.max(120, innerHeight - pad.top - pad.bottom);
  const m = Math.max((Mu - mu) / W, (Mv - mv) * Math.cos(pitch * D2R) * 1.1 / H) * .82;
  const cu = (mu + Mu) / 2, cv = (mv + Mv) / 2 - (Mv - mv) * .04;
  return { center: fll([cu * cb + cv * sb, -cu * sb + cv * cb]), zoom: clamp(zoomForMpp(m), 9, 16), bearing, pitch, padding: pad };
}
function fitCam(lists, bearing, pitch, pad) {
  let cam = overviewCam(lists, bearing, pitch, pad);
  if (!map) return cam;
  const saved = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), padding: map.getPadding() };
  const pts = []; for (const L of lists) { const st = Math.max(1, Math.floor(L.length / 150)); for (let i = 0; i < L.length; i += st) pts.push(L[i]); pts.push(L[L.length - 1]); }
  const aw = innerWidth - pad.left - pad.right, ah = innerHeight - pad.top - pad.bottom;
  for (let it = 0; it < 5; it++) {
    map.jumpTo(cam); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of pts) { const q = map.project(p); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    const sc = Math.min(aw / Math.max(1, x1 - x0), ah / Math.max(1, y1 - y0));
    const c = map.unproject([(x0 + x1) / 2, (y0 + y1) / 2]);
    cam = { ...cam, center: [c.lng, c.lat], zoom: clamp(cam.zoom + Math.log2(sc) * .85, 8, 16.5) };
  }
  map.jumpTo(saved);
  return cam;
}
function lerpCam(a, b, u) {
  const P = k => lerp(a.padding?.[k] ?? 0, b.padding?.[k] ?? 0, u);
  return { center: [lerp(a.center[0], b.center[0], u), lerp(a.center[1], b.center[1], u)], zoom: lerp(a.zoom, b.zoom, u), bearing: a.bearing + angDiff(a.bearing, b.bearing) * u, pitch: lerp(a.pitch, b.pitch, u), padding: { top: P('top'), bottom: P('bottom'), left: P('left'), right: P('right') } };
}

// ---------------------------------------------------------------- timeline (pure function of t)
function buildTimeline(tr) {
  const T0 = 5.0, T1 = 23.2, D = DUR;
  const path = tr.safe.p, L = path.L;
  const zones = [{ sa: 0, sb: Math.min(380, L * .1), dur: 1.9, kind: 'start' }];
  let reroute = null, post = null;
  if (tr.rerouted) {
    const sD = tr.sD, sA = Math.max(0, sD - 820), sR = Math.max(sA + 120, sD - 330);
    zones.push({ sa: sA, sb: Math.min(L - 500, sD + 240), dur: 3.9, kind: 'reroute' }); reroute = { sA, sR, sD };
  }
  const after = (tr.sD || 0) + 350;
  const cand = tr.hitsS.filter(h => h.s > after && h.s < L - 250);
  post = cand.filter(h => h.inside).sort((a, b) => SEV[b.site.kind] - SEV[a.site.kind] || a.s - b.s)[0] || cand.filter(h => h.d < 35).sort((a, b) => a.d - b.d)[0] || null;
  if (post) zones.push({ sa: post.s - 430, sb: post.s + 170, dur: 2.9, kind: 'post' });
  zones.push({ sa: Math.max(0, L - 320), sb: L, dur: 1.7, kind: 'arrive' });
  zones.sort((a, b) => a.sa - b.sa);
  const Z = []; for (const z of zones) { const last = Z[Z.length - 1]; if (last && z.sa <= last.sb + 150) { last.sb = Math.max(last.sb, z.sb); last.dur += z.dur * .7; last.kind += '+' + z.kind; } else Z.push({ ...z }); }
  const fast = []; for (let i = 0; i < Z.length - 1; i++) fast.push(Math.max(0, Z[i + 1].sa - Z[i].sb));
  const zoneT = Z.reduce((a, z) => a + z.dur, 0); let budget = T1 - T0 - zoneT; const scaleZ = budget < fast.length * 1.1 ? (T1 - T0 - fast.length * 1.1) / zoneT : 1; if (scaleZ !== 1) { Z.forEach(z => z.dur *= scaleZ); budget = fast.length * 1.1; }
  const wts = fast.map(f => Math.pow(Math.max(f, 1) / 1000, .55)); const wsum = wts.reduce((a, b) => a + b, 0) || 1;
  const ft = wts.map(w => Math.max(.9, budget * w / wsum)); const fsum = ft.reduce((a, b) => a + b, 0); const fk = fsum ? budget / fsum : 1;
  const xs = [], ys = []; let t = T0;
  Z.forEach((z, i) => { xs.push(t); ys.push(z.sa); t += z.dur; xs.push(t); ys.push(z.sb); if (i < ft.length) t += ft[i] * fk; });
  xs[xs.length - 1] = T1;
  const sAt0 = monotone(xs, ys);
  const sAt = tt => tt <= T0 ? 0 : tt >= T1 ? L : sAt0(tt);
  // tables at 120 Hz: speed -> zoom (smoothed), camera heading (smoothed)
  const HZ_ = 120, N = Math.ceil((T1 - T0) * HZ_) + 1, ts = [], ss = [], zr = [], hd = [];
  for (let i = 0; i < N; i++) { const tt = T0 + i / HZ_; ts.push(tt); ss.push(sAt(tt)); }
  for (let i = 0; i < N; i++) { const a = ss[Math.max(0, i - 15)], b = ss[Math.min(N - 1, i + 15)], dt = (Math.min(N - 1, i + 15) - Math.max(0, i - 15)) / HZ_; const v = (b - a) / dt; zr.push(clamp(16.25 - .95 * Math.log2(Math.max(v, 170) / 170), 12.7, 16.25)); }
  const gsm = (arr, sig) => { const R = Math.ceil(sig * 2.5 * HZ_), out = []; for (let i = 0; i < arr.length; i++) { let a = 0, w = 0; for (let k = -R; k <= R; k += 3) { const j = clamp(i + k, 0, arr.length - 1), ww = Math.exp(-((k / HZ_) ** 2) / (2 * sig * sig)); a += arr[j] * ww; w += ww; } out.push(a / w); } return out; };
  const zs = gsm(zr, .55);
  let prev = null; for (let i = 0; i < N; i++) { const m = mpp(zs[i]); let b = path.bearing(ss[i], 22 * m, 120 * m); if (prev !== null) b = prev + angDiff(prev, b); hd.push(b); prev = b; }
  const hs = gsm(hd, .32);
  const tab = (arr, tt) => { const f = clamp((tt - T0) * HZ_, 0, N - 1), i = Math.floor(f), j = Math.min(N - 1, i + 1); return lerp(arr[i], arr[j], f - i); };
  const tAtS = sv => { if (sv <= 0) return T0; if (sv >= L) return T1; let lo = 0, hi = N - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ss[m] < sv) lo = m; else hi = m; } return ts[hi]; };
  const tR = reroute ? tAtS(reroute.sR) : Infinity;
  const follow = tt => {
    tt = clamp(tt, T0, T1); const s = sAt(tt), bump = reroute ? Math.exp(-((tt - (tR + 1.0)) ** 2) / (2 * .85 * .85)) : 0;
    const pb = post ? Math.exp(-((tt - tAtS(post.s)) ** 2) / (2 * .7 * .7)) : 0;
    return { center: path.at(s), zoom: tab(zs, tt) - .85 * bump - .25 * pb, bearing: tab(hs, tt), pitch: 61 - 7 * bump, padding: padding() };
  };
  const brAB = Math.atan2((tr.B[0] - tr.A[0]) * KX, (tr.B[1] - tr.A[1]) * KY) / D2R;
  const camStart = fitCam([tr.normal.r.coordinates, tr.safe.r.coordinates], brAB - 12, 42, overviewPadding(false));
  const camEnd = fitCam([tr.normal.r.coordinates, tr.safe.r.coordinates], brAB + 8, 36, overviewPadding(true));
  // alerts (time windows; content may depend on s)
  const alerts = [];
  if (reroute) {
    const ahead = tr.avoided.slice().sort((a, b) => SEV[b.site.kind] - SEV[a.site.kind] || a.s - b.s).slice(0, 2).sort((a, b) => a.s - b.s);
    const ta = tAtS(reroute.sA);
    ahead.forEach((h, i) => alerts.push({ id: 'pre' + i, kind: h.site.kind, hit: h, path: 'normal', t0: ta + i * .35, t1: tR + .25, sev: SEV[h.site.kind] }));
    alerts.push({ id: 'reroute', kind: 'reroute', t0: tR, t1: Math.max(tAtS(reroute.sD + 240), tR + 2.6) });
  }
  if (post) { const tp = tAtS(post.s - 430); alerts.push({ id: 'post', kind: post.site.kind, hit: post, path: 'safe', t0: tp, t1: Math.max(tAtS(post.s + 170), tp + 2.6) + .2 }); }
  return { T0, T1, D, L, path, sAt, tAtS, follow, camStart, camEnd, reroute, tR, post, alerts, zones: Z };
}

// ---------------------------------------------------------------- map layers that depend on trip/hazards
function gradient(p, q, done, todo, hidden) {
  const e = 1e-4, raw = [[0, done], [p, done], [p + e, todo], [q, todo], [q + e, hidden], [1, hidden]], st = [];
  let last = -1; for (let [x, c] of raw) { x = clamp(x, 0, 1); if (x <= last) { x = last + e; if (x > 1) continue; } st.push(x, c); last = x; }
  return ['interpolate', ['linear'], ['line-progress'], ...st];
}
const ROUTE_COLORS = {
  shadow: ['rgba(43,36,32,0.30)', 'rgba(43,36,32,0.38)', 'rgba(43,36,32,0)'],
  edge: ['rgba(255,252,244,0.75)', 'rgba(255,252,244,1)', 'rgba(255,252,244,0)'],
  core: ['rgba(255,72,176,0.38)', 'rgba(255,72,176,1)', 'rgba(255,72,176,0)'],
  misreg: ['rgba(0,131,138,0.14)', 'rgba(0,131,138,0.62)', 'rgba(0,131,138,0)'],
};
function addRouteLayers() {
  const empty = { type: 'FeatureCollection', features: [] };
  for (const id of ['r-normal', 'r-safe']) map.addSource(id, { type: 'geojson', data: empty, lineMetrics: true });
  map.addSource('r-normal-ahead', { type: 'geojson', data: empty });
  const W = (m) => zexpM(m, [[9, 2.6], [12, 4.5], [14, 8], [16, 15], [18, 30]]);
  map.addLayer({ id: 'rn-pencil', type: 'line', source: 'r-normal', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': INK.black, 'line-opacity': 0, 'line-width': zexp([[10, 2.4], [14, 3], [17, 4.2]]), 'line-dasharray': [2.2, 1.6] } }, 'anchor-routes');
  map.addLayer({ id: 'rna-pencil', type: 'line', source: 'r-normal-ahead', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': INK.black, 'line-opacity': 0, 'line-width': zexp([[10, 1.6], [14, 2.8], [17, 4.5]]), 'line-dasharray': [2.2, 1.6] } }, 'anchor-routes');
  for (const id of ['r-normal', 'r-safe']) {
    map.addLayer({ id: id + '-shadow', type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': W(1.25), 'line-blur': 3, 'line-translate': [3, 4.5], 'line-translate-anchor': 'viewport', 'line-gradient': gradient(0, 1, ...ROUTE_COLORS.shadow) } }, 'anchor-routes');
    map.addLayer({ id: id + '-edge', type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': W(1.42), 'line-gradient': gradient(0, 1, ...ROUTE_COLORS.edge) } }, 'anchor-routes');
    map.addLayer({ id: id + '-misreg', type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': W(1), 'line-translate': [-2.6, -1.6], 'line-translate-anchor': 'viewport', 'line-gradient': gradient(0, 1, ...ROUTE_COLORS.misreg) } }, 'anchor-routes');
    map.addLayer({ id: id + '-core', type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': W(1), 'line-gradient': gradient(0, 1, ...ROUTE_COLORS.core) } }, 'anchor-routes');
    map.addLayer({ id: id + '-stitch', type: 'line', source: id, paint: { 'line-color': '#FFFFFF', 'line-opacity': 0, 'line-width': zexp([[10, .7], [14, 1.3], [17, 2.2]]), 'line-dasharray': [1.4, 2] } }, 'anchor-routes');
  }
}
function setTripSources() {
  const f = c => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } });
  map.getSource('r-normal').setData(f(trip.normal.r.coordinates));
  map.getSource('r-safe').setData(f(trip.safe.r.coordinates));
  map.getSource('r-normal-ahead').setData(trip.rerouted ? f(trip.normal.p.slice(trip.sD, trip.normal.p.L)) : { type: 'FeatureCollection', features: [] });
  const names = [...new Set([...trip.hitsN, ...trip.hitsS].map(h => h.site.base))];
  for (const id of Object.keys(HZ)) if (map.getLayer('hzl-' + id)) map.setFilter('hzl-' + id, ['in', ['get', 'base'], ['literal', names]]);
}

function addHazardLayers(set) {
  const id = set.layer.id, modeled = set.layer.kind !== 'observed';
  if (set.support) {
    if (!set.hotspot) return;
    map.addSource('hzhs-' + id, { type: 'geojson', data: set.hotspot });
    const lf = ['==', ['geometry-type'], 'LineString'];
    map.addLayer({ id: 'hzhc-' + id, type: 'line', source: 'hzhs-' + id, minzoom: 11.5, filter: lf, layout: { 'line-cap': 'round' }, paint: { 'line-color': INK.sheet, 'line-opacity': 0, 'line-width': zexp([[12, 3], [15, 9], [17, 16]]) } }, 'anchor-hazards');
    map.addLayer({ id: 'hzhl-' + id, type: 'line', source: 'hzhs-' + id, minzoom: 11.5, filter: lf, paint: { 'line-color': INK.blueDeep, 'line-opacity': 0, 'line-width': zexp([[12, 1.4], [15, 4.5], [17, 9]]), 'line-dasharray': [1.2, 0.8] } }, 'anchor-hazards');
    set.L = { s2: [], s1: [], rl: ['hzhc-' + id, 'hzhl-' + id], r: [], p: [] };
    return;
  }
  if (set.raster) {
    map.addSource('hz-' + id, { type: 'raster', tiles: [set.layer.url], tileSize: set.layer.tileSize || 256 });
    map.addLayer({ id: 'hzr-' + id, type: 'raster', source: 'hz-' + id, paint: { 'raster-opacity': 0, 'raster-saturation': -.4 } }, 'anchor-hazards');
    return;
  }
  map.addSource('hzrim-' + id, { type: 'geojson', data: set.rim });
  map.addSource('hzpc-' + id, { type: 'geojson', data: set.piece });
  map.addSource('hzlb-' + id, { type: 'geojson', data: set.labels });
  const before = 'anchor-hazards', L = set.L = { s2: [], s1: [], rl: [], r: [], p: [] };
  const add = (key, def) => { map.addLayer(def, before); L[key].push(def.id); };
  const VP = { 'fill-translate-anchor': 'viewport' };
  const kinds = modeled ? ['modeled'] : ['sitio', 'critica', 'desnivel'];
  // one soft far shadow for all pieces; the near shadow is per kind so stacked pieces cast onto each other
  add('s2', { id: 'hzs2-' + id, type: 'fill', source: 'hzrim-' + id, paint: { 'fill-color': INK.black, 'fill-opacity': 0, 'fill-translate': [7, 10], ...VP } });
  for (const kd of kinds) {
    const f = ['==', ['get', 'kind'], kd], n = id + '-' + kd;
    add('s1', { id: 'hzs1-' + n, type: 'fill', source: 'hzrim-' + id, filter: f, paint: { 'fill-color': INK.black, 'fill-opacity': 0, 'fill-translate': [2.5, 3.5], ...VP } });
    if (!modeled) {
      add('rl', { id: 'hzrl-' + n, type: 'line', source: 'hzrim-' + id, maxzoom: 14.5, filter: f, paint: { 'line-color': INK.sheet, 'line-opacity': 0, 'line-width': zexp([[10, 1.2], [13, 2], [15, 2.6], [17, 4]]), 'line-translate-anchor': 'viewport' } });
      add('r', { id: 'hzr-' + n, type: 'fill', source: 'hzrim-' + id, filter: f, paint: { 'fill-color': INK.sheet, 'fill-opacity': 0, ...VP } });
      add('p', { id: 'hzp-' + n, type: 'fill', source: 'hzpc-' + id, filter: f, paint: { 'fill-pattern': 'flood-' + kd, 'fill-opacity': 0, ...VP } });
    } else {
      add('p', { id: 'hzp-' + n, type: 'fill', source: 'hzpc-' + id, filter: f, paint: { 'fill-pattern': 'modeled', 'fill-opacity': 0, ...VP } });
      add('rl', { id: 'hzrl-' + n, type: 'line', source: 'hzpc-' + id, filter: f, paint: { 'line-color': INK.teal, 'line-opacity': 0, 'line-width': 1.4, 'line-dasharray': [2, 2] } });
    }
  }
  map.addLayer({ id: 'hzl-' + id, type: 'symbol', source: 'hzlb-' + id, minzoom: 13.8, filter: ['in', ['get', 'base'], ['literal', []]], layout: { 'text-field': ['format', ['get', 'label'], {}, '\n', {}, ['get', 'range'], { 'font-scale': .85 }], 'text-font': ['Patrick Hand'], 'text-size': zexp([[14, 13], [17, 17]]), 'text-anchor': 'left', 'text-offset': [1.2, 0], 'text-max-width': 12, 'text-padding': 4 }, paint: { 'text-color': modeled ? INK.teal : INK.blueDeep, 'text-halo-color': 'rgba(255,252,244,0.95)', 'text-halo-width': 2.2, 'text-opacity': 0 } }, 'anchor-labels');
}

// ---------------------------------------------------------------- per-frame appliers
const paintCache = new Map();
function setPaint(layer, prop, val) { if (PERF.has('nograd') && prop === 'line-gradient') return; const k = layer + '|' + prop, s = typeof val === 'object' ? JSON.stringify(val) : val; if (paintCache.get(k) === s) return; paintCache.set(k, s); if (map.getLayer(layer)) map.setPaintProperty(layer, prop, val); }

function hazardK(t) {
  if (scenario === 'seco' && !DEMO) return 0;
  if (DEMO) return trip.hz ? easeOutBack(clamp((t - 2.0) / 1.0, 0, 1)) : 0;
  return easeOutBack(clamp((performance.now() - hzSwitchAt) / 1000, 0, 1));
}
function applyHazards(k) {
  const lift = 1 - clamp(k, 0, 1);
  for (const [id, set] of Object.entries(HZ)) {
    const on = (set.support ? !!trip?.hz : trip?.scenarioId === id) ? clamp(k, 0, 1.2) : 0, o = clamp(on, 0, 1) * (set.support ? .8 : 1);
    if (set.raster) { setPaint('hzr-' + id, 'raster-opacity', .6 * o); continue; }
    const ty = -16 * (1 - Math.min(1, on)) * (on > 0 ? 1 : 0), L = set.L; if (!L) continue;
    for (const l of L.s2) { setPaint(l, 'fill-opacity', .10 * o); setPaint(l, 'fill-translate', [7 + 10 * lift, 10 + 14 * lift]); }
    for (const l of L.s1) { setPaint(l, 'fill-opacity', .28 * o * (1 - .5 * lift)); setPaint(l, 'fill-translate', [2.5 + 6 * lift, 3.5 + 8 * lift + ty]); }
    for (const l of [...L.r, ...L.p]) { setPaint(l, 'fill-opacity', o); setPaint(l, 'fill-translate', [0, ty]); }
    for (const l of L.rl) { setPaint(l, 'line-opacity', o); setPaint(l, 'line-translate', [0, ty]); }
    if (!set.support) setPaint('hzl-' + id, 'text-opacity', o);
  }
}

function applyRoutes(t, s) {
  const tl = TL, rr = tl.reroute, L = tl.L;
  const outro = clamp((t - tl.T1) / 1.2, 0, 1), inIntro = t < tl.T0;
  const pS = s / L;
  const unfold = rr ? clamp((t - (tl.tR + .2)) / 1.0, 0, 1) : 1;
  const usingNormal = rr && t < tl.tR + .2;
  // normal route active (before reroute) — or the only route when nothing is avoided
  if (!rr) {
    const p = (1 - outro) * pS;
    for (const k of ['shadow', 'edge', 'misreg', 'core']) setPaint('r-safe-' + k, 'line-gradient', gradient(p, 1, ...ROUTE_COLORS[k]));
    for (const k of ['shadow', 'edge', 'misreg', 'core']) setPaint('r-normal-' + k, 'line-gradient', gradient(0, 0, ...ROUTE_COLORS[k]));
    setPaint('r-safe-stitch', 'line-opacity', .9); setPaint('r-normal-stitch', 'line-opacity', 0);
    setPaint('rn-pencil', 'line-opacity', 0); setPaint('rna-pencil', 'line-opacity', 0);
    return;
  }
  const sN = trip.normal.p.L;
  const fadeN = clamp((t - tl.tR) / .5, 0, 1);
  const qN = usingNormal ? 1 : lerp(1, s / sN, fadeN);
  for (const k of ['shadow', 'edge', 'misreg', 'core']) { const C = ROUTE_COLORS[k]; setPaint('r-normal-' + k, 'line-gradient', usingNormal ? gradient(s / sN, 1, ...C) : gradient(Math.min(s / sN, qN), qN, C[2], C[1], C[2])); }
  setPaint('r-normal-stitch', 'line-opacity', usingNormal ? .9 : 0);
  // safe route unfolds from the divergence point, then becomes the active route
  const qS = usingNormal ? 0 : lerp(rr.sD / L, 1, easeOut(unfold));
  const pSafe = (1 - outro) * pS;
  for (const k of ['shadow', 'edge', 'misreg', 'core']) setPaint('r-safe-' + k, 'line-gradient', gradient(Math.min(pSafe, qS), qS, ...ROUTE_COLORS[k]));
  setPaint('r-safe-stitch', 'line-opacity', unfold >= 1 ? .9 : 0);
  setPaint('rna-pencil', 'line-opacity', usingNormal ? 0 : .85 * clamp((t - tl.tR - .1) / .4, 0, 1) * (1 - outro));
  setPaint('rn-pencil', 'line-opacity', .85 * outro);
}

function makePin(letter, label, cls) {
  const el = document.createElement('div'); el.className = 'pin';
  el.innerHTML = `<div class="in"><div class="flag"><span class="dot ${cls}">${letter}</span><span>${label}</span></div><div class="stick"></div></div>`;
  return new maplibregl.Marker({ element: el, anchor: 'bottom-left', offset: [-15, 0], pitchAlignment: 'viewport', rotationAlignment: 'viewport' });
}
function rebuildMarkers() {
  for (const m of [...markers.pins, ...markers.hz.map(h => h.m)]) m.remove();
  markers.pins = [makePin('A', trip.labels.from, 'a').setLngLat(trip.A).addTo(map), makePin('B', trip.labels.to, 'b').setLngLat(trip.B).addTo(map)];
  markers.hz = [];
  const seen = new Set();
  const add = (h, path, role) => {
    if (seen.has(h.site.base)) return; seen.add(h.site.base);
    const el = document.createElement('div'); el.className = 'hzmark';
    el.innerHTML = `<div class="in" style="opacity:0"><div class="b">!</div><div class="lbl">${shortRef(h.site.ref) || h.site.base}</div></div>`;
    const m = new maplibregl.Marker({ element: el, anchor: 'bottom', pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat(path.at(h.s + 8)).addTo(map);
    markers.hz.push({ m, el, h, role, b: el.querySelector('.b'), inner: el.firstElementChild });
  };
  for (const h of trip.avoided) add(h, trip.normal.p, 'avoided');
  for (const h of trip.crossS) add(h, trip.safe.p, 'onroute');
}
function applyMarkers(t, k) {
  const tl = TL; const vis = clamp((t - (DEMO ? 2.6 : 0)) / .4, 0, 1) * clamp(k, 0, 1);
  for (const mk of markers.hz) {
    const rerouted = tl.reroute && t >= tl.tR + .2;
    let o = vis;
    if (mk.role === 'avoided' && rerouted) { if (mk.b.textContent !== '✕') { mk.b.textContent = '✕'; mk.b.classList.add('x'); } }
    else if (mk.b.textContent !== '!') { mk.b.textContent = '!'; mk.b.classList.remove('x'); }
    // during the close follow, only show markers ahead within ~3 km to keep it readable
    if (t > tl.T0 && t < tl.T1) { const sNow = tl.sAt(t); const ds = mk.h.s - sNow; o *= ds > -250 && ds < 3500 ? 1 : .0; }
    mk.inner.style.opacity = o.toFixed(3);
  }
  const pinO = t > tl.T0 + .5 && t < tl.T1 ? .0 : 1;
  markers.pins[0].getElement().firstElementChild.style.opacity = pinO; markers.pins[1].getElement().firstElementChild.style.opacity = (t > tl.T0 && t < tl.T1 - 1.2) ? 0 : 1;
}

// ---------------------------------------------------------------- UI
const ui = { last: {} };
const setText = (el, key, v) => { if (ui.last[key] !== v) { ui.last[key] = v; el.innerHTML = v; } };
function alertHTML(a, s) {
  if (a.kind === 'reroute') {
    const dKm = trip.safe.r.distance_m - trip.normal.r.distance_m, dMin = (trip.safe.r.duration_s - trip.normal.r.duration_s) / 60;
    return `<div class="sheet"><div class="ico">${hazardIcon('reroute')}</div><div><h3>Ruta recalculada</h3><div class="where">Esquivas ${trip.avoided.length} ${trip.avoided.length === 1 ? 'sitio' : 'sitios'} con registro de inundación</div><div class="meta"><span>${dKm >= 0 ? '+' : '−'}${fmtKm(Math.abs(dKm))}</span><span>${dMin >= 0 ? '+' : '−'}${Math.abs(Math.round(dMin))} min</span></div></div></div>`;
  }
  const h = a.hit, site = h.site, path = a.path === 'normal' ? trip.normal.p : trip.safe.p;
  const dist = h.s - s; const dTxt = dist > 40 ? 'a ' + fmtKm(dist) : h.inside ? 'aquí' : 'junto a ti';
  const title = KIND_LABEL[site.kind];
  const where = shortRef(site.ref) || site.base;
  const src = site.kind === 'modeled' ? 'Modelo exploratorio · no es pronóstico' : `IMEPLAN MUI 2026 · ${site.base} · registro histórico, no en vivo`;
  const extra = a.path === 'safe' && h.inside ? '<span>sin desvío razonable · despacio</span>' : a.path === 'normal' ? '<span>en tu ruta de siempre</span>' : '<span>junto a tu ruta</span>';
  return `<div class="sheet"><div class="ico">${hazardIcon(site.kind)}</div><div><h3>${title}</h3><div class="where">${where}</div><div class="meta"><span class="d">${dTxt}</span>${site.range ? `<span>${fmtRange(site.range)} registrados</span>` : ''}${extra}</div><div class="src">${src}</div></div></div>`;
}
function applyAlerts(t, s) {
  const box = $('#alerts'); const active = TL.alerts.filter(a => t >= a.t0 && t <= a.t1 + .25);
  const keep = new Set(active.map(a => a.id));
  for (const el of [...box.children]) if (!keep.has(el.dataset.id)) el.remove();
  active.forEach((a, i) => {
    let el = box.querySelector(`[data-id="${a.id}"]`);
    if (!el) { el = document.createElement('div'); el.className = 'alert ' + a.kind; el.dataset.id = a.id; const r = rng(a.id.length * 97 + i)(); el.dataset.rot = ((r - .5) * 4).toFixed(2); box.appendChild(el); }
    const html = alertHTML(a, s); if (el._html !== html) { el._html = html; el.innerHTML = html; }
    const u = clamp((t - a.t0) / .28, 0, 1), out = clamp((t - a.t1) / .25, 0, 1);
    const sc = lerp(1.35, 1, easeOutBack(u)), rot = +el.dataset.rot + (1 - u) * -9;
    el.style.opacity = (Math.min(1, u * 2) * (1 - out)).toFixed(3);
    el.style.transform = `translateY(${(-out * 18).toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
    el.style.order = a.kind === 'reroute' ? -1 : i;
  });
}
function applyManeuver(t, s) {
  const el = $('#maneuver'), tl = TL;
  const show = t >= tl.T0 - .2 && t <= tl.T1 + .2;
  el.style.opacity = show ? clamp((t - tl.T0 + .2) / .4, 0, 1) * (1 - clamp((t - tl.T1) / .3, 0, 1)) : 0; el.classList.toggle('hidden', !show);
  if (!show) return;
  const steps = tl.reroute && t < tl.tR + .2 ? trip.stepsN : trip.stepsS;
  const nx = steps.find(st => st.s > s + 6) || steps[steps.length - 1];
  const d = Math.max(0, nx.s - s);
  setText($('#m-arrow'), 'arrow', arrowSVG(nx.type, nx.mod));
  setText($('#m-dist'), 'dist', nx.type === 'arrive' && d < 60 ? '¡Llegaste!' : 'en ' + fmtKm(d < 1000 ? Math.round(d / 50) * 50 || 20 : d));
  const street = nx.street || (nx.type === 'arrive' ? trip.labels.to : '');
  setText($('#m-what'), 'what', street ? nx.what : '');
  setText($('#m-street'), 'street', street || nx.what);
}
function applyTrip(t, s) {
  const el = $('#trip'), tl = TL; const show = t >= tl.T0 - .2 && t <= tl.T1 + .4;
  el.classList.toggle('hidden', !show); if (!show) return;
  el.style.opacity = clamp((t - tl.T0 + .2) / .4, 0, 1) * (1 - clamp((t - tl.T1) / .4, 0, 1));
  const usingN = tl.reroute && t < tl.tR + .2; const r = usingN ? trip.normal : trip.safe;
  const left = Math.max(0, r.p.L - s); setText($('#t-left'), 'left', fmtKm(left));
  setText($('#t-eta'), 'eta', fmtMin(r.r.duration_s * left / r.p.L));
  const v = (tl.sAt(t + .05) - tl.sAt(t - .05)) / .1, real = r.p.L / r.r.duration_s, f = v / real;
  const nice = f < 1.5 ? 1 : f < 15 ? Math.round(f) : f < 150 ? Math.round(f / 5) * 5 : Math.round(f / 50) * 50;
  setText($('#t-lapse'), 'lapse', '×' + nice);
  setText($('#t-route'), 'route', usingN ? 'ruta de siempre' : trip.rerouted ? 'ruta cauce' : 'ruta de siempre');
  $('#t-route').classList.toggle('normal', !!usingN || !trip.rerouted);
}
function summaryHTML() {
  const N = trip.normal.r, S = trip.safe.r;
  const cnt = a => `${a.length} ${a.length === 1 ? 'sitio' : 'sitios'}`;
  if (!trip.hz) return `<h2>Llegaste.</h2><div class="row"><span>Ruta de siempre</span><b>${fmtKm(N.distance_m)} · ${fmtMin(N.duration_s)}</b></div><div class="foot">Escenario seco: sin capa de riesgo activa.</div>`;
  const nItems = isPhone() ? 3 : 5;
  const items = trip.avoided.slice(0, nItems).map(h => `<li>${shortRef(h.site.ref) || h.site.base} <small>(${KIND_LABEL[h.site.kind].toLowerCase()}${h.site.range ? ', ' + fmtRange(h.site.range) : ''})</small></li>`).join('');
  return `<h2>${trip.rerouted ? 'Llegaste por la ruta cauce' : 'Llegaste'}</h2>
  <div class="row"><span>Ruta cauce</span><b>${fmtKm(S.distance_m)} · ${fmtMin(S.duration_s)} · cruza ${cnt(trip.crossS)}</b></div>
  <div class="row"><span>Ruta de siempre</span><b>${fmtKm(N.distance_m)} · ${fmtMin(N.duration_s)} · cruza ${cnt(trip.crossN)}</b></div>
  ${items ? `<ul>${items}${trip.avoided.length > nItems ? `<li class="more">y ${trip.avoided.length - nItems} más</li>` : ''}</ul>` : '<p>No hubo nada que esquivar en este escenario.</p>'}
  ${trip.hotspots?.avoided ? `<div class="row"><span>Además evita</span><b>${trip.hotspots.avoided} ${trip.hotspots.avoided === 1 ? 'paso a desnivel mapeado' : 'pasos a desnivel mapeados'} (OSM)</b></div>` : ''}
  <div class="foot">Registros históricos ${trip.hz.layer.kind === 'observed' ? 'IMEPLAN MUI 2026' : '(modelo exploratorio)'}; no son condiciones en vivo ni pronóstico. Tiempos de ruteo sin tráfico ni lluvia.</div>`;
}
function applySummary(t, allowed = true) {
  const el = $('#summary'), tl = TL; const show = allowed && t >= tl.T1 + .9;
  el.classList.toggle('hidden', !show); if (!show) return;
  const u = clamp((t - tl.T1 - .9) / .35, 0, 1);
  el.style.opacity = u; el.style.transform = `rotate(${lerp(-6, -1, easeOutBack(u))}deg) scale(${lerp(1.2, 1, easeOutBack(u))})`;
  setText($('#summary-body'), 'summary', summaryHTML());
}
function applyBanner(t) {
  const el = $('#banner'), tl = TL; const t0 = DEMO ? 2.8 : 0.4, t1 = tl.T0 - .9;
  const show = t >= t0 && t <= t1 && trip.hz;
  el.classList.toggle('hidden', !show); if (!show) return;
  const u = clamp((t - t0) / .3, 0, 1), o = clamp((t1 - t) / .3, 0, 1);
  el.style.opacity = Math.min(u, o); el.style.transform = `translateX(-50%) rotate(${lerp(-5, .7, easeOutBack(u))}deg)`;
  const n = trip.crossN.length;
  setText($('#banner-text'), 'banner', n ? `Tu ruta de siempre cruza <b>${n} ${n === 1 ? 'sitio' : 'sitios'}</b> con registro de inundación` : 'Tu ruta no cruza sitios con registro de inundación');
}
function applyScenarioUI(t) {
  // in demo the toggle is "pressed" on screen at 2.0 s
  let active = scenario;
  if (DEMO) active = t < 2.0 ? 'seco' : trip.scenarioId;
  for (const b of document.querySelectorAll('#scenario-buttons button')) {
    const on = b.dataset.id === active; if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', on);
    const tap = b.querySelector('.tap'); if (tap) { const u = DEMO && on ? clamp((t - 2.0) / .5, 0, 1) : 1; tap.style.opacity = (u > 0 && u < 1 ? 1 - u : 0).toFixed(2); tap.style.transform = `scale(${lerp(.8, 1.3, u)})`; }
  }
  const rainOn = DEMO ? easeOut(clamp((t - 2.0) / .8, 0, 1)) * (trip.hz ? 1 : 0) : (trip?.hz ? 1 : 0);
  const rain = $('#rain'); const ro = (rainOn * .75).toFixed(2); if (rain.style.opacity !== ro) rain.style.opacity = ro;
  // compositor-only animation: translate an oversized tiled layer, wrapping every 256 px
  rain.style.transform = `translate3d(${(-(t * 60) % 256).toFixed(1)}px,${((t * 620) % 256).toFixed(1)}px,0)`;
}

// ---------------------------------------------------------------- render a frame at time t
function renderAt(t, { camera = true, summary = true, carAtStart = false } = {}) {
  if (!TL) return; curT = t = clamp(t, 0, TL.D);
  const tl = TL, s = tl.sAt(t), sCar = carAtStart ? 0 : s;
  if (camera) {
    let cam; const flyA = tl.T0 - 1.9;
    const start = u => ({ ...tl.camStart, bearing: tl.camStart.bearing + 5 * u, zoom: tl.camStart.zoom + .12 * u });
    if (t <= flyA) cam = start(t / flyA);
    else if (t < tl.T0) cam = lerpCam(start(1), tl.follow(tl.T0), ease((t - flyA) / 1.9));
    else if (t <= tl.T1) { cam = tl.follow(t); if (ZO) cam.zoom += ZO; }
    else cam = lerpCam(tl.follow(tl.T1), tl.camEnd, ease(clamp((t - tl.T1) / 2.0, 0, 1)));
    if (PERF.has('freeze')) cam = tl.follow(tl.T0 + 2);
    map.jumpTo(cam);
  }
  // car
  const z = map.getZoom(), st = car.state;
  st.visible = true; st.lngLat = tl.path.at(sCar); st.heading = tl.path.bearing(sCar, 9, 20, 6); st.mapBearing = map.getBearing();
  const px = isPhone() ? 64 : 84; st.scale = px * mpp(z) / 4.8 * (ZO ? Math.pow(2, ZO) * .5 : 1) * (z < 13 ? .85 : 1);
  const hopU = tl.reroute ? clamp((t - tl.tR) / .55, 0, 1) : 0; st.hop = Math.sin(Math.PI * hopU) * 1.1; st.roll = Math.sin(Math.PI * 2 * hopU) * .12;
  const k = hazardK(t);
  applyHazards(k); applyRoutes(t, s); applyMarkers(t, k);
  if (!PERF.has('nodom')) { applyAlerts(t, s); applyManeuver(t, s); applyTrip(t, s); applySummary(t, summary); applyBanner(t); applyScenarioUI(t); }
  if (!DEMO) $('#scrub').value = t.toFixed(2);
  // phone: the maneuver card takes the brand's place while driving
  if (isPhone()) { const dv = clamp((t - tl.T0 + .3) / .4, 0, 1) * (1 - clamp((t - tl.T1) / .4, 0, 1)); $('#brand').style.opacity = (1 - dv).toFixed(3); } else $('#brand').style.opacity = '';
  map.triggerRepaint();
}

// ---------------------------------------------------------------- panel (interactive)
function renderPanel() {
  const N = trip.normal.r, S = trip.safe.r, hz = trip.hz;
  $('#from-label').textContent = trip.labels.from; $('#to-label').textContent = trip.labels.to;
  $('#trip-title').innerHTML = `<span class="dot a">A</span> ${trip.labels.from} <span class="arrow">→</span> <span class="dot b">B</span> ${trip.labels.to}`;
  const sw = (pink) => pink ? `<svg class="sw" viewBox="0 0 24 24"><path d="M2 18C8 4 14 20 22 6" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M2 18C8 4 14 20 22 6" stroke="${INK.pink}" stroke-width="6" fill="none" stroke-linecap="round"/></svg>` : `<svg class="sw" viewBox="0 0 24 24"><path d="M2 18C8 4 14 20 22 6" stroke="${INK.black}" stroke-width="2.6" fill="none" stroke-dasharray="4 3" stroke-linecap="round"/></svg>`;
  const badge = n => n ? `<span class="badge">cruza ${n} ${n === 1 ? 'sitio' : 'sitios'}</span>` : `<span class="badge ok">sin cruces</span>`;
  let html = '';
  if (hz && trip.rerouted) html += `<div class="rcard safe">${sw(true)}<h3>Ruta cauce</h3><div class="stats"><b>${fmtKm(S.distance_m)}</b> · ${fmtMin(S.duration_s)}</div><div class="x">esquiva registros de inundación ${badge(trip.crossS.length)}</div></div>`;
  html += `<div class="rcard">${sw(!trip.rerouted)}<h3>Ruta de siempre</h3><div class="stats"><b>${fmtKm(N.distance_m)}</b> · ${fmtMin(N.duration_s)}</div><div class="x">la más rápida, sin mirar el agua ${hz ? badge(trip.crossN.length) : ''}</div></div>`;
  $('#compare').innerHTML = html;
  const av = trip.avoided.map(h => `<div class="avoid-item"><i class="${h.site.kind}">✕</i><div>${shortRef(h.site.ref) || h.site.base}<small>${KIND_LABEL[h.site.kind]}${h.site.range ? ' · ' + fmtRange(h.site.range) : ''} · ${h.site.base}</small></div></div>`).join('');
  const still = trip.crossS.map(h => `<div class="avoid-item"><i class="${h.site.kind}" style="background:${INK.pink}">!</i><div>${shortRef(h.site.ref) || h.site.base}<small>sigue en la ruta: sin desvío razonable · ${h.site.base}</small></div></div>`).join('');
  $('#avoided').innerHTML = (av ? `<h4>Lo que esquivas</h4>${av}` : hz ? '<h4>Nada que esquivar en este escenario</h4>' : '') + (still ? `<h4>Precaución</h4>${still}` : '');
  $('#engine').textContent = trip.note;
  if (trip.hotspots?.avoided) $('#avoided').insertAdjacentHTML('beforeend', `<div class="avoid-item"><i class="desnivel" style="background:${INK.blueDeep}">≈</i><div>${trip.hotspots.avoided} ${trip.hotspots.avoided === 1 ? 'paso a desnivel mapeado' : 'pasos a desnivel mapeados'}<small>OSM · puntos típicos de encharcamiento, no registros</small></div></div>`);
  $('#attrib-router').textContent = RT.live ? RT.engine + ' · © OpenStreetMap' : 'OSRM demo (stub)';
}
function buildScenarioButtons() {
  const box = $('#scenario-buttons'); box.innerHTML = '';
  const opts = [{ id: 'seco', label: '☀ Seco', kind: 'none' }];
  for (const l of HZ_INDEX.filter(l => isScenarioKind(l.kind))) {
    const set = HZ[l.id]; const lab = l.kind === 'observed' ? '☂ Tormenta · registros IMEPLAN' : '≈ ' + (l.shortLabel || l.label || l.id).slice(0, 30);
    opts.push({ id: l.id, label: lab, kind: l.kind === 'observed' ? 'observed' : 'modeled', disabled: !set || set.failed, title: l.notes || l.label });
  }
  for (const o of opts) {
    const b = document.createElement('button'); b.dataset.id = o.id; b.dataset.kind = o.kind; b.innerHTML = o.label + '<span class="tap"></span>'; b.setAttribute('aria-pressed', 'false'); if (o.disabled) { b.disabled = true; b.title = 'Capa no disponible'; } else if (o.title) b.title = o.title;
    b.addEventListener('click', () => { if (!DEMO) switchScenario(o.id); }); box.appendChild(b);
  }
}
function buildLegend() {
  const sw = name => { const img = PATTERNS[name]; const c = document.createElement('canvas'); c.width = 26; c.height = 14; c.getContext('2d').putImageData(img, 0, 0); return c.toDataURL(); };
  const rows = [
    `<div class="k"><i style="background:url(${sw('flood-sitio')});outline:2px solid #fff"></i>Sitio inundable · IMEPLAN (registro)</div>`,
    `<div class="k"><i style="background:url(${sw('flood-critica')});outline:2px solid #fff"></i>Zona crítica · IMEPLAN</div>`,
    `<div class="k"><i style="background:url(${sw('flood-desnivel')});outline:2px solid #fff"></i>Paso a desnivel inundable</div>`,
  ];
  if (HZ_INDEX.some(l => l.kind === 'hotspot')) rows.push(`<div class="k"><i style="border-top:4px dotted ${INK.blueDeep};height:0;margin-top:2px"></i>Paso a desnivel · OSM (mapeado)</div>`);
  if (HZ_INDEX.some(l => l.kind === 'modeled' || l.kind === 'terrain-index')) rows.push(`<div class="k"><i style="background:url(${sw('modeled')});border:1.5px dashed ${INK.teal}"></i>Agua modelada (exploratorio)</div>`);
  rows.push(`<div class="k"><i style="border-top:3px solid ${INK.teal};height:0;margin-top:2px"></i>Ríos y canales cartografiados (OSM)</div>`);
  rows.push(`<div class="k"><i style="background:${INK.pink};height:8px;outline:2px solid #fff"></i>Ruta cauce</div>`);
  rows.push(`<div class="k"><i style="border-top:3px dashed ${INK.black};height:0;margin-top:2px"></i>Ruta de siempre</div>`);
  $('#legend-body').innerHTML = rows.join('');
}

// ---------------------------------------------------------------- trip lifecycle
async function setTrip(A, B, labels, scenarioId, { animateHazards = true } = {}) {
  const status = $('#engine');
  if (!DEMO) status.textContent = 'Buscando ruta…';
  const tr = await computeTrip(A, B, labels, scenarioId, (i, n) => { status.textContent = `Buscando un camino seco… (${i}/${n})`; });
  trip = tr; TL = buildTimeline(tr);
  setTripSources(); rebuildMarkers(); renderPanel();
  if (animateHazards) hzSwitchAt = performance.now();
  if (!DEMO && !playing) { idleView(true); }
}
function idleView(move) {
  // planning view: both routes, avoided marks, overview camera (user can pan)
  const t = TL.D;
  renderAt(t, { camera: false, summary: false, carAtStart: true });
  if (move) map.easeTo({ ...TL.camEnd, duration: 1100 });
}
async function switchScenario(id) {
  if (id === scenario && trip) return; scenario = id; pause();
  await setTrip(trip.A, trip.B, trip.labels, id);
  animateIdle();
}
function animateIdle() { const t0 = performance.now(); const step = () => { if (playing) return; renderAt(TL.D, { camera: false, summary: false, carAtStart: true }); if (performance.now() - t0 < 1400) requestAnimationFrame(step); }; requestAnimationFrame(step); }

// playback (interactive)
function play(from) { if (!TL) return; playing = true; idle = false; playOffset = from ?? (curT >= TL.D - .05 ? 0 : curT); playT0 = performance.now(); map.stop(); $('#play').textContent = '❚❚ Pausa'; requestAnimationFrame(loop); }
function pause() { playing = false; $('#play').textContent = '▶ Recorrer ruta'; }
function loop() { if (!playing) return; const t = playOffset + (performance.now() - playT0) / 1000; renderAt(t); if (t >= TL.D) { pause(); return; } requestAnimationFrame(loop); }

// ---------------------------------------------------------------- boot
async function settle(timeout = 12000) {
  const t0 = performance.now();
  await new Promise(r => requestAnimationFrame(() => r()));
  while (performance.now() - t0 < timeout) { if (map.loaded() && map.areTilesLoaded()) break; await new Promise(r => setTimeout(r, 40)); }
  map.triggerRepaint();
  await new Promise(r => { map.once('render', () => r()); setTimeout(r, 1000); });
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

async function boot() {
  const fibre = paperImage(220, INK.sheet, 31, .7); { const c = document.createElement('canvas'); c.width = c.height = 220; c.getContext('2d').putImageData(fibre, 0, 0); document.documentElement.style.setProperty('--fibre', `url(${c.toDataURL()})`); }
  $('#grain').style.backgroundImage = `url(${grainDataURL()})`;
  $('#rain').style.backgroundImage = `url(${rainDataURL()})`;
  await Promise.race([Promise.all([document.fonts.load('48px "Patrick Hand"'), document.fonts.load('48px "Permanent Marker"')]), new Promise(r => setTimeout(r, 4000))]);
  const [snap, idx] = await Promise.all([
    fetch('./data/route-snapshot.json').then(r => r.json()).catch(() => null),
    fetch('/labs/shared/hazard/index.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => ({ layers: [] })),
    initRouter(),
  ]);
  SNAP = snap; HZ_INDEX = (idx.layers || []).filter(l => l && l.id && l.url);
  // load every listed hazard layer; degrade gracefully
  await Promise.all(HZ_INDEX.map(async l => {
    try {
      if (l.type === 'raster-tiles') { HZ[l.id] = { layer: l, raster: true, pieces: [], sites: new Map() }; return; }
      if (l.type !== 'geojson') { HZ[l.id] = { layer: l, failed: true }; return; }
      if (l.kind === 'water') { HZ[l.id] = { layer: l, support: true, pieces: [], sites: new Map() }; return; } // base map already draws water; router-only
      const fc = await (await fetch(l.url)).json(); HZ[l.id] = l.kind === 'hotspot' ? prepareHotspots(l, fc) : prepareSet(l, fc);
    } catch (e) { console.warn('hazard layer failed', l.id, e); HZ[l.id] = { layer: l, failed: true }; }
  }));
  const firstObs = HZ_INDEX.find(l => l.kind === 'observed' && HZ[l.id] && !HZ[l.id].failed) || HZ_INDEX.find(l => isScenarioKind(l.kind) && HZ[l.id] && !HZ[l.id].failed);
  scenario = firstObs ? firstObs.id : 'seco';
  const qs = Q.get('escenario'); if (qs && (qs === 'seco' || (HZ[qs] && !HZ[qs].failed && isScenarioKind(HZ[qs].layer.kind)))) scenario = qs;
  buildScenarioButtons(); buildLegend();

  map = new maplibregl.Map({ container: 'map', style: buildStyle(), center: [-103.36, 20.6], zoom: 11.5, pitch: 45, bearing: 150, maxPitch: 75, attributionControl: false, fadeDuration: PERF.has('fade') ? 200 : 0 /* labels pop in like stickers; keeps them visible during fast follow */, interactive: !DEMO, canvasContextAttributes: { antialias: true }, pixelRatio: Math.min(2, devicePixelRatio || 1) });
  map.on('styleimagemissing', e => { const img = PATTERNS[e.id]; if (img && !map.hasImage(e.id)) map.addImage(e.id, img); });
  await new Promise(r => map.on('load', r));
  if (PERF.has('nolabels')) for (const id of ['street-labels', 'place-labels']) map.setLayoutProperty(id, 'visibility', 'none');
  if (PERF.has('nobuild')) map.setLayoutProperty('buildings', 'visibility', 'none');
  if (PERF.has('noshadow')) for (const id of ['road-minor-shadow', 'road-major-shadow', 'green-shadow', 'park-shadow', 'water-shadow']) map.setLayoutProperty(id, 'visibility', 'none');
  for (const [k, img] of Object.entries(PATTERNS)) if (!map.hasImage(k)) map.addImage(k, img);
  for (const l of HZ_INDEX) if (HZ[l.id] && !HZ[l.id].failed) addHazardLayers(HZ[l.id]);
  addRouteLayers();
  const c = createCarLayer(map); car = c; map.addLayer(c.layer);

  const A = SNAP?.from.lonlat || [-103.3925, 20.6743], B = SNAP?.to.lonlat || [-103.3111, 20.5218];
  await setTrip(A, B, { from: SNAP?.from.label || 'Glorieta Minerva', to: SNAP?.to.label || 'Aeropuerto GDL' }, scenario, { animateHazards: !DEMO });
  wireUI();
  document.body.classList.add('ready');
  if (DEMO) { renderAt(0); await settle(); }
  else { map.jumpTo(TL.camEnd); renderAt(TL.D, { camera: false, summary: false, carAtStart: true }); animateIdle(); }
  return true;
}

function rainDataURL() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const ctx = c.getContext('2d'); const r = rng(77);
  ctx.lineCap = 'round';
  for (let i = 0; i < 22; i++) { const x = r() * 256, y = r() * 256, L = 8 + r() * 12; ctx.strokeStyle = r() < .55 ? 'rgba(0,131,138,0.42)' : 'rgba(255,72,176,0.36)'; ctx.lineWidth = 1.2 + r() * .9; for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) { ctx.beginPath(); ctx.moveTo(x + dx, y + dy); ctx.lineTo(x + dx - L * .26, y + dy + L); ctx.stroke(); } }
  return c.toDataURL();
}

function wireUI() {
  $('#play').addEventListener('click', () => playing ? pause() : play());
  $('#restart').addEventListener('click', () => play(0));
  $('#scrub').max = DUR;
  $('#scrub').addEventListener('input', e => { pause(); renderAt(+e.target.value); });
  $('#sheet-handle').addEventListener('click', () => $('#panel').classList.toggle('open'));
  $('#pick').addEventListener('click', () => { pause(); picking = 1; const h = $('#hint'); h.textContent = 'Toca el mapa para elegir el origen (A)'; h.classList.remove('hidden'); });
  let pickA = null;
  map.on('click', async e => {
    if (!picking) return; const ll = [+e.lngLat.lng.toFixed(5), +e.lngLat.lat.toFixed(5)];
    if (picking === 1) { pickA = ll; picking = 2; $('#hint').textContent = 'Ahora el destino (B)'; return; }
    picking = 0; $('#hint').classList.add('hidden');
    const lab = p => `${p[1].toFixed(4)}, ${p[0].toFixed(4)}`;
    try { await setTrip(pickA, ll, { from: 'Punto ' + lab(pickA), to: 'Punto ' + lab(ll) }, scenario); } catch (err) { console.error(err); $('#engine').textContent = 'No se pudo calcular la ruta: ' + err.message; }
  });
  map.on('move', () => { if (!playing && !DEMO && car) car.state.mapBearing = map.getBearing(); });
  map.on('zoom', () => { if (!playing && !DEMO && car) { const px = isPhone() ? 64 : 84; car.state.scale = px * mpp(map.getZoom()) / 4.8 * (map.getZoom() < 13 ? .85 : 1); } });
  addEventListener('resize', () => { if (TL) { TL = buildTimeline(trip); if (!playing && !DEMO) idleView(false); else renderAt(curT); } });
}

// ---------------------------------------------------------------- demo hook
let resolveReady; const ready = new Promise(r => (resolveReady = r));
window.__cauceDemo = {
  duration_s: DUR, ready,
  async seek(t) { await ready; playing = false; renderAt(t); await settle(); return true; },
  info() { return trip && { normal_m: trip.normal.r.distance_m, safe_m: trip.safe.r.distance_m, avoided: trip.avoided.map(h => h.site.base), crossS: trip.crossS.map(h => h.site.base), sD: trip.sD, tR: TL.tR, alerts: TL.alerts.map(a => [a.id, +a.t0.toFixed(2), +a.t1.toFixed(2)]), zones: TL.zones, engine: trip.note }; },
};
boot().then(() => {
  resolveReady(true);
  if (DEMO && !Q.has('still')) { playing = true; playOffset = 0; playT0 = performance.now(); requestAnimationFrame(function demoLoop() { if (!playing) return; const t = (performance.now() - playT0) / 1000; renderAt(t); if (t < DUR) requestAnimationFrame(demoLoop); else playing = false; }); }
}).catch(e => { console.error(e); $('#loading-text').textContent = 'No se pudo cargar: ' + e.message; });
