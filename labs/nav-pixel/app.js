// cauce. · nav-pixel — retro 16-bit overworld navigation prototype.
// Real data: OpenFreeMap/OSM vector tiles, AWS Terrarium DEM (hillshade), IMEPLAN MUI 2026 hazard polygons
// (via /labs/shared/hazard/index.json), routes from /labs/shared/router/router.js (OSRM stub today).
import { PAL, pix, mirror, toCanvas, toURL, waterFrames, floodFrames, modeledFrames, treeTile, grassTile, fieldTile, plazaTile, axoPortrait, signIcon, crossIcon, flagIcon, planeIcon, arrowIcon, sunIcon, cloudIcon, dropIcon, scrollIcon } from './sprites.js';
import { pixelLayer } from './pixel.js';
import { voxelCarLayer } from './voxcar.js';
import { buildHazards, routeHits, densify, hav, detour, osrmVia, hitWeight } from './avoid.js';

const $ = s => document.querySelector(s);
const Q = new URLSearchParams(location.search);
const DEMO = Q.get('demo') === '1';
const CAPTURE = Q.get('capture') === '1';
const PHONE = innerWidth < 720;
const PX = Q.get('px') ? Math.max(1, +Q.get('px')) : (PHONE ? 2 : innerWidth > 2400 ? 4 : 3);
const DUR = 26;
const DEFAULT = { A: [-103.3925, 20.6743], B: [-103.3050, 20.5262], nameA: 'Glorieta Minerva', nameB: 'Aeropuerto GDL' };
const SHARED = '/labs/shared';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const fmtKm = m => (m / 1000).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
const fmtMin = s => Math.max(1, Math.round(s / 60)) + ' min';
if (DEMO) document.body.classList.add('demo');
if (CAPTURE) document.body.classList.add('capture');

// ---------- pixel frames for the HUD (9-slice border-image) ----------
function frame(outer, line, fill) {
  return toURL(pix([
    '..kkkkkkkk..', '.kwwwwwwwwk.', 'kwwffffffwwk', 'kwffffffffwk', 'kwffffffffwk', 'kwffffffffwk',
    'kwffffffffwk', 'kwffffffffwk', 'kwffffffffwk', 'kwwffffffwwk', '.kwwwwwwwwk.', '..kkkkkkkk..'], { k: outer, w: line, f: fill }));
}
const root = document.documentElement.style;
root.setProperty('--frame-navy', `url(${frame(PAL.ink, PAL.white, PAL.night)})`);
root.setProperty('--frame-red', `url(${frame(PAL.ink, PAL.hot, PAL.night)})`);
root.setProperty('--frame-gold', `url(${frame(PAL.ink, PAL.yellow, PAL.night)})`);
root.setProperty('--frame-parch', `url(${frame(PAL.wine, PAL.brown, PAL.sand)})`);
const paint = (id, img) => { const c = $(id); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0); };
paint('#scroll-icon', scrollIcon());
paint('#portrait', axoPortrait());

// ---------- loading ----------
const loading = { set(k, msg) { $('#loading-bar').style.width = Math.round(clamp(k, 0.05, 1) * 100) + '%'; if (msg) $('#loading-text').textContent = msg; }, done() { $('#loading').classList.add('hidden'); } };
const fail = msg => { $('#loading').classList.remove('hidden'); $('#loading-text').textContent = msg; $('#loading-bar').style.background = PAL.red; };
if (!window.maplibregl) { fail('NO SE PUDO CARGAR EL MAPA'); throw new Error('maplibre missing'); }

// ---------- state ----------
const state = {
  t: 0, A: DEFAULT.A, B: DEFAULT.B, nameA: DEFAULT.nameA, nameB: DEFAULT.nameB,
  layers: [], sets: [], hazards: [], active: new Set(), router: null, routerStatus: null, baked: null,
  trip: null, tl: null, playing: false, playStart: 0, mode: 'overview', car: { visible: false, lngLat: DEFAULT.A, heading: 0, unitMeters: 4 },
  rainK: 0, flash: 0, markers: [], pick: null
};

// ---------- map ----------
async function terrainDEM() {
  try {
    const r = await fetch(SHARED + '/terrain/index.json', { cache: 'no-cache' }); if (!r.ok) throw 0;
    const j = await r.json(); const t = j.web || j.dem || j;
    const url = (Array.isArray(t.tiles) && t.tiles[0]) || t.url || t.tileUrl;
    if (url && /\{z\}/.test(url)) { $('#dem-credit').textContent = 'INEGI (vía /labs/shared/terrain)'; return { type: 'raster-dem', tiles: [url], encoding: t.encoding || 'terrarium', tileSize: t.tileSize || 256, maxzoom: t.maxzoom || 15 }; }
  } catch { /* terrain agent not published yet: use AWS Terrarium */ }
  return { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 14 };
}
const W = (...stops) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops];
const SKY_DRY = { 'sky-color': PAL.blue, 'horizon-color': PAL.mist, 'fog-color': PAL.mist, 'fog-ground-blend': 0.55, 'horizon-fog-blend': 0.75, 'sky-horizon-blend': 0.75, 'atmosphere-blend': 0 };
function style(dem) {
  const major = ['motorway', 'trunk', 'primary'], mid = ['secondary', 'tertiary'], minor = ['minor', 'service', 'unclassified', 'residential', 'living_street'];
  return {
    version: 8,
    sources: { ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }, dem },
    sky: SKY_DRY,
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': PAL.leaf } },
      { id: 'landuse', type: 'fill', source: 'ofm', 'source-layer': 'landuse', paint: { 'fill-color': ['match', ['get', 'class'], ['industrial', 'garages', 'railway'], PAL.tan, ['commercial', 'retail'], PAL.peach, ['school', 'university', 'college', 'kindergarten', 'hospital'], PAL.apricot, ['cemetery'], PAL.grass, ['stadium', 'pitch', 'playground'], PAL.leaf, PAL.leaf], 'fill-opacity': ['match', ['get', 'class'], ['residential', 'suburb', 'quarter', 'neighbourhood'], 0, 1] } },
      { id: 'landcover', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: ['match', ['get', 'class'], ['wood', 'forest', 'grass', 'farmland', 'wetland'], true, false], paint: { 'fill-pattern': ['match', ['get', 'class'], ['wood', 'forest'], 'tree', 'farmland', 'field', 'wetland', 'water', 'grass'] } },
      { id: 'park', type: 'fill', source: 'ofm', 'source-layer': 'park', paint: { 'fill-pattern': 'tree' } },
      { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': 'rgba(25,60,62,0.75)', 'hillshade-highlight-color': 'rgba(254,231,97,0.35)', 'hillshade-accent-color': 'rgba(38,92,66,0.4)', 'hillshade-illumination-direction': 315 } },
      { id: 'aeroway-area', type: 'fill', source: 'ofm', 'source-layer': 'aeroway', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': PAL.fog } },
      { id: 'aeroway-line', type: 'line', source: 'ofm', 'source-layer': 'aeroway', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': ['match', ['get', 'class'], 'runway', PAL.slate, PAL.steel], 'line-width': W(11, ['match', ['get', 'class'], 'runway', 3, 1], 14, ['match', ['get', 'class'], 'runway', 18, 6], 17, ['match', ['get', 'class'], 'runway', 120, 40]) } },
      { id: 'aeroway-mark', type: 'line', source: 'ofm', 'source-layer': 'aeroway', minzoom: 12.5, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], paint: { 'line-color': PAL.white, 'line-width': W(12, 1, 17, 4), 'line-dasharray': [4, 4] } },
      { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', paint: { 'fill-pattern': 'water' } },
      { id: 'waterway', type: 'line', source: 'ofm', 'source-layer': 'waterway', paint: { 'line-color': PAL.blue, 'line-width': W(10, ['match', ['get', 'class'], 'river', 2, 0.5], 14, ['match', ['get', 'class'], 'river', 7, 3], 17, ['match', ['get', 'class'], 'river', 22, 10]) } },
      { id: 'rail', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 12, filter: ['match', ['get', 'class'], ['rail', 'transit'], true, false], paint: { 'line-color': PAL.steel, 'line-width': W(12, 1, 17, 5), 'line-dasharray': [2, 2] } },
      { id: 'road-minor-case', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 12.5, filter: ['match', ['get', 'class'], minor, true, false], layout: { 'line-join': 'miter', 'line-cap': 'butt' }, paint: { 'line-color': PAL.tan, 'line-width': W(12.5, 1, 14, 4, 15, 9, 17, 26) } },
      { id: 'road-mid-case', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 11, filter: ['match', ['get', 'class'], mid, true, false], layout: { 'line-join': 'miter' }, paint: { 'line-color': PAL.brown, 'line-width': W(11, 2, 13, 5, 15, 12, 17, 32) } },
      { id: 'road-major-case', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: ['match', ['get', 'class'], major, true, false], layout: { 'line-join': 'miter' }, paint: { 'line-color': PAL.night, 'line-width': W(9, 1.5, 11, 4, 13, 8, 15, 18, 17, 44) } },
      { id: 'road-minor', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 12.5, filter: ['match', ['get', 'class'], minor, true, false], layout: { 'line-join': 'miter' }, paint: { 'line-color': PAL.sand, 'line-width': W(12.5, 0.5, 14, 2, 15, 5.5, 17, 18) } },
      { id: 'road-mid', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 11, filter: ['match', ['get', 'class'], mid, true, false], layout: { 'line-join': 'miter' }, paint: { 'line-color': PAL.sand, 'line-width': W(11, 1, 13, 3, 15, 8, 17, 24) } },
      { id: 'road-major', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: ['match', ['get', 'class'], major, true, false], layout: { 'line-join': 'miter' }, paint: { 'line-color': PAL.fog, 'line-width': W(9, 0.5, 11, 2.5, 13, 5.5, 15, 13, 17, 34) } },
      { id: 'road-major-line', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 14, filter: ['match', ['get', 'class'], major, true, false], paint: { 'line-color': PAL.yellow, 'line-width': W(14, 1, 17, 3), 'line-dasharray': [3, 3] } },
      { id: 'building', type: 'fill-extrusion', source: 'ofm', 'source-layer': 'building', minzoom: 14.8, filter: ['!', ['has', 'hide_3d']], paint: { 'fill-extrusion-color': ['step', ['coalesce', ['get', 'render_height'], 4], PAL.rust, 7, PAL.tan, 16, PAL.fog, 36, PAL.mist], 'fill-extrusion-height': ['min', 90, ['coalesce', ['get', 'render_height'], 4]], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': false } }
    ]
  };
}

let map;
const waterF = waterFrames(), floodF = floodFrames(), modelF = modeledFrames();

// ---------- route helpers ----------
function prepRoute(r) {
  const coords = r.coordinates; const pts = densify(coords, 4); const L = pts[pts.length - 1].s;
  const R = { ...r, coords, pts, L };
  const spanish = r.engine && !/stub|osrm/i.test(r.engine);
  R.steps = (r.steps || []).map(st => { const p = parseStep(st); return { ...st, ...p, label: spanish && st.instruction ? st.instruction : p.label }; });
  let from = 0; for (const st of R.steps) { st.s = Number.isFinite(st.along_m) ? st.along_m : projectS(R, st.location || coords[0], from); from = Math.max(0, st.s - 50); }
  return R;
}
function projectS(R, p, sMin = 0) {
  let best = 1e12, bs = 0; const k = Math.cos(p[1] * Math.PI / 180);
  for (const q of R.pts) { if (q.s < sMin) continue; const dx = (q.p[0] - p[0]) * k, dy = q.p[1] - p[1], d = dx * dx + dy * dy; if (d < best) { best = d; bs = q.s; } }
  return bs;
}
function at(R, s) {
  const pts = R.pts; s = clamp(s, 0, R.L);
  let lo = 0, hi = pts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].s <= s) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], k = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
  return [lerp(a.p[0], b.p[0], k), lerp(a.p[1], b.p[1], k)];
}
function brg(a, b) { const k = Math.cos(a[1] * Math.PI / 180); return Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180 / Math.PI; }
const headingAt = (R, s, back, ahead) => brg(at(R, s - back), at(R, s + ahead));
const angLerp = (a, b, k) => { let d = ((b - a + 540) % 360) - 180; return a + d * k; };

const TURN = { left: 'izquierda', right: 'derecha', 'slight left': 'ligeramente a la izquierda', 'slight right': 'ligeramente a la derecha', 'sharp left': 'cerrado a la izquierda', 'sharp right': 'cerrado a la derecha', straight: 'derecho', uturn: 'en U' };
const TYPES = ['new name', 'end of road', 'on ramp', 'off ramp', 'exit rotary', 'exit roundabout', 'roundabout turn', 'depart', 'arrive', 'turn', 'continue', 'merge', 'fork', 'roundabout', 'rotary', 'notification'];
const MODS = ['slight left', 'slight right', 'sharp left', 'sharp right', 'uturn', 'left', 'right', 'straight'];
function parseStep(st) {
  let type = st.type, modifier = st.modifier, name = st.name;
  if (!type && st.instruction) {
    let rest = st.instruction.trim();
    type = TYPES.find(t => rest.toLowerCase().startsWith(t));
    if (type) { rest = rest.slice(type.length).trim(); modifier = MODS.find(m => rest.toLowerCase().startsWith(m)); if (modifier) rest = rest.slice(modifier.length).trim(); name = rest; }
  }
  if (!type) return { label: st.instruction || 'Sigue la ruta', arrow: 'straight', type: 'raw', name: name || '' };
  const nm = name ? ` por ${name}` : '';
  const side = TURN[modifier] || '';
  let label;
  switch (type) {
    case 'depart': label = `Sal${nm}`; break;
    case 'arrive': label = 'Llegas a tu destino'; break;
    case 'turn': case 'end of road': label = modifier === 'straight' ? `Sigue derecho${nm}` : modifier === 'uturn' ? `Da vuelta en U${nm}` : `${type === 'end of road' ? 'Al final, gira' : 'Gira'} ${side.startsWith('ligeramente') || side.startsWith('cerrado') ? side : 'a la ' + side}${name ? ' hacia ' + name : ''}`; break;
    case 'new name': case 'continue': label = `Continúa${nm}`; break;
    case 'merge': label = `Incorpórate${nm}`; break;
    case 'on ramp': label = `Toma la rampa${name ? ' a ' + name : ''}`; break;
    case 'off ramp': label = `Toma la salida${name ? ' a ' + name : ''}`; break;
    case 'fork': label = `En la bifurcación, ${modifier && modifier.includes('left') ? 'mantente a la izquierda' : 'mantente a la derecha'}${nm}`; break;
    case 'roundabout': case 'rotary': case 'roundabout turn': label = `En la glorieta, toma la salida${name ? ' a ' + name : ''}`; break;
    case 'exit rotary': case 'exit roundabout': label = `Sal de la glorieta${nm}`; break;
    default: label = `Sigue${nm}`;
  }
  const arrow = type === 'arrive' ? 'arrive' : /rotary|roundabout/.test(type) ? 'round' : (modifier || 'straight');
  return { label, arrow, type, modifier, name: name || '' };
}

// ---------- hazard text ----------
const KIND_TITLE = { encharcamiento: '¡ENCHARCAMIENTO REPORTADO!', desnivel: '¡PASO A DESNIVEL INUNDABLE!', critica: '¡ZONA CRÍTICA IMEPLAN!', modelado: 'AGUA EN EL MODELO', pasoosm: '¡PASO A DESNIVEL!', hotspot: '¡PUNTO DE INUNDACIÓN!', incidente: '¡INUNDACIÓN ATENDIDA AQUÍ!', terreno: 'TERRENO PROPENSO' };
const KIND_NOUN = { encharcamiento: 'encharcamiento', desnivel: 'paso a desnivel inundable', critica: 'zona crítica IMEPLAN', modelado: 'agua modelada', pasoosm: 'paso a desnivel (OSM)', hotspot: 'punto de inundación reportado', incidente: 'servicio por inundación', terreno: 'zona propensa (modelo)' };
const SIGN = k => k === 'pasoosm' ? 'desnivel' : k === 'terreno' ? 'modelado' : k === 'incidente' || k === 'hotspot' ? 'encharcamiento' : k;
const place = h => (h.props.Referencia || '').replace(/\s+/g, ' ').replace(/,\s*$/, '') || h.site || h.name || 'sitio registrado';
function depth(h) {
  const cm = h.props['Rango de alturas de inundación (cm)']; if (cm) return cm.replace('-', '–') + ' cm';
  const r = h.props['Rango de alturas de inundación']; if (r) return r.replace('-', '–') + ' (unidad no indicada)';
  const m = h.props['Altura máxima reportada']; if (m) return 'altura máx. ' + m + ' (unidad no indicada)';
  if (h.props.depth_m != null) return 'prof. modelada ' + (+h.props.depth_m).toFixed(2) + ' m';
  if (h.kind === 'pasoosm') return 'confianza ' + (h.props.confidence || '?') + ', sin registro';
  if (h.kind === 'incidente') return [h.props.tipo, h.props.anio || (h.props.fecha || '').slice(0, 4)].filter(Boolean).join(', ');
  if (h.kind === 'hotspot') return h.props.riesgo ? 'riesgo ' + h.props.riesgo : '';
  if (h.kind === 'terreno') return h.props.class || '';
  return '';
}
function describeHits(hits, prefix = '') {
  const c = {}; const seen = new Set();
  for (const h of hits) { const key = h.hazard.site + h.hazard.kind; if (seen.has(key)) continue; seen.add(key); c[h.hazard.kind] = (c[h.hazard.kind] || 0) + 1; }
  const pl = (n, a, b) => `${n} ${n > 1 ? b : a}`, parts = [];
  if (c.desnivel) parts.push(pl(c.desnivel, 'paso a desnivel', 'pasos a desnivel'));
  if (c.critica) parts.push(pl(c.critica, 'zona crítica', 'zonas críticas'));
  if (c.encharcamiento) parts.push(pl(c.encharcamiento, 'sitio inundable', 'sitios inundables'));
  if (c.pasoosm) parts.push(pl(c.pasoosm, 'paso a desnivel OSM', 'pasos a desnivel OSM'));
  if (c.modelado) parts.push(pl(c.modelado, 'tramo con agua modelada', 'tramos con agua modelada'));
  if (c.incidente) parts.push(pl(c.incidente, 'servicio por inundación', 'servicios por inundación'));
  if (c.hotspot) parts.push(pl(c.hotspot, 'punto reportado', 'puntos reportados'));
  if (c.terreno) parts.push(pl(c.terreno, 'zona propensa (modelo)', 'zonas propensas (modelo)'));
  return parts.length ? prefix + parts.join(' + ') : 'sin registros en la ruta';
}
const dp = h => { const d = depth(h).replace(' (unidad no indicada)', ''); return d ? ` (${d})` : ''; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const short = (s, n = 30) => s.length > n ? s.slice(0, n - 1) + '…' : s;
const layerOf = h => state.layers.find(l => l.id === h.layerId) || {};
const srcLine = h => { const L = layerOf(h);
  if (L.kind === 'modeled' || L.kind === 'terrain-index') return `${short(L.label || h.layerId, 60)} · modelo exploratorio, no pronóstico`;
  if (h.kind === 'pasoosm') return 'OpenStreetMap · paso a desnivel inferido de etiquetas · no es registro de inundación';
  if (L.kind === 'hotspot') return `${short(L.label || h.layerId, 60)} · reportado/mapeado, no observación oficial`;
  if (h.layerId !== 'observed-imeplan-2026') return `${short(L.label || h.layerId, 60)} · registro histórico, no reporte en vivo`;
  return `IMEPLAN MUI 2026 · ${h.name} · registro histórico, no reporte en vivo`; };

// ---------- trip analysis ----------
function analyze(normalRaw, safeRaw, hazards, meta = {}) {
  const N = prepRoute({ ...normalRaw, engine: normalRaw.engine || meta.engineLabel }), S = prepRoute({ ...safeRaw, engine: safeRaw.engine || meta.engineLabel });
  let hitsN = routeHits(N.coords, hazards), hitsS = routeHits(S.coords, hazards);
  // With the real router, its bridge-aware `crossed` list is authoritative: drop geometric hits it does not confirm
  // (typically the route passes OVER a flooded underpass on a bridge).
  const same = (x, h) => x.properties && (x.properties.name === h.hazard.name && x.properties.name || (x.properties.id != null && x.properties.id === h.hazard.props.id));
  const confirm = (hits, list) => list ? hits.filter(h => list.some(x => same(x, h) || (x.label && x.label === place(h.hazard) && hav(x.location, h.at) < 250))) : hits;
  hitsN = confirm(hitsN, meta.crossedN); hitsS = confirm(hitsS, meta.crossedS);
  const sHit = new Set(hitsS.map(h => h.hazard.id));
  const bridges = [];
  for (const e of meta.bridgesS || []) { const h = hazards.find(z => same(e, { hazard: z })); if (h && !sHit.has(h.id) && !bridges.some(b => b.hazard.site === h.site)) bridges.push({ hazard: h, s: Number.isFinite(e.along_m) ? e.along_m : projectS(S, e.location), d: 0, at: e.location, side: 'abajo', bridge: true }); }
  const sIds = new Set(hitsS.map(h => h.hazard.id));
  const avoided = hitsN.filter(h => !sIds.has(h.hazard.id));
  // spatial hash of the safe route to find divergence and rejoin
  const cell = p => Math.floor(p[0] * 1500) + ':' + Math.floor(p[1] * 1500);
  const grid = new Map(); for (const q of S.pts) { const c = cell(q.p); if (!grid.has(c)) grid.set(c, []); grid.get(c).push(q); }
  const near = (p, minS = -1) => { let d = 1e9, s = 0; const x = Math.floor(p[0] * 1500), y = Math.floor(p[1] * 1500); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of grid.get((x + i) + ':' + (y + j)) || []) { if (q.s < minS) continue; const dd = hav(p, q.p); if (dd < d) { d = dd; s = q.s; } } return { d, s }; };
  let divergeN = null, diverge = null, rejoinN = null, rejoin = null;
  for (const q of N.pts) { const n = near(q.p); if (n.d > 28) { divergeN = q.s; diverge = near(N.pts[Math.max(0, N.pts.indexOf(q) - 8)].p).s; break; } }
  if (divergeN != null) for (const q of N.pts) { if (q.s < divergeN + 80) continue; const n = near(q.p, diverge + 80); if (n.d < 12) { rejoinN = q.s; rejoin = n.s; break; } }
  if (!avoided.length) { divergeN = diverge = null; }
  // closest approach of the safe route to each avoided hazard site
  const sites = new Map(); for (const h of avoided) { const k = h.hazard.site || h.hazard.id; if (!sites.has(k)) sites.set(k, []); sites.get(k).push(h); }
  const groups = [...sites.values()].map(list => {
    list.sort((a, b) => (b.hazard.kind === 'critica') - (a.hazard.kind === 'critica'));
    const main = list.find(h => h.hazard.kind !== 'critica') || list[0];
    let best = { d: 1e9, s: 0 }; for (const q of S.pts) { const d = hav(q.p, main.at); if (d < best.d) best = { d, s: q.s }; }
    return { main, list, critical: list.some(h => h.hazard.kind === 'critica'), passS: best.s, passD: best.d, w: hitWeight(list) };
  }).sort((a, b) => b.w - a.w || a.main.s - b.main.s);
  // near misses: severe hazards within 140 m of the safe route that it does not touch
  const hitIds = new Set(hitsS.map(h => h.hazard.id));
  const nearMiss = routeHits(S.coords, hazards.filter(h => (h.kind === 'critica' || h.kind === 'desnivel' || h.kind === 'pasoosm') && !hitIds.has(h.id)), 140)
    .filter(h => h.d > 18 && !bridges.some(b => b.hazard.site === h.hazard.site)).map(h => { const a = at(S, h.s - 25), b = at(S, h.s + 25), k = Math.cos(a[1] * Math.PI / 180); const cr = (b[0] - a[0]) * k * (h.hazard.center[1] - a[1]) - (b[1] - a[1]) * (h.hazard.center[0] - a[0]) * k; return { ...h, side: cr > 0 ? 'izquierda' : 'derecha' }; });
  nearMiss.push(...bridges);
  const streetAt = (R, s) => { let nm = ''; for (const st of R.steps) { if (st.s <= s + 5 && st.name) nm = st.name; } return nm; };
  const namesN = new Set(N.steps.map(s => s.name).filter(Boolean));
  const newStreet = diverge != null ? (S.steps.find(st => st.s >= diverge - 150 && st.name && !namesN.has(st.name)) || {}).name || '' : '';
  const counts = {}; for (const h of hazards) counts[h.kind] = (counts[h.kind] || 0) + 1;
  const imep = hazards.filter(h => h.layerId === 'observed-imeplan-2026');
  const sites310 = new Set(imep.filter(h => h.kind !== 'critica').map(h => h.site)).size; counts.imepCritica = imep.filter(h => h.kind === 'critica').length; counts.total = hazards.length;
  return { N, S, hitsN, hitsS, avoided, groups, near: nearMiss, divergeN, diverge, rejoinN, rejoin, streetAt, newStreet, counts, sites: sites310, meta };
}

// ---------- timeline (deterministic: everything is a function of t) ----------
function monotone(xs, ys) {
  const n = xs.length, d = [], m = Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 2 * d[i - 1] * d[i] / (d[i - 1] + d[i]);
  m[0] = 0; m[n - 1] = 0;
  const f = x => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
  return f;
}
function buildTimeline(trip, opts = {}) {
  const { S } = trip, L = S.L, hasRain = opts.rain !== false && state.active.size > 0;
  const T0 = 3.2, T1 = DUR - 3.5;
  const ev = [];
  const reroute = trip.diverge != null;
  const firstHit = trip.hitsS[0];
  ev.push({ type: 'depart', s: 0, win: [0, 160] });
  let sRainPos = 0;
  if (hasRain) {
    let sR = reroute ? trip.diverge - 1450 : firstHit ? firstHit.s - 1300 : L * 0.25; sR = clamp(sR, Math.min(220, L * 0.05), L * 0.6);
    if (reroute && sR > trip.diverge - 400) sR = Math.max(1, trip.diverge - 400); // early divergence: it starts raining right at departure
    sRainPos = sR; ev.push({ type: 'rain', s: sR, win: [sR - 120, sR + 260] });
  }
  // caution alerts on the safe route: strongest few, spaced
  const cands = trip.hitsS.map(h => ({ h, w: (h.hazard.kind === 'critica' || h.hazard.kind === 'desnivel' ? 3 : 1) + (parseInt((depth(h.hazard).match(/–(\d+)/) || [])[1] || 0) / 100) }));
  const chosen = [];
  for (const c of cands.sort((a, b) => b.w - a.w)) { if (chosen.length >= (reroute ? 2 : 3)) break; if (chosen.every(o => Math.abs(o.h.s - c.h.s) > 900)) chosen.push(c); }
  const sRain = (ev.find(e => e.type === 'rain') || { s: -1e9 }).s;
  for (const { h } of chosen) { const sA = Math.max(0, h.s - 380); if (hasRain && sA < sRain + 250) continue; ev.push({ type: 'alert', s: sA, hit: h, win: [sA - 160, h.s + 140] }); }
  if (reroute) {
    const sRR = Math.min(trip.diverge - 3, Math.max(trip.diverge - 230, sRainPos + Math.max(2, (trip.diverge - sRainPos) * 0.5))); ev.push({ type: 'reroute', s: sRR, win: [sRR - 180, trip.diverge + 240] });
    const g = trip.groups[0]; if (g) { const sP = clamp(g.passS, trip.diverge + 150, L - 200); ev.push({ type: 'pass', s: sP, group: g, win: [sP - 220, sP + 160] }); }
  }
  // near misses (severe hazards beside the route): fill quiet stretches with "the route goes around it" alerts
  const nearMax = reroute ? 1 : 2, taken = ev.map(e => e.s);
  const nm = (trip.near || []).map(h => ({ h, w: (h.bridge ? 0.5 : 0) + (h.hazard.kind === 'pasoosm' ? 1 : 3) + (parseInt((depth(h.hazard).match(/(\d+)\s*(cm|\()/) || [])[1] || 0) / 100) - h.d / 400 }))
    .filter(o => o.h.s > (reroute ? trip.diverge + 500 : 600) && o.h.s < L - 800).sort((a, b) => b.w - a.w);
  let nmCount = 0;
  for (const { h } of nm) { if (nmCount >= nearMax) break; if (taken.some(x => Math.abs(x - h.s) < 1400)) continue; const sA = Math.max(0, h.s - 260); ev.push({ type: 'near', s: sA, hit: h, win: [sA - 150, h.s + 140] }); taken.push(h.s); nmCount++; }
  ev.push({ type: 'arrive', s: L, win: [L - 450, L] });
  ev.sort((a, b) => a.s - b.s);
  // merge slow windows; inside each, knots sit on the event trigger points so every dialog gets its reading time
  const MIN = { depart: 2.3, rain: 2.6, alert: 2.9, reroute: 3.6, pass: 1.9, near: 2.6, arrive: 1.0 };
  const wins = [...ev.map(e => ({ a: clamp(e.win[0], 0, L), b: clamp(e.win[1], 0, L), ev: [e] }))].sort((x, y) => x.a - y.a);
  const merged = []; for (const w of wins) { const last = merged[merged.length - 1]; if (last && w.a <= last.b + 120) { last.b = Math.max(last.b, w.b); last.ev.push(...w.ev); } else merged.push({ ...w, ev: [...w.ev] }); }
  const VS = 190; // slow-window speed, m per demo-second (~x10 real time)
  const segs = [];
  let cur = 0;
  for (const w of merged) {
    if (w.a > cur + 1) segs.push({ a: cur, b: w.a, gap: true });
    const pts = [...new Set([w.a, ...w.ev.filter(e => e.type !== 'arrive').map(e => clamp(e.s, w.a, w.b)), w.b])].sort((x, y) => x - y);
    const evAt = new Map(w.ev.map(e => [clamp(e.s, w.a, w.b), e]));
    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i + 1] - pts[i] < 0.5 && i < pts.length - 2) continue;
      const e = evAt.get(pts[i]); let dt = (pts[i + 1] - pts[i]) / VS;
      if (e) dt = Math.max(dt, MIN[e.type] || 2.4);
      segs.push({ a: pts[i], b: pts[i + 1], dt: Math.max(0.05, dt) });
    }
    cur = Math.max(cur, w.b);
  }
  if (cur < L - 1) segs.push({ a: cur, b: L, gap: true });
  const budget = T1 - T0, gaps = segs.filter(x => x.gap), slowT = segs.reduce((a, x) => a + (x.gap ? 0 : x.dt), 0);
  let gapT = budget - slowT, scale = 1;
  if (gaps.length && gapT < gaps.length * 0.65) { scale = (budget - gaps.length * 0.65) / slowT; gapT = gaps.length * 0.65; }
  if (!gaps.length) scale = budget / slowT;
  const gw = gaps.map(g => Math.pow(g.b - g.a, 0.55)), gws = gw.reduce((a, b) => a + b, 0) || 1;
  const xs = [0, T0], ys = [0, 0]; let t = T0, gi = 0;
  for (const sg of segs) { t += sg.gap ? gapT * gw[gi++] / gws : sg.dt * scale; xs.push(t); ys.push(sg.b); }
  const k = (T1 - T0) / (t - T0); for (let i = 2; i < xs.length; i++) xs[i] = T0 + (xs[i] - T0) * k;
  xs.push(DUR + 5); ys.push(L);
  const sAt = monotone(xs, ys);
  const vAt = tt => (sAt(tt + 0.04) - sAt(tt - 0.04)) / 0.08;
  const tAt = s => { let lo = T0, hi = T1 + 0.01; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (sAt(m) < s) lo = m; else hi = m; } return hi; };
  for (const e of ev) e.t = e.type === 'arrive' ? T1 : tAt(e.s);
  return { T0, T1, ev, sAt, vAt, tAt, tRain: (ev.find(e => e.type === 'rain') || {}).t ?? (hasRain ? 0 : Infinity), tReroute: (ev.find(e => e.type === 'reroute') || {}).t ?? Infinity, dialog: buildDialog(trip, ev, T0, T1, hasRain) };
}

// dialog entries: text is a list of [string, tag] segments, revealed with a typewriter
function buildDialog(trip, ev, T0, T1, hasRain) {
  const { N, S } = trip, out = [];
  const add = (t0, kind, title, text, src = '', dur = 3.4) => out.push({ t0, kind, title, text, src, dur });
  add(0.25, 'info', 'MISIÓN 01', [['¡Hola! Soy ', ''], ['AXO', 'b'], [', tu ajolote copiloto. Te llevo de ', ''], [state.nameA, 'em'], [' a ', ''], [state.nameB, 'em'], [' sin meternos al agua.', '']], '', 3.2);
  add(T0 - 0.1, 'info', hasRain ? 'CIELO DESPEJADO' : 'EN MARCHA', [[hasRain ? 'Sin lluvia, la ruta más rápida es la de siempre: ' : 'Ruta más rápida: ', ''], [`${fmtKm(N.L)}, ${fmtMin(N.duration_s)}`, 'b'], ['. ¡Arrancamos!', '']], 'Ruta: ' + (trip.meta.engineLabel || 'OSRM'));
  for (const e of ev) {
    if (e.type === 'rain') {
      const c = trip.counts, obs = c.encharcamiento + c.desnivel;
      const extra = state.active.size - (state.active.has('observed-imeplan-2026') ? 1 : 0);
      add(e.t, 'info', '¡EMPIEZA A LLOVER!', trip.sites ? [['Activo la capa de lluvia: ', ''], [`${trip.sites} sitios inundables`, 'em'], c.imepCritica ? [' y ', ''] : ['', ''], c.imepCritica ? [`${c.imepCritica} zonas críticas`, 'strong'] : ['', ''], [' registrados por IMEPLAN', ''], [extra ? ` + ${extra} capa${extra > 1 ? 's' : ''} más` : '', ''], ['. Reviso tu ruta…', '']] : [['Activo ', ''], [`${state.active.size} capa${state.active.size > 1 ? 's' : ''} de peligro`, 'em'], [` (${c.total} elementos). Reviso tu ruta…`, '']], 'Capas activas: ' + [...state.active].map(id => (state.layers.find(l => l.id === id) || {}).label || id).join(' · '), 2.6);
    } else if (e.type === 'alert') {
      const h = e.hit.hazard, also = trip.hitsN.some(x => x.hazard.id === h.id);
      add(e.t, 'alert', KIND_TITLE[h.kind], [['A 380 m: ', ''], [place(h), 'em'], ['. Registrado: ', ''], [depth(h), 'strong'], ['. ', ''], [also && trip.diverge != null && e.hit.s < trip.diverge ? 'Está antes de cualquier desvío: baja la velocidad; si el agua tapa la banqueta, no cruces.' : 'No hay desvío corto: baja la velocidad; si el agua tapa la banqueta, no cruces.', '']], srcLine(h), 3.0);
    } else if (e.type === 'reroute') {
      const g = trip.groups[0], h = g.main.hazard, street = trip.streetAt(N, g.main.s);
      const extraKm = (S.L - N.L) / 1000, extraMin = Math.round((S.duration_s - N.duration_s) / 60);
      const more = trip.groups.length > 1 ? [` y ${trip.groups.length - 1} sitio${trip.groups.length > 2 ? 's' : ''} más`, ''] : ['', ''];
      add(e.t, 'alert', '¡RECALCULANDO!', [['Adelante', ''], [street ? ', en ' + street : '', ''], [': ', ''], [/desnivel/i.test(place(h)) ? short(place(h), 50) : KIND_NOUN[h.kind] + ' ' + short(place(h), 46), 'em'], [dp(h), ''], g.critical ? [' + zona crítica IMEPLAN', 'strong'] : ['', ''], more, ['. Nueva ruta', ''], [trip.newStreet ? ' por ' + trip.newStreet : '', 'b'], [`: ${extraKm >= 0 ? '+' : ''}${extraKm.toFixed(1)} km, ${extraMin >= 0 ? '+' : ''}${extraMin} min.`, '']], srcLine(h), 3.6);
    } else if (e.type === 'near') {
      const h = e.hit.hazard, d = Math.max(20, Math.round(e.hit.d / 10) * 10);
      if (e.hit.bridge) { add(e.t, 'alert', '¡INUNDABLE BAJO EL PUENTE!', [['Vas por arriba. Abajo: ', ''], [short(place(h), 52), 'em'], [dp(h), 'strong'], ['. El registro es del paso inferior, no del puente.', '']], srcLine(h), 2.8); continue; }
      const title = h.kind === 'critica' ? `¡ZONA CRÍTICA A ${d} m!` : h.kind === 'desnivel' ? '¡PASO A DESNIVEL INUNDABLE!' : 'PASO A DESNIVEL CERCA';
      add(e.t, 'alert', title, [[`A tu ${e.hit.side}, a ${d} m: `, ''], [short(place(h), 52), 'em'], [depth(h) ? ` (${depth(h)})` : '', 'strong'], ['. La ruta pasa de lado, sin entrar.', '']], srcLine(h), 2.8);
    } else if (e.type === 'pass') {
      const g = e.group, h = g.main.hazard;
      add(e.t, 'good', '¡ESQUIVADO! +' + trip.groups.reduce((a, gg) => a + gg.list.length, 0), [['', ''], [/desnivel/i.test(place(h)) ? short(place(h), 48) : cap(KIND_NOUN[h.kind]) + ' ' + short(place(h), 44), 'em'], [` quedó a ${Math.round(g.passD / 10) * 10} m. Seguimos secos`, ''], [trip.newStreet ? ' por ' + trip.newStreet : '', 'b'], ['.', '']], srcLine(h), 2.6);
    } else if (e.type === 'arrive') {
      const ng = trip.groups.length, nc = trip.hitsS.length;
      add(T1, 'good', '¡MISIÓN CUMPLIDA!', [['Llegamos a ', ''], [state.nameB, 'em'], ['. ', ''], [ng ? `Esquivamos ${ng} sitio${ng > 1 ? 's' : ''} registrado${ng > 1 ? 's' : ''}` : 'Sin desvíos necesarios', 'b'], [nc ? `; ${nc} con precaución.` : '.', '']], 'Inventario histórico IMEPLAN · ruta ' + (trip.meta.engineLabel || 'OSRM'), 5);
    }
  }
  out.sort((a, b) => a.t0 - b.t0);
  for (let i = 0; i < out.length; i++) out[i].t1 = Math.min(out[i].t0 + out[i].dur, out[i + 1] ? out[i + 1].t0 : 1e9);
  return out;
}

// ---------- camera ----------
function padFollow() { const H = innerHeight; return PHONE ? { top: H * 0.34, bottom: 150, left: 0, right: 0 } : { top: H * 0.42, bottom: 0, left: 0, right: 404 }; }
function padOverview() { return PHONE ? { top: 300, bottom: 250, left: 40, right: 40 } : { top: 110, bottom: 230, left: 620, right: 450 }; }
function followCam(s, v) {
  const S = state.trip.S;
  const z = clamp(16.4 - 1.25 * Math.log2(Math.max(v, 150) / 150), 12.9, 16.4) - (PHONE ? 0.35 : 0);
  const ahead = clamp(Math.abs(v) * 1.3, 70, 1700);
  return { center: at(S, s), zoom: z, bearing: headingAt(S, s, ahead * 0.35, ahead), pitch: clamp(60 - (16.4 - z) * 3, 46, 60), padding: padFollow() };
}
let overviewCam = null;
function computeOverview() {
  const { N, S } = state.trip; const b = new maplibregl.LngLatBounds();
  for (const p of [...N.coords, ...S.coords]) b.extend(p);
  const brgv = PHONE ? -8 : -14;
  const c = map.cameraForBounds(b, { padding: padOverview(), bearing: brgv }) || { center: b.getCenter(), zoom: 12 };
  overviewCam = { center: [c.center.lng ?? c.center[0], c.center.lat ?? c.center[1]], zoom: c.zoom - 0.15, bearing: brgv, pitch: 40, padding: { top: 0, bottom: 0, left: 0, right: 0 } };
}
// zoomOutFirst: zoom/pitch move early and the centre late (a -> overview), otherwise the reverse (overview -> car)
function lerpCam(a, b, k, zoomOutFirst) {
  const kc = zoomOutFirst ? smooth((k - 0.25) / 0.75) : smooth(k / 0.7), kz = zoomOutFirst ? smooth(k / 0.7) : smooth((k - 0.3) / 0.7);
  const pad = {}; for (const key of ['top', 'bottom', 'left', 'right']) pad[key] = lerp(a.padding[key], b.padding[key], kc);
  return { center: [lerp(a.center[0], b.center[0], kc), lerp(a.center[1], b.center[1], kc)], zoom: lerp(a.zoom, b.zoom, kz), bearing: angLerp(a.bearing, b.bearing, kz), pitch: lerp(a.pitch, b.pitch, kz), padding: pad };
}

// ---------- map layers for routes / hazards / markers ----------
const line = coords => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
function sliceRoute(R, a, b) { const out = [at(R, a)]; for (const q of R.pts) if (q.s > a && q.s < b) out.push(q.p); out.push(at(R, b)); return out; }
function ensureRouteLayers() {
  if (map.getSource('r-normal')) return;
  for (const id of ['r-ghost', 'r-normal', 'r-safe']) map.addSource(id, { type: 'geojson', data: line([[0, 0], [0, 0.0001]]), lineMetrics: true });
  const before = 'building';
  map.addLayer({ id: 'r-ghost-case', type: 'line', source: 'r-ghost', layout: { 'line-join': 'round' }, paint: { 'line-color': PAL.ink, 'line-width': W(10, 10, 13, 13, 15, 19, 17, 44), 'line-opacity': 0 } }, before);
  map.addLayer({ id: 'r-ghost', type: 'line', source: 'r-ghost', layout: { 'line-join': 'round' }, paint: { 'line-color': PAL.hot, 'line-width': W(10, 6, 13, 8, 15, 11, 17, 28), 'line-dasharray': [1.2, 0.8], 'line-opacity': 0 } }, before);
  for (const id of ['r-normal', 'r-safe']) {
    map.addLayer({ id: id + '-case', type: 'line', source: id, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-width': W(10, 13, 13, 17, 15, 24, 17, 54), 'line-gradient': ['step', ['line-progress'], 'rgba(0,0,0,0)', 0, PAL.ink] } }, before);
    map.addLayer({ id, type: 'line', source: id, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-width': W(10, 6.5, 13, 9, 15, 15, 17, 36), 'line-gradient': ['step', ['line-progress'], 'rgba(0,0,0,0)', 0, PAL.yellow] } }, before);
  }
}
const cache = {};
function setPaint(layer, prop, value) { const k = layer + '|' + prop, v = JSON.stringify(value); if (cache[k] === v) return; cache[k] = v; if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value); }
function setLayout(layer, prop, value) { const k = layer + '|L|' + prop; if (cache[k] === value) return; cache[k] = value; if (map.getLayer(layer)) map.setLayoutProperty(layer, prop, value); }
function routeVisual(id, visible, progress, color) {
  const vis = visible ? 'visible' : 'none';
  for (const l of [id, id + '-case']) setLayout(l, 'visibility', vis);
  if (!visible) return;
  const p = 0; // trimming the driven part via line-gradient re-uploads a colour ramp per tile each frame (7 fps at 1080p); the car covers the cut instead
  setPaint(id, 'line-gradient', ['step', ['line-progress'], 'rgba(0,0,0,0)', p, color]);
  setPaint(id + '-case', 'line-gradient', ['step', ['line-progress'], 'rgba(0,0,0,0)', p, PAL.ink]);
}
function addHazardLayers() {
  for (const { layer, fc } of state.sets) {
    const id = 'hz-' + layer.id; if (map.getSource(id)) continue;
    if (layer.kind === 'water') { // mapped permanent water: always-on context, drawn like OSM water
      map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: fc.features.filter(f => f.geometry && /Polygon/.test(f.geometry.type)) } });
      map.addLayer({ id: id + '-ctx', type: 'fill', source: id, paint: { 'fill-pattern': 'water' } }, 'waterway');
      continue;
    }
    const lines = { type: 'FeatureCollection', features: fc.features.filter(f => f.geometry && /LineString/.test(f.geometry.type)) };
    if (lines.features.length) {
      map.addSource(id + '-l', { type: 'geojson', data: lines });
      map.addLayer({ id: id + '-lcase', type: 'line', source: id + '-l', layout: { 'line-cap': 'butt' }, paint: { 'line-color': PAL.ink, 'line-width': W(11, 3, 14, 8, 17, 26), 'line-opacity': 0 } }, 'r-ghost-case');
      map.addLayer({ id: id + '-lline', type: 'line', source: id + '-l', layout: { 'line-cap': 'butt' }, paint: { 'line-color': ['match', ['get', 'confidence'], 'alta', PAL.flame, PAL.gold], 'line-width': W(11, 1.5, 14, 5, 17, 18), 'line-dasharray': [1, 1], 'line-opacity': 0 } }, 'r-ghost-case');
    }
    const polys = { type: 'FeatureCollection', features: fc.features.filter(f => f.geometry && /Polygon/.test(f.geometry.type)) };
    if (!polys.features.length) {
      const pts = { type: 'FeatureCollection', features: fc.features.filter(f => f.geometry && f.geometry.type === 'Point') };
      if (pts.features.length) {
        map.addSource(id + '-p', { type: 'geojson', data: pts });
        map.addLayer({ id: id + '-pt', type: 'circle', source: id + '-p', paint: { 'circle-color': layer.kind === 'observed' ? PAL.cyan : PAL.flame, 'circle-radius': W(10, 1.5, 14, 4, 17, 10), 'circle-stroke-color': PAL.ink, 'circle-stroke-width': W(10, 0.5, 14, 1.5, 17, 3), 'circle-opacity': 0, 'circle-stroke-opacity': 0, 'circle-pitch-alignment': 'map' } }, 'r-ghost-case');
      }
      continue;
    }
    map.addSource(id, { type: 'geojson', data: polys });
    const modeled = layer.kind === 'modeled' || layer.kind === 'terrain-index';
    map.addLayer({ id: id + '-fill', type: 'fill', source: id, paint: { 'fill-pattern': modeled ? 'modeled' : 'flood', 'fill-opacity': 0 } }, 'r-ghost-case');
    map.addLayer({ id: id + '-line', type: 'line', source: id, paint: { 'line-color': modeled ? PAL.mauve : ['match', ['get', 'category'], 'Zonas Criticas', PAL.hot, PAL.cyan], 'line-width': W(10, ['match', ['get', 'category'], 'Zonas Criticas', 1.5, 1], 14, ['match', ['get', 'category'], 'Zonas Criticas', 4, 3], 17, ['match', ['get', 'category'], 'Zonas Criticas', 9, 6]), 'line-opacity': 0 } }, 'r-ghost-case');
  }
  for (const L of state.layers.filter(l => l.type === 'raster-tiles' && l.url)) {
    const id = 'hz-' + L.id; if (map.getSource(id)) continue;
    map.addSource(id, { type: 'raster', tiles: [absURL((L.tiles && L.tiles[0]) || L.url)], tileSize: L.tileSize || 256, minzoom: L.minzoom || 0, maxzoom: L.maxzoom || 16, ...(L.bounds ? { bounds: L.bounds } : {}) });
    map.addLayer({ id: id + '-raster', type: 'raster', source: id, layout: { visibility: 'none' }, paint: { 'raster-opacity': 0, 'raster-resampling': 'nearest' } }, 'r-ghost-case');
  }
}

function pxMarker(img, scale, tag, cls) {
  const el = document.createElement('div'); el.className = 'pxm ' + cls;
  if (tag) { const t = document.createElement('div'); t.className = 'tag'; t.textContent = tag; el.append(t); el.style.flexDirection = 'column'; }
  const wrap = document.createElement('div'); wrap.style.position = 'relative'; wrap.append(toCanvas(img, scale));
  if (cls.includes('hz')) { const x = toCanvas(crossIcon(), scale); x.className = 'x'; wrap.append(x); }
  el.append(wrap); return el;
}
function buildMarkers() {
  for (const m of state.markers) m.marker.remove(); state.markers = [];
  const { N, S, hitsS, groups } = state.trip, sc = PHONE ? 2 : 3;
  const add = (p, el, kind, extra = {}) => { const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat(p).addTo(map); state.markers.push({ marker, el, kind, ...extra }); };
  add(S.coords[0], pxMarker(flagIcon('A'), sc, short(state.nameA.toUpperCase(), 22), 'flag'), 'flag');
  add(S.coords[S.coords.length - 1], pxMarker(/aeropuerto/i.test(state.nameB) ? planeIcon() : flagIcon('B'), sc, short(state.nameB.toUpperCase(), 22), 'flag'), 'flag');
  const seen = new Set();
  for (const h of hitsS) { if (seen.has(h.hazard.site) || seen.size >= 4) continue; seen.add(h.hazard.site); add(h.at, pxMarker(signIcon(SIGN(h.hazard.kind)), sc, short(place(h.hazard).toUpperCase(), PHONE ? 18 : 24) + dp(h.hazard), 'hz ' + h.hazard.kind), 'hz', { avoid: false, s: h.s }); }
  for (const g of groups.slice(0, 3)) { const h = g.main; add(h.at, pxMarker(signIcon(g.critical ? 'critica' : SIGN(h.hazard.kind)), sc, short(place(h.hazard).toUpperCase(), PHONE ? 18 : 24) + dp(h.hazard), 'hz ' + (g.critical ? 'critica' : h.hazard.kind)), 'hz', { avoid: true }); }
}

// ---------- minimap ----------
let miniBase = null, miniHaz = null, miniProj = null;
function buildMinimap() {
  const { N, S } = state.trip, size = 88, pad = 7;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of [...N.coords, ...S.coords]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const k = Math.cos((y0 + y1) / 2 * Math.PI / 180), sx = (x1 - x0) * k, sy = y1 - y0, sc = (size - pad * 2) / Math.max(sx, sy);
  const ox = (size - sx * sc) / 2, oy = (size - sy * sc) / 2;
  miniProj = p => [Math.round(ox + (p[0] - x0) * k * sc), Math.round(size - oy - (p[1] - y0) * sc)];
  const mk = withHaz => {
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
    g.fillStyle = PAL.pine; g.fillRect(0, 0, size, size);
    g.fillStyle = PAL.grass; for (let y = 0; y < size; y += 4) for (let x = (y / 4) % 2 * 2; x < size; x += 4) g.fillRect(x, y, 1, 1);
    if (withHaz) for (const h of state.hazards) { const [cx, cy] = miniProj(h.center); if (cx < -2 || cy < -2 || cx > size + 2 || cy > size + 2) continue; g.fillStyle = h.kind === 'critica' ? PAL.hot : (h.layerKind === 'modeled' || h.layerKind === 'terrain-index') ? PAL.mauve : h.layerKind === 'hotspot' ? PAL.flame : PAL.cyan; g.fillRect(cx, cy, h.kind === 'critica' ? 2 : 1, h.kind === 'critica' ? 2 : 1); }
    const draw = (R, col, dash) => { let i = 0; let prev = null; for (const q of R.pts) { if (i++ % 3) continue; const [x, y] = miniProj(q.p); if (prev && !(dash && Math.floor(q.s / 260) % 2)) { g.fillStyle = col; g.fillRect(x, y, 1, 1); } prev = [x, y]; } };
    return { c, g, draw };
  };
  miniBase = mk(false); miniHaz = mk(true);
}
function drawMinimap(t, s, showSafe, showGhost, hazK) {
  const cv = $('#minimap'), g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage((hazK > 0.5 ? miniHaz : miniBase).c, 0, 0);
  const { N, S } = state.trip;
  const dot = (R, col, dash, from = 0) => { for (let i = 0; i < R.pts.length; i += 3) { const q = R.pts[i]; if (q.s < from) continue; if (dash && Math.floor(q.s / 240) % 2) continue; const [x, y] = miniProj(q.p); g.fillStyle = col; g.fillRect(x, y, 1, 1); } };
  if (showGhost) dot(N, PAL.red, true, state.trip.divergeN || 0);
  dot(showSafe ? S : N, PAL.yellow, false, 0);
  const [ax, ay] = miniProj(S.coords[0]), [bx, by] = miniProj(S.coords[S.coords.length - 1]);
  g.fillStyle = PAL.red; g.fillRect(ax - 1, ay - 1, 3, 3); g.fillStyle = PAL.white; g.fillRect(bx - 1, by - 1, 3, 3);
  const [cx, cy] = miniProj(at(S, s));
  g.fillStyle = PAL.ink; g.fillRect(cx - 2, cy - 2, 5, 5); g.fillStyle = Math.floor(t * 4) % 2 ? PAL.white : PAL.red; g.fillRect(cx - 1, cy - 1, 3, 3);
}

// ---------- quest log / HUD ----------
const KIND_CHIP = { observed: ['OBSERVADO', 'obs'], hotspot: ['PUNTOS', 'hot'], modeled: ['MODELO', 'modeled'], 'terrain-index': ['TERRENO', 'modeled'] };
function chips() {
  const box = $('#scenarios'); box.replaceChildren();
  const mk = (label, sub, icon, on, cls, fn) => { const b = document.createElement('button'); b.className = 'chip ' + cls + (on ? ' on' : ''); b.append(toCanvas(icon, 2)); const sp = document.createElement('span'); sp.textContent = label; if (sub) { const sm = document.createElement('small'); sm.textContent = ' ' + sub; sp.append(sm); } b.append(sp); if (!DEMO) b.addEventListener('click', fn); box.append(b); return b; };
  state.chipEls = { dry: mk('SECO', '', sunIcon(), state.active.size === 0, 'dry', () => setScenario(new Set())) };
  let hidden = 0;
  for (const L of state.layers) {
    if (L.kind === 'water') continue;
    if (DEMO && !state.active.has(L.id)) { hidden++; continue; }
    const [kl, cls] = KIND_CHIP[L.kind] || [(L.kind || 'CAPA').toUpperCase(), 'modeled'];
    const label = L.id === 'observed-imeplan-2026' ? 'LLUVIA · IMEPLAN' : kl;
    const sub = L.id === 'observed-imeplan-2026' ? 'registro 2026' : short((L.label || L.id).replace(/\s*\(.*?\)\s*/g, ' ').trim(), 30) + (L.type === 'raster-tiles' ? ' · vista' : '');
    const b = mk(label, sub, L.kind === 'observed' ? cloudIcon() : dropIcon(), state.active.has(L.id), cls, () => { const n = new Set(state.active); n.has(L.id) ? n.delete(L.id) : n.add(L.id); setScenario(n); });
    b.title = (L.label || L.id) + (L.notes ? ' — ' + L.notes.slice(0, 220) : '');
    if (L._failed) { b.disabled = true; b.title = 'Capa listada pero no disponible'; }
    state.chipEls[L.id] = b;
  }
  if (hidden) { const n = document.createElement('small'); n.className = 'chip-more'; n.textContent = `+${hidden} capas más en /labs/shared/hazard (modelos, puntos, terreno)`; box.append(n); }
  const leg = $('#legend'); leg.replaceChildren();
  const li = (bg, border, txt) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = bg; if (border) i.style.borderColor = border; s.append(i, document.createTextNode(txt)); leg.append(s); };
  const on = k => state.layers.some(l => l.kind === k && state.active.has(l.id));
  li(`url(${toURL(floodF[0])}) 0 0 / 24px`, PAL.cyan, 'Sitio inundable (registro)');
  li(`url(${toURL(floodF[1])}) 0 0 / 24px`, PAL.hot, 'Zona crítica (registro)');
  if (on('modeled') || on('terrain-index')) li(`url(${toURL(modelF[0])}) 0 0 / 24px`, PAL.mauve, 'Modelo / terreno');
  if (on('hotspot')) li(PAL.flame, PAL.ink, 'Punto o paso a desnivel');
  li(`url(${toURL(waterF[0])}) 0 0 / 24px`, PAL.ink, 'Agua permanente (OSM)');
  li(PAL.yellow, PAL.ink, 'Ruta segura'); li(`repeating-linear-gradient(90deg,${PAL.hot} 0 6px,${PAL.sand} 6px 10px)`, PAL.ink, 'Ruta evitada');
}
function chipState(rainOn) {
  if (!state.chipEls) return;
  state.chipEls.dry.classList.toggle('on', !rainOn);
  for (const id of Object.keys(state.chipEls)) if (id !== 'dry') state.chipEls[id].classList.toggle('on', rainOn && state.active.has(id));
}
function questStatic() {
  const { N, S, groups, hitsS } = state.trip;
  $('#quest-route').textContent = `${state.nameA} → ${state.nameB}`;
  $('#quest-name').textContent = state.active.size ? 'Llegar seco ' + (/aeropuerto/i.test(state.nameB) ? 'al aeropuerto' : 'a ' + state.nameB) : 'Llegar a ' + state.nameB;
  const cmp = $('#compare'); cmp.replaceChildren();
  const row = (cls, title, sub) => { const r = document.createElement('div'); r.className = 'row'; const sw = document.createElement('div'); sw.className = 'sw ' + cls; const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = title; const sm = document.createElement('small'); sm.textContent = sub; d.append(b, sm); r.append(sw, d); cmp.append(r); };
  const desc = hits => describeHits(hits, 'cruza ');
  if (state.trip.diverge != null) {
    row('safe', `Ruta segura · ${fmtKm(S.L)} · ${fmtMin(S.duration_s)}`, desc(hitsS));
    row('normal', `Ruta normal · ${fmtKm(N.L)} · ${fmtMin(N.duration_s)}`, desc(state.trip.hitsN));
    const d = document.createElement('div'); d.className = 'delta'; const dm = Math.round((S.duration_s - N.duration_s) / 60); d.textContent = `DESVÍO: ${dm >= 0 ? '+' : ''}${dm} MIN · ${((S.L - N.L) / 1000).toFixed(1)} KM`; cmp.append(d);
  } else row('safe', `Ruta · ${fmtKm(S.L)} · ${fmtMin(S.duration_s)}`, state.active.size ? desc(hitsS) + (hitsS.length ? ' (sin alternativa encontrada)' : '') : 'escenario seco: sin capas de peligro activas');
  const objs = [{ id: 'start', text: `Salir de ${state.nameA}`, done: tl => tl.T0 + 0.4 }];
  const passT = tl => (tl.ev.find(e => e.type === 'pass') || { t: tl.tReroute }).t;
  for (const g of groups.slice(0, 2)) { const h = g.main.hazard; objs.push({ id: 'g' + h.id, cls: 'avoid', text: 'Esquivar: ' + KIND_NOUN[h.kind] + (g.critical ? ' + zona crítica' : ''), sub: short(place(h), 40) + dp(h), done: passT, reveal: tl => tl.tRain }); }
  if (groups.length > 2) { const rest = groups.slice(2); objs.push({ id: 'grest', cls: 'avoid', text: 'Esquivar: ' + describeHits(rest.flatMap(g => g.list)) + ' más', sub: rest.slice(0, 3).map(g => short(place(g.main.hazard), 24)).join(' · ') + (rest.length > 3 ? '…' : ''), done: tl => tl.tReroute + 1.2, reveal: tl => tl.tRain }); }
  const seen = new Set(), cau = hitsS.filter(h => !seen.has(h.hazard.site) && seen.add(h.hazard.site));
  for (const h of cau.slice(0, 2)) objs.push({ id: 'h' + h.hazard.id, cls: 'warn', text: 'Precaución: ' + KIND_NOUN[h.hazard.kind], sub: short(place(h.hazard), 40) + dp(h.hazard), done: tl => tl.tAt(h.s + 30), reveal: tl => tl.tRain });
  if (cau.length > 2) objs.push({ id: 'hrest', cls: 'warn', text: `Precaución: ${cau.length - 2} sitio${cau.length > 3 ? 's' : ''} más en la ruta`, done: tl => tl.T1, reveal: tl => tl.tRain });
  objs.push({ id: 'end', text: `Llegar a ${state.nameB}`, done: tl => tl.T1 });
  const ul = $('#objectives'); ul.replaceChildren();
  state.objs = objs.map(o => { const li = document.createElement('li'); li.className = o.cls || ''; const i = document.createElement('i'); const sp = document.createElement('span'); sp.textContent = o.text; if (o.sub) { const sm = document.createElement('small'); sm.textContent = o.sub; sp.append(sm); } li.append(i, sp); ul.append(li); return { ...o, li, sp }; });
  const rs = state.routerStatus, eng = state.router ? state.router.engine : '—';
  $('#router-note').innerHTML = '';
  const stub = /stub/.test(eng);
  $('#router-note').append(document.createTextNode(stub ? 'Router: OSRM (servidor demo) sin evitación de agua; la ruta segura se buscó con puntos de paso que minimizan registros IMEPLAN (' + (state.trip.meta.baked ? 'precalculada' : 'en tu navegador') + '). El router con agua la reemplaza al estar listo.' : `Router: ${eng}${rs && rs.state ? ' (' + rs.state + ')' : ''}.`));
  $('#route-credit').textContent = stub ? 'OSRM (demo)' : eng;
}
function questTime(t, tl, preview) {
  if (!state.objs) return;
  for (const o of state.objs) {
    const revealed = preview || !o.reveal || t >= o.reveal(tl);
    const done = !preview && t >= o.done(tl);
    o.li.classList.toggle('locked', !revealed); o.li.classList.toggle('done', done);
    o.sp.firstChild.textContent = revealed ? o.text : '??? se revela con lluvia';
    if (o.sp.childNodes[1]) o.sp.childNodes[1].style.display = revealed ? '' : 'none';
  }
}
let lastDialogKey = '';
function dialogAt(t, tl) {
  const d = tl.dialog.find(e => t >= e.t0 && t < e.t1);
  const box = $('#dialog');
  if (!d) { box.classList.add('hidden'); lastDialogKey = ''; return; }
  box.classList.remove('hidden'); box.classList.toggle('alert', d.kind === 'alert');
  const n = Math.floor((t - d.t0) * 80);
  const key = d.t0 + '|' + n; if (key === lastDialogKey) return; lastDialogKey = key;
  $('#dialog-title').textContent = d.title;
  const txt = $('#dialog-text'); txt.replaceChildren(); let left = n;
  for (const [str, tag] of d.text) { if (left <= 0) break; const part = str.slice(0, left); left -= str.length; const el = tag === 'em' ? document.createElement('em') : tag === 'strong' || tag === 'b' ? document.createElement('strong') : document.createTextNode(part); if (el.nodeType === 1) el.textContent = part; txt.append(el); }
  $('#dialog-src').textContent = d.src;
  const total = d.text.reduce((a, [s]) => a + s.length, 0);
  paint('#portrait', axoPortrait(Math.floor(t * 10) % 37 === 0, n < total && Math.floor(t * 8) % 2 === 0));
}
function maneuverAt(s, R) {
  const box = $('#maneuver');
  const st = R.steps.find(x => x.s > s + 8 && x.type !== 'new name' && x.type !== 'depart') || R.steps[R.steps.length - 1];
  if (!st) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const d = Math.max(0, st.s - s);
  $('#maneuver-dist').textContent = d > 950 ? (d / 1000).toFixed(1).replace('.', ',') + ' km' : (Math.round(d / 10) * 10) + ' m';
  $('#maneuver-label').textContent = st.label;
  const key = st.arrow; if (box.dataset.arrow !== key) { box.dataset.arrow = key; paint('#maneuver-arrow', arrowIcon(key)); }
}

// ---------- the frame function ----------
function applyTime(t) {
  state.t = t;
  const trip = state.trip, tl = state.tl, { N, S } = trip;
  const T0 = tl.T0, T1 = tl.T1;
  const s = tl.sAt(t), v = Math.max(0, tl.vAt(t));
  const rainK = state.active.size ? smooth((t - tl.tRain) / 1.2) : 0;
  const hazK = state.active.size ? smooth((t - tl.tRain - 0.2) / 0.7) : 0;
  const rerouted = t >= tl.tReroute;
  state.rainK = rainK;
  const bgc = rainK > 0.5 ? PAL.steel : PAL.mist; if (state.bgc !== bgc) { state.bgc = bgc; $('#map').style.background = bgc; } // matches the FX horizon haze (hides a top gap some headless captures show)
  // camera
  const fol = followCam(s, v);
  let cam;
  if (t < T0) cam = lerpCam(overviewCam, followCam(0, 150), clamp((t - (T0 - 1.8)) / 2.0, 0, 1), false);
  else if (t > T1 + 0.3) cam = lerpCam(fol, overviewCam, clamp((t - T1 - 0.3) / 1.9, 0, 1), true);
  else cam = fol;
  map.jumpTo(cam);
  document.body.classList.toggle('far', cam.zoom < 13.2);
  // car
  const kf = t < T0 ? smooth((t - (T0 - 1.2)) / 1.4) : t > T1 + 0.3 ? 1 - smooth((t - T1 - 0.3) / 1.3) : 1;
  const carPx = lerp(PHONE ? 34 : 44, PHONE ? 58 : 84, kf);
  const mpp = 40075016.686 * Math.cos(at(S, s)[1] * Math.PI / 180) / (512 * Math.pow(2, cam.zoom));
  state.car = { visible: true, lngLat: at(S, s), heading: headingAt(S, s, 10, 14), unitMeters: mpp * carPx / 12, bob: v > 20 && Math.floor(t * 9) % 2 ? 0.25 : 0 };
  // routes
  const inOut = t > T1 + 0.4;
  if (!rerouted) { routeVisual('r-normal', true, t < T0 ? 0 : s / N.L, PAL.yellow); routeVisual('r-safe', false, 0, PAL.yellow); }
  else { routeVisual('r-normal', false, 0, PAL.yellow); routeVisual('r-safe', true, inOut ? 0 : s / S.L, PAL.yellow); }
  const ghostK = rerouted ? 1 : 0;
  setPaint('r-ghost', 'line-opacity', ghostK); setPaint('r-ghost-case', 'line-opacity', ghostK * 0.9);
  // hazards (pop in with the rain) + animated water
  const pulse = Math.floor(t * 2.5) % 2 ? 1 : 0.45;
  for (const { layer } of state.sets) {
    const on = state.active.has(layer.id) ? hazK : 0;
    setPaint('hz-' + layer.id + '-fill', 'fill-opacity', +(on * 0.95).toFixed(2));
    setPaint('hz-' + layer.id + '-line', 'line-opacity', +(on * (layer.kind === 'modeled' ? 0.9 : pulse)).toFixed(2));
    setPaint('hz-' + layer.id + '-lline', 'line-opacity', +on.toFixed(2)); setPaint('hz-' + layer.id + '-lcase', 'line-opacity', +(on * 0.8).toFixed(2));
    setPaint('hz-' + layer.id + '-pt', 'circle-opacity', +on.toFixed(2)); setPaint('hz-' + layer.id + '-pt', 'circle-stroke-opacity', +on.toFixed(2));
  }
  for (const L of state.layers.filter(l => l.type === 'raster-tiles')) { setLayout('hz-' + L.id + '-raster', 'visibility', state.active.has(L.id) && hazK > 0 ? 'visible' : 'none'); setPaint('hz-' + L.id + '-raster', 'raster-opacity', state.active.has(L.id) ? +(hazK * 0.85).toFixed(2) : 0); }
  const f = ((Math.floor(t * 5) % 4) + 4) % 4;
  if (state.frameIdx !== f) { state.frameIdx = f; map.updateImage('water', waterF[f]); map.updateImage('flood', floodF[f]); map.updateImage('modeled', modelF[f]); }
  // sky
  const rk = Math.round(rainK * 10) / 10;
  if (state.skyK !== rk) { state.skyK = rk; const mix = (a, b) => { const A = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), B = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16)); return 'rgb(' + A.map((x, i) => Math.round(lerp(x, B[i], rk))).join(',') + ')'; }; map.setSky({ ...SKY_DRY, 'sky-color': mix(PAL.blue, PAL.slate), 'horizon-color': mix(PAL.mist, PAL.fog), 'fog-color': mix(PAL.mist, PAL.steel) }); }
  // flashes: lightning when the rain starts, white pop on reroute
  state.flash = Math.max(t > tl.tRain + 0.35 && t < tl.tRain + 0.5 ? 0.9 : 0, t > tl.tRain + 0.62 && t < tl.tRain + 0.7 ? 0.6 : 0, rerouted ? Math.max(0, 1 - (t - tl.tReroute) / 0.3) * 0.5 : 0);
  // markers
  for (const m of state.markers) {
    if (m.kind === 'hz') { const ll = m.marker.getLngLat(); const near = t > T0 - 0.3 && t < T1 + 0.4 && hav([ll.lng, ll.lat], state.car.lngLat) < (PHONE ? 230 : 170); m.el.style.display = hazK > 0.5 && !near ? '' : 'none'; m.el.classList.toggle('avoided', m.avoid && rerouted); }
  }
  // HUD
  const driving = t >= T0 - 0.2 && t <= T1 + 0.3;
  document.body.classList.toggle('driving', driving);
  if (driving) maneuverAt(s, rerouted ? S : N); else $('#maneuver').classList.add('hidden');
  const remainL = Math.max(0, (rerouted ? S.L : N.L) - s), R = rerouted ? S : N;
  $('#st-km').textContent = fmtKm(remainL).replace(' km', '');
  $('#st-min').textContent = Math.round(R.duration_s * remainL / R.L / 60) + "'";
  const avoidedN = trip.groups.reduce((a, g) => a + g.list.length, 0);
  const passT = (tl.ev.find(e => e.type === 'pass') || { t: tl.tReroute }).t;
  const avNow = t >= passT ? avoidedN : 0; $('#st-av').textContent = avNow; $('#st-av').classList.toggle('bump', t >= passT && t < passT + 1.2);
  const realV = S.L / S.duration_s; $('#st-x').textContent = driving && v > 1 ? 'x' + Math.max(1, Math.round(v / realV)) : 'x1';
  chipState(rainK > 0.5);
  questTime(t, tl, false);
  dialogAt(t, tl);
  drawMinimap(t, s, rerouted, rerouted, hazK);
  // banner + cards
  const bn = $('#banner'); let bTxt = null, bCls = '';
  if (rerouted && t < tl.tReroute + 2.6) { bTxt = Math.floor((t - tl.tReroute) * 5) % 2 === 0 || t > tl.tReroute + 0.8 ? '¡RECALCULANDO!' : ''; bCls = 'red'; }
  else if (t >= tl.tRain && t < tl.tRain + 1.6) { bTxt = '¡LLUVIA!'; bCls = 'cyan'; }
  else if (driving && v / realV > 60 && t > T0 + 0.5) { bTxt = '» VIAJE RÁPIDO »'; bCls = ''; }
  if (bTxt === null) bn.classList.add('hidden'); else { bn.classList.remove('hidden'); bn.className = bCls; bn.textContent = bTxt; if (bTxt === '» VIAJE RÁPIDO »') { const sm = document.createElement('small'); sm.textContent = 'tiempo acelerado x' + Math.round(v / realV); bn.append(sm); } }
  cardAt(t, tl);
  map.triggerRepaint();
}

let cardKey = '';
function cardAt(t, tl) {
  const card = $('#card'); const { N, S, groups, hitsS } = state.trip;
  let key = '';
  if (t >= 0.15 && t < tl.T0 - 0.9) key = 'intro'; else if (t > tl.T1 + 1.1) key = 'outro';
  if (key === cardKey) return; cardKey = key;
  if (!key) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden'); card.replaceChildren();
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; card.append(e); return e; };
  if (key === 'intro') {
    card.className = 'rpg gold';
    el('div', 'k', 'NAVEGACIÓN 16-BIT · GUADALAJARA');
    el('h1', '', 'MISIÓN 01');
    el('h2', '', state.active.size ? 'LLEGAR SECO' : 'LLEGAR');
    el('p', 'route', `${state.nameA} → ${state.nameB}`);
    el('p', '', state.active.size ? 'Calles reales (OSM) · sitios inundables reales (IMEPLAN)' : 'Escenario seco');
    el('div', 'press', DEMO ? '▶ START' : '▶ PRESIONA JUGAR');
  } else {
    card.className = 'rpg gold';
    el('div', 'k', 'RESUMEN DE LA MISIÓN');
    el('h1', '', '¡CUMPLIDA!');
    const g = el('div', 'grid');
    const pair = (k, v, cls) => { const b = document.createElement('b'); b.textContent = k; const sp = document.createElement('span'); sp.innerHTML = ''; sp.append(...v); if (cls) sp.className = cls; g.append(b, sp); };
    const em = s => { const e = document.createElement('em'); e.textContent = s; return e; };
    const tx = s => document.createTextNode(s);
    pair('RUTA SEGURA', [em(fmtKm(S.L)), tx(' · ' + fmtMin(S.duration_s))]);
    if (state.trip.diverge != null) pair('RUTA NORMAL', [tx(fmtKm(N.L) + ' · ' + fmtMin(N.duration_s))], 'bad');
    if (groups.length) { const g0 = groups[0].main.hazard; pair('EVITASTE', [tx(describeHits(groups.flatMap(g => g.list))), document.createElement('br'), tx('incl. ' + short(place(g0), 34) + dp(g0))], 'ok'); }
    const seen = new Set(), cau = hitsS.filter(h => !seen.has(h.hazard.site) && seen.add(h.hazard.site));
    if (cau.length) pair('PRECAUCIÓN', [tx(cau.slice(0, 2).map(h => short(place(h.hazard), 26) + dp(h.hazard)).join(' · ') + (cau.length > 2 ? ` y ${cau.length - 2} más` : ''))]);
    el('p', '', 'Registros históricos IMEPLAN MUI 2026 · no es pronóstico');
    if (!DEMO) { const b = el('button', 'px-btn primary', '▶ OTRA VEZ'); b.style.marginTop = '8px'; b.addEventListener('click', () => play()); }
  }
}

// ---------- overview (interactive, not playing) ----------
function showOverview() {
  state.mode = 'overview'; document.body.classList.remove('driving');
  const { N, S } = state.trip, has = state.trip.diverge != null;
  map.jumpTo(overviewCam);
  document.body.classList.toggle('far', overviewCam.zoom < 13.2);
  state.car = { visible: true, lngLat: S.coords[0], heading: headingAt(S, 0, 0, 30), unitMeters: 40075016.686 * Math.cos(S.coords[0][1] * Math.PI / 180) / (512 * Math.pow(2, overviewCam.zoom)) * (PHONE ? 40 : 54) / 12 };
  routeVisual('r-normal', !has, 0, PAL.yellow); routeVisual('r-safe', has, 0, PAL.yellow);
  setPaint('r-ghost', 'line-opacity', has ? 1 : 0); setPaint('r-ghost-case', 'line-opacity', has ? 0.9 : 0);
  for (const { layer } of state.sets) { const on = state.active.has(layer.id) ? 1 : 0; setPaint('hz-' + layer.id + '-fill', 'fill-opacity', on * 0.95); setPaint('hz-' + layer.id + '-line', 'line-opacity', on); setPaint('hz-' + layer.id + '-lline', 'line-opacity', on); setPaint('hz-' + layer.id + '-lcase', 'line-opacity', on * 0.8); setPaint('hz-' + layer.id + '-pt', 'circle-opacity', on); setPaint('hz-' + layer.id + '-pt', 'circle-stroke-opacity', on); }
  for (const L of state.layers.filter(l => l.type === 'raster-tiles')) { setLayout('hz-' + L.id + '-raster', 'visibility', state.active.has(L.id) ? 'visible' : 'none'); setPaint('hz-' + L.id + '-raster', 'raster-opacity', state.active.has(L.id) ? 0.85 : 0); }
  for (const m of state.markers) if (m.kind === 'hz') { m.el.style.display = state.active.size ? '' : 'none'; m.el.classList.toggle('avoided', m.avoid); }
  state.rainK = state.active.size ? 0.6 : 0; state.flash = 0; state.bgc = state.rainK > 0.5 ? PAL.steel : PAL.mist; $('#map').style.background = state.bgc;
  map.setSky(state.active.size ? { ...SKY_DRY, 'sky-color': PAL.slate, 'horizon-color': PAL.fog, 'fog-color': PAL.steel } : SKY_DRY); state.skyK = null;
  chipState(state.active.size > 0); questTime(0, state.tl, true);
  $('#maneuver').classList.add('hidden'); $('#banner').classList.add('hidden'); $('#card').classList.add('hidden'); cardKey = '';
  const d = $('#dialog'); d.classList.remove('hidden', 'alert');
  $('#dialog-title').textContent = 'MISIÓN 01';
  const g = state.trip.groups[0];
  $('#dialog-text').replaceChildren(document.createTextNode(has ? `Con lluvia, la ruta normal cruza ${/desnivel/i.test(place(g.main.hazard)) ? '' : KIND_NOUN[g.main.hazard.kind] + ' '}${short(place(g.main.hazard), 44)}${dp(g.main.hazard)}. La ruta dorada lo esquiva. ` : state.active.size ? 'No encontré un desvío que evite los registros de esta ruta. ' : 'Escenario seco: vamos por la ruta más rápida. '), Object.assign(document.createElement('strong'), { textContent: PHONE ? 'Abre MISIÓN y presiona JUGAR.' : 'Presiona ▶ JUGAR MISIÓN.' }));
  $('#dialog-src').textContent = 'Cambia el clima o el destino en el registro de misión.';
  const s0 = 0; $('#st-km').textContent = fmtKm(S.L).replace(' km', ''); $('#st-min').textContent = Math.round(S.duration_s / 60) + "'"; $('#st-av').textContent = state.trip.groups.reduce((a, g) => a + g.list.length, 0); $('#st-x').textContent = 'x1';
  drawMinimap(0, s0, has, has, state.active.size ? 1 : 0);
  map.triggerRepaint();
  if (!CAPTURE) idleLoop();
}

// ---------- playback ----------
let raf = 0;
function play() {
  if (!state.trip) return;
  cancelAnimationFrame(raf); state.playing = true; state.mode = 'play'; $('#quest').classList.remove('open');
  map.stop(); if (!DEMO) for (const h of ['dragPan', 'scrollZoom', 'dragRotate', 'touchZoomRotate', 'doubleClickZoom', 'keyboard']) map[h].disable();
  const t0 = performance.now();
  const step = now => {
    const t = Math.max(0, (now - t0) / 1000);
    const p0 = performance.now(); applyTime(Math.min(t, DUR)); const pm = performance.now() - p0; state.prof = { n: (state.prof?.n || 0) + 1, ms: (state.prof?.ms || 0) + pm, max: Math.max(state.prof?.max || 0, pm) };
    if (t < DUR) raf = requestAnimationFrame(step);
    else { state.playing = false; if (!DEMO) { for (const h of ['dragPan', 'scrollZoom', 'dragRotate', 'touchZoomRotate', 'doubleClickZoom', 'keyboard']) map[h].enable(); } }
  };
  raf = requestAnimationFrame(step);
}
function stopPlay() { cancelAnimationFrame(raf); state.playing = false; }

// ---------- trip computation ----------
const sameLL = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
const activeHazards = () => state.hazards.filter(h => state.active.has(h.layerId));
const alertLayer = id => { const L = state.layers.find(l => l.id === id); return !!L && L.kind !== 'water'; };
// Navigation policy (nav-pixel): recorded critical zones and flooded underpasses (and modeled depth >= 30 cm) are
// blocked via `avoid`; every other active hazard layer is a soft penalty through the router's own `hazardIds`.
const SEVERE = h => h.kind === 'critica' || h.kind === 'desnivel' || (h.kind === 'modelado' && +(h.props.depth_m ?? h.props.max_depth_m ?? 0) >= 0.3);
async function computeTrip(progress = () => {}) {
  const hz = activeHazards();
  const real = state.router && !/stub/.test(state.router.engine || '');
  const isDefault = sameLL(state.A, DEFAULT.A) && sameLL(state.B, DEFAULT.B);
  const polyActive = [...state.active].filter(id => state.sets.some(s => s.layer.id === id));
  let normal, safe, meta = {};
  if (real && Q.get('baked') !== '1') {
    try {
      progress(0.3, 'CONSULTANDO ROUTER…');
      if (hz.length) {
        const severe = hz.filter(h => SEVERE(h) && h.rings);
        const opts = { hazardIds: [...state.active], compare: true };
        if (severe.length) opts.avoid = { type: 'FeatureCollection', features: severe.map(h => ({ type: 'Feature', properties: { id: h.id, kind: h.kind }, geometry: { type: 'Polygon', coordinates: h.rings } })) };
        const c = await state.router.route(state.A, state.B, opts);
        normal = c.normal || c; safe = c.safe || c;
        meta = { engineLabel: state.router.engine, comparison: c.comparison, routerAvoided: (safe.avoided || []).length, fallback: !!safe.blocked_fallback, warnings: safe.warnings || [],
          crossedN: normal.crossed || null, crossedS: safe.crossed || null, bridgesS: (safe.exposure || []).filter(e => e.on_bridge && e.layer !== 'avoid') };
      } else { normal = safe = await state.router.route(state.A, state.B, {}); meta = { engineLabel: state.router.engine }; }
    } catch (e) { console.warn('router failed, falling back', e); normal = null; }
  }
  if (!normal) {
    const bakedSet = new Set(state.baked ? state.baked.hazardLayers : []);
    const same = polyActive.length === bakedSet.size && polyActive.every(id => bakedSet.has(id));
    if (state.baked && isDefault && (same || !hz.length)) {
      normal = state.baked.normal; safe = hz.length ? state.baked.safe : normal;
      meta = { baked: true, engineLabel: (state.baked.engine || 'ruta precalculada') + ' · copia local' };
    } else if (state.router) {
      progress(0.2, 'CONSULTANDO OSRM…');
      normal = await state.router.route(state.A, state.B, {});
      if (hz.length) { progress(0.35, 'BUSCANDO RUTA SECA…'); safe = await detour(state.A, state.B, hz, pacedOSRM, { maxIter: 3, offsets: [800, 1600], log: m => progress(0.6, m) }); }
      else safe = normal;
      meta = { engineLabel: 'OSRM (demo) + desvío en el navegador' };
    } else throw new Error('sin router');
  }
  const trip = analyze(normal, safe, hz, meta);
  state.trip = trip; state.tl = buildTimeline(trip);
}
let osrmCalls = 0;
async function pacedOSRM(c) { if (osrmCalls++) await new Promise(r => setTimeout(r, 1050)); return osrmVia(c); }

async function refreshTrip(msg) {
  stopPlay();
  $('#loading').classList.remove('hidden'); loading.set(0.15, msg || 'CALCULANDO RUTA…');
  try { await computeTrip((k, m) => loading.set(k, m && m.length < 40 ? m : undefined)); }
  catch (e) { console.error(e); fail('NO SE PUDO CALCULAR LA RUTA'); setTimeout(() => loading.done(), 2500); return; }
  ensureRouteLayers();
  map.getSource('r-normal').setData(line(state.trip.N.coords));
  map.getSource('r-safe').setData(line(state.trip.S.coords));
  const t = state.trip; map.getSource('r-ghost').setData(line(t.divergeN != null ? sliceRoute(t.N, Math.max(0, t.divergeN - 10), t.rejoinN ?? t.N.L) : [[0, 0], [0, 0.0001]]));
  computeOverview(); buildMarkers(); buildMinimap(); chips(); questStatic();
  loading.done();
  prefetchTiles();
}
// Warm the HTTP cache with the vector tiles along both routes so the drive does not stall on the network.
let prefetched = new Set();
async function prefetchTiles() {
  const src = map.getSource('ofm'), tpl = src && src.tiles && src.tiles[0]; if (!tpl || !state.trip) return;
  const want = [];
  const tile = (z, lon, lat) => { const n = 2 ** z, la = lat * Math.PI / 180; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n)]; };
  for (const R of [state.trip.S, state.trip.N]) for (let i = 0; i < R.pts.length; i += 60) for (const z of [14, 13, 12]) {
    const [x, y] = tile(z, ...R.pts[i].p); const r = z === 14 ? 1 : 0;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) { const k = `${z}/${x + dx}/${y + dy}`; if (!prefetched.has(k)) { prefetched.add(k); want.push(tpl.replace('{z}', z).replace('{x}', x + dx).replace('{y}', y + dy)); } }
  }
  for (let i = 0; i < want.length; i += 6) await Promise.all(want.slice(i, i + 6).map(u => fetch(u, { priority: 'low' }).then(r => r.arrayBuffer()).catch(() => null)));
}
// gentle idle animation (water tiles + rain) while the overview is shown
let idleTimer = 0;
function idleLoop() {
  clearTimeout(idleTimer); if (state.mode !== 'overview' || !state.active.size) return;
  const t = performance.now() / 1000; state.t = t;
  const f = ((Math.floor(t * 5) % 4) + 4) % 4;
  if (state.frameIdx !== f) { state.frameIdx = f; map.updateImage('water', waterF[f]); map.updateImage('flood', floodF[f]); map.updateImage('modeled', modelF[f]); }
  map.triggerRepaint(); idleTimer = setTimeout(idleLoop, 100);
}
async function setScenario(set) { $('#loading').classList.remove('hidden'); loading.set(0.1, 'CARGANDO CAPA…'); await ensureLoaded([...set]); state.active = new Set([...set].filter(id => state.sets.some(s => s.layer.id === id) || (state.layers.find(l => l.id === id) || {}).type === 'raster-tiles')); await refreshTrip('CAMBIANDO CLIMA…'); showOverview(); }

// ---------- data loading ----------
const fetchJSON = async (u, opt) => { const r = await fetch(u, { cache: 'no-cache', ...opt }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };
const absURL = u => /^https?:/.test(u) ? u : u.startsWith('/') ? location.origin + u : location.origin + SHARED + '/hazard/' + u; // keeps {z}/{x}/{y} unescaped
// GeoJSON layers are fetched lazily: the default scenario + context water at start, others when their chip is switched on.
async function ensureLoaded(ids) {
  const todo = state.layers.filter(L => ids.includes(L.id) && (L.type || 'geojson') === 'geojson' && L.url && !state.sets.some(s => s.layer.id === L.id) && !L._failed);
  await Promise.all(todo.map(async L => {
    try { const fc = await fetchJSON(absURL(L.url)); if (fc && Array.isArray(fc.features)) state.sets.push({ layer: L, fc }); else L._failed = true; }
    catch (e) { console.warn('hazard layer unavailable', L.id, e.message); L._failed = true; }
  }));
  if (!todo.length) return;
  state.sets.sort((a, b) => state.layers.indexOf(a.layer) - state.layers.indexOf(b.layer));
  state.hazards = buildHazards(state.sets);
  if (map && map.getLayer('r-ghost-case')) addHazardLayers();
}
async function loadData() {
  loading.set(0.2, 'LEYENDO CAPAS…');
  try { const idx = await fetchJSON(SHARED + '/hazard/index.json'); state.layers = Array.isArray(idx.layers) ? idx.layers.filter(l => l && l.id) : []; } catch (e) { console.warn('hazard index missing', e); state.layers = []; }
  // default scenario: the IMEPLAN inventory (or every observed layer if it is missing); ?layers=a,b or ?layers=all override
  const imeplan = state.layers.find(l => l.id === 'observed-imeplan-2026');
  let act = imeplan ? [imeplan.id] : state.layers.filter(l => l.kind === 'observed').map(l => l.id);
  if (Q.get('layers') === 'all') act = state.layers.filter(l => alertLayer(l.id)).map(l => l.id);
  else if (Q.get('layers')) act = Q.get('layers').split(',').filter(id => alertLayer(id));
  if (Q.get('dry') === '1') act = [];
  await ensureLoaded([...act, ...state.layers.filter(l => l.kind === 'water').map(l => l.id)]);
  state.active = new Set(act.filter(id => state.sets.some(s => s.layer.id === id) || (state.layers.find(l => l.id === id) || {}).type === 'raster-tiles'));
  loading.set(0.45, 'DESPERTANDO AL ROUTER…');
  try { state.routerStatus = await fetchJSON(SHARED + '/status/router.json'); } catch { state.routerStatus = null; }
  try { const mod = await import(SHARED + '/router/router.js'); state.router = await mod.loadRouter(); } catch (e) { console.warn('router unavailable', e); state.router = null; }
  try { state.baked = await fetchJSON('./demo-route.json'); } catch { state.baked = null; }
}

// ---------- boot ----------
const ready = (async () => {
  loading.set(0.08, 'CARGANDO MUNDO…');
  const dem = await terrainDEM();
  map = new maplibregl.Map({ container: 'map', style: style(dem), center: DEFAULT.A, zoom: 12, pitch: 40, bearing: -14, pixelRatio: 1 / PX, maxPitch: 72, attributionControl: false, fadeDuration: 0, interactive: !DEMO, canvasContextAttributes: { antialias: false, preserveDrawingBuffer: true } });
  window.cauceMap = map;
  for (const [name, img] of [['water', waterF[0]], ['flood', floodF[0]], ['modeled', modelF[0]], ['tree', treeTile()], ['grass', grassTile()], ['field', fieldTile()], ['plaza', plazaTile()]]) map.addImage(name, img, { pixelRatio: 1 / PX });
  await new Promise(r => map.once('load', r));
  map.addLayer(voxelCarLayer(() => state.car));
  if (Q.get('nofx') !== '1') try { map.addLayer(pixelLayer(() => ({ time: state.t, rain: state.rainK, flash: state.flash }))); } catch (e) { console.warn('pixel FX unavailable', e); }
  loading.set(0.15);
  await loadData();
  ensureRouteLayers(); addHazardLayers();
  if (Q.get('off')) for (const pre of Q.get('off').split(',')) for (const l of map.getStyle().layers) if (l.id.startsWith(pre)) map.removeLayer(l.id); // debug: ?off=building,hillshade
  await refreshTrip('TRAZANDO RUTAS…');
  await document.fonts.ready;
  if (Q.get('t') != null) { applyTime(+Q.get('t')); }
  else if (DEMO) applyTime(0);
  else showOverview();
  await new Promise(r => { map.once('idle', r); setTimeout(r, 8000); });
  loading.done();
  window.__cauceReady = true;
})().catch(e => { console.error(e); fail('ERROR: ' + (e.message || e)); });

window.__cauceDemo = {
  duration_s: DUR,
  async seek(t) {
    await ready; stopPlay(); document.body.classList.add('capture');
    applyTime(clamp(+t, 0, DUR));
    await new Promise(r => { let done = false; const fin = () => { if (!done) { done = true; r(); } }; if (map.loaded() && map.areTilesLoaded()) requestAnimationFrame(() => map.loaded() && map.areTilesLoaded() ? fin() : map.once('idle', fin)); else map.once('idle', fin); setTimeout(fin, 6000); });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return state.t;
  },
  ready,
  state: () => ({ t: state.t, prof: state.prof && { avg: +(state.prof.ms / state.prof.n).toFixed(2), max: +state.prof.max.toFixed(1), n: state.prof.n }, engine: state.router && state.router.engine, layers: [...state.active], N: state.trip && state.trip.N.L, S: state.trip && state.trip.S.L, groups: state.trip && state.trip.groups.length, tl: state.tl && { T0: state.tl.T0, T1: state.tl.T1, tRain: state.tl.tRain, tReroute: state.tl.tReroute, ev: state.tl.ev.map(e => ({ type: e.type, t: +e.t.toFixed(2), s: Math.round(e.s) })) } })
};
if (DEMO && !CAPTURE && Q.get('t') == null && Q.get('autoplay') !== '0') ready.then(() => setTimeout(play, 400));

// ---------- interactive controls ----------
$('#play').addEventListener('click', () => play());
$('#quest-open').addEventListener('click', () => $('#quest').classList.add('open'));
$('#quest-close').addEventListener('click', () => $('#quest').classList.remove('open'));
$('#reset').addEventListener('click', async () => { Object.assign(state, { A: DEFAULT.A, B: DEFAULT.B, nameA: DEFAULT.nameA, nameB: DEFAULT.nameB }); await refreshTrip(); showOverview(); });
for (const which of ['a', 'b']) $('#pick-' + which).addEventListener('click', () => {
  state.pick = which; stopPlay(); $('#quest').classList.remove('open');
  const h = $('#hint'); h.classList.remove('hidden'); h.textContent = which === 'b' ? 'Toca el mapa para elegir el DESTINO' : 'Toca el mapa para elegir el INICIO';
});
setTimeout(() => ready.then(() => map && map.on('click', async e => {
  if (!state.pick) return;
  const p = [+e.lngLat.lng.toFixed(5), +e.lngLat.lat.toFixed(5)], which = state.pick; state.pick = null; $('#hint').classList.add('hidden');
  const label = `${p[1].toFixed(3)}, ${p[0].toFixed(3)}`;
  if (which === 'b') { state.B = p; state.nameB = 'Punto ' + label; } else { state.A = p; state.nameA = 'Punto ' + label; }
  await refreshTrip('CALCULANDO RUTA…'); showOverview();
})), 0);
