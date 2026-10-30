// cauce. nav-mochi — kawaii flood-aware navigation prototype.
// Everything on screen is a pure function of a "frame" built from a timeline time t, so ?demo=1 can be
// seeked deterministically (window.__cauceDemo.seek) and the interactive drive reuses the same engine.
import { mochiStyle, makePatterns } from './style.js';
import { buildHazards, plan, measure, pointAt, toLL, toM, project, exposure, avoidedSites, subset, routerCrossedIds, alignCrossed } from './plan.js';
import { createCar } from './car.js';
import { stickerSVG, badgeSVG, gotitaSVG, parseStep, arrowSVG, fmtKm, fmtMin, fmtClock, esc, hazardLines, hazardSrc, STK } from './ui.js';

const Q = new URLSearchParams(location.search);
const DEMO = Q.has('demo') && Q.get('demo') !== '0';
const LIVE = Q.get('live') === '1';
const $ = id => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, u) => a + (b - a) * u;
const ease = u => { u = clamp(u, 0, 1); return u * u * u * (u * (u * 6 - 15) + 10); };
const isPhone = () => innerWidth <= 700;
if (DEMO) document.body.classList.add('demo');
$('boot-g').innerHTML = gotitaSVG();
$('gotita').innerHTML = gotitaSVG();

const parseLL = s => s && s.split(',').map(Number).length === 2 ? s.split(',').map(Number) : null;
const TRIP = { from: parseLL(Q.get('from')) || [-103.3925, 20.6743], to: parseLL(Q.get('to')) || [-103.3111, 20.5218], fromName: Q.get('fromName') || 'Glorieta Minerva', toName: Q.get('toName') || 'Aeropuerto GDL' };
const DEFAULT_TRIP = !Q.get('from') && !Q.get('to');
const DEMO_DEPART = new Date(2026, 5, 18, 18, 10); // filmed as a June storm afternoon (clock is decorative)

// ------------------------------------------------------------------------------------------- demo API
let resolveReady; const ready = new Promise(r => resolveReady = r);
let timeline = null, demoTimeline = null;
window.__cauceDemo = {
  duration_s: 28,
  async seek(t) { await ready; playing = false; renderAt(demoTimeline, t); await settle(); return true; }
};

// ------------------------------------------------------------------------------------------- map
const map = new maplibregl.Map({
  container: 'map', style: mochiStyle(), center: [-103.35, 20.6], zoom: 11.2, pitch: 40, bearing: -12,
  maxPitch: 78, attributionControl: false, fadeDuration: DEMO ? 0 : 250,
  canvasContextAttributes: { antialias: true }
});
const car = createCar(maplibregl);
const mapLoaded = new Promise(r => map.on('load', r));

let HZ = { list: [], near: () => new Set() }, hazardMetas = [], hazardLayerIds = [], scenarios = [], scenario = null, routerInfo = { engine: '?' };
let router = null;

async function loadHazards() {
  let idx = { layers: [] };
  try { idx = await (await fetch('/labs/shared/hazard/index.json', { cache: 'no-cache' })).json(); } catch (e) { console.warn('hazard index', e); }
  const metas = (idx.layers || []).filter(l => l && l.id && l.url);
  return Promise.all(metas.map(async meta => {
    if (meta.type !== 'geojson') return { meta, data: null };
    try { const r = await fetch(meta.url); return { meta, data: r.ok ? await r.json() : null }; } catch { return { meta, data: null }; }
  }));
}

function addHazardLayers(layers) {
  for (const { meta, data } of layers) {
    const id = 'hz-' + meta.id, kind = meta.kind || 'observed';
    const imeplan = /imeplan/i.test(meta.id);
    try {
      if (meta.type === 'geojson' && data) {
        map.addSource(id, { type: 'geojson', data });
        if (imeplan) {
          const site = ['==', ['get', 'category'], 'Sitios Inundales'], crit = ['==', ['get', 'category'], 'Zonas Criticas'];
          map.addLayer({ id: id + '-site', type: 'fill', source: id, filter: site, paint: { 'fill-pattern': 'pat-dots', 'fill-opacity': 0 } }, 'road-label');
          map.addLayer({ id: id + '-site-l', type: 'line', source: id, filter: site, paint: { 'line-color': '#5fa8f5', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 2.6], 'line-dasharray': [2, 1.2], 'line-opacity': 0 } }, 'road-label');
          map.addLayer({ id: id + '-crit', type: 'fill', source: id, filter: crit, paint: { 'fill-pattern': 'pat-stripes', 'fill-opacity': 0 } }, 'road-label');
          map.addLayer({ id: id + '-crit-l', type: 'line', source: id, filter: crit, paint: { 'line-color': '#ff5c8d', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 16, 3], 'line-opacity': 0 } }, 'road-label');
          hazardLayerIds.push({ id: id + '-site', prop: 'fill-opacity', max: 1, layer: meta.id }, { id: id + '-site-l', prop: 'line-opacity', max: 0.9, layer: meta.id }, { id: id + '-crit', prop: 'fill-opacity', max: 1, layer: meta.id }, { id: id + '-crit-l', prop: 'line-opacity', max: 1, layer: meta.id });
        } else if (kind === 'water') {
          // mapped permanent water: already drawn by the basemap; used only by the router
        } else if (kind === 'hotspot') {
          map.addLayer({ id: id + '-hl', type: 'line', source: id, layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 11], 'line-opacity': 0 } }, 'road-label');
          map.addLayer({ id: id + '-l', type: 'line', source: id, layout: { 'line-cap': 'round' }, paint: { 'line-color': '#a98bff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 16, 6], 'line-dasharray': [1, 1], 'line-opacity': 0 } }, 'road-label');
          hazardLayerIds.push({ id: id + '-hl', prop: 'line-opacity', max: 0.8, layer: meta.id }, { id: id + '-l', prop: 'line-opacity', max: 1, layer: meta.id });
        } else {
          const pat = kind === 'modeled' ? 'pat-model' : 'pat-dots', col = kind === 'modeled' ? '#8c60f0' : '#5fa8f5';
          map.addLayer({ id: id + '-f', type: 'fill', source: id, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-pattern': pat, 'fill-opacity': 0 } }, 'road-label');
          map.addLayer({ id: id + '-l', type: 'line', source: id, paint: { 'line-color': col, 'line-width': 1.8, 'line-dasharray': [1.5, 1.2], 'line-opacity': 0 } }, 'road-label');
          map.addLayer({ id: id + '-p', type: 'circle', source: id, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': col, 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-opacity': 0, 'circle-stroke-opacity': 0 } }, 'road-label');
          hazardLayerIds.push({ id: id + '-f', prop: 'fill-opacity', max: 1, layer: meta.id }, { id: id + '-l', prop: 'line-opacity', max: 0.9, layer: meta.id }, { id: id + '-p', prop: 'circle-opacity', max: 1, layer: meta.id });
        }
      } else if (meta.type === 'raster-tiles') {
        map.addSource(id, { type: 'raster', tiles: [meta.url], tileSize: meta.tileSize || 256, attribution: meta.attribution || '' });
        map.addLayer({ id: id + '-r', type: 'raster', source: id, paint: { 'raster-opacity': 0 } }, 'road-label');
        hazardLayerIds.push({ id: id + '-r', prop: 'raster-opacity', max: 0.7, layer: meta.id });
      } else if (meta.type === 'vector' && meta.sourceLayer) {
        map.addSource(id, { type: 'vector', url: meta.url });
        map.addLayer({ id: id + '-f', type: 'fill', source: id, 'source-layer': meta.sourceLayer, paint: { 'fill-pattern': 'pat-model', 'fill-opacity': 0 } }, 'road-label');
        hazardLayerIds.push({ id: id + '-f', prop: 'fill-opacity', max: 1, layer: meta.id });
      }
    } catch (e) { console.warn('hazard layer', meta.id, e); }
  }
}

function addRouteLayers() {
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
}

// ------------------------------------------------------------------------------------------- stickers
const stickers = new Map();
function makeSticker(h) {
  const el = document.createElement('div');
  el.className = 'stk'; el.innerHTML = `<div class="pop">${stickerSVG(stkType(h))}</div><div class="bdg"></div><div class="tag">${esc(STK[stkType(h)].short)}</div>`;
  el.addEventListener('click', ev => { ev.stopPropagation(); showPopup(h, ev.clientX, ev.clientY); });
  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(h.anchor).addTo(map);
  const st = { el, marker, h, pop: el.firstChild, bdg: el.children[1], last: '' };
  stickers.set(h.id, st); return st;
}
const stkType = h => h.type === 'underpass' ? 'underpass' : h.type === 'modeled' ? 'modeled' : h.critInfo?.length ? 'critical' : 'ponding';
function pinMarker(kind, ll, label) {
  const el = document.createElement('div'); el.className = 'stk pin';
  el.innerHTML = `<div class="pop">${stickerSVG(kind)}</div><div class="tag">${esc(label)}</div>`;
  return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(ll).addTo(map);
}
let pins = [];
function setPins(trip) { pins.forEach(p => p.remove()); pins = [pinMarker('start', trip.from, trip.fromName), pinMarker('end', trip.to, trip.toName)]; }

function showPopup(h, x, y) {
  const root = $('popup-root'); root.innerHTML = '';
  const d = document.createElement('div'); d.className = 'mochi-pop';
  d.innerHTML = `<b>${esc(STK[stkType(h)].label)}</b><div>${esc(h.ref)}</div><div>${esc(hazardLines(h).join(' · '))}</div><small>${esc(hazardSrc(h))}</small>`;
  d.style.left = Math.min(x + 10, innerWidth - 300) + 'px'; d.style.top = Math.min(y + 10, innerHeight - 160) + 'px';
  root.appendChild(d); setTimeout(() => addEventListener('pointerdown', () => root.innerHTML = '', { once: true }), 0);
}

// ------------------------------------------------------------------------------------------- route model
// A "trip model": normal route N, drive line D (= what the car follows), reroute point, events for alerts.
function buildModel(normal, drive, sR, safeLeg, trip) {
  const N = measure(normal.coordinates), D = measure(drive.coordinates);
  const exN = exposure(normal.coordinates, HZ), exD = exposure(drive.coordinates, HZ);
  const idsN = routerCrossedIds(normal), idsS = routerCrossedIds(safeLeg);
  if (idsN) alignCrossed(exN, idsN);
  if (idsN && idsS) alignCrossed(exD, new Set([...idsN, ...idsS]));
  // only hazards beyond the reroute point count as avoided (the part already driven is shared)
  const exNr = { crossed: exN.crossed.filter(e => (e.sIn ?? e.s) > sR) };
  const exDr = { crossed: exD.crossed.filter(e => (e.sIn ?? e.s) > sR) };
  const avoided = avoidedSites(exNr, exDr);
  const crossed = exDr.crossed;
  // steps along D (normal steps before sR, safe leg steps after)
  const steps = [];
  for (const st of normal.steps || []) { const p = project(N, toM(st.location)); if (p.s <= sR + 1 && p.d < 60) steps.push({ s: p.s, ...parseStep(st) }); }
  for (const st of (safeLeg?.steps || [])) { const p = project(D, toM(st.location)); if (p.s > sR - 1 && p.d < 60) steps.push({ s: p.s, ...parseStep(st) }); }
  steps.sort((a, b) => a.s - b.s);
  // events after sR
  const ev = [];
  const top = (arr, f) => arr.slice().sort((a, b) => f(b) - f(a))[0];
  const av = top(avoided, e => e.h.weight * (e.crit ? 1.4 : 1));
  if (av) { const p = project(D, toM(av.h.anchor)); if (p.s > sR + 400) ev.push({ kind: 'avoided', s: p.s, e: av, d: p.d }); }
  const cr = top(crossed, e => e.h.weight);
  if (cr) ev.push({ kind: 'crossed', s: cr.sIn ?? cr.s, e: cr });
  const nearList = exD.all.filter(e => !e.inside && e.d < 160 && e.s > sR + 400 && !crossed.includes(e));
  const nr = top(nearList, e => e.h.weight / (40 + e.d));
  if (nr && ev.every(x => Math.abs(x.s - nr.s) > 2500)) ev.push({ kind: 'near', s: nr.s, e: nr });
  ev.sort((a, b) => a.s - b.s);
  const dur = safeLeg ? (normal.duration_s * sR / N.length + safeLeg.duration_s) : normal.duration_s;
  return { normal, drive, N, D, sR, exN, exD, avoided, crossed, steps, events: ev, trip, dur, safeLeg, rerouted: !!safeLeg && safeLeg !== normal };
}

// sites worth a sticker: near either line
function stickerSites(model) {
  const ids = new Map();
  for (const ex of [model.exN, model.exD]) for (const e of ex.all) if (e.h.kind === 'hotspot' ? e.inside : e.d < 220) ids.set(e.h.id, e.h);
  return [...ids.values()];
}

// ------------------------------------------------------------------------------------------- cameras
function padFollow() { const H = innerHeight; return isPhone() ? { top: H * 0.4, bottom: 250, left: 0, right: 0 } : { top: H * 0.42, bottom: 10, left: 0, right: 400 }; }
function padOverview() { return isPhone() ? { top: 210, bottom: 250, left: 40, right: 40 } : { top: 130, bottom: 120, left: 240, right: 440 }; }
const MPP0 = 40075016.686 * Math.cos(20.62 * Math.PI / 180) / 512;
function zoomForSpeed(v) { const pxs = isPhone() ? 200 : 270; return clamp(Math.log2(MPP0 * pxs / Math.max(v, 1)), 12.9, 15.9) - (isPhone() ? 0.35 : 0); }
function headingAt(line, s, back, ahead) { const a = pointAt(line, s - back), b = pointAt(line, s + ahead); return Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI; }
function followCam(line, s, v) {
  const a = clamp(v * 0.9, 90, 1800);
  return { center: toLL(pointAt(line, s)), zoom: zoomForSpeed(v), bearing: headingAt(line, s, a * 0.35, a), pitch: 61 - clamp(v / 1500, 0, 1) * 4, pad: padFollow() };
}
function overviewCam(lines, bearing = -12, pitch = 42, roomLeft = false) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const l of lines) for (const [x, y] of l) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const pad = padOverview(); if (roomLeft && !isPhone()) pad.left = 520; if (roomLeft && isPhone()) pad.top = 330;
  const c = map.cameraForBounds([[x0, y0], [x1, y1]], { padding: pad, bearing }) || { center: [(x0 + x1) / 2, (y0 + y1) / 2], zoom: 11 };
  const ctr = c.center.toArray ? c.center.toArray() : [c.center.lng ?? c.center[0], c.center.lat ?? c.center[1]];
  return { center: ctr, zoom: c.zoom - 0.25, bearing, pitch, pad: { top: 0, bottom: 0, left: 0, right: 0 } };
}
function angLerp(a, b, u) { let d = ((b - a + 540) % 360) - 180; return a + d * u; }
function camLerp(a, b, u, geo = false) {
  const z = lerp(a.zoom, b.zoom, u);
  let k = u;
  if (geo && Math.abs(b.zoom - a.zoom) > 0.5) { const dz = b.zoom - a.zoom; k = (1 - Math.pow(2, -(z - a.zoom))) / (1 - Math.pow(2, -dz)); if (dz < 0) k = 1 - (1 - Math.pow(2, b.zoom - z)) / (1 - Math.pow(2, dz)); k = clamp(k, 0, 1); }
  const P = (p, q) => ({ top: lerp(p.top, q.top, u), bottom: lerp(p.bottom, q.bottom, u), left: lerp(p.left, q.left, u), right: lerp(p.right, q.right, u) });
  return { center: [lerp(a.center[0], b.center[0], k), lerp(a.center[1], b.center[1], k)], zoom: z, bearing: angLerp(a.bearing, b.bearing, u), pitch: lerp(a.pitch, b.pitch, u), pad: P(a.pad, b.pad) };
}

// speed profile: s(t) over [0,T] from s0 to s1, slowing near events; returns lookup fns
function profile(s0, s1, T, events, { vmin = 70, startSlow = true, endSlow = true } = {}) {
  const ramp = (x, w) => 1 - Math.exp(-((x / w) ** 2));
  const f = s => (startSlow ? ramp(s - s0, 700) : 1) * (endSlow ? ramp(s1 - s, 1000) : 1) * events.reduce((a, e) => a * (1 - 0.94 * Math.exp(-(((s - e.s) / (e.w || 650)) ** 2))), 1);
  const ds = 4, n = Math.max(2, Math.ceil((s1 - s0) / ds));
  const fs = []; for (let i = 0; i <= n; i++) fs.push(f(s0 + (s1 - s0) * i / n));
  const timeFor = vmax => { let t = 0; for (let i = 1; i <= n; i++) t += ((s1 - s0) / n) / (vmin + (vmax - vmin) * (fs[i] + fs[i - 1]) / 2); return t; };
  let lo = vmin, hi = 2e5; for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (timeFor(mid) > T) lo = mid; else hi = mid; }
  const vmax = (lo + hi) / 2, ts = [0];
  for (let i = 1; i <= n; i++) ts.push(ts[i - 1] + ((s1 - s0) / n) / (vmin + (vmax - vmin) * (fs[i] + fs[i - 1]) / 2));
  const scale = T / ts[n];
  const sAt = t => { t = clamp(t / scale, 0, ts[n]); let a = 0, b = n; while (b - a > 1) { const m = (a + b) >> 1; if (ts[m] <= t) a = m; else b = m; } const u = (t - ts[a]) / ((ts[b] - ts[a]) || 1); return s0 + (s1 - s0) * (a + u) / n; };
  const vAt = t => { const s = sAt(t); const i = clamp(Math.round((s - s0) / (s1 - s0) * n), 0, n); return (vmin + (vmax - vmin) * fs[i]) / scale; };
  const tAtS = s => ts[clamp(Math.round((s - s0) / (s1 - s0) * n), 0, n)] * scale;
  return { sAt, vAt, tAtS, vmax };
}

// ------------------------------------------------------------------------------------------- texts
const plural = (n, a, b) => n === 1 ? a : b;
function eventBubble(ev) {
  const h = ev.e.h, lines = hazardLines(h);
  if (ev.kind === 'avoided') return { mood: 'happy', tag: 'ok', stk: stkType(h), title: '¡Evitado!', text: `${h.ref}: ${lines.join(' · ') || STK[stkType(h)].label}. Pasamos lejos (≈${fmtKm(ev.d)}).`, src: hazardSrc(h) };
  if (ev.kind === 'crossed') return { mood: 'worried', tag: 'warn', stk: stkType(h) === 'underpass' ? 'underpass' : 'ponding', title: stkType(h) === 'underpass' ? 'Paso a desnivel inundable' : 'Encharcamiento reportado', text: `${h.ref}${h.range ? ` (${h.range.replace(/\s/g, '')} cm registrados)` : ''}. No hay otra vía razonable: despacito y sin meterse al agua.`, src: hazardSrc(h) };
  return { mood: 'surprised', tag: 'near', stk: stkType(h), title: `${STK[stkType(h)].short} a ${fmtKm(ev.e.d)}`, text: `${h.ref}. Lo rodeamos por un lado.`, src: hazardSrc(h) };
}

// ------------------------------------------------------------------------------------------- timelines
// segment: {t0,t1, fn(t)->partial frame}; bubbles: [{t0,t1,...}]
function makeTimeline(segs, bubbles, extras = {}) {
  const T = segs[segs.length - 1].t1;
  return { T, segs, bubbles, ...extras };
}
function segAt(tl, t) { for (const s of tl.segs) if (t < s.t1) return s; return tl.segs[tl.segs.length - 1]; }

// Keyframed drive: slow "dwell" windows around events so alerts play at a readable speed, fast in between.
function keyProfile(s0, s1, T, evs, { v0 = 60, v1 = 40, vEv = 240, win = 2.1 } = {}) {
  const hw0 = vEv * win / 2;
  let list = evs.filter(e => e.s > s0 + hw0 + 300 && e.s < s1 - hw0 - 300).sort((a, b) => a.s - b.s);
  list = list.filter((e, i) => i === 0 || e.s - list[i - 1].s > 2 * hw0 + 400);
  let w = Math.min(win, (T * 0.55) / Math.max(1, list.length)); const hw = vEv * w / 2;
  const K = [{ t: 0, s: s0, v: v0 }];
  const gaps = []; let prev = s0; for (const e of list) { gaps.push(e.s - hw - prev); prev = e.s + hw; } gaps.push(s1 - prev);
  const fastT = T - w * list.length, wts = gaps.map((g, i) => Math.sqrt(Math.max(g, 1)) * (i === gaps.length - 1 ? 1.6 : 1)), sum = wts.reduce((a, b) => a + b, 0);
  let t = 0; const times = [];
  list.forEach((e, i) => { t += fastT * wts[i] / sum; K.push({ t, s: e.s - hw, v: vEv }); times.push({ ...e, t: t + w / 2 }); t += w; K.push({ t, s: e.s + hw, v: vEv }); });
  K.push({ t: T, s: s1, v: v1 });
  const at = tt => {
    tt = clamp(tt, 0, T); let k = 0; while (k < K.length - 2 && K[k + 1].t < tt) k++;
    const a = K[k], b = K[k + 1], h = (b.t - a.t) || 1e-6, u = (tt - a.t) / h, u2 = u * u, u3 = u2 * u;
    const sv = (2 * u3 - 3 * u2 + 1) * a.s + (u3 - 2 * u2 + u) * h * a.v + (-2 * u3 + 3 * u2) * b.s + (u3 - u2) * h * b.v;
    const vv = ((6 * u2 - 6 * u) * a.s + (3 * u2 - 4 * u + 1) * h * a.v + (-6 * u2 + 6 * u) * b.s + (3 * u2 - 2 * u) * h * b.v) / h;
    return { s: clamp(sv, s0, s1), v: Math.max(0, vv) };
  };
  return { at, times };
}
const countLabel = list => {
  const obs = list.filter(e => e.h.kind !== 'hotspot').length, hot = list.length - obs, parts = [];
  if (obs) parts.push(`${obs} ${plural(obs, 'sitio inundable', 'sitios inundables')}`);
  if (hot) parts.push(`${hot} ${plural(hot, 'paso inferior', 'pasos inferiores')}`);
  return parts.join(' y ') || 'nada';
};

function buildDemo(m) {
  const T = { swoop: 2.0, drive1: 4.0, rain: 5.6, stop: 7.4, closeup: 8.4, ahead: 9.5, reveal: 9.7, revealEnd: 10.6, back: 11.3, arrive: 24.0, overview: 25.8, end: 28 };
  const { N, D, sR } = m, L = D.length;
  const ovIntro = overviewCam([m.normal.coordinates], -14, 40);
  const ovEnd = overviewCam([m.normal.coordinates, m.drive.coordinates], -8, 38, true);
  const fc0 = followCam(D, 0, 0);
  const d1 = (t) => { const u = clamp((t - T.drive1) / (T.stop - T.drive1), 0, 1); return { s: sR * (1 - Math.cos(Math.PI * u)) / 2, v: sR * Math.PI / (2 * (T.stop - T.drive1)) * Math.sin(Math.PI * u) }; };
  const kp = keyProfile(sR, L, T.arrive - T.back, m.events);
  const evTimes = kp.times.map(e => ({ ...e, t: T.back + e.t }));
  const hR = headingAt(D, sR, 40, 120);
  const ph = isPhone();
  const camClose = { center: toLL(pointAt(D, sR)), zoom: ph ? 16.4 : 16.9, bearing: hR + 150, pitch: 64, pad: ph ? { top: innerHeight * 0.3, bottom: 300, left: 0, right: 0 } : { top: innerHeight * 0.3, bottom: 40, left: 330, right: 400 } };
  const aheadS = Math.min(L, sR + 1500);
  const camAhead = { center: toLL(pointAt(D, aheadS)), zoom: ph ? 13.3 : 13.85, bearing: headingAt(D, sR + 1200, 1200, 1200), pitch: 50, pad: { top: ph ? 200 : 110, bottom: ph ? 250 : 200, left: ph ? 0 : 380, right: ph ? 0 : 400 } };
  const fR = followCam(D, sR, 60);
  const firstAv = m.avoided.slice().sort((a, b) => b.h.weight * (b.crit ? 1.4 : 1) - a.h.weight * (a.crit ? 1.4 : 1))[0];
  const extra = m.dur - m.normal.duration_s;
  const ovA = { ...ovIntro, bearing: ovIntro.bearing + 6, zoom: ovIntro.zoom + 0.12 }, aheadB = { ...camAhead, zoom: camAhead.zoom + 0.1, bearing: camAhead.bearing + 4 };
  const segs = [
    { t0: 0, t1: T.swoop, fn: t => ({ cam: camLerp(ovIntro, ovA, t / T.swoop), s: 0, v: 0, phase: 'intro' }) },
    { t0: T.swoop, t1: T.drive1, fn: t => ({ cam: camLerp(ovA, fc0, ease((t - T.swoop) / (T.drive1 - T.swoop)), true), s: 0, v: 0, phase: 'swoop' }) },
    { t0: T.drive1, t1: T.stop, fn: t => { const { s, v } = d1(t); return { cam: followCam(D, s, v), s, v, phase: 'drive1' }; } },
    { t0: T.stop, t1: T.closeup, fn: t => { const u = ease((t - T.stop) / (T.closeup - T.stop)); return { cam: camLerp(followCam(D, sR, 0), camClose, u), s: sR, v: 0, phase: 'reroute', boost: 1 + 1.1 * u }; } },
    { t0: T.closeup, t1: T.ahead, fn: t => { const u = ease((t - T.closeup) / (T.ahead - T.closeup)); return { cam: camLerp(camClose, camAhead, u, true), s: sR, v: 0, phase: 'reroute', boost: 2.1 - 1.1 * u }; } },
    { t0: T.ahead, t1: T.revealEnd, fn: t => ({ cam: camLerp(camAhead, aheadB, (t - T.ahead) / (T.revealEnd - T.ahead)), s: sR, v: 0, phase: 'reroute' }) },
    { t0: T.revealEnd, t1: T.back, fn: t => ({ cam: camLerp(aheadB, fR, ease((t - T.revealEnd) / (T.back - T.revealEnd)), true), s: sR, v: 0, phase: 'reroute' }) },
    { t0: T.back, t1: T.arrive, fn: t => { const { s, v } = kp.at(t - T.back); return { cam: followCam(D, s, v), s, v, phase: 'drive2' }; } },
    { t0: T.arrive, t1: T.overview, fn: t => ({ cam: camLerp(followCam(D, L, 40), ovEnd, ease((t - T.arrive) / (T.overview - T.arrive)), true), s: L, v: 0, phase: 'outro' }) },
    { t0: T.overview, t1: T.end, fn: t => ({ cam: camLerp(ovEnd, { ...ovEnd, bearing: ovEnd.bearing + 5 }, (t - T.overview) / (T.end - T.overview)), s: L, v: 0, phase: 'outro' }) }
  ];
  const bubbles = [
    { t0: 0.25, t1: T.swoop + 0.9, mood: 'happy', title: '', text: `¡Hola! Soy Gotita, tu copiloto. Vamos de ${m.trip.fromName} a ${m.trip.toName}.`, src: '' },
    { t0: T.drive1 + 0.1, t1: T.rain, mood: 'happy', title: '', text: `Cielo despejado: vamos por la ruta más rápida, ${fmtMin(m.normal.duration_s)}.`, src: '' },
    { t0: T.rain, t1: T.stop, mood: 'surprised', title: '', text: '¡Empezó a llover! Reviso dónde se ha inundado antes…', src: 'Capas: ' + hazardMetas.filter(l => activeLayerIds().includes(l.id) && l.kind !== 'water').map(l => l.label.replace(/\s*\(.*\)$/, '')).join(' · ') },
    firstAv && { t0: T.stop, t1: T.ahead + 0.1, mood: 'worried', tag: 'warn', stk: stkType(firstAv.h), title: STK[stkType(firstAv.h)].label + ' adelante', text: `${firstAv.h.ref}${hazardLines(firstAv.h).length ? ' · ' + hazardLines(firstAv.h).join(' · ') : ''}.`, src: hazardSrc(firstAv.h) },
    { t0: T.ahead + 0.1, t1: T.back + 0.6, mood: 'happy', tag: 'ok', stk: 'end', title: '¡Ruta segura lista!', text: `${extra > 30 ? '+' + fmtMin(extra) : 'Mismo tiempo'} y esquiva ${countLabel(m.avoided)} (｡•̀ᴗ-)✧`, src: 'Ruta: ' + routerLabel() },
    ...evTimes.map(e => ({ t0: Math.max(T.back + 0.7, e.t - 1.35), t1: Math.min(T.arrive, e.t + 1.6), ...eventBubble(e), ev: e })),
    { t0: T.arrive, t1: T.end + 1, mood: 'happy', title: '', text: '¡Llegamos secos! ヽ(＾▽＾)ノ', src: '' }
  ].filter(Boolean);
  for (let i = 0; i < bubbles.length - 1; i++) bubbles[i].t1 = Math.min(bubbles[i].t1, bubbles[i + 1].t0);
  return makeTimeline(segs, bubbles, {
    model: m, K: T, rainAt: T.rain, rerouteAt: T.stop, revealAt: [T.reveal, T.revealEnd], toast: [T.stop + 0.25, T.ahead - 0.05], summaryAt: T.overview - 0.7,
    hops: [T.rain, T.stop, ...evTimes.map(e => e.t - 1.3), T.arrive + 0.2], chipTapAt: T.rain - 0.15, depart: DEMO_DEPART, demo: true
  });
}

// interactive drive: swoop from current camera, drive the whole drive line, outro
function buildDrive(m, fromCam, startS = 0, opts = {}) {
  const L = m.D.length, Tdrive = clamp((L - startS) / 1400, 9, 26);
  const evs = m.events.filter(e => e.s > startS).map(e => ({ ...e, w: 700 }));
  const kp = keyProfile(startS, L, Tdrive, evs);
  const ov = overviewCam([m.normal.coordinates, m.drive.coordinates], -8, 38, true);
  const T0 = opts.reroute ? 3.4 : 1.6;
  const fS = followCam(m.D, startS, 70);
  const segs = [];
  if (opts.reroute) {
    const camAhead = { center: toLL(pointAt(m.D, Math.min(L, startS + 1500))), zoom: isPhone() ? 13.2 : 13.75, bearing: headingAt(m.D, startS + 1200, 1200, 1200), pitch: 50, pad: { top: isPhone() ? 200 : 120, bottom: isPhone() ? 250 : 40, left: 0, right: isPhone() ? 0 : 400 } };
    segs.push({ t0: 0, t1: 1.2, fn: t => ({ cam: camLerp(fromCam, camAhead, ease(t / 1.2), true), s: startS, v: 0, phase: 'reroute' }) });
    segs.push({ t0: 1.2, t1: 2.4, fn: t => ({ cam: camAhead, s: startS, v: 0, phase: 'reroute' }) });
    segs.push({ t0: 2.4, t1: T0, fn: t => ({ cam: camLerp(camAhead, fS, ease((t - 2.4) / (T0 - 2.4)), true), s: startS, v: 0, phase: 'reroute' }) });
  } else segs.push({ t0: 0, t1: T0, fn: t => ({ cam: camLerp(fromCam, fS, ease(t / T0), true), s: startS, v: 0, phase: 'swoop' }) });
  segs.push({ t0: T0, t1: T0 + Tdrive, fn: t => { const { s, v } = kp.at(t - T0); return { cam: followCam(m.D, s, v), s, v, phase: 'drive2' }; } });
  segs.push({ t0: T0 + Tdrive, t1: T0 + Tdrive + 2, fn: t => ({ cam: camLerp(followCam(m.D, L, 70), ov, ease((t - T0 - Tdrive) / 2), true), s: L, v: 0, phase: 'outro' }) });
  segs.push({ t0: T0 + Tdrive + 2, t1: T0 + Tdrive + 2.01, fn: t => ({ cam: ov, s: L, v: 0, phase: 'outro' }) });
  const evTimes = kp.times.map(e => ({ ...e, t: T0 + e.t }));
  const bubbles = [
    opts.reroute ? { t0: 0, t1: T0, mood: 'happy', tag: 'ok', stk: 'end', title: '¡Ruta nueva!', text: scenario?.id === 'dry' ? 'Ya no llueve: volvemos a la ruta más rápida.' : m.avoided.length ? `Esquiva ${countLabel(m.avoided)} que quedaban adelante.` : 'Por delante no hay sitios inundables registrados.', src: 'Ruta: ' + routerLabel() }
      : { t0: 0.1, t1: T0 + 1.5, mood: 'happy', title: '', text: scenario?.id === 'dry' ? 'Sin lluvia: ruta más rápida. ¡Vamos!' : `¡Vamos! Ruta segura: esquiva ${countLabel(m.avoided)}.`, src: 'Ruta: ' + routerLabel() },
    ...evTimes.map(e => ({ t0: Math.max(T0 + 0.5, e.t - 1.25), t1: e.t + 1.6, ...eventBubble(e), ev: e })),
    { t0: T0 + Tdrive, t1: T0 + Tdrive + 60, mood: 'happy', title: '', text: '¡Llegamos! ヽ(＾▽＾)ノ', src: '' }
  ];
  for (let i = 0; i < bubbles.length - 1; i++) bubbles[i].t1 = Math.min(bubbles[i].t1, bubbles[i + 1].t0);
  return makeTimeline(segs, bubbles, { model: m, rainAt: -1, revealAt: opts.reroute ? [0.4, 1.6] : null, rerouteAt: opts.reroute ? 0 : null, toast: opts.reroute ? [0, 1.1] : null, summaryAt: T0 + Tdrive + 1.4, hops: [0.2, ...evTimes.map(e => e.t - 1.2), T0 + Tdrive + 0.2], depart: new Date(), demo: false, startS, rainOn: scenario?.id !== 'dry' });
}

// ------------------------------------------------------------------------------------------- frame application
let lastStickerSet = null, lastBubbleKey = '', lastManeuver = '', paintCache = new Map(), lastChip = '';
function setPaint(id, prop, val) { const k = id + '|' + prop, s = typeof val === 'string' ? val : JSON.stringify(val); if (paintCache.get(k) === s) return; paintCache.set(k, s); try { map.setPaintProperty(id, prop, val); } catch (e) { } }
function grad(p, r, cTrav, cAhead) {
  const e = 1e-5; p = clamp(p, 0, 1); r = clamp(r, 0, 1); if (p > r) p = r;
  const ex = ['step', ['line-progress']];
  if (p > e) ex.push(cTrav, p, cAhead); else ex.push(cAhead);
  if (r < 1 - e) ex.push(Math.max(r, (p > e ? p : 0) + e), 'rgba(255,255,255,0)');
  return ex.length === 3 ? solid(ex[2]) : ex;
}
const solid = c => ['interpolate', ['linear'], ['line-progress'], 0, c, 1, c];
const pop = x => x <= 0 ? 0 : 1 - Math.exp(-x * 8) * Math.cos(x * 15);
const bump = x => x > 0 && x < 0.55 ? Math.sin(Math.PI * x / 0.55) : 0;

function renderAt(tl, t) {
  timeline = tl; const m = tl.model; t = clamp(t, 0, tl.T); timelineT = t;
  const seg = segAt(tl, t); const f = seg.fn(t);
  const L = m.D.length;
  // ---- camera
  const c = f.cam;
  const bad = [c.center[0], c.center[1], c.zoom, c.bearing, c.pitch, c.pad.top, c.pad.bottom, c.pad.left, c.pad.right].some(x => !Number.isFinite(x));
  if (bad) console.error('bad camera', f.phase, t, JSON.stringify(c));
  else map.jumpTo({ center: c.center, zoom: c.zoom, bearing: c.bearing, pitch: c.pitch, padding: c.pad });
  // ---- weather / scenario
  const rain = tl.demo ? clamp((t - tl.rainAt) / 0.9, 0, 1) : (tl.rainOn ? 1 : 0);
  const chipRain = tl.demo ? t >= tl.rainAt - 0.1 : tl.rainOn;
  drawRain(t, rain);
  $('tint').style.opacity = (rain * 0.5).toFixed(3);
  $('clouds').style.opacity = rain.toFixed(3); $('clouds').style.transform = `translateY(${(-30 + 30 * ease(rain)).toFixed(1)}px)`;
  for (const l of hazardLayerIds) setPaint(l.id, l.prop, +(l.max * (activeLayerIds().includes(l.layer) ? rain : 0)).toFixed(3));
  const chipKey = (chipRain ? (scenario?.id === 'dry' ? scenarios[1]?.id : scenario?.id) : 'dry') + (tl.chipTapAt && Math.abs(t - tl.chipTapAt) < 0.25 ? '!' : '');
  if (chipKey !== lastChip) { lastChip = chipKey; renderChips(chipKey.replace('!', ''), chipKey.endsWith('!')); }
  // ---- routes
  const rerouted = tl.rerouteAt == null ? true : t >= tl.rerouteAt;
  const rv = tl.revealAt ? ease((t - tl.revealAt[0]) / (tl.revealAt[1] - tl.revealAt[0])) : 1;
  const sN = Math.min(f.s, m.N.length);
  if (tl.demo && !rerouted) {
    // dry: the normal route is the active one
    const p = sN / m.N.length;
    setPaint('rn-line', 'line-gradient', grad(p, 1, '#bfeee0', '#22c79e')); setPaint('rn-case', 'line-gradient', solid('#ffffff'));
    for (const id of ['rn-line', 'rn-case']) setPaint(id, 'line-opacity', 1); setPaint('rn-glow', 'line-opacity', 0.32);
    for (const id of ['rn-dots', 'rn-dots-case', 'rd-line', 'rd-case', 'rd-glow']) setPaint(id, 'line-opacity', 0);
  } else {
    const fadeOld = tl.demo ? ease((t - tl.rerouteAt - 0.3) / 1.2) : 1;
    const pN = m.sR / m.N.length;
    setPaint('rn-line', 'line-gradient', grad(pN, 1, '#bfeee0', '#22c79e'));
    setPaint('rn-line', 'line-opacity', +(1 - fadeOld).toFixed(3)); setPaint('rn-case', 'line-opacity', +(1 - fadeOld).toFixed(3)); setPaint('rn-glow', 'line-opacity', +(0.32 * (1 - fadeOld)).toFixed(3));
    const showNormal = m.rerouted || !tl.demo;
    setPaint('rn-dots', 'line-opacity', showNormal ? +(0.95 * fadeOld).toFixed(3) : 0); setPaint('rn-dots-case', 'line-opacity', showNormal ? +(0.9 * fadeOld).toFixed(3) : 0);
    const r0 = m.sR / L, reveal = r0 + (1 - r0) * rv, p = f.s / L;
    setPaint('rd-line', 'line-gradient', grad(p, reveal, '#bfeee0', '#22c79e')); setPaint('rd-case', 'line-gradient', grad(0, reveal, '#ffffff', '#ffffff'));
    for (const id of ['rd-line', 'rd-case']) setPaint(id, 'line-opacity', 1); setPaint('rd-glow', 'line-opacity', +(0.34 * rv).toFixed(3));
  }
  // ---- car
  const line = (tl.demo && !rerouted) ? m.N : m.D;
  const v = f.v || 0;
  const bk = Math.max(8, v * 0.04), ah = Math.max(22, v * 0.1);
  car.state.lngLat = toLL(pointAt(line, f.s));
  car.state.heading = headingAt(line, f.s, bk, ah);
  car.state.dist = f.s; car.state.t = t; car.state.moving = clamp(v / 150, 0, 1);
  const zoom = c.zoom; const px = isPhone() ? 78 : 118;
  car.state.meters = clamp(lerp(0.42, 1, (zoom - 11) / 4), 0.42, 1.08) * px * MPP0 / Math.pow(2, zoom) * (f.boost || 1);
  car.state.hop = Math.max(0, ...tl.hops.map(h => bump(t - h)));
  car.state.wave = f.phase === 'intro' || f.phase === 'outro' ? 1 : 0;
  // ---- stickers
  const rainLocal = rain;
  const carM = pointAt(line, f.s);
  for (const p of pins) p.setLngLat(p.getLngLat());
  for (const st of stickers.values()) {
    const h = st.h;
    st.marker.setLngLat(h.anchor);
    if (!activeLayerIds().includes(h.layer) || rainLocal <= 0) { if (st.last !== 'h') { st.el.style.visibility = 'hidden'; st.last = 'h'; } continue; }
    const am = toM(h.anchor); const dist = Math.hypot(am[0] - carM[0], am[1] - carM[1]);
    const appear = tl.demo ? tl.rainAt + 0.2 + clamp(dist / 9000, 0, 1) * 0.9 : -1;
    const sc = tl.demo ? pop(t - appear) : 1;
    const avoided = m.avoided.some(e => e.h.id === h.id) && (rerouted && (tl.revealAt ? t > tl.revealAt[1] - 0.2 : true));
    const warn = m.crossed.some(e => e.h.id === h.id) && rerouted;
    const bub = currentBubble(tl, t); const focus = bub?.ev?.e?.h?.id === h.id || (bub?.stk && bub.tag === 'warn' && !rerouted && m.avoided[0]?.h.id === h.id);
    const py = sc > 0.01 ? map.project(h.anchor).y : 0; const persp = clamp(0.5 + 0.62 * py / innerHeight, 0.5, 1.12);
    const key = [(sc * persp).toFixed(3), avoided, warn, focus].join();
    if (key === st.last) continue; st.last = key;
    st.el.style.visibility = sc > 0.01 ? 'visible' : 'hidden';
    st.pop.style.transform = `scale(${(sc * persp).toFixed(3)})`; st.bdg.style.transform = `scale(${persp.toFixed(3)})`;
    st.el.classList.toggle('ok', avoided); st.el.classList.toggle('warn', warn && !avoided); st.el.classList.toggle('focus', !!focus);
    st.bdg.innerHTML = avoided ? badgeSVG('ok') : warn ? badgeSVG('warn') : '';
    st.el.style.zIndex = focus ? 3 : avoided ? 2 : 1;
  }
  if (pins[0]) { const show = f.s < 120 && (f.phase === 'intro' || f.phase === 'swoop' || !tl.demo && f.phase !== 'drive2') ? 1 : 0; pins[0].getElement().classList.toggle('gone', !show); }
  // ---- bubble
  const b = currentBubble(tl, t);
  const bel = $('bubble');
  if (b) {
    const key = b.t0 + b.text;
    if (key !== lastBubbleKey) {
      lastBubbleKey = key;
      $('b-tag').innerHTML = b.title ? (b.stk ? `<span class="tg" style="background:${STK[b.stk].bg}">${stickerSVG(b.stk, 30)}${esc(b.title)}</span>` : esc(b.title)) : '';
      $('b-text').textContent = b.text; $('b-src').textContent = b.src || '';
      $('gotita').className = 'gotita-wrap mood-' + (b.mood || 'happy');
    }
    const a = pop((t - b.t0) * 1.1), out = clamp((b.t1 - t) / 0.18, 0, 1);
    bel.style.opacity = Math.min(1, (t - b.t0) / 0.12, out).toFixed(3);
    bel.style.transform = `scale(${(0.55 + 0.45 * a) * (0.85 + 0.15 * out)})`;
  } else bel.style.opacity = 0;
  const g = $('gotita'); const hop = car.state.hop;
  g.style.transform = `translateY(${(-hop * 26 - Math.abs(Math.sin(t * 3.2)) * 4).toFixed(1)}px) scale(${(1 + hop * 0.06).toFixed(3)},${(1 - hop * 0.05).toFixed(3)}) rotate(${(Math.sin(t * 2.1) * 3).toFixed(2)}deg)`;
  // ---- toast + summary
  const ta = tl.toast ? clamp(Math.min((t - tl.toast[0]) / 0.2, (tl.toast[1] - t) / 0.2), 0, 1) : 0;
  const toast = $('toast'); toast.style.opacity = ta.toFixed(3);
  toast.style.transform = (isPhone() ? 'translate(-50%,0)' : 'translate(calc(-50% - 190px),0)') + ` scale(${(0.6 + 0.4 * pop((t - (tl.toast?.[0] ?? 0)) * 1.2)).toFixed(3)})`;
  toast.querySelector('.spin').style.transform = `rotate(${(t * 540) % 360}deg)`;
  const sa = tl.summaryAt != null ? pop((t - tl.summaryAt) * 1.1) : 0;
  const sum = $('summary'); sum.style.opacity = clamp((t - (tl.summaryAt ?? 1e9)) / 0.15, 0, 1).toFixed(3);
  sum.style.transform = `scale(${(0.6 + 0.4 * sa).toFixed(3)})`;
  const dim = tl.demo && !(t >= tl.rerouteAt + 1.9);
  if ($('row-safe').classList.contains('dim') !== dim) { $('row-safe').classList.toggle('dim', dim); $('avoided').classList.toggle('dim', dim); }
  // ---- maneuver + tripbar
  renderManeuver(m, line === m.N ? m.normal : null, f, tl, rerouted);
  renderTrip(m, f, tl, t, rerouted);
  map.triggerRepaint();
}

function currentBubble(tl, t) { let r = null; for (const b of tl.bubbles) if (t >= b.t0 && t < b.t1) r = b; return r; }

function renderManeuver(m, normalOnly, f, tl, rerouted) {
  let steps = m.steps;
  if (normalOnly) steps = (m.normal.steps || []).map(st => ({ s: project(m.N, toM(st.location)).s, ...parseStep(st) })).sort((a, b) => a.s - b.s);
  const s = f.s;
  let nx = steps.find(st => st.s > s + 15 && st.type !== 'depart');
  if (f.phase === 'intro' || f.phase === 'swoop') nx = steps.find(st => st.type !== 'depart' && st.s > 15) || nx;
  let key, dist, text, street, icon;
  if (f.phase === 'outro' || s >= m.D.length - 5) { dist = '¡Llegaste!'; text = m.trip.toName; street = 'Sin mojarte los pies'; icon = 'arrive'; }
  else if (f.phase === 'reroute' && tl.toast && tl.toast[1] > (timelineT ?? 0)) { dist = 'Recalculando'; text = 'Buscando calles más secas'; street = ''; icon = 'round'; }
  else if (nx) { dist = fmtKm(nx.s - s); text = nx.text; street = nx.street ? 'por ' + nx.street : ''; icon = nx.mod; }
  else { dist = fmtKm(m.D.length - s); text = 'Sigue derecho'; street = ''; icon = 'straight'; }
  key = [dist, text, street, icon].join('|');
  if (key === lastManeuver) return; lastManeuver = key;
  $('mv-dist').textContent = dist; $('mv-text').textContent = text; $('mv-street').textContent = street; $('mv-ico').innerHTML = arrowSVG(icon);
}
let timelineT = 0;

function renderTrip(m, f, tl, t, rerouted) {
  const L = (tl.demo && !rerouted) ? m.N.length : m.D.length;
  const dur = (tl.demo && !rerouted) ? m.normal.duration_s : m.dur;
  const done = clamp(f.s / L, 0, 1);
  const eta = new Date(tl.depart.getTime() + dur * 1000);
  $('tb-eta').textContent = fmtClock(eta); const arrived = done > 0.999; $('tb-min').textContent = arrived ? '0 min' : fmtMin(dur * (1 - done)); $('tb-km').textContent = arrived ? '0 m' : fmtKm(Math.max(0, L - f.s));
  const realV = L / dur; const k = (f.v || 0) / realV;
  const ff = f.phase === 'intro' || f.phase === 'outro' ? 'vista general' : f.phase === 'reroute' ? 'pausa' : k > 1.5 ? `cámara rápida ×${k > 50 ? Math.round(k / 10) * 10 : Math.round(k)}` : 'cámara rápida';
  if ($('tb-ff').textContent !== ff) $('tb-ff').textContent = ff;
}

// ------------------------------------------------------------------------------------------- rain canvas
const rc = $('rain'), rctx = rc.getContext('2d');
let drops = [];
function sizeRain() { const d = Math.min(2, devicePixelRatio || 1); rc.width = innerWidth * d; rc.height = innerHeight * d; rctx.setTransform(d, 0, 0, d, 0, 0); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; drops = Array.from({ length: Math.round(innerWidth * innerHeight / 6500) }, () => ({ x: rnd(), y: rnd(), v: 0.7 + rnd() * 0.6, l: 10 + rnd() * 16, w: rnd() < 0.15 ? 3 : 1.8, round: rnd() < 0.08 })); }
function drawRain(t, k) {
  const W = innerWidth, H = innerHeight; rctx.clearRect(0, 0, W, H); if (k <= 0) return;
  rctx.lineCap = 'round';
  for (const d of drops) {
    const y = ((d.y * (H + 60) + t * 620 * d.v) % (H + 60)) - 30, x = ((d.x * (W + 80) - t * 120 * d.v) % (W + 80) + W + 80) % (W + 80) - 40;
    if (d.round) { rctx.fillStyle = `rgba(150,205,255,${0.75 * k})`; rctx.beginPath(); rctx.ellipse(x, y, 3.2, 4.2, 0, 0, 7); rctx.fill(); continue; }
    rctx.strokeStyle = `rgba(255,255,255,${0.8 * k})`; rctx.lineWidth = d.w + 1.6; rctx.beginPath(); rctx.moveTo(x, y); rctx.lineTo(x - d.l * 0.2, y + d.l); rctx.stroke();
    rctx.strokeStyle = `rgba(120,170,245,${0.55 * k})`; rctx.lineWidth = d.w; rctx.beginPath(); rctx.moveTo(x, y); rctx.lineTo(x - d.l * 0.2, y + d.l); rctx.stroke();
  }
}

// ------------------------------------------------------------------------------------------- panel
function scenarioIcon(id) { return id === 'dry' ? `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5.5" fill="#ffd25e" stroke="#5b3a63" stroke-width="1.8"/><g stroke="#f2a93b" stroke-width="2.2" stroke-linecap="round"><path d="M12 1.8v2.4M12 19.8v2.4M1.8 12h2.4M19.8 12h2.4M4.8 4.8l1.7 1.7M17.5 17.5l1.7 1.7M4.8 19.2l1.7-1.7M17.5 6.5l1.7-1.7"/></g></svg>`
  : `<svg viewBox="0 0 24 24"><path d="M7 15a4.5 4.5 0 0 1 .6-9 6 6 0 0 1 11 2.2A3.5 3.5 0 0 1 18 15z" fill="#fff" stroke="#5b3a63" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" stroke="#62b4ff" stroke-width="2.2" stroke-linecap="round"/></svg>`; }
function buildScenarios() {
  scenarios = [{ id: 'dry', label: 'Seco', layers: [] }];
  const obs = hazardMetas.filter(l => ['observed', 'hotspot', 'water'].includes(l.kind));
  if (obs.length) scenarios.push({ id: 'obs', label: 'Lluvia', kind: 'historial', layers: obs.map(l => l.id) });
  for (const l of hazardMetas.filter(l => l.kind === 'modeled')) scenarios.push({ id: 'm-' + l.id, label: l.scenarioLabel || l.label?.split('(')[0].trim().slice(0, 26) || l.id, kind: l.kind === 'modeled' ? 'modelo' : l.kind, layers: [...obs.map(o => o.id), l.id] });
  scenario = scenarios[1] || scenarios[0];
}
const activeLayerIds = () => (scenario && scenario.id !== 'dry' ? scenario : scenarios[1] || { layers: [] }).layers;
function renderChips(activeId, tap = false) {
  $('scenario').innerHTML = scenarios.map(s => `<button class="chip ${s.id === activeId ? 'on' : ''} ${s.id === 'dry' ? 'dry' : ''} ${tap && s.id === activeId ? 'tap' : ''}" data-id="${s.id}">${scenarioIcon(s.id)}${esc(s.label)}${s.kind ? `<span class="kind">${esc(s.kind)}</span>` : ''}</button>`).join('');
}
function routerLabel() { return /stub/.test(routerInfo.engine) ? 'OSRM demo (provisional) + desvío en el navegador' : 'router cauce · OSM 2026-10-29'; }
function renderPanel(m, rerouted = true) {
  $('from-name').textContent = m.trip.fromName; $('to-name').textContent = m.trip.toName;
  $('engine-pill').textContent = /stub/.test(routerInfo.engine) ? 'router provisional' : 'router cauce';
  $('credit-router').textContent = /stub/.test(routerInfo.engine) ? 'OSRM demo (OSM), provisional' : routerInfo.engine;
  $('credit-router-s').textContent = /stub/.test(routerInfo.engine) ? 'OSRM demo' : 'router cauce (OSM)';
  const nCross = m.exN.crossed.length, sCross = m.crossed.length + m.exD.crossed.filter(e => (e.sIn ?? e.s) <= m.sR).length;
  $('safe-time').textContent = fmtMin(m.dur); $('safe-sub').innerHTML = `${fmtKm(m.D.length)} · ${sCross}<span class="long"> ${plural(sCross, 'punto de riesgo', 'puntos de riesgo')}</span><span class="short"> riesgos</span>`;
  $('normal-time').textContent = fmtMin(m.normal.duration_s); $('normal-sub').innerHTML = `${fmtKm(m.N.length)} · ${nCross}<span class="long"> ${plural(nCross, 'punto de riesgo', 'puntos de riesgo')}</span><span class="short"> riesgos</span>`;
  const li = [];
  for (const e of m.avoided.slice().sort((a, b) => (b.h.kind !== 'hotspot') - (a.h.kind !== 'hotspot') || b.h.weight - a.h.weight).slice(0, 4)) li.push(`<li>${stickerSVG(stkType(e.h), 30)}<span>${esc(e.h.ref)}<small>evitado · ${esc(hazardLines(e.h)[0] || STK[stkType(e.h)].label)}</small></span></li>`);
  for (const e of m.crossed.slice().sort((a, b) => b.h.weight - a.h.weight).slice(0, 1)) li.push(`<li class="warn">${stickerSVG(stkType(e.h), 30)}<span>${esc(e.h.ref)}<small>sin alternativa razonable · ${esc(hazardLines(e.h)[0] || '')}</small></span></li>`);
  $('avoided').innerHTML = li.join('') || '<li class="muted">Nada que esquivar en este escenario.</li>';
}
function renderSummary(m) {
  const av = m.avoided.slice().sort((a, b) => (b.h.kind !== 'hotspot') - (a.h.kind !== 'hotspot') || b.h.weight - a.h.weight);
  $('sm-stk').innerHTML = [...new Set(av.map(e => stkType(e.h)))].slice(0, 3).map(k => stickerSVG(k, 46)).join('') + stickerSVG('end', 46);
  $('sm-title').textContent = '¡Llegamos secos!';
  const extra = m.dur - m.normal.duration_s;
  const crObs = m.crossed.filter(e => e.h.kind !== 'hotspot'), crHot = m.crossed.length - crObs.length;
  const names = av.filter(e => e.h.kind !== 'hotspot').slice(0, 2).map(e => `<b>${esc(e.h.ref)}</b>`).join(' y ');
  $('sm-text').innerHTML = (m.avoided.length ? `Esquivamos ${countLabel(m.avoided)}${names ? `, como ${names}` : ''}. ` : 'No hubo nada que esquivar. ') +
    (extra > 30 ? `Costo: <b>+${fmtMin(extra)}</b>. ` : '') +
    (m.crossed.length ? `<br><span class="sm-warn">Sin alternativa razonable: ${[...crObs.slice(0, 1).map(e => esc(e.h.ref)), crObs.length > 1 ? `${crObs.length - 1} ${plural(crObs.length - 1, 'sitio más', 'sitios más')}` : '', crHot ? `${crHot} ${plural(crHot, 'paso inferior', 'pasos inferiores')}` : ''].filter(Boolean).join(', ')}.</span>` : '');
}
// ------------------------------------------------------------------------------------------- settle (capture)
async function settle() {
  const once = ev => new Promise(r => map.once(ev, r));
  const timeout = ms => new Promise(r => setTimeout(r, ms));
  map.triggerRepaint(); await Promise.race([once('render'), timeout(500)]);
  const t0 = performance.now();
  while (!map.areTilesLoaded() && performance.now() - t0 < 9000) await timeout(40);
  map.triggerRepaint(); await Promise.race([once('idle'), timeout(2500)]);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

// ------------------------------------------------------------------------------------------- playback
let playing = false, playStart = 0, playTl = null, playOffset = 0;
function play(tl, from = 0, loop = false) {
  playTl = tl; playOffset = from; playStart = performance.now(); playing = true;
  const step = () => {
    if (!playing || playTl !== tl) return;
    let t = playOffset + (performance.now() - playStart) / 1000;
    if (t > tl.T) { if (loop) { playStart = performance.now() + 1500; playOffset = 0; t = tl.T; } else { renderAt(tl, tl.T); playing = false; onPlayEnd(tl); return; } }
    timelineT = t; renderAt(tl, Math.max(0, t)); requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function onPlayEnd(tl) { $('btn-drive').textContent = '▶ Conducir otra vez'; }

// ------------------------------------------------------------------------------------------- interactive
let model = null, cache = new Map();
async function planModel(trip, sc, fromS = null, prev = null) {
  const hzSel = { list: HZ.list.filter(h => sc.layers.includes(h.layer)), near: HZ.near };
  const sub = filterIndex(sc.layers);
  if (fromS == null) {
    const p = await plan(router, trip.from, trip.to, sub, { cache, hazardIds: sc.layers });
    return buildModelWith(filterIndex(activeLayerIds()), p.normal, p.safe, 0, p.safe, trip);
  }
  // reroute from current position on the previous drive line
  const at = toLL(pointAt(prev.D, fromS));
  const p = await plan(router, at, trip.to, sub, { cache, hazardIds: sc.layers });
  const head = { coordinates: [...sliceLineLL(prev.D, 0, fromS), ...p.safe.coordinates.slice(1)], distance_m: fromS + p.safe.distance_m, duration_s: 0, steps: [] };
  const mm = buildModelWith(filterIndex(activeLayerIds()), prev.normal, head, fromS, p.safe, trip);
  mm.dur = prev.dur * fromS / prev.D.length + p.safe.duration_s;
  return mm;
}
function sliceLineLL(line, s0, s1) { const out = []; for (let i = 0; i < line.cum.length; i++) if (line.cum[i] >= s0 && line.cum[i] <= s1) out.push(line.coords[i]); out.push(toLL(pointAt(line, s1))); return out; }
const subIdx = new Map();
function filterIndex(layers) {
  const k = layers.join('|'); if (subIdx.has(k)) return subIdx.get(k);
  const sub = subset(HZ, h => layers.includes(h.layer));
  subIdx.set(k, sub); return sub;
}
function setRouteData(m) {
  map.getSource('r-normal').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: m.normal.coordinates } });
  map.getSource('r-drive').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: m.drive.coordinates } });
  const want = new Set(stickerSites(m).map(h => h.id));
  for (const [id, st] of stickers) if (!want.has(id)) { st.marker.remove(); stickers.delete(id); }
  for (const h of stickerSites(m)) if (!stickers.has(h.id)) makeSticker(h);
}
function overviewTimeline(m) {
  const ov = overviewCam([m.normal.coordinates, m.drive.coordinates], -8, 38);
  return makeTimeline([{ t0: 0, t1: 0.01, fn: () => ({ cam: ov, s: 0, v: 0, phase: 'intro' }) }],
    [{ t0: -1, t1: 1e9, mood: 'happy', title: '', text: scenario.id === 'dry' ? 'Sin lluvia, la ruta normal está bien. Prueba «Lluvia» para ver qué esquivamos.' : m.avoided.length ? `Con lluvia, la ruta segura esquiva ${countLabel(m.avoided)}. Toca ▶ Conducir.` : 'Esta ruta no cruza sitios inundables registrados. ¡Bien!', src: 'Ruta: ' + routerLabel() }],
    { model: m, rainAt: -1, rerouteAt: null, revealAt: null, toast: null, summaryAt: null, hops: [], depart: new Date(), demo: false, rainOn: scenario.id !== 'dry' });
}
async function interactiveReplan(trip, keepDriving) {
  const tl = playing ? playTl : timeline;
  const s = playing ? (segAt(tl, timelineT).fn(timelineT).s) : 0;
  const cam = { center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), pad: map.getPadding() };
  playing = false;
  if (keepDriving && model && s > 50 && s < model.D.length - 300) {
    $('toast').style.opacity = 1;
    const m = await planModel(trip, scenario, s, model); model = m; setRouteData(m); renderPanel(m); renderSummary(m);
    play(buildDrive(m, cam, s, { reroute: true }), 0);
  } else {
    const m = await planModel(trip, scenario); model = m; setRouteData(m); renderPanel(m); renderSummary(m);
    renderAt(overviewTimeline(m), 0);
  }
}
function wireInteractive() {
  $('scenario').addEventListener('click', async e => {
    const b = e.target.closest('.chip'); if (!b || DEMO) return;
    scenario = scenarios.find(s => s.id === b.dataset.id) || scenario; lastChip = '';
    await interactiveReplan(TRIP, playing);
  });
  $('btn-drive').addEventListener('click', () => {
    if (!model) return;
    const cam = { center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), pad: map.getPadding() };
    $('btn-drive').textContent = '■ Detener';
    if (playing) { playing = false; renderAt(overviewTimeline(model), 0); $('btn-drive').textContent = '▶ Conducir'; return; }
    play(buildDrive(model, cam, 0));
  });
  let pick = null;
  $('btn-pick').addEventListener('click', () => { playing = false; pick = 'from'; document.body.classList.add('picking'); $('pick-what').textContent = 'origen'; });
  map.on('click', async e => {
    if (!pick) return;
    const ll = [+e.lngLat.lng.toFixed(5), +e.lngLat.lat.toFixed(5)];
    if (pick === 'from') { TRIP.from = ll; TRIP.fromName = 'Punto A'; pick = 'to'; $('pick-what').textContent = 'destino'; return; }
    TRIP.to = ll; TRIP.toName = 'Punto B'; pick = null; document.body.classList.remove('picking');
    setPins(TRIP); await interactiveReplan(TRIP, false);
  });
  for (const l of hazardLayerIds) if (/-(site|crit|f)$/.test(l.id)) map.on('click', l.id, e => {
    if (pick) return; const f = e.features?.[0]; if (!f) return;
    const code = (f.properties.name || '').split('/')[0]; const h = HZ.list.find(x => x.id === code); if (h) showPopup(h, e.originalEvent.clientX, e.originalEvent.clientY);
  });
}

// ------------------------------------------------------------------------------------------- boot
function sayLoading(text) {
  $('b-tag').innerHTML = ''; $('b-text').textContent = text; $('b-src').textContent = '';
  $('gotita').className = 'gotita-wrap mood-happy'; $('bubble').style.opacity = 1; $('bubble').style.transform = 'scale(1)';
}
async function boot() {
  const [layers] = await Promise.all([loadHazards(), mapLoaded]);
  hazardMetas = layers.map(l => l.meta);
  HZ = buildHazards(layers.filter(l => l.data));
  makePatterns(map); addHazardLayers(layers); addRouteLayers(); map.addLayer(car.layer);
  buildScenarios(); renderChips(scenario?.id); sizeRain();
  let m;
  if (DEMO && DEFAULT_TRIP && !LIVE) {
    // baked routes: filming never depends on the router download or a public server
    const d = await (await fetch('./data/demo-route.json')).json();
    routerInfo.engine = d.engine;
    const sub = filterIndex(scenarios[1]?.layers || []);
    const drive = { coordinates: [...sliceLineLL(measure(d.normal.coordinates), 0, d.reroute.s), ...d.safeFromReroute.coordinates.slice(1)] };
    m = buildModelWith(sub, d.normal, drive, d.reroute.s, d.safeFromReroute, TRIP);
  } else {
    car.state.visible = false;
    $('boot').classList.add('gone');
    sayLoading('Estoy cargando las calles de la ciudad (≈5 MB)… un momentito (｡•ᴗ•｡)');
    const mod = await import('/labs/shared/router/router.js');
    router = await mod.loadRouter(); routerInfo.engine = router.engine || 'router';
    sayLoading('Calles listas. Buscando la ruta que menos se moja…');
    if (DEMO) {
      const sub = filterIndex(scenarios[1]?.layers || []), ids = scenarios[1]?.layers || [];
      const p = await plan(router, TRIP.from, TRIP.to, sub, { cache, hazardIds: ids });
      const N = measure(p.normal.coordinates), S = measure(p.safe.coordinates); let sDiv = null;
      for (let s = 0; s < N.length; s += 10) if (project(S, pointAt(N, s)).d > 25) { sDiv = s; break; }
      const sR = Math.max(400, (sDiv ?? 2000) - 350);
      const q = await plan(router, toLL(pointAt(N, sR)), TRIP.to, sub, { cache, hazardIds: ids });
      m = buildModelWith(sub, p.normal, { coordinates: [...sliceLineLL(N, 0, sR), ...q.safe.coordinates.slice(1)] }, sR, q.safe, TRIP);
    } else m = await planModel(TRIP, scenario);
    car.state.visible = true;
  }
  model = m;
  setPins(TRIP); setRouteData(m); renderPanel(m); renderSummary(m); renderChips(scenario?.id);
  await document.fonts.ready;
  if (DEMO) { demoTimeline = buildDemo(m); window.__cauceDemo.duration_s = demoTimeline.T; renderAt(demoTimeline, 0); }
  else { wireInteractive(); renderAt(overviewTimeline(m), 0); }
  $('boot').classList.add('gone');
  window.__mochi = { map, get model() { return model; }, pins, stickers, TRIP };
  resolveReady();
  if (DEMO && !Q.has('capture')) { await settle(); play(demoTimeline, 0, true); }
}
let HZsub = null;
function buildModelWith(sub, normal, drive, sR, safeLeg, trip) { const keep = HZ; HZ = sub; try { return buildModel(normal, drive, sR, safeLeg, trip); } finally { HZ = keep; } }
addEventListener('resize', () => { sizeRain(); if (DEMO && demoTimeline) { demoTimeline = buildDemo(demoTimeline.model); if (playing) playTl = demoTimeline, play(demoTimeline, timelineT, true); else renderAt(demoTimeline, timelineT); } });
boot().catch(e => { console.error(e); $('boot').querySelector('p').textContent = 'Ups: ' + e.message; sayLoading('Ups, no pude calcular la ruta: ' + e.message); });
