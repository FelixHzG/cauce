// cauce. relieve — viewer for the sim-relieve terrain indices (static 5 m analysis) and the "flat = floods?" test.
const BASE = '/labs/shared/hazard/modeled/sim-relieve';
const OBS_URL = '/labs/shared/hazard/observed-imeplan-2026.geojson';
const qs = new URLSearchParams(location.search);
const DEMO = qs.get('demo') === '1';
const AOI = [-103.75629, 20.243255, -103.04029, 21.006726];
const $ = s => document.querySelector(s);
const fmt = (v, d = 2) => Number(v).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });

// Palettes = the exact stops used to render the PNG tiles (tiles.mjs): [t, r, g, b, alpha 0..255]
const LAYERS = {
  relieve: { name: 'Relieve', sub: 'sombreado MDT', swatch: 'linear-gradient(135deg,#7d8b98,#1b232c)',
    desc: 'Sombreado del modelo digital del terreno INEGI de 5 m (terreno desnudo, sin exageración vertical).', src: 'MDT INEGI 5 m' },
  acumulacion: { name: 'Flujo', sub: 'área drenada (D8)', minzoom: 8, maxzoom: 15,
    stops: [[0, 30, 90, 190, 110], [0.25, 50, 150, 250, 185], [0.5, 110, 210, 255, 225], [0.75, 190, 245, 255, 245], [1, 255, 255, 255, 255]],
    ticks: [[0, '0.0025'], [1 / 3, '0.25'], [2 / 3, '25'], [1, '2 500 km²']], ends: ['escurrimiento de calle', 'río'],
    desc: 'Superficie que drena hacia cada celda de 5 m siguiendo la pendiente más fuerte (D8). Los edificios son muros: el agua baja por las calles y se junta en arroyos y canales.', src: 'MDT INEGI 5 m + edificios Overture como obstáculos' },
  depresiones: { name: 'Depresiones', sub: 'relleno ≥ 10 cm', minzoom: 9, maxzoom: 15,
    stops: [[0, 120, 215, 255, 120], [0.18, 70, 170, 255, 175], [0.41, 40, 110, 245, 215], [0.76, 55, 50, 200, 235], [1, 110, 30, 170, 245]],
    ticks: [[0, '10 cm'], [0.411, '50 cm'], [0.589, '1 m'], [0.869, '3 m'], [1, '5 m+']], ends: ['charco', 'hondonada'],
    desc: 'Hondonadas sin salida: cuánta agua cabe en cada punto antes de que desborde hacia la pendiente (relleno priority-flood). Solo calles y terreno libre; los edificios son obstáculos.', src: 'MDT INEGI 5 m + edificios (Barnes et al. 2014)' },
  hand: { name: 'Altura sobre el cauce', sub: 'HAND', minzoom: 8, maxzoom: 15,
    stops: [[0, 0, 245, 255, 215], [0.2, 0, 190, 255, 175], [0.4, 40, 120, 245, 130], [0.7, 85, 55, 190, 70], [1, 70, 20, 120, 0]],
    ticks: [[0, '0 m'], [0.202, '1'], [0.404, '3'], [0.698, '10'], [1, '30 m']], ends: ['fondo de valle', 'loma'],
    desc: 'Metros por encima del cauce al que drena cada punto (cauces con al menos 1 km² de cuenca). Cerca de 0 m es el fondo del valle: el mejor predictor de los sitios IMEPLAN.', src: 'Ruteo con edificios, alturas del MDT (Rennó et al. 2008)' },
  planitud: { name: 'Planitud', sub: 'pendiente en ~175 m', minzoom: 8, maxzoom: 14,
    stops: [[0, 120, 90, 60, 0], [0.4, 170, 130, 80, 60], [0.7, 230, 180, 90, 140], [0.9, 255, 215, 110, 195], [1, 255, 240, 170, 220]],
    ticks: [[0, '10 %'], [0.308, '3 %'], [0.589, '1 %'], [1, '0.2 %']], ends: ['inclinado', 'muy plano'],
    desc: 'Qué tan plano es el barrio: pendiente del terreno en una ventana de unos 175 m. Es la «planitud» de la hipótesis.', src: 'MDT INEGI 5 m promediado a 25 m' },
  susceptibilidad: { name: 'Susceptibilidad', sub: 'modelo 0–1', minzoom: 9, maxzoom: 15,
    stops: [[0, 30, 30, 90, 0], [0.5, 80, 50, 150, 70], [0.75, 170, 50, 150, 140], [0.9, 245, 100, 70, 200], [1, 255, 225, 110, 235]],
    ticks: [[0, '0'], [0.5, '0.5'], [0.8, '0.8'], [0.93, '0.93'], [1, '1']], ends: ['menos que la ciudad', 'más que la ciudad'],
    desc: 'Regresión logística con altura sobre el cauce, depresiones, humedad topográfica y posición, ajustada a los sitios IMEPLAN. 0.9 = más susceptible que el 90 % de la mancha urbana. Índice relativo, no probabilidad.', src: 'Validación espacial por bloques de 3 km' },
};
const ORDER = ['relieve', 'acumulacion', 'depresiones', 'hand', 'planitud', 'susceptibilidad'];
const rgba = ([, r, g, b, a]) => `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
const grad = stops => `linear-gradient(90deg, ${stops.map(s => `${rgba(s)} ${(s[0] * 100).toFixed(1)}%`).join(', ')})`;
for (const k of ORDER) if (LAYERS[k].stops) LAYERS[k].swatch = grad(LAYERS[k].stops.map(s => [s[0], s[1], s[2], s[3], Math.max(s[4], 140)]));

// ---------------- map ----------------
const style = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
    demhs: { type: 'raster-dem', tiles: [location.origin + '/labs/shared/terrain/dtm/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, minzoom: 8, maxzoom: 15, bounds: AOI, attribution: 'Relieve © INEGI' },
    dem3d: { type: 'raster-dem', tiles: [location.origin + '/labs/shared/terrain/dtm/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, minzoom: 8, maxzoom: 15, bounds: AOI },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0a0f14' } },
    { id: 'hillshade', type: 'hillshade', source: 'demhs', paint: { 'hillshade-shadow-color': '#020407', 'hillshade-highlight-color': '#6f8091', 'hillshade-accent-color': '#16202a', 'hillshade-exaggeration': 0.62, 'hillshade-illumination-direction': 315 } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#0d2536', 'fill-opacity': 0.95 } },
    { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': '#1a4561', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 15, 1.6] } },
    { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: ['match', ['get', 'class'], ['minor', 'service'], true, false],
      paint: { 'line-color': '#18212b', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 16, 3] } },
    { id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
      paint: { 'line-color': '#253240', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 16, 5] } },
    { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': '#0f161d', 'fill-opacity': 0.85 } },
    { id: 'overlay-anchor', type: 'background', layout: { visibility: 'none' }, paint: { 'background-color': '#000' } },
    { id: 'place-suburb', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 12, filter: ['match', ['get', 'class'], ['suburb', 'neighbourhood', 'quarter'], true, false],
      layout: { 'text-field': ['coalesce', ['get', 'name:es'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 8 },
      paint: { 'text-color': '#7f93a6', 'text-halo-color': '#05080b', 'text-halo-width': 1.4 } },
    { id: 'place-town', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: ['match', ['get', 'class'], ['city', 'town'], true, false],
      layout: { 'text-field': ['coalesce', ['get', 'name:es'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 11, 13, 15] },
      paint: { 'text-color': '#c9d6e2', 'text-halo-color': '#05080b', 'text-halo-width': 1.6 } },
  ],
};
const map = new maplibregl.Map({
  container: 'map', style, center: [-103.355, 20.648], zoom: innerWidth < 760 ? 9.6 : 10.55, minZoom: 8, maxZoom: 17.5,
  maxBounds: [[-104.2, 19.95], [-102.6, 21.3]], hash: !DEMO, attributionControl: false, fadeDuration: DEMO ? 0 : 300,
  canvasContextAttributes: { preserveDrawingBuffer: DEMO },
});
window.__map = map;
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'IMEPLAN MUI 2026 · INEGI MDT/MDS 5 m · Overture Maps' }), 'bottom-right');
if (!DEMO) map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.on('error', e => { const m = String(e?.error?.message || e?.error || ''); if (!/404|Not Found|Failed to fetch/i.test(m)) console.warn('map:', m); });

let active = 'acumulacion';
const state = { observed: true, polys: true, terrain: false };
let depLoaded = false;

let inited = false;
if (innerWidth < 760) { map.setPadding({ top: 50, bottom: Math.round(innerHeight * 0.46) + 40, left: 0, right: 0 }); }
map.once('idle', () => document.querySelectorAll('.maplibregl-compact-show').forEach(e => e.classList.remove('maplibregl-compact-show')));
map.on('style.load', () => {
  if (inited) return; inited = true;
  for (const k of ORDER.slice(1)) {
    const L = LAYERS[k];
    map.addSource('t-' + k, { type: 'raster', tiles: [`${location.origin}${BASE}/tiles/${k}/{z}/{x}/{y}.png`], tileSize: 256, minzoom: L.minzoom, maxzoom: L.maxzoom, bounds: AOI, attribution: 'Modelado: cauce. sim-relieve' });
    map.addLayer({ id: 'r-' + k, type: 'raster', source: 't-' + k, layout: { visibility: 'none' },
      paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: DEMO ? 0 : 350 }, 'raster-resampling': 'linear', 'raster-fade-duration': DEMO ? 0 : 200 } }, 'overlay-anchor');
  }
  map.addSource('dep', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }); // loaded on first use (10 MB)
  map.addLayer({ id: 'dep-line', type: 'line', source: 'dep', minzoom: 11.5, layout: { visibility: 'none' }, paint: { 'line-color': '#9be7ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 1.4], 'line-opacity': 0.75 } }, 'overlay-anchor');
  map.addLayer({ id: 'dep-hit', type: 'fill', source: 'dep', minzoom: 11.5, layout: { visibility: 'none' }, paint: { 'fill-color': '#000', 'fill-opacity': 0.01 } }, 'overlay-anchor');
  map.addSource('sus', { type: 'geojson', data: `${BASE}/susceptibilidad-alta.geojson` });
  map.addLayer({ id: 'sus-line', type: 'line', source: 'sus', layout: { visibility: 'none' }, paint: { 'line-color': ['match', ['get', 'class'], 'muy alta', '#ffe08a', '#f0705a'], 'line-width': ['match', ['get', 'class'], 'muy alta', 1.4, 0.8], 'line-opacity': 0.85 } }, 'overlay-anchor');
  map.addSource('obs', { type: 'geojson', data: OBS_URL });
  map.addLayer({ id: 'obs-fill', type: 'fill', source: 'obs', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#ff7a6b', 'fill-opacity': 0.13 } }, 'overlay-anchor');
  map.addLayer({ id: 'obs-line', type: 'line', source: 'obs', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': '#ff8a7c', 'line-width': ['match', ['get', 'category'], 'Zonas Criticas', 1.6, 1.0], 'line-opacity': 0.95 } }, 'overlay-anchor');
  map.addLayer({ id: 'obs-pt', type: 'circle', source: 'obs', minzoom: 9, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.6, 14, 4], 'circle-color': '#ff7a6b', 'circle-stroke-color': '#1a0805', 'circle-stroke-width': 1 } }, 'overlay-anchor');
  setActive(DEMO ? 'acumulacion' : active, true);
  applyToggles();
  if (DEMO) startDemo();
});

function setActive(k, instant) {
  active = k;
  for (const j of ORDER.slice(1)) {
    const on = j === k;
    if (!map.getLayer('r-' + j)) continue;
    if (on) map.setLayoutProperty('r-' + j, 'visibility', 'visible');
    map.setPaintProperty('r-' + j, 'raster-opacity', on ? (j === 'hand' ? 0.95 : 1) : 0);
    if (!on) setTimeout(() => { if (active !== j && !DEMO) map.setLayoutProperty('r-' + j, 'visibility', 'none'); }, instant ? 0 : 400);
  }
  map.setPaintProperty('hillshade', 'hillshade-exaggeration', k === 'relieve' ? 0.85 : 0.62);
  applyToggles();
  renderSwitcher(); renderLegend();
}
function applyToggles() {
  if (!map.getLayer('obs-fill')) return;
  for (const id of ['obs-fill', 'obs-line', 'obs-pt']) map.setLayoutProperty(id, 'visibility', state.observed ? 'visible' : 'none');
  const dep = state.polys && active === 'depresiones', sus = state.polys && active === 'susceptibilidad';
  if (dep && !depLoaded) { depLoaded = true; map.getSource('dep').setData(`${BASE}/depresiones.geojson`); }
  map.setLayoutProperty('dep-line', 'visibility', dep ? 'visible' : 'none'); map.setLayoutProperty('dep-hit', 'visibility', dep ? 'visible' : 'none');
  map.setLayoutProperty('sus-line', 'visibility', sus ? 'visible' : 'none');
}
function renderSwitcher() {
  $('#switcher').innerHTML = ORDER.map(k => `<button role="radio" aria-checked="${k === active}" class="${k === active ? 'on' : ''}" data-k="${k}"><i style="background:${LAYERS[k].swatch}"></i><b>${LAYERS[k].name}</b><small>${LAYERS[k].sub}</small></button>`).join('');
  $('#switcher').querySelectorAll('button').forEach(b => b.onclick = () => setActive(b.dataset.k));
}
function renderLegend() {
  const L = LAYERS[active];
  const ramp = L.stops ? `<div class="ramp" style="background-image:${grad(L.stops)}"></div>
    <div class="ticks">${L.ticks.map(([, t]) => `<span>${t}</span>`).join('')}</div><div class="ends"><span>${L.ends[0]}</span><span>${L.ends[1]}</span></div>` : '';
  $('#legend').innerHTML = `${ramp}<p>${L.desc}</p><div class="src">${L.src}</div>`;
}
$('#tObserved').onchange = e => { state.observed = e.target.checked; applyToggles(); };
$('#tPolys').onchange = e => { state.polys = e.target.checked; applyToggles(); };
$('#t3d').onchange = e => { state.terrain = e.target.checked; map.setTerrain(state.terrain ? { source: 'dem3d', exaggeration: 1 } : null); map.easeTo({ pitch: state.terrain ? 58 : 0, duration: 900 }); };
document.querySelectorAll('.sheet-tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.sheet-tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.body.classList.toggle('tab-answer', b.dataset.tab === 'answer');
});

// popups
map.on('click', e => {
  const f = map.queryRenderedFeatures(e.point, { layers: ['obs-fill', 'obs-pt', 'dep-hit', 'sus-line'].filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none') })[0];
  if (!f) return;
  const p = f.properties; let html;
  if (f.layer.id.startsWith('obs')) {
    html = `<div class="pop"><span class="tag observed">observado</span><h4>${p.name} · ${p.category === 'Zonas Criticas' ? 'zona crítica' : 'sitio inundable'}</h4>
      ${p['Referencia'] ? `<div>${p['Referencia']}</div>` : ''}${p['Régimen'] ? `<div><span class="k">Régimen:</span> ${p['Régimen']}</div>` : ''}
      ${p['Rango de alturas de inundación'] || p['Rango de alturas de inundación (cm)'] ? `<div><span class="k">Alturas reportadas:</span> ${p['Rango de alturas de inundación'] || p['Rango de alturas de inundación (cm)']}</div>` : ''}
      ${p.Motivo ? `<div><span class="k">Motivo:</span> ${p.Motivo}</div>` : ''}<div class="k">IMEPLAN MUI 2026 (inventario, no pronóstico)</div></div>`;
  } else if (f.layer.id === 'dep-hit') {
    html = `<div class="pop"><span class="tag modeled">modelado</span><h4>Depresión ${p.class}</h4><div><span class="k">Profundidad máx.:</span> <span class="num">${fmt(p.depth_m_max)} m</span></div>
      <div><span class="k">Volumen:</span> <span class="num">${Number(p.volume_m3).toLocaleString('es-MX')} m³</span> · <span class="k">área</span> <span class="num">${Number(p.area_m2).toLocaleString('es-MX')} m²</span></div>
      <div><span class="k">Cuenca que le llega:</span> <span class="num">${(p.contrib_area_m2 / 1e4).toLocaleString('es-MX', { maximumFractionDigits: 1 })} ha</span></div>
      <div><span class="k">Lluvia que la llenaría</span> (si todo escurre): <span class="num">${Number(p.fill_rain_mm).toLocaleString('es-MX')} mm</span></div><div class="k">Relleno estático del terreno; no considera alcantarillas.</div></div>`;
  } else {
    html = `<div class="pop"><span class="tag modeled">modelado</span><h4>${p.label}</h4><div class="k">Índice relativo del terreno; no es profundidad ni probabilidad.</div></div>`;
  }
  new maplibregl.Popup({ maxWidth: '300px' }).setLngLat(e.lngLat).setHTML(html).addTo(map);
});
for (const id of ['obs-fill', 'dep-hit']) { map.on('mouseenter', id, () => map.getCanvas().style.cursor = 'pointer'); map.on('mouseleave', id, () => map.getCanvas().style.cursor = ''); }

// ---------------- the answer panel ----------------
const tip = $('#tip');
function showTip(ev, html) { tip.innerHTML = html; tip.classList.add('on'); const x = Math.min(innerWidth - 270, ev.clientX + 14), y = Math.min(innerHeight - 80, ev.clientY + 14); tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
const hideTip = () => tip.classList.remove('on');
let S = null;
fetch(`${BASE}/stats.json`).then(r => r.json()).then(s => { S = s; renderAnswer(); }).catch(e => { $('#verdict').textContent = 'No se pudo cargar stats.json: ' + e.message; });

function renderAnswer() {
  const H = S.hypothesis;
  const x = v => `<span class="num">${fmt(v, 1)}×</span>`;
  $('#verdict').innerHTML = `<div class="head">${H.headline}</div>
    <p>El 10 % más plano de la ciudad tiene ${x(H.flattestDecileRatio)} los sitios inundables esperados, pero porque en la ZMG lo plano suele ser lo <b>bajo</b>. A igual altura sobre el cauce, la planitud ya no distingue nada (AUC <span class="num">${fmt(H.flatWithinHandMin)}–${fmt(H.flatWithinHandMax)}</span>) y quitarla del modelo no cambia su validación (<span class="num">${fmt(H.cvWithFlat, 3)} → ${fmt(H.cvWithoutFlat, 3)}</span>).</p>`;
  // quadrants
  const Q = H.quadrants;
  const cell = (k, label) => { const q = Q[k]; const lr = Math.log2(q.ratio); const a = Math.min(1, Math.abs(lr) / 2.4);
    const bg = lr >= 0 ? `rgba(240,112,90,${0.18 + 0.62 * a})` : `rgba(70,110,150,${0.16 + 0.45 * a})`;
    return `<div class="cell" style="background:${bg}" data-k="${k}" data-l="${label}"><div class="v">${fmt(q.ratio, 1)}×</div><div class="s">${Math.round(q.posShare * 100)} % de los sitios · ${Math.round(q.ctlShare * 100)} % del área</div></div>`; };
  $('#quad').innerHTML = `<div></div><div class="hd">Plano<br><small>pendiente &lt; ${fmt(H.slopeMedian, 1)} %</small></div><div class="hd">Inclinado<br><small>≥ ${fmt(H.slopeMedian, 1)} %</small></div>
    <div class="rh">Bajo<br>HAND &lt; 1 m</div>${cell('plano_bajo', 'plano y bajo')}${cell('inclinado_bajo', 'inclinado y bajo')}
    <div class="rh">Alto<br>HAND ≥ 1 m</div>${cell('plano_alto', 'plano y alto')}${cell('inclinado_alto', 'inclinado y alto')}`;
  $('#quad').insertAdjacentHTML('afterend', '<p class="quad-note">Veces la frecuencia de sitios IMEPLAN respecto al promedio de la mancha urbana. Pendiente en ~175 m; HAND con cauces ≥ 1 km².</p>');
  $('#quad').querySelectorAll('.cell').forEach(c => { c.onmousemove = ev => { const q = Q[c.dataset.k]; showTip(ev, `<b>${c.dataset.l}</b><br>${fmt(q.ratio, 2)}× el promedio urbano<br><span class="k">${fmt(q.posShare * 100, 1)} % de los sitios en ${fmt(q.ctlShare * 100, 1)} % del área urbana</span>`); }; c.onmouseleave = hideTip; });
  drawAUC(); drawDeciles(); renderMethod();
  const I = H.independentCheck;
  if (I) $('#aucChart').insertAdjacentHTML('beforeend', `<p class="quad-note">Prueba independiente con ${I.n.toLocaleString('es-MX')} llamadas a Protección Civil de Zapopan 2017–2025 (no usadas para ajustar): modelo AUC <span class="num">${fmt(I.aucModel)}</span>, altura sobre el cauce <span class="num">${fmt(I.aucHand)}</span>, planitud <span class="num">${fmt(I.aucFlatness)}</span>.</p>`);
}

function svgEl(w, h) { return `<svg viewBox="0 0 ${w} ${h}" role="img">`; }
function drawAUC() {
  const rows = S.charts.auc; const W = 368, rowH = 20, top = 14, left = 158, right = 40, H = top + rows.length * rowH + 22;
  const x0 = 0.45, x1 = 0.85, X = v => left + (Math.max(x0, Math.min(x1, v)) - x0) / (x1 - x0) * (W - left - right);
  const col = { planitud: '#f2b84b', hand: '#22d8f0', modelo: '#e8eef4', otro: '#5d6f80' };
  let s = svgEl(W, H);
  for (const t of [0.5, 0.6, 0.7, 0.8]) s += `<line class="${t === 0.5 ? 'axis' : 'grid'}" x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${H - 18}"/><text x="${X(t)}" y="${H - 5}" text-anchor="middle" class="mono">${fmt(t, 1)}</text>`;
  s += `<text x="${X(0.5)}" y="9" text-anchor="middle" style="fill:#6f8292;font-size:10px">azar</text>`;
  rows.forEach((r, i) => {
    const y = top + i * rowH + 4, h = rowH - 8, c = col[r.color] || col.otro, a = X(Math.min(0.5, r.auc)), b = X(Math.max(0.5, r.auc));
    s += `<g class="bar" data-i="${i}"><rect x="0" y="${y - 5}" width="${W}" height="${rowH}" fill="transparent"/>`;
    s += `<text x="${left - 8}" y="${y + h / 2 + 4}" text-anchor="end" style="fill:${r.color === 'otro' ? '#a8b8c7' : '#e8eef4'}">${r.label}</text>`;
    s += `<path d="M${a},${y}h${Math.max(1, b - a) - (b > a + 4 ? 4 : 0)}${b > a + 4 ? `a4,4 0 0 1 4,4v${h - 8}a4,4 0 0 1 -4,4` : `v${h}`}h-${Math.max(1, b - a) - (b > a + 4 ? 4 : 0)}z" fill="${c}"/>`;
    if (r.ci) s += `<line x1="${X(r.ci[0])}" x2="${X(r.ci[1])}" y1="${y + h / 2}" y2="${y + h / 2}" stroke="#e8eef4" stroke-opacity=".55" stroke-width="1"/>`;
    s += `<text x="${Math.max(b, r.ci ? X(r.ci[1]) : b) + 5}" y="${y + h / 2 + 4}" class="mono" style="fill:#e8eef4">${fmt(r.auc)}</text></g>`;
  });
  $('#aucChart').innerHTML = s + '</svg>';
  $('#aucChart').querySelectorAll('.bar').forEach(g => { const r = rows[+g.dataset.i]; g.onmousemove = ev => showTip(ev, `<b>${r.label}</b><br>AUC ${fmt(r.auc, 3)}${r.ci ? ` <span class="k">(IC95 ${fmt(r.ci[0], 3)}–${fmt(r.ci[1], 3)})</span>` : ''}<br><span class="k">${r.note}</span>`); g.onmouseleave = hideTip; });
}
function drawDeciles() {
  const ser = S.charts.deciles; const W = 368, H = 152, l = 34, r = 14, t = 10, b = 30;
  const ymin = 0.06, ymax = 6, Y = v => t + (Math.log(ymax) - Math.log(Math.max(ymin, Math.min(ymax, v)))) / (Math.log(ymax) - Math.log(ymin)) * (H - t - b);
  const X = d => l + (d - 1) / 9 * (W - l - r);
  let s = svgEl(W, H);
  for (const v of [0.1, 0.25, 0.5, 1, 2, 4]) s += `<line class="${v === 1 ? 'axis' : 'grid'}" x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}" ${v === 1 ? 'style="stroke:#55677a"' : ''}/><text x="${l - 6}" y="${Y(v) + 4}" text-anchor="end" class="mono">${v}</text>`;
  for (let d = 1; d <= 10; d++) s += `<text x="${X(d)}" y="${H - b + 15}" text-anchor="middle" class="mono">${d}</text>`;
  s += `<text x="${l}" y="${H - 2}" style="fill:#6f8292;font-size:10.5px">decil 1 = lo más plano / lo más bajo</text><text x="${W - r}" y="${H - 2}" text-anchor="end" style="fill:#6f8292;font-size:10.5px">10 = lo más inclinado / alto</text>`;
  s += `<text x="${W - r}" y="${Y(1) - 4}" text-anchor="end" style="fill:#8195a8;font-size:10px">promedio urbano</text>`;
  for (const se of ser) {
    const pts = se.values.map((v, i) => [X(i + 1), Y(v)]);
    s += `<path d="M${pts.map(p => p.join(',')).join('L')}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round"/>`;
    s += pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${se.color}" stroke="#0e141b" stroke-width="2"/>`).join('');
    s += `<text x="${pts[0][0] + 9}" y="${pts[0][1] + (se.key === 'hand' ? 4 : 14)}" class="mono" style="fill:#e8eef4">${fmt(se.values[0], 1)}×</text>`;
  }
  s += `<line id="dx" class="axis" x1="0" x2="0" y1="${t}" y2="${H - b}" style="opacity:0;stroke:#8195a8"/><rect id="dhit" x="${l}" y="${t}" width="${W - l - r}" height="${H - t - b}" fill="transparent"/>`;
  $('#decileChart').innerHTML = `<div class="legend-row">${ser.map(se => `<span><i style="background:${se.color}"></i>${se.label}</span>`).join('')}</div>` + s + '</svg>';
  const svg = $('#decileChart svg'), hit = svg.querySelector('#dhit'), dx = svg.querySelector('#dx');
  hit.onmousemove = ev => { const bb = svg.getBoundingClientRect(); const xs = (ev.clientX - bb.left) / bb.width * W; const d = Math.max(1, Math.min(10, Math.round((xs - l) / (W - l - r) * 9 + 1)));
    dx.setAttribute('x1', X(d)); dx.setAttribute('x2', X(d)); dx.style.opacity = 1;
    showTip(ev, `<b>Decil ${d}</b><br>${ser.map(se => `${se.label}: <span class="num">${fmt(se.values[d - 1], 2)}×</span> <span class="k">(${se.edges[d - 1]})</span>`).join('<br>')}`); };
  hit.onmouseleave = () => { dx.style.opacity = 0; hideTip(); };
}
function renderMethod() {
  const m = S.method;
  $('#methodText').innerHTML = `<p>${m.text}</p><table><tr><th>Índice</th><th>MDE</th><th class="n">AUC</th><th class="n">IC95</th></tr>${S.indices.map(i => `<tr><td>${i.label}</td><td>${i.dem}</td><td class="n">${fmt(i.aucOriented, 3)}</td><td class="n">${fmt(i.ci95[0], 2)}–${fmt(i.ci95[1], 2)}</td></tr>`).join('')}</table>
    <p>Modelo final (logística, variables estandarizadas): ${S.model.coefficients.map(c => `${c.labelShort} <span class="num">OR ${fmt(c.oddsRatioPerSD, 2)}</span>`).join(' · ')}. AUC con validación espacial <span class="num">${fmt(S.model.aucSpatialCV.mean, 3)} ± ${fmt(S.model.aucSpatialCV.sd, 3)}</span>.</p>
    <p>${m.limits}</p>`;
}

// ---------------- demo (filming) ----------------
const KF = [ // t (s), center, zoom, pitch, bearing
  { t: 0, c: [-103.356, 20.645], z: 10.6, p: 40, b: -14 },
  { t: 5, c: [-103.372, 20.660], z: 11.3, p: 48, b: -6 },
  { t: 9.5, c: [-103.392, 20.664], z: 14.2, p: 58, b: 18 },
  { t: 14.5, c: [-103.343, 20.672], z: 14.6, p: 55, b: -20 },
  { t: 19, c: [-103.36, 20.645], z: 11.6, p: 45, b: -8 },
  { t: 26, c: [-103.33, 20.632], z: 11.15, p: 30, b: 4 },
];
const SEG = [ // layer opacities over time [t, layer] crossfades
  [0, 'acumulacion'], [9.5, 'depresiones'], [14.5, 'hand'], [19.2, 'susceptibilidad'],
];
const CAPS = [
  [0.4, 4.6, 'Cada línea es el camino del agua sobre el relieve', 'MDT INEGI a 5 m · edificios como muros'],
  [5.2, 9.2, 'En la ciudad, el agua baja por las calles', 'flujo acumulado (D8) con edificios Overture'],
  [10, 14.2, 'Depresiones: donde el agua se queda', 'relleno del terreno · rojo: inundaciones observadas IMEPLAN'],
  [15, 18.8, 'Altura sobre el cauce: el fondo del valle', 'HAND, cauces ≥ 1 km²'],
  [19.6, 26, '¿Lo plano se inunda? En parte: lo que manda es estar bajo', 'susceptibilidad del terreno validada contra 470 sitios IMEPLAN'],
];
const ease = u => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
function camAt(t) {
  let i = 0; while (i < KF.length - 2 && t > KF[i + 1].t) i++;
  const a = KF[i], b = KF[i + 1], u = ease(Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))));
  // zoom in log space, centre interpolated in Mercator-ish linear (short hops)
  return { center: [a.c[0] + (b.c[0] - a.c[0]) * u, a.c[1] + (b.c[1] - a.c[1]) * u], zoom: a.z + (b.z - a.z) * u, pitch: a.p + (b.p - a.p) * u, bearing: a.b + (b.b - a.b) * u };
}
function applyDemo(t) {
  map.jumpTo(camAt(t));
  const FADE = 1.2; const op = {}; const cl = v => Math.max(0, Math.min(1, v));
  for (let i = 0; i < SEG.length; i++) {
    const [t0, k] = SEG[i], t1 = i + 1 < SEG.length ? SEG[i + 1][0] : Infinity;
    const o = (i ? cl((t - (t0 - FADE)) / FADE) : 1) * (Number.isFinite(t1) ? cl((t1 - t) / FADE) : 1);
    op[k] = Math.max(op[k] || 0, o);
  }
  for (const k of ORDER.slice(1)) {
    const o = op[k] || 0;
    map.setLayoutProperty('r-' + k, 'visibility', o > 0.001 ? 'visible' : 'none');
    map.setPaintProperty('r-' + k, 'raster-opacity', o);
  }
  const showObs = t >= 10;
  for (const id of ['obs-fill', 'obs-line', 'obs-pt']) map.setLayoutProperty(id, 'visibility', showObs ? 'visible' : 'none');
  map.setLayoutProperty('dep-line', 'visibility', 'none'); map.setLayoutProperty('dep-hit', 'visibility', 'none');
  map.setLayoutProperty('sus-line', 'visibility', t >= 21 ? 'visible' : 'none');
  const cap = CAPS.find(c => t >= c[0] && t <= c[1]);
  $('#caption').innerHTML = cap ? `${cap[2]}<small>${cap[3]}</small>` : ''; $('#caption').classList.toggle('on', !!cap);
  $('#answerPanel').classList.toggle('show', t >= 21);
}
function frameReady(timeout = 30000) {
  return new Promise(res => {
    const t0 = performance.now();
    const check = () => {
      if ((map.loaded() && map.areTilesLoaded()) || performance.now() - t0 > timeout) requestAnimationFrame(() => requestAnimationFrame(() => res()));
      else setTimeout(check, 40);
    };
    map.triggerRepaint(); setTimeout(check, 30);
  });
}
const DURATION = 26;
window.__cauceDemo = { duration_s: DURATION, seek: async t => { applyDemo(Math.max(0, Math.min(DURATION, t))); await frameReady(); return true; } };
function startDemo() {
  document.body.classList.add('demo');
  map.setTerrain({ source: 'dem3d', exaggeration: 1 });
  if (qs.get('autoplay') === '0') { applyDemo(+(qs.get('t') || 0)); return; }
  const t0 = performance.now();
  const loop = () => { const t = (performance.now() - t0) / 1000; applyDemo(Math.min(DURATION, t)); if (t < DURATION) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
renderSwitcher(); renderLegend();
