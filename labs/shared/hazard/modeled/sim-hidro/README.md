# sim-hidro — 5 m rain-on-grid shallow-water simulation of the ZMG (exploratory)

Producer: **sim-hidro** agent, cauce. labs. Updated 2026-10-30T05:11:14.743Z. Viewer: [/labs/sim-hidro/](/labs/sim-hidro/).
**Modelled, not observed. Exploratory, not a forecast.** Design storms, an assumed drainage rate and a photogrammetric
terrain model; read the assumptions and the validation below before using any number.

## What is here
| path | content |
|---|---|
| `stats.json` | domain, storms, areas, runtimes, mass balance, validation for every scenario (machine-readable) |
| `T{2,10,100}/tiles/depth/{z}/{x}/{y}.png` | max depth during the 3 h, colourised, z10–15 (z15 ≈ native 5 m; lower zooms aggregate) |
| `T*/tiles/hazard/…` | hazard class from max depth and max depth×velocity, z10–15 (bajo: h ≥ 15 cm; vehículos pequeños: h·v ≥ 0.3 m²/s or h ≥ 30 cm; personas y vehículos: h·v ≥ 0.6 or h ≥ 50 cm; extremo: h·v ≥ 1 or h ≥ 1.2 m — simplified from ARR 2019 Book 6 ch. 7) |
| `T*/tiles/arrival/…` | minutes until the cell first holds ≥ 15 cm (z10–14) |
| `T*/frames.json` + `T*/frames/f_SSSSS.png` | depth time slices every 5 min (t = 300…10800 s), indexed Web-Mercator PNGs over the domain bbox (1600 px wide ≈ 25 m/px, cells ≥ 10 cm, alpha ∝ wet share of the pixel) for a MapLibre `image` source; per-slice flooded areas |
| `T*/depth-classes.geojson` | **routing polygons**: max-depth bands 15–30 cm (class 1), 30–60 cm (2), > 60 cm (3); properties `class, label, depth_m_min, depth_m_max, scenario, source` |
| `T*/validation.json` | IMEPLAN comparison (below) |
| `T*/run.json` | solver run log: checkpoints every 5 min with the full volume balance |

Colour legend (depth tiles and frames): 5–15 cm `#7dd3fc` (alpha 0.28, tiles only), 15–30 `#38bdf8`, 30–60 `#1d8fe0`,
0.6–1 m `#2563eb`, 1–2 m `#4f46e5`, > 2 m `#7e22ce`. At zooms < 15 a pixel aggregates several 5 m cells: colour = mean depth of
the wet cells, alpha ∝ wet share (pixels with < 10 % wet cells are transparent). Hazard: bajo `#ffe28a`, vehículos pequeños `#ffad42`,
personas y vehículos `#ec5a2f`, extremo `#9c0f45`. Arrival: viridis 0 → 180 min.

Full-resolution rasters (W10, `C:\Users\Felip\contorno-compute\labs\sim-hidro\runs\T*\`, quantized to save disk):
`hmax_mm.u16` (max depth, mm), `vmax_cms.u16` (max speed, cm/s, cells ≥ 5 cm; noisy at wet/dry edges, capped 20 m/s),
`hv_mm2s.u16` (max depth×speed, 0.001 m²/s), `times.u32` (low 16 bits: second of max depth; high 16 bits: second of first
≥ 15 cm, 65535 = never), `frames/h_SSSSS.u8.gz` every 5 min (depth code `c` → `(c/100)²` m; < 1 cm zeroed). All are
8200×9000 little-endian, north-first, on the 5 m grid of the terrain agent (EPSG:6368, NW corner
648900, 2306400; = terrain grid window cols 3800–12000, rows 3400–12400). Domain files:
`…\sim-hidro\domain\` (`dem-cond.f32`, `class-cond.u8`, `meta.json`, `pits.json`).

## Results
|  | Tr 2 años | Tr 10 años | Tr 100 años |
| --- | ---: | ---: | ---: |
| rain (60 min) | 37.3 mm (peak 10-min 86 mm/h) | 56.2 mm (peak 10-min 130 mm/h) | 83.3 mm (peak 10-min 192 mm/h) |
| area with max depth ≥ 15 cm | 82.29 km² | 159.69 km² | 251.66 km² |
| … ≥ 30 cm | 35.73 km² | 83.19 km² | 149.19 km² |
| … ≥ 60 cm | 12.28 km² | 34.59 km² | 70.82 km² |
| … ≥ 15 cm on built-up ground (streets/yards) | 33.54 km² | 59.49 km² | 90.16 km² |
| hazard ≥ "personas y vehículos" | 17.17 km² | 46.55 km² | 94.1 km² |
| volume: rain / infiltration / drainage / outflow / stored (Mm³) | 68.77 / 32.20 / 7.60 / 0.83 / 28.15 | 103.69 / 34.42 / 8.47 / 3.53 / 57.26 | 153.65 / 36.01 / 9.11 / 7.65 / 100.87 |
| mass-balance error (final; worst checkpoint) | 3.6e-5; 3.6e-5 | 4.9e-5; 4.9e-5 | 5.1e-5; 5.1e-5 |
| GPU time (RX 580) / steps / ms per step | 23.6 min / 18,463 / 76.64 | 24.5 min / 18,643 / 78.9 | 24.4 min / 18,780 / 77.83 |
| deepest cell (usually a quarry or closed pit) | 34.95 m @ -103.2831, 20.71029 | 54.82 m @ -103.26783, 20.70273 | 56.77 m @ -103.26802, 20.70259 |

Mass-balance error = (rain − infiltration − drainage − boundary outflow − stored) / rain, all volumes accumulated on
the GPU per step (per-workgroup partial sums folded into float64 on the CPU every batch); the clock is exact
integer milliseconds.

## Validation against IMEPLAN MUI 2026 (observed)
Statistic: the maximum modelled max-depth inside each observed feature (polygons dilated by one 5 m cell; points as
discs of 25/50 m). Baseline: the **same shapes moved to random built-up locations** (WorldCover built-up or building
cell at the new centre) inside urbanBbox, ≥ 150 m from any observed feature, 25 placements per feature. z = (observed
hit rate − random hit rate) / binomial s.e.

**Tr 2 años**

| feature set | n | hit ≥ 15 cm obs / random (lift, z) | hit ≥ 30 cm obs / random (lift, z) | hit ≥ 60 cm obs / random (lift, z) | share of feature area ≥ 15 cm obs / random | median max depth obs / random |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| sitiosInundables_polygons | 276 | 97 % / 94 % (×1.03, z 2.1) | 91 % / 79 % (×1.14, z 4.6) | 75 % / 46 % (×1.64, z 9.8) | 18 % / 6 % | 0.926 / 0.56 m |
| zonasCriticas_polygons | 156 | 94 % / 85 % (×1.11, z 3.1) | 87 % / 66 % (×1.32, z 5.6) | 64 % / 35 % (×1.84, z 7.6) | 19 % / 6 % | 0.697 / 0.429 m |
| points_r25m | 278 | 86 % / 72 % (×1.18, z 5) | 64 % / 38 % (×1.67, z 8.8) | 37 % / 11 % (×3.49, z 14.2) | 19 % / 6 % | 0.428 / 0.242 m |
| points_r50m | 278 | 98 % / 96 % (×1.02, z 1.7) | 89 % / 77 % (×1.16, z 4.8) | 57 % / 29 % (×1.96, z 10.2) | 15 % / 6 % | 0.664 / 0.443 m |

Reported depth range (IMEPLAN, sites) vs modelled: Spearman ρ = 0.27 (n = 268).

**Tr 10 años**

| feature set | n | hit ≥ 15 cm obs / random (lift, z) | hit ≥ 30 cm obs / random (lift, z) | hit ≥ 60 cm obs / random (lift, z) | share of feature area ≥ 15 cm obs / random | median max depth obs / random |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| sitiosInundables_polygons | 276 | 99 % / 96 % (×1.03, z 2.2) | 95 % / 87 % (×1.1, z 4.3) | 85 % / 59 % (×1.44, z 8.8) | 33 % / 11 % | 1.386 / 0.719 m |
| zonasCriticas_polygons | 156 | 97 % / 89 % (×1.09, z 3.1) | 91 % / 75 % (×1.22, z 4.7) | 78 % / 47 % (×1.68, z 7.9) | 34 % / 11 % | 1.024 / 0.555 m |
| points_r25m | 278 | 92 % / 80 % (×1.16, z 5.3) | 80 % / 52 % (×1.55, z 9.5) | 54 % / 19 % (×2.78, z 14.5) | 35 % / 10 % | 0.664 / 0.311 m |
| points_r50m | 278 | 100 % / 98 % (×1.02, z 2.2) | 96 % / 86 % (×1.11, z 4.5) | 75 % / 45 % (×1.65, z 9.9) | 28 % / 11 % | 1.018 / 0.563 m |

Reported depth range (IMEPLAN, sites) vs modelled: Spearman ρ = 0.262 (n = 268).

**Tr 100 años**

| feature set | n | hit ≥ 15 cm obs / random (lift, z) | hit ≥ 30 cm obs / random (lift, z) | hit ≥ 60 cm obs / random (lift, z) | share of feature area ≥ 15 cm obs / random | median max depth obs / random |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| sitiosInundables_polygons | 276 | 99 % / 97 % (×1.02, z 1.8) | 98 % / 90 % (×1.08, z 4.1) | 91 % / 68 % (×1.33, z 8) | 48 % / 16 % | 1.792 / 0.871 m |
| zonasCriticas_polygons | 156 | 97 % / 91 % (×1.06, z 2.4) | 95 % / 80 % (×1.18, z 4.6) | 86 % / 55 % (×1.55, z 7.7) | 47 % / 16 % | 1.481 / 0.679 m |
| points_r25m | 278 | 95 % / 85 % (×1.12, z 4.9) | 90 % / 61 % (×1.46, z 9.8) | 73 % / 28 % (×2.59, z 16.5) | 50 % / 15 % | 1.009 / 0.378 m |
| points_r50m | 278 | 100 % / 98 % (×1.02, z 2.2) | 99 % / 91 % (×1.08, z 4.4) | 88 % / 58 % (×1.51, z 10) | 42 % / 16 % | 1.362 / 0.676 m |

Reported depth range (IMEPLAN, sites) vs modelled: Spearman ρ = 0.271 (n = 268).

How to read it: a lift well above 1 means the model puts water where IMEPLAN records flooding more often than at
random urban spots of the same shape; it does **not** mean depths are right. Hit rates at random spots are high because
5 m rain-on-grid wets some low point inside almost any street-sized shape, so the 15 cm hit rate barely separates
observed from random (lift ≈ 1.02–1.18). The informative numbers are the 60 cm hits (lift 1.3–3.5, z 8–16) and the
**share of each feature's area that floods ≥ 15 cm: about 3× the random baseline in every scenario** (e.g. Tr 10: 33 % of
the area of the 276 sitios inundables vs 11 % of the same shapes placed at random). Depth agreement is weak: Spearman
ρ ≈ 0.27 between IMEPLAN's reported range and the modelled maximum. IMEPLAN records
real events with a real (partly working) drainage network, underpasses and blocked inlets; the model has none of those.

## Method
- **Equations/scheme:** local-inertial 2D shallow water (Bates, Horritt & Fewtrell 2010) with de Almeida et al. (2012)
  θ-weighting (θ = 0.8), semi-implicit Manning friction, staggered face fluxes on the 5 m grid, explicit
  continuity. Water-surface gradients are computed as (Δz + Δh) to keep float32 precision at 1500 m elevations.
  Wet/dry: a face carries flow only if its flow depth (max η − max z) > 1 mm. Positivity: per-cell outflow
  scaling (no cell can give more than it holds); the remaining float32 round-off clipped at zero created 74 m³ (Tr 2), 704 m³ (Tr 10), 3003 m³ (Tr 100) — included in the balance. Froude number capped at 1.5.
- **Timestep:** adaptive CFL computed on the GPU every step, dt = 0.7·Δx/√(g·h_max) ≤ 1 s, integer-ms clock.
  **Depth cap for the wave term:** the gravity term uses min(h, 4 m), so the CFL never drops below
  0.56 s. Quarry pits, canyon pools and closed depressions reach 5–40 m of water and
  would otherwise force dt ≈ 0.15 s (4× slower). The cap slows only the internal dynamics of water deeper than 4 m
  (mass is conserved; test T2b: a 9 m pool fills to the same level within 2 mm, 31 % fewer steps).
- **Boundaries:** all four domain edges are free outflow (Manning normal depth with the local slope, ≥ 0.005, capped at
  critical flow). No inflow: no base flow in the Santiago, no upstream hydrographs (the domain contains the whole
  contributing area of the urban catchments, see Domain).
- **GPU:** WGSL compute shaders, one kernel each for dt, fluxes, outflow limiter and update (+ reductions), ping-pong
  flux buffers, ~4.4 GB of VRAM; driven headless from Node with playwright-core on W10 (Chromium WebGPU, D3D12).
  Max depth / speed / h·v / time of peak / arrival are tracked on the GPU every 4 steps.
- **Analytic tests (W10 GPU, same shader):**
  - Lake at rest over bumpy bed with dry islands, 1 h: max |Δη| = 3.7e-8 m, max |q| = 1.0e-7 m²/s (well balanced).
  - Deep lake at rest with the depth cap: max |Δη| < 1e-6 m after 30 min (0 m reported).
  - Rain on a 400 m, 2 % plane (n = 0.025, 100 mm/h) vs kinematic-wave solution: outflow at 5 / 10 / 20 min = 99.9 % / 99.8 % / 100.0 % of analytic; equilibrium depth profile rel. RMSE 0.07 %.
  - Dam break on a dry frictionless bed vs Ritter (60 s): rel. RMSE 13 %, front at 1132.5 m vs 1376 m — the local-inertial scheme has no advection term and is slow on dry-bed fronts; this is a known limitation of the scheme family (not used for dam breaks here).
  - Rough 256×256 terrain, 100-yr storm, all losses, two open edges, 2 h: mass error 5.4e-7, 1.7e-6, 2.0e-6, -7.1e-6 at 10/30/60/120 min.
- **Volumes:** at 3 h most of the water is still on the surface (stored 41–66 % of rain): closed depressions, quarries,
  flat El Ahogado lowlands and street sags with no pipe outlet keep it; time-of-peak shows ~7 % (Tr 10) of the ≥ 15 cm cells still
  rising in the last 5 min (slow ponding), so max depth there is a lower bound for a longer simulation.
- **Domain** (decision): 8200×9000 cells (41 × 45 km, 73.8 M cells,
  bbox -103.573, 20.442, -103.175, 20.852). Chosen from a 50 m D8 screening of the INEGI DTM
  (priority-flood) of everything that drains into the built-up core of urbanBbox. The screening reproduces IMTA's ZMG
  sub-catchments (IMTA 2017): El Ahogado 499 km² (IMTA 507), San Juan de Dios 135 (137), Atemajac 74.0 (74.6),
  Río Blanco 156 (189), plus Hondo/Caballito, San Andrés, Osorio, San Gaspar draining to the Santiago canyon. All of them
  are inside the domain, including the La Primavera, Colli, Cerro del Cuatro and Tonalá hillslopes. Excluded on purpose:
  the Cajititlán and southern basins (248 + 128 km²) that join the Santiago downstream of El Salto, and the plateau NE of
  the canyon. Domain edges are open; the Río Santiago crosses the NE/E part with no base flow.
- **Terrain:** terrain agent's `sim-dem-5m.f32` (INEGI 5 m DTM + buildings as 3–60 m blocks), conditioned by this agent:
  4-connected priority-flood depression analysis, then 243,170 **courtyards** filled
  (≤ 100 cells, ≥ 50 % building rim, and water could only leave over a roof — treated as roofed/drained by the building;
  17.0 km²) and 2,287 **spike pits** filled (≤ 20 cells and > 3 m deep: photogrammetric artifacts).
  Every other depression (street low points, underpasses, ponds, quarries, vasos) is kept.
- **Rain (design storms):** IMTA (2017) ZMG design hyetograph for Tr 25 yr, 60 min, "Zona Centro" (10-min blocks
  58 / 155 / 107 / 48 / 24 / 10 mm/h = 67 mm; digitised from the vector chart in *Estudios de preinversión… problemática
  pluvial de la ZMG*, CEA Jalisco micro-site) scaled to other return periods with Bell's (1969) ratio
  P_T/P_10 = 0.21 ln T + 0.52 → Tr 2: 37.3 mm, Tr 10: 56.2 mm, Tr 100: 83.3 mm in 60 min. Spatially uniform; 3 h simulated
  (60 min rain + 120 min recession). No public station IDF table for Guadalajara could be retrieved (UdeG/SIAPA
  sources offline); no real-storm replay was run (GPM IMERG needs an Earthdata login and no gauge series is on hand).
- **Losses (land cover, ESA WorldCover 2021 10 m + Overture buildings):** initial loss IL then constant loss CL (only while
  water is present), and Manning n:
| class | share of domain | n | IL mm | CL mm/h | drainage mm/h |
| --- | ---: | ---: | ---: | ---: | ---: |
| water | 0 % | 0.03 | 0 | 0 | 0 |
| built-up ground | 21 % | 0.02 | 2 | 1.5 | 10 |
| building roof | 10 % | 0.015 | 1 | 0 | 10 |
| tree | 22 % | 0.1 | 20 | 12 | 0 |
| shrub | 9 % | 0.07 | 15 | 10 | 0 |
| grass | 19 % | 0.04 | 10 | 8 | 0 |
| crop | 18 % | 0.05 | 12 | 7 | 0 |
| bare | 1 % | 0.03 | 5 | 4 | 0 |
| wetland | 0 % | 0.06 | 0 | 0 | 0 |

  Soil type is not used (pumice "jal" soils in Zapopan infiltrate much more; clays in the south less).
- **Drainage (decision, single number):** 10 mm/h removed from water standing on built-up ground and roofs
  (inlets everywhere, no pipes, no surcharge). This is a deliberately simple stand-in for a combined network that IMTA
  describes as undersized; the sim-drenaje agent studies sensitivity to this number.

## Limitations
Exploratory: design storms (not a real event), one drainage rate, no pipes/collectors/tunnels/vasos operation, no
bridges or culverts (bare-earth DTM: water crosses under bridges as open ground; embankments without culverts can dam
it), photogrammetric 5 m DTM (2014–2022 imagery, not LiDAR) with Terrarium fill outside INEGI coverage, building
footprints rasterised by cell centre (alleys < 5 m closed), land-cover-only infiltration, local-inertial physics (weak
on supercritical/steep flow: Froude capped at 1.5), depth-capped wave term above 4 m. Max-depth maps show the
maximum during 3 h at every cell, not a single moment.
