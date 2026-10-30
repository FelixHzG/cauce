// cauce. nav-mochi v2 — kawaii flood-aware navigation. The page opens already driving (demo trip on a loop).
// Everything on screen is a pure function of timeline time t, so ?demo=1&capture=1 + window.__cauceDemo.seek(t)
// renders frames deterministically.
import { mochiStyle, makePatterns } from './style.js';
import { buildHazards, plan, measure, pointAt, toLL, toM, project, exposure, avoidedSites, routerCrossedIds, alignCrossed } from './plan.js';
import { createCar } from './car.js';
import { stickerSVG, badgeSVG, gotitaSVG, parseStep, arrowSVG, fmtKm, fmtMin, fmtClock, esc, hazardLines, hazardSrc, STK } from './ui.js';

const Q = new URLSearchParams(location.search);
const DEMO = Q.has('demo') && Q.get('demo') !== '0';        // hides the destination picker
const CAPTURE = Q.has('capture');                              // no autoplay; frames via __cauceDemo.seek
const $ = id => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, u) => a + (b - a) * u;
const ease = u => { u = clamp(u, 0, 1); return u * u * u * (u * (u * 6 - 15) + 10); };
const isPhone = () => innerWidth <= 700;
if (DEMO) document.body.classList.add('demo');
$('boot-g').innerHTML = gotitaSVG();
$('gotita').innerHTML = gotitaSVG();

const TRIP = { from: [-103.3925, 20.6743], to: [-103.3111, 20.5218], fromName: 'Glorieta Minerva', toName: 'Aeropuerto GDL' };
const DEMO_DEPART = new Date(2026, 5, 18, 18, 10); // decorative clock: a June storm afternoon
// Curated layers (no per-layer UI): IMEPLAN observed sites + OSM underpasses (alerts + routing), OSM water (routing only).
const CURATED = ['observed-imeplan-2026', 'underpasses', 'water-bodies'];
const HEAT_URL = './data/riesgo-modelado.geojson'; // derived from sim-drenaje ensemble frequency (tools/make-heat.mjs)

// ------------------------------------------------------------------------------------------- demo API
let resolveReady; const ready = new Promise(r => resolveReady = r);
let demoTimeline = null, timeline = null, timelineT = 0;
window.__cauceDemo = { duration_s: 40, ready, async seek(t) { await ready; playing = false; renderAt(demoTimeline, t); await settle(); return true; } };

// ------------------------------------------------------------------------------------------- map
const map = new maplibregl.Map({
  container: 'map', style: mochiStyle(), center: TRIP.from, zoom: 16, pitch: 60, bearing: 100,
  maxPitch: 78, attributionControl: false, fadeDuration: 0, canvasContextAttributes: { antialias: true }
});
const car = createCar(maplibregl);
const mapLoaded = new Promise(r => map.on('load', r));
let HZ = { list: [], near: () => new Set() }, rainLayers = CURATED, router = null, routerEngine = 'cauce-router';
const hazLayers = []; // {id, prop, max}

async function loadHazards() {
  let idx = { layers: [] };
  try { idx = await (await fetch('/labs/shared/hazard/index.json', { cache: 'no-cache' })).json(); } catch (e) { console.warn('hazard index', e); }
  const metas = (idx.layers || []).filter(l => CURATED.includes(l.id));
  rainLayers = metas.map(l => l.id);
  return Promise.all(metas.filter(m => m.kind !== 'water' && m.type === 'geojson').map(async meta => {
    try { const r = await fetch(meta.url); return { meta, data: r.ok ? await r.json() : null }; } catch { return { meta, data: null }; }
  }));
}

function addLayers(layers) {
  const imeplan = layers.find(l => /imeplan/.test(l.meta.id) && l.data);
  // modeled risk heatmap (lavender -> pink), under the roads
  map.addSource('heat', { type: 'geojson', data: HEAT_URL });
  map.addLayer({ id: 'heat', type: 'heatmap', source: 'heat', paint: {
    'heatmap-weight': ['interpolate', ['linear'], ['get', 'w'], 0, 0, 1, 1],
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 11, 0.55, 14, 0.9, 17, 1.3],
    'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 10, 4, 13, 16, 15, 60, 17, 230],
    'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(205,184,255,0)', 0.12, 'rgba(205,184,255,0.38)', 0.35, 'rgba(214,170,255,0.55)', 0.6, 'rgba(240,160,235,0.66)', 0.85, 'rgba(255,143,200,0.74)', 1, 'rgba(255,111,174,0.82)'],
    'heatmap-opacity': 0 } }, 'road-case');
  hazLayers.push({ id: 'heat', prop: 'heatmap-opacity', max: 0.9 });
  if (imeplan) {
    map.addSource('imeplan', { type: 'geojson', data: imeplan.data });
    const site = ['==', ['get', 'category'], 'Sitios Inundales'], crit = ['==', ['get', 'category'], 'Zonas Criticas'];
    map.addLayer({ id: 'im-site', type: 'fill', source: 'imeplan', filter: site, paint: { 'fill-color': '#ff8caf', 'fill-opacity': 0 } }, 'road-label');
    map.addLayer({ id: 'im-crit', type: 'fill', source: 'imeplan', filter: crit, paint: { 'fill-pattern': 'pat-stripes', 'fill-opacity': 0 } }, 'road-label');
    map.addLayer({ id: 'im-line', type: 'line', source: 'imeplan', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': '#ff5c8d', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2.6], 'line-dasharray': [2, 1.3], 'line-opacity': 0 } }, 'road-label');
    hazLayers.push({ id: 'im-site', prop: 'fill-opacity', max: 0.14 }, { id: 'im-crit', prop: 'fill-opacity', max: 0.55 }, { id: 'im-line', prop: 'line-opacity', max: 0.9 });
  }
  // routes
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource('r-normal', { type: 'geojson', data: empty, lineMetrics: true });
  map.addSource('r-drive', { type: 'geojson', data: empty, lineMetrics: true });
  const L = { 'line-cap': 'round', 'line-join': 'round' };
  const w = (a, b) => ['interpolate', ['exponential', 1.5], ['zoom'], 10, a, 16, b];
  map.addLayer({ id: 'rn-dots-case', type: 'line', source: 'r-normal', layout: L, paint: { 'line-color': '#ffffff', 'line-width': w(7, 19), 'line-opacity': 0 } }, 'road-label');
  map.addLayer({ id: 'rn-dots', type: 'line', source: 'r-normal', layout: L, paint: { 'line-color': '#8a6fd1', 'line-width': w(5, 12), 'line-dasharray': [0.01, 1.7], 'line-opacity': 0 } }, 'road-label');
  for (const src of ['rn', 'rd']) {
    const s = src === 'rn' ? 'r-normal' : 'r-drive';
    map.addLayer({ id: src + '-glow', type: 'line', source: s, layout: L, paint: { 'line-color': '#7fe6c8', 'line-width': w(16, 44), 'line-blur': w(5, 14), 'line-opacity': 0 } }, 'road-label');
    map.addLayer({ id: src + '-case', type: 'line', source: s, layout: L, paint: { 'line-gradient': solid('#ffffff'), 'line-width': w(9, 26), 'line-opacity': 0 } }, 'road-label');
    map.addLayer({ id: src + '-line', type: 'line', source: s, layout: L, paint: { 'line-gradient': solid('#22c79e'), 'line-width': w(5, 16), 'line-opacity': 0 } }, 'road-label');
  }
  // stickers + pins as GL symbols (collision avoidance; the 3D car layer draws on top of them)
  map.addSource('stk', { type: 'geojson', data: empty });
  map.addLayer({ id: 'stk', type: 'symbol', source: 'stk', layout: {
    'icon-image': ['get', 'img'], 'icon-size': ['get', 'sz'], 'icon-anchor': 'bottom', 'icon-allow-overlap': false, 'icon-padding': 8,
    'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'symbol-sort-key': ['get', 'prio'], 'symbol-z-order': 'source',
    'text-field': ['get', 'tag'], 'text-font': ['Noto Sans Bold'], 'text-size': isPhone() ? 11.5 : 13.5, 'text-anchor': 'top', 'text-offset': [0, 0.35], 'text-optional': true, 'text-max-width': 12
  }, paint: { 'text-color': '#5b3a63', 'text-halo-color': '#ffffff', 'text-halo-width': 2.6 } });
  map.addLayer(car.layer);
}

// sticker images (die-cut sticker + optional badge) rasterised once from SVG
async function addStickerImages() {
  const types = ['ponding', 'critical', 'underpass', 'start', 'end'], badges = ['', 'ok', 'warn'];
  const jobs = [];
  for (const ty of types) for (const b of (ty === 'start' || ty === 'end' ? [''] : badges)) jobs.push((async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 72 72"><ellipse cx="36" cy="66" rx="17" ry="4" fill="#7a4a8c" opacity=".22"/><svg x="6" y="4" width="58" height="58">${stickerSVG(ty, 58).replace(/^<svg[^>]*>/, '<svg viewBox="0 0 64 64">')}</svg>${b ? `<svg x="46" y="2" width="24" height="24">${badgeSVG(b)}</svg>` : ''}</svg>`;
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 144; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 144, 144);
    map.addImage(`s-${ty}-${b}`, g.getImageData(0, 0, 144, 144), { pixelRatio: 2 });
  })());
  await Promise.all(jobs);
}
const stkType = h => h.type === 'underpass' ? 'underpass' : h.critInfo?.length ? 'critical' : 'ponding';
const TAG = { ponding: 'Encharcamiento registrado', critical: 'Zona crítica', underpass: 'Paso a desnivel' };

// ------------------------------------------------------------------------------------------- model
function buildModel(normal, drive, sR, safeLeg, trip) {
  const N = measure(normal.coordinates), D = measure(drive.coordinates);
  const exN = exposure(normal.coordinates, HZ), exD = exposure(drive.coordinates, HZ);
  const idsN = routerCrossedIds(normal), idsS = routerCrossedIds(safeLeg);
  if (idsN) alignCrossed(exN, idsN);
  if (idsN && idsS) alignCrossed(exD, new Set([...idsN, ...idsS]));
  const avoided = avoidedSites({ crossed: exN.crossed.filter(e => (e.sIn ?? e.s) > sR) }, { crossed: exD.crossed.filter(e => (e.sIn ?? e.s) > sR) });
  const crossed = exD.crossed.filter(e => (e.sIn ?? e.s) > sR);
  const steps = [];
  for (const st of normal.steps || []) { const p = project(N, toM(st.location)); if (p.s <= sR + 1 && p.d < 60) steps.push({ s: p.s, ...parseStep(st) }); }
  if (safeLeg && safeLeg !== normal) for (const st of safeLeg.steps || []) { const p = project(D, toM(st.location)); if (p.s > sR - 1 && p.d < 60) steps.push({ s: p.s, ...parseStep(st) }); }
  steps.sort((a, b) => a.s - b.s);
  // hazards worth a sticker along each line: IMEPLAN sites the route touches or passes within 120 m; OSM underpasses only when driven through
  const ahead = ex => { const out = []; for (const e of ex.all.slice().sort((a, b) => (a.sIn ?? a.s) - (b.sIn ?? b.s))) { const s = e.sIn ?? e.s; if (e.h.kind === 'hotspot' ? !e.inside : e.d > 120) continue; if (out.length && s - out[out.length - 1].s < 120) continue; out.push({ s, e }); } return out; };
  const dur = safeLeg && safeLeg !== normal ? normal.duration_s * sR / N.length + safeLeg.duration_s : normal.duration_s;
  return { normal, drive, N, D, sR, exN, exD, avoided, crossed, steps, trip, dur, aheadN: ahead(exN), aheadD: ahead(exD), rerouted: !!safeLeg && safeLeg !== normal };
}
const plural = (n, a, b) => n === 1 ? a : b;
const countLabel = list => { const obs = list.filter(e => e.h.kind !== 'hotspot').length, hot = list.length - obs, p = []; if (obs) p.push(`${obs} ${plural(obs, 'sitio inundable', 'sitios inundables')}`); if (hot) p.push(`${hot} ${plural(hot, 'paso inferior', 'pasos inferiores')}`); return p.join(' y ') || 'nada'; };
const byWeight = (a, b) => (b.h.kind !== 'hotspot') - (a.h.kind !== 'hotspot') || b.h.weight * (b.crit ? 1.4 : 1) - a.h.weight * (a.crit ? 1.4 : 1);

// ------------------------------------------------------------------------------------------- cameras
const MPP0 = 40075016.686 * Math.cos(20.62 * Math.PI / 180) / 512;
function padFollow() { const H = innerHeight; return isPhone() ? { top: H * 0.4, bottom: 300, left: 0, right: 0 } : { top: H * 0.4, bottom: 30, left: 0, right: 0 }; }
function zoomClose(v) { return clamp(Math.log2(MPP0 * 170 / Math.max(v, 1)), 15.0, 16.8) - (isPhone() ? 0.35 : 0); }
function headingAt(line, s, back, ahead) { const a = pointAt(line, s - back), b = pointAt(line, s + ahead); return Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI; }
function followCam(line, s, v, zoom) {
  const a = clamp(v * 0.9, 110, 1800);
  return { center: toLL(pointAt(line, s)), zoom: zoom ?? zoomClose(v), bearing: headingAt(line, s, a * 0.35, a), pitch: 61 - clamp(v / 2500, 0, 1) * 6, pad: padFollow() };
}
function overviewCam(lines, bearing = -8) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const l of lines) for (const [x, y] of l) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const pad = isPhone() ? { top: 300, bottom: 230, left: 40, right: 40 } : { top: 110, bottom: 110, left: 470, right: 360 };
  const c = map.cameraForBounds([[x0, y0], [x1, y1]], { padding: pad, bearing }) || { center: [(x0 + x1) / 2, (y0 + y1) / 2], zoom: 11 };
  const ctr = c.center.toArray ? c.center.toArray() : [c.center.lng ?? c.center[0], c.center.lat ?? c.center[1]];
  return { center: ctr, zoom: c.zoom - 0.25, bearing, pitch: 38, pad: { top: 0, bottom: 0, left: 0, right: 0 } };
}
function angLerp(a, b, u) { const d = ((b - a + 540) % 360) - 180; return a + d * u; }
function camLerp(a, b, u, geo = false) {
  const z = lerp(a.zoom, b.zoom, u); let k = u;
  if (geo && Math.abs(b.zoom - a.zoom) > 0.5) { const dz = b.zoom - a.zoom; k = dz > 0 ? (1 - Math.pow(2, -(z - a.zoom))) / (1 - Math.pow(2, -dz)) : 1 - (1 - Math.pow(2, b.zoom - z)) / (1 - Math.pow(2, dz)); k = clamp(k, 0, 1); }
  const P = (p, q) => ({ top: lerp(p.top, q.top, u), bottom: lerp(p.bottom, q.bottom, u), left: lerp(p.left, q.left, u), right: lerp(p.right, q.right, u) });
  return { center: [lerp(a.center[0], b.center[0], k), lerp(a.center[1], b.center[1], k)], zoom: z, bearing: angLerp(a.bearing, b.bearing, u), pitch: lerp(a.pitch, b.pitch, u), pad: P(a.pad, b.pad) };
}
// cubic Hermite through keyframes {t, s, v}
function hermite(K) {
  return tt => {
    tt = clamp(tt, K[0].t, K[K.length - 1].t); let k = 0; while (k < K.length - 2 && K[k + 1].t < tt) k++;
    const a = K[k], b = K[k + 1], h = (b.t - a.t) || 1e-6, u = (tt - a.t) / h, u2 = u * u, u3 = u2 * u;
    const s = (2 * u3 - 3 * u2 + 1) * a.s + (u3 - 2 * u2 + u) * h * a.v + (-2 * u3 + 3 * u2) * b.s + (u3 - u2) * h * b.v;
    const v = ((6 * u2 - 6 * u) * a.s + (3 * u2 - 4 * u + 1) * h * a.v + (-6 * u2 + 6 * u) * b.s + (3 * u2 - 2 * u) * h * b.v) / h;
    return { s, v: Math.max(0, v) };
  };
}
// time-skip: cosine ease from s0 to s1 with the camera rising and coming back down
function skipAt(u, s0, s1) { const e = (1 - Math.cos(Math.PI * clamp(u, 0, 1))) / 2; return { s: lerp(s0, s1, e), v: (s1 - s0) * Math.PI / 2 * Math.sin(Math.PI * clamp(u, 0, 1)) }; }

// ------------------------------------------------------------------------------------------- texts
function eventBubble(kind, e, dist) {
  const h = e.h, ty = stkType(h);
  if (kind === 'crossed') return { mood: 'worried', tag: 'warn', stk: ty, title: ty === 'underpass' ? 'Paso a desnivel inundable' : 'Encharcamiento registrado', text: `${h.ref}${h.range ? ` (${h.range.replace(/\s/g, '')} cm registrados)` : ''}. No hay otra vía razonable: despacito y sin meterse al agua.`, src: hazardSrc(h) };
  return { mood: 'surprised', tag: 'near', stk: ty, title: `${TAG[ty]} a ${fmtKm(dist ?? e.d)}`, text: `${h.ref}. Lo rodeamos por un lado.`, src: hazardSrc(h) };
}

// ------------------------------------------------------------------------------------------- demo timeline (40 s)
function buildDemo(m) {
  const T = { d1: 2.6, rain: 4.4, recalc: 6.8, stop: 8.6, up: 10.4, revealA: 9.6, revealB: 11.0, hold: 12.8, down: 14.2, d2: 22.0, sk1: 24.6, d3: 30.0, sk2: 32.4, arrive: 36.0, end: 40.0 };
  const { N, D, sR } = m, L = D.length, ph = isPhone();
  const firstN = m.aheadN.find(a => a.s > sR + 150) || null;
  const nearList = m.aheadD.filter(a => a.s > sR + 500 && a.s < sR + 2600 && !a.e.inside);
  const nearEv = nearList.slice().sort((a, b) => (b.e.h.type === 'underpass') - (a.e.h.type === 'underpass') || a.e.d - b.e.d)[0] || null;
  const crossEv = m.crossed.filter(e => e.h.kind !== 'hotspot' && (e.sIn ?? e.s) > sR + 3500).sort(byWeight)[0] || null;
  const s2end = Math.min(L - 3000, nearEv ? nearEv.s + 650 : sR + 1800);
  const sC = crossEv ? (crossEv.sIn ?? crossEv.s) : L - 2600;
  const s3a = Math.max(s2end + 500, sC - 600), s3b = Math.min(L - 900, sC + 650), s4a = Math.max(s3b + 200, L - 620);
  // drive keyframes
  const d1 = hermite([{ t: 0, s: 0, v: 0 }, { t: T.d1, s: 55, v: 45 }, { t: T.stop - 1.6, s: sR - 140, v: 150 }, { t: T.stop, s: sR, v: 0 }]);
  const K2 = [{ t: T.down, s: sR, v: 0 }];
  if (nearEv) { const tN = (T.down + T.d2) / 2 + 0.6; K2.push({ t: tN - 1.3, s: nearEv.s - 160, v: 120 }, { t: tN + 1.3, s: nearEv.s + 160, v: 120 }); }
  K2.push({ t: T.d2, s: s2end, v: 170 });
  const d2 = hermite(K2);
  const tC = (T.sk1 + T.d3) / 2 + 0.2;
  const d3 = hermite([{ t: T.sk1, s: s3a, v: 170 }, { t: tC - 1.4, s: sC - 170, v: 110 }, { t: tC + 1.4, s: sC + 150, v: 110 }, { t: T.d3, s: s3b, v: 170 }]);
  const d4 = hermite([{ t: T.sk2, s: s4a, v: 170 }, { t: T.arrive - 0.6, s: L - 25, v: 30 }, { t: T.arrive, s: L, v: 0 }]);
  const h0 = headingAt(D, 30, 20, 120);
  const camOpen = { center: toLL(pointAt(D, 0)), zoom: ph ? 16.9 : 17.4, bearing: h0 + 165, pitch: 66, pad: ph ? { top: innerHeight * 0.3, bottom: 300, left: 0, right: 0 } : { top: innerHeight * 0.32, bottom: 60, left: 0, right: 0 } };
  const mid = toLL([(pointAt(N, sR + 650)[0] + pointAt(D, sR + 650)[0] + 2 * pointAt(D, sR)[0]) / 4, (pointAt(N, sR + 650)[1] + pointAt(D, sR + 650)[1] + 2 * pointAt(D, sR)[1]) / 4]);
  const camUp = { center: mid, zoom: ph ? 14.6 : 15.2, bearing: headingAt(N, sR + 500, 300, 700), pitch: 52, pad: ph ? { top: 240, bottom: 300, left: 0, right: 0 } : { top: 150, bottom: 170, left: 200, right: 330 } };
  const ovEnd = overviewCam([m.normal.coordinates, m.drive.coordinates], -8);
  const zSkip = ph ? 12.6 : 13.0;
  const fc = (line, s, v, z) => followCam(line, s, v, z);
  const segs = [
    { t0: 0, t1: T.d1, fn: t => { const { s, v } = d1(t); return { cam: camLerp(camOpen, fc(N, s, v), ease(t / T.d1)), s, v, line: 'N', phase: 'open', boost: lerp(1.5, 1, ease(t / T.d1)) }; } },
    { t0: T.d1, t1: T.stop, fn: t => { const { s, v } = d1(t); return { cam: fc(N, s, v), s, v, line: 'N', phase: 'drive' }; } },
    { t0: T.stop, t1: T.up, fn: t => ({ cam: camLerp(fc(N, sR, 0), camUp, ease((t - T.stop) / (T.up - T.stop)), true), s: sR, v: 0, line: 'D', phase: 'reroute', boost: lerp(1, 0.55, ease((t - T.stop) / (T.up - T.stop))) }) },
    { t0: T.up, t1: T.hold, fn: t => ({ cam: camLerp(camUp, { ...camUp, bearing: camUp.bearing + 6, zoom: camUp.zoom + 0.08 }, (t - T.up) / (T.hold - T.up)), s: sR, v: 0, line: 'D', phase: 'reroute', boost: 0.55 }) },
    { t0: T.hold, t1: T.down, fn: t => ({ cam: camLerp({ ...camUp, bearing: camUp.bearing + 6, zoom: camUp.zoom + 0.08 }, fc(D, sR, 0), ease((t - T.hold) / (T.down - T.hold)), true), s: sR, v: 0, line: 'D', phase: 'reroute', boost: lerp(0.55, 1, ease((t - T.hold) / (T.down - T.hold))) }) },
    { t0: T.down, t1: T.d2, fn: t => { const { s, v } = d2(t); return { cam: fc(D, s, v), s, v, line: 'D', phase: 'drive' }; } },
    { t0: T.d2, t1: T.sk1, fn: t => { const u = (t - T.d2) / (T.sk1 - T.d2), { s, v } = skipAt(u, s2end, s3a); const z0 = zoomClose(170); return { cam: fc(D, s, v, z0 - (z0 - zSkip) * Math.sin(Math.PI * u)), s, v, line: 'D', phase: 'skip', skip: [u, s2end, s3a] }; } },
    { t0: T.sk1, t1: T.d3, fn: t => { const { s, v } = d3(t); return { cam: fc(D, s, v), s, v, line: 'D', phase: 'drive' }; } },
    { t0: T.d3, t1: T.sk2, fn: t => { const u = (t - T.d3) / (T.sk2 - T.d3), { s, v } = skipAt(u, s3b, s4a); const z0 = zoomClose(170); return { cam: fc(D, s, v, z0 - (z0 - zSkip) * Math.sin(Math.PI * u)), s, v, line: 'D', phase: 'skip', skip: [u, s3b, s4a] }; } },
    { t0: T.sk2, t1: T.arrive, fn: t => { const { s, v } = d4(t); return { cam: fc(D, s, v), s, v, line: 'D', phase: 'drive' }; } },
    { t0: T.arrive, t1: T.end, fn: t => ({ cam: camLerp(fc(D, L, 0), ovEnd, ease((t - T.arrive - 0.4) / 2.6), true), s: L, v: 0, line: 'D', phase: 'outro' }) }
  ];
  const extra = m.dur - m.normal.duration_s;
  const tNear = nearEv ? (T.down + T.d2) / 2 + 0.6 : null;
  const bubbles = [
    { t0: 0.3, t1: T.rain, mood: 'happy', title: '', text: `¡Hola! Soy Gotita, tu copiloto. Vamos de ${m.trip.fromName} a ${m.trip.toName}.`, src: '' },
    { t0: T.rain, t1: T.recalc, mood: 'surprised', title: '', text: '¡Empezó a llover! Reviso dónde se ha inundado antes…', src: 'Sitios registrados IMEPLAN · riesgo modelado (exploratorio)' },
    firstN && { t0: T.recalc, t1: T.up, mood: 'worried', tag: 'warn', stk: stkType(firstN.e.h), title: '¡Recalculando!', text: `Adelante: ${firstN.e.h.ref}${firstN.e.h.range ? ` (${firstN.e.h.range.replace(/\s/g, '')} cm registrados)` : ''}. Mejor la rodeamos.`, src: hazardSrc(firstN.e.h) },
    { t0: T.up, t1: T.down + 0.8, mood: 'happy', tag: 'ok', stk: 'end', title: '¡Ruta segura!', text: `${extra > 30 ? '+' + fmtMin(extra) : 'Mismo tiempo'} y esquiva ${countLabel(m.avoided)} (｡•̀ᴗ-)✧`, src: 'Ruta: router cauce · OSM 2026-10-29' },
    nearEv && { t0: tNear - 1.6, t1: tNear + 2.0, ...eventBubble('near', nearEv.e) },
    crossEv && { t0: tC - 1.7, t1: tC + 2.2, ...eventBubble('crossed', crossEv) },
    { t0: T.arrive - 0.6, t1: T.end + 1, mood: 'happy', title: '', text: '¡Llegamos secos! ヽ(＾▽＾)ノ', src: '' }
  ].filter(Boolean);
  for (let i = 0; i < bubbles.length - 1; i++) bubbles[i].t1 = Math.min(bubbles[i].t1, bubbles[i + 1].t0);
  const skipMin = (a, b) => Math.max(1, Math.round((b - a) / L * m.dur / 60));
  return {
    T: T.end, segs, bubbles, model: m, K: T, demo: true, rainAt: T.rain, rerouteAt: T.stop, revealAt: [T.revealA, T.revealB], toast: [T.recalc + 0.2, T.up - 0.3],
    summaryAt: T.arrive + 1.6, hops: [T.rain, T.recalc, tNear && tNear - 1.5, tC - 1.6, T.arrive].filter(Boolean), depart: DEMO_DEPART,
    skipLabels: [skipMin(s2end, s3a), skipMin(s3b, s4a)], firstN, nearEv, crossEv
  };
}

// custom destination: close start, keyframed drive with dwell at alerts (zoom follows speed), outro
function buildCustom(m) {
  const L = m.D.length, ph = isPhone();
  const Td = clamp(L / 1100, 10, 30), T0 = 2.2;
  const evs = m.aheadD.filter(a => a.s > 300 && a.s < L - 300).slice(0, 4);
  const K = [{ t: T0, s: 0, v: 40 }]; let tt = T0; const fast = Td - evs.length * 2.4; let prev = 0;
  const gaps = [...evs.map(a => a.s), L].map(s => { const g = s - prev; prev = s; return Math.sqrt(Math.max(g, 1)); }); const gs = gaps.reduce((a, b) => a + b, 0);
  const evT = [];
  evs.forEach((a, i) => { tt += Math.max(0.6, fast) * gaps[i] / gs; K.push({ t: tt, s: a.s - 140, v: 120 }); evT.push({ ...a, t: tt + 1.2 }); tt += 2.4; K.push({ t: tt, s: a.s + 140, v: 120 }); });
  K.push({ t: T0 + Td, s: L, v: 0 });
  const dr = hermite(K), h0 = headingAt(m.D, 30, 20, 120);
  const camOpen = { center: toLL(pointAt(m.D, 0)), zoom: ph ? 16.9 : 17.4, bearing: h0 + 165, pitch: 66, pad: padFollow() };
  const ov = overviewCam([m.normal.coordinates, m.drive.coordinates]);
  const zFor = v => clamp(Math.log2(MPP0 * 170 / Math.max(v, 1)), 13.0, 16.8) - (ph ? 0.35 : 0);
  const segs = [
    { t0: 0, t1: T0, fn: t => ({ cam: camLerp(camOpen, followCam(m.D, 0, 0, zFor(0)), ease(t / T0)), s: 0, v: 0, line: 'D', phase: 'open', boost: lerp(1.5, 1, ease(t / T0)) }) },
    { t0: T0, t1: T0 + Td, fn: t => { const { s, v } = dr(t); return { cam: followCam(m.D, s, v, zFor(v)), s, v, line: 'D', phase: 'drive' }; } },
    { t0: T0 + Td, t1: T0 + Td + 3.5, fn: t => ({ cam: camLerp(followCam(m.D, L, 0, zFor(0)), ov, ease((t - T0 - Td) / 3), true), s: L, v: 0, line: 'D', phase: 'outro' }) }
  ];
  const bubbles = [
    { t0: 0.1, t1: T0 + 1.5, mood: 'happy', title: '', text: m.avoided.length ? `¡Vamos! La ruta segura esquiva ${countLabel(m.avoided)}.` : '¡Vamos! Esta ruta no cruza sitios inundables registrados.', src: 'Ruta: router cauce · OSM 2026-10-29' },
    ...evT.map(a => ({ t0: a.t - 1.5, t1: a.t + 1.8, ...eventBubble(a.e.inside ? 'crossed' : 'near', a.e) })),
    { t0: T0 + Td, t1: 1e9, mood: 'happy', title: '', text: '¡Llegamos! ヽ(＾▽＾)ノ', src: '' }
  ];
  for (let i = 0; i < bubbles.length - 1; i++) bubbles[i].t1 = Math.min(bubbles[i].t1, bubbles[i + 1].t0);
  return { T: T0 + Td + 3.5, segs, bubbles, model: m, demo: false, rainAt: -10, rerouteAt: -10, revealAt: null, toast: null, summaryAt: T0 + Td + 1.6, hops: [0.3, ...evT.map(a => a.t - 1.4), T0 + Td], depart: new Date(), skipLabels: [] };
}

// ------------------------------------------------------------------------------------------- frame application
let lastBubbleKey = '', lastManeuver = '', lastStk = '';
const paintCache = new Map();
function setPaint(id, prop, val) { const k = id + '|' + prop, s = typeof val === 'string' ? val : JSON.stringify(val); if (paintCache.get(k) === s) return; paintCache.set(k, s); try { map.setPaintProperty(id, prop, val); } catch (e) { } }
function solid(c) { return ['interpolate', ['linear'], ['line-progress'], 0, c, 1, c]; }
function grad(p, r, cTrav, cAhead) {
  const e = 1e-5; p = clamp(p, 0, 1); r = clamp(r, 0, 1); if (p > r) p = r;
  const ex = ['step', ['line-progress']];
  if (p > e) ex.push(cTrav, p, cAhead); else ex.push(cAhead);
  if (r < 1 - e) ex.push(Math.max(r, (p > e ? p : 0) + e), 'rgba(255,255,255,0)');
  return ex.length === 3 ? solid(ex[2]) : ex;
}
const pop = x => x <= 0 ? 0 : 1 - Math.exp(-x * 8) * Math.cos(x * 15);
const bump = x => x > 0 && x < 0.55 ? Math.sin(Math.PI * x / 0.55) : 0;
const segAt = (tl, t) => tl.segs.find(s => t < s.t1) || tl.segs[tl.segs.length - 1];
const currentBubble = (tl, t) => { let r = null; for (const b of tl.bubbles) if (t >= b.t0 && t < b.t1) r = b; return r; };

function stickersFor(tl, t, f, line, rain) {
  const m = tl.model, out = [], ph = isPhone(), base = ph ? 0.62 : 0.78;
  const add = (ll, ty, badge, tag, prio, appear) => out.push({ ll, img: `s-${ty}-${badge || ''}`, tag: tag || '', prio, sz: +(base * (appear == null ? 1 : clamp(pop(t - appear), 0, 1.3))).toFixed(3) });
  if (f.phase === 'open' || f.s < 60) add(m.trip.from, 'start', '', '', 5);
  if (f.phase === 'outro' || line.length - f.s < 2500) add(m.trip.to, 'end', '', f.phase === 'outro' ? '' : m.trip.toName, 4);
  if (rain <= 0.05 || f.phase === 'skip') return out;
  if (f.phase === 'reroute' && tl.demo) {
    const revealed = t > tl.revealAt[1] - 0.3;
    m.avoided.filter(e => (e.sIn ?? e.s) < m.sR + 2600).sort(byWeight).slice(0, 3).forEach((e, i) => add(e.h.anchor, stkType(e.h), revealed ? 'ok' : '', i === 0 && revealed ? 'evitado' : '', 1 + i));
    return out;
  }
  if (f.phase === 'outro') {
    m.avoided.slice().sort(byWeight).slice(0, 4).forEach((e, i) => add(e.h.anchor, stkType(e.h), 'ok', '', 1 + i, (tl.summaryAt ?? 0) - 1 + i * 0.15));
    m.crossed.filter(e => e.h.kind !== 'hotspot').sort(byWeight).slice(0, 1).forEach(e => add(e.h.anchor, stkType(e.h), 'warn', '', 6, (tl.summaryAt ?? 0) - 0.4));
    return out;
  }
  // driving: only the next one or two hazards along the line, the first one labelled
  const list = (line === m.N ? m.aheadN : m.aheadD).filter(a => a.s > f.s - 120 && a.s < f.s + 1300).slice(0, 2);
  list.forEach((a, i) => {
    const ty = stkType(a.e.h), crossed = line === m.D && m.crossed.includes(a.e), dd = a.s - f.s;
    const tag = i === 0 ? `${a.e.h.kind === 'hotspot' ? 'Paso inferior' : TAG[ty]} · ${dd < 40 ? 'aquí' : fmtKm(Math.round(dd / 50) * 50)}` : '';
    add(a.e.inside ? toLL(pointAt(line, a.s + 40)) : a.e.h.anchor, ty, crossed ? 'warn' : '', tag, 1 + i, tl.demo ? Math.max(tl.rainAt + 0.6, 0) : null);
  });
  return out;
}

function renderAt(tl, t) {
  timeline = tl; const m = tl.model; t = clamp(t, 0, tl.T); timelineT = t;
  const f = segAt(tl, t).fn(t);
  const line = f.line === 'N' ? m.N : m.D, L = line.length;
  const c = f.cam;
  if (![c.center[0], c.center[1], c.zoom, c.bearing, c.pitch].every(Number.isFinite)) console.error('bad camera', f.phase, t);
  else map.jumpTo({ center: c.center, zoom: c.zoom, bearing: c.bearing, pitch: c.pitch, padding: c.pad });
  // weather
  const rain = clamp((t - tl.rainAt) / 0.9, 0, 1);
  drawRain(t, rain);
  $('tint').style.opacity = (rain * 0.45).toFixed(3);
  $('clouds').style.opacity = rain.toFixed(3); $('clouds').style.transform = `translateY(${(-30 + 30 * ease(rain)).toFixed(1)}px)`;
  for (const l of hazLayers) setPaint(l.id, l.prop, +(l.max * rain).toFixed(3));
  const wx = $('wx'), wxRain = rain > 0.5; if (wx.classList.contains('rain') !== wxRain) { wx.classList.toggle('rain', wxRain); wx.textContent = wxRain ? '☔ lloviendo' : '☀ seco'; }
  // routes
  const rerouted = t >= tl.rerouteAt;
  if (!rerouted) {
    setPaint('rn-line', 'line-gradient', grad(f.s / m.N.length, 1, '#bfeee0', '#22c79e')); setPaint('rn-case', 'line-gradient', solid('#ffffff'));
    for (const id of ['rn-line', 'rn-case']) setPaint(id, 'line-opacity', 1); setPaint('rn-glow', 'line-opacity', 0.3);
    for (const id of ['rn-dots', 'rn-dots-case', 'rd-line', 'rd-case', 'rd-glow']) setPaint(id, 'line-opacity', 0);
  } else {
    const fadeOld = tl.demo ? ease((t - tl.rerouteAt - 0.3) / 1.2) : 1;
    setPaint('rn-line', 'line-gradient', grad(m.sR / m.N.length, 1, '#bfeee0', '#22c79e'));
    for (const id of ['rn-line', 'rn-case']) setPaint(id, 'line-opacity', +(1 - fadeOld).toFixed(3)); setPaint('rn-glow', 'line-opacity', +(0.3 * (1 - fadeOld)).toFixed(3));
    setPaint('rn-dots', 'line-opacity', m.rerouted ? +(0.95 * fadeOld).toFixed(3) : 0); setPaint('rn-dots-case', 'line-opacity', m.rerouted ? +(0.9 * fadeOld).toFixed(3) : 0);
    const rv = tl.revealAt ? ease((t - tl.revealAt[0]) / (tl.revealAt[1] - tl.revealAt[0])) : 1, r0 = m.sR / m.D.length;
    setPaint('rd-line', 'line-gradient', grad(f.s / m.D.length, r0 + (1 - r0) * rv, '#bfeee0', '#22c79e')); setPaint('rd-case', 'line-gradient', grad(0, r0 + (1 - r0) * rv, '#ffffff', '#ffffff'));
    for (const id of ['rd-line', 'rd-case']) setPaint(id, 'line-opacity', 1); setPaint('rd-glow', 'line-opacity', +(0.32 * rv).toFixed(3));
  }
  // car
  const v = f.v || 0;
  car.state.lngLat = toLL(pointAt(line, f.s));
  car.state.heading = headingAt(line, f.s, Math.max(8, Math.min(v * 0.04, 200)), Math.max(22, Math.min(v * 0.1, 500)));
  car.state.dist = Math.min(f.s, 4e4); car.state.t = t; car.state.moving = clamp(v / 120, 0, 1);
  const px = (isPhone() ? 84 : 128) * clamp(innerHeight / 950, 0.85, 1.2);
  car.state.meters = clamp(lerp(0.45, 1, (c.zoom - 11) / 4), 0.45, 1.05) * px * MPP0 / Math.pow(2, c.zoom) * (f.boost || 1);
  car.state.hop = Math.max(0, ...tl.hops.map(h => bump(t - h)));
  car.state.wave = f.phase === 'open' || f.phase === 'outro' ? 1 : 0;
  // stickers (GL symbols)
  const fc = { type: 'FeatureCollection', features: stickersFor(tl, t, f, line, rain).map(s => ({ type: 'Feature', properties: { img: s.img, tag: s.tag, prio: s.prio, sz: s.sz }, geometry: { type: 'Point', coordinates: s.ll } })) };
  const key = JSON.stringify(fc); if (key !== lastStk) { lastStk = key; map.getSource('stk').setData(fc); }
  // bubble
  const b = currentBubble(tl, t), bel = $('bubble');
  if (b) {
    const k = b.t0 + b.text;
    if (k !== lastBubbleKey) {
      lastBubbleKey = k;
      $('b-tag').innerHTML = b.title ? (b.stk ? `<span class="tg" style="background:${STK[b.stk].bg}">${stickerSVG(b.stk, 28)}${esc(b.title)}</span>` : esc(b.title)) : '';
      $('b-text').textContent = b.text; $('b-src').textContent = b.src || '';
      $('gotita').className = 'gotita-wrap mood-' + (b.mood || 'happy');
    }
    const a = pop((t - b.t0) * 1.1), out = clamp((b.t1 - t) / 0.18, 0, 1);
    bel.style.opacity = Math.min(1, (t - b.t0) / 0.12, out).toFixed(3);
    bel.style.transform = `scale(${((0.55 + 0.45 * a) * (0.85 + 0.15 * out)).toFixed(3)})`;
  } else bel.style.opacity = 0;
  const hop = car.state.hop;
  $('gotita').style.transform = `translateY(${(-hop * 24 - Math.abs(Math.sin(t * 3.2)) * 4).toFixed(1)}px) scale(${(1 + hop * 0.06).toFixed(3)},${(1 - hop * 0.05).toFixed(3)}) rotate(${(Math.sin(t * 2.1) * 3).toFixed(2)}deg)`;
  // toast, skip pill, summary
  const ta = tl.toast ? clamp(Math.min((t - tl.toast[0]) / 0.2, (tl.toast[1] - t) / 0.2), 0, 1) : 0;
  $('toast').style.opacity = ta.toFixed(3);
  $('toast').style.transform = `translate(-50%,0) scale(${(0.6 + 0.4 * pop((t - (tl.toast?.[0] ?? 0)) * 1.2)).toFixed(3)})`;
  $('toast').querySelector('.spin').style.transform = `rotate(${(t * 540) % 360}deg)`;
  const sk = $('skip');
  if (f.skip) { const u = f.skip[0], i = f.skip[1] < (tl.model.D.length / 2) ? 0 : 1; const txt = `⏩ ${tl.skipLabels[i] ?? ''} min después`; if (sk.textContent !== txt) sk.textContent = txt; sk.style.opacity = clamp(Math.min(u / 0.15, (1 - u) / 0.15), 0, 1).toFixed(3); sk.style.transform = `translate(-50%,-50%) scale(${(0.8 + 0.2 * pop(u * 3)).toFixed(3)})`; }
  else sk.style.opacity = 0;
  const sa = tl.summaryAt != null ? pop((t - tl.summaryAt) * 1.1) : 0;
  $('summary').style.opacity = clamp((t - (tl.summaryAt ?? 1e9)) / 0.15, 0, 1).toFixed(3);
  $('summary').style.transform = `scale(${(0.6 + 0.4 * sa).toFixed(3)})`;
  const dim = tl.demo && t < tl.rerouteAt + 2.2;
  if ($('row-safe').classList.contains('dim') !== dim) $('row-safe').classList.toggle('dim', dim);
  renderManeuver(m, line, f, tl, t);
  renderTripbar(m, line, f, tl, rerouted);
  map.triggerRepaint();
}

function renderManeuver(m, line, f, tl, t) {
  const steps = line === m.N ? (m._stepsN ||= (m.normal.steps || []).map(st => ({ s: project(m.N, toM(st.location)).s, ...parseStep(st) })).sort((a, b) => a.s - b.s)) : m.steps;
  const nx = steps.find(st => st.s > f.s + 15 && st.type !== 'depart');
  let dist, text, street, icon;
  if (f.phase === 'outro' || f.s >= line.length - 5) { dist = '¡Llegaste!'; text = m.trip.toName; street = 'Sin mojarte los pies'; icon = 'arrive'; }
  else if (tl.toast && t >= tl.toast[0] && t < tl.rerouteAt + 3.4) { dist = 'Recalculando'; text = 'Buscando calles más secas'; street = ''; icon = 'round'; }
  else if (nx) { dist = fmtKm(nx.s - f.s); text = nx.text; street = nx.street ? 'por ' + nx.street : ''; icon = nx.mod; }
  else { dist = fmtKm(line.length - f.s); text = 'Sigue derecho'; street = ''; icon = 'straight'; }
  const key = [dist, text, street, icon].join('|'); if (key === lastManeuver) return; lastManeuver = key;
  $('mv-dist').textContent = dist; $('mv-text').textContent = text; $('mv-street').textContent = street; $('mv-ico').innerHTML = arrowSVG(icon);
}
function renderTripbar(m, line, f, tl, rerouted) {
  const L = line.length, dur = line === m.N ? m.normal.duration_s : m.dur, done = clamp(f.s / L, 0, 1);
  $('tb-eta').textContent = fmtClock(new Date(tl.depart.getTime() + dur * 1000));
  $('tb-min').textContent = done > 0.999 ? '0 min' : fmtMin(dur * (1 - done)); $('tb-km').textContent = done > 0.999 ? '0 m' : fmtKm(Math.max(0, L - f.s));
  const k = (f.v || 0) / (L / dur);
  const ff = f.phase === 'skip' ? 'salto en el tiempo' : f.phase === 'outro' ? 'vista general' : f.phase === 'reroute' ? 'pausa' : k > 1.5 ? `cámara rápida ×${Math.round(k)}` : 'tiempo real';
  if ($('tb-ff').textContent !== ff) $('tb-ff').textContent = ff;
}

// ------------------------------------------------------------------------------------------- rain canvas
const rc = $('rain'), rctx = rc.getContext('2d'); let drops = [];
function sizeRain() { const d = Math.min(2, devicePixelRatio || 1); rc.width = innerWidth * d; rc.height = innerHeight * d; rctx.setTransform(d, 0, 0, d, 0, 0); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; drops = Array.from({ length: Math.round(innerWidth * innerHeight / 7000) }, () => ({ x: rnd(), y: rnd(), v: 0.7 + rnd() * 0.6, l: 10 + rnd() * 16, w: rnd() < 0.15 ? 3 : 1.8, round: rnd() < 0.08 })); }
function drawRain(t, k) {
  const W = innerWidth, H = innerHeight; rctx.clearRect(0, 0, W, H); if (k <= 0) return; rctx.lineCap = 'round';
  for (const d of drops) {
    const y = ((d.y * (H + 60) + t * 620 * d.v) % (H + 60)) - 30, x = ((d.x * (W + 80) - t * 120 * d.v) % (W + 80) + W + 80) % (W + 80) - 40;
    if (d.round) { rctx.fillStyle = `rgba(150,205,255,${0.7 * k})`; rctx.beginPath(); rctx.ellipse(x, y, 3.2, 4.2, 0, 0, 7); rctx.fill(); continue; }
    rctx.strokeStyle = `rgba(255,255,255,${0.75 * k})`; rctx.lineWidth = d.w + 1.6; rctx.beginPath(); rctx.moveTo(x, y); rctx.lineTo(x - d.l * 0.2, y + d.l); rctx.stroke();
    rctx.strokeStyle = `rgba(120,170,245,${0.5 * k})`; rctx.lineWidth = d.w; rctx.beginPath(); rctx.moveTo(x, y); rctx.lineTo(x - d.l * 0.2, y + d.l); rctx.stroke();
  }
}

// ------------------------------------------------------------------------------------------- panel
function renderTrip(m) {
  $('from-name').textContent = m.trip.fromName; $('to-name').textContent = m.trip.toName;
  $('safe-time').textContent = fmtMin(m.dur); $('normal-time').textContent = fmtMin(m.normal.duration_s);
  $('safe-sub').textContent = m.avoided.length ? `esquiva ${m.avoided.length} · ${fmtKm(m.D.length)}` : fmtKm(m.D.length);
  $('normal-sub').textContent = `cruza ${m.exN.crossed.length} · ${fmtKm(m.N.length)}`;
  $('credit-router').textContent = /stub/.test(routerEngine) ? 'OSRM demo (provisional)' : 'router cauce (OSM 2026-10-29)';
}
function renderSummary(m) {
  const av = m.avoided.slice().sort(byWeight);
  $('sm-stk').innerHTML = [...new Set(av.map(e => stkType(e.h)))].slice(0, 3).map(k => stickerSVG(k, 44)).join('') + stickerSVG('end', 44);
  const extra = m.dur - m.normal.duration_s;
  const crObs = m.crossed.filter(e => e.h.kind !== 'hotspot'), crHot = m.crossed.length - crObs.length;
  const names = av.filter(e => e.h.kind !== 'hotspot').slice(0, 2).map(e => `<b>${esc(e.h.ref)}</b>`).join(' y ');
  $('sm-text').innerHTML = (m.avoided.length ? `Esquivamos ${countLabel(m.avoided)}${names ? `, como ${names}` : ''}. ` : 'No hubo nada que esquivar. ') + (extra > 30 ? `Costo: <b>+${fmtMin(extra)}</b>. ` : '') +
    (m.crossed.length ? `<br><span class="sm-warn">Sin alternativa razonable: ${[...crObs.slice(0, 1).map(e => esc(e.h.ref)), crObs.length > 1 ? `${crObs.length - 1} ${plural(crObs.length - 1, 'sitio más', 'sitios más')}` : '', crHot ? `${crHot} ${plural(crHot, 'paso inferior', 'pasos inferiores')}` : ''].filter(Boolean).join(', ')}.</span>` : '');
}
function sayLoading(text) { $('b-tag').innerHTML = ''; $('b-text').textContent = text; $('b-src').textContent = ''; $('gotita').className = 'gotita-wrap mood-happy'; $('bubble').style.opacity = 1; $('bubble').style.transform = 'scale(1)'; lastBubbleKey = ''; }

// ------------------------------------------------------------------------------------------- settle / playback
async function settle() {
  const once = ev => new Promise(r => map.once(ev, r)), timeout = ms => new Promise(r => setTimeout(r, ms));
  map.triggerRepaint(); await Promise.race([once('render'), timeout(800)]);
  const t0 = performance.now(); while (!map.areTilesLoaded() && performance.now() - t0 < 15000) await timeout(50);
  map.triggerRepaint(); await Promise.race([once('idle'), timeout(4000)]);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}
let playing = false, playTl = null;
function play(tl, loop) {
  playTl = tl; playing = true; let start = performance.now();
  const step = () => {
    if (!playing || playTl !== tl) return;
    let t = (performance.now() - start) / 1000;
    if (t > tl.T + (loop ? 2.5 : 0)) { if (loop) { start = performance.now(); t = 0; } else { renderAt(tl, tl.T); playing = false; return; } }
    renderAt(tl, Math.min(t, tl.T)); requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------------------------------------- custom destination
const cache = new Map();
async function customTrip(toLLv) {
  playing = false;
  const from = car.state.lngLat.slice();
  const trip = { from, to: toLLv, fromName: 'Aquí', toName: 'Tu destino' };
  sayLoading('Cargando las calles de la ciudad (≈5 MB)… un momentito (｡•ᴗ•｡)');
  try {
    if (!router) { const mod = await import('/labs/shared/router/router.js'); router = await mod.loadRouter(); routerEngine = router.engine || routerEngine; }
    sayLoading('Buscando la ruta que menos se moja…');
    const p = await plan(router, trip.from, trip.to, HZ, { cache, hazardIds: rainLayers });
    const m = buildModel(p.normal, p.safe, 0, p.safe, trip);
    setRoutes(m); renderTrip(m); renderSummary(m);
    lastStk = ''; play(buildCustom(m), false);
  } catch (e) { console.error(e); sayLoading('Ups, no pude trazar esa ruta (' + (e.code || e.message) + '). Prueba otro punto dentro de la ciudad.'); }
}
function wirePicker() {
  $('btn-pick').addEventListener('click', () => { document.body.classList.add('picking'); });
  $('pick-cancel').addEventListener('click', e => { e.stopPropagation(); document.body.classList.remove('picking'); });
  map.on('click', e => { if (!document.body.classList.contains('picking')) return; document.body.classList.remove('picking'); customTrip([+e.lngLat.lng.toFixed(5), +e.lngLat.lat.toFixed(5)]); });
}
function setRoutes(m) {
  map.getSource('r-normal').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: m.normal.coordinates } });
  map.getSource('r-drive').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: m.drive.coordinates } });
}

// ------------------------------------------------------------------------------------------- boot
async function boot() {
  const [layers] = await Promise.all([loadHazards(), mapLoaded]);
  HZ = buildHazards(layers.filter(l => l.data));
  makePatterns(map); await addStickerImages(); addLayers(layers); sizeRain();
  // baked demo trip (real cauce router, see tools/bake-demo.mjs): filming never waits for the 5 MB router graph
  const d = await (await fetch('./data/demo-route.json')).json();
  routerEngine = d.engine || routerEngine;
  const Nm = measure(d.normal.coordinates);
  const sl = []; for (let i = 0; i < Nm.cum.length; i++) if (Nm.cum[i] <= d.reroute.s) sl.push(Nm.coords[i]); sl.push(toLL(pointAt(Nm, d.reroute.s)));
  const m = buildModel(d.normal, { coordinates: [...sl, ...d.safeFromReroute.coordinates.slice(1)] }, d.reroute.s, d.safeFromReroute, TRIP);
  setRoutes(m); renderTrip(m); renderSummary(m);
  await document.fonts.ready;
  demoTimeline = buildDemo(m); window.__cauceDemo.duration_s = demoTimeline.T;
  renderAt(demoTimeline, 0);
  if (!DEMO) wirePicker();
  window.__mochi = { map, model: m, timeline: () => timeline };
  $('boot').classList.add('gone');
  resolveReady();
  if (!CAPTURE) { await settle(); play(demoTimeline, true); }
}
addEventListener('resize', () => { sizeRain(); if (demoTimeline) { demoTimeline = buildDemo(demoTimeline.model); if (playing && playTl?.demo) play(demoTimeline, true); else if (!playing) renderAt(timeline?.demo ? demoTimeline : timeline, timelineT); } });
boot().catch(e => { console.error(e); $('boot').querySelector('p').textContent = 'Ups: ' + e.message; });
