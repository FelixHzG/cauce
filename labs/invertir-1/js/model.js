// cauce. · dónde invertir — transparent exploratory priority index (pure functions; browser + Node).
//
//   Prioridad = 100 · P^a · E^b · V^c          (a + b + c = 1; weighted geometric mean, CENAPRED-style R = P × E × V)
//   P, E, V   = Σ wᵢ·pᵢ / Σ wᵢ                  (weighted mean of the factor percentiles in each group)
//   pᵢ        = percentile rank of the AGEB in factor i among inhabited AGEBs (0–1)
//
// Factors whose value is 0 for "nothing recorded" (zeroIsNone) map 0 → 0 and rank the positive values into 0.05–1, so an
// AGEB without any recorded or modeled water has P = 0 and therefore Prioridad = 0 ("sin peligro registrado").
// Missing values (null) drop that factor for that AGEB and the remaining weights of the group are renormalised.

export const GROUPS = [
  { id: 'P', label: 'Peligro', long: 'Peligro de inundación', hint: '¿Hay evidencia de agua aquí?', color: 'var(--water)' },
  { id: 'E', label: 'Exposición', long: 'Exposición', hint: '¿Cuánta gente y qué servicios hay?', color: 'var(--expo)' },
  { id: 'V', label: 'Vulnerabilidad', long: 'Vulnerabilidad y déficit', hint: '¿Qué tan difícil es recuperarse?', color: 'var(--vuln)' },
];

const num = v => (v == null || v === '' || !Number.isFinite(+v)) ? null : +v;
const clampPct = v => (v == null || v < 0 || v > 100) ? null : v;

export const BASE_FACTORS = [
  { id: 'obs', group: 'P', w: 3, kind: 'observado', zeroIsNone: true,
    label: 'Inundación registrada', src: 'IMEPLAN MUI 2026',
    desc: '% de la superficie del AGEB dentro de sitios inundables o zonas críticas (las zonas críticas cuentan doble).',
    unit: '% sup.', value: p => { const a = num(p.imeplan_area_pct); return a == null ? null : a + (num(p.imeplan_zona_area_pct) || 0); },
    fmt: v => `${Math.round(v)} %` },
  { id: 'puntos', group: 'P', w: 0.5, kind: 'reportado', zeroIsNone: true,
    label: 'Prensa y pasos a desnivel', src: 'Prensa 2023–26 · OSM',
    desc: 'Puntos de inundación recurrente en notas de prensa (ubicación aproximada) más pasos a desnivel mapeados en OSM.',
    unit: 'puntos', value: p => (num(p.prensa_puntos_n) || 0) + (num(p.pasos_desnivel_n) || 0), fmt: v => `${v}` },
  // Municipal incident series exist only for Guadalajara and Zapopan: null elsewhere (factor dropped there, not zero).
  // Off by default so the default ranking does not favour the two municipalities that publish records.
  { id: 'gdl', group: 'P', w: 0, kind: 'observado', zeroIsNone: true, partial: true,
    label: 'Reportes municipales GDL', src: 'Atlas de Riesgos Guadalajara 2010–22',
    desc: 'Reportes de inundación fechados 2010–2022 dentro del AGEB. Solo existe para Guadalajara; apagado por defecto para no favorecer al municipio que publica.',
    unit: 'reportes', value: p => p.incidentes_municipales_disponibles && String(p.incidentes_municipales_disponibles).startsWith('Guadalajara') ? num(p.gdl_reportes_n) : null, fmt: v => `${v} reportes` },
  { id: 'zap', group: 'P', w: 0, kind: 'observado', zeroIsNone: true, partial: true,
    label: 'Llamadas por inundación Zapopan', src: 'Gobierno de Zapopan 2017–25',
    desc: 'Servicios de emergencia por inundación atendidos 2017–2025. Solo existe para Zapopan; apagado por defecto.',
    unit: 'servicios', value: p => p.incidentes_municipales_disponibles && String(p.incidentes_municipales_disponibles).startsWith('Zapopan') ? num(p.zap_servicios_n) : null, fmt: v => `${v} servicios` },
  { id: 'dens', group: 'E', w: 2, kind: 'censo',
    label: 'Densidad de población', src: 'INEGI Censo 2020',
    desc: 'Habitantes por km² (densidad bruta del AGEB).',
    unit: 'hab/km²', value: p => num(p.dens_hab_km2), fmt: v => `${fmtInt(v)} hab/km²` },
  { id: 'equip', group: 'E', w: 1, kind: 'registro',
    label: 'Escuelas, guarderías y salud', src: 'INEGI DENUE',
    desc: 'Escuelas, guarderías, hospitales, clínicas y residencias de cuidado registradas en el AGEB.',
    unit: 'establec.', value: p => ['n_escuela', 'n_guarderia', 'n_hospital', 'n_clinica', 'n_residencia_cuidado'].reduce((s, k) => s + (num(p[k]) || 0), 0), fmt: v => `${v}` },
  { id: 'marg', group: 'V', w: 3, kind: 'censo',
    label: 'Marginación urbana', src: 'CONAPO IMU 2020',
    desc: 'Índice de marginación urbana 2020 (invertido: más marginación → más alto).',
    unit: 'índice', value: p => { const v = num(p.imn_2020); return v == null ? null : 1 - v; }, fmt: (v, p) => p.gm_2020 ? `grado ${p.gm_2020.toLowerCase()}` : '—' },
  { id: 'dep', group: 'V', w: 1, kind: 'censo',
    label: 'Niñez, vejez y discapacidad', src: 'INEGI Censo 2020',
    desc: '% de población de 0–14 años + 65 y más + con discapacidad.',
    unit: '%', value: p => { const a = num(p.pct_0_14), b = num(p.pct_65_mas), c = num(p.pct_discap); return a == null && b == null ? null : (a || 0) + (b || 0) + (c || 0); }, fmt: v => `${Math.round(v)} %` },
  { id: 'sinauto', group: 'V', w: 1, kind: 'censo',
    label: 'Hogares sin auto', src: 'INEGI Censo 2020',
    desc: '% de viviendas habitadas sin automóvil ni camioneta (capacidad de salir y evacuar).',
    unit: '%', value: p => clampPct(num(p.pct_viv_sin_auto)), fmt: v => `${Math.round(v)} %` },
  { id: 'sinpluvial', group: 'V', w: 2, kind: 'censo', pendingNote: 'Consulta INEGI INV en curso (infra-data); se suma sola al publicarse.',
    label: 'Manzanas sin coladera pluvial', src: 'INEGI INV 2020',
    desc: '% de manzanas sin alcantarilla de drenaje pluvial en ningún frente (presencia observada desde la calle, no capacidad).',
    unit: '%', value: p => clampPct(num(p.inv_pct_sin_pluvial)), fmt: v => `${Math.round(v)} %` },
  { id: 'sellado', group: 'V', w: 1, kind: 'satélite',
    label: 'Suelo sellado', src: 'ESA WorldCover 2021',
    desc: '% de la superficie clasificada como construida (impermeable: el agua no se infiltra).',
    unit: '%', value: p => clampPct(num(p.builtup_pct)), fmt: v => `${Math.round(v)} %` },
];

export const DEFAULT_GROUP_W = { P: 0.5, E: 0.2, V: 0.3 };
export const MIN_POP = 100; // AGEBs below this population are mapped but not ranked

export const PRESETS = {
  equilibrado: { label: 'Equilibrado', groups: { ...DEFAULT_GROUP_W }, factors: {} },
  agua: { label: 'Primero el agua', groups: { P: 0.75, E: 0.1, V: 0.15 }, factors: {} },
  gente: { label: 'Primero la gente', groups: { P: 0.3, E: 0.25, V: 0.45 }, factors: { marg: 4, dep: 2 } },
};

export function fmtInt(v) { return v == null ? '—' : Math.round(v).toLocaleString('es-MX'); }

// Percentile ranks (average rank for ties) of values among the universe; returns Float32Array with NaN for missing.
function percentiles(values, zeroIsNone) {
  const n = values.length, out = new Float64Array(n).fill(NaN);
  const idx = [];
  for (let i = 0; i < n; i++) { const v = values[i]; if (v == null) continue; if (zeroIsNone && v <= 0) { out[i] = 0; continue; } idx.push(i); }
  idx.sort((a, b) => values[a] - values[b]);
  const m = idx.length;
  for (let k = 0; k < m;) {
    let j = k; while (j + 1 < m && values[idx[j + 1]] === values[idx[k]]) j++;
    const r = m === 1 ? 1 : ((k + j) / 2) / (m - 1); // 0..1
    for (let t = k; t <= j; t++) out[idx[t]] = zeroIsNone ? 0.05 + 0.95 * r : r;
    k = j + 1;
  }
  return out;
}

// Prepare: rows = array of AGEB property objects (+ optional `joins` per factor). Returns a model with per-factor raw and pct.
export function prepare(rows, factors) {
  const uni = rows.map(p => (num(p.pob) || 0) > 0);
  const F = {};
  for (const f of factors) {
    const raw = rows.map((p, i) => uni[i] ? f.value(p) : null);
    const avail = raw.filter(v => v != null).length;
    F[f.id] = { raw, pct: percentiles(raw, f.zeroIsNone), avail };
  }
  return { rows, uni, F, factors };
}

// Compute group composites, scores and ranks for weights {groups:{P,E,V}, factors:{id:w}} and a filter fn(row)->bool.
export function score(model, weights, filter = () => true) {
  const { rows, F, factors } = model;
  const n = rows.length;
  const gw = weights.groups;
  const G = { P: new Float64Array(n), E: new Float64Array(n), V: new Float64Array(n) };
  const S = new Float64Array(n);
  const contrib = []; // per AGEB: computed lazily by explain()
  const active = factors.filter(f => (weights.factors[f.id] ?? f.w) > 0 && F[f.id].avail > 0);
  for (let i = 0; i < n; i++) {
    for (const g of ['P', 'E', 'V']) {
      let s = 0, sw = 0;
      for (const f of active) { if (f.group !== g) continue; const p = F[f.id].pct[i]; if (Number.isNaN(p)) continue; const w = weights.factors[f.id] ?? f.w; s += w * p; sw += w; }
      G[g][i] = sw > 0 ? s / sw : NaN;
    }
    let logS = 0, sw = 0, zero = false;
    for (const g of ['P', 'E', 'V']) {
      const w = gw[g]; if (!(w > 0)) continue; const v = G[g][i];
      if (Number.isNaN(v)) continue; if (v <= 0) { zero = true; break; }
      logS += w * Math.log(v); sw += w;
    }
    S[i] = !model.uni[i] || sw === 0 ? NaN : zero ? 0 : 100 * Math.exp(logS / sw);
  }
  // ranking among eligible AGEBs passing the filter, score > 0
  const order = [];
  for (let i = 0; i < n; i++) if (filter(rows[i]) && (+rows[i].pob || 0) >= MIN_POP && S[i] > 0) order.push(i);
  order.sort((a, b) => S[b] - S[a] || (+rows[b].pob) - (+rows[a].pob));
  const rank = new Int32Array(n).fill(0);
  order.forEach((i, k) => { rank[i] = k + 1; });
  return { G, S, order, rank, active, contrib };
}

// Per-factor contribution breakdown for one AGEB (for the "¿por qué aquí?" panel).
export function explain(model, weights, res, i) {
  const out = { groups: {} };
  for (const g of ['P', 'E', 'V']) {
    const items = [];
    let sw = 0;
    for (const f of model.factors) {
      if (f.group !== g) continue;
      const w = weights.factors[f.id] ?? f.w; const p = model.F[f.id].pct[i]; const raw = model.F[f.id].raw[i];
      const missing = Number.isNaN(p) || model.F[f.id].avail === 0;
      items.push({ f, w, p: missing ? null : p, raw, missing });
      if (!missing && w > 0) sw += w;
    }
    for (const it of items) it.share = (!it.missing && it.w > 0 && sw > 0) ? it.w * it.p / sw : 0; // contribution to group mean
    out.groups[g] = { value: res.G[g][i], weight: weights.groups[g], items };
  }
  out.score = res.S[i];
  return out;
}

// Bivariate classes (3×3): x = hazard P, y = vulnerability V (terciles among inhabited AGEBs).
// When more than a third of the AGEBs have P = 0 (observed-only), x = 0 means "P = 0" and P > 0 is split at its median.
export function bivariateBreaks(model, res) {
  const pAll = [], vAll = [];
  for (let i = 0; i < model.rows.length; i++) {
    if (!model.uni[i]) continue;
    const p = res.G.P[i], v = res.G.V[i];
    if (!Number.isNaN(p)) pAll.push(p);
    if (!Number.isNaN(v)) vAll.push(v);
  }
  pAll.sort((a, b) => a - b); vAll.sort((a, b) => a - b);
  const q = (arr, t) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(t * arr.length))] : 0.5;
  let p = [q(pAll, 1 / 3), q(pAll, 2 / 3)], zeroMode = false;
  if (!(p[0] > 0)) { const pos = pAll.filter(v => v > 0); p = [1e-9, q(pos, 0.5)]; zeroMode = true; }
  return { p, v: [q(vAll, 1 / 3), q(vAll, 2 / 3)], zeroMode, zeroShare: pAll.length ? pAll.filter(v => !(v > 0)).length / pAll.length : 0 };
}
export function bivariateClass(br, p, v) {
  const x = Number.isNaN(p) ? 0 : p < br.p[0] ? 0 : p < br.p[1] ? 1 : 2;
  const y = Number.isNaN(v) ? 0 : v < br.v[0] ? 0 : v < br.v[1] ? 1 : 2;
  return [x, y];
}
