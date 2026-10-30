// invertir-2 precompute (small, static-geometry joins; runs on the VPS in ~10 s).
// node build/prep.mjs
// Outputs (labs/invertir-2/data/):
//   sitios.json     one entry per IMEPLAN site (base id, e.g. SI-SLT-009): reference text, categories, centroid,
//                   sampled area and overlap area (m²) with each urban AGEB. Population and priority are joined
//                   at RUNTIME from the live ageb-profile.geojson, so only geometry is frozen here.
//   landmarks.json  named relief landmarks (OSM names) with elevation sampled from the INEGI 5 m DTM tiles.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const LABS = '/srv/contorno/data/guadalajara-flood-lab/labs';
const OUT = `${LABS}/invertir-2/data`;
const RAW = '/srv/contorno/data/guadalajara-flood-lab/work/invertir-2/raw';
fs.mkdirSync(OUT, { recursive: true });
const J = f => JSON.parse(fs.readFileSync(f, 'utf8'));

const ageb = J(`${LABS}/shared/infra/ageb-profile.geojson`);
const obs = J(`${LABS}/shared/hazard/observed-imeplan-2026.geojson`);
const places = J(`${RAW}/places.json`).elements;

// ---------- geometry helpers ----------
const rings = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
function pipRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const pipPoly = (x, y, poly) => { if (!pipRing(x, y, poly[0])) return false; for (let k = 1; k < poly.length; k++) if (pipRing(x, y, poly[k])) return false; return true; };
const pipGeom = (x, y, polys) => polys.some(p => pipPoly(x, y, p));
function bboxOf(polys) { let a = [180, 90, -180, -90]; for (const p of polys) for (const [x, y] of p[0]) { a[0] = Math.min(a[0], x); a[1] = Math.min(a[1], y); a[2] = Math.max(a[2], x); a[3] = Math.max(a[3], y); } return a; }

// ---------- AGEB grid index ----------
const CELL = 0.01;
const idx = new Map();
const A = ageb.features.map(f => ({ id: f.properties.cvegeo, polys: rings(f.geometry), bb: null }));
A.forEach(a => { a.bb = bboxOf(a.polys); for (let gx = Math.floor(a.bb[0] / CELL); gx <= Math.floor(a.bb[2] / CELL); gx++) for (let gy = Math.floor(a.bb[1] / CELL); gy <= Math.floor(a.bb[3] / CELL); gy++) { const k = gx + ',' + gy; if (!idx.has(k)) idx.set(k, []); idx.get(k).push(a); } });
function agebAt(x, y) {
  const c = idx.get(Math.floor(x / CELL) + ',' + Math.floor(y / CELL)); if (!c) return null;
  for (const a of c) if (x >= a.bb[0] && x <= a.bb[2] && y >= a.bb[1] && y <= a.bb[3] && pipGeom(x, y, a.polys)) return a.id;
  return null;
}

// ---------- IMEPLAN sites ----------
const base = n => String(n || '').split('/')[0].trim();
const sites = new Map();
for (const f of obs.features) {
  const p = f.properties, id = base(p.name); if (!id) continue;
  if (!sites.has(id)) sites.set(id, { id, polys: [], cats: new Set(), ref: null, rango: null, sistema: null, categoria: null, motivo: new Set(), altura: [] , expuesta: new Set() });
  const s = sites.get(id);
  if (f.geometry.type === 'Point') { s.ref = p.Referencia || s.ref; s.rango = p['Rango de alturas de inundación (cm)'] || s.rango; s.sistema = p['Sistema afectable'] || s.sistema; s.categoria = p['Categoría'] || s.categoria; s.pt = f.geometry.coordinates; }
  else { s.polys.push(...rings(f.geometry)); s.cats.add(p.category); if (p.Motivo) s.motivo.add(p.Motivo); if (p['Altura máxima reportada']) s.altura.push(p['Altura máxima reportada']); if (p['Infraestructura expuesta']) s.expuesta.add(p['Infraestructura expuesta']); }
}

// neighbourhood names (OSM place nodes)
const nb = places.filter(e => e.tags && e.tags.name).map(e => ({ name: e.tags.name, place: e.tags.place, x: e.lon, y: e.lat }));
const distM = (x1, y1, x2, y2) => { const kx = 111320 * Math.cos(y1 * Math.PI / 180), ky = 110574; return Math.hypot((x2 - x1) * kx, (y2 - y1) * ky); };

const STEP = 12; // metres between samples
const out = [];
for (const s of sites.values()) {
  if (!s.polys.length) continue;
  const bb = bboxOf(s.polys);
  const lat0 = (bb[1] + bb[3]) / 2;
  const dx = STEP / (111320 * Math.cos(lat0 * Math.PI / 180)), dy = STEP / 110574;
  const cellA = STEP * STEP;
  let n = 0, sx = 0, sy = 0; const ov = {};
  for (let y = bb[1] + dy / 2; y < bb[3]; y += dy) for (let x = bb[0] + dx / 2; x < bb[2]; x += dx) {
    if (!pipGeom(x, y, s.polys)) continue;
    n++; sx += x; sy += y;
    const a = agebAt(x, y); if (a) ov[a] = (ov[a] || 0) + cellA;
  }
  if (!n) { const r = s.polys[0][0]; sx = r[0][0]; sy = r[0][1]; n = 1; }
  const cx = sx / n, cy = sy / n;
  let best = null, bd = 1e9; for (const p of nb) { const d = distM(cx, cy, p.x, p.y); const pen = p.place === 'neighbourhood' || p.place === 'suburb' || p.place === 'quarter' ? 0 : 400; if (d + pen < bd) { bd = d + pen; best = p; } }
  out.push({
    id: s.id,
    mun: s.id.split('-')[1],
    categorias: [...s.cats],
    ref: s.ref, rango_cm: s.rango, sistema: s.sistema, categoria: s.categoria,
    motivo: [...s.motivo], altura_max_rep: s.altura.length ? Math.max(...s.altura.map(Number).filter(Number.isFinite)) : null,
    expuesta: [...s.expuesta],
    c: [+cx.toFixed(5), +cy.toFixed(5)],
    bbox: bb.map(v => +v.toFixed(5)),
    area_m2: Math.round(n * cellA),
    ageb_m2: Object.fromEntries(Object.entries(ov).map(([k, v]) => [k, Math.round(v)])),
    barrio: best && bd < 900 ? { name: best.name, place: best.place, dist_m: Math.round(bd) } : null,
  });
}
out.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(`${OUT}/sitios.json`, JSON.stringify({
  note: 'IMEPLAN MUI 2026 sites (polygons grouped by base id) with sampled overlap area per urban AGEB (12 m sample grid, point-in-polygon). Population/priority are joined at runtime from /labs/shared/infra/ageb-profile.geojson. barrio = nearest OSM place node (ODbL) within 900 m of the site centroid, for orientation only.',
  generated: new Date().toISOString(), sampleStep_m: STEP, sites: out,
}));
console.log('sitios', out.length, 'with ageb overlap', out.filter(s => Object.keys(s.ageb_m2).length).length);

// ---------- landmarks with INEGI DTM elevation ----------
const LM = [
  { id: 'primavera', name: 'Sierra de La Primavera', kind: 'sierra', ll: [-103.545, 20.595], peak: 'Cerro Planillas' },
  { id: 'colli', name: 'Cerro del Colli', kind: 'cerro', ll: [-103.4638, 20.6570] },
  { id: 'cuatro', name: 'Cerro del Cuatro', kind: 'cerro', ll: [-103.3631, 20.5995] },
  { id: 'reina', name: 'Cerro de la Reina', kind: 'cerro', ll: [-103.2396, 20.6335] },
  { id: 'viejo', name: 'Cerro Viejo', kind: 'cerro', ll: [-103.4359, 20.3642] },
  { id: 'huentitan', name: 'Barranca de Huentitán', kind: 'barranca', ll: [-103.2933, 20.7391] },
  { id: 'tepopote', name: 'Cerro del Tepopote', kind: 'cerro', ll: [-103.5667, 20.7421] },
  { id: 'gato', name: 'Cerro del Gato', kind: 'cerro', ll: [-103.3551, 20.4963] },
  { id: 'atemajac', name: 'Río Atemajac', kind: 'rio', ll: [-103.3781, 20.7118] },
  { id: 'sjd', name: 'San Juan de Dios (entubado)', kind: 'rio', ll: [-103.3367, 20.6984] },
  { id: 'pintas', name: 'Canal Las Pintas', kind: 'canal', ll: [-103.3253, 20.5401] },
  { id: 'ahogado', name: 'El Ahogado', kind: 'rio', ll: [-103.2201, 20.4956] },
  { id: 'centro', name: 'Centro de Guadalajara', kind: 'ciudad', ll: [-103.3496, 20.6767] },
  { id: 'juntas', name: 'Las Juntas', kind: 'barrio', ll: [-103.3391, 20.6067] },
];
const Z = 13;
const tileCache = new Map();
function tile(z, x, y) { const k = `${z}/${x}/${y}`; if (!tileCache.has(k)) { const f = `${LABS}/shared/terrain/dtm/${k}.png`; tileCache.set(k, fs.existsSync(f) ? PNG.sync.read(fs.readFileSync(f)) : null); } return tileCache.get(k); }
function elev(lon, lat) {
  const n = 2 ** Z; const xf = (lon + 180) / 360 * n; const yf = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
  const tx = Math.floor(xf), ty = Math.floor(yf); const t = tile(Z, tx, ty); if (!t) return null;
  const px = Math.min(255, Math.floor((xf - tx) * 256)), py = Math.min(255, Math.floor((yf - ty) * 256)); const i = (py * t.width + px) * 4;
  return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
}
// for peaks: max within ~300 m; for barrancas: min within ~600 m (the canyon floor)
for (const l of LM) {
  const r = l.kind === 'barranca' ? 0.006 : l.kind === 'sierra' || l.kind === 'cerro' ? 0.003 : 0;
  let best = elev(...l.ll), at = l.ll;
  for (let dy = -r; dy <= r; dy += 0.0003) for (let dx = -r; dx <= r; dx += 0.0003) {
    const e = elev(l.ll[0] + dx, l.ll[1] + dy); if (e == null) continue;
    if (l.kind === 'barranca' ? e < best : (l.kind === 'sierra' || l.kind === 'cerro') ? e > best : false) { best = e; at = [l.ll[0] + dx, l.ll[1] + dy]; }
  }
  l.elev_m = best == null ? null : Math.round(best);
  l.at = at.map(v => +v.toFixed(5));
}
fs.writeFileSync(`${OUT}/landmarks.json`, JSON.stringify({
  note: 'Names and approximate positions from OpenStreetMap (ODbL). elev_m sampled from the INEGI 5 m DTM web tiles (z13 ≈ 18 m px): highest pixel within ~300 m for peaks, lowest within ~600 m for barrancas, point value otherwise.',
  generated: new Date().toISOString(), landmarks: LM,
}, null, 1));
console.log(LM.map(l => `${l.name}: ${l.elev_m} m`).join('\n'));
