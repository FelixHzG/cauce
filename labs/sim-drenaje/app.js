/* cauce. labs · sim-drenaje viewer
   Capacity slider swaps precomputed ensemble results (no simulation in the browser).
   Data: /labs/shared/hazard/modeled/sim-drenaje/ (stats.json, web/*.png data images, tiles/, ageb-drainage.json). */
'use strict';
const BASE = '/labs/shared/hazard/modeled/sim-drenaje/';
const Q = new URLSearchParams(location.search);
const DEMO = Q.get('demo') === '1';
if (DEMO) document.body.classList.add('demo');
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, d = 1) => v == null || !isFinite(v) ? '–' : v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---- palette (dataviz reference steps; blue sequential, deeper = lighter on the dark map; categorical a/b validated on dark)
const RGBA = (h, a) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
const DEPTH = [null, RGBA('#184f95', 150), RGBA('#2a78d6', 205), RGBA('#5598e7', 228), RGBA('#86b6ef', 240), RGBA('#b7d3f6', 250), RGBA('#cde2fb', 255), null];
const DEPTH_LBL = ['', '5–15 cm', '15–30', '30–50', '50–100', '1–2 m', '≥2 m'];
const FREQ = [null, RGBA('#184f95', 170), RGBA('#256abf', 200), RGBA('#3987e5', 220), RGBA('#6da7ec', 238), RGBA('#b7d3f6', 250), null, null];
const FREQ_LBL = ['', '5–20 %', '20–40', '40–60', '60–80', '≥80 %'];
const STORM_COL = { 2: '#184f95', 5: '#256abf', 10: '#3987e5', 25: '#6da7ec', 50: '#9ec5f4', 100: '#cde2fb' };
const GAP = { a: '#d95926', b: '#199e70', c: '#6b6b66' };
const lutOf = arr => { const u = new Uint32Array(8); arr.forEach((c, k) => { if (c) u[k] = (c[3] << 24) | (c[2] << 16) | (c[1] << 8) | c[0]; }); return u; };
const LUT = { depth: lutOf(DEPTH), freq: lutOf(FREQ) };

let stats = null, map = null, CAPS = [], STORMS = [];
const S = { mode: 'depth', Tr: 10, k: 0, obs: true, frame: null }; // frame = minute of the reference-storm animation (null = maximum depth)
const DS = !DEMO && Math.min(innerWidth, innerHeight) < 700 ? 2 : 1; // phones: half-resolution canvas
const cache = {};
let canvas, ctx, imgData, out32, IW, IH;
let ageb = null; // {fc, ok}

// ---------------------------------------------------------------- data images (exact bytes, no colour management)
async function decode(name) {
  if (cache[name]) return cache[name];
  const p = (async () => {
    const blob = await (await fetch(BASE + 'web/' + name)).blob();
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    const w = Math.floor(bmp.width / DS), h = Math.floor(bmp.height / DS);
    const v = new Uint32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = ((y * DS) * bmp.width + x * DS) * 4; v[y * w + x] = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2]; }
    return { w, h, v, W0: bmp.width, H0: bmp.height };
  })();
  cache[name] = p; return p;
}
const frameCaps = () => stats.web.frameCaps || [];
const frameK = () => { const fc = frameCaps(); let best = 0; fc.forEach((c, j) => { if (Math.abs(c - CAPS[S.k]) < Math.abs(fc[best] - CAPS[S.k])) best = j; }); return best; };
const frameOn = () => S.frame != null && S.mode === 'depth' && frameCaps().length;
const dataName = () => S.mode === 'freq' ? 'freq-by-cap.png' : frameOn() ? `frame-t${String(S.frame).padStart(3, '0')}.png` : `depth-tr${S.Tr}.png`;
const dataShift = () => frameOn() ? [16, 8, 0][frameK()] : 3 * S.k;
let painted = '';
async function paint(force) {
  if (S.mode !== 'depth' && S.mode !== 'freq') { setOverlay(null); return; }
  const key = `${dataName()}|${dataShift()}|${S.mode}`;
  if (key === painted && !force) { setOverlay('flood'); return; }
  const d = await decode(dataName());
  if (`${dataName()}|${dataShift()}|${S.mode}` !== key) return; // state moved on while loading
  const lut = LUT[S.mode], sh = dataShift(), v = d.v, n = v.length;
  for (let i = 0; i < n; i++) out32[i] = lut[(v[i] >> sh) & 7];
  ctx.putImageData(imgData, 0, 0);
  painted = key;
  const src = map.getSource('flood');
  if (src) { src.play(); map.once('render', () => map.once('render', () => src.pause())); map.triggerRepaint(); }
  setOverlay('flood');
}
function setOverlay(which) {
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  vis('flood', which === 'flood');
  vis('tiles-gap', S.mode === 'gap');
  vis('tiles-sens', S.mode === 'sens');
  vis('ageb-fill', S.mode === 'ageb'); vis('ageb-line', S.mode === 'ageb');
}

// ---------------------------------------------------------------- map
function buildStyle() {
  const dem = { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: '<a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a>' };
  return {
    version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }, shade: dem, terrain: { ...dem } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#11171a' } },
      { id: 'shade', type: 'hillshade', source: 'shade', paint: { 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': '#05080a', 'hillshade-highlight-color': '#3a4549', 'hillshade-accent-color': '#1a2226' } },
      { id: 'landuse', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'industrial', 'commercial', 'retail']]], paint: { 'fill-color': '#1b2226', 'fill-opacity': 0.55 } },
      { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', paint: { 'fill-color': '#0f2b33' } },
      { id: 'waterway', type: 'line', source: 'ofm', 'source-layer': 'waterway', paint: { 'line-color': '#1f5561', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 15, 2] } },
      { id: 'roads-minor', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 12.5, filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary']]], paint: { 'line-color': '#59646a', 'line-width': ['interpolate', ['linear'], ['zoom'], 12.5, 0.3, 16, 1.4], 'line-opacity': 0.35 } },
      { id: 'roads-major', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 9, filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]], paint: { 'line-color': '#8d989c', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 13, 1, 16, 2.6], 'line-opacity': 0.42 } },
      { id: 'buildings', type: 'fill', source: 'ofm', 'source-layer': 'building', minzoom: 14.5, paint: { 'fill-color': '#262e33', 'fill-opacity': 0.55 } },
      { id: 'places', type: 'symbol', source: 'ofm', 'source-layer': 'place', filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb', 'neighbourhood']]],
        layout: { 'text-field': ['coalesce', ['get', 'name:es'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': ['match', ['get', 'class'], 'city', 14, 'town', 12, 11], 'text-letter-spacing': 0.04, 'text-max-width': 8 },
        minzoom: 9.5, paint: { 'text-color': '#aab3b6', 'text-halo-color': '#0b1012', 'text-halo-width': 1.4, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 9.5, 0.55, 13, 0.8] } },
    ],
    sky: { 'sky-color': '#0b1013', 'horizon-color': '#1b262c', 'fog-color': '#131b1f', 'fog-ground-blend': 0.2 },
  };
}

function addData() {
  const im = stats.web.mercatorImage;
  IW = Math.floor(im.width / DS); IH = Math.floor(im.height / DS);
  canvas = document.createElement('canvas'); canvas.width = IW; canvas.height = IH;
  ctx = canvas.getContext('2d'); imgData = ctx.createImageData(IW, IH); out32 = new Uint32Array(imgData.data.buffer);
  map.addSource('flood', { type: 'canvas', canvas, coordinates: im.coordinates, animate: false });
  map.addLayer({ id: 'flood', type: 'raster', source: 'flood', paint: { 'raster-opacity': 0.92, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, 'roads-minor');
  for (const L of ['gap', 'sens']) {
    map.addSource('tiles-' + L, { type: 'raster', tiles: [location.origin + BASE + `tiles/${L}/{z}/{x}/{y}.png`], tileSize: 256, minzoom: stats.web.tileZoom[0], maxzoom: stats.web.tileZoom[1], bounds: [im.bounds.west, im.bounds.south, im.bounds.east, im.bounds.north], attribution: 'Modelo sim-drenaje (cauce. labs)' });
    map.addLayer({ id: 'tiles-' + L, type: 'raster', source: 'tiles-' + L, layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.95, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } }, 'roads-minor');
  }
  // observed (IMEPLAN) — kept visibly distinct: hollow white rings
  map.addSource('obs', { type: 'geojson', data: '/labs/shared/hazard/observed-imeplan-2026.geojson', attribution: 'IMEPLAN MUI 2026' });
  map.addLayer({ id: 'obs', type: 'circle', source: 'obs', filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.2, 14, 6], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#f0efec', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 2], 'circle-stroke-opacity': 0.9 } }, 'places');
}

async function loadAgeb() {
  try {
    if (!stats.ageb) return; // aggregation not produced yet
    const idx = await fetch('/labs/shared/infra/index.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null);
    const L = idx?.layers?.find(l => /ageb/i.test(l.id) && /\.geojson/.test(l.url || ''));
    const gurl = L?.url || '/labs/shared/infra/ageb-profile.geojson';
    const [g, d] = await Promise.all([fetch(gurl).then(r => r.ok ? r.json() : null), fetch(BASE + 'ageb-drainage.json').then(r => r.ok ? r.json() : null)]);
    if (!g || !d) return;
    const key = p => p.cvegeo || p.CVEGEO || p.id || p.ageb_id || p.cve_ageb;
    const feats = [];
    for (const f of g.features) { const a = d.agebs[key(f.properties)]; if (!a) continue; feats.push({ type: 'Feature', geometry: f.geometry, properties: { id: key(f.properties), cls: a.gap_class, freq: a.flood_frequency, s0: a.flooded_share_by_cap?.[0], s40: a.flooded_share_by_cap?.[40], pop: a.population, popRef: a.population_exposed_ref, popBen: a.population_benefit_0_to_40, pop40: a.population_exposed_by_cap?.[40], rank: a.rank_drainage_benefit, inl: a.inlet_extra_flooded_share, sa: a.share_a_persistente, sb: a.share_b_responde, name: f.properties.mun_nombre || '' } }); }
    ageb = { fc: { type: 'FeatureCollection', features: feats }, meta: d.meta };
    map.addSource('ageb', { type: 'geojson', data: ageb.fc, attribution: 'INEGI Censo 2020 (AGEB)' });
    map.addLayer({ id: 'ageb-fill', type: 'fill', source: 'ageb', layout: { visibility: 'none' }, paint: { 'fill-color': ['match', ['get', 'cls'], 'a', GAP.a, 'b', GAP.b, GAP.c], 'fill-opacity': ['interpolate', ['linear'], ['get', 'freq'], 0, 0.12, 0.1, 0.35, 0.3, 0.75] } }, 'roads-minor');
    map.addLayer({ id: 'ageb-line', type: 'line', source: 'ageb', layout: { visibility: 'none' }, paint: { 'line-color': '#0e1316', 'line-width': 0.6, 'line-opacity': 0.8 } }, 'roads-minor');
    $('#modes [data-mode=ageb]').disabled = false;
    update();
  } catch (e) { console.warn('AGEB', e); }
}

// ---------------------------------------------------------------- UI
function curve(infil, Tr) { const c = stats.curves?.[infil]?.[Tr]; return c ? CAPS.map(cap => c[cap]?.urbanFlooded15_km2 ?? null) : null; }
function meanCurve() { return CAPS.map(cap => { let s = 0, n = 0; for (const inf in stats.curves) for (const Tr in stats.curves[inf]) { const v = stats.curves[inf][Tr][cap]?.urbanFlooded15_km2; if (v != null) { s += v; n++; } } return n ? s / n : null; }); }

function buildUI() {
  const st = $('#storms');
  const okTr = Tr => (stats.web.sliderAvailable?.[Tr] || []).length === CAPS.length;
  st.innerHTML = STORMS.map(Tr => `<button data-tr="${Tr}" ${okTr(Tr) ? '' : 'disabled title="aún en cálculo"'}><span class="sw" style="background:${STORM_COL[Tr]};width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:5px"></span>Tr ${Tr}</button>`).join('');
  st.onclick = e => { const b = e.target.closest('button'); if (b && !b.disabled) { if (playTimer) { clearInterval(playTimer); playTimer = null; S.frame = null; } S.Tr = +b.dataset.tr; update(); } };
  $('.lede').textContent = `${stats.runsDone} simulaciones de lluvia sobre la ciudad a 20 m (tormentas × capacidad de drenaje × infiltración). Mueve la capacidad del drenaje y mira qué zonas se secan… y cuáles no.`;
  $('#capTicks').innerHTML = CAPS.map(c => `<span>${c}</span>`).join('');
  $('#cap').max = CAPS.length - 1;
  const lo = CAPS.indexOf(20), hi = CAPS.indexOf(30);
  if (lo >= 0 && hi >= 0) { const f = k => `calc(11px + (100% - 22px) * ${k / (CAPS.length - 1)})`; const b = $('#nowBand'); b.style.left = `calc(${f(lo)} - 6px)`; b.style.width = `calc((100% - 22px) * ${(hi - lo) / (CAPS.length - 1)} + 12px)`; }
  $('#cap').oninput = e => { S.k = +e.target.value; update(); };
  $('#play').onclick = () => playFrames();
  $('#modes').onclick = e => { const b = e.target.closest('button'); if (b && !b.disabled) { if (playTimer) { clearInterval(playTimer); playTimer = null; S.frame = null; } S.mode = b.dataset.mode; update(); } };
  $('#obs').onchange = e => { S.obs = e.target.checked; update(); };
  $('#collapse').onclick = () => { const p = $('#panel'); p.classList.toggle('collapsed'); $('#collapse').textContent = p.classList.contains('collapsed') ? '▴' : '▾'; };
  if (innerWidth <= 720) { $('#panel').classList.add('collapsed'); $('#collapse').textContent = '▴'; }
  $('#modes [data-mode=ageb]').disabled = true;
}

let playTimer = null;
function playFrames() {
  if (playTimer) { clearInterval(playTimer); playTimer = null; S.frame = null; update(); return; }
  const fr = stats.web.frames_min || []; if (!fr.length) return;
  S.mode = 'depth'; S.Tr = 10; let j = 0; S.frame = fr[0];
  fr.forEach(t => decode(`frame-t${String(t).padStart(3, '0')}.png`));
  update();
  playTimer = setInterval(() => { j++; if (j >= fr.length) { clearInterval(playTimer); playTimer = null; S.frame = null; } else S.frame = fr[j]; update(); }, 900);
}
function update() {
  for (const b of document.querySelectorAll('#modes button')) b.classList.toggle('on', b.dataset.mode === S.mode);
  for (const b of document.querySelectorAll('#storms button')) b.classList.toggle('on', +b.dataset.tr === S.Tr);
  $('#cap').value = S.k;
  const cap = CAPS[S.k];
  $('#capVal').textContent = `${cap} mm/h`;
  const hy = stats.design.hyetographs_mmh[S.Tr]; const mm = hy ? hy.reduce((a, b) => a + b, 0) * stats.design.block_min / 60 : null;
  $('#stormMm').textContent = mm ? `${fmt(mm, 0)} mm en 1 h` : '';
  const sliderOn = S.mode === 'depth' || S.mode === 'freq';
  $('#capBox').classList.toggle('dim', !sliderOn);
  $('#stormBox').classList.toggle('dim', S.mode !== 'depth');
  if (map.getLayer('obs')) map.setLayoutProperty('obs', 'visibility', S.obs ? 'visible' : 'none');
  const pb = $('#play'); pb.hidden = !(stats.web.frames_min || []).length || S.mode !== 'depth' || S.Tr !== 10;
  pb.textContent = playTimer ? '■ detener' : '▶ minuto a minuto';
  kpis(); legend(); chart(); paint();
}

function kpis() {
  const g = stats.gapClassification.urbanKm2;
  let a = '–', ak = '', d = '–', dk = '';
  if (frameOn()) {
    a = `min ${S.frame}`; ak = `de ${stats.design.simulated_min} simulados (lluvia: minutos 0–${stats.design.stormDuration_min})`;
    d = `${frameCaps()[frameK()]} mm/h`; dk = 'capacidad mostrada en la animación (0, 20 o 40)';
  } else if (S.mode === 'depth') {
    const c = curve('mid', S.Tr); const v = c?.[S.k], v0 = c?.[0];
    a = fmt(v, 1); ak = `km² urbanos con ≥15 cm (Tr ${S.Tr}, ${CAPS[S.k]} mm/h)`;
    d = v0 ? (S.k ? `−${fmt(100 * (1 - v / v0), 0)} %` : '0 %') : '–'; dk = 'vs. sin drenaje (0 mm/h)';
  } else if (S.mode === 'freq') {
    const c = meanCurve(); a = fmt(c[S.k], 1); ak = `km² urbanos ≥15 cm, promedio de las ${(stats.combos || []).length} corridas con ${CAPS[S.k]} mm/h`;
    d = c[0] ? (S.k ? `−${fmt(100 * (1 - c[S.k] / c[0]), 0)} %` : '0 %') : '–'; dk = 'vs. sin drenaje';
  } else if (S.mode === 'gap' || S.mode === 'sens') {
    a = fmt(g.a, 1); ak = 'km² urbanos que se inundan aun con ≥40 mm/h (a)';
    d = fmt(g.b, 1); dk = 'km² donde el drenaje sí resuelve (b)';
  } else if (S.mode === 'ageb') {
    if (ageb) { const fs = ageb.fc.features; const na = fs.filter(f => f.properties.cls === 'a').length, nb = fs.filter(f => f.properties.cls === 'b').length;
      const ben = fs.reduce((s, f) => s + (f.properties.popBen || 0), 0);
      a = `${na} / ${nb}`; ak = 'AGEB con brecha a (persistente) / b (drenaje paga)'; d = ben ? fmt(ben / 1000, 0) + ' mil' : '–'; dk = 'personas fuera de celdas inundadas al pasar de 0 a 40 mm/h (promedio de corridas)'; }
    else { a = '–'; ak = 'AGEB aún no publicadas por infra-data'; }
  }
  $('#kpiArea').textContent = a; $('#kpiAreaK').textContent = ak; $('#kpiDelta').textContent = d; $('#kpiDeltaK').textContent = dk;
}

function legend() {
  const L = $('#legend');
  const ramp = (cols, labels, ttl, sub) => `<div class="ttl">${ttl}</div><div class="ramp">${cols.filter(Boolean).map(c => `<span style="background:rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})"></span>`).join('')}</div><div class="rampl">${labels.filter(Boolean).map(l => `<span>${l}</span>`).join('')}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
  const row = (col, txt) => `<div class="row"><span class="sw" style="background:${col}"></span><span>${txt}</span></div>`;
  const obs = '';
  const g = stats.gapClassification.urbanKm2;
  if (S.mode === 'depth') L.innerHTML = ramp(DEPTH, DEPTH_LBL, frameOn() ? `Profundidad simulada en el minuto ${S.frame} (Tr 10)` : 'Profundidad máxima simulada', `Infiltración media · ${stats.design.simulated_min} min simulados · celdas de 20 m`) + obs;
  else if (S.mode === 'freq') L.innerHTML = ramp(FREQ, FREQ_LBL, `Frecuencia de inundación ≥15 cm con ${CAPS[S.k]} mm/h`, `Porcentaje de las ${(stats.combos || []).length} corridas (tormenta × infiltración) a esa capacidad`) + obs;
  else if (S.mode === 'gap') L.innerHTML = `<div class="ttl">Brecha de infraestructura (celdas urbanas)</div>` +
    row(GAP.a, `<b>a · persistente</b> — se inunda aun con ≥40 mm/h de drenaje repartido → vaso regulador, colector o cauce mayor, regrading o reubicación (${fmt(g.a, 1)} km²)`) +
    row(GAP.b, `<b>b · responde al drenaje</b> — se inunda con poca capacidad y deja de hacerlo con más (${fmt(g.b, 1)} km²)`) +
    row('rgba(107,107,102,0.5)', `c · rara vez se inunda (${fmt(g.c, 0)} km²)`) + obs;
  else if (S.mode === 'sens') L.innerHTML = `<div class="ttl">Sensibilidad al drenaje</div><div class="ramp">${[70, 120, 170, 215, 250].map(a => `<span style="background:rgba(25,158,112,${a / 255})"></span>`).join('')}</div><div class="rampl"><span>0,5</span><span>1</span><span>2</span><span>4</span><span>≥8 cm</span></div><div class="sub">Centímetros menos de agua por cada +10 mm/h de capacidad (promedio del ensamble, de 0 a 40 mm/h)</div>` + obs;
  else if (S.mode === 'ageb') L.innerHTML = ageb ? `<div class="ttl">AGEB urbanas — clase dominante</div>` + row(GAP.a, 'a · persistente') + row(GAP.b, 'b · responde al drenaje') + row('rgba(107,107,102,0.6)', 'c · rara vez (<5 % de celdas urbanas en a o b)') + `<div class="sub">Clase dominante entre las celdas urbanas propensas de cada AGEB; opacidad = frecuencia media de inundación. Toca una AGEB para ver población (Censo 2020, INEGI) y beneficio estimado.</div>` + obs
    : `<div class="ttl">AGEB</div><div class="sub">Pendiente: el perfil de AGEB (infra-data) aún no está publicado. Esta vista se activa sola cuando exista.</div>`;
}

// ---- performance curve (single y-axis: km² of urban cells ≥15 cm)
function chart() {
  const el = $("#chart"); const Wd = 340, Ht = 156, m = { l: 50, r: 40, t: 10, b: 22 };
  const iw = Wd - m.l - m.r, ih = Ht - m.t - m.b;
  const series = STORMS.map(Tr => ({ Tr, v: curve('mid', Tr) })).filter(s => s.v);
  let ymax = 0; for (const s of series) for (const v of s.v) if (v != null) ymax = Math.max(ymax, v);
  for (const inf of ['low']) { const c = curve(inf, S.Tr); if (c) for (const v of c) if (v != null) ymax = Math.max(ymax, v); }
  ymax = Math.ceil(ymax / 20) * 20 || 20;
  const X = k => m.l + iw * k / (CAPS.length - 1), Y = v => m.t + ih * (1 - v / ymax);
  const path = arr => arr.map((v, k) => v == null ? '' : `${k && arr[k - 1] != null ? 'L' : 'M'}${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const lo = CAPS.indexOf(20), hi = CAPS.indexOf(30);
  let s = `<svg viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="Curva: área urbana inundada según capacidad de drenaje">`;
  if (lo >= 0) s += `<rect x="${X(lo)}" y="${m.t}" width="${X(hi) - X(lo)}" height="${ih}" fill="rgba(237,161,0,0.13)"/>`;
  s += `<g class="grid">${[0.5, 1].map(f => `<line x1="${m.l}" x2="${m.l + iw}" y1="${Y(ymax * f)}" y2="${Y(ymax * f)}"/>`).join('')}</g>`;
  s += `<g class="axis"><line x1="${m.l}" x2="${m.l + iw}" y1="${m.t + ih}" y2="${m.t + ih}"/>${CAPS.map((c, k) => `<text x="${X(k)}" y="${Ht - 6}" text-anchor="middle">${c}</text>`).join('')}${[0, 0.5, 1].map(f => `<text x="${m.l - 5}" y="${Y(ymax * f) + 3}" text-anchor="end">${fmt(ymax * f, 0)}${f === 1 ? ' km²' : ''}</text>`).join('')}<text x="${m.l + iw + 4}" y="${Ht - 6}">mm/h</text></g>`;
  const freqMode = S.mode === 'freq';
  if (!freqMode) { // infiltration uncertainty band for the selected storm
    const a = curve('low', S.Tr), b = curve('high', S.Tr);
    if (a && b && a.every(v => v != null) && b.every(v => v != null)) s += `<path d="${path(a)}L${b.map((v, k) => `${X(b.length - 1 - k).toFixed(1)},${Y(b[b.length - 1 - k]).toFixed(1)}`).join('L')}Z" fill="${STORM_COL[S.Tr]}" opacity="0.16"/>`;
  }
  for (const sr of series) { const sel = !freqMode && sr.Tr === S.Tr; s += `<path d="${path(sr.v)}" fill="none" stroke="${STORM_COL[sr.Tr]}" stroke-width="${sel ? 2.5 : 1.2}" opacity="${sel ? 1 : freqMode ? 0.35 : 0.5}" stroke-linejoin="round" stroke-linecap="round"/>`; }
  if (freqMode) { const mc = meanCurve(); s += `<path d="${path(mc)}" fill="none" stroke="#f0efec" stroke-width="2.5"/>`; }
  // direct labels at the right end (selected + extremes)
  const lab = new Set([STORMS[0], STORMS[STORMS.length - 1], S.Tr]); let lastY = [];
  for (const sr of series) if (lab.has(sr.Tr) && !freqMode) { const v = sr.v[sr.v.length - 1]; if (v == null) continue; let y = Y(v) + 3; for (const ly of lastY) if (Math.abs(ly - y) < 10) y = ly + (y >= ly ? 10 : -10); lastY.push(y); s += `<text class="tip" x="${m.l + iw + 4}" y="${y}" fill="#c3c2b7" style="fill:#c3c2b7">Tr ${sr.Tr}</text>`; }
  if (freqMode) { const mc = meanCurve(); s += `<text class="tip" x="${m.l + iw + 4}" y="${Y(mc[mc.length - 1]) + 3}">media</text>`; }
  // current capacity marker
  const cur = freqMode ? meanCurve()[S.k] : curve('mid', S.Tr)?.[S.k];
  s += `<line x1="${X(S.k)}" x2="${X(S.k)}" y1="${m.t}" y2="${m.t + ih}" stroke="#f0efec" stroke-width="1" stroke-dasharray="2 3" opacity="0.7"/>`;
  if (cur != null) s += `<circle cx="${X(S.k)}" cy="${Y(cur)}" r="4.5" fill="${freqMode ? '#f0efec' : STORM_COL[S.Tr]}" stroke="#0e1316" stroke-width="2"/><text class="tip" x="${X(S.k) + (S.k > CAPS.length / 2 ? -7 : 7)}" y="${Y(cur) - 8}" text-anchor="${S.k > CAPS.length / 2 ? 'end' : 'start'}">${fmt(cur, 1)} km²</text>`;
  s += `<rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" id="chartHit"/></svg>`;
  el.innerHTML = s;
  const hit = el.querySelector('#chartHit');
  const pick = e => { const r = hit.getBoundingClientRect(); const k = Math.round((e.clientX - r.left) / r.width * (CAPS.length - 1)); return Math.max(0, Math.min(CAPS.length - 1, k)); };
  hit.onclick = e => { if (DEMO) return; S.k = pick(e); update(); };
  hit.onmousemove = e => { hit.style.cursor = 'pointer'; hit.setAttribute('aria-label', `${CAPS[pick(e)]} mm/h`); };
  $('#chartTitle').textContent = freqMode ? 'Área urbana inundada (≥15 cm), media del ensamble' : `Área urbana inundada (≥15 cm) · banda = incertidumbre de infiltración (Tr ${S.Tr})`;
}

// ---------------------------------------------------------------- probe (click/hover on the map)
let indicators = null;
async function probeAt(e) {
  if (DEMO) return;
  if (S.mode === 'ageb' && ageb) {
    const f = map.queryRenderedFeatures(e.point, { layers: ['ageb-fill'] })[0]; const p = $('#probe');
    if (!f) { p.hidden = true; return; }
    const q = f.properties, pct = v => v == null ? '–' : fmt(100 * v, 0) + ' %';
    const cl = { a: '<b style="color:#ec835a">a · persistente</b>', b: '<b style="color:#3ec795">b · el drenaje paga</b>', c: 'c · rara vez' }[q.cls];
    p.innerHTML = `<div><b>AGEB ${esc(q.id)}</b> <span class="m">${esc(q.name)}</span></div><div>${cl}</div><div>Celdas urbanas inundadas: <b>${pct(q.s0)}</b> sin drenaje → <b>${pct(q.s40)}</b> con 40 mm/h</div><div>Población 2020: ${fmt(q.pop, 0)} · beneficio estimado: ${fmt(q.popBen, 0)} personas${q.rank ? ` (puesto ${q.rank})` : ''}</div>${q.inl != null ? `<div>Con coladeras reales (INEGI INV 2020): <b>+${fmt(100 * q.inl, 1)} %</b> de celdas inundadas vs. capacidad uniforme</div>` : ''}<div class="m">promedio de corridas; supone población uniforme en lo construido</div>`;
    p.style.left = Math.min(innerWidth - 270, e.point.x + 14) + 'px'; p.style.top = Math.min(innerHeight - 140, e.point.y + 14) + 'px'; p.hidden = false; return;
  }
  if (!indicators) indicators = await decode('indicators.png');
  const im = stats.web.mercatorImage.bounds;
  const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const fx = (e.lngLat.lng - im.west) / (im.east - im.west), fy = (mercY(im.north) - mercY(e.lngLat.lat)) / (mercY(im.north) - mercY(im.south));
  const p = $('#probe');
  if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) { p.hidden = true; return; }
  const x = Math.floor(fx * indicators.w), y = Math.floor(fy * indicators.h); const v = indicators.v[y * indicators.w + x];
  const fr = (v >> 16) & 255, gp = (v >> 8) & 255, se = (v & 255) / 10;
  let html;
  if (fr === 255) html = '<b>Cuerpo de agua permanente</b><div class="m">excluido del análisis</div>';
  else if (v === 0) html = '<b>Sin inundación modelada</b><div class="m">o fuera del dominio simulado</div>';
  else {
    const cls = { 1: '<b style="color:#ec835a">a · persistente</b> — vaso, colector mayor o regrading', 2: '<b style="color:#3ec795">b · responde al drenaje</b>', 3: 'c · rara vez se inunda' }[gp] || 'zona no urbana';
    let dep = '';
    if (S.mode === 'depth') { const d = await decode(dataName()); const dv = d.v[Math.floor(fy * d.h) * d.w + Math.floor(fx * d.w)]; const c = (dv >> dataShift()) & 7; dep = `<div>Este escenario: <b>${c ? DEPTH_LBL[c] : '< 5 cm'}</b></div>`; }
    html = `<div>Inundada (≥15 cm) en <b>${fr} %</b> de ${stats.runsDone} corridas</div>${dep}<div>${cls}</div><div class="m">−${fmt(se, 1)} cm por cada +10 mm/h de drenaje</div>`;
  }
  p.innerHTML = html + '<div class="m">celda de 20 m · modelo exploratorio</div>';
  p.style.left = Math.min(innerWidth - 270, e.point.x + 14) + 'px'; p.style.top = Math.min(innerHeight - 120, e.point.y + 14) + 'px'; p.hidden = false;
}

// ---------------------------------------------------------------- demo (deterministic: state = f(t))
const DEMO_DURATION = 32;
const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
const lerp = (a, b, f) => a + (b - a) * f;
function camAt(keys, t) {
  let i = 0; while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
  const f = b.t > a.t ? ease((t - a.t) / (b.t - a.t)) : 0;
  return { center: [lerp(a.c[0], b.c[0], f), lerp(a.c[1], b.c[1], f)], zoom: lerp(a.z, b.z, f), pitch: lerp(a.p, b.p, f), bearing: lerp(a.b, b.b, f) };
}
let demoKeys = null;
function demoSetup() {
  const H = stats.highlights || {};
  const A = H.a_persistente?.[0] || { lon: -103.33, lat: 20.6 }, B = H.b_responde?.[0] || { lon: -103.37, lat: 20.67 };
  const C = [-103.355, 20.645];
  demoKeys = [
    { t: 0, c: C, z: 10.2, p: 36, b: -14 }, { t: 6, c: [-103.36, 20.655], z: 10.45, p: 40, b: -6 },
    { t: 14, c: [-103.36, 20.66], z: 10.95, p: 46, b: 8 }, { t: 17.5, c: [-103.36, 20.66], z: 10.6, p: 42, b: 6 },
    { t: 21, c: [A.lon, A.lat], z: 13.6, p: 55, b: -18 }, { t: 23.5, c: [A.lon, A.lat], z: 13.85, p: 57, b: -10 },
    { t: 26.5, c: [B.lon, B.lat], z: 13.6, p: 55, b: 14 }, { t: 28.5, c: [B.lon, B.lat], z: 13.85, p: 57, b: 20 },
    { t: 32, c: C, z: 10.4, p: 36, b: 0 },
  ];
}
function demoState(t) {
  const st = { cam: camAt(demoKeys, t), mode: 'depth', Tr: 10, k: 0, obs: false, frame: null, cap: '' };
  const v0 = curve('mid', 10)?.[0], fr = (stats.web.frames_min || []).filter(m => m <= 60);
  if (t < 6 && fr.length) { st.frame = fr[Math.min(fr.length - 1, Math.floor(t / (6 / fr.length)))]; st.cap = `Tormenta de 60 min (periodo de retorno 10 años) · minuto ${st.frame}<small>sin drenaje: el agua corre por las calles y se junta en los bajíos</small>`; }
  else if (t < 14) { st.k = Math.min(CAPS.length - 1, Math.floor((t - 6) / (8 / CAPS.length))); const v = curve('mid', 10)?.[st.k]; st.cap = `Drenaje: ${CAPS[st.k]} mm/h<small>${v0 ? `área urbana con ≥15 cm: ${fmt(v, 0)} km² (${st.k ? '−' + fmt(100 * (1 - v / v0), 0) + ' %' : 'sin drenaje'})` : ''}</small>`; }
  else if (t < 17.5) { st.k = CAPS.length - 1; st.Tr = STORMS[STORMS.length - 1]; st.cap = `Tormenta de 100 años: ni con ${CAPS[st.k]} mm/h alcanza<small>el agua regresa a los mismos bajíos</small>`; }
  else if (t < 24) { st.mode = 'gap'; st.cap = `<span style="color:#ec835a">Naranja</span>: se inunda aun con mucho drenaje<small>ahí no basta más drenaje repartido: vasos reguladores, un colector mayor, regrading o reubicación</small>`; }
  else if (t < 28.5) { st.mode = 'gap'; st.cap = `<span style="color:#3ec795">Verde</span>: ahí ampliar el drenaje sí paga<small>se inunda con poca capacidad y se seca con más</small>`; }
  else { st.mode = 'gap'; st.obs = true; const v = stats.validation?.['puntos (radio 60 m)']; st.cap = `Anillos blancos: sitios de inundación observados (IMEPLAN)<small>${v?.maxFreqInFootprint ? `coincidencia AUC ${fmt(v.maxFreqInFootprint.auc, 2)} (0,5 = azar) · modelo exploratorio, no pronóstico` : 'modelo exploratorio, no pronóstico'}</small>`; }
  return st;
}
let lastCap = '';
function renderDemo(t) {
  const st = demoState(t);
  map.jumpTo(st.cam);
  const changed = st.mode !== S.mode || st.Tr !== S.Tr || st.k !== S.k || st.obs !== S.obs || st.frame !== S.frame;
  Object.assign(S, { mode: st.mode, Tr: st.Tr, k: st.k, obs: st.obs, frame: st.frame });
  if (changed) update();
  if (st.cap !== lastCap) { const c = $('#caption'); c.innerHTML = st.cap; c.classList.toggle('show', !!st.cap); lastCap = st.cap; }
}
const preload = () => Promise.all([decode('depth-tr10.png'), decode(`depth-tr${STORMS[STORMS.length - 1]}.png`), ...(stats.web.frames_min || []).filter(m => m <= 60).map(m => decode(`frame-t${String(m).padStart(3, '0')}.png`))]);
function setupDemo() {
  demoSetup();
  const nextRender = () => new Promise(res => { map.once('render', () => requestAnimationFrame(() => res())); map.triggerRepaint(); });
  async function settle(maxMs = 9000) { const t0 = performance.now(); await nextRender(); while (performance.now() - t0 < maxMs) { if (map.areTilesLoaded() && map.isStyleLoaded()) break; await nextRender(); } }
  let autoplay = DEMO, start = performance.now();
  window.__cauceDemo = {
    duration_s: DEMO_DURATION,
    async seek(t) { autoplay = false; await preload(); renderDemo(t); await paint(); await settle(); renderDemo(t); await nextRender(); return t; },
    play() { autoplay = true; start = performance.now(); loop(); },
    pause() { autoplay = false; },
  };
  const loop = () => { if (!autoplay) return; let t = (performance.now() - start) / 1000; if (t > DEMO_DURATION + 2) { start = performance.now(); t = 0; } renderDemo(t); requestAnimationFrame(loop); };
  if (Q.get('t') !== null) { autoplay = false; window.__cauceDemo.seek(+Q.get('t')); }
  else if (DEMO) preload().then(() => { start = performance.now(); loop(); });
  window.__cauceDemoReady = true;
}

// ---------------------------------------------------------------- boot
async function boot() {
  try { const r = await fetch(BASE + 'stats.json', { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); stats = await r.json(); }
  catch { $('#loading').textContent = 'El ensamble aún se está calculando en W10. Vuelve en un rato.'; return; }
  CAPS = stats.design.capacities_mmh; STORMS = stats.design.storms_Tr_years;
  // deep-link params: ?mode=gap&tr=10&cap=20&ll=-103.35,20.66&z=12&pitch=50&bearing=10
  if (['depth', 'freq', 'gap', 'sens', 'ageb'].includes(Q.get('mode'))) S.mode = Q.get('mode');
  if (Q.get('tr')) S.Tr = +Q.get('tr');
  if (Q.get('cap') && CAPS.includes(+Q.get('cap'))) S.k = CAPS.indexOf(+Q.get('cap'));
  if (!STORMS.includes(S.Tr)) S.Tr = STORMS[0];
  const ll = (Q.get('ll') || '').split(',').map(Number);
  map = new maplibregl.Map({ container: 'map', style: buildStyle(), center: ll.length === 2 && ll.every(isFinite) ? ll : [-103.355, 20.645], zoom: Q.get('z') ? +Q.get('z') : innerWidth < 720 ? 9.6 : 10.3, pitch: Q.get('pitch') ? +Q.get('pitch') : 38, bearing: Q.get('bearing') ? +Q.get('bearing') : -12, maxPitch: 70, minZoom: 8.5, maxZoom: 16.5,
    attributionControl: { compact: innerWidth < 720, customAttribution: 'Modelo: cauce. sim-drenaje · MDT INEGI 5 m · ESA WorldCover 2021 · Overture Maps · IMEPLAN MUI 2026 · IDF: Campos-Aranda (2010)' }, canvasContextAttributes: { preserveDrawingBuffer: DEMO } });
  if (!DEMO) map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.on('load', async () => {
    map.setTerrain({ source: 'terrain', exaggeration: 1 });
    addData(); buildUI();
    await decode(dataName());
    update();
    $('#loading').classList.add('done');
    loadAgeb();
    setupDemo();
  });
  map.on('click', probeAt);
  map.on('movestart', () => { $('#probe').hidden = true; });
}
if (window.maplibregl) boot(); else window.addEventListener('load', boot);
