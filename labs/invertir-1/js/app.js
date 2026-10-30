// cauce. · dónde invertir — editorial priority atlas (invertir-1)
import * as M from './model.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';
const app = $('#app');
if (DEMO) app.classList.add('demo');
const isPhone = () => innerWidth <= 760;

const URLS = {
  profile: '/labs/shared/infra/ageb-profile.geojson',
  compact: './data/agebs.json',
  extras: './data/ageb-extras.json',
  imeplan: '/labs/shared/hazard/observed-imeplan-2026.geojson',
  facilities: '/labs/shared/infra/exposure-facilities.geojson',
  hazardIndex: '/labs/shared/hazard/index.json',
  terrainIndex: '/labs/shared/terrain/index.json',
};
// Simulation per-AGEB joins: plug in as modeled hazard factors when they can be fetched.
const JOINS = [
  { id: 'sim_drenaje', producer: 'sim-drenaje', url: '/labs/shared/hazard/modeled/sim-drenaje/ageb-drainage.json', status: '/labs/shared/status/sim-drenaje.json',
    fields: ['flood_frequency'], w: 1, zeroIsNone: true,
    label: 'Inundación modelada (drenaje)', src: 'cauce. sim-drenaje · ensamble 20 m',
    desc: 'Frecuencia con que las celdas urbanas del AGEB pasan de 15 cm en un ensamble de tormentas (Tr 2–100 años) × capacidad de drenaje (0–60 mm/h). Sin red de colectores: el drenaje es un sumidero uniforme.',
    fmt: v => `${Math.round(v * 100)} % frecuencia`, exposure: 'population_exposed_ref' },
  { id: 'sim_relieve', producer: 'sim-relieve', url: '/labs/shared/hazard/modeled/sim-relieve/ageb-terrain.json', status: '/labs/shared/status/sim-relieve.json',
    fields: ['susc_mean', 'susc_p90', 'susceptibility', 'score'], w: 0.75, zeroIsNone: false,
    label: 'Susceptibilidad del relieve', src: 'cauce. sim-relieve · MDT 5 m',
    desc: 'Puntaje medio de susceptibilidad del terreno (altura sobre el cauce HAND, depresiones, acumulación, planitud), calibrado con sitios IMEPLAN; bloques de 25 m.',
    fmt: v => `${Math.round(v * 100)} / 100` },
  // sim-hidro publishes routing polygons, not an AGEB table: invertir-1 joins them (tools/join-hidro.mjs). An official
  // per-AGEB file from sim-hidro, if it ever appears at the first URL, wins.
  { id: 'sim_hidro', producer: 'sim-hidro', urls: ['/labs/shared/hazard/modeled/sim-hidro/ageb-hidro.json', './data/ageb-hidro.json'], status: '/labs/shared/status/sim-hidro.json',
    fields: ['share_ge15'], w: 1.25, zeroIsNone: true,
    label: 'Inundación modelada 5 m (Tr 10)', src: 'cauce. sim-hidro · aguas someras 5 m',
    desc: 'Fracción del AGEB con tirante máximo ≥ 15 cm en la tormenta de 10 años (lluvia sobre malla de 5 m, ecuaciones de aguas someras). invertir-1 la calcula muestreando cada 25 m los polígonos de ruteo de sim-hidro.',
    fmt: v => `${Math.round(v * 100)} % sup.` },
];

// bivariate palette (multiply blend of a water ramp and a vulnerability ramp), [y][x]
const BIV = [
  ['#e6e1d5', '#98cfdc', '#2196c4'],
  ['#eba5b4', '#9b98ba', '#226ea6'],
  ['#d63f66', '#8d3a69', '#1f2a5e'],
];
const PAPER = '#f4f0e8';
const NODATA = '#ece7dd';
const mix = (a, b, t) => { const h = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)); const A = h(a), B = h(b); return '#' + A.map((v, k) => Math.round(v + (B[k] - v) * t).toString(16).padStart(2, '0')).join(''); };
const CLASS_COLORS = []; // 0..8 normal, 10..18 dimmed, 20 no data, 21 no data dimmed
for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) { CLASS_COLORS[y * 3 + x] = BIV[y][x]; CLASS_COLORS[10 + y * 3 + x] = mix(BIV[y][x], PAPER, 0.72); }
CLASS_COLORS[20] = NODATA; CLASS_COLORS[21] = mix(NODATA, PAPER, 0.5);
const colorExpr = (() => { const e = ['match', ['coalesce', ['feature-state', 'c'], 20]]; CLASS_COLORS.forEach((c, k) => { if (c) e.push(k, c); }); e.push(NODATA); return e; })();

const fmtInt = M.fmtInt;
const fmt1 = v => v == null || Number.isNaN(v) ? '—' : v.toFixed(1);
const fmt2 = v => v == null || Number.isNaN(v) ? '—' : v.toFixed(2);
const pctTxt = p => `${Math.round(p * 100)}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ state
const S = {
  rows: [], feats: [], ex: {}, model: null, factors: [], joins: {}, joinInfo: [],
  weights: { groups: { ...M.DEFAULT_GROUP_W }, factors: {} },
  preset: 'equilibrado', mun: 'all', sel: null, focus: false, heightMode: 'obs', tab: 'why', ptab: 'rank',
  res: null, br: null, idx: new Map(), muniMeta: [], baseRank: null,
  heightGrow: 1, whyGrow: 1,
};

async function getJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; } return r.json(); }

// ------------------------------------------------------------------ boot
// Fast path: our gzip-served copy of the shared profile; the shared file wins when it is newer (live republish by infra-data).
async function sharedIsNewer(copyMeta) {
  try {
    const r = await fetch(URLS.profile, { method: 'HEAD', cache: 'no-cache' });
    const lm = Date.parse(r.headers.get('last-modified') || '');
    const len = +r.headers.get('content-length') || 0;
    if (!copyMeta) return true;
    return (Number.isFinite(lm) && lm > Date.parse(copyMeta.source_mtime) + 1500) || (len && copyMeta.source_size && len !== copyMeta.source_size);
  } catch { return false; }
}
async function loadProfile() {
  const compact = await getJSON(URLS.compact).catch(() => null);
  if (!compact) { S.profileSrc = 'shared'; return getJSON(URLS.profile); }
  const newer = await sharedIsNewer(compact.metadata?.__copy);
  if (newer) { S.profileSrc = 'shared (más nuevo que la copia)'; return getJSON(URLS.profile).catch(() => compact); }
  S.profileSrc = 'copia comprimida'; return compact;
}
async function boot() {
  const hz = document.createElement('div'); hz.id = 'horizon'; $('#map').after(hz);
  const styleReady = createMap();
  const firstOf = async urls => { let err; for (const u of urls) { try { const j = await getJSON(u); return { j, url: u }; } catch (e) { err = e; } } return { e: err }; };
  const joinRaw = JOINS.map(J => Promise.all([getJSON(J.status).catch(() => null), firstOf(J.urls || [J.url])]));
  const [profile, extras] = await Promise.all([
    loadProfile(),
    getJSON(URLS.extras).catch(() => ({ agebs: {} })),
  ]);
  S.feats = profile.features;
  S.rows = profile.features.map(f => f.properties);
  S.meta = profile.metadata || {};
  S.ex = extras.agebs || {};
  S.rows.forEach((p, i) => { S.idx.set(p.cvegeo, i); p.__j = {}; });

  // simulation joins (graceful)
  await Promise.all(JOINS.map(async (J, k) => {
    const info = { ...J, ok: false, err: null, field: null, n: 0, meta: null, state: null };
    S.joinInfo.push(info);
    try {
      const [st, got] = await joinRaw[k]; info.state = st?.state || null; info.updated = st?.updated || null;
      if (got.e) throw got.e;
      const j = got.j; info.url = got.url;
      const recs = j.agebs || j.data || j.records || (Array.isArray(j.features) ? Object.fromEntries(j.features.map(f => [f.properties?.cvegeo || f.id, f.properties])) : j);
      const keys = Object.keys(recs);
      let field = J.fields.find(fl => keys.filter(k => recs[k] && Number.isFinite(+recs[k][fl]) && recs[k][fl] !== null).length > 10);
      if (!field && j.meta?.primary) field = j.meta.primary;
      if (!field) throw new Error('sin campo reconocible');
      for (const k of keys) { const i = S.idx.get(k); if (i == null || !recs[k]) continue; S.rows[i].__j[J.id] = recs[k]; info.n++; }
      info.ok = info.n > 0; info.field = field; info.meta = j.meta || null;
    } catch (e) { info.err = e.status ? `HTTP ${e.status}` : e.message; }
  }));
  S.factors = [...M.BASE_FACTORS];
  const pIdx = S.factors.findIndex(f => f.group !== 'P');
  const joinFactors = S.joinInfo.filter(j => j.ok).map(J => ({
    id: J.id, group: 'P', w: J.w, kind: 'modelado', zeroIsNone: J.zeroIsNone, label: J.label, src: J.src, desc: J.desc, unit: '', join: J,
    value: p => { const r = p.__j[J.id]; const v = r ? r[J.field] : null; return v == null || !Number.isFinite(+v) ? null : +v; }, fmt: J.fmt,
  }));
  S.factors.splice(pIdx, 0, ...joinFactors);
  S.model = M.prepare(S.rows, S.factors);
  S.hasModel = joinFactors.length > 0;
  S.dren = S.joinInfo.find(j => j.id === 'sim_drenaje' && j.ok) || null;

  // exposure estimates
  for (const p of S.rows) {
    const pob = +p.pob || 0;
    p.exp_obs = Math.round(pob * clamp((+p.imeplan_area_pct || 0) / 100, 0, 1));
    const d = p.__j.sim_drenaje; p.exp_mod = d && Number.isFinite(+d.population_exposed_ref) ? +d.population_exposed_ref : 0;
  }
  // municipalities (population-weighted label anchors)
  const mm = new Map();
  S.rows.forEach((p, i) => {
    const e = S.ex[p.cvegeo]; const c = e?.lp; if (!c) return; const w = Math.max(1, +p.pob || 0);
    if (!mm.has(p.mun)) mm.set(p.mun, { id: p.mun, name: p.mun_nombre, x: 0, y: 0, w: 0, pob: 0, n: 0, bb: [180, 90, -180, -90] });
    const m = mm.get(p.mun); m.x += c[0] * w; m.y += c[1] * w; m.w += w; m.pob += +p.pob || 0; m.n++;
    m.bb = [Math.min(m.bb[0], c[0]), Math.min(m.bb[1], c[1]), Math.max(m.bb[2], c[0]), Math.max(m.bb[3], c[1])];
  });
  S.muniMeta = [...mm.values()].map(m => ({ ...m, c: [m.x / m.w, m.y / m.w] })).sort((a, b) => b.pob - a.pob);

  readHash();
  if (DEMO) { S.weights = { groups: { ...M.DEFAULT_GROUP_W }, factors: {} }; S.mun = 'all'; S.sel = null; }
  S.baseRes = M.score(S.model, { groups: { ...M.DEFAULT_GROUP_W }, factors: {} });
  buildMunis(); buildHeightMode(); buildWeights(); buildMethod();
  recompute();
  if (S.sel == null) S.sel = S.res.order[0] ?? null;
  await styleReady;
  addLayers();
}

// ------------------------------------------------------------------ compute
function filterFn() { return S.mun === 'all' ? () => true : p => p.mun === S.mun; }
function recompute() {
  S.res = M.score(S.model, S.weights, filterFn());
  S.baseRankF = M.score(S.model, { groups: { ...M.DEFAULT_GROUP_W }, factors: {} }, filterFn()).rank;
  S.br = M.bivariateBreaks(S.model, S.res);
}
function classOf(i) {
  if (!S.model.uni[i]) return 20;
  const [x, y] = M.bivariateClass(S.br, S.res.G.P[i], S.res.G.V[i]);
  return y * 3 + x;
}
function expOf(p) { return S.heightMode === 'mod' ? p.exp_mod : S.heightMode === 'pob' ? (+p.pob || 0) : p.exp_obs; }
// metres of tower per person (a visual encoding of people, not elevation)
const H_SCALE = { obs: 0.85, mod: 0.85, pob: 0.3 };
const hOf = p => expOf(p) * H_SCALE[S.heightMode] * S.heightGrow;

let stateCache = new Map();
function pushStates(force = false) {
  if (!S.map || !S.mapReady) return;
  const dimOthers = S.mun !== 'all';
  for (let i = 0; i < S.rows.length; i++) {
    const p = S.rows[i];
    let c = classOf(i);
    const out = (dimOthers && p.mun !== S.mun) || (S.focus && i !== S.sel);
    if (out) c = c === 20 ? 21 : c + 10;
    const h = Math.round(hOf(p));
    const sel = i === S.sel;
    const prev = stateCache.get(i);
    if (!force && prev && prev.c === c && prev.h === h && prev.sel === sel) continue;
    stateCache.set(i, { c, h, sel });
    S.map.setFeatureState({ source: 'agebs', id: p.cvegeo }, { c, h, sel });
  }
}

// ------------------------------------------------------------------ map
function mapStyle() {
  const hill = `${location.origin}/labs/shared/terrain/hillshade/{z}/{x}/{y}.png`;
  return {
    version: 8,
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenStreetMap · OpenFreeMap' },
      hill: { type: 'raster', tiles: [hill], tileSize: 256, minzoom: 8, maxzoom: 15, bounds: [-103.75629, 20.243255, -103.04029, 21.006726], attribution: 'Relieve © INEGI' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': PAPER } },
      { id: 'hill', type: 'raster', source: 'hill', paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.32, 14, 0.14], 'raster-brightness-min': 0.32, 'raster-contrast': 0.15, 'raster-fade-duration': 0 } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#dfe3cf', 'fill-opacity': 0.5 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#bdd8e2' } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 9, paint: { 'line-color': '#9cc8d8', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 14, 1.6] } },
    ],
  };
}

const HOME = { center: [-103.335, 20.608], zoom: 10.72, zoomPhone: 9.8, pitch: 54, bearing: -16 };
function createMap() {
  const map = new maplibregl.Map({
    container: 'map', style: mapStyle(), center: HOME.center, zoom: isPhone() ? HOME.zoomPhone : HOME.zoom, pitch: HOME.pitch, bearing: HOME.bearing,
    attributionControl: false, maxPitch: 72, minZoom: 8.5, maxZoom: 16.5, fadeDuration: 0,
    canvasContextAttributes: { antialias: true },
  });
  S.map = map; window.__map = map; window.__S = S;
  if (!DEMO) map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  setPadding();
  addEventListener('resize', () => { setPadding(); applyPhoneTab(); });
  return new Promise(res => { if (map.isStyleLoaded()) res(); else map.once('style.load', res); });
}
function addLayers() {
  const map = S.map;
  {
    const fc = { type: 'FeatureCollection', features: S.feats.map(f => ({ type: 'Feature', geometry: f.geometry, properties: { cvegeo: f.properties.cvegeo, exp_obs: f.properties.exp_obs, exp_mod: f.properties.exp_mod, pob: +f.properties.pob || 0 } })) };
    map.addSource('agebs', { type: 'geojson', data: fc, promoteId: 'cvegeo', tolerance: 0.2 });
    map.addLayer({ id: 'ageb-fill', type: 'fill', source: 'agebs', paint: { 'fill-color': colorExpr, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.62, 12.6, 0.72, 13.6, ['case', ['boolean', ['feature-state', 'sel'], false], 0.88, 0.55]] } });
    // IMEPLAN observed polygons, hatched (visible when zoomed in)
    map.addImage('hatch', hatchImage('#0f7fb0', 2.0, 7), { pixelRatio: 2 });
    map.addImage('hatch-z', hatchImage('#0b4f74', 2.6, 5), { pixelRatio: 2 });
    map.addSource('imeplan', { type: 'geojson', data: URLS.imeplan });
    const isZ = ['==', ['get', 'category'], 'Zonas Criticas'];
    map.addLayer({ id: 'ime-tint', type: 'fill', source: 'imeplan', minzoom: 12, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#bfe6f3', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12.4, 0, 13.4, 0.75] } });
    map.addLayer({ id: 'ime-fill', type: 'fill', source: 'imeplan', minzoom: 12, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-pattern': ['case', isZ, 'hatch-z', 'hatch'], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12.4, 0, 13.4, 1] } });
    map.addLayer({ id: 'ime-line', type: 'line', source: 'imeplan', minzoom: 12, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': ['case', isZ, '#0b4f74', '#0f7fb0'], 'line-width': ['case', isZ, 2, 1.3], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12.4, 0, 13.4, 1] } });
    // roads above the AGEB mosaic: the city's skeleton
    map.addLayer({ id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false], paint: { 'line-color': '#fbf9f4', 'line-opacity': 0.85, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 9, 0.4, 12, 1.3, 15, 5] } });
    map.addLayer({ id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12.5, filter: ['match', ['get', 'class'], ['secondary', 'tertiary', 'minor', 'service'], true, false], paint: { 'line-color': '#fbf9f4', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13.5, 0.7], 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12.5, 0.4, 16, 3] } });
    map.addLayer({ id: 'ageb-line', type: 'line', source: 'agebs', paint: { 'line-color': PAPER, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.15, 12, 0.6, 15, 1.4], 'line-opacity': 0.9 } });
    map.addLayer({ id: 'sel-halo', type: 'line', source: 'agebs', filter: ['==', ['get', 'cvegeo'], ''], paint: { 'line-color': PAPER, 'line-width': 7 } });
    map.addLayer({ id: 'sel-line', type: 'line', source: 'agebs', filter: ['==', ['get', 'cvegeo'], ''], paint: { 'line-color': '#17162a', 'line-width': 2.4 } });
    map.addSource('fac', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'fac', type: 'circle', source: 'fac', minzoom: 13, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.6, 14.5, 3, 16, 5.5],
      'circle-color': ['match', ['get', 'kind'], ['escuela', 'guarderia'], '#a7823a', '#ffffff'],
      'circle-stroke-color': '#17162a', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 15, 1.2],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 13.6, 1], 'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 13.6, 1] } });
    map.addLayer({ id: 'ageb-3d', type: 'fill-extrusion', source: 'agebs', filter: heightFilter(), paint: {
      'fill-extrusion-color': colorExpr,
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 12.4, ['coalesce', ['feature-state', 'h'], 0], 13.8, ['*', 0.15, ['coalesce', ['feature-state', 'h'], 0]]],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 12.8, 0.96, 13.8, 0],
      'fill-extrusion-vertical-gradient': true,
    } });
    map.addLayer(projLayer());
    map.setLight({ anchor: 'map', position: [1.25, 205, 38], intensity: 0.42, color: '#ffffff' });
    S.mapReady = true;
    pushStates(true);
    setSelection(S.sel, { fly: false });
    renderAll();
    wireMap();
    loadFacilities();
    requestAnimationFrame(() => { app.classList.remove('booting'); });
    if (DEMO) startDemo();
  }
}

function hatchImage(color, lw, gap) {
  const n = 16, c = document.createElement('canvas'); c.width = c.height = n * 2; const g = c.getContext('2d');
  g.scale(2, 2); g.strokeStyle = color; g.lineWidth = lw / 2; g.globalAlpha = 0.85;
  for (let k = -n; k < 2 * n; k += gap) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + n, n); g.stroke(); }
  const d = g.getImageData(0, 0, n * 2, n * 2); return { width: n * 2, height: n * 2, data: new Uint8Array(d.data.buffer) };
}
function heightFilter() { const k = S.heightMode === 'mod' ? 'exp_mod' : S.heightMode === 'pob' ? 'pob' : 'exp_obs'; return ['>', ['get', k], 0]; }

function setPadding() { if (S.map) S.map.resize(); }

async function loadFacilities() {
  try {
    const g = await getJSON(URLS.facilities);
    const keep = new Set(['escuela', 'guarderia', 'hospital', 'clinica', 'residencia_cuidado']);
    g.features = g.features.filter(f => keep.has(f.properties.kind)).map(f => ({ type: 'Feature', geometry: f.geometry, properties: { kind: f.properties.kind } }));
    S.map.getSource('fac').setData(g);
  } catch (e) { /* optional layer */ }
}

// ------------------------------------------------------------------ projected HTML labels (tower tops, municipality names)
let projM = null;
function projLayer() {
  return {
    id: 'proj', type: 'custom', renderingMode: '3d',
    onAdd() {}, render(gl, args) { projM = args?.defaultProjectionData?.mainMatrix || args?.modelViewProjectionMatrix || args; placeLabels(); },
  };
}
function project(lng, lat, alt) {
  if (!projM) return null;
  const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], alt);
  const m = projM; const x = mc.x, y = mc.y, z = mc.z;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw <= 0) return null;
  const cv = S.map.getCanvas();
  return [(cx / cw + 1) / 2 * cv.clientWidth, (1 - cy / cw) / 2 * cv.clientHeight];
}
const labelEls = new Map();
let muniEls = null;
function placeLabels() {
  if (!S.res) return;
  const box = $('#labels');
  const z = S.map.getZoom();
  const hz = z <= 12.4 ? 1 : z >= 13.8 ? 0 : 1 - (z - 12.4) / 1.4;
  const top = S.res.order.slice(0, 25);
  const want = new Set(top);
  if (S.sel != null) want.add(S.sel);
  for (const [i, el] of labelEls) if (!want.has(i)) { el.remove(); labelEls.delete(i); }
  const W = box.clientWidth, H = box.clientHeight;
  for (const i of want) {
    const p = S.rows[i], e = S.ex[p.cvegeo]; if (!e?.lp) continue;
    let el = labelEls.get(i);
    if (!el) { el = document.createElement('div'); el.className = 'rl'; el.innerHTML = '<div class="nm"></div><div class="b"></div><div class="stem"></div>'; box.appendChild(el); labelEls.set(i, el); }
    const r = S.res.rank[i];
    const h = (expOf(p) > 0 ? hOf(p) * hz : 0) + 25;
    const pt = project(e.lp[0], e.lp[1], h);
    const vis = pt && pt[0] > -40 && pt[0] < W + 40 && pt[1] > -40 && pt[1] < H + 40 && (r > 0 || i === S.sel);
    el.style.display = vis ? '' : 'none';
    if (!vis) continue;
    el.style.transform = `translate(${pt[0].toFixed(1)}px, ${pt[1].toFixed(1)}px) translate(-50%, -100%)`;
    el.style.zIndex = String(1000 - (r || 999));
    const b = el.children[1]; const t = r > 0 ? String(r) : '·'; if (b.textContent !== t) b.textContent = t;
    el.classList.toggle('top5', r > 0 && r <= 5);
    el.classList.toggle('sel', i === S.sel);
    el.classList.toggle('pulse', i === S.pulse);
    const nm = el.children[0]; const showName = (r > 0 && r <= 3 && !isPhone()) || i === S.sel || i === S.pulse;
    const nameTxt = showName ? (e.name || p.cvegeo) : '';
    if (nm.textContent !== nameTxt) nm.textContent = nameTxt; nm.style.display = showName ? '' : 'none';
  }
  // municipality labels
  if (!muniEls) { muniEls = S.muniMeta.map(m => { const el = document.createElement('div'); el.className = 'ml' + (m.pob < 150000 ? ' small' : ''); el.textContent = shortMun(m.name); box.appendChild(el); return el; }); }
  const showM = z < 12.4;
  S.muniMeta.forEach((m, k) => {
    const el = muniEls[k]; const pt = showM ? project(m.c[0], m.c[1], 0) : null;
    const on = pt && (S.mun === 'all' || S.mun === m.id);
    el.style.display = on ? '' : 'none';
    if (on) { el.style.transform = `translate(${pt[0].toFixed(1)}px, ${pt[1].toFixed(1)}px) translate(-50%, -50%)`; el.style.opacity = String(clamp((12.4 - z) / 0.6, 0, 0.85)); }
  });
}
const shortMun = n => ({ 'San Pedro Tlaquepaque': 'Tlaquepaque', 'Tlajomulco de Zúñiga': 'Tlajomulco', 'Ixtlahuacán de los Membrillos': 'Ixtlahuacán', 'Acatlán de Juárez': 'Acatlán' }[n] || n);

// ------------------------------------------------------------------ map interaction
function wireMap() {
  const map = S.map, tip = $('#tip');
  const pick = e => map.queryRenderedFeatures(e.point, { layers: ['ageb-3d', 'ageb-fill'] })[0];
  map.on('mousemove', e => {
    if (DEMO) return;
    const f = pick(e);
    map.getCanvas().style.cursor = f ? 'pointer' : '';
    if (!f) { tip.hidden = true; return; }
    const i = S.idx.get(f.properties.cvegeo ?? f.id); const p = S.rows[i]; const ex = S.ex[p.cvegeo] || {};
    const r = S.res.rank[i]; const s = S.res.S[i];
    tip.innerHTML = `${r ? `<span class="r">#${r}</span>` : ''}<b>${esc(ex.name || 'AGEB ' + p.ageb)}</b><br><span class="m">${esc(p.mun_nombre)} · ${fmtInt(p.pob)} hab.</span><br>` +
      (s > 0 ? `Prioridad <b>${fmt1(s)}</b> · ` : 'Sin peligro registrado · ') + `${fmtInt(expOf(p))} ${S.heightMode === 'pob' ? 'hab.' : 'expuestas'}`;
    const mr = $('#mapui').getBoundingClientRect();
    tip.hidden = false; tip.style.left = `${clamp(e.originalEvent.clientX - mr.left + 14, 0, mr.width - 270)}px`; tip.style.top = `${clamp(e.originalEvent.clientY - mr.top + 14, 0, mr.height - 90)}px`;
  });
  map.on('mouseout', () => { tip.hidden = true; });
  map.on('click', e => {
    if (DEMO) return;
    const f = pick(e); if (!f) return;
    const i = S.idx.get(f.properties.cvegeo ?? f.id);
    setSelection(i, { fly: true }); setTab('why'); if (isPhone()) setPhoneTab('why');
  });
}

function setSelection(i, { fly = false } = {}) {
  S.sel = i;
  const id = i == null ? '' : S.rows[i].cvegeo;
  if (S.map?.getLayer('sel-line')) { S.map.setFilter('sel-line', ['==', ['get', 'cvegeo'], id]); S.map.setFilter('sel-halo', ['==', ['get', 'cvegeo'], id]); }
  renderWhy(); renderListContent(); writeHash();
  if (fly && i != null) flyToAgeb(i);
  pushStates();
}
function flyToAgeb(i, opts = {}) {
  const e = S.ex[S.rows[i].cvegeo]; if (!e?.lp) return;
  S.map.flyTo({ center: e.lp, zoom: Math.max(S.map.getZoom(), opts.zoom || 13.4), pitch: 58, bearing: S.map.getBearing(), duration: 1600, essential: true });
}

// ------------------------------------------------------------------ UI builders
function buildMunis() {
  const nav = $('#munis');
  const items = [{ id: 'all', name: 'Toda la ZMG' }, ...S.muniMeta];
  nav.innerHTML = items.map(m => `<button class="chip${S.mun === m.id ? ' on' : ''}" data-mun="${m.id}" type="button">${esc(m.id === 'all' ? m.name : shortMun(m.name))}</button>`).join('');
  nav.addEventListener('click', e => { const b = e.target.closest('[data-mun]'); if (!b) return; setMun(b.dataset.mun, true); });
}
function setMun(id, fly) {
  S.mun = id;
  $$('#munis .chip').forEach(b => b.classList.toggle('on', b.dataset.mun === id));
  const prev = currentPositions();
  recompute();
  if (S.sel != null && S.mun !== 'all' && S.rows[S.sel].mun !== S.mun) S.sel = S.res.order[0] ?? null;
  setSelection(S.sel);
  pushStates(); renderAll(prev);
  if (fly && S.map) {
    if (id === 'all') S.map.flyTo({ center: HOME.center, zoom: isPhone() ? HOME.zoomPhone : HOME.zoom, pitch: HOME.pitch, bearing: HOME.bearing, duration: 1400 });
    else { const m = S.muniMeta.find(x => x.id === id); S.map.fitBounds(m.bb, { pitch: 55, bearing: -18, duration: 1400, maxZoom: 13 }); }
  }
}
function buildHeightMode() {
  const el = $('#heightmode');
  const modes = [['obs', 'Personas en zona registrada'], ...(S.dren ? [['mod', 'Expuestas · modelo']] : []), ['pob', 'Población']];
  el.innerHTML = `<span class="lab">Altura</span>` + modes.map(([k, l]) => `<button type="button" data-h="${k}" class="${k === S.heightMode ? 'on' : ''}${k === 'mod' ? ' model' : ''}">${l}</button>`).join('');
  el.addEventListener('click', e => { const b = e.target.closest('[data-h]'); if (!b) return; setHeightMode(b.dataset.h); });
}
function setHeightMode(k) {
  S.heightMode = k;
  $$('#heightmode button').forEach(b => b.classList.toggle('on', b.dataset.h === k));
  if (S.map?.getLayer('ageb-3d')) S.map.setFilter('ageb-3d', heightFilter());
  pushStates(); renderLegend(); renderListContent(); renderWhy(); writeHash();
}

function renderLegend() {
  const cell = 22, d = cell * 0.7071, C = 52, B = 78, svg = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const cx = C + (x - y) * d, cy = B - (x + y) * d;
    svg.push(`<rect x="${-cell / 2}" y="${-cell / 2}" width="${cell}" height="${cell}" fill="${BIV[y][x]}" transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(45)" stroke="${PAPER}" stroke-width="1.2"/>`);
  }
  // axis labels along the two lower edges (outside the diamond)
  svg.push(`<text transform="translate(${(C + 1.5 * d + 6).toFixed(1)} ${(B + 0.5 * d + 6).toFixed(1)}) rotate(-45)" font-size="9.5" fill="#2196c4" text-anchor="middle" font-family="Libre Franklin" font-weight="700">más peligro →</text>`);
  svg.push(`<text transform="translate(${(C - 1.5 * d - 6).toFixed(1)} ${(B + 0.5 * d + 6).toFixed(1)}) rotate(45)" font-size="9.5" fill="#d63f66" text-anchor="middle" font-family="Libre Franklin" font-weight="700">← más vulnerab.</text>`);
  const zero = S.br?.zeroMode;
  const ex = S.rows.reduce((m, p) => Math.max(m, expOf(p)), 0);
  const unit = S.heightMode === 'pob' ? 'habitantes' : 'personas expuestas';
  $('#legend').innerHTML = `<h5>Cómo leer el mapa</h5>
  <div class="biv"><svg width="104" height="104" viewBox="0 0 104 104">${svg.join('')}</svg>
    <div class="keys"><p><i style="background:${BIV[2][2]}"></i><b>Ambos altos</b>: prioridad</p><p><i style="background:${BIV[0][2]}"></i>Mucho peligro</p><p><i style="background:${BIV[2][0]}"></i>Mucha vulnerabilidad</p><p class="x"><i style="background:${BIV[0][0]}"></i>${zero ? 'Sin peligro registrado' : 'Bajo en ambos'}</p></div></div>
  <div class="hleg"><div class="bars"><i style="height:6px"></i><i style="height:13px"></i><i style="height:24px"></i></div><div>Altura = ${unit}${S.heightMode === 'obs' ? ' (población × % del AGEB en zonas IMEPLAN)' : S.heightMode === 'mod' ? ' (modelo sim-drenaje, Tr 10 años, 20 mm/h)' : ''}. Máx. <b>${fmtInt(ex)}</b>. No es relieve.</div></div>`;
}

function renderDataStatus() {
  const rows = [`<div class="row"><span class="ok">●</span><span><b style="display:inline;letter-spacing:.08em">Observado</b> IMEPLAN MUI 2026</span></div>`];
  for (const j of S.joinInfo) {
    const runs = j.meta?.runs ? ` · ${j.meta.runs} corridas` : j.meta?.scenario ? ` · ${j.meta.scenario.replace('T', 'Tr ')} años` : '';
    rows.push(j.ok ? `<div class="row"><span class="ok">◐</span><span><b style="display:inline;letter-spacing:.08em">Modelado</b> ${j.producer}${runs}</span></div>`
      : `<div class="row"><span class="no">○</span><span>${j.producer}: no disponible${j.err ? ` (${esc(j.err)})` : ''}</span></div>`);
  }
  const inv = S.model.F.sinpluvial?.avail || 0;
  rows.push(inv ? `<div class="row"><span class="ok">●</span><span>INEGI INV coladeras · ${inv} AGEB</span></div>` : `<div class="row"><span class="wait">…</span><span>INEGI INV coladeras: en consulta</span></div>`);
  $('#datastatus').innerHTML = `<b>Peligro: ${S.hasModel && pWeightModel() > 0 ? 'observado + modelado' : 'solo observado'}</b>${rows.join('')}`;
  $('#datastatus').onclick = () => openMethod();
}
function pWeightModel() { return S.factors.filter(f => f.kind === 'modelado').reduce((s, f) => s + (S.weights.factors[f.id] ?? f.w), 0); }

// ------------------------------------------------------------------ ranking list
const listEls = new Map();
let listAnim = null; // {from: Map(i->pos), to: Map(i->pos), t0, dur}
function currentPositions() { const m = new Map(); for (const [i, el] of listEls) m.set(i, el._pos ?? 26); return m; }
function targetPositions() { const m = new Map(); S.res.order.slice(0, 25).forEach((i, k) => m.set(i, k)); return m; }
function renderList(prev) {
  const to = targetPositions();
  const from = prev || new Map(to);
  listAnim = { from, to, t0: performance.now(), dur: prev ? 650 : 0 };
  ensureCards(new Set([...from.keys(), ...to.keys()]));
  renderListContent();
  if (DEMO) layoutList(1); else tickList();
}
function ensureCards(ids) {
  const ol = $('#rank');
  let inner = $('.inner', ol); if (!inner) { inner = document.createElement('div'); inner.className = 'inner'; ol.appendChild(inner); }
  inner.style.height = `calc(var(--step) * 25 + 20px)`;
  for (const i of ids) {
    if (listEls.has(i)) continue;
    const li = document.createElement('div'); li.className = 'card-r'; li.dataset.i = i; li._pos = 26;
    li.innerHTML = `<div class="num"></div><div class="body"><div class="name"></div><div class="meta"></div></div><div class="right"><div class="spark"></div><div class="score"></div></div>`;
    li.addEventListener('click', () => { if (DEMO) return; setSelection(i, { fly: true }); setTab('why'); if (isPhone()) setPhoneTab('why'); });
    li.addEventListener('mouseenter', () => { if (DEMO) return; S.pulse = i; S.map?.triggerRepaint(); });
    li.addEventListener('mouseleave', () => { if (DEMO) return; S.pulse = null; S.map?.triggerRepaint(); });
    inner.appendChild(li); listEls.set(i, li);
  }
}
function tickList() {
  const a = listAnim; if (!a) return;
  const u = a.dur ? clamp((performance.now() - a.t0) / a.dur, 0, 1) : 1;
  layoutList(u);
  if (u < 1) requestAnimationFrame(tickList); else { for (const [i, el] of listEls) if (!a.to.has(i)) { el.remove(); listEls.delete(i); } }
}
function layoutList(u, fromOverride, toOverride) {
  const a = listAnim; const from = fromOverride || a.from, to = toOverride || a.to; const e = ease(u);
  const step = parseFloat(getComputedStyle($('#rank')).getPropertyValue('--step')) || 70;
  for (const [i, el] of listEls) {
    const f = from.has(i) ? from.get(i) : 26, t = to.has(i) ? to.get(i) : 26;
    const pos = f + (t - f) * e; el._pos = pos;
    el.style.transform = `translateY(${(pos * step).toFixed(1)}px)`;
    el.style.opacity = String(!to.has(i) ? 1 - e : !from.has(i) ? e : 1);
    el.style.zIndex = String(Math.round(100 - pos));
  }
}
function sparkHTML(i) {
  const parts = []; let last = null;
  for (const f of S.factors) {
    const w = S.weights.factors[f.id] ?? f.w; if (!(w > 0)) continue;
    if (last && last !== f.group) parts.push('<span class="gap"></span>');
    last = f.group;
    const p = S.model.F[f.id].pct[i];
    parts.push(Number.isNaN(p) || S.model.F[f.id].avail === 0 ? `<i class="na" title="${esc(f.label)}: sin dato"></i>` : `<i class="${f.kind === 'modelado' ? 'M' : f.group}" style="height:${Math.max(1, p * 26).toFixed(1)}px" title="${esc(f.label)}: percentil ${pctTxt(p)}"></i>`);
  }
  return parts.join('');
}
function renderListContent() {
  if (!S.res) return;
  const nameCount = new Map();
  for (const [i] of listEls) { const n = S.ex[S.rows[i].cvegeo]?.name || ''; nameCount.set(n, (nameCount.get(n) || 0) + 1); }
  for (const [i, el] of listEls) {
    const p = S.rows[i], e = S.ex[p.cvegeo] || {};
    const r = S.res.rank[i];
    el.children[0].textContent = r ? r : '–';
    el.children[1].children[0].innerHTML = esc(e.name || `AGEB ${p.ageb}`) + ((nameCount.get(e.name || '') || 0) > 1 ? ` <small class="ag">${esc(p.ageb)}</small>` : '');
    const c = classOf(i);
    const ex = expOf(p);
    const b0 = S.baseRankF?.[i] || 0; const d = r && b0 ? b0 - r : 0;
    const delta = d && (S.preset !== 'equilibrado' || Object.keys(S.weights.factors).length) ? ` <span class="delta ${d > 0 ? 'up' : 'dn'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>` : '';
    el.children[1].children[1].innerHTML = `<span class="swatch" style="background:${CLASS_COLORS[c] || NODATA}"></span>${esc(shortMun(p.mun_nombre))} · <b>${fmtInt(ex)}</b> ${S.heightMode === 'pob' ? 'hab.' : 'exp.'}${delta}`;
    el.children[2].children[0].innerHTML = sparkHTML(i);
    el.children[2].children[1].innerHTML = `${fmt1(S.res.S[i])}<small>/100</small>`;
    el.classList.toggle('sel', i === S.sel);
    el.classList.toggle('pulse', i === S.pulse && i !== S.sel);
  }
  $('#list-count').textContent = fmtInt(S.res.order.length);
  $('#list-scope').textContent = S.mun === 'all' ? 'Toda la ZMG' : S.muniMeta.find(m => m.id === S.mun)?.name;
}

// ------------------------------------------------------------------ "¿Por qué aquí?"
function renderWhy() {
  const box = $('#why'); const i = S.sel;
  if (i == null || !S.res) { box.innerHTML = '<p class="lede">Elige un AGEB en el mapa o en el ranking.</p>'; return; }
  const p = S.rows[i], e = S.ex[p.cvegeo] || {}, X = M.explain(S.model, S.weights, S.res, i);
  const r = S.res.rank[i], s = S.res.S[i], grow = S.whyGrow;
  const gw = S.weights.groups, sw = (gw.P || 0) + (gw.E || 0) + (gw.V || 0);
  const others = (e.cols || []).filter(c => c[0] !== e.name && c[1] >= 0.1).slice(0, 2).map(c => `${esc(c[0])} (${Math.round(c[1] * 100)} %)`).join(', ');
  const sites = e.sites || [];
  const dren = p.__j.sim_drenaje;
  // drivers: factors with the largest (weight share × percentile) relative contribution, among active
  const drivers = [];
  for (const g of ['P', 'E', 'V']) for (const it of X.groups[g].items) if (!it.missing && it.w > 0) drivers.push({ it, g, score: (gw[g] / sw) * it.share });
  drivers.sort((a, b) => b.score - a.score);
  const top2 = drivers.filter(d => d.it.p >= 0.6).slice(0, 2);
  const zonas = sites.flatMap(sx => (sx.zonas || []).map(z => ({ ...z, id: sx.id })));
  const altMax = zonas.reduce((m, z) => Math.max(m, z.altura || 0), 0);
  const expo = p.exp_obs;
  let lede = '';
  if (s > 0) {
    lede += `${r ? `Puesto <b>${r}</b> de ${fmtInt(S.res.order.length)}${S.mun !== 'all' ? ` en ${esc(shortMun(p.mun_nombre))}` : ''}. ` : ''}`;
    if (+p.imeplan_area_pct > 0) lede += `El <b>${Math.round(+p.imeplan_area_pct)} %</b> de su superficie está dentro de sitios o zonas con inundación registrada por IMEPLAN${expo ? ` — unas <b>${fmtInt(expo)}</b> personas` : ''}. `;
    else lede += `IMEPLAN no registra inundación aquí; su peligro viene de ${S.hasModel ? 'los modelos' : 'puntos reportados'}. `;
    if (top2.length) lede += `Lo que más lo empuja: ${top2.map(d => `<b>${esc(d.it.f.label.toLowerCase())}</b> (más que el ${pctTxt(d.it.p)} % de los AGEB)`).join(' y ')}.`;
  } else if (!S.model.uni[i]) lede = 'AGEB sin población registrada en el Censo 2020: aparece en el mapa pero no entra al ranking.';
  else if ((+p.pob || 0) < M.MIN_POP && s > 0) lede = `Tiene menos de ${M.MIN_POP} habitantes: se muestra, pero no entra al ranking.`;
  else lede = `Sin puntaje: no hay inundación registrada${S.hasModel ? ' ni modelada' : ''} en este AGEB con los pesos actuales (P = 0 ⇒ prioridad 0).`;

  const grpHTML = ['P', 'E', 'V'].map(g => {
    const G = X.groups[g]; const meta = M.GROUPS.find(x => x.id === g);
    const col = g === 'P' ? 'var(--water)' : g === 'E' ? 'var(--expo)' : 'var(--vuln)';
    const segs = G.items.filter(it => !it.missing && it.w > 0).map(it => `<i style="width:${(it.share * 100 * grow).toFixed(2)}%;background:${it.f.kind === 'modelado' ? `repeating-linear-gradient(135deg, ${col} 0 3px, #5fb4d6 3px 6px)` : col};opacity:${0.55 + 0.45 * (it.w / 4)}" title="${esc(it.f.label)}"></i>`).join('');
    const rows = G.items.filter(it => !(it.missing && it.f.partial)).map(it => {
      const off = !(it.w > 0); const na = it.missing;
      const val = na ? (it.f.pendingNote && S.model.F[it.f.id].avail === 0 ? 'pendiente' : 'sin dato') : it.f.fmt(it.raw, p);
      const dot = na ? '' : `<span class="dot" style="left:${(it.p * 100 * grow).toFixed(1)}%;background:${col}"></span><span class="pct" style="left:calc(${(it.p * 100 * grow).toFixed(1)}% + 8px)">p${pctTxt(it.p)}</span>`;
      return `<div class="frow${off ? ' off' : ''}${na ? ' na' : ''}"><div class="fl">${esc(it.f.label)} <span class="tag ${it.f.kind}">${it.f.kind}</span><small>${esc(it.f.src)}${off ? ' · peso 0' : ''}</small></div><div class="fv">${esc(val)}</div><div class="strip"><span class="med"></span>${dot}</div></div>`;
    }).join('');
    return `<div class="grp"><div class="grp-h"><h3 style="color:${col}">${meta.long}</h3><span class="val"><b>${Number.isNaN(G.value) ? '—' : fmt2(G.value)}</b> · peso ${Math.round((gw[g] / sw) * 100)} %</span></div><div class="stack">${segs}</div>${rows}</div>`;
  }).join('');

  const recs = sites.slice(0, 4).map(sx => {
    const z = (sx.zonas || [])[0];
    return `<li><code>${esc(sx.id)}</code> ${sx.ref ? `· ${esc(sx.ref)}` : ''}${sx.rango ? ` · ${esc(sx.rango)} cm` : ''}${z ? `<br><b>Zona crítica:</b> ${esc(z.motivo || '')}${z.infra ? ` · ${esc(z.infra)}` : ''}${z.altura ? ` · altura máx. reportada ${z.altura}*` : ''}` : ''}</li>`;
  }).join('');
  let modelHTML = '';
  const hid = p.__j.sim_hidro, hidInfo = S.joinInfo.find(j => j.id === 'sim_hidro' && j.ok);
  const hidLine = hid && hid.share_ge15 != null ? `<li class="model">Modelo de aguas someras 5 m (Tr 10 años): <b>${Math.round(hid.share_ge15 * 100)} %</b> del AGEB con ≥ 15 cm y <b>${Math.round((hid.share_ge60 || 0) * 100)} %</b> con más de 60 cm en el máximo de la tormenta.<br><code>cauce. sim-hidro · 5 m · ${esc(hidInfo?.meta?.scenario || 'T10')} · exploratorio</code></li>` : '';
  if (dren || hidLine) {
    modelHTML = `<h4>Lo que dicen los modelos <span class="tag modelado">modelado</span></h4><ul class="records">${hidLine}`;
  }
  if (dren) {
    const gc = { a: ['Persistente', 'se inunda aun con drenaje alto (≥ 40 mm/h): pide almacenamiento, regulación o reordenar el terreno'], b: ['Responde al drenaje', 'la inundación cae al subir la capacidad: ampliar drenaje rinde aquí'], c: ['Rara vez', 'pocas celdas urbanas se inundan en el ensamble'] }[dren.gap_class] || null;
    const red = dren.flooded_share_by_cap ? [dren.flooded_share_by_cap['0'], dren.flooded_share_by_cap['40']] : null;
    modelHTML += `<li class="model">${gc ? `<b>${gc[0]}</b>: ${gc[1]}.` : ''}${red && red[0] != null && red[1] != null ? `<br>Superficie urbana inundada (promedio del ensamble): <b>${Math.round(red[0] * 100)} %</b> sin drenaje → <b>${Math.round(red[1] * 100)} %</b> con 40 mm/h.` : ''}${dren.population_exposed_ref != null ? `<br>Personas expuestas (Tr 10 años, 20 mm/h): <b>${fmtInt(dren.population_exposed_ref)}</b>.` : ''}<br><code>cauce. sim-drenaje · 20 m · ${S.dren?.meta?.runs ?? '?'} corridas · exploratorio</code></li>`;
  }
  if (modelHTML) modelHTML += '</ul>';
  const fac = e.facIn ? Object.entries(e.facIn).map(([k, v]) => `${v} ${({ escuela: 'escuela', guarderia: 'guardería', hospital: 'hospital', clinica: 'clínica', residencia_cuidado: 'residencia' })[k]}${v > 1 ? (k === 'hospital' ? 'es' : k === 'clinica' ? 's' : 's') : ''}`).join(', ') : '';

  box.innerHTML = `
    <div class="why-top"><div class="bigrank">${r ? `<sup>#</sup>${r}` : '<sup>#</sup>—'}</div><div class="of">${r ? `de ${fmtInt(S.res.order.length)} AGEB con puntaje${S.mun !== 'all' ? ` en ${esc(shortMun(p.mun_nombre))}` : ''}` : 'fuera del ranking'}<b>${s > 0 ? fmt1(s) : '0'}<span style="font-size:12px;color:var(--muted)"> /100</span></b></div></div>
    <div class="why-name">${esc(e.name || 'AGEB ' + p.ageb)}</div>
    <p class="why-sub">${esc(p.mun_nombre)} · AGEB <code>${esc(p.cvegeo)}</code>${others ? `<br>también: ${others}` : ''}</p>
    <div class="kpis"><div><b>${fmtInt(p.pob)}</b><span>habitantes (2020)</span></div><div><b>${fmtInt(expo)}</b><span>en zona inundable registrada*</span></div><div><b>${esc(p.gm_2020 || '—')}</b><span>marginación (CONAPO)</span></div></div>
    <p class="lede">${lede}</p>
    <div class="formula-mini">${s > 0 ? fmt1(s) : '0'} = 100 · <b>${fmt2(X.groups.P.value)}</b><sup>${fmt2(gw.P / sw)}</sup> · <b>${fmt2(X.groups.E.value)}</b><sup>${fmt2(gw.E / sw)}</sup> · <b>${fmt2(X.groups.V.value)}</b><sup>${fmt2(gw.V / sw)}</sup><br><span style="color:var(--muted)">prioridad = 100 · P<sup>a</sup> · E<sup>b</sup> · V<sup>c</sup></span></div>
    ${grpHTML}
    ${sites.length ? `<h4>Registros IMEPLAN aquí <span class="tag observado">observado</span></h4><ul class="records">${recs}</ul>` : ''}
    ${fac ? `<p class="lede" style="font-size:12.5px">Dentro de los polígonos registrados: <b>${fac}</b> (DENUE).</p>` : ''}
    ${modelHTML}
    <p class="note">* Estimación: población × fracción del AGEB cubierta por polígonos IMEPLAN (supone población uniforme). La altura máxima reportada es el valor literal de IMEPLAN; la fuente no declara unidad (probablemente cm). Percentiles entre ${fmtInt(S.model.uni.filter(Boolean).length)} AGEB habitados; la raya gris marca la mediana. Nombre de referencia: colonia CONAPO 2020 con más superficie en el AGEB.</p>`;
}

// ------------------------------------------------------------------ weights panel
function buildWeights() {
  const box = $('#weights');
  const presetBtns = Object.entries(M.PRESETS).map(([k, p]) => `<button type="button" data-preset="${k}">${p.label}</button>`).join('');
  const grp = M.GROUPS.map(g => {
    const col = g.id === 'P' ? 'var(--water)' : g.id === 'E' ? 'var(--expo)' : 'var(--vuln)';
    const rows = S.factors.filter(f => f.group === g.id).map(f => {
      const na = S.model.F[f.id].avail === 0;
      return `<div class="wrow${na ? ' na' : ''}" data-frow="${f.id}" title="${esc(f.desc)}"><div class="wl">${esc(f.label)}<small><span class="tag ${f.kind}">${f.kind}</span> ${esc(f.src)}${na ? ` · ${esc(f.pendingNote || 'sin datos')}` : ` · ${fmtInt(S.model.F[f.id].avail)} AGEB`}</small></div><input type="range" min="0" max="4" step="0.25" data-f="${f.id}" style="--c:${col}" ${na ? 'disabled' : ''}><span class="wv" data-fv="${f.id}"></span></div>`;
    }).join('');
    return `<div class="wgrp"><div class="wgrp-h" data-grow="${g.id}"><h3 style="color:${col}">${g.long}<small>${g.hint}</small></h3><input type="range" min="0" max="100" step="1" data-g="${g.id}" style="--c:${col}"><span class="wv" data-gv="${g.id}"></span></div>${rows}</div>`;
  }).join('');
  box.innerHTML = `
    <div class="presets">${presetBtns}</div>
    <div class="formula" id="formula"></div>
    <p class="formula-note">P, E y V son promedios ponderados de <b>percentiles</b> (0–1) entre los AGEB habitados. Es una media geométrica: si P = 0 —ni registro ni modelo— la prioridad es 0. Factores sin dato se omiten y los pesos del grupo se reparten.</p>
    ${S.hasModel ? `<label class="toggle"><input type="checkbox" id="onlyobs"> Solo peligro observado (apagar modelos)</label>` : ''}
    ${grp}
    <p class="note">Pesos de grupo: exponentes de la media geométrica (se normalizan a 100 %). Pesos de factor: 0–4 dentro de su grupo. Ningún peso es “correcto”; esto es una herramienta para discutir prioridades, no para decidirlas.</p>`;
  box.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.g) { S.weights.groups[t.dataset.g] = +t.value / 100; }
    else if (t.dataset.f) { S.weights.factors[t.dataset.f] = +t.value; }
    else return;
    S.preset = 'custom'; weightsChanged();
  });
  box.addEventListener('change', e => {
    if (e.target.id === 'onlyobs') { for (const f of S.factors) if (f.kind === 'modelado') S.weights.factors[f.id] = e.target.checked ? 0 : f.w; S.preset = 'custom'; weightsChanged(); }
  });
  box.addEventListener('click', e => { const b = e.target.closest('[data-preset]'); if (!b) return; applyPreset(b.dataset.preset); });
  syncWeightsUI();
}
function applyPreset(k) {
  const pr = M.PRESETS[k]; S.preset = k;
  S.weights = { groups: { ...pr.groups }, factors: { ...pr.factors } };
  weightsChanged();
}
function syncWeightsUI() {
  const gw = S.weights.groups, sw = (gw.P || 0) + (gw.E || 0) + (gw.V || 0) || 1;
  $$('#weights [data-g]').forEach(el => { const v = gw[el.dataset.g] || 0; el.value = Math.round(v * 100); el.style.setProperty('--f', `${el.value}%`); });
  $$('#weights [data-gv]').forEach(el => { el.textContent = `${Math.round((gw[el.dataset.gv] || 0) / sw * 100)} %`; });
  $$('#weights [data-f]').forEach(el => { const f = S.factors.find(x => x.id === el.dataset.f); const v = S.weights.factors[f.id] ?? f.w; el.value = v; el.style.setProperty('--f', `${v / 4 * 100}%`); });
  $$('#weights [data-fv]').forEach(el => { const f = S.factors.find(x => x.id === el.dataset.fv); el.textContent = fmt2(S.weights.factors[f.id] ?? f.w).replace(/\.?0+$/, '') || '0'; });
  $$('#weights [data-preset]').forEach(b => b.classList.toggle('on', b.dataset.preset === S.preset));
  const oo = $('#onlyobs'); if (oo) oo.checked = pWeightModel() === 0;
  const a = gw.P / sw, b = gw.E / sw, c = gw.V / sw;
  const terms = g => S.factors.filter(f => f.group === g && (S.weights.factors[f.id] ?? f.w) > 0 && S.model.F[f.id].avail > 0).map(f => `${fmt2(S.weights.factors[f.id] ?? f.w).replace(/\.?0+$/, '')}·${f.id}`).join(' + ');
  $('#formula').innerHTML = `Prioridad = 100 · <span class="P">P</span><sup>${fmt2(a)}</sup> · <span class="E">E</span><sup>${fmt2(b)}</sup> · <span class="V">V</span><sup>${fmt2(c)}</sup><br>
    <span class="P">P</span> = (${terms('P') || '—'}) / Σw<br><span class="E">E</span> = (${terms('E') || '—'}) / Σw<br><span class="V">V</span> = (${terms('V') || '—'}) / Σw`;
}
let wcTimer = null;
function weightsChanged({ animate = true } = {}) {
  syncWeightsUI();
  const prev = currentPositions();
  recompute();
  pushStates();
  renderAll(animate ? prev : null);
  writeHash();
}
function renderAll(prev) { renderList(prev); renderWhy(); renderLegend(); renderDataStatus(); S.map?.triggerRepaint(); }

// ------------------------------------------------------------------ tabs (desktop) and phone sheet
function setTab(t) { S.tab = t; $$('#right .tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); $$('#right .tabpane').forEach(p => p.classList.toggle('on', p.id === t)); }
$$('#right .tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
function setPhoneTab(t) { S.ptab = t; $$('#phonetabs button').forEach(b => b.classList.toggle('on', b.dataset.ptab === t)); if (t !== 'rank') setTab(t); applyPhoneTab(); }
function applyPhoneTab() { $('#left').classList.toggle('ph-on', S.ptab === 'rank'); $('#right').classList.toggle('ph-on', S.ptab !== 'rank'); }
$$('#phonetabs button').forEach(b => b.addEventListener('click', () => setPhoneTab(b.dataset.ptab)));
applyPhoneTab();

// ------------------------------------------------------------------ method drawer
function buildMethod() {
  const n = S.model.uni.filter(Boolean).length;
  const rows = S.factors.map(f => `<tr><td>${M.GROUPS.find(g => g.id === f.group).label}</td><td><b>${esc(f.label)}</b><br><span style="font-size:11.5px">${esc(f.desc)}</span></td><td><span class="tag ${f.kind}">${f.kind}</span><br><span style="font-size:11px">${esc(f.src)}</span></td><td class="n">${fmt2(f.w).replace(/\.?0+$/, '')}</td><td class="n">${fmtInt(S.model.F[f.id].avail)}</td></tr>`).join('');
  const joins = S.joinInfo.map(j => `<li><b>${j.producer}</b> — ${j.ok ? `cargado: campo <code>${j.field}</code> en ${fmtInt(j.n)} AGEB${j.meta?.runs ? ` (${j.meta.runs} corridas del ensamble)` : ''}` : `no disponible (${esc(j.err || 'sin datos')}); el índice funciona sin él`}. <code>${j.url}</code></li>`).join('');
  $('#method-body').innerHTML = `
    <p class="eyebrow">Método · cauce. labs · invertir-1</p>
    <h2>Cómo se calcula la prioridad</h2>
    <p>Este atlas ordena los ${fmtInt(S.rows.length)} AGEB urbanos (INEGI 2020) de los diez municipios del Área Metropolitana de Guadalajara según dónde coinciden <b>evidencia de inundación</b>, <b>gente expuesta</b> y <b>poca capacidad para recuperarse</b>. Sigue la idea clásica de riesgo de CENAPRED, <i>riesgo = peligro × exposición × vulnerabilidad</i>, pero con pesos que tú puedes cambiar. <b>Es exploratorio: no es un índice oficial, no es un pronóstico y no es una recomendación de inversión.</b></p>
    <div class="formula">Prioridad = 100 · <span class="P">P</span><sup>a</sup> · <span class="E">E</span><sup>b</sup> · <span class="V">V</span><sup>c</sup> &nbsp; (a + b + c = 1)<br>Grupo = Σ wᵢ · pᵢ / Σ wᵢ &nbsp; · &nbsp; pᵢ = percentil del AGEB en el factor i</div>
    <p>Los percentiles se calculan entre los ${fmtInt(n)} AGEB con población. En factores donde 0 significa “nada registrado” (inundación IMEPLAN, puntos, frecuencia modelada) el 0 se queda en 0 y los valores positivos se reparten entre 0.05 y 1. Por eso un AGEB sin ningún registro ni modelo de agua tiene P = 0 y prioridad 0. Solo entran al ranking AGEB con al menos ${M.MIN_POP} habitantes.</p>
    <h3>Factores</h3>
    <table><thead><tr><th>Grupo</th><th>Factor</th><th>Tipo · fuente</th><th>Peso</th><th>AGEB</th></tr></thead><tbody>${rows}</tbody></table>
    <h3>Capas de peligro</h3>
    <ul><li><b>Observado</b> — IMEPLAN, Mapa Único de Inundaciones 2026: ${fmtInt(S.rows.filter(p => +p.imeplan_area_pct > 0).length)} AGEB tocan un sitio inundable o zona crítica. Es un inventario de dónde se ha registrado agua, no un pronóstico; favorece los lugares donde la gente reporta.</li>${joins}<li><b>INEGI INV 2020</b> (coladeras pluviales por manzana): ${S.model.F.sinpluvial?.avail ? 'cargado' : 'la consulta del agente infra-data sigue en curso; el factor se activa solo cuando el perfil se republique'}.</li></ul>
    <h3>Altura y color</h3>
    <p>La altura de cada AGEB es un número de personas (no relieve): por defecto, población × fracción de su superficie dentro de polígonos IMEPLAN (supone población uniforme). Con el modelo de drenaje disponible también puedes ver las personas expuestas según sim-drenaje (Tr 10 años, 20 mm/h). El color es una clasificación 3 × 3: P en terciles (o “P = 0” vs. mitades de P &gt; 0 cuando más de un tercio no tiene peligro) contra V en terciles.</p>
    <h3>Lo que este índice no ve</h3>
    <ul><li>Capacidad, estado y conectividad de colectores pluviales: no existe un inventario público de la red.</li><li>La cuenca aguas arriba y el origen del agua: un AGEB puede inundarse por lo que pasa kilómetros arriba; invertir ahí puede ser lo más eficaz.</li><li>Costos, obras en curso y factibilidad. Las obras pluviales recientes (prensa, ubicación aproximada) no se descuentan.</li><li>Censo 2020 y CONAPO 2020 tienen seis años; las zonas nuevas de Tlajomulco y Zapopan pueden estar subrepresentadas.</li><li>Los modelos de cauce. son exploratorios (malla de 20–25 m, sin red de drenaje, lluvia uniforme); se muestran rayados y etiquetados “modelado”.</li></ul>
    <h3>Fuentes y licencias</h3>
    <p>INEGI — Censo de Población y Vivienda 2020 (resultados por AGEB), Marco Geoestadístico 2020, DENUE, Inventario Nacional de Viviendas 2020, MDT 5 m (sombreado): Términos de libre uso del INEGI. CONAPO — Índice de marginación urbana 2020 y por colonia 2020 (nombres): Libre Uso MX. IMEPLAN — Mapa Único de Inundaciones 2026. ESA WorldCover 10 m 2021 v200 (CC BY 4.0). © colaboradores de OpenStreetMap (ODbL) vía OpenFreeMap. Perfil por AGEB: agente infra-data de cauce. labs (<a href="/labs/shared/infra/ageb-profile.md">documentación de campos</a>). Tipografías: Instrument Serif, Libre Franklin, IBM Plex Mono (SIL OFL).</p>
    <p class="note">Prototipo invertir-1 · ${new Date().toISOString().slice(0, 10)} · <a href="./README.md">README</a></p>`;
  $('#btn-method').onclick = openMethod;
  $('#method .close').onclick = () => { $('#method').hidden = true; };
  $('#method').addEventListener('click', e => { if (e.target.id === 'method') $('#method').hidden = true; });
}
function openMethod() { buildMethod(); $('#method').hidden = false; }

// ------------------------------------------------------------------ CSV
$('#btn-csv').addEventListener('click', () => {
  const head = ['rank', 'cvegeo', 'nombre_referencia', 'municipio', 'prioridad', 'P', 'E', 'V', 'pob', 'expuestas_imeplan', 'expuestas_modelo', ...S.factors.map(f => 'p_' + f.id)];
  const lines = [head.join(',')];
  for (const i of S.res.order) {
    const p = S.rows[i];
    lines.push([S.res.rank[i], p.cvegeo, `"${(S.ex[p.cvegeo]?.name || '').replace(/"/g, '""')}"`, `"${p.mun_nombre}"`, fmt2(S.res.S[i]), fmt2(S.res.G.P[i]), fmt2(S.res.G.E[i]), fmt2(S.res.G.V[i]), p.pob, p.exp_obs, p.exp_mod, ...S.factors.map(f => { const v = S.model.F[f.id].pct[i]; return Number.isNaN(v) ? '' : v.toFixed(3); })].join(','));
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' })); a.download = `cauce-prioridad-${S.mun}.csv`; a.click();
});

// ------------------------------------------------------------------ URL hash (shareable weights / municipality / selection)
function writeHash() {
  if (DEMO || !S.rows.length) return;
  const g = S.weights.groups; const f = Object.entries(S.weights.factors).map(([k, v]) => `${k}:${v}`).join(',');
  const h = `w=${Math.round(g.P * 100)}-${Math.round(g.E * 100)}-${Math.round(g.V * 100)}${f ? `&f=${f}` : ''}${S.mun !== 'all' ? `&m=${S.mun}` : ''}${S.sel != null ? `&s=${S.rows[S.sel].cvegeo}` : ''}${S.heightMode !== 'obs' ? `&h=${S.heightMode}` : ''}`;
  history.replaceState(null, '', '#' + h);
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('w')) { const [P, E, V] = h.get('w').split('-').map(Number); if ([P, E, V].every(Number.isFinite)) { S.weights.groups = { P: P / 100, E: E / 100, V: V / 100 }; S.preset = 'custom'; } }
  if (h.get('f')) for (const kv of h.get('f').split(',')) { const [k, v] = kv.split(':'); if (k && Number.isFinite(+v)) S.weights.factors[k] = +v; }
  if (h.get('m')) S.mun = h.get('m');
  if (h.get('s') && S.idx.has(h.get('s'))) S.sel = S.idx.get(h.get('s'));
  if (['obs', 'mod', 'pob'].includes(h.get('h'))) S.heightMode = h.get('h');
  if (S.preset === 'custom' && JSON.stringify(S.weights.groups) === JSON.stringify(M.DEFAULT_GROUP_W) && !Object.keys(S.weights.factors).length) S.preset = 'equilibrado';
}

// ------------------------------------------------------------------ demo (?demo=1): ~25 s scripted tour, deterministic seek(t)
const DUR = 25;
let D = null; // precomputed demo plan
function planDemo() {
  const A = { groups: { ...M.DEFAULT_GROUP_W }, factors: {} };
  const B = { groups: { ...M.PRESETS.gente.groups }, factors: { ...M.PRESETS.gente.factors } };
  const rA = M.score(S.model, A), rB = M.score(S.model, B);
  const top10 = rA.order.slice(0, 10).map(i => S.ex[S.rows[i].cvegeo]?.lp).filter(Boolean);
  const cx = top10.reduce((s, c) => s + c[0], 0) / top10.length, cy = top10.reduce((s, c) => s + c[1], 0) / top10.length;
  const star = rA.order[0];
  // the AGEB that climbs most into B's top 10
  let riser = null, best = 0;
  const vis = isPhone() ? 4 : 8;
  for (const i of rB.order.slice(0, vis)) { const d = (rA.rank[i] || 999) - rB.rank[i]; if (d > best) { best = d; riser = i; } }
  const munCount = {}; rA.order.slice(0, 10).forEach(i => { const m = shortMun(S.rows[i].mun_nombre); munCount[m] = (munCount[m] || 0) + 1; });
  const topMun = Object.entries(munCount).sort((a, b) => b[1] - a[1])[0];
  const posA = new Map(), posB = new Map();
  rA.order.slice(0, 25).forEach((i, k) => posA.set(i, k)); rB.order.slice(0, 25).forEach((i, k) => posB.set(i, k));
  // frame the top 5 (they pulse in chapter 2): bbox centre, zoom so the bbox spans ~80 % of the map width
  let k2 = null;
  {
    const pts = rA.order.slice(0, 5).map(i => S.ex[S.rows[i].cvegeo]?.lp).filter(Boolean);
    if (pts.length) {
      const bb = pts.reduce((b, c) => [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])], [180, 90, -180, -90]);
      const lat = (bb[1] + bb[3]) / 2, cosl = Math.cos(lat * Math.PI / 180);
      const wM = Math.max(3000, (bb[2] - bb[0]) * 111320 * cosl, (bb[3] - bb[1]) * 110540 * 1.4);
      const W = S.map.getCanvas().clientWidth;
      const z = Math.log2(78271.5 * cosl * 0.62 * W / wM); // MapLibre: 512 px tiles
      k2 = { center: [(bb[0] + bb[2]) / 2, lat + (isPhone() ? 0.012 : 0.006)], zoom: Math.max(isPhone() ? 9.8 : 10.5, Math.min(12.2, z)) };
    }
  }
  return { A, B, rA, rB, center10: [cx, cy], k2, star, riser, rise: best, topMun, posA, posB, phone: isPhone() };
}
const lerp = (a, b, u) => a + (b - a) * u;
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
function camAt(t) {
  const ph = D.phone, base = { center: [-103.352, ph ? 20.648 : 20.63], zoom: ph ? 9.6 : 10.72, pitch: 50, bearing: -34 };
  const k1 = { center: [-103.352, ph ? 20.648 : 20.63], zoom: ph ? 9.72 : 10.9, pitch: 55, bearing: -20 };
  const k2 = D.k2 ? { ...D.k2, pitch: 58, bearing: -8 } : { center: D.center10, zoom: ph ? 10.75 : 11.55, pitch: 58, bearing: -8 };
  const lp = S.ex[S.rows[D.star].cvegeo].lp;
  const lp3 = ph ? [lp[0], lp[1] + 0.0022] : lp;
  const k3a = { center: lp3, zoom: ph ? 14.4 : 14.95, pitch: 48, bearing: -8 };
  const k3b = { center: lp3, zoom: ph ? 14.6 : 15.2, pitch: 54, bearing: 18 };
  const k4 = { center: [D.center10[0] - 0.01, D.center10[1] + (ph ? 0.02 : 0.012)], zoom: ph ? 9.95 : 11.0, pitch: 54, bearing: -14 };
  const L = (a, b, u) => ({ center: [lerp(a.center[0], b.center[0], u), lerp(a.center[1], b.center[1], u)], zoom: lerp(a.zoom, b.zoom, u), pitch: lerp(a.pitch, b.pitch, u), bearing: lerp(a.bearing, b.bearing, u) });
  if (t < 4.6) return L(base, k1, seg(t, 0, 4.6));
  if (t < 6.6) return L(k1, k2, ease(seg(t, 4.6, 6.6)));
  if (t < 10.4) return L(k2, { ...k2, bearing: k2.bearing + 8, zoom: k2.zoom + 0.12 }, seg(t, 6.6, 10.4));
  if (t < 12.4) return L({ ...k2, bearing: k2.bearing + 8, zoom: k2.zoom + 0.12 }, k3a, ease(seg(t, 10.4, 12.4)));
  if (t < 17.4) return L(k3a, k3b, seg(t, 12.4, 17.4));
  if (t < 19.6) return L(k3b, k4, ease(seg(t, 17.4, 19.6)));
  return L(k4, { ...k4, bearing: k4.bearing + 10 }, seg(t, 19.6, DUR));
}
function captionAt(t) {
  const n = i => esc(S.ex[S.rows[i].cvegeo]?.name || S.rows[i].cvegeo), mn = i => esc(shortMun(S.rows[i].mun_nombre));
  if (t < 4.6) return { k: 1, ch: '1 / 4 · El mapa', t: `${fmtInt(S.rows.length)} AGEB, <em>una pregunta</em>`, d: '¿Dónde coinciden el agua y la necesidad? Altura: personas que viven donde IMEPLAN ya registró inundación. Color: peligro × vulnerabilidad.' };
  if (t < 10.4) return { k: 2, ch: '2 / 4 · Las más urgentes', t: `${n(D.star)}, <em>${mn(D.star)}</em>, encabeza`, d: `Con pesos equilibrados, ${D.topMun[1]} de las 10 primeras zonas están en ${esc(D.topMun[0])}. Torres oscuras: mucho peligro y mucha vulnerabilidad a la vez.` };
  if (t < 17.4) {
    const p = S.rows[D.star];
    return { k: 3, ch: '3 / 4 · ¿Por qué aquí?', t: `¿Por qué <em>${n(D.star)}</em>?`, d: `${Math.round(+p.imeplan_area_pct)} % de su superficie está en zonas con inundación registrada; grado de marginación ${esc((p.gm_2020 || '—').toLowerCase())}; ${fmtInt(p.pob)} habitantes. Rayado: polígonos IMEPLAN; puntos: escuelas y salud.` };
  }
  return { k: 4, ch: '4 / 4 · Tú decides los pesos', t: `Más peso a la gente: <em>el orden cambia</em>`, d: D.riser != null ? `“Primero la gente” sube ${n(D.riser)} (${mn(D.riser)}) del #${D.rA.rank[D.riser]} al #${D.rB.rank[D.riser]}. Es una herramienta para discutir prioridades, no un veredicto.` : 'Cambiar los pesos reordena el ranking.' };
}
let lastCapKey = null, lastWhyKey = null;
function applyDemo(t) {
  t = clamp(t, 0, DUR);
  // camera
  S.map.jumpTo(camAt(t));
  // weights: A until 18, then interpolate to B by 21 (desktop); phone: 17.8 → 19.4
  const u = D.phone ? ease(seg(t, 17.8, 19.4)) : ease(seg(t, 18.0, 21.0));
  const W = { groups: {}, factors: {} };
  for (const g of ['P', 'E', 'V']) W.groups[g] = lerp(D.A.groups[g], D.B.groups[g], u);
  for (const f of S.factors) { const a = D.A.factors[f.id] ?? f.w, b = D.B.factors[f.id] ?? f.w; if (a !== b || f.id in D.B.factors) W.factors[f.id] = lerp(a, b, u); }
  const wKey = u.toFixed(3);
  if (wKey !== S._wKey) { S._wKey = wKey; S.weights = W; S.preset = u >= 1 ? 'gente' : u <= 0 ? 'equilibrado' : 'custom'; recompute(); syncWeightsUI(); }
  // height grow-in during chapter 1
  S.heightGrow = ease(seg(t, 0.2, 3.2));
  // selection / focus
  const inExplain = t >= 10.4 && t < 17.6;
  S.focus = inExplain && t >= 11.4;
  if (S.sel !== D.star) setSelection(D.star);
  S.whyGrow = t < 10.4 ? 1 : ease(seg(t, 11.0, 12.6));
  // pulses on ranks 1..5 during chapter 2
  S.pulse = t >= 6.4 && t < 10.4 ? D.rA.order[Math.min(4, Math.floor((t - 6.4) / 0.8))] : null;
  pushStates();
  // list positions
  const ul = D.phone ? ease(seg(t, 19.6, 21.6)) : u;
  ensureCards(new Set([...D.posA.keys(), ...D.posB.keys()]));
  listAnim = { from: D.posA, to: D.posB, t0: 0, dur: 0 };
  layoutList(ul, D.posA, D.posB);
  renderListContent();
  // scroll the list to show the pulsed card
  $('#rank').scrollTop = 0;
  // tabs
  if (D.phone) { const pt = t < 10.4 ? 'rank' : t < 17.6 ? 'why' : t < 19.6 ? 'weights' : 'rank'; if (S.ptab !== pt) setPhoneTab(pt); }
  else { const tb = t < 17.6 ? 'why' : 'weights'; if (S.tab !== tb) setTab(tb); }
  const whyKey = `${S.sel}|${S.whyGrow.toFixed(3)}|${wKey}`;
  if (whyKey !== lastWhyKey) { lastWhyKey = whyKey; renderWhy(); }
  $$('#weights .demo-active').forEach(el => el.classList.remove('demo-active'));
  if (t >= 17.6 && t < 21.4) { $$('#weights [data-grow="V"], #weights [data-frow="marg"], #weights [data-frow="dep"]').forEach(el => el.classList.add('demo-active')); }
  { const pane = $('#weights'); if (pane) pane.scrollTop = 0; }
  $$('#weights [data-preset]').forEach(b => b.classList.toggle('on', b.dataset.preset === (t >= 18 ? 'gente' : 'equilibrado')));
  // caption
  const cap = captionAt(t);
  const capEl = $('#caption');
  const key = cap.k + '|' + cap.t + cap.d;
  if (key !== lastCapKey) { lastCapKey = key; capEl.innerHTML = `<div class="ch">${cap.ch}</div><div class="t">${cap.t}</div><div class="d">${cap.d}</div>`; }
  const edges = [0, 4.6, 10.4, 17.4, DUR];
  let op = 1; for (const ed of edges.slice(1, -1)) { const d = Math.abs(t - ed); if (d < 0.25) op = Math.min(op, d / 0.25); }
  op = Math.min(op, seg(t, 0.4, 0.9));
  capEl.style.opacity = op.toFixed(3);
  renderLegendOnce();
  S.map.triggerRepaint();
}
let legendDone = false;
function renderLegendOnce() { if (!legendDone) { legendDone = true; renderLegend(); } }
function waitFrame() { return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }
function waitIdle(ms = 9000) {
  return new Promise(res => { const m = S.map; let done = false; const fin = () => { if (!done) { done = true; res(); } }; if (m.loaded() && m.areTilesLoaded()) { m.once('render', fin); m.triggerRepaint(); setTimeout(fin, 400); } else { m.once('idle', fin); } setTimeout(fin, ms); });
}
let playing = false, playT0 = 0;
function startDemo() {
  D = planDemo();
  window.__cauceDemo = {
    duration_s: DUR,
    async seek(t) { playing = false; applyDemo(t); await waitIdle(); applyDemo(t); await waitFrame(); return true; },
    play() { playing = true; playT0 = performance.now(); loop(); },
    pause() { playing = false; },
  };
  if (params.get('autoplay') !== '0') {
    // wait for initial tiles, then autoplay in a loop
    waitIdle(6000).then(() => window.__cauceDemo.play());
  } else applyDemo(0);
}
function loop() {
  if (!playing) return;
  let t = (performance.now() - playT0) / 1000;
  if (t > DUR + 2) { playT0 = performance.now(); t = 0; }
  applyDemo(Math.min(t, DUR));
  requestAnimationFrame(loop);
}

boot().catch(err => {
  console.error(err);
  $('#boot p').innerHTML = `No se pudo cargar el perfil de AGEB (${esc(err.message)}).<br>Fuente: <code>${URLS.profile}</code>`;
});
