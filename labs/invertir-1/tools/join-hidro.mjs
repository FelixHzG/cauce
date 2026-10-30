// Per-AGEB join of the sim-hidro 5 m rain-on-grid run (routing polygons of max depth) — invertir-1, runs on the VPS.
//   node tools/join-hidro.mjs [T10]
// Samples every AGEB on a ~25 m grid and tests each sample against the sim-hidro depth-class polygons
// (class 1 = 15–30 cm, 2 = 30–60 cm, 3 = > 60 cm). Output: data/ageb-hidro.json, same shape as the other joins:
//   { meta, agebs: { <cvegeo>: { share_ge15, share_ge30, share_ge60, samples, in_domain } } }
// Samples outside the simulated rectangle are ignored; AGEBs with < 50 % of samples inside get null.
// Approximation: the routing polygons are simplified by sim-hidro; small puddles may be missing.
import fs from 'node:fs';
import path from 'node:path';

const LABS = '/srv/contorno/data/guadalajara-flood-lab/labs';
const SC = process.argv[2] || 'T10';
const SRC = `${LABS}/shared/hazard/modeled/sim-hidro/${SC}/depth-classes.geojson`;
const META = '/srv/contorno/data/guadalajara-flood-lab/work/sim-hidro/domain-meta.json';
const OUT = `${LABS}/invertir-1/data/ageb-hidro.json`;
const rd = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const t0 = Date.now();

const agebs = rd(`${LABS}/invertir-1/data/agebs.json`).features;
const depth = rd(SRC).features;
let corners = null;
try { const m = rd(META).cornersLonLat; corners = [m.nw, m.ne, m.se, m.sw]; }
catch { const s = rd(`${LABS}/shared/hazard/modeled/sim-hidro/stats.json`); const b = s.domain.bboxLonLat; corners = [[b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]]; }

const rings = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
function inRing(x, y, r) { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
function inPolys(x, y, polys) { for (const poly of polys) { if (inRing(x, y, poly[0]) && !poly.slice(1).some(h => inRing(x, y, h))) return true; } return false; }
const bboxOf = polys => { const b = [1e9, 1e9, -1e9, -1e9]; for (const p of polys) for (const [x, y] of p[0]) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; } return b; };

// grid index of depth polygons
const C = 0.004, idx = new Map();
const dp = depth.map(f => { const polys = rings(f.geometry); return { cls: +f.properties.class, polys, b: bboxOf(polys) }; });
dp.forEach((d, k) => { for (let i = Math.floor(d.b[0] / C); i <= Math.floor(d.b[2] / C); i++) for (let j = Math.floor(d.b[1] / C); j <= Math.floor(d.b[3] / C); j++) { const key = i * 100000 + j; let a = idx.get(key); if (!a) idx.set(key, a = []); a.push(k); } });
function classAt(x, y) {
  const a = idx.get(Math.floor(x / C) * 100000 + Math.floor(y / C)); if (!a) return 0;
  let best = 0;
  for (const k of a) { const d = dp[k]; if (d.cls <= best || x < d.b[0] || x > d.b[2] || y < d.b[1] || y > d.b[3]) continue; if (inPolys(x, y, d.polys)) best = d.cls; }
  return best;
}
const inDomain = (x, y) => inRing(x, y, [...corners, corners[0]]);

const STEP_M = 25;
const out = {};
let nS = 0;
for (const f of agebs) {
  const polys = rings(f.geometry), b = bboxOf(polys);
  const lat = (b[1] + b[3]) / 2, dx = STEP_M / (111320 * Math.cos(lat * Math.PI / 180)), dy = STEP_M / 110540;
  let n = 0, nIn = 0, c1 = 0, c2 = 0, c3 = 0;
  for (let y = b[1] + dy / 2; y < b[3]; y += dy) for (let x = b[0] + dx / 2; x < b[2]; x += dx) {
    if (!inPolys(x, y, polys)) continue; n++;
    if (!inDomain(x, y)) continue; nIn++;
    const c = classAt(x, y); if (c >= 1) c1++; if (c >= 2) c2++; if (c >= 3) c3++;
  }
  nS += n;
  const id = f.properties.cvegeo;
  out[id] = n === 0 || nIn / n < 0.5 ? { samples: n, in_domain: n ? +(nIn / n).toFixed(2) : 0, share_ge15: null, share_ge30: null, share_ge60: null }
    : { samples: n, in_domain: +(nIn / n).toFixed(2), share_ge15: +(c1 / nIn).toFixed(4), share_ge30: +(c2 / nIn).toFixed(4), share_ge60: +(c3 / nIn).toFixed(4) };
}
const st = fs.statSync(SRC);
fs.writeFileSync(OUT, JSON.stringify({
  meta: {
    producer: 'invertir-1 (join of sim-hidro output)', generated: new Date().toISOString(), modeled: true, scenario: SC,
    source: `/labs/shared/hazard/modeled/sim-hidro/${SC}/depth-classes.geojson`, source_mtime: st.mtime.toISOString(),
    method: `AGEB polygons sampled every ${STEP_M} m; each sample tested against sim-hidro max-depth class polygons (15–30, 30–60, > 60 cm). Samples outside the simulated rectangle ignored; AGEBs with < 50 % of samples inside → null. Includes streets, yards and open ground; the routing polygons are simplified, so this is an approximation of the 5 m raster.`,
    fields: { share_ge15: 'share of AGEB samples with modelled max depth ≥ 15 cm', share_ge30: '≥ 30 cm', share_ge60: '≥ 60 cm', samples: 'samples inside the AGEB', in_domain: 'share of samples inside the simulated rectangle' },
  },
  agebs: out,
}));
console.log('wrote', OUT, fs.statSync(OUT).size, 'samples', nS, 'agebs', Object.keys(out).length, 'null', Object.values(out).filter(v => v.share_ge15 == null).length, 'sec', ((Date.now() - t0) / 1000).toFixed(1));
