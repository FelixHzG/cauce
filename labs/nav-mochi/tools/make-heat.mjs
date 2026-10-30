// Derive data/riesgo-modelado.geojson (weighted points for a MapLibre heatmap) from the sim-drenaje ensemble
// flood-frequency polygons (/labs/shared/hazard/modeled/sim-drenaje/routing-flood-frequency.geojson).
// One point per polygon centroid, plus interior points on a 140 m grid for large polygons. w = score (0..1).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../shared/hazard/modeled/sim-drenaje/routing-flood-frequency.geojson');
const j = JSON.parse(fs.readFileSync(src, 'utf8'));
const BB = [-103.55, 20.43, -103.18, 20.85], KX = 104260, KY = 110950, STEP = 140;
const pip = (x, y, r) => { let c = false; for (let i = 0, k = r.length - 1; i < r.length; k = i++) { const [xi, yi] = r[i], [xk, yk] = r[k]; if (((yi > y) != (yk > y)) && (x < (xk - xi) * (y - yi) / (yk - yi) + xi)) c = !c; } return c; };
const out = []; const r5 = v => Math.round(v * 1e5) / 1e5;
for (const f of j.features) {
  const ring = f.geometry.coordinates[0]; const w = +(f.properties.score ?? (f.properties.class === 'alta' ? 0.8 : 0.4));
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, cx = 0, cy = 0;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); cx += x; cy += y; }
  cx /= ring.length; cy /= ring.length;
  if (cx < BB[0] || cx > BB[2] || cy < BB[1] || cy > BB[3]) continue;
  const pts = [];
  const dx = STEP / KX, dy = STEP / KY;
  if ((x1 - x0) * KX > STEP * 1.5 || (y1 - y0) * KY > STEP * 1.5) for (let x = x0 + dx / 2; x < x1; x += dx) for (let y = y0 + dy / 2; y < y1; y += dy) if (pip(x, y, ring)) pts.push([x, y]);
  if (!pts.length) pts.push([cx, cy]);
  for (const p of pts) out.push({ type: 'Feature', properties: { w: Math.round(w * 100) / 100 }, geometry: { type: 'Point', coordinates: [r5(p[0]), r5(p[1])] } });
}
const fc = { type: 'FeatureCollection', metadata: { source: '/labs/shared/hazard/modeled/sim-drenaje/routing-flood-frequency.geojson', producer: 'nav-mochi (derived)', note: 'Puntos ponderados para mapa de calor: frecuencia de inundación ≥15 cm en el ensamble sim-drenaje (126 corridas). Modelo exploratorio, no pronóstico.' }, features: out };
fs.writeFileSync(path.join(here, '../data/riesgo-modelado.geojson'), JSON.stringify(fc));
console.log(out.length, 'points', (fs.statSync(path.join(here, '../data/riesgo-modelado.geojson')).size / 1e6).toFixed(2), 'MB');
