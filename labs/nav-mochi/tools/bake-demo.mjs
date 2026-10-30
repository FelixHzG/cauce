// Bake the ?demo=1 routes so filming never depends on a live router.
// Usage (from anywhere): node labs/nav-mochi/tools/bake-demo.mjs [fromLon,fromLat] [toLon,toLat]
// Uses the shared router module and every geojson hazard layer listed in /labs/shared/hazard/index.json.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const LABS = path.resolve(here, '../..');
const disk = u => path.join(LABS, u.replace(/^\/labs\//, ''));
const { buildHazards, plan, measure, pointAt, toLL, toM, project, exposure, avoidedSites } = await import(pathToFileURL(path.join(here, '../js/plan.js')));
const { loadRouter } = await import(pathToFileURL(disk('/labs/shared/router/router.js')));
const from = (process.argv[2] || '-103.3925,20.6743').split(',').map(Number), to = (process.argv[3] || '-103.3111,20.5218').split(',').map(Number);
const idx = JSON.parse(fs.readFileSync(disk('/labs/shared/hazard/index.json'), 'utf8'));
const layers = idx.layers.filter(l => l.type === 'geojson').map(meta => ({ meta, data: JSON.parse(fs.readFileSync(disk(meta.url), 'utf8')) }));
const hz = buildHazards(layers);
const rainIds = idx.layers.filter(l => ['observed', 'hotspot', 'water'].includes(l.kind)).map(l => l.id);
const router = await loadRouter();
const cache = new Map();
const A = await plan(router, from, to, hz, { cache, hazardIds: rainIds });
const N = measure(A.normal.coordinates), S = measure(A.safe.coordinates);
let sDiv = null; for (let s = 0; s < N.length; s += 10) { if (project(S, pointAt(N, s)).d > 25) { sDiv = s; break; } }
const sR = Math.max(400, (sDiv ?? 2000) - 350);
const P = toLL(pointAt(N, sR));
const B = await plan(router, P, to, hz, { cache, hazardIds: rainIds });
const out = {
  bakedAt: new Date().toISOString(), engine: router.engine, method: B.method, from, to,
  reroute: { s: sR, at: P, divergence_s: sDiv },
  normal: A.normal, safeFromStart: A.safe, safeFromReroute: B.safe,
  hazardLayers: rainIds, comparison: B.comparison || null
};
fs.writeFileSync(path.join(here, '../data/demo-route.json'), JSON.stringify(out));
const { routerCrossedIds, alignCrossed } = await import(pathToFileURL(path.join(here, '../js/plan.js')));
const ex = (r) => alignCrossed(exposure(r.coordinates, hz), routerCrossedIds(r)).crossed.map(e => `${e.h.id}${e.crit ? '*' : ''} ${e.h.ref}`);
console.log({ engine: out.engine, method: B.method, sDiv, sR, normal_km: A.normal.distance_m / 1000, safe2_km: B.safe.distance_m / 1000, normal_min: A.normal.duration_s / 60, safe2_min: B.safe.duration_s / 60 });
console.log('normal crosses', ex(A.normal)); console.log('safe2 crosses', ex(B.safe));
console.log('avoided', avoidedSites(B.exN, B.exS).map(e => e.h.ref));
