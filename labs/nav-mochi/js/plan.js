// cauce. nav-mochi — hazard model + route planning on top of the shared router API.
// Pure ES module: runs in the browser and in Node 22 (bake/test scripts).
const R = 6371008.8, D2R = Math.PI / 180;
export const LAT0 = 20.62;
const KX = Math.cos(LAT0 * D2R) * R * D2R, KY = R * D2R;
export const toM = ([x, y]) => [x * KX, y * KY];
export const toLL = ([x, y]) => [x / KX, y / KY];

function pip(p, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if (((a[1] > p[1]) != (b[1] > p[1])) && (p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } return c; }
function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1]; const l = dx * dx + dy * dy; let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]); }
function distLine(p, r) { let d = 1e12; for (let i = 0; i < r.length - 1; i++) d = Math.min(d, segDist(p, r[i], r[i + 1])); return d; }
function distPoly(p, rings) { if (pip(p, rings[0]) && !rings.slice(1).some(h => pip(p, h))) return 0; let d = 1e12; for (const r of rings) for (let i = 0; i < r.length - 1; i++) d = Math.min(d, segDist(p, r[i], r[i + 1])); return d; }
const lc = s => (s || '').toString().toLowerCase();

// ---------------------------------------------------------------- hazards
// A "site" groups IMEPLAN features by base code (SI-GDL-031 + SI-GDL-031/1 …): one sitio polygon, its
// category point (Referencia, height range in cm) and any zona-crítica sub-polygons. Modeled layers
// (other agents) become generic polygon hazards with kind "modeled".
export function buildHazards(layers) {
  const sites = new Map(), extra = [], lineSites = new Map();
  for (const { meta, data } of layers) {
    if (!data?.features) continue;
    const imeplan = /imeplan/i.test(meta.id) || data.features.some(f => /IMEPLAN/.test(f.properties?.source || ''));
    for (const f of data.features) {
      const g = f.geometry; if (!g) continue;
      const p = f.properties || {};
      if (imeplan) {
        const code = (p.name || '').split('/')[0] || ('f' + f.id);
        let s = sites.get(code);
        if (!s) sites.set(code, s = { id: code, layer: meta.id, kind: meta.kind || 'observed', polys: [], lines: [], crit: [], point: null, props: {} });
        if (g.type === 'Point') { s.point = g.coordinates; Object.assign(s.props, p); }
        else if (p.category === 'Zonas Criticas') s.crit.push({ coords: g.coordinates, props: p });
        else { s.polys.push(g.coordinates); Object.assign(s.props, { ...p, ...s.props }); }
      } else if (meta.kind === 'water') {
        continue; // mapped permanent water: the router avoids it; not an alert
      } else if (g.type === 'LineString' || g.type === 'MultiLineString') {
        const key = meta.id + ':' + (p.site ?? f.id ?? extra.length);
        let e = lineSites.get(key);
        if (!e) { lineSites.set(key, e = { id: key, layer: meta.id, kind: meta.kind || 'hotspot', polys: [], lines: [], crit: [], point: p.marker || null, props: p, label: p.label || meta.label }); extra.push(e); }
        for (const l of (g.type === 'LineString' ? [g.coordinates] : g.coordinates)) e.lines.push(l);
        if ((p.confidence === 'alta') && e.props.confidence !== 'alta') e.props = p;
      } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        extra.push({ id: meta.id + ':' + (f.id ?? extra.length), layer: meta.id, kind: meta.kind || 'modeled', polys, lines: [], crit: [], point: null, props: p, label: p.label || p.name || meta.label });
      }
    }
  }
  const out = [];
  for (const s of [...sites.values(), ...extra]) {
    const P = s.props;
    const critTxt = s.crit.map(c => lc(c.props.Motivo) + ' ' + lc(c.props['Infraestructura expuesta'])).join(' ');
    const allTxt = lc(P['Sistema afectable']) + ' ' + lc(P['Referencia']) + ' ' + lc(P['Categoría']) + ' ' + critTxt;
    const underpass = /desnivel/.test(allTxt) || s.kind === 'hotspot';
    const type = s.kind === 'modeled' ? 'modeled' : underpass ? 'underpass' : s.crit.length ? 'critical' : 'ponding';
    const range = P['Rango de alturas de inundación (cm)'] || P['Rango de alturas de inundación'] || '';
    const nums = (range.match(/\d+/g) || []).map(Number);
    const maxCm = nums.length ? Math.max(...nums) : null;
    const parts = [...s.polys.map(c => ({ rings: c, crit: false })), ...s.crit.map(c => ({ rings: c.coords, crit: true, props: c.props })), ...s.lines.map(l => ({ rings: [l], crit: false, line: true }))]
      .map(pp => { const rings = pp.rings.map(r => r.map(toM)); if (pp.line) { let L = 0; for (let i = 1; i < rings[0].length; i++) L += Math.hypot(rings[0][i][0] - rings[0][i - 1][0], rings[0][i][1] - rings[0][i - 1][1]); pp.len = L; } let x0 = 1e15, y0 = 1e15, x1 = -1e15, y1 = -1e15; for (const [x, y] of rings[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { ...pp, ringsM: rings, bb: [x0, y0, x1, y1] }; });
    if (!parts.length) continue;
    let anchor = s.point;
    if (!anchor) { const bb = parts[0].bb; anchor = toLL([(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]); }
    out.push({
      id: s.id, layer: s.layer, kind: s.kind, type, parts, anchor, maxCm, range,
      ref: P['Referencia'] || P.nombre || s.label || s.id, confidence: P.confidence || null,
      sistema: P['Sistema afectable'] || '', regimen: P['Régimen'] || '',
      critInfo: s.crit.map(c => ({ motivo: c.props.Motivo || '', altura: c.props['Altura máxima reportada'] || '', infra: c.props['Infraestructura expuesta'] || '' })),
      weight: s.kind === 'hotspot' ? (P.confidence === 'alta' ? 700 : 350) : type === 'underpass' ? 1800 : type === 'critical' ? 900 : type === 'modeled' ? 600 : (maxCm && maxCm >= 100 ? 420 : 300)
    });
  }
  return indexHazards(out);
}

export function subset(hz, pred) { return indexHazards(hz.list.filter(pred)); }
function indexHazards(list) {
  const cell = 500, grid = new Map();
  list.forEach((h, i) => { for (const pt of h.parts) { const [x0, y0, x1, y1] = pt.bb; for (let gx = Math.floor((x0 - 60) / cell); gx <= Math.floor((x1 + 60) / cell); gx++) for (let gy = Math.floor((y0 - 60) / cell); gy <= Math.floor((y1 + 60) / cell); gy++) { const k = gx + ',' + gy; if (!grid.has(k)) grid.set(k, new Set()); grid.get(k).add(i); } } });
  return { list, near(pm) { return grid.get(Math.floor(pm[0] / cell) + ',' + Math.floor(pm[1] / cell)) || EMPTY; } };
}
const EMPTY = new Set();

// --------------------------------------------------------------- geometry
export function measure(coords) {
  const m = coords.map(toM), cum = [0];
  for (let i = 1; i < m.length; i++) cum.push(cum[i - 1] + Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]));
  return { coords, m, cum, length: cum[cum.length - 1] };
}
export function pointAt(line, s) {
  const { m, cum } = line; s = Math.max(0, Math.min(line.length, s));
  let lo = 0, hi = cum.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const seg = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / seg;
  return [m[lo][0] + (m[hi][0] - m[lo][0]) * t, m[lo][1] + (m[hi][1] - m[lo][1]) * t];
}
export function sliceLine(line, s0, s1) {
  const out = [toLL(pointAt(line, s0))];
  for (let i = 0; i < line.cum.length; i++) if (line.cum[i] > s0 && line.cum[i] < s1) out.push(line.coords[i]);
  out.push(toLL(pointAt(line, s1))); return out;
}
export function project(line, pm) { // nearest along-distance on line
  let best = 1e15, bs = 0; const { m, cum } = line;
  for (let i = 0; i < m.length - 1; i++) { const a = m[i], b = m[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; let t = l ? ((pm[0] - a[0]) * dx + (pm[1] - a[1]) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(a[0] + t * dx - pm[0], a[1] + t * dy - pm[1]); if (d < best) { best = d; bs = cum[i] + Math.sqrt(l) * t; } }
  return { s: bs, d: best };
}

// Hazard exposure along a route: every site within `near` metres (default 250) with its along-distance and min distance.
export function exposure(coords, hz, { buffer = 18, near = 250, step = 12 } = {}) {
  const line = measure(coords); const hits = new Map();
  for (let s = 0; s <= line.length; s += step) {
    const p = pointAt(line, s);
    for (const i of hz.near(p)) {
      const h = hz.list[i];
      for (const pt of h.parts) {
        const [x0, y0, x1, y1] = pt.bb; if (p[0] < x0 - near || p[0] > x1 + near || p[1] < y0 - near || p[1] > y1 + near) continue;
        const d = pt.line ? distLine(p, pt.ringsM[0]) : distPoly(p, pt.ringsM);
        let e = hits.get(h.id); if (!e) hits.set(h.id, e = { h, d: 1e9, s: 0, inside: false, crit: false, sIn: null, run: 0 });
        if (d < e.d) { e.d = d; e.s = s; }
        if (pt.line) { if (d <= 10) { e.run += step; if (e.run >= Math.min(40, 0.5 * pt.len) && !e.inside) { e.inside = true; e.sIn = s - e.run; } } }
        else if (d <= buffer) { e.inside = true; if (pt.crit) e.crit = true; if (e.sIn == null) e.sIn = s; }
      }
    }
  }
  const all = [...hits.values()].filter(e => e.d <= near).sort((a, b) => (a.sIn ?? a.s) - (b.sIn ?? b.s));
  const crossed = all.filter(e => e.inside);
  const penalty = crossed.reduce((a, e) => a + e.h.weight * (e.crit ? 1.4 : 1), 0);
  return { line, all, crossed, penalty };
}

// --------------------------------------------------------------- planning
export const score = (r, ex) => r.duration_s + ex.penalty;

async function routeVia(router, pts, opts, cache) {
  const legs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const k = pts[i].map(v => v.toFixed(5)) + '>' + pts[i + 1].map(v => v.toFixed(5)) + (opts.avoid ? 'A' : '');
    if (!cache.has(k)) cache.set(k, router.route(pts[i], pts[i + 1], opts).catch(e => null));
    const r = await cache.get(k); if (!r) return null; legs.push(r);
  }
  const coordinates = legs.flatMap((l, i) => i ? l.coordinates.slice(1) : l.coordinates);
  return { coordinates, distance_m: legs.reduce((a, l) => a + l.distance_m, 0), duration_s: legs.reduce((a, l) => a + l.duration_s, 0), steps: legs.flatMap(l => l.steps || []), avoided: legs.flatMap(l => l.avoided || []), engine: legs[0].engine, via: pts.slice(1, -1) };
}

function hazardFC(hz, ids) {
  return { type: 'FeatureCollection', features: hz.list.filter(h => !ids || ids.includes(h.layer)).flatMap(h => h.parts.filter(p => !p.line).map(p => ({ type: 'Feature', properties: { id: h.id, type: h.type, weight: h.weight }, geometry: { type: 'Polygon', coordinates: p.rings } }))) };
}

// Plan normal + safe routes. If the router already avoids hazards (real engine), its answer is used as is.
// With the stub engine the safe route is found here: perpendicular via-point detours around the first
// crossed site, kept only when they lower duration + hazard penalty (max `iters` detours).
export async function plan(router, from, to, hz, { hazardIds = null, iters = 5, onProgress = () => { }, cache = new Map() } = {}) {
  const real = router.ready === true && !/stub/.test(router.engine || '');
  if (real) {
    const ids = hazardIds && hazardIds.length ? hazardIds : null;
    // rain policy: never enter IMEPLAN critical zones or underpass sites (hard block, router falls back if impossible);
    // every other listed hazard is a soft penalty handled by the router.
    const block = ids ? blockFC(hz) : null;
    const c = ids ? await router.route(from, to, { hazardIds: ids, compare: true, ...(block.features.length ? { avoid: block } : {}) }) : await router.route(from, to);
    const normal = c.normal || c, safe = c.safe || c;
    const exN = exposure(normal.coordinates, hz), exS = safe === normal ? exN : exposure(safe.coordinates, hz);
    return { normal, safe, exN, exS, method: 'router', comparison: c.comparison || null };
  }
  const normal = await routeVia(router, [from, to], { avoid: null }, cache);
  if (!normal) throw new Error('router: sin ruta');
  const exN = exposure(normal.coordinates, hz);
  if (!hz.list.length) return { normal, safe: normal, exN, exS: exN, method: 'none' };
  let safe = await routeVia(router, [from, to], { avoid: hazardFC(hz, hazardIds), hazardIds }, cache) || normal;
  let exS = exposure(safe.coordinates, hz);
  const stub = /stub/.test(safe.engine || '') || router.ready === false;
  let method = stub ? 'detour-client' : 'router';
  if (stub || exS.crossed.length) {
    const tried = new Set(); let vias = [];
    for (let it = 0; it < iters; it++) {
      const target = exS.crossed.find(e => !tried.has(e.h.id)); if (!target) break;
      tried.add(target.h.id); onProgress({ iter: it, site: target.h });
      const line = exS.line, s = target.sIn ?? target.s;
      const a = pointAt(line, Math.max(0, s - 150)), b = pointAt(line, Math.min(line.length, s + 150));
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      const c = pointAt(line, s);
      const cands = [];
      for (const off of [400, -400, 800, -800, 1400, -1400, 2400, -2400]) cands.push(toLL([c[0] + nx * off, c[1] + ny * off]));
      // insert the via in along-route order relative to existing vias
      const res = await Promise.all(cands.map(async v => {
        const vs = [...vias, v].map(p => ({ p, s: project(line, toM(p)).s })).sort((x, y) => x.s - y.s).map(o => o.p);
        const r = await routeVia(router, [from, ...vs, to], { avoid: null }, cache); if (!r) return null;
        const ex = exposure(r.coordinates, hz); return { r, ex, vs, sc: score(r, ex) };
      }));
      const best = res.filter(Boolean).sort((x, y) => x.sc - y.sc)[0];
      if (best && best.sc < score(safe, exS) - 30) { safe = best.r; exS = best.ex; vias = best.vs; }
    }
  }
  return { normal, safe, exN, exS, method };
}

export function blockFC(hz) {
  const features = [];
  for (const h of hz.list) if (h.kind === 'observed') for (const p of h.parts) if (!p.line && (p.crit || h.type === 'underpass')) features.push({ type: 'Feature', properties: { id: h.id }, geometry: { type: 'Polygon', coordinates: p.rings } });
  return { type: 'FeatureCollection', features };
}
// Map the router's bridge-aware `crossed` list onto our site ids.
export function routerCrossedIds(route) {
  if (!Array.isArray(route?.crossed)) return null;
  return new Set(route.crossed.map(c => /imeplan/i.test(c.layer) ? String(c.properties?.name || '').split('/')[0] : c.properties?.site != null ? c.layer + ':' + c.properties.site : c.layer + ':' + c.id));
}
// Keep only crossings both our geometry and the router agree on (drops bridges over a hazard).
export function alignCrossed(ex, ids) {
  if (!ids) return ex;
  for (const e of ex.all) if (e.inside && !ids.has(e.h.id)) { e.inside = false; e.crit = false; }
  ex.crossed = ex.crossed.filter(e => e.inside);
  ex.penalty = ex.crossed.reduce((a, e) => a + e.h.weight * (e.crit ? 1.4 : 1), 0);
  return ex;
}
// What the safe route avoided: sites crossed by the normal route and not by the safe one.
export function avoidedSites(exN, exS) {
  const sIds = new Set(exS.crossed.map(e => e.h.id));
  return exN.crossed.filter(e => !sIds.has(e.h.id));
}
