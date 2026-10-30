// Node test for the cauce. router: demo route + N random OD pairs, fastest vs safe, invariants + timing,
// optional cross-check of distances against the public OSRM demo server.
// Usage: node route-test.mjs [routerDir=../shared/router] [--pairs 12] [--seed 7] [--osrm] [--out results.json]
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2); const flag = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const dir = argv[0] && !argv[0].startsWith('--') ? path.resolve(argv[0]) : path.resolve(here, '../shared/router');
const entry = fs.existsSync(path.join(dir, 'router.next.js')) && argv.includes('--next') ? 'router.next.js' : 'router.js';
const { loadRouter } = await import(pathToFileURL(path.join(dir, entry)).href);
const PAIRS = +flag('--pairs', 12), SEED = +flag('--seed', 7), OSRM = argv.includes('--osrm'), OUT = flag('--out', null);
const URBAN = [-103.55, 20.43, -103.18, 20.85];
let s = SEED >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const hav = (a, b) => { const R = 6371008.8, r = Math.PI / 180; const x = Math.sin((b[1] - a[1]) * r / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin((b[0] - a[0]) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const pt = () => [+(URBAN[0] + rnd() * (URBAN[2] - URBAN[0])).toFixed(5), +(URBAN[1] + rnd() * (URBAN[3] - URBAN[1])).toFixed(5)];
const t0 = performance.now(); const router = await loadRouter(); const loadMs = performance.now() - t0;
// random OD pairs inside the urban bbox, kept only when both points are on the street network (<= 150 m from a road,
// like a user's click); points in forest/fields are resampled and counted.
const cases = [{ name: 'demo: Glorieta Minerva → Aeropuerto GDL', from: [-103.3925, 20.6743], to: [-103.3111, 20.5218] }];
let resampled = 0;
const onNet = async () => { for (;;) { const p = pt(); const s = await router.nearest(p); if (s && s.distance_m <= 150) return p; resampled++; } };
while (cases.length < PAIRS + 1) { const a = await onNet(), b = await onNet(); if (hav(a, b) > 3000) cases.push({ name: 'random ' + cases.length, from: a, to: b }); }
console.log(`engine ${router.engine} thread=${router.thread} load ${loadMs.toFixed(0)} ms (${entry})`);
const HZ = flag('--ids', 'all'); const hz = HZ === 'all' ? 'all' : HZ.split(','); // 'all' = every index layer without router.default:false
const failures = []; const results = [];
const check = (c, cond, msg) => { if (!cond) failures.push(`${c.name}: ${msg}`); return cond; };
for (const c of cases) {
  let n, r;
  try {
    const t1 = performance.now(); n = await router.route(c.from, c.to); const tn = performance.now() - t1;
    const t2 = performance.now(); r = await router.route(c.from, c.to, { hazardIds: hz, compare: true }); const ts = performance.now() - t2;
    if (c === cases[0]) console.log('      hazard layers used:', r.hazards.used.join(', '), r.hazards.missing.length ? '| missing: ' + r.hazards.missing.map(m => m.id).join(', ') : '');
    const kmh = n.distance_m / n.duration_s * 3.6;
    const sumSteps = n.steps.reduce((a, st) => a + st.distance_m, 0);
    check(c, n.coordinates.length >= 2, 'no coordinates');
    check(c, n.steps[0].type === 'depart' && n.steps.at(-1).type === 'arrive', 'steps must start with depart and end with arrive');
    check(c, Math.abs(sumSteps - n.distance_m) <= Math.max(5, n.distance_m * 0.01), `step distances ${sumSteps.toFixed(0)} != ${n.distance_m}`);
    check(c, kmh > 8 && kmh < 90, `average speed ${kmh.toFixed(1)} km/h`);
    check(c, n.snapped.from.distance_m < 2500 && n.snapped.to.distance_m < 2500, 'snap too far');
    check(c, r.mode === 'safe' && r.safe && r.normal && r.comparison, 'compare output missing');
    check(c, r.safe.duration_s >= r.normal.duration_s - 1, `safe faster than fastest (${r.safe.duration_s} < ${r.normal.duration_s})`);
    check(c, Math.abs(r.normal.distance_m - n.distance_m) < 1, 'compare.normal differs from fastest route');
    check(c, r.comparison.crossed_safe <= r.comparison.crossed_normal || r.blocked_fallback, `safe crosses more hazards (${r.comparison.crossed_safe} > ${r.comparison.crossed_normal})`);
    const critS = r.crossed.filter(x => x.critical && x.multiplier === 'block');
    check(c, r.block_critical === true && (critS.length === 0 || r.blocked_fallback), `safe route crosses ${critS.length} blocked critical features without fallback`);
    check(c, tn < 1000 && ts < 1500, `slow: fastest ${tn.toFixed(0)} ms, safe+compare ${ts.toFixed(0)} ms`);
    check(c, n.steps.every(st => typeof st.instruction === 'string' && st.instruction.length > 3 && Array.isArray(st.location)), 'bad step');
    let osrm = null;
    if (OSRM) {
      try {
        const u = `https://router.project-osrm.org/route/v1/driving/${c.from.join(',')};${c.to.join(',')}?overview=false`;
        const j = await (await fetch(u)).json(); osrm = { distance_m: Math.round(j.routes[0].distance), duration_s: Math.round(j.routes[0].duration) };
        check(c, Math.abs(n.distance_m / osrm.distance_m - 1) < 0.35, `distance ${n.distance_m.toFixed(0)} vs OSRM ${osrm.distance_m}`);
        await new Promise(res => setTimeout(res, 1100));
      } catch (e) { osrm = { error: String(e.message || e) }; }
    }
    const row = { name: c.name, from: c.from, to: c.to, straight_m: Math.round(hav(c.from, c.to)), fastest: { distance_m: Math.round(n.distance_m), duration_s: Math.round(n.duration_s), steps: n.steps.length, ms: Math.round(tn), settled: n.settled },
      safe: { distance_m: Math.round(r.distance_m), duration_s: Math.round(r.duration_s), ms: Math.round(ts), avoided: r.avoided.length, exposure: r.exposure.length, crossed: r.crossed.length, crossed_imeplan: r.crossed.filter(x => x.layer === 'observed-imeplan-2026').map(x => x.properties.name || x.id), crossed_critical: critS.length, fallback: r.blocked_fallback }, comparison: r.comparison, osrm, warnings: r.warnings };
    results.push(row);
    console.log(`${c.name.padEnd(42)} fastest ${(n.distance_m / 1000).toFixed(1)} km ${(n.duration_s / 60).toFixed(1)} min ${tn.toFixed(0)} ms | safe +${r.comparison.extra_distance_m} m +${r.comparison.extra_duration_s} s ${ts.toFixed(0)} ms, crossed ${r.comparison.crossed_normal}→${r.comparison.crossed_safe}, avoided ${r.avoided.length}${osrm && osrm.distance_m ? ` | OSRM ${(osrm.distance_m / 1000).toFixed(1)} km ${(osrm.duration_s / 60).toFixed(1)} min` : ''}`);
    if (c === cases[0]) { console.log('      safe crosses IMEPLAN:', JSON.stringify(r.crossed.filter(x => x.layer === 'observed-imeplan-2026').map(x => `${x.properties.name} ${x.properties.category} ${x.label}`)), 'fallback', r.blocked_fallback); for (const st of r.steps) console.log(`      ${String(Math.round(st.distance_m)).padStart(6)} m  ${st.instruction}`); console.log('      avoided:', r.avoided.map(a => `${a.layer}:${a.label}`).join(' | ')); }
  } catch (e) {
    if (e.code === 'OUT_OF_AREA') { console.log(`${c.name.padEnd(42)} skipped: ${e.message}`); results.push({ name: c.name, from: c.from, to: c.to, skipped: e.message }); continue; }
    failures.push(`${c.name}: ${e.stack || e}`);
  }
}
const ok = results.filter(r => r.fastest);
const med = a => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
const withOsrm = ok.filter(r => r.osrm && r.osrm.distance_m);
const summary = { engine: router.engine, thread: router.thread, seed: SEED, load_ms: Math.round(loadMs), routes: ok.length, skipped: results.length - ok.length, resampled_offnetwork_points: resampled,
  osrm_ratio: withOsrm.length ? { distance_median: +med(withOsrm.map(r => r.fastest.distance_m / r.osrm.distance_m)).toFixed(3), duration_median: +med(withOsrm.map(r => r.fastest.duration_s / r.osrm.duration_s)).toFixed(3) } : null,
  fastest_ms: { median: med(ok.map(r => r.fastest.ms)), max: Math.max(...ok.map(r => r.fastest.ms)) }, safe_compare_ms: { median: med(ok.map(r => r.safe.ms)), max: Math.max(...ok.map(r => r.safe.ms)) },
  failures };
console.log(JSON.stringify(summary, null, 1));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, results }, null, 1));
router.close && router.close();
process.exit(failures.length ? 1 : 0);
