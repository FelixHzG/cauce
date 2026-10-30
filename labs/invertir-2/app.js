// cauce. labs · invertir-2 — "¿Dónde cae el próximo peso para el drenaje?"
// Illustrated scrollytelling: rain on the 5 m terrain → runoff → ponding → who lives there → pipes vs storage → places.
// One state function drives everything (camera, layers, effects, cards) from (a, b, e, step-progress), so scroll,
// autoplay and window.__cauceDemo.seek(t) all render the same deterministic frame.
import { gota, coin, cloud, icon } from './art.js';

const Q = new URLSearchParams(location.search);
const DEMO = ['1', 'true', 'yes'].includes(Q.get('demo'));
const AUTOPLAY = DEMO && !Q.has('still');
const SH = '/labs/shared';
const ORIGIN = location.origin;
const DUR = 30;

// ------------------------------------------------------------------ utils
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const fmt = n => n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('es-MX');
const round = (n, k) => Math.round(n / k) * k;
const approx = n => n >= 1e6 ? (n / 1e6).toLocaleString('es-MX', { maximumFractionDigits: 2 }) + ' millones'
  : n >= 20000 ? fmt(round(n, 1000)) : n >= 2000 ? fmt(round(n, 100)) : n >= 200 ? fmt(round(n, 10)) : fmt(n);
function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
async function getJSON(u) { try { const r = await fetch(u, { cache: 'no-cache' }); if (!r.ok) return null; return await r.json(); } catch { return null; } }
const abs = u => !u ? u : /^https?:/.test(u) ? u : ORIGIN + u;
const raf = () => new Promise(r => requestAnimationFrame(() => r()));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MUN = { GDL: 'Guadalajara', ZPN: 'Zapopan', TLQ: 'San Pedro Tlaquepaque', TON: 'Tonalá', TLJ: 'Tlajomulco de Zúñiga', SLT: 'El Salto', JUA: 'Juanacatlán', IXT: 'Ixtlahuacán de los Membrillos', ZAP: 'Zapotlanejo', ACA: 'Acatlán de Juárez' };
const mercX = lon => (lon + 180) / 360;
const mercY = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2;
const unX = x => x * 360 - 180;
const unY = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;

// ------------------------------------------------------------------ data
const D = {};
const MOD = {};
async function loadAll() {
  const M = `${SH}/hazard/modeled`;
  const R = ['acumulacion', 'hand', 'depresiones', 'susceptibilidad'];
  const [ageb, obs, ww, wb, sitios, lms, hz, ter, sdStats, srStats, shStats, framesD, framesH, agebDr, agebTer, ...relMeta] = await Promise.all([
    getJSON(`${SH}/infra/ageb-profile.geojson`), getJSON(`${SH}/hazard/observed-imeplan-2026.geojson`),
    getJSON(`${SH}/infra/osm-waterways.geojson`), getJSON(`${SH}/hazard/water-bodies.geojson`),
    getJSON('data/sitios.json'), getJSON('data/landmarks.json'), getJSON(`${SH}/hazard/index.json`), getJSON(`${SH}/terrain/index.json`),
    getJSON(`${M}/sim-drenaje/stats.json`), getJSON(`${M}/sim-relieve/stats.json`), getJSON(`${M}/sim-hidro/stats.json`),
    getJSON('data/frames-drenaje/frames.json'), getJSON('data/frames-hidro/frames.json'), getJSON(`${M}/sim-drenaje/ageb-drainage.json`), getJSON(`${M}/sim-relieve/ageb-terrain.json`),
    ...R.map(k => getJSON(`${M}/sim-relieve/tiles/${k}/meta.json`)),
  ]);
  Object.assign(D, { ageb, obs, ww, wb, sitios, lms, hz, ter, sdStats, srStats, shStats, framesD, framesH, agebDr, agebTer, relMeta: Object.fromEntries(R.map((k, i) => [k, relMeta[i]])) });
  await resolveModels();
}

// Which simulation products exist right now (registered in hazard/index.json, or published but not yet registered).
async function resolveModels() {
  const L = D.hz?.layers || [];
  const byId = id => L.find(l => l.id === id);
  const M = `${SH}/hazard/modeled`;
  for (const k of Object.keys(MOD)) delete MOD[k];
  // sim-relieve rasters
  const rel = (key, id) => {
    const e = byId(id); const m = D.relMeta[key];
    if (e && (e.url || e.tiles)) return { tiles: [abs(e.tiles?.[0] || e.url)], minzoom: e.minzoom ?? 8, maxzoom: e.maxzoom ?? 15, bounds: e.bounds, registered: true };
    if (m) return { tiles: [abs(`${M}/sim-relieve/tiles/${key}/{z}/{x}/{y}.png`)], minzoom: m.zmin, maxzoom: m.zmax, bounds: m.bounds, registered: false };
    return null;
  };
  MOD.acc = rel('acumulacion', 'sim-relieve-acumulacion');
  MOD.hand = rel('hand', 'sim-relieve-hand');
  MOD.dep = rel('depresiones', 'sim-relieve-depresiones-tiles');
  MOD.susc = rel('susceptibilidad', 'sim-relieve-susceptibilidad');
  MOD.relieveRegistered = L.some(l => l.producer === 'sim-relieve');
  MOD.hyp = D.srStats?.hypothesis || null;
  // sim-drenaje
  const sd = D.sdStats;
  if (sd?.web?.tiles?.gap) {
    const e = byId('sim-drenaje-gap') || L.find(l => l.producer === 'sim-drenaje' && /gap|brecha/i.test(l.id));
    const b = sd.web.mercatorImage.bounds;
    MOD.gap = { tiles: [abs(e?.url && /\{z\}/.test(e.url) ? e.url : `${M}/sim-drenaje/tiles/gap/{z}/{x}/{y}.png`)], minzoom: sd.web.tileZoom?.[0] ?? 9, maxzoom: sd.web.tileZoom?.[1] ?? 14,
      bounds: [b.west, b.south, b.east, b.north], registered: L.some(l => l.producer === 'sim-drenaje'), km2: sd.gapClassification?.urbanKm2,
      runs: sd.runsFinished ?? sd.runsDone, planned: sd.runsPlanned, indicators: `${M}/sim-drenaje/web/indicators.png`, img: sd.web.mercatorImage };
  }
  // dynamic water: sim-hidro 5 m frames (preferred) → sim-drenaje 20 m frames (derived copy) → none (observed only)
  MOD.water = null;
  const hid = byId('sim-hidro-t10-profundidad') || L.find(l => l.producer === 'sim-hidro' && l.type === 'raster-tiles');
  if (hid?.url) MOD.hidTiles = { tiles: [abs(hid.url)], minzoom: hid.minzoom ?? 10, maxzoom: hid.maxzoom ?? 15, bounds: hid.bounds };
  const fu = hid?.extras?.frames;
  const sc = D.shStats?.scenarios?.T10;
  if (hid && D.framesH?.frames?.length) {
    // our recoloured copy of the sim-hidro frames (>= 30 cm, story palette); see build/frames-hidro.mjs
    MOD.water = { kind: 'hidro', frames: D.framesH.frames.map(f => ({ t_min: f.t_min, url: abs(`/labs/invertir-2/data/frames-hidro/${f.url}`) })), coordinates: D.framesH.coordinates, res: '5 m', Tr: 10,
      rainMm: D.framesH.rainMm ?? sc?.storm?.depthMm, cap: D.framesH.sewerMmh ?? D.shStats?.sewerMmh, registered: true, classes: ['30–60 cm', '60 cm–1 m', 'más de 1 m'], valid: sc?.validation };
  } else if (fu) {
    const fj = await getJSON(abs(fu));
    if (fj?.frames?.length && fj.coordinates) {
      const base = abs(fu).replace(/[^/]*$/, '');
      let fr = fj.frames.filter(f => (f.t_min ?? f.t_s / 60) <= 120).map(f => ({ t_min: f.t_min ?? f.t_s / 60, url: abs(/^https?:|^\//.test(f.url) ? f.url : base + f.url) }));
      const step = Math.max(1, Math.ceil(fr.length / 12)); fr = fr.filter((f, i) => i % step === 0);
      MOD.water = { kind: 'hidro', frames: fr, coordinates: fj.coordinates, res: '5 m', Tr: hid.returnPeriodYears || 10, rainMm: hid.rainMm, cap: D.shStats?.sewerMmh, registered: true, classes: ['15–30 cm', '30–60 cm', 'más de 60 cm'], raw: true, valid: sc?.validation };
    }
  }
  if (!MOD.water && D.framesD?.frames?.length) {
    const f = D.framesD;
    MOD.water = { kind: 'drenaje', frames: f.frames.filter(x => x.t_min >= 10).map(x => ({ t_min: x.t_min, url: abs(`/labs/invertir-2/data/frames-drenaje/${x.url}`) })), coordinates: f.coordinates, res: '20 m', Tr: f.Tr, cap: f.capacity_mmh,
      runs: f.runsFinished, planned: f.runsPlanned, registered: L.some(l => l.producer === 'sim-drenaje'), classes: ['30–50 cm', '50 cm–1 m', 'más de 1 m'],
      rainMm: D.sdStats?.design?.hyetographs_mmh?.['10'] ? D.sdStats.design.hyetographs_mmh['10'].reduce((a, v) => a + v, 0) * (D.sdStats.design.block_min || 5) / 60 : null };
  }
  // rain depth of the 10-year, 60-min design storm (sim-drenaje IDF) for the copy
  const h10 = sd?.design?.hyetographs_mmh?.['10'];
  MOD.rain10 = h10 ? h10.reduce((s, v) => s + v, 0) * (sd.design.block_min || 5) / 60 : null;
}

// ------------------------------------------------------------------ derived numbers
const S = {};
function derive() {
  const F = (D.ageb?.features || []).map(f => f.properties);
  const P = Object.fromEntries(F.map(p => [p.cvegeo, p]));
  D.P = P;
  const sum = (a, f) => a.reduce((s, p) => s + (f(p) || 0), 0);
  const touch = F.filter(p => p.imeplan_area_pct > 0);
  const hi = p => /alto/i.test(p.gm_2020 || '') && !/bajo/i.test(p.gm_2020 || '');
  Object.assign(S, {
    pobTotal: sum(F, p => p.pob), touchN: touch.length, touchPob: sum(touch, p => p.pob),
    inside: sum(F, p => p.pob * (p.imeplan_area_pct || 0) / 100),
    insideHi: sum(F.filter(hi), p => p.pob * (p.imeplan_area_pct || 0) / 100),
    touchHiPob: sum(touch.filter(hi), p => p.pob),
    esc: sum(touch, p => p.n_escuela), guard: sum(touch, p => p.n_guarderia), salud: sum(touch, p => (p.n_hospital || 0) + (p.n_clinica || 0)),
    entubadoKm: sum(F, p => p.osm_entubado_m) / 1000,
  });
  const polys = (D.obs?.features || []).filter(f => f.geometry.type !== 'Point');
  S.nSitios = polys.filter(f => /sitio/i.test(f.properties.category)).length;
  S.nZonas = polys.filter(f => /zona/i.test(f.properties.category)).length;
  S.nSiteIds = new Set(polys.map(f => String(f.properties.name).split('/')[0])).size;
  const lm = Object.fromEntries((D.lms?.landmarks || []).map(l => [l.id, l]));
  D.LM = lm;
  // places (IMEPLAN sites) with runtime joins
  D.places = (D.sitios?.sites || []).map(s => {
    let ppl = 0, score = 0, hiP = 0, prioW = 0; const ag = [];
    for (const [k, m2] of Object.entries(s.ageb_m2 || {})) {
      const p = P[k]; if (!p || !p.pob || !p.area_km2) continue;
      const v = p.pob * m2 / (p.area_km2 * 1e6);
      ppl += v; score += v * (p.prio_exploratoria || 0) / 100; prioW += v * (p.prio_exploratoria || 0); if (hi(p)) hiP += v; ag.push(p);
    }
    const sumA = f => ag.reduce((t, p) => t + (p[f] || 0), 0);
    return { ...s, ppl, score, hiP, prio: ppl ? prioW / ppl : null, agebs: ag, esc: sumA('n_escuela'), guard: sumA('n_guarderia'), salud: sumA('n_hospital') + sumA('n_clinica'),
      munName: ag[0]?.mun_nombre || MUN[s.mun] || s.mun };
  }).filter(p => p.ppl > 0);
  // sim-drenaje per-AGEB exposure by drainage capacity (ensemble mean over storms)
  const dr = D.agebDr?.agebs;
  if (dr) {
    const E = {}; for (const v of Object.values(dr)) for (const [c, n] of Object.entries(v.population_exposed_by_cap || {})) E[c] = (E[c] || 0) + (n || 0);
    S.expByCap = Object.keys(E).length ? E : null; S.drRuns = D.agebDr.meta?.runs;
  }
  const tr = D.agebTer?.agebs;
  if (tr) for (const p of D.places) {
    let w = 0, v = 0, h = 0; for (const [k, m2] of Object.entries(p.ageb_m2 || {})) { const t = tr[k]; if (!t || t.susc_mean == null) continue; w += m2; v += m2 * t.susc_mean; h += m2 * (t.hand_lt1_pct || 0); }
    if (w) p.terr = { susc: v / w, handLt1: h / w };
  }
  rankPlaces('score');
}
const RANKS = {
  score: { label: 'Gente × prioridad (solo registro)', key: p => p.score },
  ppl: { label: 'Solo gente', key: p => p.ppl },
  marg: { label: 'Marginación', key: p => p.hiP + p.ppl * 1e-3 },
};
const both = p => p.ppl * (p.hidroS?.f30 ?? 0); // people in the part of the recorded zone that the 5 m model also floods >= 30 cm
function rankPlaces(mode) {
  const pool = RANKS[mode].needsModel ? D.places.filter(p => p.hidroS) : D.places;
  const sorted = [...pool].sort((a, b) => RANKS[mode].key(b) - RANKS[mode].key(a));
  const out = [];
  for (const p of sorted) { // one coin per neighbourhood: skip sites within 1.4 km of an already chosen one
    if (out.some(q => Math.hypot((q.c[0] - p.c[0]) * 104, (q.c[1] - p.c[1]) * 111) < 2)) continue;
    out.push(p); if (out.length === 5) break;
  }
  if (mode === (D.defaultRank || 'score')) D.top = out;
  D.rankMode = mode; D.ranked = out;
  return out;
}
const placeTitle = p => {
  if (p.barrio && p.barrio.dist_m < 500) return p.barrio.name;
  let r = (p.ref || '').replace(/\s+/g, ' ').trim();
  r = r.replace(/^(zona circundante a|norte de|sur de|oriente de|poniente de|alrededor de)\s+/i, '').replace(/\s+hasta\s.*$/i, '').replace(/\s+hacia\s+/i, '–');
  r = r.charAt(0).toUpperCase() + r.slice(1);
  return r.length > 46 ? r.slice(0, 44).replace(/\s\S*$/, '') + '…' : r || p.id;
};

// sample sim-drenaje indicators (R = flood freq %, G = gap class) inside each top site's IMEPLAN polygons
async function sampleGap(places) {
  if (!MOD.gap) return;
  try {
    const blob = await (await fetch(MOD.gap.indicators, { cache: 'no-cache' })).blob();
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    const b = MOD.gap.img.bounds, W = bmp.width, H = bmp.height;
    const x0 = mercX(b.west), x1 = mercX(b.east), y0 = mercY(b.north), y1 = mercY(b.south);
    const geo = siteGeoms();
    for (const p of places) {
      if (p.gapS) continue;
      const g = geo.get(p.id); if (!g) continue;
      const [w, s, e, n] = p.bbox; const px = Math.floor((mercX(w) - x0) / (x1 - x0) * W), qx = Math.ceil((mercX(e) - x0) / (x1 - x0) * W);
      const py = Math.floor((mercY(n) - y0) / (y1 - y0) * H), qy = Math.ceil((mercY(s) - y0) / (y1 - y0) * H);
      if (qx < 0 || px >= W || qy < 0 || py >= H) continue;
      const bw = Math.max(1, qx - px), bh = Math.max(1, qy - py);
      const d = cx.getImageData(clamp(px, 0, W - 1), clamp(py, 0, H - 1), Math.min(bw, W - px), Math.min(bh, H - py)).data;
      const cnt = [0, 0, 0, 0]; let fq = 0, n2 = 0;
      for (let yy = 0; yy < bh && py + yy < H; yy++) for (let xx = 0; xx < bw && px + xx < W; xx++) {
        const lon = unX(x0 + (px + xx + .5) / W * (x1 - x0)), lat = unY(y0 + (py + yy + .5) / H * (y1 - y0));
        if (!inPolys(lon, lat, g)) continue;
        const i = (yy * bw + xx) * 4; const G = d[i + 1], R = d[i];
        if (R === 255) continue; // permanent water
        cnt[G] = (cnt[G] || 0) + 1; fq += R; n2++;
      }
      if (n2) p.gapS = { a: cnt[1] / n2, b: cnt[2] / n2, c: cnt[3] / n2, none: cnt[0] / n2, freq: fq / n2, n: n2 };
    }
  } catch (e) { console.warn('gap sampling failed', e); }
}
// sample sim-hidro maximum-depth tiles (z14, colour legend → class) inside each top site's IMEPLAN polygons
// both palettes sim-hidro has used (README legend and post-web DEPTH_STOPS); class 2 = 30–60 cm, 3 = 0.6–1 m …
const HLEG = [['c9ecfb', 0], ['86cff3', 1], ['3a9be3', 2], ['1f62c9', 3], ['2a3f9e', 4], ['2b1f6e', 5], ['7dd3fc', 0], ['38bdf8', 1], ['1d8fe0', 2], ['2563eb', 3], ['4f46e5', 4], ['7e22ce', 5]].map(([h, c]) => ({ rgb: [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)), c }));
async function sampleHidro(places) {
  const e = (D.hz?.layers || []).find(l => l.id === 'sim-hidro-t10-profundidad'); if (!e?.url) return;
  const bb = D.shStats?.domain?.bboxLonLat; const url = abs(e.url); const Z = 14; const cache = new Map();
  const tile = async (x, y) => {
    const k = x + '/' + y; if (cache.has(k)) return cache.get(k);
    const pr = (async () => { try { const r = await fetch(url.replace('{z}', Z).replace('{x}', x).replace('{y}', y)); if (!r.ok) return null; const b = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); const c = document.createElement('canvas'); c.width = c.height = 256; const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(b, 0, 0); return cx.getImageData(0, 0, 256, 256).data; } catch { return null; } })();
    cache.set(k, pr); return pr;
  };
  const cls = (r, g, b) => { let best = -1, bd = 1e9; for (const l of HLEG) { const d = (l.rgb[0] - r) ** 2 + (l.rgb[1] - g) ** 2 + (l.rgb[2] - b) ** 2; if (d < bd) { bd = d; best = l.c; } } return bd < 1600 ? best : -1; };
  const geo = siteGeoms(); const n2 = 2 ** Z;
  await Promise.all(places.map(async p => {
    const g = geo.get(p.id); if (!g) return;
    if (bb && (p.c[0] < bb[0] || p.c[0] > bb[2] || p.c[1] < bb[1] || p.c[1] > bb[3])) return;
    const [w, s0, e0, n] = p.bbox; const dx = 25 / (111320 * Math.cos(p.c[1] * Math.PI / 180)), dy = 25 / 110574;
    const pts = []; for (let y = s0 + dy / 2; y < n; y += dy) for (let x = w + dx / 2; x < e0; x += dx) if (inPolys(x, y, g)) pts.push([x, y]);
    let tot = 0, c30 = 0, c60 = 0;
    for (const [x, y] of pts) {
      const xf = mercX(x) * n2, yf = mercY(y) * n2; const d = await tile(Math.floor(xf), Math.floor(yf)); tot++;
      if (!d) continue; const i = (Math.floor((yf % 1) * 256) * 256 + Math.floor((xf % 1) * 256)) * 4; if (!d[i + 3]) continue;
      const c = cls(d[i], d[i + 1], d[i + 2]); if (c >= 2) c30++; if (c >= 3) c60++;
    }
    if (tot) p.hidroS = { f30: c30 / tot, f60: c60 / tot, n: tot };
  }));
}
let _geo = null;
function siteGeoms() {
  if (_geo) return _geo; _geo = new Map();
  for (const f of D.obs?.features || []) {
    if (f.geometry.type === 'Point') continue; const id = String(f.properties.name).split('/')[0];
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (!_geo.has(id)) _geo.set(id, []); _geo.get(id).push(...polys);
  }
  return _geo;
}
function pipRing(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
const inPoly = (x, y, p) => { if (!pipRing(x, y, p[0])) return false; for (let k = 1; k < p.length; k++) if (pipRing(x, y, p[k])) return false; return true; };
const inPolys = (x, y, ps) => ps.some(p => inPoly(x, y, p));

// ------------------------------------------------------------------ people dots (1 dot = DOT people, seeded)
const DOT = 150;
const GM = ['Muy bajo', 'Bajo', 'Medio', 'Alto', 'Muy alto'];
const GM_COL = ['#6f86a6', '#9aa676', '#e0a24a', '#e0603a', '#9e2b3a'];
function makeDots() {
  const feats = [];
  for (const f of D.ageb?.features || []) {
    const p = f.properties; if (!p.pob) continue;
    const n = Math.round(p.pob / DOT); if (!n) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let bb = [180, 90, -180, -90]; for (const q of polys) for (const [x, y] of q[0]) { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); }
    const r = rng(hash(p.cvegeo)); const g = GM.indexOf(p.gm_2020); const t = p.imeplan_area_pct > 0 ? 1 : 0;
    let k = 0, tries = 0;
    while (k < n && tries < n * 30) { tries++; const x = bb[0] + r() * (bb[2] - bb[0]), y = bb[1] + r() * (bb[3] - bb[1]); if (!inPolys(x, y, polys)) continue; k++; feats.push({ type: 'Feature', properties: { g, t }, geometry: { type: 'Point', coordinates: [+x.toFixed(6), +y.toFixed(6)] } }); }
  }
  return { type: 'FeatureCollection', features: feats };
}

// ------------------------------------------------------------------ flow particles along OSM waterways
const FLOW = { lines: [], parts: [] };
function makeFlow() {
  const r = rng(42);
  for (const f of D.ww?.features || []) {
    const w = f.properties.waterway; if (!['river', 'stream', 'canal', 'drain', 'ditch'].includes(w)) continue;
    const c = f.geometry.type === 'LineString' ? f.geometry.coordinates : null; if (!c || c.length < 2) continue;
    const cum = [0]; for (let i = 1; i < c.length; i++) { const kx = 111320 * Math.cos(c[i][1] * Math.PI / 180); cum.push(cum[i - 1] + Math.hypot((c[i][0] - c[i - 1][0]) * kx, (c[i][1] - c[i - 1][1]) * 110574)); }
    const len = cum[cum.length - 1]; if (len < 150) continue;
    const big = w === 'river' || w === 'canal';
    const li = FLOW.lines.push({ c, cum, len, big, culv: !!f.properties.tunnel && f.properties.tunnel !== 'no' }) - 1;
    const sp = big ? 380 : 520; const n = Math.max(1, Math.round(len / sp));
    for (let i = 0; i < n; i++) FLOW.parts.push({ li, off: (i + r() * .8) * len / n, v: (big ? 620 : 440) * (0.8 + r() * 0.4) });
  }
}
function segAt(L, d) {
  const { cum } = L; let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < d) lo = m; else hi = m; }
  return [lo, hi, (d - cum[lo]) / ((cum[hi] - cum[lo]) || 1)];
}
function pointAt(L, d) { const [lo, hi, t] = segAt(L, d); const c = L.c; return [lerp(c[lo][0], c[hi][0], t), lerp(c[lo][1], c[hi][1], t)]; }
// elevation of a line vertex, cached per terrain zoom (0 = DEM tile not ready yet → retried next frame)
function vz(L, i) {
  if (!L.z || L.zz !== PJ.z) { L.z = new Float32Array(L.c.length); L.zz = PJ.z; }
  let v = L.z[i]; if (!v) { v = PJ.elev(L.c[i][0], L.c[i][1]); L.z[i] = v; }
  return v;
}
function projAlong(L, d) {
  const [lo, hi, t] = segAt(L, d); const c = L.c;
  return PJ.at(lerp(c[lo][0], c[hi][0], t), lerp(c[lo][1], c[hi][1], t), lerp(vz(L, lo), vz(L, hi), t));
}

// ------------------------------------------------------------------ steps (story)
const chip = (cls, t) => `<span class="chip ${cls}">${t}</span>`;
const preChip = (m) => m && !m.registered ? chip('pre', 'preliminar') : '';
const lmE = id => D.LM?.[id]?.elev_m != null ? `${fmt(D.LM[id].elev_m)}\u00a0m` : '';
// small bar chart: people living in flooded cells vs drainage capacity (single series, one hue)
function capChart(E) {
  const caps = Object.keys(E).map(Number).sort((a, b) => a - b); const max = Math.max(...caps.map(c => E[c]));
  const W = 300, H = 112, x0 = 4, bw = (W - x0 * 2) / caps.length, base = 86;
  const bars = caps.map((c, i) => {
    const h = Math.max(2, E[c] / max * 62), x = x0 + i * bw + 2, w = bw - 4, y = base - h; const hi = c === 20 || c === 40;
    const lab = c === 20 ? 'hoy*' : c === 40 ? 'doble' : '';
    return `<g class="cb${hi ? ' hi' : ''}"><title>${c} mm/h: ≈${approx(E[c])} personas con agua ≥15 cm</title><rect x="${x - 2}" y="10" width="${w + 4}" height="${base - 10}" fill="transparent"/>
      <path d="M${x} ${base} V${y + 4} q0 -4 4 -4 h${w - 8} q4 0 4 4 V${base} Z" fill="${hi ? '#2f5fb3' : '#9db8e2'}"/>
      ${hi ? `<text x="${x + w / 2}" y="${y - 5}" text-anchor="middle" class="cv">${approx(E[c])}</text>` : ''}
      <text x="${x + w / 2}" y="${base + 13}" text-anchor="middle" class="cx">${c}</text>${lab ? `<text x="${x + w / 2}" y="${base + 24}" text-anchor="middle" class="cl">${lab}</text>` : ''}</g>`;
  }).join('');
  const d = (E[20] ?? 0) - (E[40] ?? 0);
  return `<figure class="capchart"><figcaption>Personas con agua en la calle (≥15 cm) según la capacidad del drenaje, mm/h</figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Personas expuestas por capacidad de drenaje">${bars}<line x1="${x0}" x2="${W - x0}" y1="${base}" y2="${base}" stroke="#2b2945" stroke-width="1.2"/></svg>
    <p>Doblar el drenaje (de 20 a 40 mm/h) sacaría del agua a <b>≈${approx(d)}</b> personas; <b>≈${approx(E[40])}</b> seguirían con agua: ahí no bastan los tubos.</p>
    <small>* «hoy» es el rango inferido de 20–30 mm/h (Atlas de Riesgos AMG 2021), no una medición.</small></figure>`;
}
let STEPS = [];
function buildSteps() {
  const W = MOD.water, G = MOD.gap, H = MOD.hyp;
  const rain = W?.rainMm ? Math.round(W.rainMm) : MOD.rain10 ? Math.round(MOD.rain10) : null;
  const rainSrc = W?.kind === 'hidro' ? 'hietograma de diseño IMTA 2017 para la ZMG, escalado a 10 años (el de sim-hidro)' : 'curva IDF de la estación 14066 Guadalajara (Campos-Aranda 2010), la de sim-drenaje';
  const drop = D.LM?.centro && D.LM?.huentitan ? D.LM.centro.elev_m - D.LM.huentitan.elev_m : null;
  const top = D.top || [];
  const steps = [];
  steps.push({
    key: 'Portada', cls: 'cover', pose: 'hola',
    cam: { c: [-103.372, 20.615], z: 10.45, p: 62, b: -14 }, camPhone: { c: [-103.37, 20.63], z: 9.7, p: 60, b: -14 },
    L: { rain: .35, clouds: 1, storm: .15, flow: .5, ww: .9, wb: 1, city: .55, roads: .6 },
    notes: ['primavera', 'viejo', 'huentitan', 'centro', 'cuatro'],
    html: () => `<div class="kicker">Guadalajara · una historia de agua</div>
      <h1>¿Dónde cae el próximo <span class="peso">peso</span> para el drenaje?</h1>
      <p class="lede">Sigamos una tormenta desde la sierra hasta la ciudad. Al final quedan unos cuantos lugares donde invertir cambia más vidas.</p>
      <div class="chips">${chip('ter', 'relieve INEGI 5 m')}${chip('obs', 'observado')}${chip('mod', 'modelado')}${chip('cen', 'censo')}${chip('edi', 'criterio editorial')}</div>
      <p style="font-size:13.5px;margin:0">Exploratorio: no es un pronóstico ni una recomendación oficial.</p>
      <span class="cue">desliza para empezar ↓</span>`,
  });
  steps.push({
    key: 'Lluvia', pose: 'cae',
    cam: { c: [-103.525, 20.632], z: 12.15, p: 72, b: -78 }, camPhone: { c: [-103.52, 20.632], z: 11.4, p: 68, b: -78 },
    L: { rain: 1, clouds: 1, storm: 1, flow: .35, ww: .8, wb: 1, city: .5, roads: .5 },
    notes: ['primavera', 'colli', 'tepopote'],
    html: () => `<div class="kicker">1 · Arriba</div><h2>Todo empieza en la sierra</h2>
      <div class="chips">${chip('ter', 'relieve INEGI 5 m')}${rain ? chip('mod', 'lluvia de diseño') : ''}</div>
      <p>${rain ? `Una tormenta fuerte —de las que llegan, en promedio, una vez cada 10 años— deja <b>unos ${rain} mm en una hora</b>.` : 'Una tormenta de verano puede dejar decenas de milímetros en una hora.'} Sobre La Primavera${lmE('primavera') ? `, a ${lmE('primavera')},` : ''} esa agua no se queda quieta.</p>
      <p>El relieve que ves es de <b>5 m por píxel</b> (modelo de terreno de INEGI), sin exagerar la altura.</p>
      <p class="src"><b>Fuentes:</b> ${rain ? `lluvia: ${rainSrc}. ` : ''}Relieve: INEGI MDT 5 m. Nombres: OpenStreetMap.</p>`,
  });
  steps.push({
    key: 'Cuesta abajo', pose: 'baja',
    cam: { c: [-103.335, 20.700], z: 12.2, p: 62, b: 28 }, camPhone: { c: [-103.335, 20.70], z: 11.6, p: 60, b: 28 },
    L: { rain: .35, storm: .55, clouds: .3, flow: 1, ww: 1, wb: 1, acc: .95, city: .45, roads: .55, bldg: .6 },
    notes: ['atemajac', 'sjd', 'huentitan', 'centro'],
    html: () => `<div class="kicker">2 · Cuesta abajo</div><h2>Baja por arroyos… y por calles</h2>
      <div class="chips">${chip('map', 'arroyos OSM')}${MOD.acc ? chip('mod', 'flujo sobre relieve 5 m') + preChip({ registered: MOD.relieveRegistered }) : ''}</div>
      <p>El agua busca lo bajo. En el cerro corre por arroyos; en la ciudad muchos se entubaron y <b>la calle se volvió el cauce</b>.</p>
      ${MOD.acc ? `<div class="legend"><span><i style="background:#cdeeff;border-color:#2f5fb3"></i>por dónde se junta el agua según el relieve, con los edificios como muros</span><span><i style="background:#3a6fbf"></i>arroyos y canales cartografiados</span></div>` : ''}
      <p>${drop ? `Todo termina en la barranca: su fondo está a ${lmE('huentitan')}, <b>${fmt(round(drop, 10))}\u00a0m debajo del Centro</b>.` : 'Todo termina en la Barranca del Río Santiago.'} OpenStreetMap marca ${fmt(S.entubadoKm)} km de cauces entubados dentro de la mancha urbana.</p>
      <p class="src"><b>Fuentes:</b> OpenStreetMap (arroyos, canales, entubados; no es inventario del drenaje). ${MOD.acc ? 'sim-relieve: acumulación de flujo D8 en el MDT INEGI 5 m con edificios como obstáculos.' : ''}</p>`,
  });
  steps.push({
    key: 'Se junta', pose: 'quieta',
    cam: { c: [-103.322, 20.572], z: 12.55, p: 56, b: 12 }, camPhone: { c: [-103.322, 20.574], z: 11.8, p: 54, b: 12 },
    L: { water: 1, obs: 1, ww: .6, wb: 1, city: .45, roads: .55, storm: .3, rain: .25, flow: .3 },
    notes: ['pintas', 'juntas'],
    scrub: 'water',
    html: () => `<div class="kicker">3 · Donde se detiene</div><h2>Se junta en lo plano y lo bajo</h2>
      <div class="chips">${W ? chip('mod', `modelo ${W.res}`) + preChip(W) : ''}${chip('obs', 'observado IMEPLAN')}</div>
      ${W ? `<div class="clock"><span id="clk-t">min 0</span><span class="bar"><i id="clk-bar"></i><b style="left:${60 / 120 * 100}%"></b></span><span style="font-size:11px">deja de llover min 60</span></div>
      <p>Así se llenan los bajos en un modelo de lluvia sobre el relieve (agua de ${W.raw ? '15' : '30'} cm o más): tormenta de 10 años${W.cap != null ? `, drenaje supuesto de ${W.cap} mm/h` : ''}.</p>` :
      `<p><b>Versión observada.</b> La animación del modelo aparecerá aquí cuando termine la simulación.</p>`}
      <p>En tinta rayada, lo que sí ha pasado: <b>${fmt(S.nSitios)} sitios inundables</b> y <b>${fmt(S.nZonas)} zonas críticas</b> registrados por IMEPLAN.</p>
      ${W?.valid ? (() => { const v = W.valid.groups?.sitiosInundables_polygons?.byThreshold?.['0.6']; return v ? `<p>¿Le atina? En <b>${Math.round(v.hitRateObserved * 100)} %</b> de los sitios registrados el modelo tiene algún punto con 60 cm o más; en lugares al azar de la ciudad, ${Math.round(v.hitRateRandom * 100)} %.</p>` : ''; })() : ''}
      <div class="legend">${W ? ['#4a8fd8', '#2a6ac0', '#1a3484'].map((c, i) => `<span><i class="sq" style="background:${c}"></i>${W.classes[i]}</span>`).join('') : ''}<span>${icon.hatch}registrado</span></div>
      <p class="src"><b>Fuentes:</b> ${W ? (W.kind === 'hidro' ? 'sim-hidro (aguas someras 5 m, GPU). ' : `sim-drenaje (aguas someras 20 m, Tr 10 años, ensamble ${W.runs}/${W.planned}). `) : ''}IMEPLAN, Mapa Único de Inundaciones 2026. Modelo exploratorio, no pronóstico.</p>`,
  });
  steps.push({
    key: '¿Plano o bajo?', pose: 'piensa',
    cam: { c: [-103.352, 20.640], z: 11.55, p: 34, b: 0 }, camPhone: { c: [-103.35, 20.64], z: 10.9, p: 30, b: 0 },
    L: { hand: .78, obsLine: 1, ww: .7, wb: 1, city: .35, roads: .45 },
    notes: ['centro', 'cuatro', 'colli'],
    html: () => {
      const hand = H?.handAuc, flat = H?.flatnessAuc175m;
      return `<div class="kicker">4 · Una sospecha</div><h2>¿Se inundan las zonas planas?</h2>
      <div class="chips">${MOD.hand ? chip('mod', 'índice de terreno 5 m') + preChip({ registered: MOD.relieveRegistered }) : ''}${chip('obs', 'sitios IMEPLAN')}</div>
      ${H ? `<p class="answer">${H.headline}</p>
        <p>Lo plano pesa solo porque aquí lo plano suele ser lo bajo. Lo que mejor separa los sitios inundados es la <b>altura sobre el cauce más cercano</b>${hand ? ` (AUC ${hand.toFixed(2)})` : ''}${flat ? `; la planitud sola, AUC ${flat.toFixed(2)}` : ''}.</p>`
      : `<p>Es la intuición de muchos: lo plano se inunda. ${MOD.hand ? 'La prueba estadística con el relieve de 5 m está en curso; mientras, en azul: la <b>altura sobre el cauce más cercano</b>, una de las sospechosas.' : 'La prueba con el relieve de 5 m está en curso; por ahora solo vemos lo registrado.'}</p>`}
      ${MOD.hand ? `<div class="ramp" style="background:linear-gradient(90deg,#3f86e8,#5b8fe6 30%,#7a86d6 60%,rgba(150,130,200,.12))"></div><div class="ramp-l"><span>0 m sobre el cauce</span><span>30 m</span></div>` : ''}
      <p class="src"><b>Fuentes:</b> sim-relieve (HAND, pendiente, depresiones sobre MDT INEGI 5 m${H ? '; validado contra polígonos IMEPLAN' : ''}). AUC: 0.5 = azar, 1 = separa perfecto.</p>`;
    },
  });
  steps.push({
    key: 'Quién vive', pose: 'lupa',
    cam: { c: [-103.345, 20.628], z: 11.3, p: 40, b: -8 }, camPhone: { c: [-103.345, 20.63], z: 10.55, p: 38, b: -8 },
    L: { dots: 1, obsLine: .9, wb: 1, city: .25, roads: .35, ww: .4 },
    notes: [],
    html: () => `<div class="kicker">5 · Quién vive ahí</div><h2>Debajo del agua hay barrios</h2>
      <div class="chips">${chip('cen', 'censo 2020')}${chip('cen', 'marginación CONAPO')}${chip('obs', 'IMEPLAN')}</div>
      <div class="row"><div><div class="big">${approx(S.touchPob)}</div><small>personas viven en una AGEB que toca una mancha registrada</small></div>
      <div><div class="big verm">≈${approx(S.inside)}</div><small>viven dentro de las manchas (estimado)</small></div></div>
      <p>De quienes viven dentro, unas <b>${approx(S.insideHi)}</b> están en zonas de marginación alta o muy alta. En esas AGEB hay <b>${fmt(S.esc)} escuelas</b> y <b>${fmt(S.guard)} guarderías</b>.</p>
      <div class="legend">${GM.map((g, i) => `<span><i style="background:${GM_COL[i]}"></i>${g}</span>`).reverse().join('')}</div>
      <p class="src"><b>Fuentes:</b> INEGI Censo 2020 por AGEB, CONAPO marginación urbana 2020, DENUE. 1 punto = ${DOT} personas, al azar dentro de su AGEB; brillantes: AGEB que tocan una mancha. «Dentro» supone a la gente repartida parejo en su AGEB.</p>`,
  });
  steps.push({
    key: 'Tubos o vasos', pose: 'guiño',
    cam: { c: [-103.335, 20.598], z: 11.3, p: 46, b: 14 }, camPhone: { c: [-103.335, 20.60], z: 10.55, p: 44, b: 14 },
    L: { gap: .9, obsLine: .7, wb: 1, city: .35, roads: .4, ww: .5 },
    notes: [],
    html: () => G ? `<div class="kicker">6 · ¿Tubos o vasos?</div><h2>No todo se arregla con tubos</h2>
      <div class="chips">${chip('mod', 'ensamble de tormentas')}${G.runs < G.planned || !G.registered ? chip('pre', `preliminar · ${G.runs}/${G.planned} corridas`) : ''}</div>
      <p>Corrimos la misma lluvia muchas veces, con más y menos capacidad de drenaje.</p>
      ${S.expByCap ? capChart(S.expByCap) : ''}
      <div class="legend gapleg"><span><i class="sq" style="background:var(--aqua-gap)"></i><b>${fmt(G.km2?.b)} km² responden</b>: más colectores sí bajan el agua</span><span><i class="sq" style="background:var(--orange-gap)"></i><b>${fmt(G.km2?.a)} km² persisten</b> aun con 4× más drenaje: vasos reguladores, nivelar, dar espacio al agua</span></div>
      <p class="caveat">No hay mapa público de la red pluvial: el modelo supone un drenaje parejo. Es una pista para priorizar, no un diseño.</p>
      <p class="src"><b>Fuentes:</b> sim-drenaje: aguas someras 20 m, tormentas Tr 2–100 años × capacidad 0–60 mm/h × infiltración. «Persiste»: se inunda ≥15 cm en ≥25 % de corridas con ≤10 mm/h y sigue con ≥40 mm/h.${S.expByCap ? ' Personas: población de cada AGEB × fracción de sus celdas urbanas con ≥15 cm, promedio de las tormentas corridas; supone a la gente repartida parejo.' : ''}</p>`
      : `<div class="kicker">6 · ¿Tubos o vasos?</div><h2>No todo se arregla con tubos</h2>
      <div class="chips">${chip('map', 'OSM')}${chip('pre', 'simulación en curso')}</div>
      <p><b>Versión observada.</b> La simulación de drenaje aún corre. Donde el agua no tiene salida, más tubos no bastan: hacen falta vasos reguladores o regrading.</p>
      <p class="src"><b>Fuentes:</b> OpenStreetMap, IMEPLAN.</p>`,
  });
  steps.push({
    key: 'Cinco lugares', pose: 'moneda', coin: true,
    cam: null, // fitted to the places at runtime
    L: { pins: 1, hl: 1, obsLine: .6, dots: .35, wb: 1, city: .45, roads: .45, ww: .4 },
    notes: [], scrub: 'pins',
    html: () => `<div class="kicker">7 · El próximo peso</div><h2>Cinco lugares donde un peso cambia más vidas</h2>
      <div class="chips">${chip('edi', 'criterio editorial')}${chip('obs', 'IMEPLAN')}${chip('cen', 'censo')}</div>
      ${D.defaultRank === 'coincide' ? `<p>Buscamos <b>gente que vive donde el registro y el modelo coinciden</b>: dentro de una mancha de IMEPLAN y con 30 cm o más en el modelo de 5 m. La pesamos con la <b>prioridad exploratoria</b> de su AGEB (marginación, densidad, suelo sellado, coladeras, dependientes).</p>`
      : `<p>Para cada mancha registrada contamos <b>la gente que vive dentro</b> y la pesamos con la <b>prioridad exploratoria</b> de su AGEB (agua observada, marginación, densidad, suelo sellado, coladeras, dependientes).</p>`}
      <ol class="place-list">${top.map((p, i) => `<li><span class="n">${i + 1}</span><span><b>${esc(placeTitle(p))}</b><small>${esc(p.munName)} · ${D.defaultRank === 'coincide' ? `≈${approx(both(p))} donde coinciden` : `≈${approx(p.ppl)} personas dentro`}</small></span></li>`).join('')}</ol>
      <p class="src"><b>Ojo:</b> la prioridad exploratoria es un compuesto editorial (infra-data), no un índice oficial ni una recomendación. Un lugar por barrio (sitios a menos de 2 km se agrupan).</p>`,
  });
  const bearings = [-22, 20, -14, 26, -30];
  top.forEach((p, i) => steps.push({
    key: `#${i + 1}`, pose: ['lupa', 'quieta', 'piensa', 'guiño', 'lupa'][i], coin: true, place: p,
    cam: null, bearing: bearings[i],
    L: { pins: 1, hl: 1, obs: .85, dots: .55, hid: MOD.hidTiles ? .78 : 0, gap: G && !MOD.hidTiles ? .3 : 0, wb: 1, city: .5, roads: .8, bldg: .8, ww: .6, flow: .4 },
    notes: [],
    html: () => {
      const g = p.gapS, h = p.hidroS, t = p.terr;
      let fixV = null, fixS = '', bar = '';
      if (g) {
        const wet = g.a + g.b;
        if (wet < 0.12) { fixV = 'Casi seca'; fixS = 'el modelo de drenaje (20 m) casi no la inunda: no distingue'; }
        else if (g.a > g.b * 1.5) { fixV = 'Vasos'; fixS = 'persiste aun con 4× más drenaje: almacenar, nivelar, dar espacio'; }
        else if (g.b > g.a * 1.5) { fixV = 'Tubos'; fixS = 'responde a más capacidad de colectores'; }
        else { fixV = 'Mixto'; fixS = 'parte responde a tubos, parte necesita vasos'; }
        bar = `<span class="bar2"><i style="width:${(g.b * 100).toFixed(0)}%;background:var(--aqua-gap)"></i><i style="width:${(g.a * 100).toFixed(0)}%;background:var(--orange-gap)"></i><i style="flex:1;background:#e6dfd2"></i></span>`;
      }
      const rango = p.rango_cm && !/s\/?d/i.test(p.rango_cm) ? p.rango_cm.replace(/\s/g, '').replace('-', '–') + ' cm' : 'sin altura';
      const ref = (p.ref || '').trim();
      const cell = (cls, k, v, sub) => `<div class="fc ${cls}"><span class="k">${k}</span><b>${v}</b><small>${sub}</small></div>`;
      return `<div class="kicker">#${i + 1} · ${esc(p.munName)}</div><h2>${esc(placeTitle(p))}</h2>
      <div class="chips">${chip('obs', `IMEPLAN ${esc(p.id)}`)}${chip('cen', 'censo')}${h || g || t ? chip('mod', 'modelos') : ''}${g && MOD.gap.runs < MOD.gap.planned ? chip('pre', 'preliminar') : ''}</div>
      ${ref && placeTitle(p) !== ref ? `<p class="place-ref" style="margin-top:-4px"><i>${esc(ref)}</i></p>` : ''}
      <div class="row">${h ? `<div><div class="big">≈${approx(both(p))}</div><small>personas donde registro y modelo coinciden (de ≈${approx(p.ppl)} en la mancha)</small></div>` : `<div><div class="big">≈${approx(p.ppl)}</div><small>personas dentro de la mancha</small></div>`}
      ${p.hiP >= 50 ? `<div><div class="big verm">≈${approx(p.hiP)}</div><small>de la mancha en marginación alta o muy alta</small></div>` : `<div><div class="big verm">${fmt(p.prio)}<span style="font-size:.5em">/100</span></div><small>prioridad exploratoria media</small></div>`}</div>
      <div class="ficha">
        ${cell('obs', 'Observado', rango, p.motivo?.length ? esc(p.motivo[0]).toLowerCase() : 'reportado a IMEPLAN')}
        ${h ? cell('mod', 'Modelo 5 m', `${Math.round(h.f30 * 100)} %`, 'de la mancha con +30 cm (Tr 10)') : ''}
        ${t ? cell('ter', 'Terreno', `${Math.round(t.susc * 100)}<span>/100</span>`, 'susceptibilidad (percentil urbano)') : ''}
        ${g ? `<div class="fc tv"><span class="k">¿Tubos o vasos?</span><b>${fixV}</b>${bar}<small>${fixS}</small></div>` : ''}
      </div>
      ${MOD.hidTiles ? `<div class="legend"><span><i class="sq" style="background:#5aa9e6"></i>agua máxima del modelo 5 m (Tr 10)</span><span>${icon.hatch}registro IMEPLAN</span></div>` : ''}
      <p class="fac">En sus AGEB: ${fmt(p.esc)} escuelas, ${fmt(p.guard)} guarderías, ${fmt(p.salud)} clínicas u hospitales (DENUE).</p>
      <p class="src"><b>Fuentes:</b> IMEPLAN MUI 2026 (${esc(p.id)}, ${(p.area_m2 / 1e6).toLocaleString('es-MX', { maximumFractionDigits: 2 })} km²) · INEGI Censo 2020, DENUE · CONAPO 2020${h ? ' · sim-hidro (profundidad máxima, 5 m)' : ''}${t ? ' · sim-relieve (susceptibilidad por AGEB)' : ''}${g ? ' · sim-drenaje (tubos o vasos, celdas de 20 m)' : ''}. Barrio: nombre OSM más cercano.</p>`;
    },
  }));
  steps.push({
    key: 'Cómo leer', pose: 'guiño', coin: true, final: true,
    cam: { c: [-103.345, 20.615], z: 10.75, p: 54, b: 18 }, camPhone: { c: [-103.345, 20.62], z: 10.0, p: 50, b: 18 },
    L: { pins: 1, hl: 1, obsLine: .8, wb: 1, city: .55, roads: .55, ww: .9, flow: .6, clouds: .5 },
    notes: [],
    html: () => `<div class="kicker">Cómo leer esto</div><h2>Una exploración, <em>no un pronóstico</em></h2>
      <ul class="method">
        <li><b>Observado</b> (rayado): IMEPLAN registra dónde ya se inundó. Refleja reportes: hay más donde hay más quejas.</li>
        <li><b>Modelado</b> (aguada azul y verde): simulaciones de cauce. sobre el relieve INEGI 5 m. Sin red pública de drenaje pluvial, el drenaje se supone.</li>
        <li><b>Cartografiado</b> (líneas): arroyos y canales de OpenStreetMap.</li>
        <li><b>El orden de los lugares</b> es un criterio editorial. Cámbialo:</li>
      </ul>
      <div class="btns" id="rank-btns">${Object.entries(RANKS).map(([k, v]) => `<button data-rank="${k}" class="${k === (D.rankMode || D.defaultRank || 'score') ? 'on' : ''}">${v.label}</button>`).join('')}</div>
      <ol class="place-list" id="rank-list"></ol>
      <p style="font-size:13.5px">Más detalle: <a href="/labs/sim-drenaje/">sim-drenaje</a> · <a href="/labs/sim-relieve/">sim-relieve</a> · <a href="/labs/sim-hidro/">sim-hidro</a> · <a href="/labs/">todos los labs</a></p>
      <p class="src"><b>Fuentes:</b> Relieve INEGI MDT 5 m · IMEPLAN Mapa Único de Inundaciones 2026 · INEGI Censo 2020, Marco Geoestadístico, DENUE, INV 2020 · CONAPO IMU 2020 · OpenStreetMap (ODbL) · OpenFreeMap · ESA WorldCover 2021 · Overture Maps · simulaciones cauce. labs (sim-hidro, sim-relieve, sim-drenaje). Ilustración y texto: cauce. labs.</p>`,
  });
  return steps;
}

// ------------------------------------------------------------------ annotations
const NOTE_DEF = {
  primavera: { lm: 'primavera', t: 'Sierra de La Primavera', s: () => lmE('primavera'), dx: 18, dy: -46, cls: 'peak' },
  viejo: { lm: 'viejo', t: 'Cerro Viejo', s: () => lmE('viejo'), dx: 16, dy: -40, cls: 'peak' },
  colli: { lm: 'colli', t: 'Cerro del Colli', s: () => lmE('colli'), dx: 18, dy: -38, cls: 'peak' },
  tepopote: { lm: 'tepopote', t: 'Cerro del Tepopote', s: () => lmE('tepopote'), dx: -22, dy: -36, cls: 'peak' },
  cuatro: { lm: 'cuatro', t: 'Cerro del Cuatro', s: () => lmE('cuatro'), dx: 16, dy: -34, cls: 'peak' },
  huentitan: { lm: 'huentitan', t: 'Barranca de Huentitán', s: () => D.LM?.huentitan ? `fondo a ${lmE('huentitan')}` : '', dx: 18, dy: -40, cls: 'water' },
  centro: { lm: 'centro', t: 'Centro', s: () => lmE('centro'), dx: -16, dy: -34 },
  atemajac: { lm: 'atemajac', t: 'Río Atemajac', s: () => '', dx: -20, dy: -30, cls: 'water' },
  sjd: { lm: 'sjd', t: 'San Juan de Dios', s: () => 'entubado', dx: 18, dy: -30, cls: 'water' },
  pintas: { lm: 'pintas', t: 'Canal Las Pintas', s: () => '', dx: -22, dy: -32, cls: 'water' },
  ahogado: { lm: 'ahogado', t: 'El Ahogado', s: () => '', dx: -20, dy: -32, cls: 'water' },
  juntas: { lm: 'juntas', t: 'Las Juntas', s: () => '', dx: -18, dy: -30 },
};
const notesEl = {};
function buildNotes() {
  const host = document.getElementById('notes'); host.innerHTML = '';
  for (const [id, n] of Object.entries(NOTE_DEF)) {
    const lm = D.LM?.[n.lm]; if (!lm) continue;
    const el = document.createElement('div'); el.className = 'note ' + (n.cls || '');
    const sub = n.s(); const left = n.dx < 0;
    const pos = left ? `right:${-n.dx - 6}px;text-align:right` : `left:${n.dx - 6}px;text-align:left`;
    el.innerHTML = `<svg class="lead" width="1" height="1"><path d="M0 -4 Q ${(n.dx * .15).toFixed(1)} ${(n.dy * .75).toFixed(1)} ${n.dx} ${n.dy + 6}" fill="none" stroke="#2b2945" stroke-width="2.2" stroke-linecap="round"/></svg><span class="dot"></span>
      <div class="lab" style="position:absolute;${pos};top:${n.dy - 24}px"><span class="t">${n.t}</span>${sub ? `<span class="s">${sub}</span>` : ''}</div>`;
    host.appendChild(el);
    notesEl[id] = { el, ll: lm.at && ['cerro', 'sierra', 'barranca'].includes(lm.kind) ? lm.at : lm.ll, vis: -1 };
  }
}

// ------------------------------------------------------------------ map
let map;
const GROUPS = {
  city: [['city', 'fill-opacity', .72]],
  roads: [['road-minor', 'line-opacity', .85], ['road-major-case', 'line-opacity', .55], ['road-major', 'line-opacity', 1]],
  bldg: [['bldg-sh', 'fill-opacity', .45], ['bldg', 'fill-opacity', .9]],
  wb: [['wb', 'fill-opacity', 1], ['wb-line', 'line-opacity', .9]],
  ww: [['ww-small', 'line-opacity', .85], ['ww-big', 'line-opacity', 1], ['ww-culv', 'line-opacity', .75]],
  acc: [['m-acc', 'raster-opacity', 1]],
  hand: [['m-hand', 'raster-opacity', .85]],
  gap: [['m-gap', 'raster-opacity', 1]],
  hid: [['m-hid', 'raster-opacity', 1]],
  obs: [['obs-fill', 'fill-opacity', .85], ['obs-line', 'line-opacity', 1]],
  obsLine: [['obs-line', 'line-opacity', 1]],
  dots: [['dots-lo', 'circle-opacity', .2], ['dots', 'circle-opacity', 1]],
  hl: [['hl-case', 'line-opacity', .9], ['hl-line', 'line-opacity', 1]],
};
const DEFAULT_L = { hid: 0, city: 0, roads: 0, bldg: 0, wb: 0, ww: 0, acc: 0, hand: 0, gap: 0, obs: 0, obsLine: 0, dots: 0, hl: 0, water: 0, rain: 0, storm: 0, clouds: 0, flow: 0, ripples: 0, pins: 0 };

function reliefColor() {
  return ['interpolate', ['linear'], ['elevation'],
    700, '#4b6e6b', 950, '#5b857c', 1200, '#86a487', 1400, '#c4c39a', 1480, '#e9dfbf', 1540, '#f3e7c9', 1620, '#eddcb2', 1720, '#dfc690',
    1850, '#c3b77f', 2000, '#9fac76', 2200, '#7a9563', 2450, '#6b8061', 2700, '#7f7a90', 3000, '#aea4bf'];
}
// INEGI 5 m tiles inside the grid envelope; AWS Terrarium outside it (as terrain/index.json prescribes), so the 3D
// surface continues to the horizon instead of dropping to 0 m at the AOI edge.
const AWS = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
function demProtocol(inegiUrl, bounds) {
  maplibregl.addProtocol('cdem', async (params, ac) => {
    const [z, x, y] = params.url.replace('cdem://', '').split('/').map(Number);
    const n = 2 ** z, w = x / n * 360 - 180, e = (x + 1) / n * 360 - 180, no = unY(y / n), so = unY((y + 1) / n);
    const inside = e > bounds[0] && w < bounds[2] && no > bounds[1] && so < bounds[3] && z >= 8;
    let r = inside ? await fetch(inegiUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal: ac.signal }).catch(() => null) : null;
    if (!r || !r.ok) r = await fetch(`${AWS}/${z}/${x}/${y}.png`, { signal: ac.signal });
    if (!r.ok) throw new Error('dem ' + r.status);
    return { data: await r.arrayBuffer() };
  });
}
function makeStyle() {
  const dtm = D.ter?.layers?.find(l => l.id === 'dtm-inegi-5m');
  const inegi = abs(dtm?.url || '/labs/shared/terrain/dtm/{z}/{x}/{y}.png');
  const bounds = dtm?.bounds || [-103.75629, 20.243255, -103.04029, 21.006726];
  demProtocol(inegi, bounds);
  const demUrl = 'cdem://{z}/{x}/{y}';
  return {
    version: 8,
    transition: { duration: 0, delay: 0 },
    sources: {
      dem: { type: 'raster-dem', tiles: [demUrl], encoding: 'terrarium', tileSize: 256, minzoom: 5, maxzoom: 13 },
      demhs: { type: 'raster-dem', tiles: [demUrl], encoding: 'terrarium', tileSize: 256, minzoom: 5, maxzoom: 15 },
      ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    },
    sky: skyFor(0),
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#ebdfc4' } },
      { id: 'relief', type: 'color-relief', source: 'demhs', paint: { 'color-relief-color': reliefColor(), 'color-relief-opacity': 1 } },
      { id: 'hill', type: 'hillshade', source: 'demhs', paint: { 'hillshade-method': 'igor', 'hillshade-exaggeration': .62, 'hillshade-shadow-color': '#4a3a5e', 'hillshade-highlight-color': '#fff6de', 'hillshade-accent-color': '#5d4d6d', 'hillshade-illumination-direction': 315 } },
    ],
  };
}
function skyFor(storm) {
  const mix = (a, b) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(lerp(v, B[i], storm)).toString(16).padStart(2, '0')).join(''); };
  return { 'sky-color': mix('#93bfdc', '#5f6c8e'), 'horizon-color': mix('#f6e5c3', '#b9b4b8'), 'fog-color': mix('#efe2c4', '#cfc8bf'),
    'sky-horizon-blend': .6, 'horizon-fog-blend': .55, 'fog-ground-blend': .5, 'atmosphere-blend': 0 };
}
function hatchImage() {
  const s = 24, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
  x.fillStyle = 'rgba(150,182,232,0.55)'; x.fillRect(0, 0, s, s);
  x.strokeStyle = '#1d3d85'; x.lineWidth = 2.6; x.lineCap = 'square';
  for (let k = -s; k <= s * 2; k += 8) { x.beginPath(); x.moveTo(k, s); x.lineTo(k + s, 0); x.stroke(); }
  return { width: s, height: s, data: new Uint8Array(x.getImageData(0, 0, s, s).data.buffer) };
}
function addLayers() {
  map.addImage('hatch', hatchImage(), { pixelRatio: 2 });
  const vis = { visibility: 'none' };
  // city footprint
  map.addSource('ageb', { type: 'geojson', data: D.ageb || { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'city', type: 'fill', source: 'ageb', layout: vis, paint: { 'fill-color': '#e8b090', 'fill-opacity': 0, 'fill-antialias': false } });
  // water bodies
  map.addSource('wb', { type: 'geojson', data: D.wb || { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'wb', type: 'fill', source: 'wb', layout: vis, paint: { 'fill-color': '#4f86c6', 'fill-opacity': 0 } });
  map.addLayer({ id: 'wb-line', type: 'line', source: 'wb', layout: vis, paint: { 'line-color': '#1d3d85', 'line-width': 1.2, 'line-opacity': 0 } });
  // roads (OpenFreeMap)
  const T = ['transportation'];
  map.addLayer({ id: 'road-minor', type: 'line', source: 'ofm', 'source-layer': T[0], minzoom: 12.5, layout: { ...vis, 'line-cap': 'round', 'line-join': 'round' },
    filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary', 'minor']]],
    paint: { 'line-color': '#fffaf0', 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12.5, .4, 15, 2.6, 17, 7], 'line-opacity': 0 } });
  map.addLayer({ id: 'road-major-case', type: 'line', source: 'ofm', 'source-layer': T[0], minzoom: 9, layout: { ...vis, 'line-cap': 'round', 'line-join': 'round' },
    filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
    paint: { 'line-color': '#a8977c', 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 9, 1.2, 12, 2.6, 15, 7], 'line-opacity': 0 } });
  map.addLayer({ id: 'road-major', type: 'line', source: 'ofm', 'source-layer': T[0], minzoom: 9, layout: { ...vis, 'line-cap': 'round', 'line-join': 'round' },
    filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
    paint: { 'line-color': '#fffaf0', 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 9, .5, 12, 1.4, 15, 4.6], 'line-opacity': 0 } });
  // buildings (shared Overture tiles)
  map.addSource('bldg', { type: 'vector', tiles: [abs('/labs/shared/infra/buildings/{z}/{x}/{y}.pbf')], minzoom: 14, maxzoom: 15, bounds: [-103.75, 20.25, -103.05, 21] });
  map.addLayer({ id: 'bldg-sh', type: 'fill', source: 'bldg', 'source-layer': 'buildings', minzoom: 14, layout: vis, paint: { 'fill-color': '#8c7a62', 'fill-translate': [1.4, 1.6], 'fill-opacity': 0 } });
  map.addLayer({ id: 'bldg', type: 'fill', source: 'bldg', 'source-layer': 'buildings', minzoom: 14, layout: vis, paint: { 'fill-color': '#f4e8cf', 'fill-opacity': 0 } });
  // model rasters
  const rs = (id, m, extra = {}) => { if (!m) return; map.addSource(id, { type: 'raster', tiles: m.tiles, tileSize: 256, minzoom: m.minzoom, maxzoom: m.maxzoom, bounds: m.bounds }); map.addLayer({ id: 'm-' + id, type: 'raster', source: id, layout: vis, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, ...extra } }); };
  rs('hand', MOD.hand, { 'raster-saturation': -.35, 'raster-hue-rotate': 28 });
  rs('gap', MOD.gap);
  rs('hid', MOD.hidTiles, { 'raster-saturation': -.3, 'raster-resampling': 'nearest' });
  rs('acc', MOD.acc, { 'raster-brightness-min': .12 });
  // dynamic water frames
  WF.n = 0;
  if (MOD.water) MOD.water.frames.forEach((f, i) => {
    map.addSource('wf' + i, { type: 'image', url: f.url, coordinates: MOD.water.coordinates });
    map.addLayer({ id: 'wf' + i, type: 'raster', source: 'wf' + i, layout: vis, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } });
    WF.n++;
  });
  // OSM waterways
  map.addSource('ww', { type: 'geojson', data: D.ww || { type: 'FeatureCollection', features: [] } });
  const culv = ['all', ['has', 'tunnel'], ['!=', ['get', 'tunnel'], 'no']];
  map.addLayer({ id: 'ww-small', type: 'line', source: 'ww', layout: { ...vis, 'line-cap': 'round', 'line-join': 'round' },
    filter: ['all', ['!', culv], ['in', ['get', 'waterway'], ['literal', ['stream', 'drain', 'ditch']]]],
    paint: { 'line-color': '#3a6fbf', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, .5, 12, 1.2, 15, 2.8], 'line-opacity': 0 } });
  map.addLayer({ id: 'ww-big', type: 'line', source: 'ww', layout: { ...vis, 'line-cap': 'round', 'line-join': 'round' },
    filter: ['all', ['!', culv], ['in', ['get', 'waterway'], ['literal', ['river', 'canal']]]],
    paint: { 'line-color': '#2f62b5', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.3, 12, 2.6, 15, 5.5], 'line-opacity': 0 } });
  map.addLayer({ id: 'ww-culv', type: 'line', source: 'ww', layout: { ...vis, 'line-cap': 'butt' }, filter: culv,
    paint: { 'line-color': '#2f62b5', 'line-dasharray': [1.2, 1.6], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, .8, 12, 1.6, 15, 3.4], 'line-opacity': 0 } });
  // IMEPLAN observed
  const obsPolys = { type: 'FeatureCollection', features: (D.obs?.features || []).filter(f => f.geometry.type !== 'Point').map(f => ({ ...f, properties: { ...f.properties, site: String(f.properties.name).split('/')[0] } })) };
  map.addSource('obs', { type: 'geojson', data: obsPolys });
  map.addLayer({ id: 'obs-fill', type: 'fill', source: 'obs', layout: vis, paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0 } });
  map.addLayer({ id: 'obs-line', type: 'line', source: 'obs', layout: { ...vis, 'line-join': 'round' }, paint: { 'line-color': '#1d3d85', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.1, 14, 2.4], 'line-opacity': 0 } });
  // people dots
  map.addSource('dots', { type: 'geojson', data: D.dots });
  for (const [id, t] of [['dots-lo', 0], ['dots', 1]]) map.addLayer({ id, type: 'circle', source: 'dots', layout: vis, filter: ['==', ['get', 't'], t], paint: {
    'circle-color': ['match', ['get', 'g'], 0, GM_COL[0], 1, GM_COL[1], 2, GM_COL[2], 3, GM_COL[3], 4, GM_COL[4], '#8a8496'],
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, .9, 11, 1.6, 13, 2.8, 15, 4.6],
    'circle-opacity': 0, 'circle-stroke-width': 0 } });
  // highlighted places
  map.addLayer({ id: 'hl-case', type: 'line', source: 'obs', layout: { ...vis, 'line-join': 'round' }, filter: ['in', ['get', 'site'], ['literal', []]], paint: { 'line-color': '#2b2945', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 9], 'line-opacity': 0 } });
  map.addLayer({ id: 'hl-line', type: 'line', source: 'obs', layout: { ...vis, 'line-join': 'round' }, filter: ['in', ['get', 'site'], ['literal', []]], paint: { 'line-color': '#f0c25a', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5], 'line-opacity': 0 } });
}
const WF = { n: 0 };

// ------------------------------------------------------------------ layout / cameras
let VW = innerWidth, VH = innerHeight;
const isPhone = () => VW < 720;
function padding() {
  if (isPhone()) return { top: 56, bottom: Math.round(VH * .5), left: 10, right: 10 };
  const left = Math.min(560, Math.round(VW * .36)) + 40;
  return { top: 60, bottom: 50, left, right: 60 };
}
function fitCam(bbox, pitch, bearing, maxZ = 15.2, extraPad = 0, extraRight = 0) {
  const pad = padding(); const p2 = { top: pad.top + 40 + extraPad, bottom: pad.bottom + 40 + extraPad, left: pad.left + 30 + extraPad, right: pad.right + 30 + extraPad + extraRight };
  const cam = map.cameraForBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: p2, bearing: 0 });
  const c = [(bbox[0] + bbox[2]) / 2, unY((mercY(bbox[1]) + mercY(bbox[3])) / 2)];
  // only the zoom is taken from cameraForBounds; the centre goes to the middle of the padded viewport via jumpTo padding
  return { c, z: Math.min(maxZ, (cam?.zoom ?? 12) - (pitch > 40 ? .3 : .1)), p: pitch, b: bearing };
}
function computeCams() {
  // dev aid for camera tuning: ?camfor=<step>&cam=lon,lat,zoom,pitch,bearing
  if (Q.get('camfor') && Q.get('cam')) { const k = +Q.get('camfor'), v = Q.get('cam').split(',').map(Number); if (STEPS[k]) STEPS[k].cam = STEPS[k].camPhone = { c: [v[0], v[1]], z: v[2], p: v[3], b: v[4] }; }
  for (const st of STEPS) {
    st._cam = isPhone() && st.camPhone ? st.camPhone : st.cam;
    if (st.place) {
      const bb = st.place.bbox; const padM = 0.004;
      st._cam = fitCam([bb[0] - padM, bb[1] - padM, bb[2] + padM, bb[3] + padM], 54, st.bearing, 15.0);
    } else if (st.coin && !st.final) {
      const xs = (D.top || []).map(p => p.c[0]), ys = (D.top || []).map(p => p.c[1]);
      if (xs.length) st._cam = fitCam([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], 38, 0, 12.5, isPhone() ? 10 : 40, isPhone() ? 0 : 230);
      else st._cam = { c: [-103.35, 20.62], z: 11, p: 38, b: 0 };
    }
  }
}
function camLerp(A, B, e) {
  if (!B || A === B || e <= 0) return A; if (e >= 1) return B;
  const ax = mercX(A.c[0]), ay = mercY(A.c[1]), bx = mercX(B.c[0]), by = mercY(B.c[1]);
  const zmin = Math.min(A.z, B.z);
  const distPx = Math.hypot(bx - ax, by - ay) * 512 * 2 ** zmin;
  const arc = clamp(Math.log2(Math.max(1, distPx / (Math.min(VW, VH) * .6))), 0, 3) * .85;
  // let the centre move faster than the zoom in the middle of long flights (classic fly-to feel)
  const ec = arc > .2 ? smooth(clamp((e - .1) / .8)) : e;
  const z = lerp(A.z, B.z, e) - arc * Math.sin(Math.PI * e);
  let db = ((B.b - A.b + 540) % 360) - 180;
  return { c: [unX(lerp(ax, bx, ec)), unY(lerp(ay, by, ec))], z, p: lerp(A.p, B.p, e), b: A.b + db * e };
}

// ------------------------------------------------------------------ state
// state = { a, b, e, P: {k: step-progress 0..1} }
let anchors = [];
function computeAnchors() {
  const els = [...document.querySelectorAll('#story .step')];
  const act = isPhone() ? .62 : .5;
  anchors = els.map((el, i) => {
    const card = el.querySelector('.card'); const r = card.getBoundingClientRect(); const top = r.top + scrollY;
    return i === 0 ? 0 : Math.max(0, top + r.height / 2 - VH * act);
  });
  for (let i = 1; i < anchors.length; i++) if (anchors[i] <= anchors[i - 1]) anchors[i] = anchors[i - 1] + 1;
}
function rFromScroll(y) {
  if (y <= anchors[0]) return 0;
  for (let i = 0; i < anchors.length - 1; i++) if (y < anchors[i + 1]) return i + (y - anchors[i]) / (anchors[i + 1] - anchors[i]);
  return anchors.length - 1;
}
const easeGap = u => smooth(clamp((u - .16) / .66));
function stateFromR(r) {
  const n = STEPS.length; r = clamp(r, 0, n - 1);
  const a = Math.min(n - 1, Math.floor(r)); const b = Math.min(n - 1, a + 1);
  const e = a === b ? 0 : easeGap(r - a);
  const P = {}; for (let k = 0; k < n; k++) P[k] = clamp((r - (k - .42)) / .7);
  return { a, b, e, P };
}
// demo schedule: [t0, t1, a, b]
function demoSched() {
  const last = STEPS.length - 1;
  const hasPlace = STEPS.findIndex(s => s.place);
  const coinI = STEPS.findIndex(s => s.coin);
  const seq = [
    [0, 2.3, 0, 0], [2.3, 3.7, 0, 1], [3.7, 5.5, 1, 1], [5.5, 6.9, 1, 2], [6.9, 8.7, 2, 2], [8.7, 9.9, 2, 3], [9.9, 13.3, 3, 3],
    [13.3, 14.4, 3, 4], [14.4, 16.0, 4, 4], [16.0, 17.1, 4, 5], [17.1, 18.9, 5, 5], [18.9, 20.0, 5, 6], [20.0, 21.8, 6, 6],
  ];
  if (coinI > 0) {
    seq.push([21.8, 22.9, 6, coinI], [22.9, 24.6, coinI, coinI]);
    if (hasPlace > 0) seq.push([24.6, 25.8, coinI, hasPlace], [25.8, 27.6, hasPlace, hasPlace], [27.6, 28.7, hasPlace, last], [28.7, 30, last, last]);
    else seq.push([24.6, 26, coinI, last], [26, 30, last, last]);
  } else seq.push([21.8, 23, 6, last], [23, 30, last, last]);
  return seq;
}
function stateFromT(t) {
  const seq = demoSched(); t = clamp(t, 0, DUR);
  let seg = seq[seq.length - 1]; for (const s of seq) if (t >= s[0] && t < s[1]) { seg = s; break; }
  const [t0, t1, a, b] = seg; const u = clamp((t - t0) / (t1 - t0));
  const P = {};
  for (let k = 0; k < STEPS.length; k++) {
    // progress of k: 0 before its hold, ramps during its hold, 1 after
    const hold = seq.find(s => s[2] === k && s[3] === k);
    P[k] = hold ? clamp((t - hold[0]) / (hold[1] - hold[0])) : (t > 0 ? 1 : 0);
  }
  return a === b ? { a, b, e: 0, P } : { a, b, e: smooth(u), P };
}
function weights(st) { const w = new Map(); w.set(st.a, 1 - st.e); if (st.b !== st.a) w.set(st.b, (w.get(st.b) || 0) + st.e); return w; }
function mixL(st) {
  const out = { ...DEFAULT_L }; for (const k in out) out[k] = 0;
  for (const [k, w] of weights(st)) { const L = { ...DEFAULT_L, ...STEPS[k].L }; for (const g in out) out[g] += (L[g] || 0) * w; }
  return out;
}

// ------------------------------------------------------------------ rendering
const cur = { op: {}, cam: null, sky: -1, hlKey: '', water: [] };
function setGroup(g, v) {
  const prev = cur.op[g]; if (prev != null && Math.abs(prev - v) < .004) return; cur.op[g] = v;
  for (const [id, prop, max] of GROUPS[g] || []) {
    if (!map.getLayer(id)) continue;
    // obs-line is shared by obs and obsLine: use the max of both
    let val = v * max;
    if (id === 'obs-line') val = Math.max(cur.op.obs || 0, cur.op.obsLine || 0) * max;
    map.setLayoutProperty(id, 'visibility', val > .005 ? 'visible' : 'none');
    map.setPaintProperty(id, prop, val);
  }
}
function waterAt(minute, w) {
  if (!WF.n) return;
  const fr = MOD.water.frames;
  let i0 = 0; while (i0 < fr.length - 1 && fr[i0 + 1].t_min <= minute) i0++;
  const i1 = Math.min(fr.length - 1, i0 + 1);
  const f = i1 === i0 ? 0 : clamp((minute - fr[i0].t_min) / (fr[i1].t_min - fr[i0].t_min));
  const want = new Array(fr.length).fill(0);
  if (minute >= fr[0].t_min - 5) { want[i0] = w * (minute < fr[0].t_min ? clamp((minute - fr[0].t_min + 5) / 5) : 1); if (i1 !== i0) want[i1] = w * f; }
  for (let i = 0; i < fr.length; i++) {
    const v = want[i]; if (Math.abs((cur.water[i] ?? -1) - v) < .004) continue; cur.water[i] = v;
    map.setLayoutProperty('wf' + i, 'visibility', v > .005 ? 'visible' : 'none');
    map.setPaintProperty('wf' + i, 'raster-opacity', v * .92);
  }
}
let lastState = null, lastT = 0;
function render(st, T) {
  lastState = st; lastT = T;
  const A = STEPS[st.a], B = STEPS[st.b];
  const cam = camLerp(A._cam, B._cam, st.e);
  const pad = padding();
  const k = cam.c[0].toFixed(6) + cam.c[1].toFixed(6) + cam.z.toFixed(4) + cam.p.toFixed(3) + cam.b.toFixed(3) + JSON.stringify(pad);
  if (k !== cur.cam) { cur.cam = k; map.jumpTo({ center: cam.c, zoom: cam.z, pitch: cam.p, bearing: cam.b, padding: pad }); }
  const L = mixL(st);
  for (const g of Object.keys(GROUPS)) setGroup(g, L[g] || 0);
  // sky darkens with the storm
  const sk = Math.round(L.storm * 20) / 20; if (sk !== cur.sky) { cur.sky = sk; map.setSky(skyFor(sk * .85)); }
  document.getElementById('storm').style.opacity = (L.storm * .85).toFixed(3);
  // dynamic water: minute from the progress of the "water" step
  const wi = STEPS.findIndex(s => s.scrub === 'water');
  const minute = wi >= 0 ? lerp(12, 80, smooth(st.P[wi] ?? 0)) : 0;
  waterAt(minute, L.water);
  const ck = document.getElementById('clk-t'); if (ck) { ck.textContent = `min ${Math.round(minute)}`; document.getElementById('clk-bar').style.width = `${minute / 120 * 100}%`; }
  // highlighted sites
  const w = weights(st); const hl = new Set();
  for (const [k2, wt] of w) { if (wt < .02) continue; const s = STEPS[k2]; if (s.place) hl.add(s.place.id); else if (s.coin) (D.ranked && s.final ? D.ranked : D.top || []).forEach(p => hl.add(p.id)); }
  const hk = [...hl].sort().join(','); if (hk !== cur.hlKey) { cur.hlKey = hk; for (const id of ['hl-case', 'hl-line']) map.setFilter(id, ['in', ['get', 'site'], ['literal', [...hl]]]); }
  // overlays
  frameProjector(); updateNotes(st); updatePins(st, L); drawFX(L, T); updateClouds(L, T); updateCards(st);
}

// ------------------------------------------------------------------ notes & pins (DOM, projected each frame)
// Fast projection: map.project() re-derives the covering tiles on every call with terrain (~0.25 ms), far too slow for
// thousands of particles. We take the transform's 3D pixel matrix once per frame and look elevations up directly.
let PJ = null;
function frameProjector() {
  const tr = map.transform; const M = tr._pixelMatrix3D || tr.pixelMatrix3D; const ws = tr.worldSize;
  const terr = map.terrain; const zE = clamp(Math.round(map.getZoom()) + 1, 8, 14);
  if (!M || !ws) { PJ = { ok: false, z: zE }; return; }
  const elev = (lon, lat) => { if (!terr) return 0; try { return terr.getElevationForLngLatZoom(new maplibregl.LngLat(lon, lat), zE) || 0; } catch { return 0; } };
  const at = (lon, lat, e) => {
    const x = mercX(lon) * ws, y = mercY(lat) * ws;
    const w = M[3] * x + M[7] * y + M[11] * e + M[15]; if (w <= 0) return null;
    return { x: (M[0] * x + M[4] * y + M[8] * e + M[12]) / w, y: (M[1] * x + M[5] * y + M[9] * e + M[13]) / w };
  };
  PJ = { ok: true, z: zE, elev, at };
}
function project(ll) { if (!PJ?.ok) return map.project(ll); return PJ.at(ll[0], ll[1], PJ.elev(ll[0], ll[1])) || { x: -9999, y: -9999 }; }
function updateNotes(st) {
  const vis = {}; for (const [k, w] of weights(st)) for (const id of STEPS[k].notes || []) vis[id] = (vis[id] || 0) + w;
  for (const [id, n] of Object.entries(notesEl)) {
    let v = smooth(clamp(vis[id] || 0));
    if (v < .01) { if (n.vis !== 0) { n.el.style.opacity = 0; n.el.style.display = 'none'; n.vis = 0; } continue; }
    const p = project(n.ll);
    if (!p || p.x < -80 || p.x > VW + 80 || p.y < 30 || p.y > VH + 40) v = 0;
    n.el.style.display = 'block'; n.el.style.opacity = v.toFixed(3); n.el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`; n.vis = v;
  }
}
let pinEls = [];
function bounceOut(x) { const n = 7.5625, d = 2.75; if (x < 1 / d) return n * x * x; if (x < 2 / d) return n * (x -= 1.5 / d) * x + .75; if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + .9375; return n * (x -= 2.625 / d) * x + .984375; }
function buildPins() {
  const host = document.getElementById('pins'); host.innerHTML = ''; pinEls = [];
  for (let i = 0; i < 5; i++) { const el = document.createElement('div'); el.className = 'pin'; el.innerHTML = coin(i + 1) + '<span class="lab"></span>'; host.appendChild(el); pinEls.push(el); }
}
function updatePins(st, L) {
  const list = (STEPS[st.b]?.final || STEPS[st.a]?.final) && D.ranked ? D.ranked : (D.top || []);
  const ci = STEPS.findIndex(s => s.coin);
  const drop = ci < 0 ? 1 : st.P[ci] ?? 1;
  const focus = new Map(); for (const [k, w] of weights(st)) if (STEPS[k].place) focus.set(STEPS[k].place.id, w);
  const fmax = Math.max(0, ...focus.values());
  pinEls.forEach((el, i) => {
    const p = list[i]; if (!p || L.pins < .01) { el.style.opacity = 0; return; }
    const pr = project(p.c);
    const di = clamp((drop - i * .13) / .42);
    const y = pr.y - (1 - bounceOut(di)) * 150;
    const f = focus.get(p.id) || 0; const sc = (1 - fmax * .25) + f * .55;
    el.style.opacity = (L.pins * clamp(di * 4) * (1 - fmax * .5 + f * .5) * clamp((pr.y - 60) / 50)).toFixed(3);
    el.style.transform = `translate(${pr.x.toFixed(1)}px,${y.toFixed(1)}px) scale(${sc.toFixed(3)})`;
    el.style.zIndex = f > .5 ? 5 : 1;
    const lab = el.querySelector('.lab'); const txt = placeTitle(p); if (lab.textContent !== txt) lab.textContent = txt;
    lab.classList.toggle('left', pr.x > VW - 330);
    lab.style.display = (f > .3 || STEPS[st.a].coin && !STEPS[st.a].place && !STEPS[st.a].final) && !isPhone() ? 'block' : 'none';
  });
}

// ------------------------------------------------------------------ FX canvas (rain, flowing water, ripples)
const fxc = document.getElementById('fx'); const fx = fxc.getContext('2d');
let DPR = Math.min(2, devicePixelRatio || 1);
const RAIN = Array.from({ length: 900 }, (_, i) => { const r = rng(1000 + i); return { x: r(), ph: r(), sp: .9 + r() * .7, len: 14 + r() * 18, w: .8 + r() * 1.2, sx: r(), sy: r(), sph: r() }; });
let OBSPTS = [];
function sizeFX() { DPR = Math.min(2, devicePixelRatio || 1); fxc.width = Math.round(VW * DPR); fxc.height = Math.round(VH * DPR); }
function drawFX(L, T) {
  fx.setTransform(DPR, 0, 0, DPR, 0, 0); fx.clearRect(0, 0, VW, VH);
  if (L.flow > .01 && FLOW.parts.length) drawFlow(L.flow, T);
  if (L.ripples > .01) drawRipples(L.ripples, T);
  if (L.rain > .01) drawRain(L.rain, T);
}
function drawRain(a, T) {
  const n = Math.round(RAIN.length * clamp(a) * clamp(VW * VH / (1600 * 1000), .35, 1.2));
  const slant = .22;
  fx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const d = RAIN[i]; const H = VH + 140;
    const y = ((d.ph + T * d.sp * .9) % 1) * H - 70; const x = d.x * (VW + 200) - 100 + y * slant;
    fx.strokeStyle = `rgba(40,58,108,${(.34 * a).toFixed(3)})`; fx.lineWidth = d.w + .6;
    fx.beginPath(); fx.moveTo(x, y); fx.lineTo(x - d.len * slant, y - d.len); fx.stroke();
    fx.strokeStyle = `rgba(250,252,255,${(.55 * a).toFixed(3)})`; fx.lineWidth = d.w * .6;
    fx.beginPath(); fx.moveTo(x - .8, y - 1); fx.lineTo(x - d.len * slant * .7, y - d.len * .7); fx.stroke();
  }
  // splashes on the ground (lower part of the view)
  if (a > .4) {
    const m = Math.round(160 * (a - .4) / .6);
    for (let i = 0; i < m; i++) {
      const d = RAIN[i]; const ph = (d.sph + T * 1.7) % 1;
      const x = d.sx * VW, y = VH * .35 + d.sy * VH * .65; const r = 2 + ph * 9;
      fx.strokeStyle = `rgba(245,250,255,${((1 - ph) * .7 * a).toFixed(3)})`; fx.lineWidth = 1.4;
      fx.beginPath(); fx.ellipse(x, y, r, r * .38, 0, 0, Math.PI * 2); fx.stroke();
    }
  }
}
function drawFlow(a, T) {
  const b = map.getBounds(); const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
  const mx = (e - w) * .05, my = (n - s) * .05;
  const z = map.getZoom(); const mpp = 78271.52 * Math.cos(20.65 * Math.PI / 180) / 2 ** z; // m per css px (512 px tiles)
  const tailM = 14 * mpp;
  fx.lineCap = 'round';
  const big = [], small = [];
  if (!PJ?.ok) return;
  for (const p of FLOW.parts) {
    const Ln = FLOW.lines[p.li];
    const d = (p.off + p.v * T) % Ln.len;
    const h = pointAt(Ln, d); if (h[0] < w - mx || h[0] > e + mx || h[1] < s - my || h[1] > n + my) continue;
    const ph = projAlong(Ln, d); if (!ph || ph.x < -20 || ph.x > VW + 20 || ph.y < -20 || ph.y > VH + 20) continue;
    const pt = projAlong(Ln, Math.max(0, d - tailM)); if (!pt) continue;
    (Ln.big ? big : small).push(pt.x, pt.y, ph.x, ph.y, Ln.culv ? 1 : 0);
  }
  const fade = clamp((z - 9.3) / 1.2) * a;
  // batched: one path for tails, one for culvert tails, one for heads (cheap even with thousands of particles)
  for (const [arr, wd] of [[small, 2.2], [big, 3.4]]) {
    for (const culv of [0, 1]) {
      fx.strokeStyle = `rgba(214,236,255,${((culv ? .35 : .7) * fade).toFixed(3)})`; fx.lineWidth = wd;
      fx.beginPath();
      for (let i = 0; i < arr.length; i += 5) if (arr[i + 4] === culv) { fx.moveTo(arr[i], arr[i + 1]); fx.lineTo(arr[i + 2], arr[i + 3]); }
      fx.stroke();
    }
    fx.fillStyle = `rgba(255,255,255,${(.95 * fade).toFixed(3)})`;
    fx.beginPath();
    for (let i = 0; i < arr.length; i += 5) { fx.moveTo(arr[i + 2] + wd * .6, arr[i + 3]); fx.arc(arr[i + 2], arr[i + 3], wd * .6, 0, Math.PI * 2); }
    fx.fill();
  }
}
function drawRipples(a, T) {
  const b = map.getBounds();
  for (let i = 0; i < OBSPTS.length; i++) {
    const q = OBSPTS[i]; if (!b.contains(q.ll)) continue;
    const p = project(q.ll); if (p.x < 0 || p.x > VW || p.y < 0 || p.y > VH) continue;
    for (const off of [0, .5]) {
      const ph = (q.ph + off + T * .55) % 1; const r = 3 + ph * 18;
      fx.strokeStyle = `rgba(29,61,133,${((1 - ph) * .75 * a).toFixed(3)})`; fx.lineWidth = 2;
      fx.beginPath(); fx.ellipse(p.x, p.y, r, r * .55, 0, 0, Math.PI * 2); fx.stroke();
    }
  }
}
// clouds
let cloudEls = [];
function buildClouds() {
  const host = document.getElementById('clouds'); host.innerHTML = '';
  cloudEls = Array.from({ length: 6 }, (_, i) => { const el = document.createElement('div'); el.innerHTML = cloud(i); const c = el.firstElementChild; host.appendChild(c); return { el: c, x: rng(70 + i)(), y: [.04, .10, .02, .14, .07, .12][i], s: [1, .7, 1.25, .6, .9, .8][i], v: [9, 6, 12, 5, 8, 7][i] }; });
}
function updateClouds(L, T) {
  const host = document.getElementById('clouds'); host.style.opacity = clamp(L.clouds).toFixed(3);
  if (L.clouds < .01) return;
  for (const c of cloudEls) { const span = VW + 400; const x = ((c.x * span + T * c.v) % span) - 300; c.el.style.transform = `translate(${x.toFixed(1)}px,${(c.y * VH).toFixed(1)}px) scale(${(c.s * (isPhone() ? .55 : 1)).toFixed(3)})`; }
}

// ------------------------------------------------------------------ cards
function renderStory() {
  const host = document.getElementById('story');
  host.innerHTML = STEPS.map((s, i) => `<section class="step ${s.cls || ''}" data-i="${i}"><article class="card ${s.cls === 'cover' ? 'cover-card' : ''}" style="--tilt:${[-.6, .5, -.3, .6, -.5, .3][i % 6]}deg">
    <span class="tape"></span><div class="gslot">${gota(s.pose, 'g' + i)}</div><div class="cbody">${s.html()}</div></article></section>`).join('');
  const rail = document.getElementById('rail');
  rail.innerHTML = STEPS.map((s, i) => `<button data-i="${i}" class="${s.coin && s.place ? 'coinb' : ''}" aria-label="${esc(s.key)}"><span>${esc(s.key)}</span></button>`).join('');
  rail.onclick = e => { const b = e.target.closest('button'); if (!b) return; scrollTo({ top: anchors[+b.dataset.i] + 2, behavior: 'smooth' }); };
  const rb = document.getElementById('rank-btns');
  if (rb) rb.onclick = e => { const b = e.target.closest('button'); if (!b) return; rankPlaces(b.dataset.rank); rb.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); fillRankList(); cur.hlKey = ''; };
  fillRankList();
}
function fillRankList() {
  const el = document.getElementById('rank-list'); if (!el) return;
  const list = D.ranked || D.top || [];
  el.innerHTML = list.map((p, i) => `<li><span class="n">${i + 1}</span><span><b>${esc(placeTitle(p))}</b><small>${esc(p.munName)} · ≈${approx(p.ppl)} dentro · ${D.rankMode === 'coincide' && p.hidroS ? `≈${approx(both(p))} donde coinciden · modelo ${Math.round(p.hidroS.f30 * 100)} % con +30 cm` : p.hiP >= 50 ? `≈${approx(p.hiP)} en marginación alta` : `prioridad ${fmt(p.prio)}`}</small></span></li>`).join('');
}
let lastActive = -1;
function updateCards(st) {
  const act = st.e < .5 ? st.a : st.b;
  if (act !== lastActive) { lastActive = act; document.querySelectorAll('#rail button').forEach((b, i) => b.classList.toggle('on', i === act)); }
  if (!DEMO) return;
  document.querySelectorAll('#story .step').forEach((el, i) => {
    let o = 0, y = 0;
    if (i === st.a) { o = 1 - smooth(clamp(st.e / .45)); y = -18 * smooth(clamp(st.e / .45)); }
    if (i === st.b && st.b !== st.a) { const u = smooth(clamp((st.e - .55) / .45)); o = Math.max(o, u); y = 18 * (1 - u); }
    el.style.opacity = o.toFixed(3); el.style.transform = `translateY(${y.toFixed(1)}px)`; el.style.visibility = o > .005 ? 'visible' : 'hidden';
  });
}

// ------------------------------------------------------------------ boot
function settle(timeout = 25000) {
  return new Promise(res => {
    const t0 = performance.now();
    const chk = () => {
      const ok = map.loaded() && map.areTilesLoaded() && map.isStyleLoaded();
      if (ok || performance.now() - t0 > timeout) res(ok); else setTimeout(chk, 40);
    };
    map.triggerRepaint(); setTimeout(chk, 60);
  });
}
async function main() {
  document.getElementById('boot-gota').innerHTML = gota('cae', 'boot');
  if (DEMO) document.body.classList.add('demo');
  await loadAll();
  derive();
  D.dots = makeDots(); makeFlow();
  OBSPTS = (D.obs?.features || []).filter(f => f.geometry.type === 'Point').map((f, i) => ({ ll: f.geometry.coordinates, ph: rng(500 + i)() }));
  const cand = (D.places || []).slice().sort((a, b) => b.score - a.score).slice(0, 60);
  await Promise.all([sampleGap(cand), sampleHidro(cand)]);
  if (cand.some(p => p.hidroS)) {
    // default ranking once the 5 m model exists: observed AND modeled, weighted by the exploratory priority
    const R = { coincide: { label: 'Registro y modelo coinciden', needsModel: true, key: p => both(p) * (p.prio || 0) / 100 } };
    for (const k of Object.keys(RANKS)) R[k] = RANKS[k]; for (const k of Object.keys(RANKS)) delete RANKS[k]; Object.assign(RANKS, R);
    D.defaultRank = 'coincide'; rankPlaces('coincide');
  }
  STEPS = buildSteps();
  try { await document.fonts.ready; } catch { }
  renderStory(); buildNotes(); buildPins(); buildClouds(); sizeFX();
  map = new maplibregl.Map({ container: 'map', style: makeStyle(), center: [-103.37, 20.6], zoom: 10, pitch: 50, bearing: -12, maxPitch: 75, interactive: false, attributionControl: false, fadeDuration: 0, pixelRatio: Math.min(devicePixelRatio || 1, DEMO ? 2 : 1.5), canvasContextAttributes: { antialias: true } });
  window.__inv2 = { D, MOD, S, STEPS: () => STEPS };
  window.__map = map;
  await new Promise(r => map.once('load', r));
  map.setTerrain({ source: 'dem', exaggeration: 1 });
  addLayers();
  computeCams(); computeAnchors();
  const st0 = DEMO ? stateFromT(0) : stateFromR(rFromScroll(scrollY));
  render(st0, 0);
  await (DEMO ? settle(20000) : Promise.race([settle(20000), new Promise(r => setTimeout(r, 5000))]));
  const boot = document.getElementById('boot'); if (DEMO) boot.remove(); else boot.classList.add('gone');
  addEventListener('resize', () => { VW = innerWidth; VH = innerHeight; sizeFX(); computeCams(); computeAnchors(); cur.cam = null; if (lastState) render(lastState, lastT); });
  if (DEMO) startDemo(); else startLive();
  if (!DEMO) watchSims();
}

// live scroll loop (smoothed)
function startLive() {
  let r = rFromScroll(scrollY);
  const st = Q.get('step'); if (st != null) { const k = clamp(+st, 0, STEPS.length - 1); scrollTo(0, anchors[k]); r = k; }
  const loop = now => {
    const target = rFromScroll(scrollY);
    r += (target - r) * .14; if (Math.abs(target - r) < 1e-4) r = target;
    render(stateFromR(r), now / 1000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// demo: autoplay + deterministic seek
let demoRunning = false, demoStart = 0;
function startDemo() {
  demoRunning = AUTOPLAY;
  const loop = now => {
    if (!demoRunning) return;
    const t = ((now - demoStart) / 1000) % DUR;
    render(stateFromT(t), t);
    requestAnimationFrame(loop);
  };
  if (AUTOPLAY) { demoStart = performance.now(); requestAnimationFrame(loop); }
}
let readyResolve; const ready = new Promise(r => readyResolve = r);
window.__cauceDemo = {
  duration_s: DUR,
  ready,
  async seek(t) {
    await ready; demoRunning = false;
    const st = stateFromT(t);
    render(st, t);
    await settle();
    cur.cam = null; render(st, t); // re-project overlays once terrain tiles are in
    await raf(); await raf();
    return true;
  },
};

main().then(() => readyResolve(true)).catch(e => {
  console.error(e);
  const b = document.querySelector('#boot p'); if (b) b.textContent = 'No se pudo cargar: ' + e.message;
});

// ------------------------------------------------------------------ watch for new simulation outputs (live mode only)
function watchSims() {
  let sig = null;
  const poll = async () => {
    const [hz, sd, sr, sh] = await Promise.all([getJSON(`${SH}/hazard/index.json`), getJSON(`${SH}/status/sim-drenaje.json`), getJSON(`${SH}/status/sim-relieve.json`), getJSON(`${SH}/status/sim-hidro.json`)]);
    const s2 = JSON.stringify([(hz?.layers || []).map(l => l.id), sd?.state, sr?.state, sh?.state]);
    if (sig === null) { sig = s2; return; }
    if (s2 === sig) return; sig = s2;
    const note = document.getElementById('attrib-text');
    if (note && !/nuevos resultados/.test(note.textContent)) note.insertAdjacentHTML('afterbegin', '<b style="color:var(--verm)">Hay nuevos resultados de simulación: <a href="" onclick="location.reload();return false">recargar</a></b> · ');
  };
  poll(); setInterval(poll, 90000);
}
