// Paper + risograph texture kit for cauce. nav-papel. Everything is generated procedurally with a seeded PRNG
// so frames are deterministic (no image downloads, no Math.random).

export const INK = {
  pink: '#FF48B0',      // riso Fluorescent Pink
  teal: '#00838A',      // riso Teal
  black: '#2B2420',     // warm black
  paper: '#F1E7D2',     // base sheet (cream)
  sheet: '#FFFCF4',     // white paper for cut pieces
  blue: '#2F6CD8',      // flood: blue construction paper
  blueDeep: '#1A47AE',
  blueLight: '#86ACEF',
};

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; }

// Paper fibre: speckles and short curved fibres, slightly lighter and darker than the base.
function fibres(ctx, w, h, seed, n, alpha) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, len = 3 + r() * 14, ang = r() * Math.PI * 2, bend = (r() - .5) * 6;
    const light = r() < .55;
    ctx.strokeStyle = light ? `rgba(255,255,250,${alpha * (0.6 + r())})` : `rgba(90,70,50,${alpha * 0.55 * (0.5 + r())})`;
    ctx.lineWidth = .5 + r() * .9;
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
      ctx.beginPath(); ctx.moveTo(x + dx, y + dy);
      ctx.quadraticCurveTo(x + dx + Math.cos(ang) * len / 2 + bend, y + dy + Math.sin(ang) * len / 2 - bend, x + dx + Math.cos(ang) * len, y + dy + Math.sin(ang) * len);
      ctx.stroke();
    }
  }
  for (let i = 0; i < n * 3; i++) {
    const x = r() * w, y = r() * h; ctx.fillStyle = r() < .5 ? `rgba(80,60,40,${alpha * .5})` : `rgba(255,255,255,${alpha})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

export function paperImage(size, base, seed = 7, density = 1) {
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  // low-frequency mottling
  const r = rng(seed + 1);
  for (let i = 0; i < 40; i++) {
    const x = r() * size, y = r() * size, rad = 10 + r() * 40;
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      const dark = r() < .5;
      g.addColorStop(0, dark ? 'rgba(120,95,60,0.035)' : 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    }
  }
  fibres(ctx, size, size, seed, Math.round(220 * density), .22);
  return ctx.getImageData(0, 0, size, size);
}

// Halftone dots on a 45° lattice (riso screen). size must be a multiple of spacing.
export function halftoneImage(size, { bg = null, ink, spacing = 6, radius = 1.4, bgFibres = 0, seed = 3, jitter = .25, alpha = 1 }) {
  const [c, ctx] = canvas(size, size);
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size); if (bgFibres) fibres(ctx, size, size, seed, bgFibres, .18); }
  const base = ctx.getImageData(0, 0, size, size); const d = base.data; const [ir, ig, ib] = hex(ink);
  const r = rng(seed + 11); const rad = [];
  const n = size / spacing; for (let i = 0; i < n * n * 2; i++) rad.push(radius * (1 - jitter / 2 + r() * jitter));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // two interleaved square lattices = 45° screen
    let best = 1e9, bi = 0;
    for (let L = 0; L < 2; L++) {
      const ox = L * spacing / 2, oy = L * spacing / 2;
      const gx = Math.round((x + .5 - ox) / spacing), gy = Math.round((y + .5 - oy) / spacing);
      const dx = x + .5 - (gx * spacing + ox), dy = y + .5 - (gy * spacing + oy); const dd = Math.hypot(dx, dy);
      if (dd < best) { best = dd; bi = (((gx % n) + n) % n) + (((gy % n) + n) % n) * n + L * n * n; }
    }
    const a = smooth(rad[bi] + .6, rad[bi] - .6, best) * alpha;
    if (a <= 0) continue; const k = (y * size + x) * 4;
    if (bg) { d[k] = d[k] * (1 - a) + ir * a; d[k + 1] = d[k + 1] * (1 - a) + ig * a; d[k + 2] = d[k + 2] * (1 - a) + ib * a; }
    else { d[k] = ir; d[k + 1] = ig; d[k + 2] = ib; d[k + 3] = Math.max(d[k + 3], a * 255); }
  }
  return base;
}

// Diagonal hatch (used for modeled / exploratory water: ink, not paper).
export function hatchImage(size, { ink, spacing = 8, width = 1.6, bg = null, alpha = 1, dir = 1 }) {
  const [c, ctx] = canvas(size, size); if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size); }
  const img = ctx.getImageData(0, 0, size, size); const d = img.data; const [ir, ig, ib] = hex(ink);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = ((dir > 0 ? x + y : x - y) % spacing + spacing) % spacing; const dist = Math.min(u, spacing - u) / Math.SQRT2 * 1.0;
    const a = smooth(width / 2 + .5, width / 2 - .5, dist) * alpha; if (a <= 0) continue; const k = (y * size + x) * 4;
    if (bg) { d[k] = d[k] * (1 - a) + ir * a; d[k + 1] = d[k + 1] * (1 - a) + ig * a; d[k + 2] = d[k + 2] * (1 - a) + ib * a; }
    else { d[k] = ir; d[k + 1] = ig; d[k + 2] = ib; d[k + 3] = Math.max(d[k + 3], a * 255); }
  }
  return img;
}

// Transparent grain overlay for the whole screen (multiplied over the map and UI).
export function grainDataURL(size = 220, seed = 21) {
  const [c, ctx] = canvas(size, size); fibres(ctx, size, size, seed, 160, .35);
  const r = rng(seed + 5); const img = ctx.getImageData(0, 0, size, size); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { if (r() < .08) { const v = 120 + r() * 80; d[i] = v; d[i + 1] = v * .92; d[i + 2] = v * .8; d[i + 3] = Math.max(d[i + 3], 14 + r() * 22); } }
  ctx.putImageData(img, 0, 0); return c.toDataURL('image/png');
}

// Halftone dot tile as data URL (used in CSS for riso accents).
export function halftoneDataURL(ink, spacing = 6, radius = 1.3, alpha = 1) {
  const img = halftoneImage(spacing * 8, { ink, spacing, radius, alpha, jitter: .2 });
  const [c, ctx] = canvas(img.width, img.height); ctx.putImageData(img, 0, 0); return c.toDataURL('image/png');
}

export function patternSet() {
  return {
    'paper': paperImage(256, INK.paper, 7, 1.2),
    'park': halftoneImage(240, { bg: '#D9EBDD', ink: INK.teal, spacing: 6, radius: 1.0, bgFibres: 90, seed: 4, alpha: .6 }),
    'wood': halftoneImage(240, { bg: '#CDE4D3', ink: INK.teal, spacing: 6, radius: 1.2, bgFibres: 90, seed: 5, alpha: .7 }),
    'water': halftoneImage(240, { bg: '#7CC3C0', ink: INK.teal, spacing: 5, radius: 1.6, bgFibres: 60, seed: 6, alpha: .9 }),
    'flood-sitio': halftoneImage(240, { bg: INK.blueLight, ink: INK.blue, spacing: 6, radius: 1.5, bgFibres: 120, seed: 8, alpha: .95 }),
    'flood-critica': halftoneImage(240, { bg: INK.blue, ink: INK.blueDeep, spacing: 5, radius: 1.5, bgFibres: 120, seed: 9, alpha: 1 }),
    'flood-desnivel': hatchImage(240, { bg: INK.blueDeep, ink: '#0E2A73', spacing: 8, width: 2.2, alpha: .9 }),
    'modeled': hatchImage(240, { ink: INK.teal, spacing: 7, width: 1.7, alpha: .85, dir: -1 }),
    'apron': paperImage(128, '#E3D8C2', 12, .8),
  };
}

// ---------- torn-paper geometry ----------
// Value noise along the outline (deterministic per feature) -> displaced, densified ring.
function vnoise(seed) {
  const r = rng(seed); const tab = Array.from({ length: 512 }, () => r() * 2 - 1);
  return x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); const a = tab[((i % 512) + 512) % 512], b = tab[(((i + 1) % 512) + 512) % 512]; return a + (b - a) * u; };
}

// ring: [[lon,lat],...] closed. offset_m > 0 grows the piece outward. amp_m = tear roughness.
export function tornRing(ring, seed, { offset = 0, amp = 2.2, step = 5, jag = 1.1 } = {}) {
  const lat0 = ring[0][1] * Math.PI / 180; const kx = 111320 * Math.cos(lat0), ky = 110574;
  const pts = ring.map(p => [p[0] * kx, p[1] * ky]);
  let area = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  const outward = area > 0 ? 1 : -1; // area>0 => clockwise in this formula
  // densify
  const dens = []; let along = [];
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) { dens.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); along.push(acc + L * k / n); }
    acc += L;
  }
  if (dens.length < 3) return ring;
  const N1 = vnoise(seed), N2 = vnoise(seed * 7 + 3), r = rng(seed * 13 + 1);
  const out = [];
  const m = dens.length;
  for (let i = 0; i < m; i++) {
    const p = dens[i], a = dens[(i - 1 + m) % m], b = dens[(i + 1) % m];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    // left normal (-ty, tx); for clockwise rings the outward normal is the left one
    const nx = -ty * outward * -1, ny = tx * outward * -1;
    const s = along[i];
    const d = offset + amp * (0.65 * N1(s / 9) + 0.35 * N2(s / 3.1)) + (r() - .5) * jag;
    out.push([(p[0] + nx * d) / kx, (p[1] + ny * d) / ky]);
  }
  out.push(out[0]);
  return out;
}
