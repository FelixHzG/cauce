// cauce. nav-neon — hazard indexing, route exposure and a provisional detour search.
// Runs in the browser and in Node (ES module, no dependencies).
// The detour search is only used while /labs/shared/router/router.js cannot avoid hazards itself
// (stub engine). It asks the same router for A→via→B legs and keeps the cheapest option.

export const LAT0 = 20.62;
export const KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
export const KY = 110540;

export const toXY = ([lon, lat]) => [lon * KX, lat * KY];
export const toLL = ([x, y]) => [x / KX, y / KY];
export const dist = (a, b) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);

export function cumulative(coords) {
  const c = [0];
  for (let i = 1; i < coords.length; i++) c.push(c[i - 1] + dist(coords[i - 1], coords[i]));
  return c;
}

// Remove consecutive duplicates and zero-length segments.
export function clean(coords) {
  const out = [];
  for (const p of coords) if (!out.length || dist(out[out.length - 1], p) > 0.3) out.push(p);
  return out;
}

function pointInRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const KIND_RANK = { underpass: 3, critical: 2, site: 1, modeled: 1 };

// Classify one hazard feature into the alert vocabulary used by the HUD.
export function classify(props, layer) {
  const text = [props.Motivo, props['Infraestructura expuesta'], props['Sistema afectable'], props.Referencia, props.Categoría].filter(Boolean).join(' ').toLowerCase();
  const underpass = /desnivel/.test(text);
  if (layer && layer.kind && layer.kind !== 'observed') return { kind: 'modeled', title: 'Agua modelada', underpass };
  if (props.category === 'Zonas Criticas') return underpass ? { kind: 'underpass', title: 'Paso a desnivel inundable', underpass } : { kind: 'critical', title: 'Zona crítica IMEPLAN', underpass };
  return underpass ? { kind: 'underpass', title: 'Paso a desnivel inundable', underpass } : { kind: 'site', title: 'Encharcamiento registrado', underpass };
}

// Build an index from GeoJSON hazard layers: [{layer, data}]. Points with the same base name
// (SI-GDL-014) contribute their street reference and height range to the polygons.
export function buildHazardIndex(sources) {
  const hazards = [];
  for (const { layer, data } of sources) {
    if (!data || !Array.isArray(data.features)) continue;
    const refs = new Map();
    for (const f of data.features) {
      if (f.geometry && f.geometry.type === 'Point' && f.properties && f.properties.name) refs.set(String(f.properties.name).split('/')[0], f.properties);
    }
    for (const f of data.features) {
      const g = f.geometry; if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
      if (!polys) continue;
      const p = f.properties || {};
      const base = String(p.name || '').split('/')[0];
      const ref = refs.get(base) || {};
      const rings = polys.map(poly => poly[0].map(toXY));
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, sx = 0, sy = 0, n = 0;
      for (const r of rings) for (const [x, y] of r) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); sx += x; sy += y; n++; }
      const cls = classify({ ...ref, ...p }, layer);
      const modeled = layer && layer.kind === 'modeled';
      const dmin = Number(p.depth_m_min), dmax = Number(p.depth_m_max);
      const depthText = modeled && (Number.isFinite(dmin) || Number.isFinite(dmax)) ? `${Number.isFinite(dmin) ? dmin.toFixed(1) : '?'}–${Number.isFinite(dmax) ? dmax.toFixed(1) : '?'} m modelados` : '';
      hazards.push({
        id: `${layer.id}:${f.id ?? p.name ?? hazards.length}`,
        layerId: layer.id, layerKind: layer.kind || 'observed',
        name: p.name || '', base,
        category: p.category || '', ...cls,
        reference: ref.Referencia || p.Referencia || (modeled ? (p.label || p.class || '') : ''),
        range: modeled ? '' : (ref['Rango de alturas de inundación (cm)'] || p['Rango de alturas de inundación'] || ''),
        depthText, scenario: p.scenario || '',
        reportedMax: p['Altura máxima reportada'] || '',
        motive: p.Motivo || '', exposed: p['Infraestructura expuesta'] || ref['Sistema afectable'] || '',
        rings, bbox: [minx, miny, maxx, maxy], centroid: toLL([sx / n, sy / n]), feature: f,
      });
    }
  }
  return hazards;
}

// Distance (m) from a point to a hazard polygon; 0 when inside.
export function hazardDistance(h, ll) {
  const [x, y] = toXY(ll);
  for (const r of h.rings) if (pointInRing(x, y, r)) return 0;
  let best = Infinity;
  for (const r of h.rings) for (let k = 0; k < r.length - 1; k++) best = Math.min(best, segDist(x, y, r[k][0], r[k][1], r[k + 1][0], r[k + 1][1]));
  return best;
}

// Which hazards a route touches (<= buffer m) or passes near (<= near m), with along-route distance.
export function exposure(coords, hazards, { buffer = 18, near = 260, step = 8 } = {}) {
  const xy = coords.map(toXY);
  const cum = cumulative(coords);
  // Densify to sample points every `step` m.
  const samples = [];
  for (let i = 0; i < xy.length - 1; i++) {
    const seg = cum[i + 1] - cum[i];
    const n = Math.max(1, Math.ceil(seg / step));
    for (let k = 0; k < n; k++) { const t = k / n; samples.push([xy[i][0] + (xy[i + 1][0] - xy[i][0]) * t, xy[i][1] + (xy[i + 1][1] - xy[i][1]) * t, cum[i] + seg * t]); }
  }
  if (xy.length) samples.push([...xy[xy.length - 1], cum[cum.length - 1]]);
  let rminx = Infinity, rminy = Infinity, rmaxx = -Infinity, rmaxy = -Infinity;
  for (const [x, y] of xy) { rminx = Math.min(rminx, x); rmaxx = Math.max(rmaxx, x); rminy = Math.min(rminy, y); rmaxy = Math.max(rmaxy, y); }
  const hits = [];
  for (const h of hazards) {
    const [a, b, c, d] = h.bbox;
    if (c < rminx - near || a > rmaxx + near || d < rminy - near || b > rmaxy + near) continue;
    let minD = Infinity, at = 0, insideLen = 0, firstIn = -1;
    for (const [x, y, s] of samples) {
      if (x < a - near || x > c + near || y < b - near || y > d + near) continue;
      let dd = Infinity, inside = false;
      for (const r of h.rings) if (pointInRing(x, y, r)) { inside = true; break; }
      if (inside) dd = 0; else for (const r of h.rings) for (let k = 0; k < r.length - 1; k++) { const v = segDist(x, y, r[k][0], r[k][1], r[k + 1][0], r[k + 1][1]); if (v < dd) dd = v; }
      if (dd <= buffer) { insideLen += step; if (firstIn < 0) firstIn = s; }
      if (dd < minD) { minD = dd; at = s; }
    }
    if (minD <= near) hits.push({ hazard: h, minDist: minD, at: firstIn >= 0 ? firstIn : at, closestAt: at, onRoute: minD <= buffer, insideLen });
  }
  hits.sort((p, q) => p.at - q.at);
  return hits;
}

export function exposurePenalty(hits) {
  let s = 0;
  for (const h of hits) if (h.onRoute) s += (KIND_RANK[h.hazard.kind] || 1) * 420 + Math.min(600, h.insideLen * 2);
  return s;
}

// Remove out-and-back spurs created when a via point sits off the through road.
export function trimSpurs(coords, maxLoop = 1600, tol = 14) {
  let c = clean(coords);
  for (let pass = 0; pass < 4; pass++) {
    const cum = cumulative(c);
    let cut = null;
    outer: for (let i = 0; i < c.length; i++) {
      for (let j = c.length - 1; j > i + 2; j--) {
        if (cum[j] - cum[i] > maxLoop) continue;
        if (dist(c[i], c[j]) < tol && cum[j] - cum[i] > 3 * tol) { cut = [i, j]; break outer; }
      }
    }
    if (!cut) break;
    c = c.slice(0, cut[0] + 1).concat(c.slice(cut[1] + 1));
  }
  return c;
}

export async function routeVia(routeFn, points, opts) {
  const legs = [];
  for (let i = 0; i < points.length - 1; i++) legs.push(await routeFn(points[i], points[i + 1], opts));
  if (legs.length === 1) return { ...legs[0], coordinates: clean(legs[0].coordinates), via: [] };
  let coords = [];
  for (const l of legs) coords = coords.concat(l.coordinates);
  const trimmed = trimSpurs(coords);
  const full = cumulative(coords).at(-1), kept = cumulative(trimmed).at(-1);
  const duration = legs.reduce((s, l) => s + l.duration_s, 0) * (kept / full);
  const steps = [];
  legs.forEach((l, k) => l.steps.forEach((st, j) => {
    if (k > 0 && j === 0) return; // depart of next leg
    if (k < legs.length - 1 && j === l.steps.length - 1) return; // arrive at via
    steps.push(st);
  }));
  return { coordinates: trimmed, distance_m: kept, duration_s: duration, steps, avoided: [], engine: legs[0].engine, via: points.slice(1, -1) };
}

// Greedy detour search: for each hazard cluster on the route, try via points perpendicular to the
// route (at the cluster's first and last hazard) at several offsets and keep the option with the
// lowest duration + exposure penalty. Repeats for the next remaining cluster.
export async function searchDetour(routeFn, from, to, hazards, { maxCalls = 40, offsets = [500, 900, 1400, 2100], maxSlowdown = 1.7, rounds = 4, log = () => {} } = {}) {
  let calls = 0;
  const call = async pts => { calls += pts.length - 1; return routeVia(routeFn, pts); };
  const base = await call([from, to]);
  const baseHits = exposure(base.coordinates, hazards);
  const evalRoute = r => { const hits = exposure(r.coordinates, hazards); return { r, hits, score: r.duration_s + exposurePenalty(hits) }; };
  let best = evalRoute(base); best.vias = [];
  const tried = new Set();
  log(`base ${Math.round(base.distance_m)} m ${Math.round(base.duration_s)} s penalty ${Math.round(best.score - base.duration_s)}`);
  for (let round = 0; round < rounds; round++) {
    const on = best.hits.filter(h => h.onRoute);
    if (!on.length || calls >= maxCalls) break;
    const coords = best.r.coordinates, cum = cumulative(coords);
    const first = on[0].at, cluster = on.filter(h => h.at - first < 1500);
    const anchors = [...new Set([first, cluster.at(-1).at])];
    let roundBest = null;
    for (const off of offsets) for (const anchor of anchors) for (const side of [1, -1]) {
      if (calls >= maxCalls) break;
      let i = cum.findIndex(c => c >= anchor); if (i < 1) i = 1;
      const j0 = cum.findIndex(c => c >= anchor - 60), j1 = cum.findIndex(c => c >= anchor + 60);
      const a = toXY(coords[Math.max(0, j0)]), b = toXY(coords[j1 < 0 ? coords.length - 1 : j1]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      const c0 = toXY(coords[i]);
      const via = toLL([c0[0] + nx * off * side, c0[1] + ny * off * side]);
      const key = via.map(v => v.toFixed(3)).join(',');
      if (tried.has(key)) continue; tried.add(key);
      const vias = [...best.vias, via].sort((p, q) => dist(from, p) - dist(from, q));
      try {
        const r = await call([from, ...vias, to]);
        if (r.duration_s > base.duration_s * maxSlowdown) continue;
        const e = evalRoute(r); e.vias = vias;
        log(`  r${round} via ${off * side} m → ${Math.round(r.distance_m)} m ${Math.round(r.duration_s)} s penalty ${Math.round(e.score - r.duration_s)}`);
        if (!roundBest || e.score < roundBest.score) roundBest = e;
      } catch (err) { log('  via failed ' + err.message); }
    }
    if (roundBest && roundBest.score < best.score - 30) best = roundBest; else break;
  }
  const safeIds = new Set(best.hits.filter(h => h.onRoute).map(h => h.hazard.id));
  const avoided = baseHits.filter(h => h.onRoute && !safeIds.has(h.hazard.id)).map(h => h.hazard);
  return { base, baseHits, safe: best.r, safeHits: best.hits, vias: best.vias, avoided, calls };
}
