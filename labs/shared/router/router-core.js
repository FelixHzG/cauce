// cauce. router core — hazard-aware driving router for the ZMG (Guadalajara).
// Environment-agnostic: runs in a module Web Worker (default), on the main thread, or in Node 18+.
// Road data © OpenStreetMap contributors (ODbL 1.0). See README.md in this folder.
export const ENGINE_VERSION = '1.0.0';

const D2R = Math.PI / 180, RE = 6371008.8;
const LAT0 = 20.65, KX = Math.cos(LAT0 * D2R) * D2R * RE, KY = D2R * RE; // local metres per degree
const FL = { fwd: 1, bwd: 2, bridge: 4, tunnel: 8, roundabout: 16, toll: 32, unpaved: 64, cutting: 128, destination: 256, link: 512 };
const SIGNAL_S = 8;          // seconds added when passing a traffic signal node
const BLOCK_FALLBACK = 1000; // multiplier used for "blocked" edges when no fully clear route exists
// Default cost multipliers per hazard kind (applied to the hazard-covered fraction of an edge).
export const KIND_MULT = { observed: 20, modeled: 10, hotspot: 6, water: 50, 'terrain-index': 3, avoid: Infinity, custom: 1 };
export const HOTSPOT_MULT = { alta: 10, alto: 10, high: 10, media: 4, medio: 4, medium: 4, baja: 2, bajo: 2, low: 2 };
const hotspotLevel = p => String(p.confidence ?? p.riesgo ?? p.risk ?? '').trim().toLowerCase();
// blockCritical (default on in safe mode): observed "Zonas Criticas" and sites mentioning "desnivel" are blocked,
// OSM underpasses with confidence alta get this multiplier instead of HOTSPOT_MULT.alta.
export const CRITICAL_HOTSPOT_MULT = 50;
const DESNIVEL_RE = /desnivel/i, ZONA_CRITICA_RE = /zonas?\s+cr[ií]ticas?/i;
const mentionsDesnivel = p => { for (const v of Object.values(p || {})) if (typeof v === 'string' && DESNIVEL_RE.test(v)) return true; return false; };
function segsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (d === 0) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
const DEFAULT_RADIUS = { point: 40, line: 10 };
const SAMPLE_M = 8;          // edge sampling step for hazard coverage
const CLASSES_ES = { motorway: 'autopista', trunk: 'vía rápida', primary: 'avenida', secondary: 'avenida', tertiary: 'calle', residential: 'calle', service: 'calle de servicio' };

// ------------------------------------------------------------------ I/O helpers (browser, worker, node)
function labsRootOf(base) { const i = base.lastIndexOf('/labs/'); return i >= 0 ? base.slice(0, i + 6) : null; }
export function resolveUrl(u, base) {
  if (/^[a-z]+:/i.test(u)) return u;
  if (u.startsWith('/') && base.startsWith('file:')) {
    const root = labsRootOf(base);
    if (root && u.startsWith('/labs/')) return root + u.slice(6);
  }
  return new URL(u, base).href;
}
async function getBytes(url) {
  if (url.startsWith('file:')) { const fs = await import('node:fs/promises'); return new Uint8Array(await fs.readFile(new URL(url))); }
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}
async function getJSON(url) { return JSON.parse(new TextDecoder().decode(await getBytes(url))); }
async function gunzip(u8) {
  if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return u8; // already decoded by the HTTP layer
  if (typeof DecompressionStream !== 'undefined') {
    const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const zlib = await import('node:zlib'); return new Uint8Array(zlib.gunzipSync(u8));
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ------------------------------------------------------------------ small geometry helpers (local metres)
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px, ey = ay + t * dy - py; return [ex * ex + ey * ey, t];
}
function inRings(x, y, rings) { // even-odd over all rings (outer + holes), rings = [Float64Array xy...]
  let c = false;
  for (const r of rings) {
    for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}
// banded point-in-polygon for big polygons (segments bucketed in 40 m horizontal bands)
function buildBands(F) {
  let nv = 0; for (const pl of F.polys) for (const r of pl) nv += r.length / 2; if (nv < 64) return;
  const BH = 40, y0 = F.bbox[1], nb = Math.max(1, Math.ceil((F.bbox[3] - y0) / BH) + 1); const bands = Array.from({ length: nb }, () => []);
  for (const pl of F.polys) for (const r of pl) for (let i = 2; i < r.length; i += 2) {
    const a = Math.min(r[i - 1], r[i + 1]), b = Math.max(r[i - 1], r[i + 1]);
    for (let k = Math.max(0, Math.floor((a - y0) / BH)); k <= Math.min(nb - 1, Math.floor((b - y0) / BH)); k++) bands[k].push(r[i - 2], r[i - 1], r[i], r[i + 1]);
  }
  F.bands = bands; F.bandH = BH; F.bandY0 = y0;
}
function insideF(F, x, y) {
  if (!F.polys.length) return false;
  if (F.bands) {
    const k = Math.floor((y - F.bandY0) / F.bandH); const s = F.bands[k]; if (!s) return false; let c = false;
    for (let i = 0; i < s.length; i += 4) { const xi = s[i], yi = s[i + 1], xj = s[i + 2], yj = s[i + 3]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; }
    return c;
  }
  for (const pl of F.polys) if (inRings(x, y, pl)) return true; return false;
}
function ringsDist(x, y, rings) {
  let best = Infinity;
  for (const r of rings) for (let i = 2; i < r.length; i += 2) { const d = segDist2(x, y, r[i - 2], r[i - 1], r[i], r[i + 1])[0]; if (d < best) best = d; }
  return Math.sqrt(best);
}
function bearing(ax, ay, bx, by) { const b = Math.atan2(bx - ax, by - ay) / D2R; return (b + 360) % 360; }
const norm180 = a => { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; };
const r6 = v => Math.round(v * 1e6) / 1e6;
const CARD = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
const card = b => CARD[Math.round(b / 45) % 8];
export function shortName(s) {
  if (!s) return '';
  return s.replace(/^Avenida\s+/i, 'Av. ').replace(/^Calzada\s+/i, 'Calz. ').replace(/^(Boulevard|Bulevar|Blvd\.?)\s+/i, 'Blvd. ')
    .replace(/^Prolongación\s+/i, 'Prol. ').replace(/^Carretera\s+/i, 'Carr. ');
}

class Heap {
  constructor(n = 1 << 15) { this.k = new Float64Array(n); this.v = new Int32Array(n); this.n = 0; this.topKey = 0; }
  push(v, k) {
    if (this.n === this.k.length) { const K = new Float64Array(this.n * 2); K.set(this.k); this.k = K; const V = new Int32Array(this.n * 2); V.set(this.v); this.v = V; }
    const K = this.k, V = this.v; let i = this.n++;
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = k; V[i] = v;
  }
  pop() {
    const K = this.k, V = this.v, top = V[0]; this.topKey = K[0]; const n = --this.n;
    if (n > 0) {
      const k = K[n], v = V[n]; let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && K[c + 1] < K[c]) c++; if (K[c] >= k) break; K[i] = K[c]; V[i] = V[c]; i = c; }
      K[i] = k; V[i] = v;
    }
    return top;
  }
}

// ------------------------------------------------------------------ core
export async function createCore(opts = {}) {
  const base = opts.base;
  if (!base) throw new Error('createCore: base URL required');
  const t0 = now();
  // meta + binary fetched in parallel (binary name is fixed: data/graph.bin.gz)
  const [meta, gz] = await Promise.all([opts.meta || getJSON(resolveUrl(opts.metaUrl || 'data/graph.meta.json', base)), getBytes(resolveUrl(opts.graphUrl || 'data/graph.bin.gz', base))]);
  const tFetch = now();
  const raw = await gunzip(gz);
  const ab = (raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength) ? raw.buffer : raw.slice().buffer;
  const T = { Int32Array, Uint32Array, Float32Array, Uint8Array, Uint16Array, Int8Array };
  const S = {}; for (const s of meta.sections) S[s.name] = new T[s.type](ab, s.offset, s.count);
  const strings = meta.strings; const CLASSES = meta.classes;
  const N = meta.counts.nodes, E = meta.counts.edges;
  const from = S.edgeFrom, to = S.edgeTo, elen = S.edgeLen, espeed = S.edgeSpeed, eflags = S.edgeFlags, eclass = S.edgeClass, elayer = S.edgeLayer;
  const ename = S.edgeName, eref = S.edgeRef, edest = S.edgeDest, eway = S.edgeWay, gOff = S.geomOff, nflag = S.nodeFlags;
  // nodes (absolute degrees + local metres)
  const nlon = new Float64Array(N), nlat = new Float64Array(N), nx = new Float64Array(N), ny = new Float64Array(N);
  { let x = 0, y = 0; for (let i = 0; i < N; i++) { x += S.nodeLon[i]; y += S.nodeLat[i]; nlon[i] = x / 1e6; nlat[i] = y / 1e6; nx[i] = nlon[i] * KX; ny[i] = nlat[i] * KY; } }
  // interior geometry (absolute)
  const P = S.geomLon.length; const glon = new Float64Array(P), glat = new Float64Array(P);
  for (let e = 0; e < E; e++) {
    let x = Math.round(nlon[from[e]] * 1e6), y = Math.round(nlat[from[e]] * 1e6);
    for (let i = gOff[e]; i < gOff[e + 1]; i++) { x += S.geomLon[i]; y += S.geomLat[i]; glon[i] = x / 1e6; glat[i] = y / 1e6; }
  }
  // travel time + adjacency (CSR, outgoing arcs; arc payload = edge*2 + dir, dir 1 = traversed to->from)
  const baseTime = new Float32Array(E); let vmax = 0;
  for (let e = 0; e < E; e++) { const v = espeed[e] / 3.6; baseTime[e] = elen[e] / v; if (v > vmax) vmax = v; }
  const invV = 0.985 / vmax;
  const adjOff = new Uint32Array(N + 1), deg = new Uint16Array(N);
  for (let e = 0; e < E; e++) { if (eflags[e] & FL.fwd) adjOff[from[e] + 1]++; if (eflags[e] & FL.bwd) adjOff[to[e] + 1]++; deg[from[e]]++; deg[to[e]]++; }
  for (let i = 0; i < N; i++) adjOff[i + 1] += adjOff[i];
  const adjTo = new Uint32Array(adjOff[N]), adjEdge = new Uint32Array(adjOff[N]);
  { const fill = adjOff.slice(0, N); for (let e = 0; e < E; e++) { if (eflags[e] & FL.fwd) { const k = fill[from[e]]++; adjTo[k] = to[e]; adjEdge[k] = e * 2; } if (eflags[e] & FL.bwd) { const k = fill[to[e]]++; adjTo[k] = from[e]; adjEdge[k] = e * 2 + 1; } } }
  // edge local-metre polylines are generated on demand
  function edgeXY(e) {
    const n = gOff[e + 1] - gOff[e] + 2, out = new Float64Array(n * 2);
    out[0] = nx[from[e]]; out[1] = ny[from[e]];
    for (let i = gOff[e], j = 2; i < gOff[e + 1]; i++, j += 2) { out[j] = glon[i] * KX; out[j + 1] = glat[i] * KY; }
    out[n * 2 - 2] = nx[to[e]]; out[n * 2 - 1] = ny[to[e]]; return out;
  }
  function edgeLL(e) {
    const out = [[nlon[from[e]], nlat[from[e]]]];
    for (let i = gOff[e]; i < gOff[e + 1]; i++) out.push([glon[i], glat[i]]);
    out.push([nlon[to[e]], nlat[to[e]]]); return out;
  }
  // edge bboxes (local metres) + uniform grid over edges
  const ebb = new Float32Array(E * 4);
  const BB = meta.bbox, CS = 250; // grid cell metres
  const gx0 = BB[0] * KX, gy0 = BB[1] * KY, GW = Math.ceil((BB[2] - BB[0]) * KX / CS) + 1, GH = Math.ceil((BB[3] - BB[1]) * KY / CS) + 1;
  const cellOf = (x, y) => { const cx = Math.min(GW - 1, Math.max(0, Math.floor((x - gx0) / CS))), cy = Math.min(GH - 1, Math.max(0, Math.floor((y - gy0) / CS))); return [cx, cy]; };
  const gridOff = new Uint32Array(GW * GH + 1); let gridIdx;
  {
    const mark = new Int32Array(GW * GH).fill(-1);
    const visit = (e, cb) => {
      const xy = edgeXY(e); let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (let i = 0; i < xy.length; i += 2) { if (xy[i] < a) a = xy[i]; if (xy[i] > c) c = xy[i]; if (xy[i + 1] < b) b = xy[i + 1]; if (xy[i + 1] > d) d = xy[i + 1]; }
      ebb[e * 4] = a; ebb[e * 4 + 1] = b; ebb[e * 4 + 2] = c; ebb[e * 4 + 3] = d;
      for (let i = 2; i < xy.length; i += 2) {
        const [c0, r0] = cellOf(Math.min(xy[i - 2], xy[i]), Math.min(xy[i - 1], xy[i + 1])), [c1, r1] = cellOf(Math.max(xy[i - 2], xy[i]), Math.max(xy[i - 1], xy[i + 1]));
        for (let cx = c0; cx <= c1; cx++) for (let cy = r0; cy <= r1; cy++) { const k = cy * GW + cx; if (mark[k] !== e) { mark[k] = e; cb(k); } }
      }
    };
    for (let e = 0; e < E; e++) visit(e, k => gridOff[k + 1]++);
    for (let i = 0; i < GW * GH; i++) gridOff[i + 1] += gridOff[i];
    gridIdx = new Uint32Array(gridOff[GW * GH]); const fill = gridOff.slice(0, GW * GH); mark.fill(-1);
    for (let e = 0; e < E; e++) visit(e, k => { gridIdx[fill[k]++] = e; });
  }
  const eStamp = new Uint32Array(E); let eGen = 0;
  function edgesInBox(x0, y0, x1, y1, cb) { // local metres
    if (++eGen === 0xffffffff) { eStamp.fill(0); eGen = 1; }
    const [c0, r0] = cellOf(x0, y0), [c1, r1] = cellOf(x1, y1);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const k = cy * GW + cx;
      for (let i = gridOff[k]; i < gridOff[k + 1]; i++) {
        const e = gridIdx[i]; if (eStamp[e] === eGen) continue; eStamp[e] = eGen;
        if (ebb[e * 4] > x1 || ebb[e * 4 + 2] < x0 || ebb[e * 4 + 1] > y1 || ebb[e * 4 + 3] < y0) continue;
        cb(e);
      }
    }
  }

  // ---------------------------------------------------------------- snapping
  function nearest(ll, maxM = 2500) {
    const [lon, lat] = toLL(ll); const px = lon * KX, py = lat * KY;
    let best = null;
    for (let r = 60; r <= maxM * 2; r *= 2) {
      edgesInBox(px - r, py - r, px + r, py + r, e => {
        const xy = edgeXY(e); let acc = 0, bd = Infinity, bAlong = 0, tot = 0;
        for (let i = 2; i < xy.length; i += 2) {
          const sl = Math.hypot(xy[i] - xy[i - 2], xy[i + 1] - xy[i - 1]);
          const [d2, t] = segDist2(px, py, xy[i - 2], xy[i - 1], xy[i], xy[i + 1]);
          if (d2 < bd) { bd = d2; bAlong = acc + t * sl; }
          acc += sl;
        }
        tot = acc; const d = Math.sqrt(bd);
        // prefer surface streets slightly over motorways, bridges and tunnels when equally close
        const pen = ((eflags[e] & (FL.bridge | FL.tunnel)) || eclass[e] <= 1) ? 12 : 0;
        if (!best || d + pen < best.score) best = { e, t: tot ? bAlong / tot : 0, dist: d, score: d + pen };
      });
      if (best && best.dist <= r) break;
    }
    if (!best || best.dist > maxM) return null;
    const pt = pointOnEdge(best.e, best.t);
    return { e: best.e, t: best.t, dist: best.dist, x: pt[0] * KX, y: pt[1] * KY, location: [r6(pt[0]), r6(pt[1])], name: strings[ename[best.e]] || strings[eref[best.e]] || '' };
  }
  function pointOnEdge(e, t) { const s = sliceEdge(e, t, t); return s[0]; }
  function sliceEdge(e, ta, tb) { // lon/lat points from fraction ta to tb (tb < ta → reversed)
    const pts = edgeLL(e);
    if (ta === 0 && tb === 1) return pts;
    if (ta === 1 && tb === 0) return pts.reverse();
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot((pts[i][0] - pts[i - 1][0]) * KX, (pts[i][1] - pts[i - 1][1]) * KY));
    const L = cum[cum.length - 1];
    const at = d => { let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const s = cum[i] - cum[i - 1]; const t = s ? (d - cum[i - 1]) / s : 0; return [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])]; };
    const a = Math.min(ta, tb) * L, b = Math.max(ta, tb) * L; const out = [at(a)];
    for (let i = 0; i < pts.length; i++) if (cum[i] > a && cum[i] < b) out.push(pts[i]);
    if (b > a) out.push(at(b));
    return tb < ta ? out.reverse() : out;
  }
  function toLL(p) {
    if (Array.isArray(p)) return [+p[0], +p[1]];
    if (p && typeof p === 'object') return [+(p.lon ?? p.lng ?? p.longitude ?? p.x), +(p.lat ?? p.latitude ?? p.y)];
    throw new Error('punto inválido');
  }

  // ---------------------------------------------------------------- A*
  const dist = new Float64Array(N), prev = new Int32Array(N), stamp = new Uint32Array(N), closed = new Uint32Array(N); let gen = 0;
  const heap = new Heap();
  const sig = v => (nflag[v] & 1) ? SIGNAL_S : 0;
  function astar(src, dst, mult) {
    if (++gen === 0xffffffff) { stamp.fill(0); closed.fill(0); gen = 1; }
    heap.n = 0; const tx = dst.x, ty = dst.y;
    let best = Infinity, bestNode = -1, bestTail = 0, direct = null, settled = 0;
    const es = src.e, ed = dst.e, ws = baseTime[es] * mult[es], wd = baseTime[ed] * mult[ed];
    if (es === ed) {
      if ((eflags[es] & FL.fwd) && dst.t >= src.t) { const c = (dst.t - src.t) * ws; if (c < best) { best = c; direct = 0; } }
      if ((eflags[es] & FL.bwd) && dst.t <= src.t) { const c = (src.t - dst.t) * ws; if (c < best) { best = c; direct = 1; } }
    }
    const seed = (v, g) => { if (!(g < Infinity)) return; if (stamp[v] !== gen || g < dist[v]) { stamp[v] = gen; dist[v] = g; prev[v] = -1; heap.push(v, g + Math.hypot(nx[v] - tx, ny[v] - ty) * invV); } };
    if (eflags[es] & FL.fwd) seed(to[es], (1 - src.t) * ws + sig(to[es]));
    if (eflags[es] & FL.bwd) seed(from[es], src.t * ws + sig(from[es]));
    const tA = (eflags[ed] & FL.fwd) ? from[ed] : -1, tailA = dst.t * wd;
    const tB = (eflags[ed] & FL.bwd) ? to[ed] : -1, tailB = (1 - dst.t) * wd;
    while (heap.n) {
      const u = heap.pop(); if (heap.topKey >= best) break;
      if (closed[u] === gen) continue; closed[u] = gen; settled++;
      const gu = dist[u];
      if (u === tA && gu + tailA < best) { best = gu + tailA; bestNode = u; bestTail = 0; direct = null; }
      if (u === tB && gu + tailB < best) { best = gu + tailB; bestNode = u; bestTail = 1; direct = null; }
      for (let k = adjOff[u], kE = adjOff[u + 1]; k < kE; k++) {
        const e = adjEdge[k] >>> 1; const c = baseTime[e] * mult[e]; if (!(c < Infinity)) continue;
        const v = adjTo[k]; const nd = gu + c + sig(v);
        if (stamp[v] !== gen || nd < dist[v]) { stamp[v] = gen; dist[v] = nd; prev[v] = k; heap.push(v, nd + Math.hypot(nx[v] - tx, ny[v] - ty) * invV); }
      }
    }
    if (!(best < Infinity)) return null;
    // reconstruct as segments {e, dir, ta, tb}
    if (direct !== null) return { cost: best, settled, segs: [{ e: es, dir: direct, ta: src.t, tb: dst.t }] };
    const mid = []; let v = bestNode;
    while (prev[v] !== -1) { const k = prev[v]; const e = adjEdge[k] >>> 1, dir = adjEdge[k] & 1; mid.push({ e, dir, ta: dir ? 1 : 0, tb: dir ? 0 : 1 }); v = dir ? to[e] : from[e]; }
    mid.reverse();
    const first = (v === to[es] && (eflags[es] & FL.fwd)) ? { e: es, dir: 0, ta: src.t, tb: 1 } : { e: es, dir: 1, ta: src.t, tb: 0 };
    const last = bestTail === 0 ? { e: ed, dir: 0, ta: 0, tb: dst.t } : { e: ed, dir: 1, ta: 1, tb: dst.t };
    return { cost: best, settled, segs: [first, ...mid, last] };
  }

  // ---------------------------------------------------------------- hazards
  const hazardIndexUrl = resolveUrl(opts.hazardIndexUrl || '/labs/shared/hazard/index.json', base);
  let hazardIndex = { layers: [] }, indexLoadedAt = 0;
  const layers = new Map(); // id -> layer state
  async function loadIndex(force = false) {
    if (!force && now() - indexLoadedAt < 10000) return hazardIndex;
    try { hazardIndex = await getJSON(hazardIndexUrl); } catch (e) { hazardIndex = hazardIndex || { layers: [] }; hazardIndex.error = String(e.message || e); }
    indexLoadedAt = now();
    return hazardIndex;
  }
  function featureLabel(p, layerLabel) {
    return p.label || p.Referencia || p.referencia || p.name || p.nombre || p.title || layerLabel || '';
  }
  function featureMult(layer, p) {
    const rc = p.router_cost ?? p.routerCost;
    if (rc !== undefined && rc !== null) return rc === 'block' ? Infinity : Math.max(1, +rc || 1);
    const lr = layer.entry.router || {};
    if (lr.penalty !== undefined) return lr.penalty === 'block' ? Infinity : Math.max(1, +lr.penalty || 1);
    const kind = layer.kind;
    if (kind === 'hotspot') return HOTSPOT_MULT[hotspotLevel(p)] ?? KIND_MULT.hotspot;
    if (kind === 'modeled') {
      const d = +(p.depth_m ?? p.max_depth_m ?? p.depth ?? p.h_max ?? NaN);
      if (Number.isFinite(d)) return d < 0.05 ? 2 : d < 0.15 ? 5 : d < 0.3 ? 20 : Infinity;
    }
    return KIND_MULT[kind] ?? 4;
  }
  function buildFeatures(layer, fc) {
    const lr = layer.entry.router || {}; const feats = []; const polys = [];
    const list = fc.type === 'FeatureCollection' ? fc.features : fc.type === 'Feature' ? [fc] : [{ type: 'Feature', properties: {}, geometry: fc }];
    // name -> best label (e.g. IMEPLAN polygons get the street reference of the matching point)
    const nameLabel = new Map();
    for (const f of list) { const p = f.properties || {}; if (p.name && (p.Referencia || p.label)) nameLabel.set(p.name, p.label || p.Referencia); }
    // names of sites whose text (any feature with that name) mentions "desnivel"
    const desnivelNames = new Set(); for (const f of list) { const p = f.properties || {}; if (p.name && mentionsDesnivel(p)) desnivelNames.add(p.name); }
    const critOn = lr.critical !== false;
    list.forEach((f, i) => {
      const g = f && f.geometry; if (!g) return; const p = f.properties || {};
      const F = { i: feats.length, id: f.id ?? p.id ?? i, props: p, label: (p.name && nameLabel.get(p.name)) || featureLabel(p, layer.label), mult: featureMult(layer, p), wayId: +p.osm_way_id || 0 };
      const geoms = g.type === 'GeometryCollection' ? g.geometries : [g];
      F.polys = []; F.lines = []; F.pts = [];
      for (const gg of geoms) {
        const toXY = ring => { const a = new Float64Array(ring.length * 2); ring.forEach(([x, y], k) => { a[2 * k] = x * KX; a[2 * k + 1] = y * KY; }); return a; };
        if (gg.type === 'Polygon') F.polys.push(gg.coordinates.map(toXY));
        else if (gg.type === 'MultiPolygon') for (const pc of gg.coordinates) F.polys.push(pc.map(toXY));
        else if (gg.type === 'LineString') F.lines.push(toXY(gg.coordinates));
        else if (gg.type === 'MultiLineString') for (const lc of gg.coordinates) F.lines.push(toXY(lc));
        else if (gg.type === 'Point') F.pts.push([gg.coordinates[0] * KX, gg.coordinates[1] * KY]);
        else if (gg.type === 'MultiPoint') for (const c of gg.coordinates) F.pts.push([c[0] * KX, c[1] * KY]);
      }
      if (!F.polys.length && !F.lines.length && !F.pts.length) return;
      F.critical = null;
      if (critOn && (p.router_cost ?? p.routerCost) === undefined) {
        if (p.critical === true) F.critical = 'marcado';
        else if (layer.kind === 'observed' && ZONA_CRITICA_RE.test(p.category || '')) F.critical = 'zona-critica';
        else if (layer.kind === 'observed' && (mentionsDesnivel(p) || (p.name && desnivelNames.has(p.name)))) F.critical = 'paso-desnivel';
        else if (layer.kind === 'hotspot' && /^(alta|alto|high)$/.test(hotspotLevel(p))) F.critical = 'hotspot-alto';
      }
      F.critMult = F.critical ? (F.critical === 'hotspot-alto' ? CRITICAL_HOTSPOT_MULT : Infinity) : undefined;
      F.radius = F.polys.length ? 0 : F.lines.length ? (+p.radius_m || lr.lineRadius_m || lr.radius_m || DEFAULT_RADIUS.line) : (+p.radius_m || lr.pointRadius_m || lr.radius_m || DEFAULT_RADIUS.point);
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      const ext = (x, y) => { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; };
      for (const poly of F.polys) for (let k = 0; k < poly[0].length; k += 2) ext(poly[0][k], poly[0][k + 1]);
      for (const l of F.lines) for (let k = 0; k < l.length; k += 2) ext(l[k], l[k + 1]);
      for (const q of F.pts) ext(q[0], q[1]);
      F.bbox = [a, b, c, d];
      F.rep = F.pts.length ? [F.pts[0][0] / KX, F.pts[0][1] / KY] : p.marker ? p.marker : F.lines.length ? [F.lines[0][(F.lines[0].length >> 2) * 2] / KX, F.lines[0][(F.lines[0].length >> 2) * 2 + 1] / KY] : [(a + c) / 2 / KX, (b + d) / 2 / KY];
      F.rep = [r6(F.rep[0]), r6(F.rep[1])]; buildBands(F);
      feats.push(F); if (F.polys.length) polys.push(F);
    });
    // points that duplicate a polygon of the same layer (inside or within 30 m) do not add routing cost
    for (const F of feats) {
      if (F.polys.length || !F.pts.length) continue;
      const [x, y] = F.pts[0];
      for (const Q of polys) { if (x < Q.bbox[0] - 30 || x > Q.bbox[2] + 30 || y < Q.bbox[1] - 30 || y > Q.bbox[3] + 30) continue; if (insideF(Q, x, y) || Q.polys.some(pl => ringsDist(x, y, pl) < 30)) { F.dupOf = Q.i; break; } }
    }
    return feats;
  }
  function featDist(F, x, y) {
    let best = Infinity;
    if (insideF(F, x, y)) return 0; for (const pl of F.polys) { const d = ringsDist(x, y, pl); if (d < best) best = d; }
    for (const l of F.lines) for (let k = 2; k < l.length; k += 2) { const d = Math.sqrt(segDist2(x, y, l[k - 2], l[k - 1], l[k], l[k + 1])[0]); if (d < best) best = d; }
    for (const q of F.pts) { const d = Math.hypot(x - q[0], y - q[1]); if (d < best) best = d; }
    return best;
  }
  // feature grid for exposure queries
  function indexFeatures(layer) {
    const CSf = 500; const g = new Map();
    for (const F of layer.features) {
      const x0 = Math.floor(F.bbox[0] / CSf), x1 = Math.floor(F.bbox[2] / CSf), y0 = Math.floor(F.bbox[1] / CSf), y1 = Math.floor(F.bbox[3] / CSf);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 40000) { (layer.bigFeatures ||= []).push(F); continue; }
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = x * 1e6 + y; let a = g.get(k); if (!a) g.set(k, a = []); a.push(F); }
    }
    layer.fgrid = g; layer.fcs = CSf;
  }
  // which edges each feature touches, with the covered fraction of the edge
  function matchEdges(layer) {
    const hits = new Map(); const lr = layer.entry.router || {};
    const affectsBridges = !!lr.affectsBridges;
    for (const F of layer.features) {
      if (F.dupOf !== undefined) continue;
      const r = F.radius, r2 = r * r;
      edgesInBox(F.bbox[0] - r, F.bbox[1] - r, F.bbox[2] + r, F.bbox[3] + r, e => {
        if ((eflags[e] & FL.bridge) && !affectsBridges) return;
        if (F.wayId && eway[e] !== F.wayId) return;
        const xy = edgeXY(e); let L = 0; for (let i = 2; i < xy.length; i += 2) L += Math.hypot(xy[i] - xy[i - 2], xy[i + 1] - xy[i - 1]);
        const n = Math.max(2, Math.ceil(L / SAMPLE_M)); let hit = 0, i = 2, acc = 0, sl = Math.hypot(xy[2] - xy[0], xy[3] - xy[1]);
        for (let s = 0; s < n; s++) {
          const d = (s + 0.5) * L / n; while (i < xy.length - 2 && acc + sl < d) { acc += sl; i += 2; sl = Math.hypot(xy[i] - xy[i - 2], xy[i + 1] - xy[i - 1]); }
          const t = sl ? (d - acc) / sl : 0; const x = xy[i - 2] + t * (xy[i] - xy[i - 2]), y = xy[i - 1] + t * (xy[i + 1] - xy[i - 1]);
          if (x < F.bbox[0] - r || x > F.bbox[2] + r || y < F.bbox[1] - r || y > F.bbox[3] + r) continue;
          let inside = insideF(F, x, y);
          if (!inside && r > 0) {
            for (const l of F.lines) { for (let k = 2; k < l.length; k += 2) if (segDist2(x, y, l[k - 2], l[k - 1], l[k], l[k + 1])[0] <= r2) { inside = true; break; } if (inside) break; }
            if (!inside) for (const q of F.pts) if ((x - q[0]) ** 2 + (y - q[1]) ** 2 <= r2) { inside = true; break; }
          }
          if (inside) hit++;
        }
        if (!hit && F.critMult === Infinity && F.polys.length) { // thin critical polygon between samples: exact segment test
          let cross = false;
          for (let i2 = 2; i2 < xy.length && !cross; i2 += 2) for (const pl of F.polys) { for (const rg of pl) { for (let k = 2; k < rg.length; k += 2) if (segsCross(xy[i2 - 2], xy[i2 - 1], xy[i2], xy[i2 + 1], rg[k - 2], rg[k - 1], rg[k], rg[k + 1])) { cross = true; break; } if (cross) break; } if (cross) break; }
          if (cross) hit = 1;
        }
        if (hit) { let a = hits.get(e); if (!a) hits.set(e, a = []); a.push(F.i, hit / n); }
      });
    }
    layer.edgeHits = hits;
  }
  async function prepareLayer(id) {
    let layer = layers.get(id);
    if (layer && (layer.ready || layer.error)) return layer;
    if (layer && layer.promise) return layer.promise;
    const entry = (hazardIndex.layers || []).find(l => l.id === id);
    if (!entry) return null;
    layer = { id, entry, kind: entry.kind || 'custom', label: entry.label || id, ready: false };
    layers.set(id, layer);
    layer.promise = (async () => {
      const t = now();
      try {
        if (entry.router && entry.router.plugin) await preparePlugin(layer, resolveUrl(entry.router.plugin, hazardIndexUrl));
        else if (entry.type === 'geojson' || /\.geojson(\?|$)|\.json(\?|$)/.test(entry.url || '')) {
          const fc = await getJSON(resolveUrl(entry.url, hazardIndexUrl));
          layer.features = buildFeatures(layer, fc); indexFeatures(layer); matchEdges(layer);
        } else if (entry.type === 'raster-tiles') await prepareRaster(layer);
        else throw new Error('tipo de capa no soportado por el router: ' + entry.type);
        layer.ready = true;
      } catch (e) { layer.error = String(e.message || e); }
      layer.ms = Math.round(now() - t);
      return layer;
    })();
    return layer.promise;
  }
  // Raster hazard tiles (e.g. simulated depth). Entry fields: url|tiles[0] template, router:{zoom, encoding, scale, offset, thresholds:[[value,mult],...]}
  async function prepareRaster(layer) {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('raster-tiles necesita OffscreenCanvas (navegador)');
    const e = layer.entry, r = e.router || {}; const z = r.zoom ?? e.maxzoom ?? 13; const enc = r.encoding || e.encoding || 'terrarium';
    const tpl = (e.tiles && e.tiles[0]) || e.url; const b = e.bounds || meta.aoi;
    const thr = (r.thresholds || [[0.05, 1.5], [0.15, 3], [0.3, 10], [0.5, Infinity]]).map(([v, m]) => [+v, m === 'block' ? Infinity : +m]).sort((p, q) => p[0] - q[0]);
    const n2 = 2 ** z; const lx = lon => (lon + 180) / 360 * n2; const ly = lat => { const s = Math.sin(lat * D2R); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n2; };
    const x0 = Math.floor(lx(b[0])), x1 = Math.floor(lx(b[2])), y0 = Math.floor(ly(b[3])), y1 = Math.floor(ly(b[1]));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 600) throw new Error('demasiados mosaicos para el zoom ' + z);
    const tiles = new Map(); const cv = new OffscreenCanvas(256, 256); const cx = cv.getContext('2d', { willReadFrequently: true });
    const jobs = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
    let next = 0; await Promise.all(Array.from({ length: 6 }, async () => {
      while (next < jobs.length) {
        const [x, y] = jobs[next++];
        try {
          const u = resolveUrl(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y), hazardIndexUrl); const res = await fetch(u); if (!res.ok) continue;
          const bmp = await createImageBitmap(await res.blob()); cx.clearRect(0, 0, 256, 256); cx.drawImage(bmp, 0, 0, 256, 256); tiles.set(x * 1e6 + y, cx.getImageData(0, 0, 256, 256).data);
        } catch { /* missing tile = no data */ }
      }
    }));
    const val = (lon, lat) => {
      const fx = lx(lon), fy = ly(lat); const d = tiles.get(Math.floor(fx) * 1e6 + Math.floor(fy)); if (!d) return NaN;
      const px = Math.min(255, Math.floor((fx % 1) * 256)), py = Math.min(255, Math.floor((fy % 1) * 256)), o = (py * 256 + px) * 4;
      if (d[o + 3] === 0) return NaN; const R0 = d[o], G = d[o + 1], B = d[o + 2];
      const v = enc === 'terrarium' ? R0 * 256 + G + B / 256 - 32768 : enc === 'mapbox' ? -10000 + (R0 * 65536 + G * 256 + B) * 0.1 : enc === 'alpha' ? d[o + 3] / 255 : R0 / 255;
      return v * (r.scale ?? 1) + (r.offset ?? 0);
    };
    layer.sample = val; layer.thresholds = thr; layer.features = [{ i: 0, id: layer.id, label: layer.label, props: {}, mult: 1, polys: [], lines: [], pts: [], bbox: [0, 0, 0, 0], rep: null }];
    const hits = new Map(); const bx0 = b[0] * KX, by0 = b[1] * KY, bx1 = b[2] * KX, by1 = b[3] * KY;
    edgesInBox(bx0, by0, bx1, by1, ed => {
      if (eflags[ed] & FL.bridge) return;
      const xy = edgeXY(ed); const cnt = new Array(thr.length).fill(0); let n = 0;
      for (let i = 2; i < xy.length; i += 2) {
        const sl = Math.hypot(xy[i] - xy[i - 2], xy[i + 1] - xy[i - 1]); const k = Math.max(1, Math.ceil(sl / 10));
        for (let s = 0; s < k; s++) { const t = (s + 0.5) / k; const v = val((xy[i - 2] + t * (xy[i] - xy[i - 2])) / KX, (xy[i - 1] + t * (xy[i + 1] - xy[i - 1])) / KY); n++; if (!(v >= thr[0][0])) continue; for (let c = 0; c < thr.length; c++) if (v >= thr[c][0]) cnt[c]++; }
      }
      let m = 1; for (let c = 0; c < thr.length; c++) if (cnt[c]) m = Math.max(m, thr[c][1] === Infinity ? Infinity : 1 + (thr[c][1] - 1) * cnt[c] / n);
      if (m > 1) hits.set(ed, m);
    });
    layer.edgeMult = hits; layer.raster = true;
  }
  // Custom cost hooks: hazardCost(edge, ctx) -> multiplier (>=1) or Infinity. Source: function source text or module URL.
  const hookCache = new Map();
  function edgeInfo(e) {
    const g0 = gOff[e], g1 = gOff[e + 1]; const mi = g1 > g0 ? g0 + ((g1 - g0) >> 1) : -1;
    return {
      id: e, wayId: eway[e], name: strings[ename[e]], ref: strings[eref[e]], highway: CLASSES[eclass[e]], layer: elayer[e],
      bridge: !!(eflags[e] & FL.bridge), tunnel: !!(eflags[e] & FL.tunnel), oneway: (eflags[e] & 3) !== 3, length_m: elen[e], speed_kmh: espeed[e],
      from: [nlon[from[e]], nlat[from[e]]], to: [nlon[to[e]], nlat[to[e]]], mid: mi >= 0 ? [glon[mi], glat[mi]] : [(nlon[from[e]] + nlon[to[e]]) / 2, (nlat[from[e]] + nlat[to[e]]) / 2],
      get coords() { return edgeLL(e); }
    };
  }
  async function hookLayer(spec) {
    const key = typeof spec === 'string' ? spec : spec.module || spec.source;
    if (hookCache.has(key)) return hookCache.get(key);
    let fn;
    if (spec.module) { const m = await import(resolveUrl(spec.module, base)); fn = m.hazardCost || m.default; if (m.prepare) await m.prepare({ meta, edgeCount: E }); }
    else fn = new Function('return (' + (spec.source || spec) + ')')();
    if (typeof fn !== 'function') throw new Error('hazardCost no es una función');
    const hits = new Map();
    for (let e = 0; e < E; e++) { const m = +fn(edgeInfo(e)); if (m > 1 || m === Infinity) hits.set(e, m); }
    const layer = { id: spec.id || 'custom', kind: 'custom', label: spec.label || 'costo personalizado', entry: {}, ready: true, edgeMult: hits, features: [{ i: 0, id: spec.id || 'custom', label: spec.label || 'costo personalizado', props: {}, mult: 1 }], custom: true };
    hookCache.set(key, layer); if (hookCache.size > 8) hookCache.delete(hookCache.keys().next().value);
    return layer;
  }
  async function preparePlugin(layer, url) {
    const m = await import(url); const ctx = { meta, entry: layer.entry, edgeCount: E, edgeInfo, resolveUrl: u => resolveUrl(u, url) };
    const res = (m.prepare ? await m.prepare(ctx) : null) || {};
    const fn = res.hazardCost || m.hazardCost || m.default; if (typeof fn !== 'function') throw new Error('plugin sin hazardCost');
    const hits = new Map(); for (let e = 0; e < E; e++) { const v = +fn(edgeInfo(e), ctx); if (v > 1 || v === Infinity) hits.set(e, v); }
    layer.edgeMult = hits; layer.features = res.features ? buildFeatures(layer, res.features) : [{ i: 0, id: layer.id, label: layer.label, props: {}, mult: 1, polys: [], lines: [], pts: [], bbox: [0, 0, 0, 0], rep: null }];
    if (res.features) indexFeatures(layer);
  }
  // user "avoid" geometry (GeoJSON) — cached by content
  const avoidCache = new Map();
  function avoidLayer(avoid) {
    let fc = avoid;
    if (Array.isArray(avoid)) fc = { type: 'FeatureCollection', features: avoid.map(g => g.type === 'Feature' ? g : { type: 'Feature', properties: {}, geometry: g }) };
    const key = JSON.stringify(fc); let h = 0; for (let i = 0; i < key.length; i += 7) h = (h * 31 + key.charCodeAt(i)) | 0; const k = key.length + ':' + h;
    if (avoidCache.has(k)) return avoidCache.get(k);
    const layer = { id: 'avoid', kind: 'avoid', label: 'zona a evitar', entry: { router: {} }, ready: true };
    layer.features = buildFeatures(layer, fc); indexFeatures(layer); matchEdges(layer);
    avoidCache.set(k, layer); if (avoidCache.size > 6) avoidCache.delete(avoidCache.keys().next().value);
    return layer;
  }

  // per-query multiplier array
  const mult = new Float32Array(E).fill(1); let touched = [];
  function buildMult(active, penalties, blockValue, blockCritical) {
    for (const e of touched) mult[e] = 1; touched = [];
    const set = (e, m) => { if (m > mult[e]) { if (mult[e] === 1) touched.push(e); mult[e] = m; } };
    for (const L of active) {
      const ov = penalties && (penalties[L.id] ?? penalties[L.kind]);
      const ovm = ov === undefined || ov === null ? undefined : ov === 'block' ? Infinity : Math.max(1, +ov || 1);
      const scale = (m, frac) => m === Infinity ? (blockValue === Infinity ? Infinity : 1 + (blockValue - 1) * frac) : 1 + (m - 1) * frac;
      if (L.edgeMult) for (const [e, m0] of L.edgeMult) set(e, scale(ovm ?? m0, 1));
      if (L.edgeHits) for (const [e, arr] of L.edgeHits) for (let j = 0; j < arr.length; j += 2) { const F = L.features[arr[j]]; set(e, scale((blockCritical && F.critMult !== undefined) ? F.critMult : (ovm ?? F.mult), arr[j + 1])); }
    }
  }
  const ones = new Float32Array(E).fill(1);

  // ---------------------------------------------------------------- route assembly
  function assemble(res) {
    const coords = []; const segs = []; let dur = 0, distM = 0;
    for (let i = 0; i < res.segs.length; i++) {
      const s = res.segs[i]; const pts = sliceEdge(s.e, s.ta, s.tb); const frac = Math.abs(s.tb - s.ta);
      const c0 = Math.max(0, coords.length - 1);
      for (let k = (coords.length ? 1 : 0); k < pts.length; k++) coords.push(pts[k]);
      const len = elen[s.e] * frac; const d = baseTime[s.e] * frac + (i < res.segs.length - 1 ? sig(s.dir ? from[s.e] : to[s.e]) : 0);
      segs.push({ ...s, c0, c1: coords.length - 1, len, dur: d, node: s.dir ? from[s.e] : to[s.e] });
      dur += d; distM += len;
    }
    if (coords.length === 1) coords.push(coords[0].slice());
    const cum = [0]; for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + Math.hypot((coords[i][0] - coords[i - 1][0]) * KX, (coords[i][1] - coords[i - 1][1]) * KY));
    return { coords, segs, cum, duration: dur, distance: distM };
  }
  function pointAt(R, d) {
    const { coords, cum } = R; d = Math.max(0, Math.min(cum[cum.length - 1], d));
    let lo = 0, hi = cum.length - 1; while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
    const s = cum[hi] - cum[lo]; const t = s ? (d - cum[lo]) / s : 0;
    return [coords[lo][0] + t * (coords[hi][0] - coords[lo][0]), coords[lo][1] + t * (coords[hi][1] - coords[lo][1])];
  }
  const bear = (a, b) => bearing(a[0] * KX, a[1] * KY, b[0] * KX, b[1] * KY);

  // ---------------------------------------------------------------- Spanish turn-by-turn
  const ORD = n => n + '.ª';
  // normalised name ids: accents/case/"Av." prefixes do not create fake "continue" steps
  const normIdx = new Uint32Array(strings.length); { const m = new Map(); strings.forEach((x, i) => { const k = x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^(avenida|av\.?|calzada|calz\.?|boulevard|bulevar|blvd\.?|calle)\s+/, '').replace(/\s+/g, ' ').trim(); let j = m.get(k); if (j === undefined) { j = i; m.set(k, j); } normIdx[i] = j; }); }
  const destLabel = i => (strings[i] || '').split(';').map(x => x.trim()).filter(Boolean).slice(0, 2).join(' / ');
  function roadLabel(run) { const n = strings[run.name]; if (n) return shortName(n); const r = strings[run.ref]; return r || ''; }
  function makeSteps(R) {
    const { segs } = R; if (!segs.length) return [];
    // 1) runs of the same road
    const keyOf = s => { const n = ename[s.e], r = eref[s.e]; return (eflags[s.e] & FL.roundabout ? 'R' : '') + (n ? 'n' + normIdx[n] : r ? 'r' + normIdx[r] : 'c' + eclass[s.e]); };
    const runs = [];
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]; const k = keyOf(s); const last = runs[runs.length - 1];
      let split = !last || last.key !== k;
      if (!split && i > 0 && deg[segs[i - 1].node] >= 3) { // same road but a sharp turn at a junction
        const a0 = R.cum[s.c0]; const bi = bear(pointAt(R, a0 - 15), R.coords[s.c0]), bo = bear(R.coords[s.c0], pointAt(R, a0 + 15));
        if (Math.abs(norm180(bo - bi)) >= 60) split = true;
      }
      if (split) runs.push({ key: k, segs: [i], c0: s.c0, len: s.len, dur: s.dur, name: ename[s.e], ref: eref[s.e], cls: eclass[s.e], fl: eflags[s.e], dest: edest[s.e], absorbed: 0 });
      else { last.segs.push(i); last.len += s.len; last.dur += s.dur; if (!last.dest && edest[s.e]) last.dest = edest[s.e]; }
    }
    // 2) absorb tiny connectors (median crossings, junction stubs)
    const mergeInto = (dst, src, front) => { if (front) { dst.c0 = src.c0; dst.segs.unshift(...src.segs); } else dst.segs.push(...src.segs); dst.len += src.len; dst.dur += src.dur; };
    for (let changed = true; changed;) {
      changed = false;
      if (runs.length > 1 && runs[0].len < 30 && !(runs[0].fl & FL.roundabout)) { mergeInto(runs[1], runs[0], true); runs.shift(); changed = true; continue; }
      for (let i = 1; i < runs.length - 1; i++) {
        const r = runs[i];
        if ((r.fl & FL.link) && r.len < 400 && runs[i - 1].key === runs[i + 1].key && !(runs[i - 1].fl & FL.link)) { mergeInto(runs[i - 1], r); mergeInto(runs[i - 1], runs[i + 1]); runs.splice(i, 2); changed = true; break; }
        if (r.len >= 30 || (r.fl & FL.roundabout)) continue;
        const nxt = runs[i + 1], prv = runs[i - 1];
        if (prv.key === nxt.key && r.len < 30) { prv.segs.push(...r.segs, ...nxt.segs); prv.len += r.len + nxt.len; prv.dur += r.dur + nxt.dur; runs.splice(i, 2); changed = true; break; }
        if (!r.name) { nxt.c0 = r.c0; nxt.segs.unshift(...r.segs); nxt.absorbed += r.len; nxt.len += r.len; nxt.dur += r.dur; runs.splice(i, 1); changed = true; break; }
      }
    }
    // 3) maneuvers
    const steps = []; const total = R.cum[R.cum.length - 1];
    const push = (st, run) => { st.distance_m = run.len; st.duration_s = run.dur; steps.push(st); };
    const r0 = runs[0]; const b0 = bear(R.coords[0], pointAt(R, Math.min(total, 25)));
    const n0 = roadLabel(r0);
    const dep = { type: 'depart', modifier: '', instruction: (r0.fl & FL.roundabout) ? `Sal hacia el ${card(b0)} por la glorieta${n0 ? ' ' + n0 : ''}` : `Sal hacia el ${card(b0)}${n0 ? ' por ' + n0 : ''}`, name: strings[r0.name] || strings[r0.ref] || '', location: R.coords[0], bearing_after: Math.round(b0), along_m: 0 };
    push(dep, r0);
    let pendingRoundabout = (r0.fl & FL.roundabout) ? { run: r0, exits: countExits(R, r0, true) } : null;
    for (let i = 1; i < runs.length; i++) {
      const run = runs[i], prv = runs[i - 1]; const loc = R.coords[run.c0]; const a0 = R.cum[run.c0];
      const bi = bear(pointAt(R, a0 - 20), loc), bo = bear(loc, pointAt(R, a0 + Math.min(run.len, 20 + run.absorbed)));
      const ang = norm180(bo - bi); const side = ang > 0 ? 'derecha' : 'izquierda'; const nm = roadLabel(run);
      const base = { name: strings[run.name] || strings[run.ref] || '', location: [r6(loc[0]), r6(loc[1])], bearing_before: Math.round(bi), bearing_after: Math.round(bo), along_m: Math.round(a0) };
      if (run.fl & FL.roundabout) {
        // roundabout: merge with the exit road into one step
        const exits = countExits(R, run, false); const out = runs[i + 1];
        let outName = '', jName = i + 1; for (let j = i + 1, acc = 0; j < runs.length && acc < 250 && !outName; acc += runs[j].len, j++) { outName = roadLabel(runs[j]) || (runs[j].dest ? destLabel(runs[j].dest) : ''); jName = j; }
        const where = nm && /^(glorieta|rotonda)/i.test(nm) ? 'la ' + nm : nm && /glorieta|rotonda/i.test(nm) ? 'la glorieta ' + nm : 'la glorieta';
        const st = { ...base, type: 'roundabout', modifier: '', exit: exits, instruction: out ? `En ${where}, toma la ${ORD(exits)} salida${outName ? ' hacia ' + outName : ''}` : `Entra a ${where}`, name: out ? (strings[out.name] || strings[out.ref] || '') : base.name };
        const merged = { len: run.len, dur: run.dur }; const upto = out ? (outName ? jName : i + 1) : i;
        for (let j = i + 1; j <= upto; j++) { merged.len += runs[j].len; merged.dur += runs[j].dur; }
        if (outName && jName < runs.length) st.name = strings[runs[jName].name] || strings[runs[jName].ref] || st.name;
        push(st, merged); i = upto; continue;
      }
      if (pendingRoundabout && (prv.fl & FL.roundabout)) {
        push({ ...base, type: 'exit roundabout', modifier: '', exit: pendingRoundabout.exits, instruction: `Toma la ${ORD(pendingRoundabout.exits)} salida${nm ? ' hacia ' + nm : ''}` }, run);
        pendingRoundabout = null; continue;
      }
      const isLink = !!(run.fl & FL.link), wasLink = !!(prv.fl & FL.link); const majorPrev = prv.cls <= 3; const major = run.cls <= 3;
      const dest = destLabel(run.dest);
      let st;
      if (isLink && !wasLink) {
        const toward = dest ? ' hacia ' + dest : nm ? ' hacia ' + nm : '';
        st = { type: majorPrev ? 'off ramp' : 'on ramp', modifier: Math.abs(ang) < 15 ? 'straight' : (Math.abs(ang) < 60 ? 'slight ' : '') + (ang > 0 ? 'right' : 'left'), instruction: majorPrev ? `Toma la salida${Math.abs(ang) >= 10 ? ' a la ' + side : ''}${toward}` : `Toma la rampa${Math.abs(ang) >= 10 ? ' a la ' + side : ''}${toward}` };
      } else if (wasLink && !isLink && major) {
        st = { type: 'merge', modifier: ang > 0 ? 'slight right' : 'slight left', instruction: `Incorpórate a ${nm || 'la vía'}` };
      } else {
        const A = Math.abs(ang);
        if (A < 25) st = { type: 'continue', modifier: 'straight', instruction: nm ? `Continúa por ${nm}` : 'Continúa recto' };
        else if (A < 60) st = { type: 'turn', modifier: 'slight ' + (ang > 0 ? 'right' : 'left'), instruction: `Gira ligeramente a la ${side}${nm ? ' en ' + nm : ''}` };
        else if (A < 140) st = { type: 'turn', modifier: ang > 0 ? 'right' : 'left', instruction: `Gira a la ${side}${nm ? ' en ' + nm : ''}` };
        else if (A < 165) st = { type: 'turn', modifier: 'sharp ' + (ang > 0 ? 'right' : 'left'), instruction: `Gira bruscamente a la ${side}${nm ? ' en ' + nm : ''}` };
        else st = { type: 'uturn', modifier: 'uturn', instruction: `Da vuelta en U${nm ? ' en ' + nm : ''}` };
      }
      push({ ...base, ...st }, run);
    }
    steps.push({ type: 'arrive', modifier: '', instruction: 'Has llegado a tu destino', name: '', location: R.coords[R.coords.length - 1], distance_m: 0, duration_s: 0, along_m: Math.round(total) });
    for (const s of steps) { s.distance_m = Math.round(s.distance_m * 10) / 10; s.duration_s = Math.round(s.duration_s * 10) / 10; s.location = [r6(s.location[0]), r6(s.location[1])]; }
    return steps;
  }
  function countExits(R, run, fromStart) {
    // exits passed = allowed outgoing non-roundabout arcs at each roundabout node passed before leaving
    let exits = 0; const segIdx = run.segs;
    for (let j = 0; j < segIdx.length; j++) {
      const s = R.segs[segIdx[j]]; const v = s.node; const last = j === segIdx.length - 1;
      if (!(eflags[s.e] & FL.roundabout)) continue;
      let here = 0; for (let k = adjOff[v]; k < adjOff[v + 1]; k++) { const e = adjEdge[k] >>> 1; if (!(eflags[e] & FL.roundabout)) here++; }
      if (last) { exits += 1; break; }
      exits += here;
    }
    return Math.max(1, exits);
  }

  // ---------------------------------------------------------------- hazard bookkeeping on a route
  function hitsOn(R, active) {
    const set = new Map();
    for (const s of R.segs) for (const L of active) {
      if (L.edgeMult && L.edgeMult.has(s.e)) set.set(L.id + '\u0000' + 0, { L, F: L.features[0] });
      const arr = L.edgeHits && L.edgeHits.get(s.e); if (!arr) continue;
      for (let j = 0; j < arr.length; j += 2) { const F = L.features[arr[j]]; set.set(L.id + '\u0000' + F.i, { L, F }); }
    }
    return set;
  }
  function exposureOf(R, active, radius) {
    const out = new Map(); const { coords, cum } = R; const total = cum[cum.length - 1];
    const bridgeAt = d => { for (const s of R.segs) if (R.cum[s.c1] >= d) return !!(eflags[s.e] & FL.bridge); return false; };
    const n = Math.max(2, Math.ceil(total / 10));
    for (const L of active) {
      if (L.raster) { // contiguous stretches above the first threshold
        let run = null; const thr0 = L.thresholds[0][0];
        for (let s = 0; s <= n; s++) {
          const d = s * total / n; const p = pointAt(R, d); const v = L.sample(p[0], p[1]);
          if (v >= thr0) { if (!run) run = { along: d, max: v, loc: p }; else if (v > run.max) { run.max = v; run.loc = p; } }
          else if (run) { out.set(L.id + '#' + out.size, { layer: L.id, kind: L.kind, id: L.id + '#' + out.size, label: L.label, distance_m: 0, along_m: Math.round(run.along), location: [r6(run.loc[0]), r6(run.loc[1])], max_value: Math.round(run.max * 100) / 100 }); run = null; }
        }
        if (run) out.set(L.id + '#' + out.size, { layer: L.id, kind: L.kind, id: L.id + '#' + out.size, label: L.label, distance_m: 0, along_m: Math.round(run.along), location: [r6(run.loc[0]), r6(run.loc[1])], max_value: Math.round(run.max * 100) / 100 });
        continue;
      }
      if (!L.fgrid) continue;
      const cs = L.fcs;
      for (let s = 0; s <= n; s++) {
        const d = s * total / n; const p = pointAt(R, d); const x = p[0] * KX, y = p[1] * KY;
        const cands = new Set(L.bigFeatures || []);
        for (let gx = Math.floor((x - radius) / cs); gx <= Math.floor((x + radius) / cs); gx++) for (let gy = Math.floor((y - radius) / cs); gy <= Math.floor((y + radius) / cs); gy++) for (const F of L.fgrid.get(gx * 1e6 + gy) || []) cands.add(F);
        for (const F of cands) {
          if (x < F.bbox[0] - radius || x > F.bbox[2] + radius || y < F.bbox[1] - radius || y > F.bbox[3] + radius) continue;
          const dd = featDist(F, x, y); if (dd > radius) continue;
          const key = L.id + '\u0000' + (F.props.name ? 'n:' + F.props.name : 'i:' + F.i);
          const cur = out.get(key);
          if (!cur || dd < cur.distance_m - 0.01) out.set(key, { layer: L.id, kind: L.kind, id: F.id, label: F.label, distance_m: Math.round(dd * 10) / 10, along_m: Math.round(d), location: [r6(p[0]), r6(p[1])], feature_location: F.rep, on_bridge: dd === 0 ? bridgeAt(d) : false, ...(F.critical ? { critical: F.critical } : {}), properties: slimProps(F.props) });
        }
      }
    }
    return [...out.values()].sort((a, b) => a.along_m - b.along_m);
  }
  function slimProps(p) { const o = {}; let n = 0; for (const [k, v] of Object.entries(p || {})) { if (v === null || typeof v === 'object' || k === 'marker') continue; o[k] = v; if (++n >= 14) break; } return o; }
  const featRef = ({ L, F }, bc) => { const m = (bc && F.critMult !== undefined) ? F.critMult : F.mult; const o = { layer: L.id, kind: L.kind, id: F.id, label: F.label, location: F.rep, multiplier: m === Infinity ? 'block' : m, properties: slimProps(F.props) }; if (F.critical) o.critical = F.critical; return o; };

  // ---------------------------------------------------------------- public: route
  const osmDate = (meta.osm.replicationTimestamp || meta.created || '').slice(0, 10);
  const engine = `cauce-router/${ENGINE_VERSION} (OSM ${osmDate})`;
  function pack(R, steps, extra) {
    return { coordinates: R.coords.map(c => [r6(c[0]), r6(c[1])]), distance_m: Math.round(R.distance * 10) / 10, duration_s: Math.round(R.duration * 10) / 10, steps, ...extra };
  }
  async function route(a, b, o = {}) {
    const tq = now(); const warnings = [];
    const src = nearest(a, o.snapMaxM ?? 2500), dst = nearest(b, o.snapMaxM ?? 2500);
    if (!src || !dst) { const err = new Error(`Punto fuera de la red vial del área metropolitana (${!src ? 'origen' : 'destino'})`); err.code = 'OUT_OF_AREA'; throw err; }
    // hazard layers
    const ids = o.hazardIds === 'all' ? null : o.hazardIds;
    const hasAvoid = !!(o.avoid && ((o.avoid.features && o.avoid.features.length) || (Array.isArray(o.avoid) && o.avoid.length) || o.avoid.type === 'Feature' || o.avoid.coordinates));
    const mode = o.mode || ((o.hazardIds && (o.hazardIds === 'all' || o.hazardIds.length)) || hasAvoid || o.hazardCost ? 'safe' : 'fastest');
    let wantIds = ids || [];
    if (o.hazardIds === 'all' || (mode === 'safe' && !o.hazardIds && !hasAvoid && !o.hazardCost)) { await loadIndex(); wantIds = (hazardIndex.layers || []).filter(l => !(l.router && l.router.default === false)).map(l => l.id); }
    if (wantIds.some(id => !(hazardIndex.layers || []).find(l => l.id === id))) await loadIndex(true);
    const active = [], missing = [];
    for (const L of await Promise.all(wantIds.map(prepareLayer))) { if (L && L.ready) active.push(L); }
    for (const id of wantIds) { const L = layers.get(id); if (!L || !L.ready) missing.push({ id, error: L ? L.error : 'no está en hazard/index.json' }); }
    if (missing.length) warnings.push('Capas no disponibles: ' + missing.map(m => m.id).join(', '));
    if (hasAvoid) active.push(avoidLayer(o.avoid));
    if (o.hazardCost) active.push(await hookLayer(typeof o.hazardCost === 'string' ? (/^(https?:|\/|\.)/.test(o.hazardCost) ? { module: o.hazardCost } : { source: o.hazardCost }) : o.hazardCost));
    const radius = o.exposureRadius_m ?? 50;
    const blockCritical = mode === 'safe' && (o.blockCritical ?? (o.penalties && o.penalties.blockCritical) ?? true) !== false;
    const fr = v => featRef(v, blockCritical);
    // fastest
    const resN = astar(src, dst, ones);
    if (!resN) { const err = new Error('No se encontró ruta entre los puntos'); err.code = 'NO_ROUTE'; throw err; }
    const RN = assemble(resN);
    const wantSteps = o.steps !== false;
    let RS = RN, resS = resN, blocked = false;
    if (mode === 'safe' && active.length) {
      buildMult(active, o.penalties, Infinity, blockCritical);
      resS = astar(src, dst, mult);
      if (!resS) { buildMult(active, o.penalties, BLOCK_FALLBACK, blockCritical); resS = astar(src, dst, mult); blocked = true; warnings.push('No existe una ruta que evite por completo las zonas bloqueadas; se cruzan las de menor costo.'); }
      RS = assemble(resS);
    }
    const chosen = mode === 'safe' ? RS : RN;
    const hitsN = active.length ? hitsOn(RN, active) : new Map(), hitsS = (active.length && RS !== RN) ? hitsOn(RS, active) : hitsN;
    const avoided = mode === 'safe' ? [...hitsN.entries()].filter(([k]) => !hitsS.has(k)).map(([, v]) => fr(v)) : [];
    const crossed = [...(mode === 'safe' ? hitsS : hitsN).values()].map(fr);
    const exposure = active.length ? exposureOf(chosen, active, radius) : [];
    const out = pack(chosen, wantSteps ? makeSteps(chosen) : [], {
      avoided, crossed, exposure, engine, mode, cost_s: Math.round((mode === 'safe' ? resS.cost : resN.cost) * 10) / 10,
      warnings, blocked_fallback: blocked, block_critical: blockCritical,
      snapped: { from: { location: src.location, distance_m: Math.round(src.dist), name: src.name }, to: { location: dst.location, distance_m: Math.round(dst.dist), name: dst.name } },
      hazards: { used: active.map(L => L.id), missing },
    });
    if (o.compare) {
      const expN = active.length ? (chosen === RN ? exposure : exposureOf(RN, active, radius)) : [];
      const expS = active.length ? (chosen === RS ? exposure : exposureOf(RS, active, radius)) : [];
      out.normal = pack(RN, wantSteps ? (chosen === RN ? out.steps : makeSteps(RN)) : [], { exposure: expN, crossed: [...hitsN.values()].map(fr) });
      out.safe = pack(RS, wantSteps ? (chosen === RS ? out.steps : makeSteps(RS)) : [], { exposure: expS, crossed: [...hitsS.values()].map(fr), avoided: [...hitsN.entries()].filter(([k]) => !hitsS.has(k)).map(([, v]) => fr(v)) });
      out.comparison = {
        same_route: RN === RS || (RN.coords.length === RS.coords.length && Math.abs(RN.distance - RS.distance) < 1),
        extra_distance_m: Math.round(RS.distance - RN.distance), extra_duration_s: Math.round(RS.duration - RN.duration),
        avoided_count: out.safe.avoided.length, crossed_normal: hitsN.size, crossed_safe: hitsS.size, exposure_normal: expN.length, exposure_safe: expS.length
      };
    }
    out.timing_ms = Math.round(now() - tq); out.settled = resN.settled + (resS !== resN ? resS.settled : 0);
    return out;
  }

  async function hazards() {
    await loadIndex(true);
    return (hazardIndex.layers || []).map(l => { const L = layers.get(l.id); return { id: l.id, label: l.label, kind: l.kind, type: l.type, loaded: !!(L && L.ready), error: L ? L.error || null : null, features: L && L.features ? L.features.length : null, edges_affected: L ? (L.edgeHits ? L.edgeHits.size : L.edgeMult ? L.edgeMult.size : null) : null, critical: L && L.features ? L.features.filter(F => F.critical && F.dupOf === undefined).length : null, prepare_ms: L ? L.ms : null }; });
  }
  async function preload(ids) { await loadIndex(true); const list = ids || (hazardIndex.layers || []).map(l => l.id); await Promise.all(list.map(prepareLayer)); return hazards(); }
  await loadIndex(true);
  const info = {
    engine, version: ENGINE_VERSION, osm: meta.osm, aoi: meta.aoi, bbox: meta.bbox,
    graph: { nodes: N, edges: E, arcs: adjOff[N], signals: meta.counts.signals, classKm: meta.classKm, gzBytes: meta.binary.gzBytes }, load_ms: Math.round(now() - t0), fetch_ms: Math.round(tFetch - t0), build_ms: Math.round(now() - tFetch)
  };
  return {
    engine, info, route, hazards, preload,
    nearest: p => { const s = nearest(p); return s ? { location: s.location, distance_m: Math.round(s.dist), name: s.name, edge: s.e } : null; },
    edgeInfo, reloadHazards: async () => { layers.clear(); await loadIndex(true); return hazards(); }
  };
}
