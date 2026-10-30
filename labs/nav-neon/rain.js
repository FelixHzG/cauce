// cauce. nav-neon — screen-space rain: three depth layers of streaks, a few lens drops and
// lightning flashes. Pure function of t (deterministic under __cauceDemo.seek).
export function createRain(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  const N = 1400;
  const drops = Array.from({ length: N }, (_, i) => ({
    x: h(i * 1.3), y: h(i * 2.7), layer: i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0, sp: 0.75 + 0.5 * h(i * 3.9), len: 0.6 + 0.8 * h(i * 5.1),
  }));
  const lens = Array.from({ length: 9 }, (_, i) => ({ x: h(i * 11.1), y: h(i * 13.7), r: 10 + 26 * h(i * 17.3), life: 3 + 4 * h(i * 19.1), off: h(i * 23.3) * 10 }));
  function resize() {
    const dpr = 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);
  // intensity: 0..1 (mapped from mm/h), motion: 0..1 extra streak length for fast camera moves.
  function draw(t, { intensity = 0.6, motion = 0, wind = 0.22 } = {}) {
    if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();
    ctx.clearRect(0, 0, W, H);
    const count = Math.round(N * Math.min(1, 0.18 + intensity * 0.82));
    const layers = [
      { a: 0.16, w: 1, L: 18, v: 1500 },
      { a: 0.28, w: 1.3, L: 34, v: 2300 },
      { a: 0.42, w: 2.1, L: 70, v: 3300 },
    ];
    ctx.lineCap = 'round';
    for (let li = 0; li < 3; li++) {
      const Ls = layers[li];
      ctx.strokeStyle = li === 2 ? `rgba(200,240,255,${Ls.a})` : `rgba(170,215,255,${Ls.a})`;
      ctx.lineWidth = Ls.w;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const d = drops[i]; if (d.layer !== li) continue;
        const len = Ls.L * d.len * (1 + motion * 2.2) * (0.7 + intensity * 0.6);
        const span = H + len + 40;
        const y = ((d.y * span + t * Ls.v * d.sp) % span) - len - 20;
        const x = ((d.x * (W + 200) + y * wind) % (W + 200)) - 100;
        ctx.moveTo(x, y); ctx.lineTo(x + len * wind, y + len);
      }
      ctx.stroke();
    }
    // Lens drops: soft blurry circles that appear, sit and fade.
    for (const l of lens) {
      const ph = ((t + l.off) % l.life) / l.life;
      const a = Math.sin(Math.PI * ph) * 0.16 * intensity;
      if (a <= 0.005) continue;
      const x = l.x * W, y = l.y * H + ph * 40;
      const g = ctx.createRadialGradient(x - l.r * 0.3, y - l.r * 0.3, 1, x, y, l.r);
      g.addColorStop(0, `rgba(220,245,255,${a * 1.4})`); g.addColorStop(0.7, `rgba(120,200,255,${a * 0.5})`); g.addColorStop(1, 'rgba(120,200,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, l.r, 0, Math.PI * 2); ctx.fill();
    }
  }
  return { draw, resize };
}
// Lightning: two-stroke flicker envelope at the given strike times (seconds). Returns 0..1.
export function lightning(t, strikes) {
  let v = 0;
  for (const s0 of strikes) {
    const d = t - s0; if (d < 0 || d > 0.9) continue;
    const a = Math.exp(-d * 9) * (d < 0.06 ? 1 : 0.55) + (d > 0.16 && d < 0.5 ? 0.6 * Math.exp(-(d - 0.16) * 8) : 0);
    v = Math.max(v, a);
  }
  return Math.min(1, v);
}
function h(n) { const x = Math.sin(n * 91.345 + 47.853) * 43758.5453; return x - Math.floor(x); }
