// Isometric "diorama" renderer for the ZMG board (Canvas 2D, world = Web-Mercator metres around board origin).
import { INK } from './art.js';

export const THETA = 28 * Math.PI / 180, CT = Math.cos(THETA), ST = Math.sin(THETA);
export const TILT = 0.6, ZK = 0.8;
export const HT = 260;      // tile (urban AGEB) height above the ground, world units (toy exaggeration)
export const HG = 1100;     // diorama base thickness under the ground

const FREQ_VAL = [0, 0.12, 0.3, 0.5, 0.7, 0.9, 0, 0];

export function xform(cam, w, h, z, dpr = 1) {
  const s = cam.s * dpr;
  const a = s * CT, b = -s * TILT * ST, c = -s * ST, d = -s * TILT * CT;
  const e = w * dpr / 2 - (a * cam.x + c * cam.y) + (cam.ox || 0) * dpr;
  const f = h * dpr / 2 - (b * cam.x + d * cam.y) - s * ZK * (z - HT) + (cam.oy || 0) * dpr;
  return [a, b, c, d, e, f];
}
export function w2s(cam, w, h, X, Y, z = HT) { const [a, b, c, d, e, f] = xform(cam, w, h, z); return [a * X + c * Y + e, b * X + d * Y + f]; }
export function s2w(cam, w, h, px, py, z = HT) {
  const [a, b, c, d, e, f] = xform(cam, w, h, z); const det = a * d - b * c; const x = px - e, y = py - f;
  return [(d * x - c * y) / det, (-b * x + a * y) / det];
}
const wallVec = H => [-ST * ZK * H / TILT, -CT * ZK * H / TILT];

function ringArea(r) { let s = 0; for (let i = 0, n = r.length; i < n; i += 2) { const j = (i + 2) % n; s += r[i] * r[j + 1] - r[j] * r[i + 1]; } return s / 2; }
function orient(r, ccw) { const a = ringArea(r); if ((a > 0) === ccw) return r; const o = []; for (let i = r.length - 2; i >= 0; i -= 2) o.push(r[i], r[i + 1]); return o; }
function addRing(p, r) { p.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]); p.closePath(); }
function addWalls(pL, pR, r, v, keep = null, bottom = null) { // front-facing wall quads of an oriented ring (material on the left)
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n; const dx = r[j] - r[i], dy = r[j + 1] - r[i + 1];
    if (CT * dx - ST * dy <= 0) continue; // faces away
    const nx = dy, ny = -dx; const sx = CT * nx - ST * ny; // screen-x of outward normal
    if (keep && !keep(r[i], r[i + 1], r[j], r[j + 1], nx, ny)) continue;
    const p = sx > 0 ? pR : pL;
    p.moveTo(r[i], r[i + 1]); p.lineTo(r[j], r[j + 1]); p.lineTo(r[j] + v[0], r[j + 1] + v[1]); p.lineTo(r[i] + v[0], r[i + 1] + v[1]); p.closePath();
    if (bottom) { bottom.moveTo(r[i] + v[0], r[i + 1] + v[1]); bottom.lineTo(r[j] + v[0], r[j + 1] + v[1]); }
  }
}
const hash = (i) => { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };

export class Board {
  constructor(board) {
    this.B = board; const A = board.agebs; this.n = A.length;
    const v = wallVec(HT);
    this.top = []; this.rings = []; this.bbox = new Float64Array(this.n * 4);
    const all = new Path2D();
    for (let i = 0; i < this.n; i++) {
      const p = new Path2D(); const rs = []; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const poly of A[i].g) poly.forEach((r0, k) => {
        const r = orient(r0, k === 0); rs.push(r); addRing(p, r); addRing(all, r);
        if (k === 0) for (let q = 0; q < r.length; q += 2) { x0 = Math.min(x0, r[q]); y0 = Math.min(y0, r[q + 1]); x1 = Math.max(x1, r[q]); y1 = Math.max(y1, r[q + 1]); }
      });
      this.top.push(p); this.rings.push(rs); this.bbox.set([x0, y0, x1, y1], i * 4);
    }
    this.allTops = all;
    // ground: floating islands around the urban AGEBs (board.ground rings; fallback: rounded rectangle)
    let gRings = board.ground && board.ground.length ? board.ground : null;
    if (!gRings) { const [bx0, by0, bx1, by1] = board.meta.worldBounds; const M = 2600; gRings = [[bx0 - M, by0 - M, bx1 + M, by0 - M, bx1 + M, by1 + M, bx0 - M, by1 + M]]; }
    this.ground = new Path2D(); this.gWallL = new Path2D(); this.gWallR = new Path2D(); this.gWallL2 = new Path2D(); this.gWallR2 = new Path2D();
    this.gBottom = new Path2D();
    for (const r0 of gRings) { const g = orient(r0, true); addRing(this.ground, g); addWalls(this.gWallL, this.gWallR, g, wallVec(HG), null, this.gBottom); addWalls(this.gWallL2, this.gWallR2, g, wallVec(HG * 0.2)); }
    // water bodies (ground level) + roads (tile level)
    this.lakes = new Path2D(); for (const w of board.water) addRing(this.lakes, w.g);
    this.roads = board.roads.map(cls => { const p = new Path2D(); for (const l of cls) { p.moveTo(l[0], l[1]); for (let i = 2; i < l.length; i += 2) p.lineTo(l[i], l[i + 1]); } return p; });
    // hit grid
    this.cell = 1500; this.grid = new Map();
    for (let i = 0; i < this.n; i++) {
      const b = this.bbox.subarray(i * 4, i * 4 + 4);
      for (let gx = Math.floor(b[0] / this.cell); gx <= Math.floor(b[2] / this.cell); gx++) for (let gy = Math.floor(b[1] / this.cell); gy <= Math.floor(b[3] / this.cell); gy++) { const k = gx + ',' + gy; if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(i); }
    }
    // tile walls only where no other tile sits right outside the edge (boundary of the urban fabric)
    const wl = new Path2D(), wr = new Path2D(), wb = new Path2D();
    const keep = (ax, ay, bx, by, nx, ny) => { const L = Math.hypot(nx, ny) || 1; const o = 30 / L; for (const t of [0.25, 0.5, 0.75]) { const x = ax + (bx - ax) * t + nx * o, y = ay + (by - ay) * t + ny * o; if (this.hit(x, y) < 0) return true; } return false; };
    for (const rs of this.rings) for (const r of rs) addWalls(wl, wr, r, v, keep, wb);
    this.wallL = wl; this.wallR = wr; this.wallBottom = wb;
    this.buckets = null; this.bucketKey = '';
    this.trees = this.makeTrees();
    this.groundPattern = null;
  }
  hit(X, Y) {
    const list = this.grid.get(Math.floor(X / this.cell) + ',' + Math.floor(Y / this.cell)) || [];
    for (const i of list) {
      const b = this.bbox; if (X < b[i * 4] || X > b[i * 4 + 2] || Y < b[i * 4 + 1] || Y > b[i * 4 + 3]) continue;
      let ins = false; for (const r of this.rings[i]) for (let a = 0, n = r.length, c = n - 2; a < n; c = a, a += 2) { const yi = r[a + 1], yj = r[c + 1]; if ((yi > Y) !== (yj > Y) && X < (r[c] - r[a]) * (Y - yi) / (yj - yi) + r[a]) ins = !ins; }
      if (ins) return i;
    }
    return -1;
  }
  // tiny trees on green AGEBs, deterministic
  makeTrees() {
    const out = []; const A = this.B.agebs;
    for (let i = 0; i < this.n; i++) {
      const a = A[i]; const k = Math.min(9, Math.round(((a.ve || 0) / 100) * (a.a || 0.2) * 30)); if (k <= 0) continue;
      const [x0, y0, x1, y1] = this.bbox.subarray(i * 4, i * 4 + 4); let tries = 0, got = 0;
      while (got < k && tries++ < 40) {
        const x = x0 + (x1 - x0) * hash(i * 97 + tries * 13), y = y0 + (y1 - y0) * hash(i * 31 + tries * 7 + 5);
        if (this.hit(x, y) === i) { out.push([x, y, 0.75 + 0.5 * hash(i + tries * 101), i]); got++; }
      }
    }
    return out;
  }
  fitCam(w, h, pad = { t: 80, b: 140, l: 40, r: 40 }) {
    const [x0, y0, x1, y1] = this.B.meta.coreBounds || this.B.meta.worldBounds; const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [CT * (x - cx) - ST * (y - cy), -TILT * (ST * (x - cx) + CT * (y - cy))]);
    const sx = Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0])), sy = Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1]));
    const aw = Math.max(100, w - pad.l - pad.r), ah = Math.max(100, h - pad.t - pad.b);
    const s = Math.min(aw / sx, ah / (sy + ZK * HT)) * 1.0;
    return { x: cx, y: cy, s, oy: (pad.t - pad.b) / 2, ox: (pad.l - pad.r) / 2 };
  }
  colorBuckets(colors) { // colors: array of css strings per AGEB → Map(color → Path2D)
    const key = colors.join('|'); if (key === this.bucketKey) return this.buckets;
    const m = new Map(); for (let i = 0; i < this.n; i++) { const c = colors[i]; if (!m.has(c)) m.set(c, new Path2D()); m.get(c).addPath(this.top[i]); }
    this.buckets = m; this.bucketKey = key; return m;
  }
  // ------------------------------------------------------------------------------------------------ draw
  sky(ctx, W, H, dpr) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, H * dpr); g.addColorStop(0, '#fbf4e8'); g.addColorStop(1, '#efe4f6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W * dpr, H * dpr);
  }
  // everything that only changes with the plan / view mode (cacheable as a bitmap: pan/zoom are uniform scale + shift)
  drawStatic(ctx, W, H, cam, scene, dpr = 1) {
    const T0 = xform(cam, W, H, 0, dpr), TT = xform(cam, W, H, HT, dpr);
    const s = cam.s * dpr;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // floating islands
    ctx.setTransform(...T0);
    ctx.fillStyle = '#c99c6c'; ctx.fill(this.gWallL); ctx.fillStyle = '#a97c50'; ctx.fill(this.gWallR);
    ctx.fillStyle = '#93c977'; ctx.fill(this.gWallL2); ctx.fillStyle = '#78b05e'; ctx.fill(this.gWallR2);
    ctx.lineWidth = 2.6 * dpr / s; ctx.strokeStyle = INK; ctx.stroke(this.gBottom);
    ctx.fillStyle = '#b4dc93'; ctx.fill(this.ground);
    ctx.save(); ctx.clip(this.ground);
    ctx.fillStyle = '#74c3ec'; ctx.fill(this.lakes, 'evenodd');
    ctx.lineWidth = 1.4 * dpr / s; ctx.strokeStyle = '#3f93c4'; ctx.stroke(this.lakes); ctx.restore();
    ctx.lineWidth = 2.6 * dpr / s; ctx.strokeStyle = INK; ctx.stroke(this.ground);
    // tile walls (urban edge only) + bottom outline
    ctx.setTransform(...TT);
    ctx.fillStyle = '#efc995'; ctx.fill(this.wallL); ctx.fillStyle = '#d6a873'; ctx.fill(this.wallR);
    ctx.lineWidth = 1.5 * dpr / s; ctx.strokeStyle = 'rgba(59,51,85,.7)'; ctx.stroke(this.wallBottom);
    // tile tops
    for (const [c, p] of this.colorBuckets(scene.colors)) { ctx.fillStyle = c; ctx.fill(p, 'evenodd'); }
    // modeled water overlay (sim-drenaje data image, Web-Mercator px → world)
    const lb = this.B.meta.labels;
    if (scene.water && lb) {
      ctx.save(); ctx.globalAlpha = scene.waterAlpha ?? 1;
      ctx.transform((lb.world.x1 - lb.world.x0) / lb.width, 0, 0, (lb.world.y1 - lb.world.y0) / lb.height, lb.world.x0, lb.world.y0);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(scene.water, 0, 0);
      ctx.restore(); ctx.setTransform(...TT);
    }
    // roads (pre-clipped to the tiles)
    const rw = [70, 42, 30], rmin = [2.2, 1.4, 1.0], rc = ['#fffaf0', 'rgba(255,250,240,.92)', 'rgba(255,250,240,.75)'];
    const wid = k => Math.max(rw[k], rmin[k] * dpr / s);
    const show2 = s >= 0.045 * dpr;
    for (let k = 2; k >= 0; k--) { if (k === 2 && !show2) continue; ctx.strokeStyle = 'rgba(59,51,85,.28)'; ctx.lineWidth = wid(k) + 1.6 * dpr / s; ctx.stroke(this.roads[k]); }
    for (let k = 2; k >= 0; k--) { if (k === 2 && !show2) continue; ctx.strokeStyle = rc[k]; ctx.lineWidth = wid(k); ctx.stroke(this.roads[k]); }
    // grout lines between AGEBs
    ctx.lineWidth = Math.max(0.6, Math.min(1.6, s * 40)) * dpr / s; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.stroke(this.allTops);
    // trees (screen-space sprites, only when zoomed in)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (s > 0.06 * dpr) {
      const k = Math.min(1, (s / dpr - 0.06) / 0.05); const [a, b, c, d, e, f] = TT; const sz = Math.min(16, 3 + s / dpr * 60) * dpr;
      const Wd = ctx.canvas.width, Hd = ctx.canvas.height;
      const sh = new Path2D(), tr = new Path2D(), cr = new Path2D(), hl = new Path2D();
      for (const [x, y, sc] of this.trees) {
        const X = a * x + c * y + e, Y = b * x + d * y + f; if (X < -20 || Y < -20 || X > Wd + 20 || Y > Hd + 20) continue;
        const r = sz * 0.5 * sc;
        sh.ellipse(X, Y + r * 0.1, r * 0.9, r * 0.4, 0, 0, Math.PI * 2); sh.closePath();
        tr.rect(X - r * 0.12, Y - r * 0.9, r * 0.24, r * 0.9);
        cr.moveTo(X + r * 0.7, Y - r * 1.25); cr.arc(X, Y - r * 1.25, r * 0.7, 0, Math.PI * 2);
        hl.moveTo(X - r * 0.22 + r * 0.25, Y - r * 1.45); hl.arc(X - r * 0.22, Y - r * 1.45, r * 0.25, 0, Math.PI * 2);
      }
      ctx.globalAlpha = k;
      ctx.fillStyle = 'rgba(59,51,85,.18)'; ctx.fill(sh); ctx.fillStyle = '#8a6a4a'; ctx.fill(tr);
      ctx.fillStyle = '#76c26a'; ctx.fill(cr); ctx.strokeStyle = INK; ctx.lineWidth = 1.2 * dpr; ctx.stroke(cr); ctx.fillStyle = '#a3dd8a'; ctx.fill(hl);
      ctx.globalAlpha = 1;
    }
  }
  drawDynamic(ctx, W, H, cam, scene, dpr = 1) {
    const TT = xform(cam, W, H, HT, dpr); const s = cam.s * dpr;
    const lb = this.B.meta.labels;
    if (scene.waterDiff && lb && scene.waterDiffAlpha > 0.003) {
      ctx.save(); ctx.setTransform(...TT); ctx.globalAlpha = (scene.waterAlpha ?? 1) * scene.waterDiffAlpha;
      ctx.transform((lb.world.x1 - lb.world.x0) / lb.width, 0, 0, (lb.world.y1 - lb.world.y0) / lb.height, lb.world.x0, lb.world.y0);
      ctx.imageSmoothingQuality = 'low'; ctx.drawImage(scene.waterDiff, 0, 0); ctx.restore();
    }
    for (const hl of scene.highlights || []) {
      const lift = hl.lift || 0; const Tl = xform(cam, W, H, HT, dpr); Tl[5] -= lift * dpr;
      if (lift > 0) { // own walls
        ctx.setTransform(...Tl); const pL = new Path2D(), pR = new Path2D(); const v = wallVec(HT * 0.25 + lift / s / ZK * dpr);
        for (const r of this.rings[hl.i]) addWalls(pL, pR, r, v);
        ctx.fillStyle = '#efc995'; ctx.fill(pL); ctx.fillStyle = '#d6a873'; ctx.fill(pR);
        ctx.lineWidth = 1.6 * dpr / s; ctx.strokeStyle = INK; ctx.stroke(pL); ctx.stroke(pR);
        if (hl.color) { ctx.fillStyle = hl.color; ctx.fill(this.top[hl.i], 'evenodd'); }
      }
      ctx.setTransform(...Tl);
      if (hl.fill) { ctx.fillStyle = hl.fill; ctx.fill(this.top[hl.i], 'evenodd'); }
      if (hl.halo) { ctx.setLineDash([]); ctx.lineWidth = ((hl.width || 2.4) + 3) * dpr / s; ctx.strokeStyle = hl.halo; ctx.stroke(this.top[hl.i]); }
      ctx.lineWidth = (hl.width || 2.4) * dpr / s; ctx.strokeStyle = hl.stroke || INK; ctx.setLineDash(hl.dash ? hl.dash.map(d => d * dpr / s) : []);
      ctx.stroke(this.top[hl.i]); ctx.setLineDash([]);
    }
    if (scene.ring) { // vaso reach preview (circle on the tile plane)
      const { X, Y, R, alpha } = scene.ring; ctx.setTransform(...TT);
      ctx.beginPath(); ctx.arc(X, Y, R, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(110,214,168,${0.26 * alpha})`; ctx.fill();
      ctx.setLineDash([10, 7].map(d => d * dpr / s)); ctx.lineWidth = 3 * dpr / s; ctx.strokeStyle = `rgba(30,130,95,${0.95 * alpha})`; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (scene.overlay) scene.overlay(ctx, (X, Y, z = HT) => { const [a, b, c, d, e, f] = xform(cam, W, H, z, dpr); return [a * X + c * Y + e, b * X + d * Y + f]; }, s);
  }
  draw(ctx, W, H, cam, scene, dpr = 1) { this.sky(ctx, W, H, dpr); this.drawStatic(ctx, W, H, cam, scene, dpr); this.drawDynamic(ctx, W, H, cam, scene, dpr); }
}

// ------------------------------------------------------------------------------------------------ modeled water layer
// freqV: Uint32 packed frequency classes per capacity (sim-drenaje freq-by-cap.png), lab: Uint16 AGEB labels (index+1)
export class Water {
  constructor(img, n) {
    const { freqV, lab, W, H } = img; this.W = W; this.H = H; this.n = n; this.freqV = freqV;
    const cnt = new Uint32Array(n + 1); for (let p = 0; p < W * H; p++) if (lab[p]) cnt[lab[p]]++;
    this.off = new Uint32Array(n + 1); for (let i = 0; i < n; i++) this.off[i + 1] = this.off[i] + cnt[i + 1];
    this.px = new Uint32Array(this.off[n]); const fill = this.off.slice(0, n);
    this.bb = new Int32Array(n * 4).fill(-1);
    for (let p = 0; p < W * H; p++) { const L = lab[p]; if (!L) continue; const i = L - 1; this.px[fill[i]++] = p; const x = p % W, y = (p / W) | 0; const b = i * 4; if (this.bb[b] < 0) { this.bb[b] = x; this.bb[b + 1] = y; this.bb[b + 2] = x; this.bb[b + 3] = y; } else { if (x < this.bb[b]) this.bb[b] = x; if (x > this.bb[b + 2]) this.bb[b + 2] = x; if (y < this.bb[b + 1]) this.bb[b + 1] = y; if (y > this.bb[b + 3]) this.bb[b + 3] = y; } }
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.diff = document.createElement('canvas'); this.diff.width = W; this.diff.height = H;
    this.ctx = this.canvas.getContext('2d'); this.dctx = this.diff.getContext('2d');
    this.img = this.ctx.createImageData(W, H); this.dimg = this.dctx.createImageData(W, H);
    this.diffBox = null;
    // colour LUT by frequency (0..1, 64 steps): light aqua → deep blue
    this.lut = new Uint8Array(65 * 4);
    for (let k = 0; k <= 64; k++) { const f = k / 64; const a = f < 0.08 ? 0 : Math.min(0.92, 0.3 + 0.68 * f);
      const c0 = [110, 200, 242], c1 = [28, 112, 198]; const t = Math.min(1, f * 1.1);
      this.lut.set([c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, a * 255], k * 4); }
  }
  // C: capacity per AGEB (mm/h), r: remaining-ratio per AGEB after storage (0..1); which: list of AGEB indices or null = all
  paint(C, r, which = null, withDiff = false) {
    const d = this.img.data, dd = this.dimg.data, V = this.freqV, lut = this.lut; const list = which || Array.from({ length: this.n }, (_, i) => i);
    let box = null;
    if (withDiff && this.diffBox) { const [x0, y0, x1, y1] = this.diffBox; for (let y = y0; y <= y1; y++) dd.fill(0, (y * this.W + x0) * 4, (y * this.W + x1 + 1) * 4); this.dctx.putImageData(this.dimg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1); this.diffBox = null; }
    for (const i of list) {
      const c = Math.max(0, Math.min(60, C[i])), k0 = Math.min(5, Math.floor(c / 10)), fr = (c - k0 * 10) / 10, sh0 = 3 * k0, sh1 = 3 * (k0 + 1), rr = Math.max(0, Math.min(1, r[i]));
      for (let q = this.off[i]; q < this.off[i + 1]; q++) {
        const p = this.px[q], v = V[p], c0 = (v >> sh0) & 7, c1 = (v >> sh1) & 7; const o = p * 4;
        let R, G, B, A;
        if (c0 === 7) { R = 124; G = 200; B = 238; A = 255; }
        else { const f = (FREQ_VAL[c0] * (1 - fr) + FREQ_VAL[c1] * fr) * (0.35 + 0.65 * rr); const L = Math.round(Math.min(1, f) * 64) * 4; const thin = rr < 1 ? (hash(p) < rr * 1.15 ? 1 : 0.35) : 1;
          R = lut[L]; G = lut[L + 1]; B = lut[L + 2]; A = lut[L + 3] * thin; }
        if (withDiff) { const da = d[o + 3] - A; if (da > 4) { dd[o] = d[o]; dd[o + 1] = d[o + 1]; dd[o + 2] = d[o + 2]; dd[o + 3] = da; } }
        d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = A;
      }
      const b = i * 4; if (this.bb[b] < 0) continue;
      box = box ? [Math.min(box[0], this.bb[b]), Math.min(box[1], this.bb[b + 1]), Math.max(box[2], this.bb[b + 2]), Math.max(box[3], this.bb[b + 3])] : [this.bb[b], this.bb[b + 1], this.bb[b + 2], this.bb[b + 3]];
    }
    if (!box) return;
    const [x0, y0, x1, y1] = which ? box : [0, 0, this.W - 1, this.H - 1];
    this.ctx.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    if (withDiff) { this.dctx.putImageData(this.dimg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1); this.diffBox = [x0, y0, x1, y1]; }
  }
}
