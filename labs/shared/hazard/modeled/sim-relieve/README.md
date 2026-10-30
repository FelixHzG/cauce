# sim-relieve — static 5 m terrain analysis of where water collects (ZMG)

Producer: `sim-relieve` agent, cauce. labs, 2026-10-29. Viewer: `/labs/sim-relieve/`. Machine-readable numbers: `stats.json`.

**What this is.** A *static* reading of the terrain: depressions, flow paths, height above drainage, flatness, and an
interpretable susceptibility index fitted to the IMEPLAN 2026 flood inventory. No rain, no infiltration, no sewers, no
time. It is exploratory, not a forecast, and it is labelled **modelado** everywhere.

## The owner's hypothesis: "the flatter areas are the ones that flood; probably the same here"

**Partly, and for the wrong reason.** Flat neighbourhoods do hold more flood sites, but only because flat land in the ZMG
is mostly low land (valley floors, old lake beds, arroyo margins). Once you know how high a place sits above its drainage
line, flatness tells you nothing more.

| test | result |
|---|---|
| Flatness at street scale (5 m slope), AUC | **0.49** (95 % CI 0.46–0.53): no signal |
| Flatness at neighbourhood scale (slope over ~175 m), AUC | **0.66** (0.62–0.70) |
| Flattest 10 % of the urban fabric (slope175 < 0.73 %) | **2.5×** the expected share of sites; steepest 10 %: 0.23× |
| Height above nearest drainage (HAND, streams ≥ 1 km²), AUC | **0.79** (0.76–0.82); lowest decile (HAND < 0.72 m) **4.8×** |
| Flatness *within* HAND strata (<1, 1–3, 3–10, >10 m), AUC | 0.49, 0.52, 0.55, 0.57 |
| Low & steep (HAND < 1 m, slope175 ≥ median) | **5.3×** the urban average (10 % of sites on 2 % of the area) |
| Low & flat | 4.2× · high & flat 0.74× · high & steep 0.39× |
| Spatial-CV AUC, model with vs without the two flatness terms | 0.808 vs **0.807** (no out-of-sample gain) |
| Independent check: 1,967 Zapopan civil-protection flood calls 2017–2025 (not used to fit) | model 0.64 · HAND 0.62 · flatness 0.55 (street calls: 0.67 / 0.66 / 0.60) |

Nuance: for IMEPLAN sites with *static* regime (ponding) flatness does a bit better (0.66) and HAND worse (0.71) than for
*dynamic* sites (flowing water: flatness 0.61, HAND 0.83), so flat ponding is real but secondary. In the full model the
175 m flatness term has a small conditional effect (OR 0.72 per SD of log-slope, in-sample) that does not survive
spatial cross-validation. Ranking of single indices (oriented AUC): HAND 0.79 > low position at 2 km (TPI) 0.71 ≈
500 m 0.71 > depression depth (bare-earth DTM) 0.68 > flatness 175 m 0.66 > TWI 0.64 > curvature 0.63 > upslope area
0.63 > flatness 75 m 0.60 > street slope 0.49.

## Files

| file | what |
|---|---|
| `tiles/acumulacion/{z}/{x}/{y}.png` | Upslope area (D8, building-aware), 0.0025–2,500 km² log palette, z8–15. Zoom-dependent minimum area so low zooms show only larger channels. |
| `tiles/depresiones/{z}/{x}/{y}.png` | Fill depth ≥ 10 cm on open ground (building-aware DEM), 0.1–5 m log palette, z9–15 (z ≤ 11 shows ≥ 50 cm, z12–13 ≥ 25 cm). |
| `tiles/hand/{z}/{x}/{y}.png` | HAND 0–30 m (log), transparent above 30 m, z8–15. |
| `tiles/planitud/{z}/{x}/{y}.png` | Slope over ~175 m, 10 % → 0.2 % (amber = flat), z8–14, from the 25 m grid (bilinear). |
| `tiles/susceptibilidad/{z}/{x}/{y}.png` | Susceptibility score 0–1, urban fabric only, z9–15, from the 25 m grid (bilinear). |
| `susceptibilidad-alta.geojson` | Routing polygons: 978 `alta` (score ≥ 0.80) and 675 `muy alta` (≥ 0.93), 3×3-smoothed 25 m score, ≥ 5,000 m², simplified 6 m. Nested (muy alta inside alta). Props: `id, class, label, score, score_min, area_m2, scenario, router_cost`. |
| `depresiones.geojson` | Routing polygons: the 6,000 largest depression patches (by volume) in the urban fabric + 300 outside. Props: `id, class` (somera < 0.3 m, media, profunda ≥ 1 m), `label, depth_m_min (0.1), depth_m_max, volume_m3, area_m2, contrib_area_m2, fill_rain_mm, urban, rank, scenario, centroid, router_cost`. 10.9 MB. |
| `ageb-terrain.json` | Per-AGEB summary keyed by `cvegeo` (same id as `/labs/shared/infra/ageb-profile.geojson`): `susc_mean, susc_p90, susc_alta_pct, susc_scored_pct, dep_n, dep_n_ge30cm, dep_vol_m3, dep_vol_m3_ha, dep_max_m, fill_vol_all_m3, hand_lt1_pct, hand_mean_m, slope175_mean_pct, blocks25m`. Field docs inside (`meta.fields`). 2,066 of 2,068 AGEBs have values. |
| `stats.json` | Everything numeric: hypothesis test, per-index AUC + CI + deciles + subsets, CV, coefficients, partial dependence, capture curve, depression inventory summary, processing receipts, tile palettes, Zapopan check. |

Palettes (code = 1 + 254·t, index 0 transparent) are in `stats.json → tiles.<layer>.palette` as `[t, r, g, b, alpha]`.
`fill_rain_mm` = depression volume / area draining into it: the rain depth that would fill it if every drop of its
catchment arrived (no sewer, no infiltration). Small values = fills in an ordinary storm.

`hazard/index.json` entries (kind `terrain-index`): `sim-relieve-susceptibilidad` (tiles), `sim-relieve-susceptibilidad-alta`
(polygons, `router.default:false`, opt-in), `sim-relieve-depresiones` (polygons, `router.default:false`, opt-in, per-feature
`router_cost` somera 1.3 / media 1.8 / profunda 2.5), and display-only tiles `sim-relieve-depresiones-tiles`,
`sim-relieve-hand`, `sim-relieve-acumulacion`, `sim-relieve-planitud` (`router.default:false`).

## Method

Grid: the terrain agent's 5 m grid, **full AOI** (14,760 × 16,760 cells, EPSG:6368 UTM 13N, [-103.756, 20.243, -103.040, 21.007]).
All compute on W10 in Node.js (no GDAL), ~25 min of CPU for the whole AOI, one process at a time (≤ 3.3 GB RSS), tiles with 3 worker threads.

Two DEMs, chosen per index:
- **MDT (bare earth)** `dtm-5m.f32` — heights for HAND, slope, flatness, TPI, curvature, and a bare-earth depression variant.
- **MDT + buildings** `sim-dem-5m.f32` (DTM + max(3, min(60, nDSM)) in Overture footprints), with **57,568 enclosed
  courtyards** (170,914 cells, ≤ 200 cells each, unreachable from the grid edge through open ground) raised to DTM + 3 m so
  they are not counted as 3 m-deep ponds. Used for flow routing (water runs down streets, not across blocks) and for the
  published depressions (streets bounded by buildings).

Steps:
1. **Depressions**: Priority-Flood with a FIFO pit queue (Barnes, Lehman & Mulla 2014), 8-connected, grid edge = outlet.
   Depth-to-fill stored in cm. Building-aware DEM: 19.6 M cells deeper than 0.5 cm, 605 Mm³ (mostly rural closed basins/reservoirs);
   urban fabric: 103,350 patches ≥ 10 cm holding 24.9 Mm³. Bare-earth DTM: 18.7 M cells, 596 Mm³.
2. **Flow routing**: D8 steepest descent on the filled surface; cells with no lower neighbour (flats, filled pits) keep the
   Priority-Flood pointer towards their spill point (acyclic by construction; verified: 0 unprocessed cells). O(N)
   accumulation. Largest outlet 3,165 km² (Río Santiago leaving the AOI; the Lerma–Chapala upstream basin is outside, so
   its accumulation is truncated).
3. **HAND** for streams ≥ 0.1, 1 and 10 km² on both routings (heights always from the bare-earth DTM, signed). TWI =
   ln(a / tan β) with a = upslope area / 5 m and β from the 5 m DTM slope (floor 0.001). Slope: Horn on the 5 m DTM.
   Neighbourhood descriptors on 25 m block means: slope with ~75 m and ~175 m windows, relief in 125 m, TPI 500 m and
   2 km, Laplacian curvature (50 m lag).
4. **Validation design**: 25 m blocks (5 × 5 cells) — the granularity of the IMEPLAN polygons (median zona crítica
   2,450 m², sitio 7,390 m²). Block statistics use open-ground cells (min HAND, max depth, max upslope area, mean slope).
   Cases: the 472 IMEPLAN polygons (296 sitios inundables, 176 zonas críticas; 26 dropped: outside the AOI or with no
   urban block) → 23,571 blocks, each polygon weight 1. Controls: 40,000 random blocks of the urban fabric (Overture
   building fraction ≥ 10 % in 275 m, INEGI DTM coverage, some open ground) within 4 km of a site and > 75 m from all.
   Weighted AUC with 95 % CIs from a cluster bootstrap (sites; 3 km control blocks; 200 reps). Deciles on the control
   distribution → ratio of site share to area share.
5. **Model**: weighted logistic regression (balanced classes, L2 λ = 0.01) on standardized transformed indices; 5-fold
   spatial block CV (3 km × 3 km blocks), 5 repeats. Final (parsimonious) model, spatial-CV AUC **0.807 ± 0.001**:

   | term (transform) | coef / SD | 95 % CI (cluster bootstrap) | OR per SD |
   |---|---|---|---|
   | HAND min, streams ≥ 1 km², building-aware routing (log1p) | −0.857 | −1.03 … −0.72 | 0.42 |
   | depression depth, bare-earth DTM (log1p 10·d) | +0.290 | 0.20 … 0.37 | 1.34 |
   | TWI, building-aware | +0.154 | 0.08 … 0.24 | 1.17 |
   | TPI 500 m | −0.097 | −0.30 … 0.04 | 0.91 |
   | TPI 2 km | −0.296 | −0.59 … −0.01 | 0.74 |

   **Score** = percentile rank of the linear predictor among all 1,224,218 urban 25 m blocks of the AOI (0.9 = more
   susceptible than 90 % of the urban fabric). Capture: the top 10 % of the urban area holds 34 % of the IMEPLAN site
   blocks, the top 20 % holds 56 %.

Choices made by this agent (no owner input): DEM per index as above; HAND threshold 1 km² (0.1 km² nearly as good, 10 km²
worse); validation at 25 m blocks; controls restricted to within 4 km of surveyed sites (to approximate the surveyed
jurisdictions); final model without flatness (equal CV AUC, fewer terms); score as percentile (not a probability, which
case-control sampling cannot give); courtyard threshold 200 cells (5,000 m²).

## Limits (be honest on screen)

- IMEPLAN is an inventory of reported problems, biased towards busy streets and places with complaints; "not in the
  inventory" ≠ "never floods". The Zapopan calls are a second, independent but also biased record.
- INEGI 5 m DTM/DSM are satellite stereo photogrammetry (2014–2022 imagery), not LiDAR; flat urban areas show facets
  and small spurious pits (hence the 10 cm floor). Bridges/culverts/sewers do not exist in this model: road embankments
  may dam water that really passes under them, and underpasses are poorly captured (Zapopan underpass calls: AUC ≈ 0.5).
- Buildings rasterized by cell centre: alleys < 5 m may close; footprints < 25 m² are often missing.
- Depression volumes are static capacities before spilling, not flood depths; some deep ones (> 5 m) are quarries,
  excavations or construction pits.
- Model fitted to ZMG observations; outside the urban fabric no score is given.

## Full-resolution outputs (W10 `C:\Users\Felip\contorno-compute\labs\sim-relieve\out\`)

5 m (14,760 × 16,760, north-first, LE): `ground-5m.u8` (0 building, 1 plugged courtyard, 2 open, 3 large enclosed kept open),
`S-depth.u16` / `T-depth.u16` (fill depth, cm), `S-acc-log2x2048.u16` / `T-acc-log2x2048.u16` (upslope cells incl. itself,
quantized: cells = 2^(v/2048)), `S-hand40000.u16` / `T-hand40000.u16` (HAND, streams ≥ 1 km²: m = v/50 − 50).
To respect the W10 disk budget the D8 direction rasters, the full-precision accumulation and the 0.1 / 10 km² HAND variants
were deleted after use (their 25 m aggregates stay in `b25\`); `fill.mjs` + `acc.mjs` + `hand.mjs` rebuild them in ~5 min per DEM.
S = building-aware routing, T = bare-earth DTM. 25 m blocks (2,952 × 3,352, float32) in `out\b25\` (`b25.json` lists
bands; `susc.f32` = score, `susc.u8` = code, `domain.u8`, `pos.u8`). `sample.csv` (case-control table), `model\model.json`,
`depressions-inventory.f32x6` (row, col of centroid in 5 m cells, volume, area, max depth, fill rain). Scripts: W10
`labs\sim-relieve\*.mjs` (copies on the VPS in `work/sim-relieve/w10/` and `work/sim-relieve/vps/`).
