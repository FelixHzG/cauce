// cauce. navegación — maqueta de juguete (nav-juguete)
// Toy-town diorama navigation prototype: avoid flood-prone places, Waze-style flood alerts, 3D toy car.
import { Line, GF, hazardsFromGeoJSON, stepSpanish } from './geo.js';
import { planRoutes } from './routing.js';
import { Toy } from './toy3d.js';

const Q = new URLSearchParams(location.search);
const DEMO = Q.get('demo') === '1';
if (DEMO) document.body.classList.add('demo');
const PERF = new Set((Q.get('perf') || '').split(',')); // dev-only switches for profiling: notilt,nofilter,nobld,no3d,norain,nograd
if (PERF.has('notilt')) document.querySelectorAll('.tilt').forEach(e => e.remove());
if (PERF.has('nofilter')) document.head.insertAdjacentHTML('beforeend', '<style>#map canvas{filter:none!important}</style>');
const $ = s => document.querySelector(s);
const SHARED = '/labs/shared';
const EXAG = 1.4, BLD_EXAG = 1.5;
const BASE = new URL('./', import.meta.url).href;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const pop = (a, x, d = .6) => { const k = clamp((x - a) / d, 0, 1); return k <= 0 ? 0 : 1 - Math.exp(-7 * k) * Math.cos(10 * k); };
const angLerp = (a, b, t) => a + (((b - a + 540) % 360) - 180) * t;
const fmtDist = m => m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;
const getJSON = async (u, ms = 8000) => { const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms); try { const r = await fetch(u, { signal: c.signal, cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return await r.json(); } finally { clearTimeout(tm); } };
const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = (s, n = 38) => s.length > n ? s.slice(0, n - 1) + '…' : s;

const ORIGIN = { name: 'Glorieta Minerva', ll: [-103.3925, 20.6743] };
const PLACES = {
  estadio: { name: 'Estadio Jalisco', ll: [-103.3283, 20.7051], cache: 'demo-estadio.json' },
  catedral: { name: 'Catedral', ll: [-103.3467, 20.6757] },
  tlaquepaque: { name: 'Centro de Tlaquepaque', ll: [-103.3124, 20.6406] },
  expo: { name: 'Expo Guadalajara', ll: [-103.3913, 20.6527] },
  aeropuerto: { name: 'Aeropuerto GDL', ll: [-103.3111, 20.5218] },
};
const DEFAULT_DEST = 'estadio';
const DEBUG_CAM = Q.get('cam') ? (([x, y, z, p, b]) => ({ c: [x, y], zoom: z, pitch: p, bearing: b, pad: 0 }))(Q.get('cam').split(',').map(Number)) : null;

// ---------------------------------------------------------------------------------------------------------
// icons
const ICONS = {
  straight: '<path d="M24 40V10M13 20l11-11 11 11"/>',
  right: '<path d="M14 40V24q0-6 6-6h16M28 10l9 8-9 8"/>',
  left: '<path d="M34 40V24q0-6-6-6H12M20 10l-9 8 9 8"/>',
  'slight-right': '<path d="M16 41V28l15-15M21 11h11v11"/>',
  'slight-left': '<path d="M32 41V28L17 13M27 11H16v11"/>',
  'sharp-right': '<path d="M15 9v18l18 12M22 41h12V29"/>',
  'sharp-left': '<path d="M33 9v18L15 39M26 41H14V29"/>',
  uturn: '<path d="M32 41V18a8 8 0 0 0-16 0v12M9 23l7 8 7-8"/>',
  roundabout: '<circle cx="24" cy="21" r="8"/><path d="M24 41V29M30.5 15.5L37 9M29 9h8v8"/>',
  arrive: '<path d="M14 42V8M14 9h20l-5 7 5 7H14"/>',
  recalc: '<path d="M38 20a15 15 0 1 0 1 9"/><path d="M39 9v11H28"/>',
};
const mIcon = k => `<svg viewBox="0 0 48 48" fill="none" stroke="#2b2440" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ICONS.straight}</svg>`;
const AICON = {
  underpass: '<svg viewBox="0 0 48 48" fill="none" stroke="#2b2440" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="40" height="7" rx="2" fill="#2b2440"/><path d="M15.5 25.5Q24 40 32.5 25.5z" fill="#2ea8ff" stroke-width="3"/><path d="M3 22h10q11 24 22 0h10"/><path d="M18 29.5q3-2 6 0t6 0" stroke="#fff" stroke-width="2.5"/></svg>',
  critical: '<svg viewBox="0 0 48 48" fill="none" stroke="#2b2440" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M24 6L44 41H4z" fill="#fff"/><path d="M24 18v11" stroke-width="5"/><circle cx="24" cy="35" r="1.6" fill="#2b2440"/></svg>',
  site: '<svg viewBox="0 0 48 48" fill="none" stroke="#2b2440" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M24 5c6 9 13 15 13 24a13 13 0 0 1-26 0c0-9 7-15 13-24z" fill="#2ea8ff"/><path d="M18 30a6 6 0 0 0 5 6" stroke="#fff"/></svg>',
  hotspot: '<svg viewBox="0 0 48 48" fill="none" stroke="#2b2440" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 40V22a18 18 0 0 1 36 0v18" fill="#fff"/><path d="M14 40V24a10 10 0 0 1 20 0v16" fill="#2b2440"/><path d="M4 41h40"/></svg>',
  water: '<svg viewBox="0 0 48 48" fill="none" stroke="#2b2440" stroke-width="4" stroke-linecap="round"><path d="M5 20c6-6 9 6 15 0s9 6 15 0 7 0 8 0M5 31c6-6 9 6 15 0s9 6 15 0 7 0 8 0"/></svg>',
  modeled: '<svg viewBox="0 0 48 48" fill="none" stroke="#2b2440" stroke-width="4" stroke-linecap="round"><path d="M5 20c6-6 9 6 15 0s9 6 15 0 7 0 8 0M5 31c6-6 9 6 15 0s9 6 15 0 7 0 8 0"/></svg>',
  rain: '<svg viewBox="0 0 48 48" fill="none" stroke="#2b2440" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 30a9 9 0 0 1 1-18 12 12 0 0 1 22 4 7 7 0 0 1-1 14z" fill="#fff"/><path d="M17 36l-2 5M25 36l-2 5M33 36l-2 5"/></svg>',
  ok: '<svg viewBox="0 0 48 48" fill="none" stroke="#2b2440" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 25l9 9 17-19"/></svg>',
  sun: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><circle cx="24" cy="24" r="8"/><path d="M24 5v5M24 38v5M5 24h5M38 24h5M10.5 10.5l3.5 3.5M34 34l3.5 3.5M10.5 37.5l3.5-3.5M34 14l3.5-3.5"/></svg>',
  cloud: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 29a9 9 0 0 1 1-18 12 12 0 0 1 22 4 7 7 0 0 1-1 14z"/><path d="M17 35l-2 6M25 35l-2 6M33 35l-2 6"/></svg>',
  flag: '<svg viewBox="0 0 48 48" fill="none" stroke="#2b2440" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 44V6"/><path d="M12 7h26l-6 8 6 8H12z" fill="#ffc83d"/></svg>',
};
const CAT_TITLE = { underpass: 'Paso a desnivel inundable', critical: 'Zona crítica IMEPLAN', site: 'Encharcamiento reportado', report: 'Encharcamiento reportado', area: 'Área de inundación registrada', hotspot: 'Paso inferior o túnel', water: 'Cuerpo de agua', modeled: 'Agua modelada', 'terrain-index': 'Zona baja' };
const CAT_ICON = { report: 'site', area: 'site' };
const CAT_SRC = { underpass: 'IMEPLAN · registro histórico', critical: 'IMEPLAN · registro histórico', site: 'IMEPLAN · registro histórico', hotspot: 'OSM · vía bajo nivel, no es registro', water: 'OSM · agua permanente', modeled: 'modelo exploratorio, no pronóstico', 'terrain-index': 'índice de terreno' };
const CAT_RANK = { underpass: 6, critical: 5, hotspot: 4, site: 3, modeled: 3, area: 2, report: 1, water: 0, 'terrain-index': 0 };
const LABEL_PRI = { underpass: 3, critical: 3, site: 3, hotspot: 2, modeled: 2, report: 1, area: 0, water: 0, 'terrain-index': 0 };
const layerMeta = new Map();

// ---------------------------------------------------------------------------------------------------------
// data loading
async function loadHazardIndex() {
  let idx = { layers: [] };
  try { idx = await getJSON(`${SHARED}/hazard/index.json`); } catch (e) { console.warn('hazard index', e); }
  const layers = await Promise.all((idx.layers || []).map(async l => {
    if (l.type === 'geojson') { try { return { ...l, gj: await getJSON(l.url, 30000) }; } catch (e) { console.warn('hazard layer missing', l.id, e); return null; } }
    if (l.type === 'raster-tiles' && (l.url || l.tiles)) return { ...l };
    return { ...l, unsupported: true };
  }));
  return layers.filter(Boolean);
}
async function demSource() {
  const terrarium = { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 15 };
  try {
    const st = await getJSON(`${SHARED}/status/terrain.json`, 4000);
    if (['ready', 'done'].includes(st.state)) {
      const ix = await getJSON(`${SHARED}/terrain/index.json`, 4000);
      const c = [ix, ix.web, ix.terrain, ix.dem, ...(ix.layers || []), ...(ix.tilesets || [])].find(o => o && (o.tiles || o.url || o.tileUrl) && !/ndsm|mds-mdt|height|hillshade/i.test(o.id || ''));
      if (c) {
        let tiles = c.tiles || [c.tileUrl || c.url]; tiles = tiles.map(u => new URL(u, `${location.origin}${SHARED}/terrain/`).href);
        if (tiles[0].includes('{z}')) return { src: { type: 'raster-dem', tiles, encoding: c.encoding || 'terrarium', tileSize: c.tileSize || 256, maxzoom: c.maxzoom || 15, minzoom: c.minzoom || 0, ...(c.bounds ? { bounds: c.bounds } : {}) }, label: 'Terreno: INEGI MDT 5 m', inegi: true };
      }
    }
  } catch (e) { /* fall back */ }
  return { src: terrarium, label: 'Relieve: AWS Terrain Tiles (Mapzen)', inegi: false };
}
let routerP = null;
function getRouter() {
  if (!routerP) routerP = (async () => { const mod = await import(`${SHARED}/router/router.js`); const r = await mod.loadRouter(); try { r.preload && r.preload(); } catch (e) { /* optional */ } return r; })();
  return routerP;
}

// ---------------------------------------------------------------------------------------------------------
// map style: toy play-mat
function toyStyle(dem, bldMeta) {
  const roads = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'];
  const byClass = (k, mw, pr, te, mi, se) => ['match', ['get', 'class'], ['motorway', 'trunk'], mw * k, ['primary', 'secondary'], pr * k, 'tertiary', te * k, 'minor', mi * k, se * k];
  const widthK = k => ['interpolate', ['exponential', 1.6], ['zoom'], 12, byClass(k, 2.1, 1.5, .9, .5, .2), 14, byClass(k, 6, 4.2, 2.6, 1.4, .6), 16, byClass(k, 19, 14, 10, 6.5, 3.5), 18, byClass(k, 50, 38, 28, 20, 11)];
  const fill = ['match', ['get', 'class'], ['motorway', 'trunk'], '#7d8499', ['primary', 'secondary'], '#878ea2', 'tertiary', '#9aa0b2', 'minor', '#b3b7c4', '#c6c8d1'];
  const PAL = ['#fff5e4', '#fde8d2', '#f5eee6', '#ffd59e', '#ffc0b0', '#fbe38f', '#9fd8f5', '#bcaeff'];
  // calm creams for low buildings, warm pastels mid-rise, cool/saturated toy colours for the tall ones
  const bldColor = ['case',
    ['<', ['get', 'h'], 6.5], ['match', ['%', ['get', 'k'], 4], 0, '#fffaf2', 1, '#ffe9d1', 2, '#fff1c2', '#f3f0ff'],
    ['<', ['get', 'h'], 12], ['match', ['%', ['get', 'k'], 4], 0, '#ffd59e', 1, '#ffc0b0', 2, '#fbe38f', '#c4efc4'],
    ['<', ['get', 'h'], 25], ['match', ['%', ['get', 'k'], 3], 0, '#9fd8f5', 1, '#bcaeff', '#9fe3b0'],
    ['match', ['%', ['get', 'k'], 3], 0, '#7fb2ff', 1, '#ff9ccd', '#6fd6c6']];
  const empty = () => ({ type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      bld: { type: 'vector', tiles: [`${BASE}tiles/{z}/{x}/{y}.pbf`], minzoom: 13, maxzoom: 15, bounds: bldMeta?.bbox || [-103.44, 20.6, -103.29, 20.73] },
      dem, hs: { ...dem }, hz: empty(), tape: empty(), pts: empty(),
    },
    terrain: { source: 'dem', exaggeration: EXAG },
    sky: { 'sky-color': '#9fd9ff', 'horizon-color': '#fff1d6', 'fog-color': '#fbecd0', 'fog-ground-blend': .8, 'horizon-fog-blend': .7, 'sky-horizon-blend': .65, 'atmosphere-blend': 0 },
    light: { anchor: 'viewport', color: '#ffffff', intensity: .32, position: [1.2, 200, 35] },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#e9d7b4' } },
      { id: 'landuse', type: 'fill', source: 'ofm', 'source-layer': 'landuse', paint: { 'fill-color': ['match', ['get', 'class'], 'residential', '#ecdcbb', ['commercial', 'retail'], '#ffe2cf', 'industrial', '#e7e0f4', 'hospital', '#ffdbe2', ['school', 'university', 'college', 'kindergarten'], '#fff0b5', 'cemetery', '#d4e9c2', ['stadium', 'pitch', 'playground'], '#c5ebb0', 'railway', '#e2d6c2', '#eadab9'] } },
      { id: 'landcover', type: 'fill', source: 'ofm', 'source-layer': 'landcover', paint: { 'fill-color': ['match', ['get', 'class'], 'wood', '#9fd68a', 'grass', '#bfe6a0', 'farmland', '#e6ebb5', 'sand', '#f6e2ae', 'wetland', '#b9e6cf', '#c9e8ad'], 'fill-opacity': .95 } },
      { id: 'park', type: 'fill', source: 'ofm', 'source-layer': 'park', paint: { 'fill-color': '#b1e294', 'fill-outline-color': '#88c96d' } },
      { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', paint: { 'fill-color': '#5cc6f0' } },
      { id: 'water-rim', type: 'line', source: 'ofm', 'source-layer': 'water', paint: { 'line-color': '#b6ecff', 'line-width': 2.5, 'line-offset': 1.5 } },
      { id: 'waterway', type: 'line', source: 'ofm', 'source-layer': 'waterway', paint: { 'line-color': '#5cc6f0', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 4] } },
      { id: 'hillshade', type: 'hillshade', source: 'hs', paint: { 'hillshade-exaggeration': .38, 'hillshade-shadow-color': 'rgba(120,92,60,.55)', 'hillshade-highlight-color': 'rgba(255,255,255,.35)', 'hillshade-accent-color': 'rgba(150,120,90,.25)', 'hillshade-illumination-anchor': 'map', 'hillshade-illumination-direction': 315 } },
      { id: 'aeroway', type: 'fill', source: 'ofm', 'source-layer': 'aeroway', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#d9dce6' } },
      { id: 'rail', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': '#b5795f', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 17, 5] } },
      { id: 'rail-ties', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 14, filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': '#fff6e8', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 17, 3], 'line-dasharray': [1, 2] } },
      { id: 'path', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 15, filter: ['in', ['get', 'class'], ['literal', ['path', 'pedestrian']]], paint: { 'line-color': '#fff7e6', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.2, 18, 6] } },
      { id: 'road-tunnel', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: ['all', ['in', ['get', 'class'], ['literal', roads]], ['==', ['get', 'brunnel'], 'tunnel']], layout: { 'line-join': 'round' }, paint: { 'line-color': '#8d8aa3', 'line-width': widthK(1), 'line-opacity': .55, 'line-dasharray': [.6, .35] } },
      { id: 'road-case', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: ['all', ['in', ['get', 'class'], ['literal', roads]], ['!=', ['get', 'brunnel'], 'tunnel']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4e4a66', 'line-width': widthK(1) } },
      { id: 'road', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: ['all', ['in', ['get', 'class'], ['literal', roads]], ['!=', ['get', 'brunnel'], 'tunnel']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': fill, 'line-width': widthK(.78) } },
      { id: 'road-dash', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 14.5, filter: ['all', ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]], ['!=', ['get', 'brunnel'], 'tunnel']], paint: { 'line-color': '#fffaf0', 'line-width': ['interpolate', ['linear'], ['zoom'], 14.5, .8, 16, 1.6, 18, 4], 'line-dasharray': [3, 3] } },
      { id: 'bridge-case', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: ['all', ['in', ['get', 'class'], ['literal', roads]], ['==', ['get', 'brunnel'], 'bridge']], paint: { 'line-color': '#2b2440', 'line-width': widthK(1.12), 'line-opacity': .7 } },
      { id: 'bridge', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: ['all', ['in', ['get', 'class'], ['literal', roads]], ['==', ['get', 'brunnel'], 'bridge']], paint: { 'line-color': '#a3a8b8', 'line-width': widthK(.8) } },
      // hazards (draped): observed/modeled footprints, OSM underpass "caution tape"
      { id: 'hz-fill', type: 'fill', source: 'hz', paint: { 'fill-color': ['match', ['get', 'kind'], 'observed', '#2ea8ff', '#9d84ff'], 'fill-opacity': 0 } },
      { id: 'hz-line', type: 'line', source: 'hz', paint: { 'line-color': ['match', ['get', 'kind'], 'observed', '#1677d6', '#6e55d8'], 'line-width': 2, 'line-opacity': 0, 'line-dasharray': [2, 1.2] } },
      { id: 'tape-case', type: 'line', source: 'tape', paint: { 'line-color': '#2b2440', 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 3, 16, 12, 18, 28], 'line-opacity': 0 } },
      { id: 'tape', type: 'line', source: 'tape', paint: { 'line-color': '#ffc83d', 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 2, 16, 8, 18, 20], 'line-dasharray': [1, 1], 'line-opacity': 0 } },
      { id: 'pts', type: 'circle', source: 'pts', paint: { 'circle-color': ['match', ['get', 'kind'], 'observed', '#2ea8ff', 'modeled', '#9d84ff', '#ffc83d'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 13, 2.4, 15, 5, 17, 9], 'circle-stroke-color': '#2b2440', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, .4, 14, 1, 16, 2], 'circle-opacity': 0, 'circle-stroke-opacity': 0, 'circle-pitch-alignment': 'map' } },
      // building contact shadows (fake AO), then chunky toy extrusions
      { id: 'bld-shadow', type: 'fill', source: 'bld', 'source-layer': 'buildings', paint: { 'fill-color': 'rgba(70,52,80,.24)', 'fill-translate': ['interpolate', ['linear'], ['zoom'], 13, ['literal', [1, 1]], 16, ['literal', [4, 3]], 18, ['literal', [12, 9]]], 'fill-translate-anchor': 'viewport' } },
      { id: 'ofm-bld', type: 'fill-extrusion', source: 'ofm', 'source-layer': 'building', minzoom: 14, layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': ['match', ['%', ['to-number', ['id'], 0], 8], 0, PAL[0], 1, PAL[1], 2, PAL[2], 3, PAL[3], 4, PAL[4], 5, PAL[5], 6, PAL[6], PAL[7]], 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 4], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] } },
      { id: 'bld', type: 'fill-extrusion', source: 'bld', 'source-layer': 'buildings', paint: { 'fill-extrusion-color': bldColor, 'fill-extrusion-height': ['*', BLD_EXAG, ['get', 'h']], 'fill-extrusion-base': 0, 'fill-extrusion-vertical-gradient': true } },
    ],
  };
}
function addRouteLayers(map) {
  const empty = { type: 'FeatureCollection', features: [] };
  for (const id of ['r-fast', 'r-safe']) map.addSource(id, { type: 'geojson', data: empty, lineMetrics: true });
  for (const id of ['r-ghost', 'r-hit', 'r-trail']) map.addSource(id, { type: 'geojson', data: empty });
  const lw = k => ['interpolate', ['exponential', 1.5], ['zoom'], 11, 4 * k, 13, 8 * k, 14, 11 * k, 16, 22 * k, 18, 50 * k];
  const before = 'bld-shadow';
  map.addLayer({ id: 'r-ghost-case', type: 'line', source: 'r-ghost', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': lw(1.2), 'line-opacity': 0 } }, before);
  map.addLayer({ id: 'r-ghost', type: 'line', source: 'r-ghost', layout: { 'line-join': 'round' }, paint: { 'line-color': '#ff5d73', 'line-width': lw(.78), 'line-dasharray': [1.1, .8], 'line-opacity': 0 } }, before);
  map.addLayer({ id: 'r-fast-case', type: 'line', source: 'r-fast', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': lw(1.35), 'line-gradient': '#ffffff' } }, before);
  map.addLayer({ id: 'r-fast', type: 'line', source: 'r-fast', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': lw(.9), 'line-gradient': '#5b4dff' } }, before);
  map.addLayer({ id: 'r-hit', type: 'line', source: 'r-hit', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff5d73', 'line-width': lw(1.05), 'line-opacity': 0 } }, before);
  map.addLayer({ id: 'r-trail-case', type: 'line', source: 'r-trail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': lw(1.45), 'line-opacity': 0 } }, before);
  map.addLayer({ id: 'r-trail', type: 'line', source: 'r-trail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#16b873', 'line-width': lw(1.0), 'line-opacity': 0 } }, before);
  map.addLayer({ id: 'r-safe-case', type: 'line', source: 'r-safe', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': lw(1.45), 'line-gradient': 'rgba(255,255,255,0)' } }, before);
  map.addLayer({ id: 'r-safe', type: 'line', source: 'r-safe', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': lw(1.0), 'line-gradient': 'rgba(22,184,115,0)' } }, before);
  map.addLayer({ id: 'road-label', type: 'symbol', source: 'ofm', 'source-layer': 'transportation_name', minzoom: 14, filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]], layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10.5, 17, 14], 'text-max-angle': 30, 'symbol-spacing': 420 }, paint: { 'text-color': '#2b2440', 'text-halo-color': '#fffaf0', 'text-halo-width': 2.2 } });
}

// ---------------------------------------------------------------------------------------------------------
// hazard events (from the router) -> display groups
const imeplanByName = new Map(), siteByBase = new Map(), refByBase = new Map();
function indexImeplan(hz) {
  for (const h of hz) if (h.kind === 'observed') {
    imeplanByName.set(h.name, h); const base = h.name.split('/')[0];
    if (h.ref) refByBase.set(base, h.ref);
    if (/cm/.test(h.depthText) && (!siteByBase.get(base) || (h.depth || 0) > (siteByBase.get(base).depth || 0))) siteByBase.set(base, h);
  }
}
function resolveEvent(e) {
  let cat = e.kind, label = e.label || '', depthText = '', src = '';
  const p = e.props || {}, meta = layerMeta.get(e.layer) || {};
  if (e.kind === 'observed' && (p.category || /^SI-/.test(p.name || e.id || '') || /imeplan/i.test(e.layer || ''))) {
    const name = p.name || (/^SI-/.test(e.id || '') ? e.id : (/^SI-/.test(label) ? label : ''));
    const base = String(name).split('/')[0]; const h = imeplanByName.get(name);
    if ((!label || /^SI-[A-Z]+-\d+/.test(label)) && refByBase.get(base)) label = refByBase.get(base);
    if (h) cat = h.cat; else cat = /desnivel/i.test([p['Infraestructura expuesta'], p['Sistema afectable'], label].join(' ')) ? 'underpass' : p.category === 'Zonas Criticas' ? 'critical' : 'site';
    depthText = siteByBase.get(base)?.depthText || h?.depthText || ''; src = 'IMEPLAN · registro histórico';
  } else if (e.kind === 'observed' && p.fecha) { // dated emergency-service points (e.g. PC Zapopan)
    cat = 'report'; label = [p.calle, p.colonia].filter(Boolean).join(', ') || p.municipio || label; depthText = `servicio atendido ${p.fecha}`;
    src = `${p.municipio ? 'PC ' + p.municipio : 'Protección Civil'} · histórico`;
  } else if (e.kind === 'observed' && (p.nivel || p.clase)) { // registered flood areas with level
    cat = 'area'; label = p.municipio ? `Área registrada en ${p.municipio}` : 'Área registrada'; depthText = p.nivel ? `nivel ${p.nivel}` : ''; src = `${p.fuente || 'registro'} · histórico`;
  } else if (e.kind === 'hotspot' && p.riesgo) {
    cat = 'hotspot'; label = `${p.nombre || label}`; depthText = `riesgo ${p.riesgo}${p.causa ? ' · causa: ' + String(p.causa).toLowerCase() : ''}`; src = `Gobierno de ${p.municipio || 'municipio'}`;
  } else if (e.kind === 'hotspot') { cat = 'hotspot'; src = 'OSM · vía bajo nivel, no es registro'; }
  else if (e.kind === 'water') { cat = 'water'; src = 'OSM · agua permanente'; }
  else if (e.kind === 'modeled') { cat = 'modeled'; depthText = p.depth_m != null ? `${(+p.depth_m).toFixed(2)} m modelados` : ''; src = 'modelo exploratorio, no pronóstico'; }
  if (!src) src = short(meta.label || e.layer || '', 40);
  return { ...e, cat, label: label || meta.label || CAT_TITLE[cat] || 'Zona', depthText, src };
}
function groupEvents(list) {
  const groups = [];
  for (const raw of list) {
    const e = resolveEvent(raw);
    let g = groups.find(g => (g.label === e.label && Math.abs(g.s - e.s) < 400) || (Math.abs(g.s - e.s) < 60 && g.kind === 'observed' && e.kind === 'observed'));
    if (!g) { g = { label: e.label, lp: LABEL_PRI[e.cat] ?? 0, kind: e.kind, cat: e.cat, s: e.s, d: e.distance_m, items: [], depthText: e.depthText, src: e.src, loc: e.feature_location || e.location }; groups.push(g); }
    g.items.push(e); g.s = Math.min(g.s, e.s); g.d = Math.min(g.d, e.distance_m);
    if ((CAT_RANK[e.cat] || 0) > (CAT_RANK[g.cat] || 0)) { g.cat = e.cat; g.kind = e.kind; g.loc = e.feature_location || e.location; }
    if ((LABEL_PRI[e.cat] ?? 0) > g.lp) { g.lp = LABEL_PRI[e.cat] ?? 0; g.label = e.label; g.src = e.src; g.depthText = e.depthText || g.depthText; }
    else if (!g.depthText && e.depthText) g.depthText = e.depthText;
  }
  return groups.sort((a, b) => a.s - b.s);
}
function stepInfo(st) {
  if (st.type) {
    const mod = st.modifier || '';
    const icon = st.type === 'arrive' ? 'arrive' : (st.type === 'uturn' || mod === 'uturn') ? 'uturn' : /roundabout|rotary/.test(st.type) ? 'roundabout' : (mod || 'straight').replace(' ', '-');
    return { text: st.instruction, icon: ICONS[icon] ? icon : 'straight' };
  }
  return stepSpanish(st.instruction);
}

// ---------------------------------------------------------------------------------------------------------
// plan: everything the timeline needs, derived from the routes
function buildPlan(R) {
  const F = GF; const fast = new Line(R.fastest.coordinates, F);
  const ev = R.events || { fastCrossed: [], avoided: [], safeCrossed: [], safeNear: [] };
  const rerouted = !!(R.reroute && R.safe && ev.avoided.length);
  const sP = rerouted ? R.reroute.s : fast.length;
  const safe = rerouted ? new Line(R.safe.coordinates, F) : null;
  const drive = rerouted ? new Line([...fast.slice(0, sP), ...R.safe.coordinates.slice(1)], F) : fast;
  const sPd = rerouted ? drive.project(F.xy(R.reroute.point)).s : drive.length;
  const fastHitsAll = groupEvents(ev.fastCrossed);
  const avoided = groupEvents(ev.avoided);
  const safeHits = groupEvents(ev.safeCrossed).map(g => ({ ...g, sd: sPd + g.s }));
  const near = groupEvents((ev.safeNear || []).filter(e => e.kind !== 'water')).map(g => ({ ...g, sd: (rerouted ? sPd : 0) + g.s })).filter(g => !rerouted || g.sd > sPd + 60);
  const steps = []; let from = 0;
  const addSteps = (list, sMin, sMax) => {
    for (const st of list) {
      const p = drive.project(F.xy(st.location), Math.max(0, from - 30)); if (p.d > 60 || p.s < sMin - 5 || p.s > sMax + 5) continue;
      steps.push({ s: p.s, ...stepInfo(st) }); from = p.s;
    }
  };
  if (rerouted) { addSteps(R.fastest.steps.filter(st => fast.project(F.xy(st.location)).s < sP - 10), 0, sPd); addSteps(R.safe.steps.filter((st, i) => i > 0), sPd, drive.length); }
  else addSteps(R.fastest.steps, 0, drive.length);
  if (!steps.length || steps.at(-1).icon !== 'arrive') steps.push({ s: drive.length, text: 'Has llegado a tu destino', icon: 'arrive' });
  const stepsFast = []; { let f0 = 0; for (const st of R.fastest.steps) { const p = fast.project(F.xy(st.location), Math.max(0, f0 - 30)); if (p.d > 60) continue; stepsFast.push({ s: p.s, ...stepInfo(st) }); f0 = p.s; } }
  const fastDur = R.fastest.duration_s, fastDist = R.fastest.distance_m;
  const safeTotalDur = rerouted ? fastDur * sP / fast.length + R.safe.duration_s : fastDur, safeTotalDist = rerouted ? sP + R.safe.distance_m : fastDist;
  const slow = [];
  for (const st of steps) if (st.icon !== 'straight') slow.push({ s: st.s, a: .5, w: 120 });
  for (const n of near.slice(0, 3)) slow.push({ s: n.sd, a: .45, w: 200 });
  const hitSegs = fastHitsAll.map(g => fast.slice(Math.max(0, g.s - 25), Math.min(fast.length, g.s + 70)));
  const clusters = []; // avoided places, one map tag per ~350 m of route
  for (const g of avoided) { const c = clusters.find(c => Math.abs(c.s - g.s) < 350); if (c) c.items.push(g); else clusters.push({ s: g.s, items: [g] }); }
  for (const c of clusters) c.items.sort((a, b) => (b.lp - a.lp) || ((CAT_RANK[b.cat] || 0) - (CAT_RANK[a.cat] || 0)));
  return { R, F, fast, safe, drive, sP, sPd, fastHitsAll, avoided, safeHits, near, steps, stepsFast, slow, hitSegs, clusters, fastDur, fastDist, safeTotalDur, safeTotalDist, rerouted };
}
// speed profile: time -> distance on [s0, s1], slower near turns and nearby hazards
function makeProfile(plan, s0, s1, t0, t1) {
  const n = Math.max(2, Math.ceil((s1 - s0) / 8)), ds = (s1 - s0) / n, T = [0];
  for (let i = 1; i <= n; i++) {
    const s = s0 + (i - .5) * ds;
    let f = 1; for (const p of plan.slow) f -= p.a * Math.exp(-(((s - p.s) / p.w) ** 2));
    f = Math.max(.3, f) * (.25 + .75 * sstep(0, 300, s - s0)) * (.25 + .75 * sstep(0, 300, s1 - s));
    T.push(T[i - 1] + ds / f);
  }
  const tot = T[n];
  return t => {
    if (t <= t0) return s0; if (t >= t1) return s1;
    const target = (t - t0) / (t1 - t0) * tot;
    let lo = 0, hi = n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= target) lo = m; else hi = m; }
    return s0 + (lo + (target - T[lo]) / ((T[hi] - T[lo]) || 1)) * ds;
  };
}

// ---------------------------------------------------------------------------------------------------------
// timeline (seconds)
const TL = { dur: 30, rainOn: 1.8, swoop: [2.7, 4.6], d1: [4.2, 9.6], look: [5.5, 6.7, 8.1, 9.2], rrCalc: [9.6, 10.7], rrCam: [9.7, 11.0], drawSafe: [10.8, 12.0], rrHold: 12.5, rrBack: 13.6, d2: [12.9, 24.6], arrive: [24.5, 25.9], outro: [26.7, 28.6] };
let plan = null, prof1 = null, prof2 = null, cams = null;
function carS(t) {
  if (!plan) return 0;
  if (!plan.rerouted) return prof1(t);
  if (t < TL.d1[1]) return prof1(t);
  if (t < TL.d2[0]) return plan.sPd;
  return prof2(t);
}
function viewport() { const c = map.getContainer(); return { W: c.clientWidth, H: c.clientHeight, phone: c.clientWidth <= 640 }; }
function carPx() { const { W, H, phone } = viewport(); return phone ? 70 : clamp(Math.min(W, H) * .105, 72, 140); }
function speedAt(t) { let v = 0; for (let k = -2; k <= 2; k++) v += Math.abs(carS(t + k * .3 + .12) - carS(t + k * .3 - .12)) / .24; return v / 5; }
function followCam(t) {
  const s = carS(t); const { H, phone } = viewport();
  const z = clamp(17.25 - .9 * Math.log2(Math.max(speedAt(t), 70) / 110), 15.75, 17.2) - (phone ? .45 : 0);
  return { c: plan.drive.at(s), zoom: z, pitch: 60, bearing: plan.drive.heading(s, 90, 200, 10), pad: H * (phone ? .32 : .36) };
}
function boundsCam(lls, bearing, pitch, extraZ = 0, topPad = 150) {
  const { W, phone } = viewport();
  const b = new maplibregl.LngLatBounds(lls[0], lls[0]); for (const p of lls) b.extend(p);
  const { H } = viewport(); const k = Math.min(1, H / 1000);
  const pad = phone ? { top: (topPad + 60) * Math.min(1, H / 844), bottom: 200 * Math.min(1, H / 844), left: 24, right: 24 } : { top: topPad * k, bottom: 170 * k, left: Math.min(400, W * .25), right: Math.min(330, W * .21) };
  const cam = map.cameraForBounds(b, { padding: pad, bearing }) || { center: b.getCenter(), zoom: 13 };
  const c = cam.center.toArray ? cam.center.toArray() : [cam.center.lng, cam.center.lat];
  return { c, zoom: cam.zoom - .3 + extraZ, pitch, bearing, pad: 0 };
}
function computeCams() {
  const d = plan.drive, F = plan.F; const A = plan.R.from, B = plan.R.to;
  const [ax, ay] = F.xy(A), [bx, by] = F.xy(B); const brg = (Math.atan2(bx - ax, by - ay) * 180 / Math.PI + 360) % 360;
  const pick = (arr, k) => arr.filter((_, i) => i % k === 0);
  const over = boundsCam([...pick(plan.fast.ll, 3), ...(plan.safe ? pick(plan.safe.ll, 3) : []), A, B], brg, 50, 0, 390);
  const rr = plan.rerouted ? boundsCam([d.at(plan.sPd), B, ...pick(plan.fast.slice(plan.sP, plan.fast.length), 2), ...pick(plan.safe.ll, 2)], brg, 48, .15) : over;
  const c0 = plan.clusters.find(c => c.items[0].lp >= 2) || plan.clusters[0]; const sl = c0 ? Math.max(0, c0.s - 120) : 0;
  const look = c0 ? { c: plan.fast.at(c0.s + 40), zoom: 16.75 - (viewport().phone ? .5 : 0), pitch: 58, bearing: plan.fast.heading(sl, 150, 150), pad: viewport().H * .2 } : null;
  const outro = boundsCam([...pick(plan.drive.ll, 3), ...pick(plan.fast.ll, 3), A, B], brg + 6, 46, -.05, 230);
  return { over, rr, look, outro, brg, end: d.at(d.length), endBrg: d.heading(d.length - 5, 160, 0) };
}
function blendCam(a, b, k) { return { c: [lerp(a.c[0], b.c[0], k), lerp(a.c[1], b.c[1], k)], zoom: lerp(a.zoom, b.zoom, k), pitch: lerp(a.pitch, b.pitch, k), bearing: angLerp(a.bearing, b.bearing, k), pad: lerp(a.pad, b.pad, k) }; }
function camAt(t) {
  const o = cams.over; const k0 = clamp(t / TL.swoop[0], 0, 1);
  if (t < TL.swoop[0]) return { ...o, bearing: o.bearing - 12 + 12 * ease(k0), zoom: o.zoom + .3 * k0 };
  if (t < TL.swoop[1]) return blendCam({ ...o, zoom: o.zoom + .3 }, followCam(t), ease((t - TL.swoop[0]) / (TL.swoop[1] - TL.swoop[0])));
  if (plan.rerouted && cams.look && t >= TL.look[0] && t < TL.look[3]) {
    const f = followCam(t), lk = { ...cams.look, bearing: cams.look.bearing + 10 * sstep(TL.look[1], TL.look[2], t) };
    if (t < TL.look[1]) return blendCam(f, cams.look, ease((t - TL.look[0]) / (TL.look[1] - TL.look[0])));
    if (t < TL.look[2]) return lk;
    return blendCam(lk, f, ease((t - TL.look[2]) / (TL.look[3] - TL.look[2])));
  }
  if (plan.rerouted && t >= TL.rrCam[0] && t < TL.rrBack) {
    const f = followCam(t), rr = { ...cams.rr, bearing: cams.rr.bearing - 4 + 8 * sstep(TL.rrCam[1], TL.rrHold, t) };
    if (t < TL.rrCam[1]) return blendCam(f, { ...rr, bearing: cams.rr.bearing - 4 }, ease((t - TL.rrCam[0]) / (TL.rrCam[1] - TL.rrCam[0])));
    if (t < TL.rrHold) return rr;
    return blendCam(rr, f, ease((t - TL.rrHold) / (TL.rrBack - TL.rrHold)));
  }
  if (t < TL.arrive[0]) return followCam(t);
  const { phone, H } = viewport();
  const end = { c: cams.end, zoom: 16.9 - (phone ? .5 : 0), pitch: 62, bearing: cams.endBrg + 30 + 28 * sstep(TL.arrive[1], TL.dur, t), pad: H * .1 };
  if (t < TL.arrive[1]) return blendCam(followCam(t), end, ease((t - TL.arrive[0]) / (TL.arrive[1] - TL.arrive[0])));
  if (t < TL.outro[0] || !plan.rerouted) return end;
  const out = { ...cams.outro, bearing: cams.outro.bearing + 5 * sstep(TL.outro[1], TL.dur, t) };
  return t < TL.outro[1] ? blendCam(end, out, ease((t - TL.outro[0]) / (TL.outro[1] - TL.outro[0]))) : out;
}
function timeAtS(sd) { let lo = 0, hi = TL.dur; for (let k = 0; k < 32; k++) { const m = (lo + hi) / 2; if (carS(m) < sd) lo = m; else hi = m; } return hi; }

// ---------------------------------------------------------------------------------------------------------
// HUD helpers
let scenarios = [], activeScenario = 1, hazardsAll = [], hazardsActive = [], layersAll = [], activeIds = [];
const scenarioLayers = i => layersAll.filter(l => scenarios[i].layers.includes(l.id));
function buildScenarioUI() {
  const el = $('#scenario'); el.innerHTML = '';
  const modelIdx = scenarios.map((sc, i) => sc.cls.includes('modeled') ? i : -1).filter(i => i >= 0);
  const slots = [0, 1, ...(modelIdx.length ? [modelIdx[0]] : [])].filter(i => scenarios[i]);
  slots.forEach((i0, k) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = scenarios[i0].cls; b.dataset.slot = k;
    b.innerHTML = `${k === 0 ? AICON.sun : AICON.cloud}<span><span class="lbl">${esc(scenarios[i0].label)}</span><small>${esc(scenarios[i0].sub)}</small></span>`;
    b.addEventListener('click', () => {
      if (DEMO || playing) return;
      let i = i0; if (k === 2) { const cur = modelIdx.indexOf(activeScenario); i = modelIdx[(cur + 1) % modelIdx.length]; }
      setScenario(i);
    });
    el.append(b);
  });
}
let shownScenario = -1;
function showScenario(i) {
  if (i === shownScenario) return; shownScenario = i; const slot = i <= 1 ? i : 2;
  document.querySelectorAll('#scenario button').forEach((b, k) => { b.classList.toggle('on', k === slot); if (k === 2 && i >= 2) b.querySelector('small').textContent = scenarios[i].sub; });
}
const alertEls = new Map();
function renderAlerts(list) {
  const box = $('#alerts'); const live = new Set(); const visible = list.filter(a => a.o > .01);
  visible.forEach((a, i) => {
    live.add(a.id); let el = alertEls.get(a.id);
    if (!el) { el = document.createElement('div'); alertEls.set(a.id, el); box.append(el); }
    const html = `<div class="a-ic">${AICON[a.icon] || AICON.site}</div><div><b>${esc(a.title)}</b><span class="a-sub">${esc(a.sub)}</span><div class="a-meta">${a.chips.map(([c, x]) => `<span class="chip ${c}">${esc(x)}</span>`).join('')}</div></div>`;
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
    const cls = `alert ${a.cls}${i < visible.length - 1 ? ' older' : ''}`; if (el.className !== cls) el.className = cls;
    el.style.opacity = a.o; el.style.transform = `translateX(${(1 - a.o) * -40}px) scale(${a.s ?? 1})`; el.style.order = String(i);
  });
  for (const [id, el] of alertEls) if (!live.has(id)) { el.remove(); alertEls.delete(id); }
}
function setText(sel, txt) { const el = $(sel); if (el && el._t !== txt) { el.textContent = txt; el._t = txt; } }
function setHTML(sel, html) { const el = $(sel); if (el && el._h !== html) { el.innerHTML = html; el._h = html; } }
function clock(min) { const base = DEMO ? 18 * 60 + 30 : (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })(); const m = Math.round(base + min) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
const tags = new Map();
function tag(id, ll, html, cls, offsetY) {
  const el = document.createElement('div'); el.className = `maptag ${cls}`; el.innerHTML = html; el.style.display = 'none';
  const t = { el, m: new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, offsetY] }).setLngLat(ll).addTo(map) }; tags.set(id, t); return t;
}
function tagO(id, o) { const tg = tags.get(id); if (!tg) return; const k = o.toFixed(2); if (tg.el._o !== k) { tg.el._o = k; tg.el.style.opacity = o; tg.el.style.display = o < .01 ? 'none' : ''; } }
function clearTags() { for (const t of tags.values()) t.m.remove(); tags.clear(); }
const destName = () => PLACES[dest]?.name || 'Destino';

function buildLegend() {
  const act = layersAll.filter(l => activeIds.includes(l.id)), has = f => act.some(f);
  const rows = [];
  const polySrc = act.filter(l => l.kind === 'observed' && l.gj && l.gj.features.some(f => /Polygon/.test(f.geometry?.type || ''))).map(l => /imeplan/i.test(l.id) ? 'IMEPLAN MUI 2026' : (l.producer === 'infra-data' && /gdl/.test(l.id) ? 'Bomberos/PC Guadalajara' : short(l.label, 24)));
  if (polySrc.length) rows.push(`<div class="lg-row"><i class="lg-resin obs"></i><span>Zona inundable registrada <small>${esc(polySrc.join(', '))} · histórico, no en vivo</small></span></div>`);
  if (has(l => l.kind === 'observed' && l.gj && l.gj.features.some(f => f.geometry?.type === 'Point') && !/imeplan/i.test(l.id))) rows.push(`<div class="lg-row"><i class="lg-dot"></i><span>Servicio por inundación atendido <small>${esc(act.filter(l => l.kind === 'observed' && !/imeplan/i.test(l.id) && l.gj && l.gj.features.some(f => f.geometry?.type === 'Point')).map(l => short(l.label, 40)).join(', '))}</small></span></div>`);
  if (has(l => l.kind === 'hotspot')) rows.push(`<div class="lg-row"><i class="lg-tape"></i><span>Paso a desnivel o túnel <small>OSM${has(l => l.kind === 'hotspot' && /zapopan/.test(l.id)) ? ' y Gob. de Zapopan' : ''} · no es registro de inundación</small></span></div>`);
  if (has(l => l.kind === 'modeled') || scenarios[activeScenario]?.raster) rows.push(`<div class="lg-row"><i class="lg-resin mod"></i><span>Agua o peligro modelado <small>modelo exploratorio de terceros, no pronóstico</small></span></div>`);
  rows.push('<div class="lg-row"><i class="lg-line safe"></i><span>Ruta segura</span></div>', '<div class="lg-row"><i class="lg-line fast"></i><span>Ruta rápida (cruza agua)</span></div>');
  rows.push(`<div class="lg-row"><i class="lg-bld"></i><span>Edificios <small>huellas Overture · altura MDS−MDT INEGI 5 m (incluye árboles), ×${BLD_EXAG} visual</small></span></div>`);
  setHTML('#legend', rows.join(''));
}

// ---------------------------------------------------------------------------------------------------------
// the frame at time t: camera, map paint, 3D layer, DOM — a pure function of (plan, t)
let lastMood = '';
const paintCache = new Map();
function paint(id, prop, val) { const k = id + '|' + prop, v = typeof val === 'string' ? val : JSON.stringify(val); if (paintCache.get(k) === v) return; paintCache.set(k, v); map.setPaintProperty(id, prop, val); }
function applyState(t) {
  if (!plan) return;
  const P = plan, sc = scenarios[activeScenario];
  const rainy = sc.layers.length > 0;
  const rainK = rainy ? sstep(TL.rainOn, TL.rainOn + 1.0, t) : 0;
  const rerouteK = P.rerouted ? sstep(TL.drawSafe[0], TL.drawSafe[1], t) : 0;
  const s = carS(t), rr = P.rerouted && t >= TL.drawSafe[0];
  const arrived = s >= P.drive.length - 2 && t >= TL.d2[1] - .05;
  // camera
  const cam = DEBUG_CAM || camAt(t);
  map.jumpTo({ center: cam.c, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing, padding: { top: cam.pad, bottom: 0, left: 0, right: 0 } });
  const inBld = cam.c[0] > -103.43 && cam.c[0] < -103.30 && cam.c[1] > 20.61 && cam.c[1] < 20.72;
  if (map._ofmBld !== !inBld) { map._ofmBld = !inBld; map.setLayoutProperty('ofm-bld', 'visibility', inBld ? 'none' : 'visible'); }
  // mood: sky, hazard footprints, tape
  const mood = rainK.toFixed(2);
  if (mood !== lastMood) {
    lastMood = mood; const mix = (a, b) => '#' + a.match(/\w\w/g).map((x, i) => Math.round(lerp(parseInt(x, 16), parseInt(b.match(/\w\w/g)[i], 16), rainK)).toString(16).padStart(2, '0')).join('');
    map.setSky({ 'sky-color': mix('9fd9ff', 'aac2d9'), 'horizon-color': mix('fff1d6', 'e4e9ef'), 'fog-color': mix('fbecd0', 'e8e8e6'), 'fog-ground-blend': .8, 'horizon-fog-blend': .7, 'sky-horizon-blend': .65, 'atmosphere-blend': 0 });
    paint('hz-fill', 'fill-opacity', .3 * rainK); paint('hz-line', 'line-opacity', .6 * rainK);
    paint('tape', 'line-opacity', rainK); paint('tape-case', 'line-opacity', .9 * rainK);
    paint('pts', 'circle-opacity', .95 * rainK); paint('pts', 'circle-stroke-opacity', .9 * rainK);
  }
  // routes
  const onFast = s <= P.sPd + 1;
  const pfast = onFast ? clamp(P.fast.project(P.F.xy(P.drive.at(s)), Math.max(0, s - 400)).s / P.fast.length, 0, 1) : 1;
  const preK = 1 - rerouteK, c0 = 'rgba(0,0,0,0)';
  const grad = (rgb, p, a) => (a <= .01 || p >= .999) ? c0 : ['step', ['line-progress'], c0, Math.max(+p.toFixed(4), 1e-4), `rgba(${rgb},${a.toFixed(2)})`];
  if (!PERF.has('nograd')) paint('r-fast', 'line-gradient', grad('91,77,255', pfast, preK));
  paint('r-fast-case', 'line-gradient', grad('255,255,255', pfast, preK));
  paint('r-hit', 'line-opacity', rainy ? .95 * sstep(TL.rainOn + .9, TL.rainOn + 1.5, t) * (P.rerouted ? 1 - .3 * rerouteK : 1) : 0);
  const outroK = P.rerouted ? sstep(TL.outro[0], TL.outro[0] + .8, t) : 0, ghostK = rerouteK * (1 - .55 * sstep(TL.rrBack, TL.rrBack + 1, t) + .55 * outroK);
  paint('r-ghost', 'line-opacity', ghostK);
  paint('r-ghost-case', 'line-opacity', ghostK * .9);
  paint('r-trail', 'line-opacity', outroK); paint('r-trail-case', 'line-opacity', outroK);
  if (P.rerouted) {
    const rev = +sstep(TL.drawSafe[0], TL.drawSafe[1], t).toFixed(4), ps = +clamp((s - P.sPd) / P.safe.length, 0, 1).toFixed(4);
    const g2 = color => { if (rev <= .001 || ps >= .999) return c0; if (rev >= .999) return ['step', ['line-progress'], c0, Math.max(ps, 1e-4), color]; return ps <= 1e-4 ? ['step', ['line-progress'], color, Math.max(rev, 1e-4), c0] : ['step', ['line-progress'], c0, ps, color, Math.max(rev, ps + 1e-4), c0]; };
    paint('r-safe', 'line-gradient', g2('#16b873')); paint('r-safe-case', 'line-gradient', g2('#ffffff'));
  }
  // 3D toy layer
  const speed = Math.abs(carS(t + .05) - carS(t - .05)) / .1, sp = clamp(speed / 160, 0, 1);
  const beacon = P.rerouted ? sstep(TL.rrCalc[0], TL.rrCalc[0] + .3, t) * (1 - sstep(TL.d2[0], TL.d2[0] + .5, t)) : 0;
  toy.update({
    t, car: P.drive.at(s), heading: P.drive.heading(s, 6, 14, 4), carPx: carPx(),
    bounce: Math.abs(Math.sin(t * 10)) * .26 * (.25 + .75 * sp), pitchWobble: Math.sin(t * 7.3) * .035 * sp, roll: Math.sin(t * 4.1) * .045 * sp,
    wheelTurn: s / 2.2, beacon: beacon * (.7 + .7 * Math.sin(t * 16)),
    poolGrow: h => rainK > 0 ? clamp(pop(TL.rainOn + .25 + (P._poolDelay.get(h.id) ?? .6), t, 1.1), 0, 1.15) : 0,
    poolBob: h => Math.sin(t * 2.2 + (h.cxy[0] * .01) % 6) * .3,
    signPop: sg => rainy ? pop(TL.rainOn + 1.0 + sg.i * .12, t, .7) : 0,
    barrierPop: b => P.rerouted ? pop(TL.drawSafe[0] + .25 + b.i * .12, t, .7) : 0,
    dest: P.R.to, flagPop: pop(.3, t, .7), origin: P.R.from, pinPop: 0,
  });
  // map tags
  tagO('dest', clamp(pop(.4, t, .7), 0, 1));
  tagO('origin', clamp(pop(.25, t, .7), 0, 1) * (1 - sstep(4.4, 5.2, t)));
  P.clusters.forEach((c, i) => {
    const tg = tags.get('cl' + i); if (!tg) return;
    const after = rr && t > TL.drawSafe[0] + .25; tg.el.classList.toggle('bad', !after); tg.el.classList.toggle('ok', after);
    const sm = tg.el.querySelector('small'); const label = after ? 'evitado' : 'en la ruta rápida'; if (sm && sm.textContent !== label) sm.textContent = label;
    const keep = P.rerouted ? Math.max(1 - sstep(TL.d2[0] + 1.5, TL.d2[0] + 2.2, t), sstep(TL.outro[0] + .6, TL.outro[0] + 1.2, t)) : 1;
    tagO('cl' + i, rainy ? clamp(pop(TL.rainOn + 1.1 + i * .15, t, .7), 0, 1) * keep : 0);
  });
  // scenario + intro
  showScenario(t < TL.rainOn ? 0 : activeScenario);
  const introO = sstep(.15, .6, t) * (1 - sstep(2.5, 3.0, t)), intro = $('#intro');
  intro.style.opacity = introO; intro.style.transform = `translate(-50%, ${(1 - introO) * -10}px)`;
  // maneuver
  const preRR = P.rerouted && t < TL.drawSafe[0];
  const nx = preRR ? (P.stepsFast.find(st => st.s > s + 8) || P.stepsFast.at(-1)) : (P.steps.find(st => st.s > s + 8) || P.steps.at(-1));
  const man = $('#maneuver'); man.classList.toggle('safe', rr || (!P.rerouted && rainK > .5 && !P.fastHitsAll.length)); man.classList.toggle('arrived', arrived);
  if (arrived) { setHTML('#m-icon', mIcon('arrive')); setText('#m-dist', 'Llegaste'); setText('#m-text', destName()); }
  else if (P.rerouted && t >= TL.rrCalc[0] && t < TL.drawSafe[0]) { setHTML('#m-icon', mIcon('recalc')); setText('#m-dist', 'Recalculando'); setText('#m-text', 'Buscando una ruta sin agua…'); }
  else { setHTML('#m-icon', mIcon(nx.icon)); setText('#m-dist', fmtDist(Math.max(0, nx.s - s))); setText('#m-text', nx.text); }
  // alerts
  const alerts = [];
  if (rainy) {
    const o = sstep(TL.rainOn + .1, TL.rainOn + .5, t) * (1 - sstep(TL.rainOn + 2.6, TL.rainOn + 3.0, t));
    alerts.push({ id: 'rain', cls: 'rain', icon: 'rain', title: 'Empieza a llover', sub: sc.alert, chips: [['src', sc.src]], o });
  }
  if (P.rerouted) {
    const named = P.avoided.filter(g => g.lp >= 2), first = named[0] || P.avoided[0], second = named.find(g => g !== first && g.cat !== first.cat) || named.find(g => g !== first) || P.avoided.find(g => g !== first);
    const sNow = P.fast.project(P.F.xy(P.drive.at(Math.min(s, P.sPd))), 0).s;
    [first, second].filter(Boolean).forEach((g, i) => {
      const t0 = TL.d1[0] + 1.1 + i * 1.6, o = sstep(t0, t0 + .35, t) * (1 - sstep(TL.drawSafe[0] + .2, TL.drawSafe[0] + .6, t));
      alerts.push({ id: 'hit' + i, cls: CAT_ICON[g.cat] || g.cat, icon: CAT_ICON[g.cat] || g.cat, title: CAT_TITLE[g.cat] || 'Zona inundable', sub: [short(g.label, 46), g.depthText].filter(Boolean).join(' · '), chips: [['bad', `en tu ruta · a ${fmtDist(Math.max(0, g.s - sNow))}`], ['src', g.src || '']], o, s: 1 + .06 * Math.max(0, 1 - Math.abs(t - t0 - .3) * 4) });
    });
  }
  P.near.slice(0, 2).forEach((g, i) => {
    const t0 = Math.max(P.rerouted ? TL.rrBack + .2 : TL.d1[0] + 1, timeAtS(g.sd) - 2.2) + i * .3, o = sstep(t0, t0 + .35, t) * (1 - sstep(t0 + 3.0, t0 + 3.4, t));
    alerts.push({ id: 'near' + i, cls: 'ok', icon: 'ok', title: `${CAT_TITLE[g.cat] || 'Zona inundable'} a ${fmtDist(g.d)}`, sub: [short(g.label, 46), g.depthText].filter(Boolean).join(' · '), chips: [['ok', 'fuera de tu ruta ✓'], ['src', g.src || '']], o });
  });
  P.safeHits.slice(0, 1).forEach((g, i) => {
    const t0 = timeAtS(g.sd) - 2.4, o = sstep(t0, t0 + .35, t) * (1 - sstep(t0 + 3.0, t0 + 3.4, t));
    alerts.push({ id: 'unav' + i, cls: CAT_ICON[g.cat] || g.cat, icon: CAT_ICON[g.cat] || g.cat, title: `Sin alternativa: ${(CAT_TITLE[g.cat] || 'zona inundable').toLowerCase()}`, sub: [short(g.label, 46), g.depthText].filter(Boolean).join(' · '), chips: [['bad', 'precaución · cerca del destino'], ['src', g.src || '']], o });
  });
  renderAlerts(alerts);
  // reroute card
  const rrEl = $('#reroute');
  if (P.rerouted) {
    rrEl.style.opacity = sstep(TL.rrCalc[0], TL.rrCalc[0] + .3, t) * (1 - sstep(TL.d2[0] + .8, TL.d2[0] + 1.2, t));
    const done = t >= TL.drawSafe[0]; rrEl.classList.toggle('done', done);
    rrEl.querySelector('.rr-spin').style.transform = done ? '' : `rotate(${t * 540}deg)`;
    const extra = Math.round((P.safeTotalDur - P.fastDur) / 60), n = P.avoided.length, nf = P.fastHitsAll.length;
    setText('#rr-title', done ? 'Ruta segura encontrada' : 'Recalculando ruta segura…');
    setText('#rr-sub', done ? `Evita ${n} ${n === 1 ? 'punto con agua' : 'puntos con agua'} · ${extra >= 1 ? `+${extra} min` : 'mismo tiempo'}` : `La ruta más rápida cruza ${nf} ${nf === 1 ? 'punto con agua' : 'puntos con agua'}`);
  } else rrEl.style.opacity = 0;
  // compare card
  const hitsTxt = n => n === 0 ? 'sin puntos con agua' : `cruza ${n} ${n === 1 ? 'punto' : 'puntos'} con agua`;
  const showSafe = rr || (!P.rerouted && rainK > .5);
  setText('#cmp-fast', `${Math.round(P.fastDur / 60)} min · ${(P.fastDist / 1000).toFixed(1)} km · ${rainK > .5 ? hitsTxt(P.fastHitsAll.length) : 'sin lluvia'}`);
  setText('#cmp-safe', showSafe ? `${Math.round(P.safeTotalDur / 60)} min · ${(P.safeTotalDist / 1000).toFixed(1)} km · ${hitsTxt(P.safeHits.length)}` : (rainK > .5 ? 'calculando…' : 'sin lluvia: igual a la rápida'));
  $('.cmp-row.safe').classList.toggle('dim', !showSafe); $('.cmp-row.fast').classList.toggle('dim', rr);
  setText('#cmp-engine', P.R.method === 'router' ? `Ruteo: ${P.R.engine} · evita registros IMEPLAN, pasos a desnivel y agua (OSM)` : 'Ruteo provisional: OSRM (demo pública) + desvío de cauce.');
  // eta
  const onSafe = s > P.sPd + 1 || rr;
  const remD = onSafe ? P.drive.length - s : P.fast.length * (1 - pfast);
  const durTot = onSafe ? P.safeTotalDur : P.fastDur, distTot = onSafe ? P.safeTotalDist : P.fastDist;
  const remMin = Math.max(0, durTot / 60 * remD / Math.max(1, distTot)), elapsedMin = (s / P.drive.length) * (P.safeTotalDur / 60);
  setText('#eta-min', arrived ? '0' : String(Math.max(1, Math.round(remMin))));
  setText('#eta-km', `${(Math.max(0, remD) / 1000).toFixed(1)} km`);
  setText('#eta-clock', `llegada ${clock(elapsedMin + remMin)}`);
  setText('#eta-dest', `${ORIGIN.name} → ${destName()}`);
  // arrival card
  const arO = sstep(TL.arrive[1] - .1, TL.arrive[1] + .5, t), ar = $('#arrive');
  ar.style.opacity = arO; ar.style.transform = viewport().phone ? `translateY(${(1 - arO) * 14}px)` : `translate(${(1 - arO) * -26}px, -50%)`;
  document.body.classList.toggle('arrived', arO > .05);
  if (!PERF.has('norain')) drawRain(t, rainK * (1 - .4 * sstep(TL.arrive[1], TL.dur, t)));
  map.triggerRepaint();
}

// rain overlay (deterministic in t)
const rainCv = $('#rain'), rctx = rainCv.getContext('2d');
function drawRain(t, k) {
  const dpr = Math.min(2, devicePixelRatio || 1), W = rainCv.clientWidth, H = rainCv.clientHeight;
  if (rainCv.width !== Math.round(W * dpr) || rainCv.height !== Math.round(H * dpr)) { rainCv.width = Math.round(W * dpr); rainCv.height = Math.round(H * dpr); }
  rctx.setTransform(dpr, 0, 0, dpr, 0, 0); rctx.clearRect(0, 0, W, H);
  if (k <= .01) return;
  rctx.fillStyle = `rgba(70,95,140,${.06 * k})`; rctx.fillRect(0, 0, W, H);
  const n = Math.round(W * H / 9000 * k); rctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const sp = 950 + hash(i + 3) * 650, len = 14 + hash(i + 5) * 14, x0 = hash(i) * (W + 200) - 100;
    const y = ((hash(i + 9) * (H + 80)) + t * sp) % (H + 80) - 40; const x = x0 - y * .16;
    rctx.strokeStyle = `rgba(43,36,64,${.22 * k})`; rctx.lineWidth = 4; rctx.beginPath(); rctx.moveTo(x, y); rctx.lineTo(x - len * .16, y + len); rctx.stroke();
    rctx.strokeStyle = `rgba(236,248,255,${.9 * k})`; rctx.lineWidth = 2.2; rctx.beginPath(); rctx.moveTo(x, y); rctx.lineTo(x - len * .16, y + len); rctx.stroke();
  }
  const m = Math.round(W * H / 30000 * k);
  for (let j = 0; j < m; j++) {
    const per = .55 + hash(j + 40) * .3, ph = t / per + hash(j + 41), cyc = Math.floor(ph), f = ph - cyc;
    const x = hash(j * 13 + cyc * 7.1) * W, y = H * (.45 + .55 * hash(j * 17 + cyc * 3.3)), r = 3 + f * 11;
    rctx.strokeStyle = `rgba(236,248,255,${(1 - f) * .75 * k})`; rctx.lineWidth = 2; rctx.beginPath(); rctx.ellipse(x, y, r, r * .38, 0, 0, 7); rctx.stroke();
  }
}

// ---------------------------------------------------------------------------------------------------------
// boot
let demVersion = 0, drapedVersion = -1;
let map, toy, playing = false, playStart = 0, demoSeeking = false, dest = DEFAULT_DEST;
const status = m => setText('#status', m);
async function boot() {
  const [layers, dem, bldMeta] = await Promise.all([loadHazardIndex(), demSource(), getJSON(`${BASE}buildings-meta.json`).catch(() => null)]);
  layersAll = layers;
  for (const l of layers) if (l.gj && ['observed', 'modeled'].includes(l.kind)) hazardsAll.push(...hazardsFromGeoJSON(l.gj, l, GF));
  indexImeplan(hazardsAll);
  // scenarios: dry; rain = the router's default layers (observed/hotspot/water, router.default !== false); one per modeled layer
  for (const l of layers) layerMeta.set(l.id, l);
  const base = layers.filter(l => !['modeled', 'terrain-index'].includes(l.kind) && !l.unsupported && l.type === 'geojson' && (l.router || {}).default !== false);
  const mod = layers.filter(l => l.kind === 'modeled' && !l.unsupported);
  const kinds = new Set(base.map(l => l.kind));
  scenarios = [{ id: 'seco', label: 'Sin lluvia', sub: 'ruta normal', cls: 'dry', layers: [], src: '' }];
  if (base.length) scenarios.push({ id: 'lluvia', label: 'Lluvia', sub: [kinds.has('observed') && 'registros', kinds.has('hotspot') && 'pasos a desnivel'].filter(Boolean).join(' + '), cls: 'rain', layers: base.map(l => l.id), src: 'IMEPLAN · PC · OSM', alert: `Se activan ${base.length} capas: sitios registrados (IMEPLAN, Bomberos, PC) y pasos a desnivel` });
  for (const l of mod) scenarios.push({ id: l.id, label: 'Modelo', sub: short(l.label || l.id, 24), cls: 'rain modeled', layers: [...(l.type === 'geojson' ? [l.id] : []), ...base.map(b => b.id)], src: 'modelo exploratorio', alert: `Modelo (exploratorio, no pronóstico): ${short(l.label || l.id, 60)}`, raster: l.type === 'raster-tiles' ? l : null });
  activeScenario = scenarios.length > 1 ? 1 : 0;
  buildScenarioUI();
  $('#attrib-short').innerHTML = `© <a href="https://www.openstreetmap.org/copyright">OSM</a> · OpenFreeMap · Overture · INEGI · ${dem.inegi ? '' : 'AWS Terrain · '}IMEPLAN MUI 2026 · relieve ×${EXAG}, edificios ×${BLD_EXAG} (visual)`;
  $('#attrib-text').innerHTML = ['© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', '<a href="https://openfreemap.org">OpenFreeMap</a> / OpenMapTiles', 'Edificios: <a href="https://overturemaps.org">Overture Maps</a> (Google Open Buildings, Microsoft, OSM) · altura MDS−MDT INEGI 5 m', dem.label, 'Inundaciones: <a href="https://mui.imeplan.mx/">IMEPLAN MUI 2026</a> (registro histórico)', 'Ruteo: cauce. (OSM)', `relieve ×${EXAG} y edificios ×${BLD_EXAG} (visual)`].join(' · ');
  map = new maplibregl.Map({ container: 'map', style: toyStyle(dem.src, bldMeta), center: ORIGIN.ll, zoom: 14, pitch: 55, bearing: 30, maxPitch: 75, attributionControl: false, interactive: !DEMO, fadeDuration: 0, canvasContextAttributes: { antialias: true, preserveDrawingBuffer: DEMO } });
  window.cauceMap = map;
  await new Promise(r => map.once('load', r));
  addRouteLayers(map);
  toy = new Toy(map, ORIGIN.ll); if (!PERF.has('no3d')) map.addLayer(toy.layer);
  if (PERF.has('nobld')) for (const id of ['bld', 'bld-shadow']) map.setLayoutProperty(id, 'visibility', 'none');
  let drapeTimer = 0; map.on('sourcedata', e => { if (e.sourceId === 'dem' && e.tile) demVersion++; if (e.sourceId === 'dem' && e.isSourceLoaded) { clearTimeout(drapeTimer); drapeTimer = setTimeout(() => { toy.terrainDirty = true; map.triggerRepaint(); }, 250); } });
  const sel = $('#dest'); for (const [k, p] of Object.entries(PLACES)) { const o = document.createElement('option'); o.value = k; o.textContent = p.name; sel.append(o); }
  sel.value = dest; sel.addEventListener('change', () => loadDestination(sel.value));
  $('#play').addEventListener('click', () => { if (playing) stop(); else play(); });
  $('#restart').addEventListener('click', () => { stop(); applyState(idleT()); });
  await loadDestination(dest);
  if (DEMO) {
    window.__cauceDemo = { duration_s: TL.dur, ready: true, seek: async t => { demoSeeking = true; playing = false; await renderSettled(t); return true; } };
    await waitTiles(12000);
    if (!demoSeeking) play();
  }
}
const idleT = () => plan && plan.rerouted ? 12.45 : 3.0;
async function loadDestination(key) {
  dest = key; stop(); status('Calculando rutas…');
  const sc = scenarios[activeScenario], to = PLACES[key].ll;
  let R = null;
  if (PLACES[key].cache && sc.id === 'lluvia' && !Q.has('live')) { try { R = await getJSON(BASE + PLACES[key].cache); } catch (e) { R = null; } }
  activeIds = R && R.hazardIds ? R.hazardIds.filter(id => layerMeta.has(id)) : sc.layers;
  hazardsActive = hazardsAll.filter(h => activeIds.includes(h.layerId));
  if (!R) {
    try { const rt = await getRouter(); R = await planRoutes(rt, ORIGIN.ll, to, { hazardIds: sc.layers, hazards: hazardsActive, log: status }); }
    catch (e) { console.error(e); status('No se pudo calcular la ruta: ' + e.message); return; }
  }
  setPlan(R);
  status(R.method === 'router' ? `Ruteo: ${R.engine}` : R.method === 'provisional' ? 'Desvío provisional (OSRM).' : '');
  applyState(DEMO ? 0 : idleT());
}
function setPlan(R) {
  plan = buildPlan(R); const P = plan, F = P.F;
  prof1 = P.rerouted ? makeProfile(P, 0, P.sPd, TL.d1[0], TL.d1[1]) : makeProfile(P, 0, P.drive.length, TL.d1[0], TL.d2[1]);
  prof2 = P.rerouted ? makeProfile(P, P.sPd, P.drive.length, TL.d2[0], TL.d2[1]) : null;
  cams = computeCams();
  const fc = feats => ({ type: 'FeatureCollection', features: feats }), line = c => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } });
  map.getSource('r-fast').setData(fc([line(P.R.fastest.coordinates)]));
  map.getSource('r-safe').setData(fc(P.rerouted ? [line(P.R.safe.coordinates)] : []));
  map.getSource('r-ghost').setData(fc(P.rerouted ? [line(P.fast.slice(P.sP, P.fast.length))] : []));
  map.getSource('r-hit').setData(fc(P.hitSegs.map(line)));
  map.getSource('r-trail').setData(fc(P.rerouted ? [line(P.drive.ll)] : []));
  map.getSource('hz').setData(fc(hazardsActive.map(h => ({ type: 'Feature', properties: { kind: h.kind, cat: h.cat }, geometry: { type: 'Polygon', coordinates: [h.ring] } }))));
  const tapes = [], pts = [];
  for (const l of layersAll) if (activeIds.includes(l.id) && l.gj) for (const f of l.gj.features) {
    const ty = f.geometry?.type || '';
    if (l.kind === 'hotspot' && /LineString/.test(ty)) tapes.push({ type: 'Feature', properties: {}, geometry: f.geometry });
    else if (ty === 'Point' && ['observed', 'hotspot', 'modeled'].includes(l.kind) && !(l.id === 'observed-imeplan-2026')) pts.push({ type: 'Feature', properties: { kind: l.kind }, geometry: f.geometry });
  }
  map.getSource('tape').setData(fc(tapes)); map.getSource('pts').setData(fc(pts));
  buildLegend();
  // 3D objects near the route
  const bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of [...P.fast.p, ...(P.safe ? P.safe.p : [])]) { bb[0] = Math.min(bb[0], p[0]); bb[2] = Math.max(bb[2], p[0]); bb[1] = Math.min(bb[1], p[1]); bb[3] = Math.max(bb[3], p[1]); }
  const m = 3000, mid = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
  const poolsH = hazardsActive.filter(h => h.cxy[0] > bb[0] - m && h.cxy[0] < bb[2] + m && h.cxy[1] > bb[1] - m && h.cxy[1] < bb[3] + m)
    .sort((a, b) => Math.hypot(a.cxy[0] - mid[0], a.cxy[1] - mid[1]) - Math.hypot(b.cxy[0] - mid[0], b.cxy[1] - mid[1])).slice(0, 400);
  const o = F.xy(P.R.from); P._poolDelay = new Map(poolsH.map(h => [h.id, clamp(Math.hypot(h.cxy[0] - o[0], h.cxy[1] - o[1]) / 12000, 0, .9)]));
  toy.setPools(poolsH);
  toy.setSigns((P.rerouted ? P.avoided : P.fastHitsAll).filter(g => g.cat !== 'water').slice(0, 10).map((g, i) => ({ lon: g.loc[0], lat: g.loc[1], kind: g.cat === 'hotspot' ? 'underpass' : g.cat === 'area' || g.cat === 'report' ? 'site' : g.cat, i })));
  toy.setBarriers(P.rerouted ? P.clusters.map((c, i) => { const s = Math.max(P.sP + 5, c.s - 25); const at = P.fast.at(s); return { lon: at[0], lat: at[1], heading: P.fast.heading(s, 20, 20), i }; }) : []);
  clearTags();
  tag('dest', P.R.to, `${esc(destName())}<small>destino</small>`, 'dest', -carPx() * 1.0);
  tag('origin', P.R.from, `${esc(ORIGIN.name)}<small>origen</small>`, 'origin', -carPx() * .75);
  P.clusters.forEach((c, i) => tag('cl' + i, c.items[0].loc, `${esc(short(c.items[0].label, 34))}${c.items.length > 1 ? ` <b>+${c.items.length - 1}</b>` : ''}<small>en la ruta rápida</small>`, 'bad', -carPx() * .8));
  setText('#ar-title', `Llegaste a ${destName()}`);
  setText('#ar-sub', P.rerouted ? `Tu ruta cruzó ${P.safeHits.length === 0 ? 'cero' : P.safeHits.length} ${P.safeHits.length === 1 ? 'punto con agua' : 'puntos con agua'}. La más rápida cruzaba ${P.fastHitsAll.length}, entre ellos:` : (P.fastHitsAll.length ? `Sin alternativa: tu ruta cruza ${P.fastHitsAll.length} puntos con agua.` : 'Tu ruta no cruza puntos con agua registrados.'));
  const top = [...P.avoided].sort((a, b) => (b.lp - a.lp) || ((CAT_RANK[b.cat] || 0) - (CAT_RANK[a.cat] || 0))).slice(0, 4);
  setHTML('#ar-list', top.map((g, i) => `<li><i>${i + 1}</i><span><b>${esc(short(g.label, 52))}</b><br><small>${esc(CAT_TITLE[g.cat] || '')}${g.depthText ? ' · ' + esc(g.depthText) : ''}</small></span></li>`).join(''));
  $('.ar-flag').innerHTML = AICON.flag;
  setText('#intro-title', `${ORIGIN.name} → ${destName()}`);
  setText('#intro-sub', P.rerouted ? 'Empieza a llover. ¿Llegas sin meterte al agua?' : 'Cuando llueve, la ruta evita los puntos con agua registrados.');
}
function setScenario(i) {
  activeScenario = i; if (scenarios[i].raster) addRaster(scenarios[i].raster);
  for (const sc of scenarios) if (sc.raster && map.getLayer('rs-' + sc.raster.id)) map.setLayoutProperty('rs-' + sc.raster.id, 'visibility', sc === scenarios[i] ? 'visible' : 'none');
  loadDestination(dest);
}
function addRaster(l) {
  const id = 'rs-' + l.id; if (map.getSource(id)) return;
  map.addSource(id, { type: 'raster', tiles: l.tiles || [l.url], tileSize: l.tileSize || 256, ...(l.bounds ? { bounds: l.bounds } : {}) });
  map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': .7 } }, 'hz-fill');
}
function play() {
  playing = true; playStart = performance.now(); $('#play').textContent = '■ Detener'; map.stop();
  const loop = now => {
    if (!playing) return;
    let t = (now - playStart) / 1000;
    if (t > TL.dur + 2.5) { if (DEMO) { playStart = now; t = 0; } else { stop(); return; } }
    applyState(Math.min(t, TL.dur)); requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
function stop() { playing = false; const b = $('#play'); if (b) b.textContent = '▶ Conducir'; }
async function waitTiles(ms) { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (map.loaded() && map.areTilesLoaded()) return true; await new Promise(r => setTimeout(r, 80)); } return false; }
async function renderSettled(t) {
  applyState(t); await new Promise(r => map.once('render', r));
  await waitTiles(15000);
  if (drapedVersion !== demVersion) { drapedVersion = demVersion; toy.terrainDirty = true; } applyState(t);
  await new Promise(r => map.once('render', r)); await new Promise(r => requestAnimationFrame(() => r()));
}
window.addEventListener('resize', () => { if (plan) { cams = computeCams(); if (!playing) applyState(idleT()); } });
boot().catch(e => { console.error(e); status('Error: ' + e.message); });
