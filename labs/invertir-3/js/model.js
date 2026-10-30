// Alcaldía por un día — illustrative effect model.
// Everything here is a toy: the numbers come from real data (INEGI/CONAPO/DENUE/IMEPLAN via infra-data, sim-drenaje
// ensemble) but the effect of each intervention is a deliberately simple, documented assumption (see README.md).

export const CAPS = [0, 10, 20, 30, 40, 50, 60];      // sim-drenaje drainage capacities, mm/h
export const C0 = 20;                                  // "current" capacity: low end of sim-drenaje's inferred 20–30 mm/h range
export const BUDGET = 2000;                            // millones de pesos (MDP)
const FREQ_VAL = [0, 0.12, 0.3, 0.5, 0.7, 0.9, 0, 0];  // sim-drenaje frequency classes → representative share (class midpoints)

// Unit costs: see README "Costos unitarios" for sources. Effects are assumptions of the game.
export const TOOLS = [
  { id: 'colector', key: 'c', name: 'Colector pluvial', short: 'Colector', cost: 65, kind: 'cap', Q: 3.0,
    unit: '1 km de tubo · ≈3 m³/s', blurb: 'Tubo grande que saca el agua más rápido.',
    good: 'b', ref: 'Colector Villa Fontana: 36.2 MDP por 570 m (Plan Integral del Agua, Jalisco) ≈ 63 MDP/km' },
  { id: 'vaso', key: 'v', name: 'Vaso regulador', short: 'Vaso', cost: 95, kind: 'store', V: 60000, R: 1500,
    unit: '60,000 m³ · ayuda en 1.5 km', blurb: 'Estanque que guarda la tormenta y la suelta despacio.',
    good: 'a', ref: 'Gran Parque Zapopan Sur, etapa 1: 100 MDP por 62,000 m³ (Zapopan, 2025) ≈ 1,600 $/m³' },
  { id: 'jardin', key: 'j', name: 'Jardín de lluvia', short: 'Jardín', cost: 22, kind: 'store', V: 10000, R: 0,
    unit: '10,000 m³ · en la colonia', blurb: 'Parque que se inunda a propósito y deja que el agua se infiltre.',
    good: 'a', ref: 'Jardín de Lluvia de Coapa (CDMX, 2026): 22 MDP, >10 millones de litros' },
  { id: 'pozos', key: 'p', name: 'Pozos de absorción', short: 'Pozos', cost: 10, kind: 'cap', Q: 0.2,
    unit: '4 pozos · ≈200 l/s', blurb: 'Meten agua al subsuelo; baratos pero de efecto local.',
    good: 'b', ref: '3 pozos de infiltración por 7.2 MDP (Alcaldía Iztapalapa, 2025) ≈ 2.4 MDP por pozo' },
  { id: 'reubicar', key: 'r', name: 'Reubicar viviendas', short: 'Reubicar', cost: 60, kind: 'reloc', homes: 100,
    unit: '100 viviendas', blurb: 'Mudar casas de lo más bajo a terreno seguro. Caro, pero seguro.',
    good: 'a', ref: 'Vivienda para el Bienestar: ≈600 mil pesos por vivienda (Infonavit/Conavi, 2025); no incluye terreno' },
];
export const TOOL = Object.fromEntries(TOOLS.map(t => [t.id, t]));
export const TOOL_BY_KEY = Object.fromEntries(TOOLS.map(t => [t.key, t]));

const STORE_EFF = { vaso: 0.6, jardin: 0.6 }; // share of the stored volume that actually intercepts flood water (assumption)

// ------------------------------------------------------------------------------------------------ model build
// board: board.json; src: { drainage (ageb-drainage.json), images ({freqV, ind, lab, W, H}), stats (sim-drenaje stats.json), terrain (ageb-terrain.json) }
export function buildModel(board, src) {
  const A = board.agebs, n = A.length, mS = board.meta.mScale;
  const m = {
    n, agebs: A, mode: 'obs', modeLabel: '', runs: 0, combos: 0,
    pob: new Float64Array(n), area: new Float64Array(n), curve: new Float32Array(n * 7), gap: new Array(n).fill(null),
    sens: new Float32Array(n), fac: new Float64Array(n), marg: new Uint8Array(n), open: new Float32Array(n), depr: new Float32Array(n).fill(0.5),
    cx: new Float64Array(n), cy: new Float64Array(n), nb: [], dmean: 0.3, hasTerrain: false, extra: new Array(n).fill(null), nRanked: 0,
  };
  for (let i = 0; i < n; i++) {
    const a = A[i];
    m.pob[i] = a.pob || 0;
    m.fac[i] = (a.esc || 0) + (a.gua || 0) + (a.hos || 0) + (a.cli || 0) + (a.res || 0);
    m.marg[i] = a.gm === 'Muy alto' || a.gm === 'Alto' ? 1 : 0;
    m.open[i] = Math.min(1, ((a.ve || 0) + (a.agua || 0)) / 25);
    m.cx[i] = a.c[0]; m.cy[i] = a.c[1];
  }
  // mean depth of flooded urban area (m), from sim-drenaje curves at C0: volume / area
  if (src.stats?.curves) {
    const r = [];
    for (const inf of Object.values(src.stats.curves)) for (const tr of Object.values(inf)) { const c = tr[C0] || tr[String(C0)]; if (c && c.urbanFlooded15_km2 > 0) r.push(c.urbanFloodVolume15_Mm3 / c.urbanFlooded15_km2); }
    if (r.length) m.dmean = r.reduce((s, v) => s + v, 0) / r.length;
    m.runs = src.stats.runsDone || 0; m.combos = (src.stats.combos || []).length;
  }
  let filled = false;
  // 1) official per-AGEB aggregation from sim-drenaje
  if (src.drainage?.agebs) {
    const D = src.drainage.agebs; let hit = 0;
    for (let i = 0; i < n; i++) {
      const d = D[A[i].id]; if (!d || !d.cells_urban) continue; hit++;
      m.area[i] = d.area_urban_km2;
      const by = d.flooded_share_by_cap || {};
      for (let k = 0; k < 7; k++) { const v = by[CAPS[k]] ?? by[String(CAPS[k])]; m.curve[i * 7 + k] = v == null ? NaN : v; }
      fillCurve(m.curve, i);
      m.gap[i] = d.gap_class || null; m.sens[i] = d.drainage_sensitivity_cm_per_10mmh || 0;
      // final-ensemble extras (sim-drenaje): drainage benefit 0→40 mm/h, ranks, storm-inlet sensitivity
      m.extra[i] = { popBenefit: d.population_benefit_0_to_40 ?? null, rankBenefit: d.rank_drainage_benefit ?? null, rankResid: d.rank_residual_exposure ?? null, inletExtra: d.inlet_extra_flooded_share ?? null, resid40: d.residual_flooded_share_40 ?? null };
    }
    if (hit > n * 0.5) { filled = true; m.mode = 'sim'; m.runs = src.drainage.meta?.runs || m.runs; m.nRanked = Object.keys(D).length; }
  }
  // 2) aggregate sim-drenaje's published data images per AGEB in the browser
  if (!filled && src.images) {
    const { freqV, ind, lab, W, H, pxKm2 } = src.images;
    const cnt = new Float64Array(n), sum = new Float64Array(n * 7), ga = new Float64Array(n), gb = new Float64Array(n), gc = new Float64Array(n), ss = new Float64Array(n);
    for (let p = 0, N = W * H; p < N; p++) {
      const L = lab[p]; if (!L) continue; const i = L - 1;
      const g = ind[p * 3 + 1], r = ind[p * 3]; if (!g || r === 255) continue; // urban drainage cells only, no permanent water
      cnt[i]++; const V = freqV[p];
      for (let k = 0; k < 7; k++) sum[i * 7 + k] += FREQ_VAL[(V >> (3 * k)) & 7];
      if (g === 1) ga[i]++; else if (g === 2) gb[i]++; else gc[i]++;
      ss[i] += ind[p * 3 + 2] / 10;
    }
    let hit = 0;
    for (let i = 0; i < n; i++) {
      if (!cnt[i]) continue; hit++;
      m.area[i] = cnt[i] * pxKm2;
      for (let k = 0; k < 7; k++) m.curve[i * 7 + k] = sum[i * 7 + k] / cnt[i];
      const share = (ga[i] + gb[i]) / cnt[i];
      m.gap[i] = share < 0.05 ? 'c' : ga[i] >= gb[i] ? 'a' : 'b'; // sim-drenaje final rule: c when < 5 % of urban cells are a or b
      m.sens[i] = ss[i] / cnt[i];
    }
    if (hit > n * 0.5) { filled = true; m.mode = 'sim-img'; }
  }
  // 3) observed-only heuristic ("modelo provisional")
  for (let i = 0; i < n; i++) {
    if (filled && m.area[i] > 0) continue;
    const a = A[i];
    if (!m.area[i]) m.area[i] = Math.max(0.01, (a.a || 0.1) * Math.max(0.3, (a.bu || 50) / 100));
    if (filled) { for (let k = 0; k < 7; k++) m.curve[i * 7 + k] = 0; continue; } // no urban sim cells: treat as not flooding
    const s0 = Math.min(0.85, (a.ia || 0) / 100 + 0.04 * (a.pr || 0) + 0.03 * (a.pd || 0));
    for (let k = 0; k < 7; k++) {
      const C = CAPS[k];
      m.curve[i * 7 + k] = C <= C0 ? Math.min(0.95, s0 * (1 + 0.35 * (C0 - C) / C0)) : s0 * (0.5 + 0.5 * Math.exp(-(C - C0) / 18));
    }
    m.gap[i] = null; m.sens[i] = 0;
  }
  // sim-relieve terrain (optional): depression share → vaso efficiency
  m.terr = new Array(n).fill(null);
  if (src.terrain) {
    const T = src.terrain.agebs || src.terrain; let hit = 0;
    // vaso suitability: percentile of natural depression volume per ha (sim-relieve, building-aware DEM, open ground)
    const vals = []; for (let i = 0; i < n; i++) { const t = T[A[i].id]; if (t && typeof t.dep_vol_m3_ha === 'number') vals.push(t.dep_vol_m3_ha); }
    vals.sort((a, b) => a - b);
    const rank = v => { let lo = 0, hi = vals.length; while (lo < hi) { const md = (lo + hi) >> 1; if (vals[md] < v) lo = md + 1; else hi = md; } return vals.length ? lo / vals.length : 0.5; };
    for (let i = 0; i < n; i++) {
      const t = T[A[i].id]; if (!t) continue; m.terr[i] = t;
      if (typeof t.dep_vol_m3_ha === 'number') { m.depr[i] = rank(t.dep_vol_m3_ha); hit++; }
    }
    m.hasTerrain = hit > n * 0.3;
  }
  // neighbours within 1.5 km (true metres) for vasos
  const R = TOOL.vaso.R / mS, R2 = R * R, cell = R;
  const grid = new Map(); const key = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
  for (let i = 0; i < n; i++) { const k = key(m.cx[i], m.cy[i]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  for (let i = 0; i < n; i++) {
    const gx = Math.floor(m.cx[i] / cell), gy = Math.floor(m.cy[i] / cell), out = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get((gx + dx) + ',' + (gy + dy)) || []) {
      if (j === i) continue; const d2 = (m.cx[j] - m.cx[i]) ** 2 + (m.cy[j] - m.cy[i]) ** 2; if (d2 <= R2) out.push([j, Math.sqrt(d2) * mS]);
    }
    m.nb.push(out);
  }
  // baseline exposure
  m.s0 = new Float64Array(n); m.E0 = new Float64Array(n);
  let E = 0, F = 0, Em = 0;
  for (let i = 0; i < n; i++) { m.s0[i] = curveAt(m, i, C0); m.E0[i] = m.pob[i] * m.s0[i]; E += m.E0[i]; F += m.fac[i] * m.s0[i]; if (m.marg[i]) Em += m.E0[i]; }
  m.E0total = E; m.F0total = F; m.margShare0 = E ? Em / E : 0;
  m.colectorTop = [];
  if (m.mode === 'sim') m.colectorTop = [...Array(n).keys()].filter(i => m.extra[i]?.popBenefit > 0).sort((a, b) => m.extra[b].popBenefit - m.extra[a].popBenefit).slice(0, 40);
  m.modeLabel = m.mode === 'sim' ? 'Simulación sim-drenaje (ensamble por AGEB)' : m.mode === 'sim-img' ? 'Simulación sim-drenaje · preliminar' : 'Modelo provisional: solo inundación observada';
  return m;
}
function fillCurve(c, i) { // fill missing capacities by neighbour interpolation; enforce non-increasing
  const b = i * 7; let last = null;
  for (let k = 0; k < 7; k++) { if (isNaN(c[b + k])) { let nx = null; for (let j = k + 1; j < 7; j++) if (!isNaN(c[b + j])) { nx = c[b + j]; break; } c[b + k] = last != null && nx != null ? (last + nx) / 2 : (last ?? nx ?? 0); } last = c[b + k]; }
  for (let k = 1; k < 7; k++) if (c[b + k] > c[b + k - 1]) c[b + k] = c[b + k - 1];
}
export function curveAt(m, i, C) {
  C = Math.max(0, Math.min(60, C)); const k = Math.min(5, Math.floor(C / 10)), f = (C - k * 10) / 10, b = i * 7;
  return m.curve[b + k] * (1 - f) + m.curve[b + k + 1] * f;
}
// capacity added by a capacity tool in AGEB i (mm/h): Q spread over the AGEB's urban area
export function addedCap(m, tool, i) { return Math.min(40, 3.6e6 * tool.Q / Math.max(0.02, m.area[i]) / 1e6); }
export function storeEff(m, tool, i) {
  if (tool.id === 'jardin') return STORE_EFF.jardin * (0.6 + 0.4 * m.open[i]);               // needs open ground
  return STORE_EFF.vaso * (0.7 + 0.3 * m.open[i]) * (0.8 + 0.4 * m.depr[i]);              // likes open ground and natural lows
}

// ------------------------------------------------------------------------------------------------ evaluation
// items: [{tool, i}] in placement order. Returns per-AGEB arrays + totals.
export function evaluate(m, items) {
  const n = m.n, dC = new Float64Array(n), C = new Float64Array(n), fa = new Float64Array(n), rem = new Float64Array(n), reloc = new Float64Array(n);
  const contrib = items.map(() => ({ people: 0, fac: 0, km2: 0, agebs: [] }));
  for (const it of items) { const t = TOOL[it.tool]; if (t.kind === 'cap') dC[it.i] += addedCap(m, t, it.i); }
  for (let i = 0; i < n; i++) { C[i] = Math.min(60, C0 + dC[i]); fa[i] = curveAt(m, i, C[i]) * m.area[i]; }
  // capacity contributions (split by each tool's share of the AGEB's added capacity)
  items.forEach((it, k) => {
    const t = TOOL[it.tool]; if (t.kind !== 'cap') return; const i = it.i;
    const gain = (m.s0[i] * m.area[i] - fa[i]); const share = dC[i] ? addedCap(m, t, i) / dC[i] : 0;
    contrib[k].km2 += gain * share; contrib[k].agebs.push(i);
  });
  items.forEach((it, k) => {
    const t = TOOL[it.tool]; if (t.kind !== 'store') return;
    const alloc = storeAlloc(m, t, it.i, fa, rem);
    for (const [j, a] of alloc) { rem[j] += a; contrib[k].km2 += a; contrib[k].agebs.push(j); contrib[k].people += a * m.pob[j] / m.area[j]; contrib[k].fac += a * m.fac[j] / m.area[j]; }
  });
  const s = new Float64Array(n), E = new Float64Array(n);
  for (let i = 0; i < n; i++) { s[i] = Math.max(0, fa[i] - rem[i]) / m.area[i]; E[i] = m.pob[i] * s[i]; }
  items.forEach((it, k) => {
    const t = TOOL[it.tool]; if (t.kind !== 'reloc') return; const i = it.i;
    const homes = t.homes * (m.agebs[i].ocup || 3.5); const r = Math.min(homes, Math.max(0, E[i] - reloc[i]));
    reloc[i] += r; contrib[k].people += r; contrib[k].agebs.push(i);
  });
  let people = 0, fac = 0, km2 = 0, pm = 0, cost = 0;
  for (let i = 0; i < n; i++) {
    const Ei = Math.max(0, E[i] - reloc[i]); const p = m.E0[i] - Ei; people += p; if (m.marg[i]) pm += p;
    fac += m.fac[i] * (m.s0[i] - s[i]); km2 += m.s0[i] * m.area[i] - s[i] * m.area[i]; E[i] = Ei;
  }
  for (const it of items) cost += TOOL[it.tool].cost;
  // people per contribution for capacity/storage items: km² × density of the affected AGEBs
  items.forEach((it, k) => {
    const t = TOOL[it.tool]; if (t.kind === 'reloc') return; const c = contrib[k];
    if (t.kind === 'cap') { const i = it.i; c.people = c.km2 * m.pob[i] / m.area[i]; c.fac = c.km2 * m.fac[i] / m.area[i]; }
  });
  return { C, s, E, reloc, people, fac, km2, cost, margShare: people > 0 ? pm / people : 0, contrib };
}
// distribute a storage tool's removable flooded area over host (+ neighbours for vasos)
function storeAlloc(m, t, i, fa, rem) {
  let cap = t.V * storeEff(m, t, i) / m.dmean / 1e6; // km² of flooded area it can remove
  const cand = [[i, 0], ...(t.R ? m.nb[i] : [])].map(([j, d]) => ({ j, w: Math.max(0, fa[j] - rem[j]) * (j === i ? 1.6 : Math.max(0, 1 - d / t.R)), left: Math.max(0, fa[j] - rem[j]) }));
  const out = new Map();
  for (let pass = 0; pass < 3 && cap > 1e-9; pass++) {
    const W = cand.reduce((s, c) => s + (c.left > 1e-12 ? c.w : 0), 0); if (W <= 0) break;
    let used = 0;
    for (const c of cand) { if (c.left <= 1e-12 || c.w <= 0) continue; const a = Math.min(c.left, cap * c.w / W); c.left -= a; used += a; out.set(c.j, (out.get(c.j) || 0) + a); }
    cap -= used;
  }
  return [...out.entries()];
}

// marginal people protected by adding (tool, i) to a plan whose evaluation is `ev` (fast, local)
export function marginal(m, ev, tool, i, items) {
  const t = TOOL[tool];
  const Ei = ev.E[i];
  if (t.kind === 'reloc') return Math.min(t.homes * (m.agebs[i].ocup || 3.5), Ei);
  if (t.kind === 'cap') {
    const C1 = Math.min(60, ev.C[i] + addedCap(m, t, i)); if (C1 <= ev.C[i]) return 0;
    const remI = Math.max(0, curveAt(m, i, ev.C[i]) * m.area[i] - ev.s[i] * m.area[i]);
    const fa1 = Math.max(0, curveAt(m, i, C1) * m.area[i] - remI);
    const E1 = Math.max(0, m.pob[i] * fa1 / m.area[i] - ev.reloc[i]);
    return Math.max(0, Ei - E1);
  }
  // storage: allocate over current remaining flooded areas
  const cur = j => ev.s[j] * m.area[j];
  let cap = t.V * storeEff(m, t, i) / m.dmean / 1e6;
  const cand = [[i, 0], ...(t.R ? m.nb[i] : [])].map(([j, d]) => ({ j, w: cur(j) * (j === i ? 1.6 : Math.max(0, 1 - d / t.R)), left: cur(j) }));
  let gain = 0;
  for (let pass = 0; pass < 3 && cap > 1e-9; pass++) {
    const W = cand.reduce((s, c) => s + (c.left > 1e-12 ? c.w : 0), 0); if (W <= 0) break; let used = 0;
    for (const c of cand) { if (c.left <= 1e-12 || c.w <= 0) continue; const a = Math.min(c.left, cap * c.w / W); c.left -= a; used += a; gain += Math.min(a * m.pob[c.j] / m.area[c.j], Math.max(0, ev.E[c.j])); }
    cap -= used;
  }
  return gain;
}

// greedy "plan de Gota": best people-per-peso pick until the budget runs out (or nothing helps)
export function greedyPlan(m, budget, base = [], opts = {}) {
  const items = base.slice(); let ev = evaluate(m, items); let spent = ev.cost;
  const used = new Set(items.map(it => it.tool + ':' + it.i)); // one of each tool per AGEB
  const cands = []; for (let i = 0; i < m.n; i++) if (m.E0[i] > 5) cands.push(i);
  const maxSteps = opts.maxSteps || 80; const picks = [];
  for (let step = 0; step < maxSteps; step++) {
    let best = null, bestR = 0;
    for (const t of TOOLS) {
      if (spent + t.cost > budget + 1e-9) continue;
      for (const i of cands) {
        if (used.has(t.id + ':' + i)) continue;
        if (ev.E[i] < 1 && t.kind !== 'store') continue;
        const g = marginal(m, ev, t.id, i, items); const r = g / t.cost;
        if (r > bestR) { bestR = r; best = { tool: t.id, i, gain: g }; }
      }
    }
    if (!best || bestR <= 0.5) break; // < 0.5 people per MDP: stop
    items.push({ tool: best.tool, i: best.i }); picks.push(best); used.add(best.tool + ':' + best.i);
    ev = evaluate(m, items); spent = ev.cost;
  }
  return { items, ev, picks };
}

// ------------------------------------------------------------------------------------------------ plan URL codec
export function encodePlan(items) { return items.map(it => TOOL[it.tool].key + it.i.toString(36)).join('.'); }
export function decodePlan(s, n) {
  const out = []; for (const tok of String(s || '').split('.')) { const t = TOOL_BY_KEY[tok[0]]; const i = parseInt(tok.slice(1), 36); if (t && i >= 0 && i < n) out.push({ tool: t.id, i }); } return out;
}
