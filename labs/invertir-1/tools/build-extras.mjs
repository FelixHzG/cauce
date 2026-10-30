// Build data/ageb-extras.json for the invertir-1 prototype (runs on the VPS: small vector joins only).
//   node tools/build-extras.mjs
// Inputs (read-only):
//   /labs/shared/infra/ageb-profile.geojson            AGEB polygons + census/IMEPLAN fields (infra-data)
//   /labs/shared/hazard/observed-imeplan-2026.geojson   IMEPLAN MUI 2026 sitios, zonas críticas, points
//   /labs/shared/infra/exposure-facilities.geojson      DENUE schools/clinics/... points
//   work/infra-data/out/colonias-imc2020.geojson        CONAPO IMC 2020 colonia polygons (names)
//   work/invertir-1/osm-places.json, osm-resid.json     OSM place / named residential areas (Overpass, fallback names)
// Output: per-AGEB label point, reference name, IMEPLAN site details, facilities inside IMEPLAN polygons.
import fs from 'node:fs';
import path from 'node:path';

const LABS = '/srv/contorno/data/guadalajara-flood-lab/labs';
const WORK = '/srv/contorno/data/guadalajara-flood-lab/work';
const OUT = path.join(LABS, 'invertir-1/data/ageb-extras.json');
const rd = p => JSON.parse(fs.readFileSync(p, 'utf8'));

const agebs = rd(`${LABS}/shared/infra/ageb-profile.geojson`).features;
const imeplan = rd(`${LABS}/shared/hazard/observed-imeplan-2026.geojson`).features;
const facilities = rd(`${LABS}/shared/infra/exposure-facilities.geojson`).features;
const coloniasPath = `${WORK}/infra-data/out/colonias-imc2020.geojson`;
const colonias = fs.existsSync(coloniasPath) ? rd(coloniasPath).features : [];
const osm = [];
for (const f of ['osm-places.json', 'osm-resid.json']) {
  const p = `${WORK}/invertir-1/${f}`;
  if (!fs.existsSync(p)) continue;
  for (const e of rd(p).elements) {
    const c = e.type === 'node' ? [e.lon, e.lat] : e.center ? [e.center.lon, e.center.lat] : null;
    if (c && e.tags?.name) osm.push({ name: e.tags.name, kind: e.tags.place || e.tags.landuse || 'area', c });
  }
}

// ---------- geometry helpers (lon/lat, local equirectangular metres for distances)
const R = 6371008.8, LAT0 = 20.65 * Math.PI / 180, KX = R * Math.cos(LAT0) * Math.PI / 180, KY = R * Math.PI / 180;
const rings = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
function bboxOf(g) { let b = [1e9, 1e9, -1e9, -1e9]; for (const poly of rings(g)) for (const [x, y] of poly[0]) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); } return b; }
function inRing(x, y, r) { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
function inGeom(x, y, g) { for (const poly of rings(g)) { if (inRing(x, y, poly[0]) && !poly.slice(1).some(h => inRing(x, y, h))) return true; } return false; }
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; const l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); const qx = ax + t * dx - px, qy = ay + t * dy - py; return Math.hypot(qx, qy); }
function edgeDist(x, y, g) { let d = Infinity; for (const poly of rings(g)) for (const r of poly) for (let i = 1; i < r.length; i++) d = Math.min(d, segDist(x * KX, y * KY, r[i - 1][0] * KX, r[i - 1][1] * KY, r[i][0] * KX, r[i][1] * KY)); return d; }
// pole of inaccessibility (coarse grid + refinement)
function labelPoint(g, b) {
  let best = null, bd = -1; const N = 14;
  let [x0, y0, x1, y1] = b;
  for (let pass = 0; pass < 3; pass++) {
    const sx = (x1 - x0) / N, sy = (y1 - y0) / N;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = x0 + i * sx, y = y0 + j * sy;
      if (!inGeom(x, y, g)) continue;
      const d = edgeDist(x, y, g); if (d > bd) { bd = d; best = [x, y]; }
    }
    if (!best) break;
    x0 = best[0] - (x1 - x0) / 5; x1 = best[0] + (x1 - x0) / 5; y0 = best[1] - (y1 - y0) / 5; y1 = best[1] + (y1 - y0) / 5;
  }
  if (!best) { const r = rings(g)[0][0]; best = r.reduce((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]); }
  return best;
}
// simple grid index for polygons
function makeIndex(feats) {
  const C = 0.01, idx = new Map();
  feats.forEach((f, k) => { const b = f._b; for (let i = Math.floor(b[0] / C); i <= Math.floor(b[2] / C); i++) for (let j = Math.floor(b[1] / C); j <= Math.floor(b[3] / C); j++) { const key = i + ',' + j; if (!idx.has(key)) idx.set(key, []); idx.get(key).push(k); } });
  return (x, y) => (idx.get(Math.floor(x / C) + ',' + Math.floor(y / C)) || []).filter(k => { const b = feats[k]._b; return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && inGeom(x, y, feats[k].geometry); });
}

for (const f of [...agebs, ...colonias]) f._b = bboxOf(f.geometry);
const imePolys = imeplan.filter(f => f.geometry.type !== 'Point');
for (const f of imePolys) f._b = bboxOf(f.geometry);
const findColonia = makeIndex(colonias);
const findImePoly = makeIndex(imePolys);
const findAgeb = makeIndex(agebs);

const tidy = s => String(s || '').replace(/\s+/g, ' ').trim();
const titleCase = s => {
  const small = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'en', 'a']);
  const t = tidy(s).toLowerCase().replace(/(^|[\s\-(/])([a-záéíóúñü])/g, (m, a, b) => a + b.toUpperCase());
  return t.split(' ').map((w, i) => i && small.has(w.toLowerCase()) ? w.toLowerCase() : w).join(' ').replace(/\b(Ii|Iii|Iv|Vi|Vii)\b/g, m => m.toUpperCase());
};

// ---------- IMEPLAN details by site id
const site = new Map();
const baseId = n => String(n || '').split('/')[0];
for (const f of imeplan) {
  const p = f.properties, id = baseId(p.name);
  if (!site.has(id)) site.set(id, { id });
  const s = site.get(id);
  if (f.geometry.type === 'Point') { s.ref = tidy(p.Referencia); s.cat = tidy(p['Categoría']); s.rango = tidy(p['Rango de alturas de inundación (cm)']); s.sistema = tidy(p['Sistema afectable']); s.pt = f.geometry.coordinates; }
  else if (p.category === 'Zonas Criticas') { (s.zonas ||= []).push({ motivo: tidy(p.Motivo), infra: tidy(p['Infraestructura expuesta']), altura: +p['Altura máxima reportada'] || null }); }
  else { s.regimen = tidy(p['Régimen']); s.rango = s.rango || tidy(p['Rango de alturas de inundación']); s.sistema = s.sistema || tidy(p['Sistema afectable']); }
}

// ---------- facilities inside IMEPLAN polygons, counted per AGEB (DENUE key, PIP fallback)
const FAC_KINDS = ['escuela', 'guarderia', 'hospital', 'clinica', 'residencia_cuidado'];
const facIn = {};
for (const f of facilities) {
  const k = f.properties.kind; if (!FAC_KINDS.includes(k)) continue;
  const [x, y] = f.geometry.coordinates;
  if (!findImePoly(x, y).length) continue;
  let a = f.properties.ageb;
  if (!a || !agebs.some(g => g.properties.cvegeo === a)) { const hit = findAgeb(x, y)[0]; a = hit != null ? agebs[hit].properties.cvegeo : null; }
  if (!a) continue;
  (facIn[a] ||= {})[k] = (facIn[a][k] || 0) + 1;
}

// ---------- per-AGEB names
const out = {};
let named = { colonia: 0, osm: 0, none: 0 };
for (const f of agebs) {
  const p = f.properties, g = f.geometry, b = f._b;
  const lp = labelPoint(g, b);
  // colonia share by sampling ~120 points inside the AGEB
  const counts = new Map(); let n = 0; const S = 12;
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
    const x = b[0] + (i + 0.5) * (b[2] - b[0]) / S, y = b[1] + (j + 0.5) * (b[3] - b[1]) / S;
    if (!inGeom(x, y, g)) continue; n++;
    for (const k of findColonia(x, y)) counts.set(k, (counts.get(k) || 0) + 1);
  }
  if (!n) for (const k of findColonia(lp[0], lp[1])) counts.set(k, 1), n = 1;
  const cols = [...counts.entries()].sort((a, c) => c[1] - a[1]).map(([k, c]) => ({ name: titleCase(colonias[k].properties.colonia), share: +(c / n).toFixed(2), clasif: colonias[k].properties.clasif }))
    .filter((c, i, arr) => c.name && arr.findIndex(d => d.name === c.name) === i);
  let name = null, nameSrc = null;
  if (cols.length && cols[0].share >= 0.15) { name = cols[0].name; nameSrc = 'conapo'; named.colonia++; }
  else {
    let best = null, bd = 1500;
    for (const o of osm) { const d = Math.hypot((o.c[0] - lp[0]) * KX, (o.c[1] - lp[1]) * KY); if (d < bd) { bd = d; best = o; } }
    if (best) { name = tidy(best.name); nameSrc = 'osm'; named.osm++; } else named.none++;
  }
  const ids = String(p.imeplan_ids || '').split(/\s+/).filter(Boolean);
  const sites = ids.map(id => site.get(baseId(id))).filter(Boolean).map(s => ({ id: s.id, ref: s.ref || null, cat: s.cat || null, rango: s.rango || null, regimen: s.regimen || null, sistema: s.sistema || null, zonas: s.zonas || null }));
  out[p.cvegeo] = {
    lp: lp.map(v => +v.toFixed(5)),
    name, nameSrc,
    cols: cols.slice(0, 4).map(c => [c.name, c.share]),
    sites: sites.length ? sites : undefined,
    facIn: facIn[p.cvegeo],
  };
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  meta: {
    producer: 'invertir-1', generated: new Date().toISOString(),
    fields: {
      lp: 'label point [lon,lat] (pole of inaccessibility of the simplified AGEB polygon)',
      name: 'reference name: CONAPO IMC 2020 colonia covering the largest share of the AGEB (>=15%), else nearest OSM place/residential name within 1.5 km',
      cols: 'CONAPO colonias overlapping the AGEB [name, share of sampled points]',
      sites: 'IMEPLAN MUI 2026 sites touching the AGEB (from ageb-profile imeplan_ids): point Referencia, categoría, rango de alturas (cm), régimen, critical-zone motivo/infraestructura/altura máxima reportada',
      facIn: 'DENUE facilities (escuela, guarderia, hospital, clinica, residencia_cuidado) located inside an IMEPLAN sitio/zona polygon, by AGEB',
    },
    sources: ['INEGI Marco Geoestadístico 2020 via infra-data ageb-profile', 'CONAPO Índice de marginación por colonia 2020 (names)', 'OpenStreetMap place/landuse names (ODbL, Overpass 2026-10-30)', 'IMEPLAN MUI 2026', 'INEGI DENUE'],
    named,
  },
  agebs: out,
}));
console.log('wrote', OUT, fs.statSync(OUT).size, named, 'facIn agebs', Object.keys(facIn).length);

// ---------- compact runtime copy of the AGEB profile (Caddy gzips .json but not .geojson: 5 MB → ~0.7 MB on the wire).
// The app loads this first and HEAD-checks the shared file; if the shared profile is newer it loads that instead.
{
  const src = `${LABS}/shared/infra/ageb-profile.geojson`;
  const g = rd(src);
  const r = a => typeof a[0] === 'number' ? [+a[0].toFixed(5), +a[1].toFixed(5)] : a.map(r);
  const dedupe = ring => ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]);
  for (const f of g.features) {
    f.geometry.coordinates = r(f.geometry.coordinates);
    f.geometry.coordinates = f.geometry.type === 'Polygon' ? f.geometry.coordinates.map(dedupe) : f.geometry.coordinates.map(p => p.map(dedupe));
  }
  const st = fs.statSync(src);
  g.metadata = { ...(g.metadata || {}), __copy: { of: '/labs/shared/infra/ageb-profile.geojson', source_mtime: st.mtime.toISOString(), source_size: st.size, copied: new Date().toISOString(), note: 'invertir-1 compact copy: coordinates rounded to 1e-5 deg; properties unchanged' } };
  const outP = path.join(LABS, 'invertir-1/data/agebs.json');
  fs.writeFileSync(outP, JSON.stringify(g));
  console.log('wrote', outP, fs.statSync(outP).size, 'source mtime', st.mtime.toISOString());
}
