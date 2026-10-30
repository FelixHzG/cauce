// cauce. · sim-hidro viewer — 5 m rain-on-grid shallow-water results (exploratory model, not a forecast)
const BASE = '/labs/shared/hazard/modeled/sim-hidro/';
const OBS_URL = '/labs/shared/hazard/observed-imeplan-2026.geojson';
const Q = new URLSearchParams(location.search);
const DEMO = Q.has('demo');
const $ = s => document.querySelector(s);
const SCEN_ORDER = ['T2', 'T10', 'T100'];
const FRAME_S = 300;

const state = {scen: Q.get('tr') ? 'T' + Q.get('tr') : 'T10', mode: Q.get('capa') || 'anim', t: 0, playing: false, obs: true};
let stats = null, map = null;
const framesMeta = {};
const imgCache = new Map();

// ------------------------------------------------------------------ legends / colours (match post-web.mjs)
const DEPTH_LEG = [['5–15 cm', '#7dd3fc', .3], ['15–30 cm', '#38bdf8', .8], ['30–60 cm', '#1d8fe0', .88], ['60 cm–1 m', '#2563eb', .92], ['1–2 m', '#4f46e5', .95], ['> 2 m', '#7e22ce', .96]];
const HAZ_LEG = [['bajo (< 30 cm, h·v < 0.3)', '#ffe28a', .6], ['vehículos pequeños', '#ffad42', .82], ['personas y vehículos', '#ec5a2f', .9], ['extremo', '#9c0f45', .94]];
const ARR_RAMP = 'linear-gradient(90deg,#fde725,#a0da39 8%,#4ac16d 17%,#1fa187 25%,#277f8e 33%,#365c8d 50%,#46327e 67%,#440154)';

function legendHTML(mode) {
  if (mode === 'arrival') return `<div class="ramp" style="background:${ARR_RAMP}"></div><div class="ends"><span>0 min</span><span>60</span><span>120</span><span>180 min</span></div><div>primera vez con ≥ 15 cm</div>`;
  const L = mode === 'hazard' ? HAZ_LEG : DEPTH_LEG;
  const head = mode === 'hazard' ? '<div>máx. de profundidad × velocidad (ARR 2019)</div>' : mode === 'anim' ? '<div>profundidad en el instante</div>' : '<div>profundidad máxima en 3 h</div>';
  const L2 = mode === 'anim' ? L.slice(1).map((r, i) => (i === 0 ? ['10–30 cm', r[1], r[2]] : r)) : L;
  return head + L2.map(([t, c, a]) => `<div class="row"><i style="background:${c};opacity:${a}"></i>${t}</div>`).join('');
}

// ------------------------------------------------------------------ basemap style (OpenFreeMap vector + Terrarium hillshade)
function buildStyle() {
  const roadW = (base) => ['interpolate', ['exponential', 1.5], ['zoom'], 10, base * .35, 14, base * 1.6, 17, base * 6];
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: {type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://openfreemap.org">OpenFreeMap</a>'},
      dem: {type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 13, attribution: 'Relieve: AWS Terrarium'},
    },
    layers: [
      {id: 'bg', type: 'background', paint: {'background-color': '#0a1824'}},
      {id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', paint: {'fill-color': '#0d2229', 'fill-opacity': .7}},
      {id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: {'fill-color': '#0e262a', 'fill-opacity': .8}},
      {id: 'residential', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'industrial', 'retail']]], paint: {'fill-color': '#122330', 'fill-opacity': .9}},
      {id: 'hill', type: 'hillshade', source: 'dem', paint: {'hillshade-exaggeration': .55, 'hillshade-shadow-color': '#02070c', 'hillshade-highlight-color': '#2a4a5c', 'hillshade-accent-color': '#0a1824'}},
      {id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: {'fill-color': '#0b3550', 'fill-opacity': .9}},
      {id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: {'line-color': '#145377', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, .5, 15, 2]}},
      {id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13, paint: {'fill-color': '#1a2d3b', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, .85], 'fill-outline-color': '#22394a'}},
      {id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary']]], paint: {'line-color': '#1f3546', 'line-width': roadW(.8)}},
      {id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'trunk', 'motorway']]], paint: {'line-color': '#2d4b60', 'line-width': roadW(1.6)}},
    ],
  };
}
function addLabelLayers() {
  const font = ['Noto Sans Regular'];
  map.addLayer({id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14, filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'trunk', 'motorway', 'tertiary']]], layout: {'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 11}, paint: {'text-color': '#9fb9c8', 'text-halo-color': '#07121c', 'text-halo-width': 1.4}});
  map.addLayer({id: 'place-label', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb', 'neighbourhood']]], layout: {'text-field': ['coalesce', ['get', 'name:es'], ['get', 'name']], 'text-font': font, 'text-size': ['match', ['get', 'class'], 'city', 15, 'town', 13, 11.5], 'text-letter-spacing': .04}, minzoom: 9, paint: {'text-color': ['match', ['get', 'class'], 'city', '#e4f1f8', '#b9d1de'], 'text-halo-color': '#07121c', 'text-halo-width': 1.6}});
}

// ------------------------------------------------------------------ model layers
function tileURL(s, kind) { return location.origin + BASE + `${s}/tiles/${kind}/{z}/{x}/{y}.png`; }
function addModelLayers() {
  const before = 'road-label';
  const bounds = stats?.domain?.bboxLonLat;
  for (const s of SCEN_ORDER) {
    if (!stats.scenarios[s]?.available) continue;
    for (const [kind, maxz] of [['depth', 15], ['hazard', 15], ['arrival', 14]]) {
      map.addSource(`${kind}-${s}`, {type: 'raster', tiles: [tileURL(s, kind)], tileSize: 256, minzoom: 10, maxzoom: maxz, ...(bounds ? {bounds} : {}), attribution: 'Modelo: cauce. sim-hidro (exploratorio)'});
      map.addLayer({id: `${kind}-${s}`, type: 'raster', source: `${kind}-${s}`, layout: {visibility: 'none'}, paint: {'raster-opacity': .95, 'raster-resampling': kind === 'arrival' ? 'linear' : 'nearest', 'raster-fade-duration': 0}}, before);
    }
  }
  const fm = framesMeta[state.scen];
  const coords = fm ? fm.coordinates : [[0, 0], [1, 0], [1, -1], [0, -1]];
  for (const k of ['a', 'b']) {
    map.addSource(`fr-${k}`, {type: 'image', url: blankPNG, coordinates: coords});
    map.addLayer({id: `fr-${k}`, type: 'raster', source: `fr-${k}`, layout: {visibility: 'none'}, paint: {'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-resampling': 'linear'}}, before);
  }
}
const blankPNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
async function addObserved() {
  try {
    const gj = await (await fetch(OBS_URL)).json();
    map.addSource('obs', {type: 'geojson', data: gj, attribution: 'Observado: IMEPLAN MUI 2026'});
    map.addLayer({id: 'obs-fill', type: 'fill', source: 'obs', filter: ['==', ['geometry-type'], 'Polygon'], paint: {'fill-color': '#ffb04a', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, .05, 15, .12]}}, 'road-label');
    map.addLayer({id: 'obs-line', type: 'line', source: 'obs', filter: ['==', ['geometry-type'], 'Polygon'], paint: {'line-color': '#ffb04a', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, .8, 15, 2.2], 'line-dasharray': [2, 1.4], 'line-opacity': .95}}, 'road-label');
    map.addLayer({id: 'obs-pt', type: 'circle', source: 'obs', filter: ['==', ['geometry-type'], 'Point'], paint: {'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 15, 5], 'circle-color': '#07121c', 'circle-stroke-color': '#ffb04a', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 2]}}, 'road-label');
    map.on('click', 'obs-line', e => {
      const p = e.features[0].properties;
      const rep = p['Rango de alturas de inundación'] || p['Altura máxima reportada'] || '—';
      new maplibregl.Popup({closeButton: false}).setLngLat(e.lngLat).setHTML(`<div class="popup"><b>${p.name}</b><br>${p.category === 'Sitios Inundales' ? 'Sitio inundable' : 'Zona crítica'} · IMEPLAN 2026<br>altura reportada: ${rep} cm</div>`).addTo(map);
    });
  } catch (e) { console.warn('observed layer unavailable', e); }
}

// ------------------------------------------------------------------ frames (time animation)
function frameURL(s, i) { const f = framesMeta[s]?.frames[i]; return f ? location.origin + BASE + `${s}/${f.url}` : null; }
function preload(url) {
  if (!url) return Promise.resolve();
  if (!imgCache.has(url)) imgCache.set(url, new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; }));
  return imgCache.get(url);
}
let shownA = null, shownB = null;
async function setFrames(t, wait = false) {
  const fm = framesMeta[state.scen]; if (!fm) return;
  const pos = t / FRAME_S;               // frame k (0-based) holds t = (k+1)*300 s
  const i0 = Math.floor(pos) - 1, f = pos - Math.floor(pos);
  const uA = i0 >= 0 ? frameURL(state.scen, Math.min(i0, fm.frames.length - 1)) : null;
  const uB = frameURL(state.scen, Math.min(i0 + 1, fm.frames.length - 1));
  const jobs = [];
  if (uA !== shownA) { shownA = uA; jobs.push(preload(uA).then(() => map.getSource('fr-a').updateImage({url: uA || blankPNG, coordinates: fm.coordinates}))); }
  if (uB !== shownB) { shownB = uB; jobs.push(preload(uB).then(() => map.getSource('fr-b').updateImage({url: uB || blankPNG, coordinates: fm.coordinates}))); }
  map.setPaintProperty('fr-a', 'raster-opacity', uA ? 1 : 0);
  map.setPaintProperty('fr-b', 'raster-opacity', uB ? (uA ? f : f) : 0);
  if (wait) await Promise.all(jobs);
  // warm the cache a few frames ahead
  for (let k = 2; k < 5; k++) preload(frameURL(state.scen, i0 + k));
}

// ------------------------------------------------------------------ UI state
function applyLayers() {
  for (const s of SCEN_ORDER) for (const kind of ['depth', 'hazard', 'arrival']) {
    if (!map.getLayer(`${kind}-${s}`)) continue;
    const on = state.scen === s && state.mode === kind;
    map.setLayoutProperty(`${kind}-${s}`, 'visibility', on ? 'visible' : 'none');
  }
  for (const k of ['a', 'b']) map.setLayoutProperty(`fr-${k}`, 'visibility', state.mode === 'anim' ? 'visible' : 'none');
  for (const id of ['obs-fill', 'obs-line', 'obs-pt']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', state.obs ? 'visible' : 'none');
  $('#legend').innerHTML = legendHTML(state.mode);
  document.querySelectorAll('#mode-seg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === state.mode)));
  document.querySelectorAll('#scen-chips .chip').forEach(b => b.setAttribute('aria-checked', String(b.dataset.s === state.scen)));
  $('#timeline').style.opacity = state.mode === 'anim' ? 1 : .55;
  renderInfo(); drawTimeline();
}
function fmtClock(t) { const m = Math.floor(t / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }
function areaAt(t) {
  const fm = framesMeta[state.scen]; if (!fm) return 0;
  const pos = t / FRAME_S, i0 = Math.floor(pos) - 1, f = pos - Math.floor(pos);
  const a0 = i0 >= 0 ? fm.frames[Math.min(i0, fm.frames.length - 1)].area_ge_0_15_km2 : 0;
  const a1 = fm.frames[Math.min(i0 + 1, fm.frames.length - 1)].area_ge_0_15_km2;
  return a0 + (a1 - a0) * f;
}
async function setTime(t, wait = false) {
  state.t = Math.max(0, Math.min(10800, t));
  $('#clock').textContent = fmtClock(state.t);
  $('#slider').value = state.t;
  $('#tl-area').textContent = `${areaAt(state.t).toFixed(1)} km² ≥ 15 cm`;
  const ph = document.getElementById('tl-playhead'); if (ph) ph.setAttribute('x', String(state.t / 10800 * 1000 - 1));
  if (state.mode === 'anim') await setFrames(state.t, wait);
}
function drawTimeline() {
  const svg = $('#tl-svg'); const s = stats?.scenarios[state.scen]; const fm = framesMeta[state.scen];
  svg.setAttribute('viewBox', '0 0 1000 54');
  if (!s || !fm) { svg.innerHTML = ''; return; }
  const H = 54, maxI = 200, bars = s.storm.mmh.map((v, k) => { const x = k * 600 / 10800 * 1000, w = 600 / 10800 * 1000 - 2, h = v / maxI * (H - 6); return `<rect x="${x + 1}" y="${H - h}" width="${w}" height="${h}" fill="#50d2ff" opacity=".28"/><text x="${x + w / 2 + 1}" y="${H - h - 3}" fill="#8aa6b6" font-size="9" text-anchor="middle" font-family="IBM Plex Mono">${Math.round(v)}</text>`; }).join('');
  const amax = Math.max(1, ...SCEN_ORDER.filter(k => framesMeta[k]).flatMap(k => framesMeta[k].frames.map(f => f.area_ge_0_15_km2)));
  const pts = [[0, H], ...fm.frames.map(f => [f.t_s / 10800 * 1000, H - f.area_ge_0_15_km2 / amax * (H - 4)])];
  const path = 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(',')).join('L');
  const ticks = [0, 30, 60, 90, 120, 150, 180].map(m => `<line x1="${m / 180 * 1000}" x2="${m / 180 * 1000}" y1="0" y2="${H}" stroke="rgba(138,166,182,.15)"/>`).join('');
  svg.innerHTML = ticks + bars + `<path d="${path}L1000,${H}Z" fill="rgba(80,210,255,.10)"/><path d="${path}" fill="none" stroke="#50d2ff" stroke-width="1.6" vector-effect="non-scaling-stroke"/><rect id="tl-playhead" x="${state.t / 10800 * 1000 - 1}" y="0" width="2" height="${H}" fill="#e4f1f8"/>`;
}
const fmt1 = v => (v === undefined || v === null ? '—' : v.toLocaleString('es-MX', {maximumFractionDigits: 1}));
function renderInfo() {
  const s = stats?.scenarios[state.scen]; if (!s) return;
  $('#info-scen').textContent = `Tr ${s.returnPeriod} años`;
  const A = s.areasKm2 || {}, V = s.validation || {};
  const k = (v, u, l) => `<div class="kpi"><b>${v}<small style="display:inline;font-size:12px"> ${u}</small></b><small>${l}</small></div>`;
  $('#kpis').innerHTML = k(s.storm.depthMm, 'mm', `lluvia en 60 min (pico ${Math.round(Math.max(...s.storm.mmh))} mm/h)`) +
    k(fmt1(A.ge_0_15m), 'km²', 'con ≥ 15 cm en algún momento') + k(fmt1(A.ge_0_3m), 'km²', 'con ≥ 30 cm') + k(fmt1(A.ge_0_6m), 'km²', 'con ≥ 60 cm') +
    k(s.runtimeMin ?? '—', 'min', `cómputo GPU (${s.steps?.toLocaleString('es-MX') ?? '—'} pasos)`) + k(s.massErrorPct ?? '—', '%', 'error de balance de masa');
  const g = V.groups?.sitiosInundables_polygons, z = V.groups?.points_r25m;
  if (!g) { $('#valid').innerHTML = '<span class="vnum">validación pendiente</span>'; return; }
  const row = (label, o, r) => `<div class="vrow"><span>${label}</span><span class="vnum"><b>${Math.round(o * 100)}%</b> vs ${Math.round(r * 100)}% azar</span><div class="vbar"><i class="o" style="width:${o * 100}%"></i><i class="r" style="width:${r * 100}%"></i></div></div>`;
  $('#valid').innerHTML = row(`Área de los ${g.nObserved} sitios inundables con ≥ 15 cm`, g.meanWetFraction015Observed, g.meanWetFraction015Random) +
    row('Sitios con ≥ 30 cm en algún punto', g.byThreshold['0.3'].hitRateObserved, g.byThreshold['0.3'].hitRateRandom) +
    (z ? row('Puntos IMEPLAN con ≥ 60 cm a ≤ 25 m', z.byThreshold['0.6'].hitRateObserved, z.byThreshold['0.6'].hitRateRandom) : '') +
    `<span class="vnum">naranja: lugares observados · gris: las mismas formas en sitios urbanos al azar. Coincidir no valida las profundidades.</span>`;
}
function buildChips() {
  $('#scen-chips').innerHTML = SCEN_ORDER.map(s => { const sc = stats.scenarios[s]; return `<button class="chip" data-s="${s}" role="radio" ${sc?.available ? '' : 'disabled'}><b>Tr ${s.slice(1)}</b><small>${sc?.storm ? sc.storm.depthMm + ' mm' : 'en cálculo'}</small></button>`; }).join('');
  document.querySelectorAll('#scen-chips .chip').forEach(b => b.onclick = () => { setScenario(b.dataset.s); });
  document.querySelectorAll('#mode-seg button').forEach(b => b.onclick = () => { state.mode = b.dataset.mode; applyLayers(); setTime(state.t); });
  $('#obs-toggle').onchange = e => { state.obs = e.target.checked; applyLayers(); };
  $('#slider').oninput = e => { stop(); setTime(+e.target.value); if (state.mode !== 'anim') { state.mode = 'anim'; applyLayers(); setTime(state.t); } };
  $('#play').onclick = () => (state.playing ? stop() : play());
}
async function setScenario(s, wait = false) {
  if (!stats.scenarios[s]?.available) return;
  state.scen = s; shownA = shownB = null;
  $('#scen-hint').textContent = stats.scenarios[s].label || '';
  await loadFrames(s);
  applyLayers(); await setTime(state.t, wait);
}
async function loadFrames(s) {
  if (framesMeta[s] || !stats.scenarios[s]?.available) return;
  try { framesMeta[s] = await (await fetch(BASE + `${s}/frames.json`)).json(); } catch { framesMeta[s] = null; }
}
let raf = 0, playT0 = 0, playFrom = 0;
function play() {
  state.playing = true; $('#play-icon').setAttribute('d', 'M7 5h4v14H7zM13 5h4v14h-4z');
  if (state.mode !== 'anim') { state.mode = 'anim'; applyLayers(); }
  if (state.t >= 10790) state.t = 0;
  playT0 = performance.now(); playFrom = state.t;
  const loop = () => { if (!state.playing) return; const t = playFrom + (performance.now() - playT0) / 1000 * 360; setTime(t); if (t < 10800) raf = requestAnimationFrame(loop); else stop(); };
  raf = requestAnimationFrame(loop);
}
function stop() { state.playing = false; cancelAnimationFrame(raf); $('#play-icon').setAttribute('d', 'M8 5v14l11-7z'); }

// ------------------------------------------------------------------ demo (filming): deterministic timeline
const DEMO_DUR = 26;
const HOME = {center: [-103.355, 20.655], zoom: 10.55, pitch: 0, bearing: 0};
let demoSpot = {center: [-103.392, 20.674], zoom: 14.2};
const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const lerp = (a, b, f) => a + (b - a) * f;
function cam(a, b, f) { return {center: [lerp(a.center[0], b.center[0], f), lerp(a.center[1], b.center[1], f)], zoom: lerp(a.zoom, b.zoom, f), pitch: lerp(a.pitch ?? 0, b.pitch ?? 0, f), bearing: lerp(a.bearing ?? 0, b.bearing ?? 0, f)}; }
function demoState(t) {
  const mid = {center: [-103.36, 20.665], zoom: 12.1, pitch: 38, bearing: -12};
  const spot = {...demoSpot, pitch: 50, bearing: -28};
  const spot2 = {...demoSpot, zoom: demoSpot.zoom + .7, pitch: 55, bearing: -40};
  const T10 = stats.scenarios.T10?.available ? 'T10' : SCEN_ORDER.find(s => stats.scenarios[s]?.available);
  const T100 = stats.scenarios.T100?.available ? 'T100' : T10;
  if (t < 3) return {scen: T10, mode: 'anim', simT: 0, cam: HOME, card: ['tormenta de diseño · Tr ' + T10.slice(1) + ' años', `${stats.scenarios[T10].storm.depthMm} mm en una hora`, 'Guadalajara · celdas de 5 m · aguas someras 2D'], obs: false};
  if (t < 15) { const f = (t - 3) / 12; return {scen: T10, mode: 'anim', simT: ease(f) * 7200, cam: cam(HOME, mid, ease(f)), obs: false}; }
  if (t < 20) { const f = (t - 15) / 5; return {scen: T100, mode: 'depth', simT: 7200, cam: cam(mid, spot, ease(f)), obs: true, card: f < .45 ? ['Tr ' + T100.slice(1) + ' años', 'profundidad máxima', 'naranja: sitios observados por IMEPLAN'] : null}; }
  const f = (t - 20) / 6;
  return {scen: T100, mode: 'hazard', simT: 7200, cam: cam(spot, spot2, ease(Math.min(1, f))), obs: true, card: f > .55 ? ['modelo exploratorio', 'no es un pronóstico', 'drenaje supuesto · terreno INEGI 5 m'] : null};
}
let lastCard = '';
async function renderDemo(t, wait) {
  const d = demoState(t);
  map.jumpTo(d.cam);
  if (d.scen !== state.scen) { state.scen = d.scen; shownA = shownB = null; await loadFrames(d.scen); }
  state.mode = d.mode; state.obs = d.obs; applyLayers();
  await setTime(d.simT, wait);
  const key = JSON.stringify(d.card || null);
  if (key !== lastCard) {
    lastCard = key;
    if (d.card) { $('#card-k').textContent = d.card[0]; $('#card-t').textContent = d.card[1]; $('#card-s').textContent = d.card[2]; $('#card').classList.remove('hidden'); } else $('#card').classList.add('hidden');
  }
}
function settle() { return new Promise(res => { const done = () => requestAnimationFrame(() => requestAnimationFrame(() => res(true))); if (map.loaded() && map.areTilesLoaded()) done(); else map.once('idle', done); }); }
let resolveReady; const ready = new Promise(r => (resolveReady = r));
window.__cauceDemo = {duration_s: DEMO_DUR, ready, async seek(t) { await ready; state.playing = false; await renderDemo(t, true); await settle(); return true; }};

// ------------------------------------------------------------------ boot
async function boot() {
  if (DEMO) document.body.classList.add('demo');
  stats = await (await fetch(BASE + 'stats.json')).json();
  if (stats.demoSpot) demoSpot = stats.demoSpot;
  if (!stats.scenarios[state.scen]?.available) state.scen = SCEN_ORDER.find(s => stats.scenarios[s]?.available);
  $('#cells').textContent = (stats.domain.cells / 1e6).toFixed(1) + ' M';
  if (stats.sewerMmh) $('#sewer-rate').textContent = stats.sewerMmh;
  await loadFrames(state.scen);
  map = new maplibregl.Map({container: 'map', style: buildStyle(), ...HOME, maxPitch: 70, hash: !DEMO, attributionControl: {compact: false, customAttribution: 'Terreno: INEGI MDT 5 m · Cobertura: ESA WorldCover 2021 · Edificios: Overture Maps · Lluvia: IMTA 2017 · cauce.'}, fadeDuration: 0, canvasContextAttributes: {preserveDrawingBuffer: true}});
  if (!DEMO) map.addControl(new maplibregl.NavigationControl({visualizePitch: true}), 'top-right');
  await new Promise(r => map.on('load', r));
  addLabelLayers(); addModelLayers(); await addObserved();
  buildChips();
  $('#scen-hint').textContent = stats.scenarios[state.scen].label || '';
  applyLayers();
  await setTime(Q.has('t') ? +Q.get('t') * 60 : (state.mode === 'anim' ? 3600 : 3600), true);
  $('#loading').classList.add('gone');
  resolveReady(true);
  if (DEMO && !Q.has('still')) {
    const t0 = performance.now();
    const loop = async () => { const t = (performance.now() - t0) / 1000; await renderDemo(Math.min(t, DEMO_DUR), false); if (t < DEMO_DUR) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
boot().catch(e => { console.error(e); $('#loading-text').textContent = 'No se pudo cargar la simulación: ' + e.message; });
