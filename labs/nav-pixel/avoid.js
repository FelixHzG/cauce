// nav-pixel · hazard geometry + client-side fallback avoidance.
// Used only while /labs/shared/router/router.js is the stub (engine "stub-osrm-demo", avoided always []).
// When the real hazard-aware router ships, its own `avoided` list is used and this detour search is skipped.
// Browser + Node compatible (no DOM, no deps).

export const R = 6371008.8;
export function hav(a, b) {
  const t = Math.PI / 180, dl = (b[1] - a[1]) * t, dn = (b[0] - a[0]) * t;
  const s = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export function densify(coords, step = 10) {
  const out = []; let acc = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1], d = hav(a, b), n = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < n; k++) { const f = k / n; out.push({ p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], s: acc + d * f }); }
    acc += d;
  }
  out.push({ p: coords[coords.length - 1], s: acc });
  return out;
}
export function pip(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function segDistM(p, a, b) {
  const k = Math.cos(p[1] * Math.PI / 180) * 111320, m = 110540;
  const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * m, bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * m;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}
export function distToRings(p, rings) {
  if (pip(p, rings[0]) && !rings.slice(1).some(h => pip(p, h))) return 0;
  let d = 1e9;
  for (const r of rings) for (let i = 0; i < r.length - 1; i++) d = Math.min(d, segDistM(p, r[i], r[i + 1]));
  return d;
}
function bboxOf(rings) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const r of rings) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}
export function centroid(rings) {
  let x = 0, y = 0, n = 0; for (const [a, b] of rings[0]) { x += a; y += b; n++; } return [x / n, y / n];
}

// Classify any hazard feature into one of the alert kinds used in the UI.
// IMEPLAN MUI 2026: "Zonas Criticas" polygons, "Sitios Inundales" polygons, "Categoría" points (with Referencia).
export function classify(props, layer) {
  const sys = (props['Sistema afectable'] || '') + ' ' + (props['Motivo'] || '') + ' ' + (props['Referencia'] || '');
  if (layer && layer.kind === 'modeled') return 'modelado';
  if (layer && layer.kind === 'terrain-index') return 'terreno';
  if (layer && layer.kind === 'hotspot') return props.osm_way_id != null || /underpass/.test(layer.id) ? 'pasoosm' : 'hotspot';
  if (layer && layer.kind === 'observed' && props.category == null && (props.fecha || props.anio || props.tipo)) return 'incidente';
  if (props.category === 'Zonas Criticas') return 'critica';
  if (/desnivel/i.test(sys)) return 'desnivel';
  return 'encharcamiento';
}
export const WEIGHT = { critica: 3, desnivel: 3, encharcamiento: 1, modelado: 2, pasoosm: 1.5, hotspot: 1, incidente: 1, terreno: 0.5 };
// Layers whose geometry produces route alerts. 'water' (mapped permanent water) and 'terrain-index' are context only.
export const ALERT_KINDS = new Set(['observed', 'modeled', 'hotspot', 'terrain-index']);

// Build an indexed list of hazard polygons from a set of {layer, fc}.
// Points that share a site code with a polygon enrich it (Referencia = street address, height range in cm).
export function buildHazards(sets) {
  const out = [];
  for (const { layer, fc } of sets) {
    const pointsBySite = new Map();
    for (const f of fc.features) if (f.geometry && f.geometry.type === 'Point') pointsBySite.set(String(f.properties.name || ''), f.properties);
    if (layer.kind && !ALERT_KINDS.has(layer.kind)) continue;
    const hasArea = fc.features.some(f => f.geometry && /Polygon/.test(f.geometry.type));
    for (const f of fc.features) {
      const g = f.geometry; if (!g) continue;
      if (g.type === 'Point' && !hasArea) { // point-only layers (incidents, press reports, municipal lists): 40 m radius like the router
        const p = f.properties || {}, place = p.label || p.nombre || p.name || [p.calle, p.colonia].filter(Boolean).join(', ') || p.Referencia || '';
        out.push({ id: (layer.id || 'layer') + ':' + (p.id ?? out.length) + ':' + out.length, layerId: layer.id, layerKind: layer.kind, name: String(p.id ?? p.name ?? ''), site: layer.id + ':' + (p.site ?? p.id ?? out.length), kind: classify(p, layer), props: { ...p, Referencia: place }, pt: g.coordinates, radius: +(p.radius_m || 40), bb: [g.coordinates[0], g.coordinates[1], g.coordinates[0], g.coordinates[1]], center: g.coordinates });
        continue;
      }
      if (g.type === 'LineString' || g.type === 'MultiLineString') {
        const p = f.properties || {}, lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
        const site = 'osm-' + (p.site ?? p.id ?? out.length);
        const mid = lines[0][Math.floor(lines[0].length / 2)];
        out.push({ id: (layer.id || 'layer') + ':' + (p.id || out.length) + ':' + out.length, layerId: layer.id, layerKind: layer.kind, name: p.label || p.name || p.id || '', site, kind: classify(p, layer), props: { ...p, Referencia: p.label || p.name || '' }, lines, bb: bboxOf(lines), center: p.marker || mid });
        continue;
      }
      const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const rings of list) {
        const p = f.properties || {};
        const site = String(p.name || '').split('/')[0];
        const pt = pointsBySite.get(site) || {};
        const merged = { ...pt, ...p, Referencia: pt.Referencia || p.Referencia || '' };
        if (!merged['Sistema afectable'] && pt['Sistema afectable']) merged['Sistema afectable'] = pt['Sistema afectable'];
        out.push({ id: (layer.id || 'layer') + ':' + (p.name || out.length) + ':' + out.length, layerId: layer.id, layerKind: layer.kind, name: p.name || '', site, kind: classify(merged, layer), props: merged, rings, bb: bboxOf(rings), center: centroid(rings) });
      }
    }
  }
  return out;
}

// Hazards within `buf` metres of the route, ordered by distance along route (s, metres).
export function routeHits(coords, hazards, buf = 15) {
  const pts = densify(coords, 8), res = new Map(), pad = buf / 100000 + 0.0005;
  for (const H of hazards) {
    const [x0, y0, x1, y1] = H.bb;
    if (H.pt) {
      let best = null; const pd = (H.radius + buf) / 100000 + 0.0002;
      for (const q of pts) { const p = q.p; if (Math.abs(p[0] - H.pt[0]) > pd * 1.1 || Math.abs(p[1] - H.pt[1]) > pd) continue; const d = hav(p, H.pt); if (d <= H.radius + buf && (!best || d < best.d)) best = { hazard: H, d: Math.max(0, d - H.radius), s: q.s, at: p }; }
      if (best) res.set(H.id, best);
      continue;
    }
    if (H.lines) { // linear hotspot: the route must run ALONG it (>= ~30 m within 9 m), not just cross over/under it
      let n = 0, best = null;
      for (const q of pts) {
        const p = q.p; if (p[0] < x0 - 0.0003 || p[0] > x1 + 0.0003 || p[1] < y0 - 0.0003 || p[1] > y1 + 0.0003) continue;
        let d = 1e9; for (const l of H.lines) for (let i = 0; i < l.length - 1; i++) d = Math.min(d, segDistM(p, l[i], l[i + 1]));
        if (d <= 9) { n++; if (!best || d < best.d) best = { hazard: H, d, s: q.s, at: p }; }
      }
      if (n >= 4 && best) res.set(H.id, best);
      continue;
    }
    for (const q of pts) {
      const p = q.p;
      if (p[0] < x0 - pad || p[0] > x1 + pad || p[1] < y0 - pad || p[1] > y1 + pad) continue;
      const d = distToRings(p, H.rings);
      if (d <= buf) { const o = res.get(H.id); if (!o || d < o.d) res.set(H.id, { hazard: H, d, s: q.s, at: p }); }
    }
  }
  return [...res.values()].sort((a, b) => a.s - b.s);
}
// Hazards near (not on) the route: for "you passed it safely" alerts.
export function routeNear(coords, hazards, maxM = 350) {
  return routeHits(coords, hazards, maxM);
}
export function hitWeight(hits) { return hits.reduce((w, h) => w + (WEIGHT[h.hazard.kind] || 1), 0); }

// Client-side detour search for the stub router: insert via-points perpendicular to the route next to each
// hazard cluster and keep the candidate with the lowest (hazard weight, extra length). Returns the best route.
export async function detour(from, to, hazards, routeVia, { maxIter = 4, offsets = [700, 1300, 2200], log = () => {} } = {}) {
  const score = r => hitWeight(r.hits) * 1e6 + r.distance_m + (r.uturns || 0) * 2500;
  const run = async vias => { const r = await routeVia([from, ...vias, to]); r.hits = routeHits(r.coordinates, hazards); r.vias = vias; return r; };
  let best = await run([]);
  const base = best;
  for (let it = 0; it < maxIter && best.hits.length; it++) {
    const h = best.hits[0];
    const pts = densify(best.coordinates, 20);
    const i = pts.findIndex(q => q.s >= h.s);
    const a = pts[Math.max(0, i - 15)].p, b = pts[Math.min(pts.length - 1, i + 15)].p;
    const k = Math.cos(h.at[1] * Math.PI / 180);
    let dx = (b[0] - a[0]) * k, dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    // insert the via where it belongs along the route
    const sOf = v => { let m = 1e12, s = 0; for (const q of pts) { const d = hav(q.p, v); if (d < m) { m = d; s = q.s; } } return s; };
    let cand = null;
    for (const off of offsets) for (const side of [1, -1]) {
      const nx = -dy * side, ny = dx * side;
      const via = [h.at[0] + nx * off / 111320 / k, h.at[1] + ny * off / 110540];
      const vias = [...best.vias, via].sort((u, v) => sOf(u) - sOf(v));
      try { const r = await run(vias); log(`via ${off}m side ${side}: w=${hitWeight(r.hits)} ${(r.distance_m / 1000).toFixed(1)}km`); if (!cand || score(r) < score(cand)) cand = r; } catch (e) { log('via failed ' + e.message); }
    }
    if (cand && score(cand) < score(best)) best = cand; else break;
  }
  best.base = base;
  return best;
}

// OSRM multi-waypoint call (public demo; same server the stub router uses).
export async function osrmVia(coords) {
  const u = `https://router.project-osrm.org/route/v1/driving/${coords.map(c => c[0].toFixed(6) + ',' + c[1].toFixed(6)).join(';')}?overview=full&geometries=geojson&steps=true&continue_straight=true`;
  const res = await fetch(u); if (!res.ok) throw new Error('OSRM ' + res.status);
  const j = await res.json(); if (j.code !== 'Ok') throw new Error('OSRM ' + j.code);
  const r = j.routes[0];
  const steps = r.legs.flatMap(l => l.steps).map(s => ({ instruction: [s.maneuver.type, s.maneuver.modifier, s.name].filter(Boolean).join(' '), type: s.maneuver.type, modifier: s.maneuver.modifier, name: s.name, distance_m: s.distance, location: s.maneuver.location }));
  const uturns = steps.filter(s => s.modifier === 'uturn').length;
  return { coordinates: r.geometry.coordinates, distance_m: r.distance, duration_s: r.duration, steps, uturns, engine: 'osrm-demo+via' };
}
