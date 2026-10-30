// nav-juguete · geometry + hazard helpers (browser and Node). No dependencies.
const R = 6371008.8, RAD = Math.PI / 180;

// Local equirectangular frame (metres) around a reference point. Use ONE frame for routes and hazards together:
// GF (centre of the ZMG) is the shared default; `frame()` ignores its argument on purpose.
function makeFrame(lat0, lon0) {
  const kx = R * RAD * Math.cos(lat0 * RAD), ky = R * RAD;
  return { kx, ky, xy: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky], ll: ([x, y]) => [x / kx + lon0, y / ky + lat0] };
}
export const GF = makeFrame(20.67, -103.35);
export function frame() { return GF; }

export function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
  return [Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t];
}
export function pip(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}

// A measured polyline: cumulative distance, point/heading lookup by distance s (metres).
export class Line {
  constructor(coords, F) {
    this.F = F; this.ll = coords; this.p = coords.map(F.xy); this.cum = [0];
    for (let i = 1; i < this.p.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.p[i][0] - this.p[i - 1][0], this.p[i][1] - this.p[i - 1][1]));
    this.length = this.cum[this.cum.length - 1];
  }
  idx(s) { // segment index i so that cum[i] <= s < cum[i+1]
    let lo = 0, hi = this.cum.length - 1; s = Math.max(0, Math.min(this.length, s));
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    return lo;
  }
  xyAt(s) {
    s = Math.max(0, Math.min(this.length, s)); const i = this.idx(s), a = this.p[i], b = this.p[i + 1] || a;
    const L = this.cum[i + 1] - this.cum[i] || 1, t = (s - this.cum[i]) / L; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  at(s) { return this.F.ll(this.xyAt(s)); }
  // heading (deg, clockwise from north) averaged over a window [s-back, s+ahead] using unit vectors
  heading(s, back = 20, ahead = 40, n = 8) {
    let vx = 0, vy = 0;
    for (let k = 0; k < n; k++) {
      const s0 = s - back + (back + ahead) * k / n, s1 = s - back + (back + ahead) * (k + 1) / n;
      const a = this.xyAt(s0), b = this.xyAt(s1); const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L > 1e-6) { const w = 1 - Math.abs((k + .5) / n - back / (back + ahead)) * 0.6; vx += dx / L * w; vy += dy / L * w; }
    }
    return (Math.atan2(vx, vy) / RAD + 360) % 360;
  }
  project(xy, from = 0) { // nearest point: {s, d}
    let best = { s: 0, d: Infinity };
    for (let i = 0; i < this.p.length - 1; i++) {
      if (this.cum[i + 1] < from) continue;
      const [d, t] = segDist(xy, this.p[i], this.p[i + 1]);
      if (d < best.d) best = { s: this.cum[i] + t * (this.cum[i + 1] - this.cum[i]), d };
    }
    return best;
  }
  slice(s0, s1) {
    const out = [this.at(s0)]; for (let i = 0; i < this.p.length; i++) if (this.cum[i] > s0 && this.cum[i] < s1) out.push(this.ll[i]);
    out.push(this.at(s1)); return out;
  }
}

// --- hazards --------------------------------------------------------------------------------------------
const num = s => { const m = String(s ?? '').match(/\d+(\.\d+)?/g); return m ? Math.max(...m.map(Number)) : null; };
// Normalise any hazard layer (observed IMEPLAN today; modeled layers later) into polygons with display metadata.
export function hazardsFromGeoJSON(gj, layer, F) {
  const refs = {};
  for (const f of gj.features || []) if (f.geometry?.type === 'Point') refs[f.properties?.name] = f.properties;
  const out = [];
  for (const f of gj.features || []) {
    const g = f.geometry; if (!g || !/Polygon/.test(g.type)) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const p = f.properties || {}; const base = String(p.name || '').split('/')[0]; const ref = refs[base] || {};
    const exp = [p['Infraestructura expuesta'], p['Sistema afectable'], ref['Categoría'], ref['Sistema afectable'], ref.Referencia].filter(Boolean).join(' · ');
    const underpass = /desnivel/i.test(exp);
    let cat = layer.kind === 'observed' ? (underpass ? 'underpass' : p.category === 'Zonas Criticas' ? 'critical' : 'site') : (layer.kind || 'modeled');
    let depth = null, depthText = '';
    if (layer.kind === 'observed') {
      const rng = ref['Rango de alturas de inundación (cm)'] || p['Rango de alturas de inundación'];
      if (rng) { depth = num(rng); depthText = `${String(rng).replace(/\s*-\s*/, '–')} cm reportados`; }
      else if (p['Altura máxima reportada']) { depth = num(p['Altura máxima reportada']); depthText = `altura máx. reportada: ${p['Altura máxima reportada']}`; }
    } else if (p.depth_m != null) { depth = p.depth_m * 100; depthText = `${(+p.depth_m).toFixed(2)} m modelados`; }
    for (const poly of polys) {
      const ring = poly[0]; const xy = ring.map(F.xy);
      let cx = 0, cy = 0, a = 0;
      for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) { const cr = xy[j][0] * xy[i][1] - xy[i][0] * xy[j][1]; a += cr; cx += (xy[j][0] + xy[i][0]) * cr; cy += (xy[j][1] + xy[i][1]) * cr; }
      const area = Math.abs(a / 2); const c = a ? [cx / (3 * a), cy / (3 * a)] : xy[0];
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const [x, y] of xy) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
      out.push({
        id: `${layer.id}:${p.name || out.length}:${out.length}`, layerId: layer.id, kind: layer.kind, cat, name: p.name || '',
        ref: ref.Referencia || p.Referencia || p.nombre || '', motivo: p.Motivo || '', exposed: exp, depth, depthText,
        ring, xy, area, c: F.ll(c), cxy: c, bbox: [minx, miny, maxx, maxy], props: p,
      });
    }
  }
  return out;
}

// Hazards touched by / near a measured line. Returns [{h, s, d}] sorted by s.
export function hazardsAlong(line, hazards, maxD = 250) {
  const out = [];
  let lb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of line.p) { lb = [Math.min(lb[0], x), Math.min(lb[1], y), Math.max(lb[2], x), Math.max(lb[3], y)]; }
  for (const h of hazards) {
    const b = h.bbox; if (b[0] > lb[2] + maxD || b[2] < lb[0] - maxD || b[1] > lb[3] + maxD || b[3] < lb[1] - maxD) continue;
    let best = { s: 0, d: Infinity };
    for (const v of h.xy) { const r = line.project(v); if (r.d < best.d) best = r; }
    // route vertices inside the polygon -> distance 0 (first entry)
    for (let i = 0; i < line.p.length; i++) {
      const q = line.p[i]; if (q[0] < b[0] || q[0] > b[2] || q[1] < b[1] || q[1] > b[3]) continue;
      if (pip(q, h.xy)) { if (best.d > 0 || line.cum[i] < best.s) best = { s: line.cum[i], d: 0 }; break; }
    }
    if (best.d <= maxD) out.push({ h, s: best.s, d: best.d });
  }
  return out.sort((a, b) => a.s - b.s);
}

export const HIT_M = 30; // a route "crosses" a hazard if it passes within 30 m of its polygon
export const PENALTY_S = { underpass: 900, critical: 600, site: 300, modeled: 420, hotspot: 600, water: 900, 'terrain-index': 120 };
export function exposure(line, hazards) {
  const near = hazardsAlong(line, hazards, 250);
  const hits = near.filter(n => n.d <= HIT_M);
  return { near, hits, penalty: hits.reduce((a, n) => a + (PENALTY_S[n.h.cat] ?? 300), 0) };
}

// --- OSRM step text -> Spanish ------------------------------------------------------------------------
const TYPES = ['exit roundabout', 'exit rotary', 'roundabout turn', 'end of road', 'new name', 'on ramp', 'off ramp', 'roundabout', 'rotary', 'notification', 'continue', 'depart', 'arrive', 'merge', 'turn', 'fork'];
const MODS = ['sharp right', 'sharp left', 'slight right', 'slight left', 'uturn', 'straight', 'right', 'left'];
const MOD_ES = { 'sharp right': 'fuerte a la derecha', 'sharp left': 'fuerte a la izquierda', 'slight right': 'ligeramente a la derecha', 'slight left': 'ligeramente a la izquierda', uturn: 'en U', straight: 'derecho', right: 'a la derecha', left: 'a la izquierda' };
export function parseStep(instruction) {
  let s = String(instruction || '').trim(), type = '', mod = '';
  for (const t of TYPES) if (s === t || s.startsWith(t + ' ')) { type = t; s = s.slice(t.length).trim(); break; }
  for (const m of MODS) if (s === m || s.startsWith(m + ' ')) { mod = m; s = s.slice(m.length).trim(); break; }
  return { type, mod, name: s };
}
export function stepSpanish(instruction) {
  const { type, mod, name } = parseStep(instruction);
  if (!type) return { text: instruction, icon: 'straight' };
  const on = name ? ` en ${name}` : '', by = name ? ` por ${name}` : '', to = name ? ` hacia ${name}` : '';
  const side = /right/.test(mod) ? 'derecha' : /left/.test(mod) ? 'izquierda' : '';
  const icon = mod === 'uturn' ? 'uturn' : /roundabout|rotary/.test(type) ? 'roundabout' : (mod || 'straight').replace(' ', '-');
  switch (type) {
    case 'depart': return { text: `Sal${by || ''}`, icon: 'straight' };
    case 'arrive': return { text: 'Llegas a tu destino', icon: 'arrive' };
    case 'turn': return { text: mod === 'straight' ? `Sigue derecho${by}` : mod === 'uturn' ? `Da vuelta en U${on}` : `Gira ${MOD_ES[mod] || ''}${on}`, icon };
    case 'new name': return { text: `Continúa${by}`, icon: 'straight' };
    case 'continue': return { text: mod && mod !== 'straight' ? `Continúa ${MOD_ES[mod]}${by}` : `Continúa${by}`, icon };
    case 'merge': return { text: `Incorpórate${to || ''}`, icon };
    case 'fork': return { text: `En la bifurcación, mantente a la ${side || 'derecha'}${to}`, icon };
    case 'end of road': return { text: `Al final de la calle, gira a la ${side || 'derecha'}${on}`, icon };
    case 'on ramp': return { text: `Toma la rampa${to}`, icon };
    case 'off ramp': return { text: `Toma la salida${to}`, icon };
    case 'roundabout': case 'rotary': return { text: `En la glorieta, sal${to}`, icon: 'roundabout' };
    case 'exit roundabout': case 'exit rotary': return { text: `Sal de la glorieta${to}`, icon };
    default: return { text: `Continúa${by}`, icon: 'straight' };
  }
}
