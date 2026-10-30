// nav-juguete: extract Overture building footprints for the toy-town corridor, attach a height from the
// INEGI 5 m nDSM (DSM - DTM mosaic produced by the terrain agent), and cut MVT tiles (z13-15) for MapLibre.
// Inputs are read-only products of the terrain agent on W10. Output: .\tiles\{z}\{x}\{y}.pbf + .\buildings-meta.json
// Usage: node buildings.mjs [bbox=-103.44,20.60,-103.29,20.73]
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import proj4 from 'proj4';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

const BBOX = (process.argv[2] || '-103.44,20.60,-103.29,20.73').split(',').map(Number);
const TERR = 'C:/Users/Felip/contorno-compute/labs/terrain';
const SRC = `${TERR}/buildings/overture-buildings.geojsonl`;
const NDSM = `${TERR}/out/ndsm-5m.f32`;
const DTM = `${TERR}/out/dtm-5m.f32`;
const G = { ox: 629900, oy: 2323400, w: 14760, h: 16760, c: 5 }; // EPSG:6368, origin = top-left corner
const OUT = 'tiles';
const utm = proj4('+proj=utm +zone=13 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs');
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// --- read the nDSM window covering the bbox -------------------------------------------------------------
const corners = [[BBOX[0], BBOX[1]], [BBOX[0], BBOX[3]], [BBOX[2], BBOX[1]], [BBOX[2], BBOX[3]]].map(p => utm.forward(p));
const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
const c0 = Math.max(0, Math.floor((Math.min(...xs) - G.ox) / G.c) - 4), c1 = Math.min(G.w - 1, Math.ceil((Math.max(...xs) - G.ox) / G.c) + 4);
const r0 = Math.max(0, Math.floor((G.oy - Math.max(...ys)) / G.c) - 4), r1 = Math.min(G.h - 1, Math.ceil((G.oy - Math.min(...ys)) / G.c) + 4);
const W = c1 - c0 + 1, H = r1 - r0 + 1;
function readWindow(file) {
  const fd = fs.openSync(file, 'r'); const out = new Float32Array(W * H); const row = Buffer.alloc(W * 4);
  for (let r = 0; r < H; r++) { fs.readSync(fd, row, 0, W * 4, ((r0 + r) * G.w + c0) * 4); out.set(new Float32Array(row.buffer, row.byteOffset, W), r * W); }
  fs.closeSync(fd); return out;
}
const ndsm = readWindow(NDSM);
log(`nDSM window ${W}x${H} (cols ${c0}-${c1}, rows ${r0}-${r1})`);
{ // sanity: DTM at two known points should be ~1590 m (Minerva) and ~1565 m (Catedral)
  const dtm = readWindow(DTM);
  for (const [n, p] of [['Minerva', [-103.3925, 20.6743]], ['Catedral', [-103.3467, 20.6770]]]) {
    const [x, y] = utm.forward(p); const c = Math.floor((x - G.ox) / G.c) - c0, r = Math.floor((G.oy - y) / G.c) - r0;
    log(`DTM ${n}: ${dtm[r * W + c].toFixed(1)} m, nDSM ${ndsm[r * W + c].toFixed(1)} m`);
  }
}
const cell = (x, y) => { const c = Math.floor((x - G.ox) / G.c) - c0, r = Math.floor((G.oy - y) / G.c) - r0; return (c < 0 || r < 0 || c >= W || r >= H) ? NaN : ndsm[r * W + c]; };

function pip(x, y, ring) { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; }
function areaOf(ring) { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]); return Math.abs(a / 2); }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// --- stream buildings ---------------------------------------------------------------------------------
const feats = [], areas = [];
let seen = 0, kept = 0, fromTag = 0, fromNdsm = 0, floored = 0;
const hist = new Array(13).fill(0);
const rl = readline.createInterface({ input: fs.createReadStream(SRC, { highWaterMark: 1 << 22 }), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue; seen++;
  // cheap prefilter on the first coordinate before JSON.parse
  const m = /"coordinates":\[\[\[\[?(-?[\d.]+),(-?[\d.]+)/.exec(line); if (!m) continue;
  const lon = +m[1], lat = +m[2];
  if (lon < BBOX[0] - 0.01 || lon > BBOX[2] + 0.01 || lat < BBOX[1] - 0.01 || lat > BBOX[3] + 0.01) continue;
  const f = JSON.parse(line); if (f.properties?.is_underground) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
  for (const poly of polys) {
    const outer = poly[0]; let cx = 0, cy = 0; for (const p of outer) { cx += p[0]; cy += p[1]; } cx /= outer.length; cy /= outer.length;
    if (cx < BBOX[0] || cx > BBOX[2] || cy < BBOX[1] || cy > BBOX[3]) continue;
    const ring = outer.map(p => utm.forward(p)); const area = areaOf(ring);
    let h, src;
    const tag = Number(f.properties.height);
    if (Number.isFinite(tag) && tag > 0) { h = tag; src = 'o'; fromTag++; }
    else {
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const [x, y] of ring) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
      const vals = [];
      for (let x = Math.floor(minx / 5) * 5 + 2.5; x <= maxx; x += 5) for (let y = Math.floor(miny / 5) * 5 + 2.5; y <= maxy; y += 5) if (pip(x, y, ring)) { const v = cell(x, y); if (Number.isFinite(v)) vals.push(v); }
      if (!vals.length) { const [ux, uy] = utm.forward([cx, cy]); const v = cell(ux, uy); if (Number.isFinite(v)) vals.push(v); }
      vals.sort((a, b) => a - b); const p75 = vals.length ? vals[Math.floor((vals.length - 1) * 0.5)] : 0; // median (robust to partial tree canopy)
      h = p75; src = 'n'; fromNdsm++;
    }
    if (h < 3) { h = 3; src += 'm'; floored++; }
    h = Math.min(h, 120);
    hist[Math.min(12, Math.floor(h / 5))]++;
    feats.push({ type: 'Feature', properties: { h: Math.round(h * 2) / 2, k: hash(f.id) % 8, s: src }, geometry: { type: 'Polygon', coordinates: poly } }); areas.push(area);
    kept++;
  }
  if (seen % 200000 === 0) log(`scanned ${seen}, kept ${kept}`);
}
log(`scanned ${seen}; kept ${kept} (height tag ${fromTag}, nDSM ${fromNdsm}, floored to 3 m ${floored})`);
log('height histogram (5 m bins):', hist.join(' '));

// --- tiles ---------------------------------------------------------------------------------------------
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);
const zooms = { 13: 120, 14: 30, 15: 0 }; // min footprint area (m2) per zoom
let bytes = 0, tiles = 0;
fs.rmSync(OUT, { recursive: true, force: true });
for (const [zs, minA] of Object.entries(zooms)) {
  const z = +zs;
  const index = geojsonvt({ type: 'FeatureCollection', features: feats.filter((f, i) => areas[i] >= minA) }, { maxZoom: z, indexMaxZoom: Math.min(z, 10), indexMaxPoints: 0, tolerance: z === 15 ? 1.5 : 3, extent: 4096, buffer: 32 });
  for (let x = lon2x(BBOX[0], z); x <= lon2x(BBOX[2], z); x++) for (let y = lat2y(BBOX[3], z); y <= lat2y(BBOX[1], z); y++) {
    const t = index.getTile(z, x, y); if (!t || !t.features.length) continue;
    const buf = vtpbf.fromGeojsonVt({ buildings: t }, { version: 2 });
    fs.mkdirSync(path.join(OUT, `${z}`, `${x}`), { recursive: true }); fs.writeFileSync(path.join(OUT, `${z}`, `${x}`, `${y}.pbf`), buf);
    bytes += buf.length; tiles++;
  }
  log(`z${z}: cumulative ${tiles} tiles, ${(bytes / 1e6).toFixed(1)} MB`);
}
fs.writeFileSync('buildings-meta.json', JSON.stringify({
  bbox: BBOX, minzoom: 13, maxzoom: 15, layer: 'buildings', count: kept, fromHeightTag: fromTag, fromNdsm, flooredTo3m: floored,
  heightRule: 'Overture height tag when present; else median of INEGI 5 m nDSM (DSM-DTM, includes trees) inside footprint; min 3 m, max 120 m',
  footprints: 'Overture Maps buildings release ' + JSON.parse(fs.readFileSync(`${SRC}.state`, 'utf8')).last_release + ' (Google Open Buildings, Microsoft, OSM, ...)',
  ndsm: NDSM + ' (terrain agent, ' + fs.statSync(NDSM).mtime.toISOString() + ')', generated: new Date().toISOString(), bytes, tiles,
}, null, 1));
log('done');
