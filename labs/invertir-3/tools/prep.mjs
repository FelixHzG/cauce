// invertir-3 "Alcaldía por un día" — data prep (VPS, small conversions only).
// Inputs: /labs/shared/infra/ageb-profile.geojson, hazard/observed-imeplan-2026.geojson, hazard/water-bodies.geojson,
//         router graph (major roads), OSM place names (in/places.json, extracted on W10 by w10/places.mjs),
//         sim-drenaje stats.json (grid of its Web-Mercator data images, to rasterize an AGEB label image on the same grid).
// Outputs: labs/invertir-3/data/board.json (+ labels.png when the sim-drenaje image grid is known).
// World coordinates = Web-Mercator metres relative to ORIGIN (so sim-drenaje's Mercator images map affinely).
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { PNG } from 'pngjs';

const LABS = '/srv/contorno/data/guadalajara-flood-lab/labs';
const OUT = process.env.OUT_DIR || path.join(LABS, 'invertir-3/data');
fs.mkdirSync(OUT, { recursive: true });
const HERE = path.dirname(new URL(import.meta.url).pathname);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const R = 6378137;
const mx = lon => R * lon * Math.PI / 180;
const my = lat => R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));

// ---------------------------------------------------------------- AGEBs
const ag = JSON.parse(fs.readFileSync(path.join(LABS, 'shared/infra/ageb-profile.geojson'), 'utf8'));
const feats = ag.features.filter(f => f.geometry && f.properties.pob > 0);
log('AGEBs with population', feats.length, 'of', ag.features.length);
let bb = [Infinity, Infinity, -Infinity, -Infinity];
const polysOf = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
for (const f of feats) for (const p of polysOf(f.geometry)) for (const [lon, lat] of p[0]) {
  if (lon < bb[0]) bb[0] = lon; if (lat < bb[1]) bb[1] = lat; if (lon > bb[2]) bb[2] = lon; if (lat > bb[3]) bb[3] = lat;
}
const ORIGIN = [+((bb[0] + bb[2]) / 2).toFixed(4), +((bb[1] + bb[3]) / 2).toFixed(4)];
const OX = mx(ORIGIN[0]), OY = my(ORIGIN[1]);
const W = (lon, lat) => [mx(lon) - OX, my(lat) - OY];
const MSCALE = Math.cos(ORIGIN[1] * Math.PI / 180); // true metres per Mercator metre

function dp(pts, tol) { // Douglas-Peucker on [[x,y]...]
  if (pts.length <= 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]]; const t2 = tol * tol;
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b]; const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey; if (d > md) { md = d; mi = i; }
    }
    if (md > t2 && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const ringArea = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return s / 2; };
function pip(x, y, rings) { let ins = false; for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
function segDist2(px, py, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1]; const L = dx * dx + dy * dy; let t = L ? ((px - a[0]) * dx + (py - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); const ex = a[0] + t * dx - px, ey = a[1] + t * dy - py; return ex * ex + ey * ey; }
function edgeDist(x, y, rings) { let m = Infinity; for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) m = Math.min(m, segDist2(x, y, r[j], r[i])); return Math.sqrt(m); }
function polylabel(rings, precision = 8) { // pole of inaccessibility (Mapbox algorithm, simplified queue)
  const outer = rings[0]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of outer) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const size = Math.min(x1 - x0, y1 - y0); if (!size) return [x0, y0];
  const cell = (x, y, h) => { const d = (pip(x, y, rings) ? 1 : -1) * edgeDist(x, y, rings); return { x, y, h, d, max: d + h * Math.SQRT2 }; };
  let q = []; const h0 = size / 2;
  for (let x = x0; x < x1; x += size) for (let y = y0; y < y1; y += size) q.push(cell(x + h0, y + h0, h0));
  let best = cell((x0 + x1) / 2, (y0 + y1) / 2, 0); let it = 0;
  while (q.length && it++ < 4000) {
    q.sort((a, b) => a.max - b.max); const c = q.pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const h = c.h / 2; q.push(cell(c.x - h, c.y - h, h), cell(c.x + h, c.y - h, h), cell(c.x - h, c.y + h, h), cell(c.x + h, c.y + h, h));
  }
  return [best.x, best.y, best.d];
}

// IMEPLAN references (point "Referencia" text by site id)
const im = JSON.parse(fs.readFileSync(path.join(LABS, 'shared/hazard/observed-imeplan-2026.geojson'), 'utf8'));
const imRef = {}, imCat = {}; const imPts = [];
for (const f of im.features) {
  const p = f.properties; const id = String(p.name || '').split('/')[0];
  if (f.geometry.type === 'Point' && p.Referencia) { imRef[id] = p.Referencia; imCat[id] = p['Rango de alturas de inundación (cm)'] || ''; }
  if (f.geometry.type === 'Point') { const [x, y] = W(...f.geometry.coordinates); imPts.push([Math.round(x), Math.round(y), id, p.Referencia || '', p['Rango de alturas de inundación (cm)'] || '']); }
}
// OSM place names
const places = JSON.parse(fs.readFileSync(path.join(HERE, 'in/places.json'), 'utf8'))
  .filter(p => ['neighbourhood', 'suburb', 'quarter', 'village', 'hamlet', 'town', 'locality'].includes(p.place))
  .map(p => ({ ...p, xy: W(p.lon, p.lat) }));

const MUN_SHORT = { '039': 'Guadalajara', '120': 'Zapopan', '098': 'Tlaquepaque', '101': 'Tonalá', '097': 'Tlajomulco', '070': 'El Salto', '051': 'Juanacatlán', '044': 'Ixtlahuacán', '124': 'Zapotlanejo', '002': 'Acatlán' };
const q1 = v => v == null ? null : Math.round(v * 10) / 10;
const agebs = [];
for (const f of feats) {
  const p = f.properties;
  const polys = [];
  let bestArea = 0, bestRings = null;
  for (const poly of polysOf(f.geometry)) {
    const rings = [];
    for (let ri = 0; ri < poly.length; ri++) {
      const r = poly[ri].map(([lon, lat]) => W(lon, lat));
      let s = dp(r, 9); if (s.length < 4) { if (ri === 0) s = r; else continue; }
      if (ri > 0 && Math.abs(ringArea(s)) < 4000) continue; // drop tiny holes
      rings.push(s);
    }
    if (!rings.length) continue;
    const a = Math.abs(ringArea(rings[0]));
    if (a < 600 && polysOf(f.geometry).length > 1) continue; // slivers of multipart AGEBs
    polys.push(rings);
    if (a > bestArea) { bestArea = a; bestRings = rings; }
  }
  if (!polys.length) continue;
  const pl = polylabel(bestRings, 6);
  // colonia name: OSM place node inside the AGEB (closest to label point), else nearest within 700 m
  let col = null, colIn = false, bd = Infinity;
  for (const pc of places) {
    const d = Math.hypot(pc.xy[0] - pl[0], pc.xy[1] - pl[1]); if (d > 3500) continue;
    const inside = polys.some(r => pip(pc.xy[0], pc.xy[1], r));
    const score = inside ? d : d + 1e6;
    if (score < bd) { bd = score; col = pc.name; colIn = inside; }
  }
  if (!colIn && bd - 1e6 > 1200 / MSCALE) col = null;
  const ids = (p.imeplan_ids || '').split(/\s+/).filter(Boolean).map(s => s.split('/')[0]);
  const ref = ids.map(i => imRef[i]).find(Boolean) || null;
  agebs.push({
    id: p.cvegeo, m: p.mun, pob: p.pob, viv: p.viv_hab, ocup: p.prom_ocup,
    esc: p.n_escuela, gua: p.n_guarderia, hos: p.n_hospital, cli: p.n_clinica, res: p.n_residencia_cuidado,
    imn: p.imn_2020, gm: p.gm_2020, a: p.area_km2,
    ia: p.imeplan_area_pct, iz: p.imeplan_zona_area_pct, isn: p.imeplan_sitios_n, izn: p.imeplan_zonas_n,
    ids: [...new Set(ids)].slice(0, 6), ref, pr: p.prensa_puntos_n, pd: p.pasos_desnivel_n,
    ve: q1(p.verde_pct), bu: q1(p.builtup_pct), ec: q1(p.edif_cobertura_pct), agua: q1(p.agua_pct),
    sp: p.inv_pct_sin_pluvial, ob: p.obras_pluviales_n, pe: p.prio_exploratoria,
    p65: p.pct_65_mas, p014: p.pct_0_14,
    col, colIn,
    c: [Math.round(pl[0]), Math.round(pl[1])], r: Math.round((pl[2] || 50) * MSCALE),
    g: polys.map(rings => rings.map(r => r.flatMap(([x, y]) => [Math.round(x), Math.round(y)]))),
  });
}
log('kept AGEBs', agebs.length, 'named', agebs.filter(a => a.col).length, 'inside', agebs.filter(a => a.colIn).length);

// ---------------------------------------------------------------- municipality labels
const mun = {};
for (const a of agebs) { const m = mun[a.m] ||= { id: a.m, name: MUN_SHORT[a.m] || a.m, sx: 0, sy: 0, w: 0, pob: 0 }; m.sx += a.c[0] * a.pob; m.sy += a.c[1] * a.pob; m.w += a.pob; m.pob += a.pob; }
const muns = Object.values(mun).map(m => ({ id: m.id, name: m.name, pob: m.pob, c: [Math.round(m.sx / m.w), Math.round(m.sy / m.w)] }));
// hand nudges so labels sit on recognisable ground
for (const m of muns) if (m.id === '039') { m.c = W(-103.3496, 20.6767).map(Math.round); }

// ---------------------------------------------------------------- AGEB bbox in world coords
let wb = [Infinity, Infinity, -Infinity, -Infinity];
for (const a of agebs) for (const poly of a.g) { const r = poly[0]; for (let i = 0; i < r.length; i += 2) { wb[0] = Math.min(wb[0], r[i]); wb[1] = Math.min(wb[1], r[i + 1]); wb[2] = Math.max(wb[2], r[i]); wb[3] = Math.max(wb[3], r[i + 1]); } }
const inBox = (x, y, pad = 500) => x > wb[0] - pad && x < wb[2] + pad && y > wb[1] - pad && y < wb[3] + pad;

// ---------------------------------------------------------------- floating-island ground (blob around the urban AGEBs)
function islands() {
  const C = 250, PAD = 7000; const gx0 = wb[0] - PAD, gy0 = wb[1] - PAD; const GW = Math.ceil((wb[2] - wb[0] + 2 * PAD) / C), GH = Math.ceil((wb[3] - wb[1] + 2 * PAD) / C);
  const urb = new Uint8Array(GW * GH);
  for (const a of agebs) for (const poly of a.g) {
    const r = poly[0]; let y0 = Infinity, y1 = -Infinity; for (let i = 1; i < r.length; i += 2) { y0 = Math.min(y0, r[i]); y1 = Math.max(y1, r[i]); }
    for (let gy = Math.max(0, Math.floor((y0 - gy0) / C)); gy <= Math.min(GH - 1, Math.ceil((y1 - gy0) / C)); gy++) {
      const yc = gy0 + (gy + 0.5) * C; const xs = [];
      for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) { const ya = r[j + 1], yb = r[i + 1]; if ((ya > yc) !== (yb > yc)) xs.push(r[j] + (yc - ya) / (yb - ya) * (r[i] - r[j])); }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let gx = Math.max(0, Math.round((xs[k] - gx0) / C)); gx <= Math.min(GW - 1, Math.round((xs[k + 1] - gx0) / C)); gx++) urb[gy * GW + gx] = 1;
    }
    // also mark the label point so tiny AGEBs count
    const gx = Math.floor((a.c[0] - gx0) / C), gy = Math.floor((a.c[1] - gy0) / C); if (gx >= 0 && gy >= 0 && gx < GW && gy < GH) urb[gy * GW + gx] = 1;
  }
  // chamfer distance (cells) to nearest urban cell
  const INF = 1e9, d = new Float64Array(GW * GH).fill(INF); for (let i = 0; i < d.length; i++) if (urb[i]) d[i] = 0;
  const a1 = 1, a2 = Math.SQRT2;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const i = y * GW + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + a1); if (y > 0) { v = Math.min(v, d[i - GW] + a1); if (x > 0) v = Math.min(v, d[i - GW - 1] + a2); if (x < GW - 1) v = Math.min(v, d[i - GW + 1] + a2); } d[i] = v; }
  for (let y = GH - 1; y >= 0; y--) for (let x = GW - 1; x >= 0; x--) { const i = y * GW + x; let v = d[i];
    if (x < GW - 1) v = Math.min(v, d[i + 1] + a1); if (y < GH - 1) { v = Math.min(v, d[i + GW] + a1); if (x < GW - 1) v = Math.min(v, d[i + GW + 1] + a2); if (x > 0) v = Math.min(v, d[i + GW - 1] + a2); } d[i] = v; }
  // field: positive inside island; blur once for roundness
  const R0 = 1100 / C; let f = new Float64Array(GW * GH); for (let i = 0; i < f.length; i++) f[i] = R0 - d[i];
  for (let pass = 0; pass < 2; pass++) { const g = new Float64Array(f.length); for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { let s = 0, w = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= GW || yy >= GH) { s += -5; w++; continue; } s += f[yy * GW + xx]; w++; } g[y * GW + x] = s / w; } f = g; }
  for (let x = 0; x < GW; x++) { f[x] = -5; f[(GH - 1) * GW + x] = -5; } for (let y = 0; y < GH; y++) { f[y * GW] = -5; f[y * GW + GW - 1] = -5; }
  // marching squares → segments keyed by edge ids → rings
  const P = (x, y) => [gx0 + (x + 0.5) * C, gy0 + (y + 0.5) * C];
  const segs = new Map(); const eid = (x, y, h) => (h ? 'h' : 'v') + x + ',' + y; // h: edge (x,y)-(x+1,y); v: (x,y)-(x,y+1)
  const pt = (e) => { const h = e[0] === 'h'; const [x, y] = e.slice(1).split(',').map(Number); const i0 = y * GW + x, i1 = h ? i0 + 1 : i0 + GW; const t = f[i0] / (f[i0] - f[i1]); const [ax, ay] = P(x, y); return h ? [ax + t * C, ay] : [ax, ay + t * C]; };
  for (let y = 0; y < GH - 1; y++) for (let x = 0; x < GW - 1; x++) {
    const v0 = f[y * GW + x] > 0, v1 = f[y * GW + x + 1] > 0, v2 = f[(y + 1) * GW + x + 1] > 0, v3 = f[(y + 1) * GW + x] > 0;
    const code = (v0 ? 1 : 0) | (v1 ? 2 : 0) | (v2 ? 4 : 0) | (v3 ? 8 : 0); if (code === 0 || code === 15) continue;
    const B = eid(x, y, 1), Rr = eid(x + 1, y, 0), T = eid(x, y + 1, 1), Lf = eid(x, y, 0);
    // oriented so the inside is on the left (y up)
    const table = { 1: [[Lf, B]], 2: [[B, Rr]], 3: [[Lf, Rr]], 4: [[Rr, T]], 5: [[Lf, T], [Rr, B]], 6: [[B, T]], 7: [[Lf, T]], 8: [[T, Lf]], 9: [[T, B]], 10: [[T, Rr], [B, Lf]], 11: [[T, Rr]], 12: [[Rr, Lf]], 13: [[Rr, B]], 14: [[B, Lf]] };
    for (const [a, b] of table[code]) segs.set(a, b);
  }
  const rings = []; const seen = new Set();
  for (const start of segs.keys()) { if (seen.has(start)) continue; const ring = []; let e = start; let guard = 0; while (!seen.has(e) && segs.has(e) && guard++ < 1e6) { seen.add(e); ring.push(pt(e)); e = segs.get(e); } if (ring.length > 8) rings.push(ring); }
  // Chaikin smoothing + simplify, keep outer rings with area > 1.5 km²
  const chaikin = r => { const o = []; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } return o; };
  const out = [];
  // marching squares above keeps the inside on the right: outer rings have negative area (y up) → reverse to CCW
  for (let r of rings) { const A = ringArea(r); if (A > -1.5e6) continue; r = chaikin(chaikin(r.reverse())); r = dp([...r, r[0]], 25).slice(0, -1); out.push(r.flatMap(([x, y]) => [Math.round(x), Math.round(y)])); }
  return out;
}
const ground = islands();
log('island rings', ground.length, ground.map(g => g.length / 2).join(','));
// populated core: AGEBs within the radius holding 92% of people around the population-weighted centre
let core;
{ let sx = 0, sy = 0, sw = 0; for (const a of agebs) { sx += a.c[0] * a.pob; sy += a.c[1] * a.pob; sw += a.pob; } const cx = sx / sw, cy = sy / sw;
  const d = agebs.map(a => [Math.hypot(a.c[0] - cx, a.c[1] - cy), a]).sort((p, q) => p[0] - q[0]); let cum = 0, R = 0; for (const [dd, a] of d) { cum += a.pob; if (cum >= 0.92 * sw) { R = dd; break; } }
  core = [Infinity, Infinity, -Infinity, -Infinity]; for (const [dd, a] of d) { if (dd > R) break; core[0] = Math.min(core[0], a.c[0]); core[1] = Math.min(core[1], a.c[1]); core[2] = Math.max(core[2], a.c[0]); core[3] = Math.max(core[3], a.c[1]); }
  core = core.map(Math.round); log('core bounds', core, 'R km', (R * MSCALE / 1000).toFixed(1)); }

// ---------------------------------------------------------------- major roads from the router graph
const meta = JSON.parse(fs.readFileSync(path.join(LABS, 'shared/router/data/graph.meta.json'), 'utf8'));
const raw = zlib.gunzipSync(fs.readFileSync(path.join(LABS, 'shared/router/data/graph.bin.gz')));
const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
const T = { Int32Array, Uint32Array, Float32Array, Uint8Array, Uint16Array, Int8Array };
const S = {}; for (const s of meta.sections) S[s.name] = new T[s.type](ab, s.offset, s.count);
const N = meta.counts.nodes, E = meta.counts.edges;
const nlon = new Float64Array(N), nlat = new Float64Array(N);
{ let x = 0, y = 0; for (let i = 0; i < N; i++) { x += S.nodeLon[i]; y += S.nodeLat[i]; nlon[i] = x / 1e6; nlat[i] = y / 1e6; } }
const CL = meta.classes; const want = { motorway: 0, trunk: 0, primary: 1, secondary: 2 };
const roads = [[], [], []];
const seenWay = new Set();
for (let e = 0; e < E; e++) {
  const cls = CL[S.edgeClass[e]]; if (!(cls in want)) continue;
  if (S.edgeFlags[e] & 512) continue; // links
  const key = S.edgeFrom[e] < S.edgeTo[e] ? S.edgeFrom[e] + ':' + S.edgeTo[e] : S.edgeTo[e] + ':' + S.edgeFrom[e];
  if (seenWay.has(key)) continue; seenWay.add(key);
  const pts = [W(nlon[S.edgeFrom[e]], nlat[S.edgeFrom[e]])];
  let x = Math.round(nlon[S.edgeFrom[e]] * 1e6), y = Math.round(nlat[S.edgeFrom[e]] * 1e6);
  for (let i = S.geomOff[e]; i < S.geomOff[e + 1]; i++) { x += S.geomLon[i]; y += S.geomLat[i]; pts.push(W(x / 1e6, y / 1e6)); }
  pts.push(W(nlon[S.edgeTo[e]], nlat[S.edgeTo[e]]));
  if (!pts.some(([px, py]) => inBox(px, py))) continue;
  roads[want[cls]].push(pts);
}
// chain edges into longer polylines (join on shared endpoints) to cut overhead
function chain(lines) {
  const k = p => Math.round(p[0]) + ',' + Math.round(p[1]);
  const ends = new Map(); const used = new Uint8Array(lines.length);
  lines.forEach((l, i) => { for (const p of [l[0], l[l.length - 1]]) { const kk = k(p); if (!ends.has(kk)) ends.set(kk, []); ends.get(kk).push(i); } });
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue; used[i] = 1; let cur = lines[i].slice();
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const tail = cur[cur.length - 1]; const cand = (ends.get(k(tail)) || []).find(j => !used[j]);
        if (cand == null) break; used[cand] = 1; const l = lines[cand];
        cur = cur.concat(k(l[0]) === k(tail) ? l.slice(1) : l.slice(0, -1).reverse());
      }
      cur.reverse();
    }
    out.push(cur);
  }
  return out;
}
// keep only the parts of roads that run over urban AGEB tiles (they are painted on the tiles)
const HC = 600; const hgrid = new Map();
agebs.forEach((a, i) => { for (const poly of a.g) { const r = poly[0]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let k = 0; k < r.length; k += 2) { x0 = Math.min(x0, r[k]); x1 = Math.max(x1, r[k]); y0 = Math.min(y0, r[k + 1]); y1 = Math.max(y1, r[k + 1]); }
  for (let gx = Math.floor(x0 / HC); gx <= Math.floor(x1 / HC); gx++) for (let gy = Math.floor(y0 / HC); gy <= Math.floor(y1 / HC); gy++) { const k = gx + ',' + gy; if (!hgrid.has(k)) hgrid.set(k, []); hgrid.get(k).push(poly); } } });
function onTile(x, y) { for (const poly of hgrid.get(Math.floor(x / HC) + ',' + Math.floor(y / HC)) || []) { let ins = false; for (const r of poly) for (let a = 0, n = r.length, c = n - 2; a < n; c = a, a += 2) { const yi = r[a + 1], yj = r[c + 1]; if ((yi > y) !== (yj > y) && x < (r[c] - r[a]) * (y - yi) / (yj - yi) + r[a]) ins = !ins; } if (ins) return true; } return false; }
function clipToTiles(l) {
  const dense = []; for (let i = 0; i < l.length - 1; i++) { const [ax, ay] = l[i], [bx, by] = l[i + 1]; const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 40)); for (let k = 0; k < n; k++) dense.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]); } dense.push(l[l.length - 1]);
  const runs = []; let cur = null; for (const p of dense) { if (onTile(p[0], p[1])) { if (!cur) cur = []; cur.push(p); } else if (cur) { if (cur.length > 1) runs.push(cur); cur = null; } } if (cur && cur.length > 1) runs.push(cur); return runs;
}
const roadsOut = roads.map((ls, i) => chain(ls).flatMap(clipToTiles).map(l => dp(l, i === 0 ? 14 : 10)).filter(l => l.length > 1).map(l => l.flatMap(([x, y]) => [Math.round(x), Math.round(y)])));
log('roads', roadsOut.map(r => r.length + ' lines / ' + r.reduce((s, l) => s + l.length / 2, 0) + ' pts').join(' · '));

// ---------------------------------------------------------------- water bodies
const wbG = JSON.parse(fs.readFileSync(path.join(LABS, 'shared/hazard/water-bodies.geojson'), 'utf8'));
const water = [];
for (const f of wbG.features) {
  if ((f.properties.area_m2 || 0) < 15000) continue;
  for (const poly of polysOf(f.geometry)) {
    const r = poly[0].map(([lon, lat]) => W(lon, lat));
    if (!r.some(([x, y]) => inBox(x, y, 0))) continue;
    const s = dp(r, 8); if (s.length < 4) continue;
    water.push({ n: f.properties.name || null, t: f.properties.tipo || null, g: s.flatMap(([x, y]) => [Math.round(x), Math.round(y)]) });
  }
}
log('water bodies', water.length);

// ---------------------------------------------------------------- AGEB label image on sim-drenaje's Mercator data-image grid
let labels = null;
const statsPath = path.join(LABS, 'shared/hazard/modeled/sim-drenaje/stats.json');
if (fs.existsSync(statsPath)) {
  const st = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
  const mi = st.web?.mercatorImage;
  if (mi) {
    const IW = mi.width, IH = mi.height, b = mi.bounds;
    const X0 = mx(b.west), X1 = mx(b.east), Y0 = my(b.north), Y1 = my(b.south);
    const lab = new Uint16Array(IW * IH);
    const toPx = ([lon, lat]) => [(mx(lon) - X0) / (X1 - X0) * IW, (Y0 - my(lat)) / (Y0 - Y1) * IH];
    const byId = new Map(agebs.map((a, i) => [a.id, i]));
    for (const f of feats) {
      const idx = byId.get(f.properties.cvegeo); if (idx == null) continue;
      const edges = [];
      for (const poly of polysOf(f.geometry)) for (const ring of poly) { const r = ring.map(toPx); for (let i = 0, j = r.length - 1; i < r.length; j = i++) edges.push([r[j], r[i]]); }
      let v0 = Infinity, v1 = -Infinity; for (const [a] of edges) { v0 = Math.min(v0, a[1]); v1 = Math.max(v1, a[1]); }
      for (let v = Math.max(0, Math.floor(v0)); v <= Math.min(IH - 1, Math.ceil(v1)); v++) {
        const yc = v + 0.5; const xs = [];
        for (const [a, c] of edges) if ((a[1] > yc) !== (c[1] > yc)) xs.push(a[0] + (yc - a[1]) / (c[1] - a[1]) * (c[0] - a[0]));
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const u0 = Math.max(0, Math.ceil(xs[k] - 0.5)), u1 = Math.min(IW - 1, Math.floor(xs[k + 1] - 0.5));
          for (let u = u0; u <= u1; u++) lab[v * IW + u] = idx + 1;
        }
      }
    }
    const png = new PNG({ width: IW, height: IH, colorType: 2, inputHasAlpha: false });
    const buf = Buffer.alloc(IW * IH * 3);
    let n = 0; for (let i = 0; i < IW * IH; i++) { const L = lab[i]; if (L) n++; buf[i * 3] = L >> 8; buf[i * 3 + 1] = L & 255; }
    png.data = buf;
    fs.writeFileSync(path.join(OUT, 'labels.png'), PNG.sync.write(png, { colorType: 2, inputColorType: 2, inputHasAlpha: false, deflateLevel: 9 }));
    const wx = lon => mx(lon) - OX, wy = lat => my(lat) - OY;
    labels = { file: 'labels.png', width: IW, height: IH, bounds: b, world: { x0: wx(b.west), x1: wx(b.east), y0: wy(b.north), y1: wy(b.south) }, labelledPx: n, encoding: 'AGEB index + 1 = R*256 + G (0 = outside)' };
    log('labels.png', IW + 'x' + IH, 'labelled px', n);
  }
}

const board = {
  meta: {
    producer: 'invertir-3', created: new Date().toISOString(),
    projection: 'Web Mercator metres relative to origin (multiply by mScale for true metres)', origin: ORIGIN, mScale: +MSCALE.toFixed(6),
    worldBounds: wb.map(Math.round), coreBounds: core,
    sources: ['/labs/shared/infra/ageb-profile.geojson (infra-data: INEGI Censo 2020, CONAPO IMU 2020, DENUE, IMEPLAN MUI 2026, OSM, ESA WorldCover)', '/labs/shared/hazard/observed-imeplan-2026.geojson (IMEPLAN: Referencia text)', '/labs/shared/hazard/water-bodies.geojson (OSM)', '/labs/shared/router/data/graph.bin.gz (OSM roads)', 'OSM place nodes (jalisco-latest.osm.pbf 2026-10-29, via W10)'],
    note: 'AGEBs with population > 0 only. Geometry simplified (Douglas-Peucker 9 Mercator m). Colonia name = OSM place node inside the AGEB (colIn) or nearest within 700 m; approximate.',
    labels,
  },
  muns, agebs, roads: roadsOut, water, imeplan: imPts, ground,
};
const js = JSON.stringify(board);
fs.writeFileSync(path.join(OUT, 'board.json'), js);
log('board.json', (js.length / 1e6).toFixed(2), 'MB');
