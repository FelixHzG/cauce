// Alcaldía por un día — cozy flood-investment strategy toy (cauce. labs, agent invertir-3)
import { TOOLS, TOOL, BUDGET, C0, buildModel, evaluate, greedyPlan, marginal, encodePlan, decodePlan, curveAt, addedCap, storeEff } from './model.js';
import { Board, Water, w2s, s2w, HT } from './board.js';
import { ICONS, GOTA, COIN, HAND, STAR, COMPASS, INK, svgImage } from './art.js';

const Q = new URLSearchParams(location.search);
const DEMO = Q.get('demo') === '1';
const FORCE_OBS = Q.get('modelo') === 'observado';
const SHARED = '/labs/shared/';
const SD = SHARED + 'hazard/modeled/sim-drenaje/';
const $ = id => document.getElementById(id);
const fmt = n => (Math.round(n) || 0).toLocaleString('es-MX');
const money = mdp => '$' + Math.round(mdp).toLocaleString('es-MX');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3);
const easeIO = t => t <= 0 ? 0 : t >= 1 ? 1 : t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const MUN = { '039': 'Guadalajara', '120': 'Zapopan', '098': 'Tlaquepaque', '101': 'Tonalá', '097': 'Tlajomulco', '070': 'El Salto', '051': 'Juanacatlán', '044': 'Ixtlahuacán', '124': 'Zapotlanejo', '002': 'Acatlán' };

// ------------------------------------------------------------------------------------------------ clock
let demoT = 0; const now = () => DEMO ? demoT : performance.now() / 1000;

// ------------------------------------------------------------------------------------------------ state
const S = window.__inv3 = {
  B: null, m: null, board: null, water: null, img: {}, items: [], ev: null, ev0: null, frontier: null, bestRatio: {},
  tool: null, hover: -1, sel: -1, mode: 'agua', obs: true, ghost: null, cam: null, fit: null, tween: null,
  W: 0, H: 0, dpr: 1, dirty: true, lastInput: 0, lastChange: -10, counters: {}, msg: '', missions: [], src: {}, stars: 0,
};
let readyResolve; const ready = new Promise(r => (readyResolve = r));
window.__cauceDemo = { duration_s: 25, ready, seek: async t => { await ready; return demoSeek(t); } };

// ------------------------------------------------------------------------------------------------ loading
async function getJSON(url) { try { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) return null; return await r.json(); } catch { return null; } }
async function getPixels(url) {
  const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status);
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, d: x.getImageData(0, 0, bmp.width, bmp.height).data };
}
async function loadAll() {
  const ld = $('ldTxt');
  ld.textContent = 'Inflando el mapa…';
  const [board, stats, drainage, terrain] = await Promise.all([
    getJSON('data/board.json'), getJSON(SD + 'stats.json'), FORCE_OBS ? null : getJSON(SD + 'ageb-drainage.json'),
    getJSON(SHARED + 'hazard/modeled/sim-relieve/ageb-terrain.json'),
  ]);
  if (!board) throw new Error('board.json');
  S.B = board; S.src = { stats, drainage, terrain };
  const lb = board.meta.labels; const mi = stats?.web?.mercatorImage;
  if (lb && mi && mi.width === lb.width && mi.height === lb.height) {
    ld.textContent = 'Llenando los charcos del modelo…';
    try {
      const [fq, ind, lab] = await Promise.all([getPixels(SD + 'web/freq-by-cap.png'), getPixels(SD + 'web/indicators.png'), getPixels('data/labels.png')]);
      const N = fq.w * fq.h, freqV = new Uint32Array(N), indA = new Uint8Array(N * 3), labA = new Uint16Array(N);
      for (let p = 0, q = 0; p < N; p++, q += 4) { freqV[p] = (fq.d[q] << 16) | (fq.d[q + 1] << 8) | fq.d[q + 2]; indA[p * 3] = ind.d[q]; indA[p * 3 + 1] = ind.d[q + 1]; indA[p * 3 + 2] = ind.d[q + 2]; labA[p] = (lab.d[q] << 8) | lab.d[q + 1]; }
      const pxKm2 = Math.abs((lb.world.x1 - lb.world.x0) / lb.width * (lb.world.y0 - lb.world.y1) / lb.height) * board.meta.mScale ** 2 / 1e6;
      S.img = { freqV, ind: indA, lab: labA, W: fq.w, H: fq.h, pxKm2 };
    } catch (e) { console.warn('sim-drenaje images unavailable', e); S.img = {}; }
  }
  const art = {};
  for (const t of TOOLS) art[t.id] = await svgImage(ICONS[t.id], 128, 128);
  art.coin = await svgImage(COIN, 64, 64);
  S.art = art;
  await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2500))]);
  await document.fonts.load('600 20px Fredoka').catch(() => {});
}

function buildAll() {
  const B = S.B;
  S.m = buildModel(B, { stats: S.src.stats, drainage: S.src.drainage, images: FORCE_OBS ? null : (S.img.freqV ? S.img : null), terrain: S.src.terrain });
  if (!S.board) S.board = new Board(B);
  if (S.img.freqV && !FORCE_OBS && !S.water) S.water = new Water({ freqV: S.img.freqV, lab: S.img.lab, W: S.img.W, H: S.img.H }, S.m.n);
  S.ev0 = evaluate(S.m, []);
  // reference greedy plan → frontier (spent → people) for the "plan de Gota" comparison
  const g = greedyPlan(S.m, BUDGET);
  const fr = [[0, 0]]; { const items = []; for (const it of g.items) { items.push(it); const e = evaluate(S.m, items); fr.push([e.cost, e.people]); } }
  S.frontier = fr; S.gotaFull = g;
  for (const t of TOOLS) { let b = 0; for (let i = 0; i < S.m.n; i++) { if (S.m.E0[i] < 5) continue; const v = marginal(S.m, S.ev0, t.id, i, []) / t.cost; if (v > b) b = v; } S.bestRatio[t.id] = b; }
  updateBadge(); renderLegend();
}
function gotaAt(spent) { const f = S.frontier; if (!f || spent <= 0) return 0; for (let k = 1; k < f.length; k++) if (f[k][0] >= spent) { const [c0, p0] = f[k - 1], [c1, p1] = f[k]; return lerp(p0, p1, (spent - c0) / Math.max(1e-9, c1 - c0)); } return f[f.length - 1][1]; }

function updateBadge() {
  const m = S.m, b = $('modelBadge');
  b.classList.toggle('prov', m.mode === 'obs'); b.classList.toggle('pre', m.mode === 'sim-img');
  $('modelTxt').textContent = m.mode === 'sim' ? `Modelo: sim-drenaje (${m.runs} corridas)` : m.mode === 'sim-img' ? `Modelo: sim-drenaje preliminar (${m.runs} corridas)` : 'Modelo provisional: solo lo observado';
}

// ------------------------------------------------------------------------------------------------ plan changes
function recompute(withDiff = false, changed = null) {
  const m = S.m; S.ev = evaluate(m, S.items);
  if (S.water) {
    const r = new Float64Array(m.n); for (let i = 0; i < m.n; i++) { const sc = curveAt(m, i, S.ev.C[i]); r[i] = sc > 1e-6 ? S.ev.s[i] / sc : 1; }
    S.water.paint(S.ev.C, r, changed, withDiff); S.waterVer = (S.waterVer || 0) + 1;
  }
  // missions: most exposed untouched AGEBs
  const touched = new Set(S.items.flatMap((it, k) => S.ev.contrib[k].agebs));
  const ranked = [...Array(m.n).keys()].filter(i => !touched.has(i)).sort((a, b) => S.ev.E[b] - S.ev.E[a]); S.missions = [];
  for (const i of ranked) { if (S.missions.every(j => Math.hypot(m.cx[i] - m.cx[j], m.cy[i] - m.cy[j]) * S.B.meta.mScale > 3500)) S.missions.push(i); if (S.missions.length >= 3) break; }
  S.dirty = true;
}
function affected(items) { const s = new Set(); const ev = evaluate(S.m, items); items.forEach((it, k) => ev.contrib[k].agebs.forEach(j => s.add(j))); return s; }
function place(tool, i, t = now()) {
  const T = TOOL[tool]; const spent = S.ev.cost;
  if (spent + T.cost > BUDGET + 1e-9) { say(`No alcanza: te quedan <b>${money(BUDGET - spent)} M</b> y ${T.name.toLowerCase()} cuesta ${money(T.cost)} M.`); return false; }
  if (S.items.some(it => it.tool === tool && it.i === i)) { say(`Ya hay ${T.short.toLowerCase() === 'pozos' ? 'pozos' : 'un ' + T.short.toLowerCase()} aquí. Prueba en otra colonia.`); return false; }
  const before = S.ev;
  S.items.push({ tool, i, t });
  const ch = [...new Set([...affected(S.items), i])];
  recompute(true, ch);
  const k = S.items.length - 1; const c = S.ev.contrib[k];
  S.items[k].gain = S.ev.people - before.people; S.items[k].facGain = S.ev.fac - before.fac;
  S.lastChange = t; S.ghost = null; $('btnGhost').classList.remove('on');
  feedback(tool, i, S.items[k].gain);
  if (!DEMO) { history.replaceState(null, '', '#plan=' + encodePlan(S.items)); const pu = $('purse'); pu.classList.remove('bump'); void pu.offsetWidth; pu.classList.add('bump'); }
  return true;
}
function removeItem(k) {
  const ch = [...affected(S.items)]; S.items.splice(k, 1); recompute(false, null); S.lastChange = now();
  if (!DEMO) history.replaceState(null, '', S.items.length ? '#plan=' + encodePlan(S.items) : location.pathname + location.search);
  void ch; say('Listo, quitamos esa obra y regresó el dinero.');
}

// ------------------------------------------------------------------------------------------------ colours
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a, b, t) => { const A = hex(a), B = hex(b); return '#' + A.map((v, k) => Math.round(v + (B[k] - v) * t).toString(16).padStart(2, '0')).join(''); };
const RISK = ['#fbf1de', '#fde0b5', '#fcc293', '#f79c7a', '#e66f73', '#c24c74'], RISK_T = [0, 300, 1000, 2500, 5000, 9000];
const MARG = { 'Muy bajo': '#f3effa', 'Bajo': '#e2d9f7', 'Medio': '#cbbbf0', 'Alto': '#ab92e2', 'Muy alto': '#8b6dd2' };
let _tcKey = '', _tc = null;
function tileColors() {
  const key = S.mode + '|' + S.items.map(it => it.tool + it.i).join(',') + '|' + S.m.mode; if (key === _tcKey) return _tc;
  const m = S.m, A = m.agebs, ev = S.ev, out = new Array(m.n); const hasW = !!S.water;
  for (let i = 0; i < m.n; i++) {
    const a = A[i]; let c;
    if (S.mode === 'riesgo') { const d = ev.E[i] / Math.max(0.02, a.a); let k = 0; while (k < 5 && d >= RISK_T[k + 1]) k++; c = RISK[k]; }
    else if (S.mode === 'marg') c = MARG[a.gm] || '#efebe4';
    else {
      c = mix('#f9deb0', '#c6e6a4', Math.round(clamp((a.ve || 0) / 55, 0, 1) * 4) / 4);
      if (!hasW) { const s = ev.s[i]; if (s > 0.02) c = mix(c, '#8fd3f2', Math.round(clamp(s * 1.6, 0, 1) * 5) / 5 * 0.85); }
    }
    const prot = m.s0[i] > 1e-6 ? 1 - ev.s[i] / m.s0[i] : 0; const rel = ev.reloc[i] > 0;
    if ((prot > 0.04 || rel) && S.mode !== 'marg') c = mix(c, '#b4efd2', Math.round(clamp(rel ? 0.7 : 0.35 + prot, 0, 1) * 4) / 4);
    out[i] = c;
  }
  _tcKey = key; _tc = out; return out;
}

// ------------------------------------------------------------------------------------------------ rendering
const canvas = $('board'); const ctx = canvas.getContext('2d');
function resize() {
  S.dpr = Math.min(2, window.devicePixelRatio || 1); S.W = innerWidth; S.H = innerHeight;
  canvas.width = Math.round(S.W * S.dpr); canvas.height = Math.round(S.H * S.dpr);
  if (S.board) { const old = S.fit; S.fit = S.board.fitCam(S.W, S.H, pads()); if (S.W < 720) { S.fit.s *= 2.0; S.fit.oy = -70; } if (!S.cam || (old && Math.abs(S.cam.s - old.s) < 1e-9)) S.cam = { ...S.fit }; else { S.cam.oy = S.fit.oy; S.cam.ox = S.fit.ox; } }
  S.dirty = true;
}
function pads() { const ph = S.W < 720; return ph ? { t: 120, b: 150, l: 10, r: 10 } : { t: 96, b: 150, l: 60, r: 340 }; }
const hashf = i => { let x = Math.imul(i ^ 0x2545f491, 0x9e3779b1); x ^= x >>> 15; return (x >>> 0) / 4294967296; };

function camAt(t) { // user tween
  const tw = S.tween; if (!tw) return S.cam; const k = easeIO((t - tw.t0) / tw.dur);
  if (k >= 1) { S.cam = { ...tw.to }; S.tween = null; return S.cam; }
  return interpCam(tw.from, tw.to, k);
}
function interpCam(a, b, k) {
  const d = Math.hypot(b.x - a.x, b.y - a.y) * Math.min(a.s, b.s); const bump = clamp(d / 2400, 0, 0.45);
  const s = Math.exp(lerp(Math.log(a.s), Math.log(b.s), k)) * (1 - bump * Math.sin(Math.PI * k));
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), s, oy: lerp(a.oy || 0, b.oy || 0, k), ox: lerp(a.ox || 0, b.ox || 0, k) };
}
function focusCam(i, zoomKm = 10) {
  const m = S.m; const s = Math.min(S.W, S.H * 1.5) * 0.62 / (zoomKm * 1000 / S.B.meta.mScale);
  return { x: m.cx[i], y: m.cy[i], s: Math.max(s, S.fit.s * 2.2), oy: S.fit.oy, ox: S.fit.ox };
}
function flyTo(cam, dur = 1.1) { S.tween = { from: { ...camAt(now()) }, to: cam, t0: now(), dur }; }

function drawSprite(c, img, x, y, size, opts = {}) {
  const { sx = 1, sy = 1, alpha = 1 } = opts; c.save(); c.globalAlpha = alpha; c.translate(x, y); c.scale(sx, sy);
  c.drawImage(img, -size / 2, -size * 0.8, size, size); c.restore();
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function label(c, txt, x, y, size, dpr, o = {}) {
  c.font = `${o.weight || 600} ${size * dpr}px Fredoka, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineJoin = 'round'; c.lineWidth = (o.stroke || 5) * dpr; c.strokeStyle = o.halo || '#fffaf1'; c.strokeText(txt, x, y); c.fillStyle = o.color || INK; c.fillText(txt, x, y);
}

function itemPos(k) { // spread multiple pieces in one AGEB
  const it = S.items[k]; const same = S.items.filter((o, j) => o.i === it.i && j < k).length; const m = S.m;
  const r = Math.min(260, (m.agebs[it.i].r || 120) / S.B.meta.mScale * 0.55); const a = same * 2.2 + 0.6;
  return same ? [m.cx[it.i] + Math.cos(a) * r, m.cy[it.i] + Math.sin(a) * r] : [m.cx[it.i], m.cy[it.i]];
}

function buildScene(t, cam, opts = {}) {
  const m = S.m, dpr = opts.dpr ?? S.dpr, sOver = S.fit.s;
  const zf = clamp(Math.sqrt(cam.s / sOver), 0.75, 1.9);
  const highlights = [];
  const last = S.items[S.items.length - 1]; const lastAge = last ? t - last.t : 99;
  if (!opts.still) {
    for (const it of S.items) { const a = t - it.t; if (a > 0.4 && a < 1.6) { const k = 1 - smooth(0.4, 1.6, a); highlights.push({ i: it.i, fill: `rgba(255,255,255,${0.55 * k})`, stroke: `rgba(46,160,110,${k})`, width: 3 }); } }
    if (S.tool === 'colector' && !DEMO) { const has = new Set(S.items.filter(it => it.tool === 'colector').map(it => it.i)); for (const i of S.m.colectorTop) if (!has.has(i)) highlights.push({ i, stroke: '#12795a', width: 2.6, dash: [7, 4], halo: 'rgba(255,255,255,.95)', fill: 'rgba(60,200,160,.38)' }); }
    if (S.sel >= 0) highlights.push({ i: S.sel, lift: 7, stroke: INK, width: 2.6 });
    if (S.hover >= 0 && S.hover !== S.sel) highlights.push({ i: S.hover, lift: S.tool ? 6 : 3, stroke: S.tool ? '#1d8a62' : INK, width: 2.4, fill: S.tool ? 'rgba(127,220,180,.25)' : null });
  }
  let ring = null;
  const hv = S.hover >= 0 ? S.hover : S.sel;
  if (!opts.still && S.tool === 'vaso' && hv >= 0) ring = { X: m.cx[hv], Y: m.cy[hv], R: TOOL.vaso.R / S.B.meta.mScale, alpha: 1 };
  const scene = {
    colors: tileColors(), water: S.water?.canvas, waterDiff: S.water?.diff, waterDiffAlpha: opts.still ? 0 : 1 - smooth(0.45, 1.9, lastAge),
    waterAlpha: S.mode === 'agua' ? 1 : 0.55, highlights, ring,
    overlay: (c, P, s) => overlay(c, P, s, t, cam, zf, dpr, opts),
  };
  return scene;
}

function overlay(c, P, s, t, cam, zf, dpr, opts) {
  const m = S.m, B = S.B; const W = c.canvas.width, H = c.canvas.height;
  // observed IMEPLAN points
  if (S.obs) {
    const r = (2.2 + 1.4 * (zf - 0.75)) * dpr;
    c.lineWidth = 1.3 * dpr; c.strokeStyle = '#fff';
    c.beginPath();
    for (const [x, y] of B.imeplan) { const [X, Y] = P(x, y); if (X < -10 || Y < -10 || X > W + 10 || Y > H + 10) continue; c.moveTo(X, Y - r * 1.3); c.lineTo(X + r, Y); c.lineTo(X, Y + r * 1.3); c.lineTo(X - r, Y); c.closePath(); }
    c.fillStyle = '#ff6a4d'; c.fill(); c.stroke();
  }
  // municipality signposts (largest first, skip overlaps)
  const placed = [];
  for (const mu of [...B.muns].sort((a, b) => b.pob - a.pob)) {
    if (mu.pob < 100000) continue; const [X, Y] = P(mu.c[0], mu.c[1]); const fs = (S.W < 720 ? 11.5 : 14) * clamp(zf, 0.85, 1.25);
    c.font = `600 ${fs * dpr}px Fredoka, sans-serif`; const w = c.measureText(mu.name).width + 16 * dpr, h = (fs + 9) * dpr, yy = Y - 24 * dpr;
    const box = [X - w / 2, yy - h, X + w / 2, yy]; if (placed.some(b => box[0] < b[2] + 4 && box[2] > b[0] - 4 && box[1] < b[3] + 4 && box[3] > b[1] - 4)) continue; placed.push(box);
    c.strokeStyle = INK; c.lineWidth = 2.4 * dpr; c.beginPath(); c.moveTo(X, Y); c.lineTo(X, yy); c.stroke();
    roundRect(c, X - w / 2, yy - h, w, h, 7 * dpr); c.fillStyle = 'rgba(255,250,241,.95)'; c.fill(); c.stroke();
    c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(mu.name, X, yy - h / 2 + 0.5 * dpr);
  }
  const sprites = [];
  // mission markers
  if (!opts.still) S.missions.forEach((i, k) => {
    const [X, Y] = P(m.cx[i], m.cy[i]); const b = Math.sin(t * 3 + k * 1.7) * 3 * dpr;
    sprites.push({ y: Y, draw: () => { const r = 11 * dpr * clamp(zf, 0.9, 1.3); const yy = Y - 30 * dpr + b; c.fillStyle = 'rgba(59,51,85,.18)'; c.beginPath(); c.ellipse(X, Y, r * 0.8, r * 0.3, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(X - 5 * dpr, yy + r * 0.7); c.lineTo(X, Y - 4 * dpr); c.lineTo(X + 5 * dpr, yy + r * 0.7); c.fillStyle = '#fff'; c.strokeStyle = INK; c.lineWidth = 2.2 * dpr; c.fill(); c.stroke();
      c.beginPath(); c.arc(X, yy, r, 0, Math.PI * 2); c.fill(); c.stroke(); c.fillStyle = '#ff6a4d'; c.font = `700 ${r * 1.5}px Fredoka, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('!', X, yy + 1 * dpr); } });
  });
  // placed pieces
  const size = 64 * zf * dpr;
  S.items.forEach((it, k) => {
    const a = opts.still ? 9 : t - it.t; if (a < 0) return; const [wx, wy] = itemPos(k); const [X, Y] = P(wx, wy);
    let dy = 0, sx = 1, sy = 1;
    if (a < 0.45) { const u = a / 0.45; dy = -220 * dpr * (1 - u * u); sx = 0.9; sy = 1.1; }
    else if (a < 0.8) { const u = (a - 0.45) / 0.35; const w = Math.sin(Math.PI * u) * Math.exp(-u * 1.5); sx = 1 + 0.22 * w; sy = 1 - 0.26 * w; }
    sprites.push({ y: Y, draw: () => {
      if (a > 0.45 && a < 1.4) { const u = (a - 0.45) / 0.95; c.strokeStyle = `rgba(46,170,120,${1 - u})`; c.lineWidth = 4 * dpr * (1 - u); c.beginPath(); c.ellipse(X, Y, size * (0.4 + u * 0.9), size * (0.4 + u * 0.9) * 0.6, 0, 0, Math.PI * 2); c.stroke(); }
      if (a < 0.45) { c.fillStyle = `rgba(59,51,85,${0.08 + 0.2 * (a / 0.45)})`; c.beginPath(); c.ellipse(X, Y, size * 0.35 * (0.5 + a), size * 0.14 * (0.5 + a), 0, 0, Math.PI * 2); c.fill(); }
      drawSprite(c, S.art[it.tool], X, Y + dy, size, { sx, sy });
      if (a > 0.45 && a < 1.15) { const u = (a - 0.45) / 0.7; for (let q = 0; q < 9; q++) { const ang = q / 9 * Math.PI * 2 + k; const rr = size * (0.3 + 0.6 * ease(u)); c.fillStyle = `rgba(255,250,240,${0.9 * (1 - u)})`; c.strokeStyle = `rgba(59,51,85,${0.5 * (1 - u)})`; c.lineWidth = 1.2 * dpr; c.beginPath(); c.arc(X + Math.cos(ang) * rr, Y + Math.sin(ang) * rr * 0.45 - 4 * dpr, (5 - 3 * u) * dpr * zf, 0, Math.PI * 2); c.fill(); c.stroke(); } }
      if (a > 0.6 && a < 1.8) { const u = (a - 0.6) / 1.2; for (let q = 0; q < 5; q++) { const ang = q * 1.3 + k * 0.7; const rr = size * (0.45 + 0.35 * u); const px = X + Math.cos(ang) * rr, py = Y - size * 0.45 + Math.sin(ang) * rr * 0.6 - 16 * dpr * u; star(c, px, py, (6 - 3 * u) * dpr, `rgba(255,209,102,${1 - u})`, dpr); } }
    } });
    // floating gain label
    if (!opts.still && a > 0.5 && a < 2.6 && it.gain != null) {
      const u = (a - 0.5) / 2.1; const yy = Y - size * 0.9 - 50 * dpr * ease(u); const al = u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
      sprites.push({ y: 1e9, draw: () => { c.globalAlpha = al; label(c, `+${fmt(it.gain)} personas`, X, yy, 19 * clamp(zf, 0.9, 1.3), dpr, { color: '#1d8a62', stroke: 6, weight: 700 }); c.globalAlpha = 1; } });
    }
  });
  // ghost plan (Gota's suggestion)
  if (S.ghost && !opts.still) S.ghost.forEach((g, k) => {
    const [X, Y] = P(m.cx[g.i], m.cy[g.i]); const bob = Math.sin(t * 2.4 + k) * 2 * dpr;
    sprites.push({ y: Y, draw: () => { c.setLineDash([5 * dpr, 4 * dpr]); c.strokeStyle = '#2f8fd0'; c.lineWidth = 2 * dpr; c.beginPath(); c.ellipse(X, Y, size * 0.42, size * 0.2, 0, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      drawSprite(c, S.art[g.tool], X, Y + bob - 4 * dpr, size * 0.86, { alpha: 0.6 });
      c.fillStyle = '#2f8fd0'; c.strokeStyle = '#fff'; c.lineWidth = 2 * dpr; c.beginPath(); c.arc(X + size * 0.32, Y - size * 0.62, 10 * dpr, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = '#fff'; c.font = `700 ${12 * dpr}px Fredoka, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(k + 1), X + size * 0.32, Y - size * 0.62 + 0.5 * dpr); } });
  });
  // hover preview piece
  const hv = S.hover >= 0 ? S.hover : (S.W < 720 ? S.sel : -1);
  if (S.tool && hv >= 0 && !opts.still) { const [X, Y] = P(m.cx[hv], m.cy[hv]); const bob = Math.sin(t * 5) * 4 * dpr; sprites.push({ y: Y + 1, draw: () => drawSprite(c, S.art[S.tool], X, Y - 10 * dpr + bob, size * 0.95, { alpha: 0.75 }) }); }
  sprites.sort((a, b) => a.y - b.y).forEach(sp => sp.draw());
  // coins flying from the purse to the newest piece
  const last = S.items[S.items.length - 1];
  if (last && !opts.still && S.purseXY) {
    const a = t - last.t; if (a >= 0 && a < 1.0) { const [wx, wy] = itemPos(S.items.length - 1); const [X, Y] = P(wx, wy);
      for (let q = 0; q < 6; q++) { const u = clamp((a - q * 0.06) / 0.55, 0, 1); if (u <= 0 || u >= 1) continue; const x0 = S.purseXY[0] * dpr, y0 = S.purseXY[1] * dpr;
        const x = lerp(x0, X + (q - 2.5) * 6 * dpr, u), y = lerp(y0, Y - size * 0.4, u) - Math.sin(Math.PI * u) * 120 * dpr; c.globalAlpha = u > 0.85 ? (1 - u) / 0.15 : 1; c.drawImage(S.art.coin, x - 13 * dpr, y - 13 * dpr, 26 * dpr, 26 * dpr); c.globalAlpha = 1; } }
  }
  // rain at the start
  const rainK = opts.still ? 0 : DEMO ? 1 - smooth(2.6, 3.6, t) : 1 - smooth(S.t0 + 2.5, S.t0 + 4, t);
  if (rainK > 0.01) { c.strokeStyle = `rgba(80,150,210,${0.38 * rainK})`; c.lineWidth = 1.6 * dpr; c.beginPath();
    for (let q = 0; q < 170; q++) { const x = (hashf(q) * W * 1.2 + t * 90 * dpr) % (W * 1.2) - W * 0.1; const y = ((hashf(q + 999) * H + t * 900 * dpr) % (H + 60 * dpr)) - 30 * dpr; c.moveTo(x, y); c.lineTo(x - 7 * dpr, y + 22 * dpr); } c.stroke(); }
}
function star(c, x, y, r, col, dpr) { c.fillStyle = col; c.beginPath(); for (let k = 0; k < 10; k++) { const rr = k % 2 ? r * 0.45 : r; const a = -Math.PI / 2 + k * Math.PI / 5; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); c.fill(); }

function clouds(c, dpr, t) {
  const W = c.canvas.width;
  for (let k = 0; k < 4; k++) { const x = ((hashf(k + 7) * W + t * (6 + k * 3) * dpr) % (W + 300 * dpr)) - 150 * dpr; const y = (30 + hashf(k + 3) * 120) * dpr; const s = (0.7 + hashf(k) * 0.6) * dpr;
    c.fillStyle = 'rgba(255,255,255,.75)'; c.beginPath(); c.ellipse(x, y, 60 * s, 18 * s, 0, 0, Math.PI * 2); c.ellipse(x - 30 * s, y + 4 * s, 34 * s, 14 * s, 0, 0, Math.PI * 2); c.ellipse(x + 22 * s, y - 8 * s, 30 * s, 20 * s, 0, 0, Math.PI * 2); c.fill(); }
}

window.__inv3render = () => renderFrame();
// static board layer is cached as a bitmap: pan/zoom are a uniform scale + shift of it
const cache = { cv: document.createElement('canvas'), cam: null, key: '', M: 1.7, at: 0 };
function staticKey() { return [_tcKey, S.waterVer || 0, S.mode, S.W, S.H, S.dpr].join('|'); }
function cacheMap(cam) { // returns [k, tx, ty] mapping cache device px → screen device px
  const c = cache.cam; const k = cam.s / c.s; const M = cache.M;
  const [cx, cy] = w2s(c, S.W * M, S.H * M, c.x, c.y); const [sx, sy] = w2s(cam, S.W, S.H, c.x, c.y);
  return [k, sx * S.dpr - k * cx * S.dpr, sy * S.dpr - k * cy * S.dpr];
}
function renderCache(cam, scene) {
  const M = cache.M, cv = cache.cv; const w = Math.round(S.W * M * S.dpr), h = Math.round(S.H * M * S.dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h);
  S.board.drawStatic(c, S.W * M, S.H * M, cam, scene, S.dpr); cache.cam = { ...cam }; cache.key = staticKey(); cache.at = now();
}
function blitCache(cam, scene, settle) {
  let ok = cache.cam && cache.key === staticKey();
  let map;
  if (ok) {
    map = cacheMap(cam); const [k, tx, ty] = map;
    const lim = settle ? [0.97, 1.03] : [0.55, 1.8];
    if (k < lim[0] || k > lim[1]) ok = false;
    else { const x0 = (0 - tx) / k, y0 = (0 - ty) / k, x1 = (S.W * S.dpr - tx) / k, y1 = (S.H * S.dpr - ty) / k; if (x0 < -2 || y0 < -2 || x1 > cache.cv.width + 2 || y1 > cache.cv.height + 2) ok = false; }
  }
  if (!ok) { renderCache(cam, scene); map = cacheMap(cam); }
  const [k, tx, ty] = map; ctx.save(); ctx.setTransform(k, 0, 0, k, tx, ty); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium'; ctx.drawImage(cache.cv, 0, 0); ctx.restore();
}
window.__inv3render = () => renderFrame(true);
window.__inv3api = { place: (tool, i) => place(tool, i), selectTool: id => selectTool(id), focus: (i, km) => { S.cam = focusCam(i, km); S.dirty = true; }, greedy: b => greedyPlan(S.m, b ?? BUDGET, S.items) };
function renderFrame(hq = false) {
  const t = now(); const cam = DEMO ? S.cam : camAt(t);
  const scene = buildScene(t, cam);
  S.board.sky(ctx, S.W, S.H, S.dpr); clouds(ctx, S.dpr, t);
  if (hq) S.board.drawStatic(ctx, S.W, S.H, cam, scene, S.dpr);
  else blitCache(cam, scene, !S.tween && !S.dragging && now() - S.lastInput > 0.35 && !(DEMO && S.demoPlaying));
  S.board.drawDynamic(ctx, S.W, S.H, cam, scene, S.dpr);
  updateUI(t);
}

// ------------------------------------------------------------------------------------------------ UI
function buildToolbar() {
  const tb = $('toolbar'); tb.innerHTML = '';
  TOOLS.forEach((t, k) => {
    const b = document.createElement('button'); b.className = 'tool'; b.dataset.tool = t.id; b.title = t.blurb;
    b.innerHTML = `<span class="key">${k + 1}</span><span class="pr">${money(t.cost)} M</span><img alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(ICONS[t.id])}"><span class="nm">${t.name}</span><span class="un">${t.unit}</span>`;
    b.onclick = () => selectTool(S.tool === t.id ? null : t.id);
    tb.appendChild(b);
  });
}
const TOOL_TIP = {
  colector: 'Los colectores rinden donde el agua <b>responde al drenaje</b>. Con borde punteado verde: las 40 colonias donde sim-drenaje ve más personas beneficiadas al subir el drenaje.',
  vaso: 'Un vaso guarda 60,000 m³ y ayuda a las colonias vecinas en 1.5 km. Brilla donde el agua <b>se queda</b> aunque haya drenaje.',
  jardin: 'Un jardín de lluvia es barato y local; rinde más donde hay algo de área verde.',
  pozos: 'Los pozos son baratos pero de efecto local: contra el pico de una tormenta ayudan poquito.',
  reubicar: 'Reubicar 100 viviendas cuesta mucho por persona, pero protege seguro donde nada más funciona.',
};
function selectTool(id) {
  S.tool = id; document.querySelectorAll('.tool').forEach(b => b.classList.toggle('sel', b.dataset.tool === id));
  if (id) say(TOOL_TIP[id]); S.dirty = true; renderInspector();
}
function say(html) { if (html === S.msg) return; S.msg = html; const b = $('bubble'); $('bubbleTxt').innerHTML = html; if (!DEMO) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); } }
function feedback(tool, i, gain) {
  const T = TOOL[tool], m = S.m, gap = m.gap[i], ratio = gain / T.cost / Math.max(1e-9, S.bestRatio[tool]);
  const per = gain > 0 ? '$' + fmt(T.cost * 1e6 / gain) : '—';
  let msg;
  if (S.ev.cost >= BUDGET - 9.99) msg = `¡Se acabó el presupuesto! Protegiste a <b>${fmt(S.ev.people)}</b> personas. Toca <b>Comparte tu plan</b>.`;
  else if (gain < 40) msg = `Uy: aquí casi no hay gente en zona inundable (+${fmt(gain)}). Busca los charcos azules con muchas casas.`;
  else if (tool === 'reubicar') msg = `Reubicar protege seguro a <b>+${fmt(gain)}</b> personas, a ${per} por persona. Es para donde nada más funciona.`;
  else if (tool === 'pozos') msg = `Los pozos ayudan poquito contra el pico de la tormenta (<b>+${fmt(gain)}</b>); sirven más para recargar el acuífero.`;
  else if (tool === 'colector' && m.extra[i]?.rankBenefit <= 40 && ratio >= 0.5) msg = `¡Buen tino! Esta colonia está en el <b>top ${m.extra[i].rankBenefit <= 10 ? 10 : 40}</b> de beneficio del drenaje en sim-drenaje: <b>+${fmt(gain)}</b> personas.`;
  else if (gap === 'a' && T.kind === 'cap') msg = `+${fmt(gain)} personas. Ojo: aquí el agua <b>se queda</b> aunque metas más tubo; un vaso o un jardín rendirían más.`;
  else if (gap === 'b' && T.kind === 'store' && ratio < 0.7) msg = `Funciona (+${fmt(gain)}), pero aquí el drenaje sí responde: un colector rendiría más por peso.`;
  else if (ratio >= 0.6) msg = `¡Excelente! <b>+${fmt(gain)}</b> personas fuera de zona inundable, a ${per} por persona.`;
  else msg = `Bien: <b>+${fmt(gain)}</b> personas, a ${per} por persona. Hay sitios donde rendiría más.`;
  say(msg);
}
function counter(key, target, t, dur = 0.9) {
  const c = S.counters[key] || (S.counters[key] = { from: target, to: target, t0: -99 });
  if (Math.abs(c.to - target) > 1e-9) { const cur = lerp(c.from, c.to, ease((t - c.t0) / dur)); c.from = cur; c.to = target; c.t0 = t; }
  return lerp(c.from, c.to, ease((t - c.t0) / dur));
}
let lastTxt = {};
function setTxt(id, v) { if (lastTxt[id] !== v) { lastTxt[id] = v; $(id).textContent = v; } }
function updateUI(t) {
  const ev = S.ev, m = S.m;
  const left = counter('budget', BUDGET - ev.cost, t, 0.7);
  setTxt('budgetLeft', money(left)); $('budgetBar').style.width = (left / BUDGET * 100).toFixed(1) + '%';
  const ppl = counter('people', ev.people, t, 1.1);
  setTxt('scPeople', fmt(ppl)); setTxt('chipPeople', fmt(ppl));
  setTxt('scPeopleSub', `de ${fmt(m.E0total)} personas en zona inundable (${m.mode === 'obs' ? 'observado' : 'modelo'})`);
  setTxt('scFac', '≈' + fmt(counter('fac', ev.fac, t)));
  setTxt('scKm2', fmt(counter('km2', ev.km2 * 100, t)));
  const per = ev.people > 1 ? '$' + fmt(ev.cost * 1e6 / ev.people) : '—'; setTxt('scPer', per); setTxt('chipPer', ev.people > 1 ? per + '/persona' : 'sin obras');
  const eq = counter('eq', ev.people > 1 ? ev.margShare : 0, t); $('eqFill').style.width = (eq * 100).toFixed(1) + '%'; $('eqBase').style.left = (m.margShare0 * 100).toFixed(1) + '%';
  setTxt('eqVal', ev.people > 1 ? Math.round(ev.margShare * 100) + '%' : '—'); setTxt('eqBaseTxt', `(la raya: ${Math.round(m.margShare0 * 100)}% de la gente expuesta)`);
  const g = gotaAt(ev.cost); const eff = g > 0 ? ev.people / g : 0; const st = !S.items.length ? 0 : eff >= 0.9 ? 3 : eff >= 0.65 ? 2 : eff >= 0.35 ? 1 : 0;
  if (st !== S.stars || !$('stars').children.length) { const old = S.stars; S.stars = st; $('stars').innerHTML = [0, 1, 2].map(k => `<span class="${k < st && k >= old ? 'pop' : ''}">${STAR(k < st)}</span>`).join(''); }
  setTxt('lvl', !S.items.length ? 'Coloca tu primera obra' : `${['Aprendiz de tormentas', 'Charco a charco', 'Calles secas', 'Tormenta domada'][st]} · ${Math.round(eff * 100)}%`);
  // plan list
  const key = S.items.map(it => it.tool).join(','); if (S._planKey !== key) { S._planKey = key; const cnt = {}; S.items.forEach(it => cnt[it.tool] = (cnt[it.tool] || 0) + 1);
    $('planList').innerHTML = TOOLS.filter(t => cnt[t.id]).map(t => `<span class="pi" title="${t.name}"><img alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(ICONS[t.id])}">×${cnt[t.id]}</span>`).join(''); }
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('poor', TOOL[b.dataset.tool].cost > BUDGET - ev.cost + 1e-9));
  if (S._inspT !== S._inspKey()) renderInspector();
}
S._inspKey = () => [S.sel, S.hover, S.tool, S.items.length, S.mode].join('|');
function gapBox(i) {
  const m = S.m, g = m.gap[i];
  if (m.mode === 'obs') return `<div class="in-type n"><b>Sin simulación todavía</b>Solo sabemos lo que IMEPLAN ha observado; no podemos distinguir si aquí conviene drenaje o almacenamiento.</div>`;
  if (g === 'a') return `<div class="in-type a"><b>Agua que se queda</b>En el modelo se inunda aunque el drenaje suba a 40–60 mm/h. Rinden más el almacenamiento (vaso, jardín) o reubicar.</div>`;
  if (g === 'b') return `<div class="in-type b"><b>Responde al drenaje</b>Con más capacidad el agua baja ${m.sens[i] ? '≈' + m.sens[i].toFixed(1) + ' cm por cada +10 mm/h' : 'bastante'}. Rinden colectores y pozos.</div>`;
  if (g === 'c') return `<div class="in-type c"><b>Rara vez se inunda</b>En el modelo casi nunca pasa de 15 cm. Mejor invertir en otro lado.</div>`;
  return `<div class="in-type c"><b>Sin celdas urbanas en el modelo</b>La simulación no cubre esta zona.</div>`;
}
function drainLine(i) {
  const m = S.m, x = m.extra[i], a = m.agebs[i]; const parts = [];
  if (x && x.popBenefit != null) parts.push(`Subir el drenaje de 0 a 40 mm/h sacaría a <b>${fmt(x.popBenefit)}</b> personas del agua (#${fmt(x.rankBenefit)} de ${fmt(m.nRanked)})`);
  if (x && x.inletExtra != null && x.inletExtra > 0.005) parts.push(`contando dónde hay bocas de tormenta (INEGI INV 2020) se inundaría ${Math.round(x.inletExtra * 100)} pts más`);
  else if (a.sp != null) parts.push(`${Math.round(a.sp)}% de sus manzanas sin bocas de tormenta (INEGI INV 2020)`);
  return parts.length ? `<div class="in-obs ph-hide">${parts.join(' · ')}.</div>` : '';
}
function renderInspector() {
  S._inspT = S._inspKey();
  const el = $('inspector'); const i = S.hover >= 0 ? S.hover : S.sel;
  if (i < 0) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const m = S.m, a = m.agebs[i], ev = S.ev;
  const name = a.col ? (a.colIn ? a.col : 'cerca de ' + a.col) : 'AGEB ' + a.id.slice(9);
  const s0 = m.s0[i], s1 = ev.s[i];
  const nFac = (a.esc || 0) + (a.gua || 0) + (a.cli || 0) + (a.hos || 0) + (a.res || 0);
  let prev = '';
  if (S.tool) {
    const T = TOOL[S.tool]; const exists = S.items.some(it => it.tool === S.tool && it.i === i);
    if (exists) prev = `<div class="in-prev">Ya hay ${T.name.toLowerCase()} aquí.</div>`;
    else { const e2 = evaluate(m, [...S.items, { tool: S.tool, i }]); const g = e2.people - ev.people, f = e2.fac - ev.fac; const ok = ev.cost + T.cost <= BUDGET + 1e-9;
      const extra = T.kind === 'cap' ? `+${addedCap(m, T, i).toFixed(0)} mm/h de capacidad en ${(m.area[i] * 100).toFixed(0)} ha urbanas` : T.kind === 'store' ? `guarda ${fmt(T.V)} m³${T.R ? ', reparte en 1.5 km' : ''}, aprovecha ≈${Math.round(storeEff(m, T, i) * 100)}% (área verde${m.hasTerrain && T.R ? ' y depresiones del terreno' : ''})` : `hasta ${fmt(T.homes * (a.ocup || 3.5))} personas`;
      const top = S.tool === 'colector' && m.extra[i]?.rankBenefit && m.extra[i].rankBenefit <= 40 ? ` <span class="topc">top ${m.extra[i].rankBenefit <= 10 ? 10 : 40} drenaje</span>` : '';
      prev = `<div class="in-prev">Con ${T.name.toLowerCase()} (${money(T.cost)} M):${top}<div class="big">+${fmt(g)} personas</div><small>${f >= 0.05 ? '≈' + f.toFixed(1) + ' escuelas/clínicas · ' : ''}${g > 1 ? '$' + fmt(T.cost * 1e6 / g) + ' por persona · ' : ''}${extra}</small>${ok ? '<button id="btnBuild">Construir aquí</button>' : '<small><b>No alcanza el presupuesto.</b></small>'}</div>`; }
  }
  const here = S.items.map((it, k) => [it, k]).filter(([it]) => it.i === i);
  const items = here.length ? `<div class="in-items">${here.map(([it, k]) => `<div class="it"><img alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(ICONS[it.tool])}"><span>${TOOL[it.tool].name} · +${fmt(it.gain || 0)}</span><button data-rm="${k}">Quitar</button></div>`).join('')}</div>` : '';
  const obs = a.isn || a.izn || a.pr ? `IMEPLAN: <b>${a.isn || 0} sitio${a.isn === 1 ? '' : 's'}</b>${a.izn ? `, <b>${a.izn} zona${a.izn > 1 ? 's' : ''} crítica${a.izn > 1 ? 's' : ''}</b>` : ''}${a.ref ? ` · ${a.ref}` : ''}${a.pr ? ` · ${a.pr} reporte${a.pr > 1 ? 's' : ''} de prensa` : ''}` : 'Sin registros IMEPLAN de inundación observada.';
  el.innerHTML = `<button class="in-close" id="inClose" aria-label="Cerrar">×</button>
    <div class="in-name">${name}<span class="in-mun">${MUN[a.m] || ''}</span></div>
    <div class="in-meta">${fmt(a.pob)} habitantes · grado de marginación: ${a.gm ? a.gm.toLowerCase() : 'sin dato'} · AGEB ${a.id}</div>
    <div class="in-water"><div class="wl"><span>Zona urbana que se inunda ≥15 cm</span><span>${Math.round(s0 * 100)}%${Math.abs(s1 - s0) > 0.003 ? ' → ' + Math.round(s1 * 100) + '%' : ''}</span></div>
      <div class="wbar"><i style="width:${(s0 * 100).toFixed(1)}%"></i><b style="width:${(s1 * 100).toFixed(1)}%"></b></div></div>
    ${prev}
    <div class="in-facts ph-hide"><div><b>${fmt(ev.E[i])}</b> personas en zona inundable</div><div><b>${fmt(nFac)}</b> escuelas, guarderías o clínicas (DENUE)</div></div>
    ${gapBox(i)}${drainLine(i)}
    <div class="in-obs ph-hide">${obs}</div>${items}`;
  el.querySelector('#inClose').onclick = () => { S.sel = -1; S.hover = -1; renderInspector(); };
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => removeItem(+b.dataset.rm));
  const bb = el.querySelector('#btnBuild'); if (bb) bb.onclick = () => { if (place(S.tool, i)) renderInspector(); };
}
function renderLegend() {
  const L = $('legBody');
  if (S.mode === 'agua') L.innerHTML = S.water ? `<span>Se inunda en</span><div class="ramp">${[0.25, 0.45, 0.65, 0.85, 1].map(f => `<i style="background:rgb(${143 + (38 - 143) * f},${222 + (132 - 222) * f},${250 + (205 - 250) * f})"></i>`).join('')}</div><span>de las corridas</span>` : `<span>Inundación observada (provisional)</span>`;
  else if (S.mode === 'riesgo') L.innerHTML = `<span>Personas en zona inundable por km²</span><div class="ramp">${RISK.map(c => `<i style="background:${c}"></i>`).join('')}</div>`;
  else L.innerHTML = `<span>Marginación (CONAPO 2020)</span><div class="ramp">${Object.values(MARG).map(c => `<i style="background:${c}"></i>`).join('')}</div><span>muy alta</span>`;
}
function infoHTML() {
  const m = S.m;
  const rows = TOOLS.map(t => `<tr><td><b>${t.name}</b><br>${t.unit}</td><td>${money(t.cost)} M</td><td>${t.ref}</td></tr>`).join('');
  return `<button class="x" id="infoX">Cerrar</button><h2>¿Cómo funciona?</h2>
  <p><b>Es un juguete para entender trade-offs</b>, no una herramienta de planeación. Los datos son reales; los efectos de cada obra son supuestos simples y deliberadamente ilustrativos.</p>
  <h3>El agua</h3><p>${m.mode === 'obs' ? '<b>Modelo provisional:</b> todavía no hay simulación por AGEB, así que usamos solo la inundación observada por IMEPLAN (área de sitios y zonas críticas, más reportes de prensa y pasos a desnivel). No sabemos si conviene drenaje o almacenamiento.' : `Viene de <b>sim-drenaje</b> (cauce. labs): un modelo de aguas someras en celdas de 20 m sobre el terreno INEGI de 5 m, con tormentas de 2 a 100 años de periodo de retorno y capacidades de drenaje de 0 a 60 mm/h (${m.runs} corridas${m.runs >= 126 ? ', ensamble completo' : ' hasta ahora'}). Para cada AGEB usamos la parte de su zona urbana que pasa de 15 cm, promediada en el ensamble, para cada capacidad. Suponemos que hoy el drenaje equivale a <b>${C0} mm/h</b> (límite bajo del rango 20–30 mm/h que infiere sim-drenaje del Atlas Metropolitano de Riesgos). ${m.mode === 'sim-img' ? 'Mientras sim-drenaje publica su tabla por AGEB, la agregamos en el navegador desde sus imágenes de datos (preliminar).' : ''} Exploratorio: no es un pronóstico.`}</p>
  <h3>Las obras</h3><table><tr><th>Obra</th><th>Costo</th><th>Referencia de costo</th></tr>${rows}</table>
  <p><b>Colector y pozos</b> suman capacidad de drenaje (caudal ÷ área urbana de la AGEB, en mm/h) y leemos la curva del ensamble. <b>Vaso y jardín</b> guardan un volumen: ${Math.round(0.6 * 100)}% útil (más con espacio verde${m.hasTerrain ? ' y depresiones de sim-relieve' : ''}), dividido entre la profundidad media de las zonas inundadas del modelo (${m.dmean.toFixed(2)} m) para saber cuánta área deja de inundarse; el vaso reparte su efecto entre colonias a 1.5 km. <b>Reubicar</b> saca de la zona inundable hasta 100 viviendas × ocupantes promedio. Una obra de cada tipo por AGEB. Con el colector elegido, el borde punteado verde marca las 40 AGEB donde sim-drenaje calcula más personas beneficiadas al subir el drenaje de 0 a 40 mm/h (<i>population_benefit_0_to_40</i>).</p>
  <h3>Personas protegidas</h3><p>Población de la AGEB (Censo 2020) × reducción de la parte que se inunda. Es un promedio del ensamble, no un conteo de casas. Escuelas, guarderías, clínicas, hospitales y residencias (DENUE) se cuentan igual. Equidad: parte de lo protegido en AGEB de marginación alta o muy alta (CONAPO 2020).</p>
  <h3>El plan de Gota</h3><p>Un algoritmo avaricioso que en cada paso elige la obra con más personas protegidas por peso. Sirve de referencia, no es óptimo ni recomendación.</p>
  <h3>Límites</h3><p>No hay red de drenaje pública: la capacidad es un número uniforme. No modelamos aguas abajo, mantenimiento, terrenos, tiempos de obra ni costos sociales. Los costos son órdenes de magnitud de notas públicas, no presupuestos. El IMTA estimó necesidades de más de 25,000 millones de pesos para el manejo pluvial del AMG; aquí tienes 2,000.</p>
  <h3>Fuentes</h3><p>INEGI: Censo de Población y Vivienda 2020, Marco Geoestadístico 2020, DENUE · CONAPO: Índice de marginación urbana 2020 · IMEPLAN: Mapa Único de Inundaciones 2026 · ESA WorldCover 2021 · © OpenStreetMap (ODbL): calles, cuerpos de agua y nombres de colonias · sim-drenaje (cauce. labs). Perfil por AGEB del agente infra-data. Nombres de colonia aproximados (punto OSM más cercano).</p>`;
}

// ------------------------------------------------------------------------------------------------ input
function setupInput() {
  let down = null, pts = new Map(), pinch = null;
  const pos = e => [e.clientX, e.clientY];
  canvas.addEventListener('pointerdown', e => { try { canvas.setPointerCapture(e.pointerId); } catch {} pts.set(e.pointerId, pos(e)); S.tween = null;
    if (pts.size === 1) down = { x: e.clientX, y: e.clientY, cam: { ...S.cam }, moved: false, type: e.pointerType };
    else if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), cam: { ...S.cam }, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; if (down) down.moved = true; } });
  canvas.addEventListener('pointermove', e => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, pos(e));
    if (pinch && pts.size >= 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); zoomAt(pinch.c[0], pinch.c[1], pinch.cam.s * d / pinch.d / S.cam.s); return; }
    if (down) { const dx = e.clientX - down.x, dy = e.clientY - down.y; if (!down.moved && Math.hypot(dx, dy) > 6) down.moved = true;
      if (down.moved) { S.dragging = true; const c = down.cam; const [x0, y0] = s2w(c, S.W, S.H, down.x, down.y); const [x1, y1] = s2w(c, S.W, S.H, e.clientX, e.clientY); S.cam = { ...c, x: c.x - (x1 - x0), y: c.y - (y1 - y0) }; clampCam(); S.dirty = true; } return; }
    if (e.pointerType === 'mouse') { const [X, Y] = s2w(S.cam, S.W, S.H, e.clientX, e.clientY); const h = S.board.hit(X, Y); if (h !== S.hover) { S.hover = h; S.dirty = true; } canvas.style.cursor = h >= 0 ? (S.tool ? 'copy' : 'pointer') : 'grab'; }
  });
  const up = e => {
    pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
    if (down && !down.moved && pts.size === 0) {
      const [X, Y] = s2w(S.cam, S.W, S.H, e.clientX, e.clientY); const h = S.board.hit(X, Y);
      if (h < 0) { S.sel = -1; S.hover = -1; }
      else if (S.tool && (down.type === 'mouse' || S.sel === h)) { place(S.tool, h); S.sel = h; }
      else { S.sel = h; if (down.type !== 'mouse') S.hover = -1; }
      if (h >= 0 && S.W < 720) flyTo({ ...S.cam, x: S.m.cx[h], y: S.m.cy[h], oy: -S.H * 0.2, s: Math.max(S.cam.s, S.fit.s * 1.6) }, 0.6);
      renderInspector(); S.dirty = true;
    }
    if (pts.size === 0) { down = null; S.dragging = false; }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && S.hover >= 0) { S.hover = -1; S.dirty = true; } });
  canvas.addEventListener('wheel', e => { e.preventDefault(); S.tween = null; zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0016)); }, { passive: false });
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    const k = +e.key; if (k >= 1 && k <= TOOLS.length) selectTool(S.tool === TOOLS[k - 1].id ? null : TOOLS[k - 1].id);
    if (e.key === 'Escape') { selectTool(null); S.sel = -1; closeModals(); renderInspector(); }
    if (e.key === '+' || e.key === '=') zoomAt(S.W / 2, S.H / 2, 1.3); if (e.key === '-') zoomAt(S.W / 2, S.H / 2, 1 / 1.3);
  });
  addEventListener('resize', resize);
}
function zoomAt(px, py, f) {
  const c = S.cam; const ns = clamp(c.s * f, S.fit.s * 0.8, S.fit.s * 14); const [X, Y] = s2w(c, S.W, S.H, px, py);
  const n = { ...c, s: ns }; const [X2, Y2] = s2w(n, S.W, S.H, px, py); n.x += X - X2; n.y += Y - Y2; S.cam = n; clampCam(); S.dirty = true;
}
function clampCam() { const [x0, y0, x1, y1] = S.B.meta.worldBounds; S.cam.x = clamp(S.cam.x, x0, x1); S.cam.y = clamp(S.cam.y, y0, y1); }
function closeModals() { $('cardWrap').classList.add('hidden'); $('infoWrap').classList.add('hidden'); }

function setupUI() {
  buildToolbar();
  $('coinIcon').innerHTML = COIN; $('gotaImg').innerHTML = GOTA; $('introGota').innerHTML = GOTA; $('compass').innerHTML = compassSVG(); $('hand').innerHTML = HAND;
  document.querySelectorAll('#modes button').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; document.querySelectorAll('#modes button').forEach(x => x.classList.toggle('on', x === b)); renderLegend(); S.dirty = true; });
  $('chkObs').onchange = e => { S.obs = e.target.checked; S.dirty = true; };
  $('btnGhost').onclick = () => {
    if (S.ghost) { S.ghost = null; $('btnGhost').classList.remove('on'); say('Listo, escondí mis sugerencias.'); return; }
    const g = greedyPlan(S.m, BUDGET, S.items); S.ghost = g.items.slice(S.items.length, S.items.length + 12); $('btnGhost').classList.add('on');
    const gain = g.ev.people - S.ev.people;
    say(S.ghost.length ? `Con lo que te queda, yo pondría estas <b>${S.ghost.length}</b> obras (azules, en orden): <b>+${fmt(gain)}</b> personas más. Es un cálculo avaricioso, no una verdad.` : 'No encuentro nada que valga la pena con lo que queda.');
    if (S.ghost.length) { const i = S.ghost[0].i; flyTo({ ...focusCam(i, 14) }); }
  };
  $('btnShare').onclick = () => openCard();
  $('btnReset').onclick = () => { S.items = []; recompute(); S.ghost = null; S.sel = -1; history.replaceState(null, '', location.pathname + location.search); say('Borrón y cuenta nueva: otra vez $2,000 millones.'); flyTo({ ...S.fit }); };
  $('btnClose').onclick = closeModals; $('cardWrap').onclick = e => { if (e.target.id === 'cardWrap') closeModals(); };
  $('btnDl').onclick = () => { const a = document.createElement('a'); a.download = 'mi-plan-zmg-cauce.png'; a.href = $('cardCanvas').toDataURL('image/png'); a.click(); };
  $('btnLink').onclick = async () => { const url = location.origin + location.pathname + '#plan=' + encodePlan(S.items);
    try { if (navigator.share && S.W < 720) await navigator.share({ title: 'Mi plan contra inundaciones', url }); else { await navigator.clipboard.writeText(url); $('btnLink').textContent = '¡Copiado!'; setTimeout(() => $('btnLink').textContent = 'Copiar enlace', 1500); } } catch { prompt('Copia este enlace:', url); } };
  const openInfo = e => { e?.preventDefault(); $('info').innerHTML = infoHTML(); $('infoWrap').classList.remove('hidden'); $('infoX').onclick = closeModals; };
  $('modelBadge').onclick = openInfo; $('lnkInfo').onclick = openInfo; $('infoWrap').onclick = e => { if (e.target.id === 'infoWrap') closeModals(); };
  $('scoreChip').onclick = () => $('score').classList.toggle('open');
  $('btnStart').onclick = () => { $('intro').classList.add('hidden'); S.t0 = now(); say('¡Hola! Soy <b>Gota</b>. Elige una obra abajo y tócala sobre una colonia. Lo azul es lo que se inunda en el modelo; los <b>!</b> son las colonias con más gente expuesta.'); };
  renderLegend();
}
function compassSVG() { return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#fffaf1" stroke="${INK}" stroke-width="2.4"/><g transform="rotate(${(-Math.atan2(Math.sin(28 * Math.PI / 180), 0.6 * Math.cos(28 * Math.PI / 180)) * 180 / Math.PI).toFixed(1)} 24 24)"><path d="M24 7 l5 17 h-10z" fill="#ff8a6b" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M24 41 l5 -17 h-10z" fill="#ddd5ea" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/></g><g transform="rotate(28 24 24)"><circle cx="24" cy="3.5" r="0" /></g></svg>`; }

// ------------------------------------------------------------------------------------------------ share card
async function drawCard(cv) {
  const c = cv.getContext('2d'); const W = cv.width, H = cv.height; const ev = S.ev, m = S.m;
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#f6eee2'; c.fillRect(0, 0, W, H);
  roundRect(c, 12, 12, W - 24, H - 24, 26); c.fillStyle = '#fffaf1'; c.fill(); c.lineWidth = 4; c.strokeStyle = INK; c.stroke();
  // mini board
  const mw = 600, mh = 520, mx = 30, my = 92; const off = document.createElement('canvas'); off.width = mw; off.height = mh; const oc = off.getContext('2d');
  const cam = S.board.fitCam(mw, mh, { t: 10, b: 10, l: 10, r: 10 }); cam.oy = 18; cam.ox = 0; cam.s *= 1.3;
  const sc = buildScene(99, cam, { still: true, dpr: 1 }); S.board.draw(oc, mw, mh, cam, sc, 1);
  c.save(); roundRect(c, mx, my, mw, mh, 20); c.clip(); c.drawImage(off, mx, my); c.restore(); roundRect(c, mx, my, mw, mh, 20); c.lineWidth = 3; c.stroke();
  // header
  c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = '#2f8fd0'; c.font = '700 22px Fredoka, sans-serif'; c.fillText('cauce.', 34, 56);
  c.fillStyle = INK; c.font = '500 30px Fredoka, sans-serif'; c.fillText('Alcaldía', 112, 58); c.fillStyle = '#ff8a6b'; c.font = '700 30px Fredoka, sans-serif'; c.fillText('por un día', 236, 58);
  const X = 664; c.fillStyle = INK; c.font = '600 40px Fredoka, sans-serif'; c.fillText('Mi plan para la ZMG', X, 76);
  c.font = '700 15px Nunito, sans-serif'; c.fillStyle = '#6b6385'; c.fillText(`${S.items.length} obra${S.items.length === 1 ? '' : 's'} · ${money(ev.cost)} de ${money(BUDGET)} millones de pesos`, X, 104);
  // big number
  roundRect(c, X, 124, 500, 118, 20); c.fillStyle = '#e4f8ee'; c.fill(); c.lineWidth = 3; c.strokeStyle = INK; c.stroke();
  c.fillStyle = '#1d8a62'; c.font = '700 64px Fredoka, sans-serif'; c.fillText(fmt(ev.people), X + 22, 196);
  c.fillStyle = INK; c.font = '600 21px Fredoka, sans-serif'; c.fillText('personas fuera de zona inundable*', X + 22, 226);
  // stats
  const stats = [[`≈${fmt(ev.fac)}`, 'escuelas, clínicas y guarderías'], [fmt(ev.km2 * 100), 'hectáreas que dejan de inundarse'], [ev.people > 1 ? '$' + fmt(ev.cost * 1e6 / ev.people) : '—', 'pesos por persona'], [ev.people > 1 ? Math.round(ev.margShare * 100) + '%' : '—', 'en marginación alta o muy alta']];
  stats.forEach(([v, l], k) => { const x = X + (k % 2) * 252, y = 262 + Math.floor(k / 2) * 76; roundRect(c, x, y, 242, 64, 14); c.fillStyle = '#f7f0e3'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#eadfcb'; c.stroke();
    c.fillStyle = INK; c.font = '700 26px Fredoka, sans-serif'; c.fillText(v, x + 14, y + 32); c.fillStyle = '#6b6385'; c.font = '700 13px Nunito, sans-serif'; c.fillText(l, x + 14, y + 52); });
  // tools row
  const cnt = {}; S.items.forEach(it => cnt[it.tool] = (cnt[it.tool] || 0) + 1); let tx = X; c.font = '600 22px Fredoka, sans-serif';
  for (const t of TOOLS) { if (!cnt[t.id]) continue; c.drawImage(S.art[t.id], tx, 420, 56, 56); c.fillStyle = INK; c.fillText('×' + cnt[t.id], tx + 54, 458); tx += 104; }
  // stars + level
  const g = gotaAt(ev.cost); const eff = g > 0 ? ev.people / g : 0; const st = !S.items.length ? 0 : eff >= 0.9 ? 3 : eff >= 0.65 ? 2 : eff >= 0.35 ? 1 : 0;
  for (let k = 0; k < 3; k++) star2(c, X + 20 + k * 40, 512, 17, k < st);
  c.fillStyle = INK; c.font = '600 24px Fredoka, sans-serif'; c.fillText(['Aprendiz de tormentas', 'Charco a charco', 'Calles secas', 'Tormenta domada'][st], X + 136, 520);
  c.fillStyle = '#6b6385'; c.font = '700 14px Nunito, sans-serif'; c.fillText(`${Math.round(eff * 100)}% del plan de referencia, mismo gasto`, X + 136, 542);
  // footer
  c.fillStyle = '#6b6385'; c.font = '700 13px Nunito, sans-serif';
  const foot = `*Estimación ilustrativa: ${m.mode === 'obs' ? 'modelo provisional con inundación observada (IMEPLAN)' : 'ensamble exploratorio sim-drenaje' + (m.mode === 'sim-img' ? ' (preliminar)' : '')}, Censo 2020, DENUE. Juguete, no herramienta de planeación.`;
  c.fillText(foot, X, 580, 500); c.fillText('guadalajara.vsfelix.com/labs/invertir-3', X, 604);
  c.font = '600 12px Nunito, sans-serif'; c.fillText('© OpenStreetMap · INEGI · CONAPO · IMEPLAN · ESA WorldCover', mx + 4, my + mh + 26);
}
function star2(c, x, y, r, on) { c.beginPath(); for (let k = 0; k < 10; k++) { const rr = k % 2 ? r * 0.48 : r; const a = -Math.PI / 2 + k * Math.PI / 5; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); c.fillStyle = on ? '#ffd166' : '#ece6f5'; c.fill(); c.lineWidth = 2.6; c.strokeStyle = INK; c.lineJoin = 'round'; c.stroke(); }
async function openCard() { await drawCard($('cardCanvas')); $('cardWrap').classList.remove('hidden'); }

// ------------------------------------------------------------------------------------------------ demo (deterministic, seekable)
let D = null;
function planDemo() {
  const m = S.m, ev0 = S.ev0, mS = S.B.meta.mScale;
  const order = ['vaso', 'colector', 'jardin', 'pozos'];
  const chosen = [];
  // stay in the dense core so camera hops are short and readable
  const core = [-103.36, 20.64]; const R = 6378137, cx = R * core[0] * Math.PI / 180 - (R * S.B.meta.origin[0] * Math.PI / 180), cy = R * Math.log(Math.tan(Math.PI / 4 + core[1] * Math.PI / 360)) - R * Math.log(Math.tan(Math.PI / 4 + S.B.meta.origin[1] * Math.PI / 360));
  const items = [];
  for (const tool of order) {
    const T = TOOL[tool]; let best = -1, bv = 0; const ev = evaluate(m, items);
    const wantMarg = tool === 'jardin' && m.marg.some((v, i) => v && m.E0[i] > 100);
    for (let i = 0; i < m.n; i++) {
      if (m.E0[i] < 30) continue; if (wantMarg && !m.marg[i]) continue; const dc = Math.hypot(m.cx[i] - cx, m.cy[i] - cy) * mS; if (dc > (wantMarg ? 16000 : 11000)) continue;
      if (chosen.some(j => Math.hypot(m.cx[i] - m.cx[j], m.cy[i] - m.cy[j]) * mS < 2500)) continue;
      if (chosen.length && !wantMarg && chosen.every(j => Math.hypot(m.cx[i] - m.cx[j], m.cy[i] - m.cy[j]) * mS > 7000)) continue;
      if (tool === 'colector' && m.mode === 'sim' && !(m.extra[i]?.rankBenefit <= 60)) continue;
      const v = marginal(m, ev, tool, i, items) / T.cost * (T.good === m.gap[i] || m.mode === 'obs' ? 1.15 : 1); if (v > bv) { bv = v; best = i; }
    }
    if (best < 0) for (let i = 0; i < m.n; i++) { if (chosen.includes(i)) continue; const v = marginal(m, ev, tool, i, items) / T.cost; if (v > bv) { bv = v; best = i; } }
    chosen.push(best); items.push({ tool, i: best });
  }
  const steps = items.map((it, k) => { const t0 = [2.6, 7.6, 11.6, 15.4][k]; return { ...it, tCam: t0, tSel: t0 + 1.3, tMove: t0 + 1.9, tPlace: t0 + 2.8 }; });
  const fit = { ...S.fit };
  const keys = [{ t: 0, cam: { ...fit, s: fit.s * 0.96 } }, { t: 2.4, cam: fit }];
  steps.forEach(st => { keys.push({ t: st.tCam + 1.5, cam: focusCam(st.i, 11) }); keys.push({ t: st.tPlace + 1.0, cam: focusCam(st.i, 11) }); });
  keys.push({ t: 21.2, cam: { ...fit } }); keys.push({ t: 25, cam: { ...fit, s: fit.s * 1.03 } });
  keys.sort((a, b) => a.t - b.t);
  return { steps, keys };
}
function demoCam(t) { const K = D.keys; if (t <= K[0].t) return { ...K[0].cam }; for (let k = 1; k < K.length; k++) if (t <= K[k].t) { const a = K[k - 1], b = K[k]; return interpCam(a.cam, b.cam, easeIO((t - a.t) / (b.t - a.t))); } return { ...K[K.length - 1].cam }; }
function demoBubble(t) {
  const st = D.steps; const m = S.m;
  if (t < 2.6) return 'Hoy eres la alcaldía de la ZMG. Lo <b>azul</b> es lo que se inunda en el modelo.';
  for (let k = st.length - 1; k >= 0; k--) {
    const s = st[k];
    if (t >= s.tPlace + 0.5) { const it = S.items[k]; const g = it?.gain || 0;
      if (k === st.length - 1 && t > 20.2) break;
      return s.tool === 'vaso' ? `¡Vaso regulador! Guarda la tormenta y ayuda a las colonias vecinas: <b>+${fmt(g)}</b> personas.`
        : s.tool === 'colector' ? `Aquí el agua <b>responde al drenaje</b>: el colector saca a <b>+${fmt(g)}</b> personas de la zona inundable.`
        : s.tool === 'jardin' ? (m.marg[s.i] ? `+${fmt(g)} personas en una colonia de marginación alta: rinde menos por peso, pero sube la <b>equidad</b>.` : `Un jardín de lluvia barato y local: <b>+${fmt(g)}</b> personas.`)
        : `Los pozos son baratos pero ayudan poquito contra el pico: <b>+${fmt(g)}</b>.`; }
    if (t >= s.tCam) { const g = m.gap[s.i];
      return s.tool === 'vaso' ? (g === 'a' ? 'En esta zona el agua <b>se queda</b> aunque crezca el drenaje: toca almacenar.' : 'Mucha gente con los pies mojados: un vaso puede ayudar a varias colonias a la vez.')
        : s.tool === 'colector' ? (g === 'b' ? 'Aquí el agua sí <b>responde al drenaje</b>: un colector rinde mucho.' : 'Un colector saca el agua más rápido.')
        : s.tool === 'jardin' ? (m.marg[s.i] ? 'El plan más "eficiente" casi no llega a colonias marginadas. Probemos aquí un jardín de lluvia.' : 'Con un poco de área verde, un jardín de lluvia guarda agua donde cae.')
        : 'Y para probar: pozos de absorción, la obra más barata.'; }
  }
  return `Con ${money(S.ev.cost)} M protegiste a <b>${fmt(S.ev.people)}</b> personas. ¡Comparte tu plan!`;
}
let demoKey = '';
function demoSeek(t) {
  t = clamp(t, 0, 25); demoT = t;
  const st = D.steps;
  const placed = st.filter(s => s.tPlace <= t);
  const key = placed.length + '';
  if (key !== demoKey) { // rebuild plan state for this time (deterministic)
    S.items = []; recompute(false, null); S.counters = {};
    placed.forEach((s, k) => { const before = S.ev; S.items.push({ tool: s.tool, i: s.i, t: s.tPlace }); const last = k === placed.length - 1;
      recompute(last, last ? [...affected(S.items)] : null); S.items[k].gain = S.ev.people - before.people; });
    if (!placed.length) recompute(false, null);
    demoKey = key; lastTxt = {};
    // counters: animate from previous plan value at the last placement time
    if (placed.length) { const prevItems = S.items.slice(0, -1); const pe = evaluate(S.m, prevItems); const tp = placed[placed.length - 1].tPlace;
      S.counters = { people: { from: pe.people, to: S.ev.people, t0: tp + 0.5 }, budget: { from: BUDGET - pe.cost, to: BUDGET - S.ev.cost, t0: tp }, fac: { from: pe.fac, to: S.ev.fac, t0: tp + 0.5 }, km2: { from: pe.km2 * 100, to: S.ev.km2 * 100, t0: tp + 0.5 }, eq: { from: pe.people > 1 ? pe.margShare : 0, to: S.ev.margShare, t0: tp + 0.5 } }; }
  }
  // selection / hover
  const cur = st.find(s => t >= s.tSel && t < s.tPlace + 1.6);
  const tool = cur && t < cur.tPlace + 0.5 ? cur.tool : null;
  if (tool !== S.tool) { S.tool = tool; document.querySelectorAll('.tool').forEach(b => b.classList.toggle('sel', b.dataset.tool === tool)); }
  S.hover = cur && t >= cur.tMove + 0.55 ? cur.i : -1; S.sel = -1;
  S.cam = demoCam(t);
  say(demoBubble(t));
  // hand cursor
  const hand = $('hand'); let hp = null, press = 0;
  if (cur || st.some(s => t >= s.tCam + 0.9 && t < s.tSel)) {
    const s = cur || st.find(s => t >= s.tCam + 0.9 && t < s.tSel);
    const card = document.querySelector(`.tool[data-tool="${s.tool}"]`).getBoundingClientRect(); const cp = [card.left + card.width * 0.55, card.top + card.height * 0.45];
    const tp = w2s(S.cam, S.W, S.H, S.m.cx[s.i], S.m.cy[s.i]); const rest = [S.W * 0.5 + 120, S.H - 230];
    if (t < s.tSel) hp = lerpP(rest, cp, easeIO((t - s.tCam - 0.9) / (s.tSel - s.tCam - 0.9)));
    else if (t < s.tMove) hp = cp;
    else if (t < s.tMove + 0.55) hp = lerpP(cp, tp, easeIO((t - s.tMove) / 0.55));
    else hp = tp;
    press = Math.max(1 - Math.abs(t - s.tSel) / 0.12, 1 - Math.abs(t - s.tPlace) / 0.12, 0);
    if (t > s.tPlace + 0.4) hp = lerpP(tp, [tp[0] + 60, tp[1] + 70], easeIO((t - s.tPlace - 0.4) / 1.2));
  }
  if (hp) { hand.style.display = 'block'; hand.style.transform = `translate(${hp[0] - 12}px, ${hp[1] - 4}px) scale(${1 - 0.18 * Math.max(0, press)})`; } else hand.style.display = 'none';
  // title + plan card
  const tk = smooth(0.2, 0.7, t) * (1 - smooth(2.2, 2.7, t)); const ti = $('title'); ti.classList.toggle('hidden', tk <= 0.001); ti.style.opacity = tk; ti.style.transform = `translate(-50%, ${-50 + (1 - tk) * 10}%)`;
  const ck = smooth(21.0, 21.8, t); const cw = $('cardWrap');
  if (ck > 0.001) { if (!S._cardDrawn || S._cardDrawn !== key) { drawCard($('cardCanvas')); S._cardDrawn = key; } cw.classList.remove('hidden'); cw.style.opacity = Math.min(1, ck * 1.4); cw.querySelector('.sheet').style.transform = `translateY(${(1 - ease(ck)) * 60}px) scale(${0.94 + 0.06 * ease(ck)})`; }
  else cw.classList.add('hidden');
  renderFrame(!S.demoPlaying);
  return new Promise(res => requestAnimationFrame(() => res()));
}
const lerpP = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];

// ------------------------------------------------------------------------------------------------ loop + boot
function loop() {
  if (!DEMO) {
    const t = now(); const animating = S.tween || t - S.lastChange < 3 || (S.t0 != null && t - S.t0 < 4.5);
    const idle = t - S.lastInput > 6;
    S._fr = (S._fr || 0) + 1;
    const settle = cache.cam && !S.tween && t - S.lastInput > 0.35 && Math.abs(S.cam.s / cache.cam.s - 1) > 0.03;
    if (S.dirty || animating || !idle || settle || S._fr % 4 === 0) { renderFrame(); S.dirty = false; }
  } else if (S.demoPlaying) { const t = (performance.now() - S.demoStart) / 1000; demoSeek(t % 27.5); }
  requestAnimationFrame(loop);
}
async function pollSim() { // switch automatically when sim-drenaje publishes its per-AGEB table
  if (DEMO || FORCE_OBS || S.m.mode === 'sim') return;
  const d = await getJSON(SD + 'ageb-drainage.json');
  if (d?.agebs) { S.src.drainage = d; const items = S.items.map(it => ({ tool: it.tool, i: it.i, t: it.t, gain: it.gain })); buildAll(); S.items = items; recompute(false, null); say('¡Llegó la tabla completa de <b>sim-drenaje</b>! Recalculé todo con el modelo nuevo.'); return; }
  setTimeout(pollSim, 90000);
}
async function boot() {
  resize();
  if (DEMO) document.body.classList.add('demo');
  $('ldGota').innerHTML = GOTA;
  try { await loadAll(); } catch (e) { $('ldTxt').textContent = 'No pude cargar los datos (' + e.message + ').'; console.error(e); return; }
  setupUI();
  buildAll(); resize();
  S.cam = { ...S.fit };
  // restore a shared plan
  const hp = new URLSearchParams(location.hash.slice(1)).get('plan');
  S.items = []; recompute(false, null);
  if (hp && !DEMO) { const its = decodePlan(hp, S.m.n); for (const it of its) { const before = S.ev.people; if (S.ev.cost + TOOL[it.tool].cost > BUDGET) break; S.items.push({ ...it, t: -10 }); recompute(false, null); S.items[S.items.length - 1].gain = S.ev.people - before; } recompute(false, null); }
  S.purseXY = (() => { const r = $('purse').getBoundingClientRect(); return [r.left + 30, r.top + r.height / 2]; })();
  addEventListener('resize', () => { const r = $('purse').getBoundingClientRect(); S.purseXY = [r.left + 30, r.top + r.height / 2]; });
  setupInput();
  $('loading').classList.add('done');
  ['pointerdown', 'pointermove', 'wheel', 'keydown'].forEach(ev => addEventListener(ev, () => { S.lastInput = now(); }, { passive: true }));
  if (DEMO) {
    D = planDemo(); window.__cauceDemo.steps = D.steps.map(s => ({ tool: s.tool, ageb: S.m.agebs[s.i].id, t: s.tPlace }));
    readyResolve(); demoSeek(0);
    if (Q.get('autoplay') !== '0') { S.demoPlaying = true; S.demoStart = performance.now(); }
  } else {
    if (hp && S.items.length) { S.t0 = -99; say(`Este es un plan compartido: <b>${S.items.length}</b> obras, <b>${fmt(S.ev.people)}</b> personas protegidas. ¡Mejóralo!`); }
    else { if (Q.get('intro') !== '0') $('intro').classList.remove('hidden'); S.t0 = now(); say('¡Hola! Soy <b>Gota</b>. Elige una obra abajo y tócala sobre una colonia.'); }
    readyResolve(); setTimeout(pollSim, 30000);
  }
  requestAnimationFrame(loop);
}
boot();
