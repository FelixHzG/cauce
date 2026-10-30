# sim-drenaje — ensamble de tormentas × capacidad de drenaje (cauce. labs)

Producer: `sim-drenaje` agent. Kind: **modeled** (exploratory, never a forecast).
Viewer: `/labs/sim-drenaje/`. Status: `/labs/shared/status/sim-drenaje.json`.

## Question

Not "how deep will it flood" but an infrastructure question: **where does adding storm-drainage capacity reduce
flooding the most, and where is flooding insensitive to drainage** (so it needs storage, regrading or relocation)?
We answer it with many fast runs instead of one big one: storms × drainage capacity × infiltration.

## Key findings (exploratory)

- Drainage capacity helps most for frequent storms: going from 0 to 40 mm/h removes ~54 % of the urban area flooded
  ≥15 cm for Tr 2, ~39 % for Tr 10 and only ~25 % for Tr 100 (mid infiltration). The 5-min rain peaks (171–307 mm/h)
  exceed any distributed capacity, so street flow paths fed by large upstream areas keep flooding.
- Spatial split: the consolidated valley floor of Guadalajara/Tlaquepaque is mostly class **b** (drainage upgrade pays
  off); the periphery on slopes and new developments over arroyos (Tonalá, Tlajomulco, El Salto/El Ahogado basin, Zapopan
  edges) is mostly class **a** (needs storage, a major collector/channel, regrading or relocation).
- Where storm inlets are actually present matters: weighting capacity by INEGI INV 2020 inlet presence adds 12–28 km²
  of flooded urban area relative to the same nominal capacity spread uniformly.
- Infiltration uncertainty (low↔high) moves flooded area by roughly ±10–20 km², less than the capacity range.

## Results (filled from stats.json at publication)

Ensemble used: **126 runs** (18 storm×infiltration combinations × 7 capacities; storms Tr 2/5/10/25/50/100; infiltration mid/low/high). Uniform-capacity runs finished: 126; + 6 spatially varied capacity runs reported separately. Worst mass-balance residual: 3.3e-5 of rain volume.

**Urban area flooded ≥15 cm (km²) vs drainage capacity, mid infiltration** (urban drainage cells: 635.7 km²):

| Tr (years) | rain 60 min | 0 mm/h | 10 mm/h | 20 mm/h | 30 mm/h | 40 mm/h | 50 mm/h | 60 mm/h | 0→40 mm/h |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 47.3 mm | 74.5 | 62.9 | 51.4 | 42.0 | 34.4 | 28.3 | 22.7 | −54 % |
| 5 | 56.1 mm | 91.8 | 80.8 | 69.2 | 59.0 | 50.3 | 43.4 | 37.1 | −45 % |
| 10 | 62.8 mm | 104.1 | 93.7 | 82.7 | 72.5 | 63.2 | 55.2 | 48.6 | −39 % |
| 25 | 71.6 mm | 119.8 | 110.6 | 100.1 | 90.0 | 80.5 | 72.0 | 64.3 | −33 % |
| 50 | 78.3 mm | 131.4 | 122.4 | 112.9 | 103.1 | 93.5 | 85.1 | 76.6 | −29 % |
| 100 | 84.9 mm | 142.6 | 134.0 | 125.1 | 115.5 | 106.3 | 97.6 | 89.5 | −25 % |
| 2 (low infiltration) | | 83.9 | 71.5 | 59.9 | 49.8 | 41.8 | 35.4 | 29.7 | −50 % |
| 5 (low infiltration) | | 100.8 | 89.6 | 77.8 | 67.2 | 58.4 | 50.9 | 44.6 | −42 % |
| 10 (low infiltration) | | 112.8 | 102.6 | 91.3 | 80.7 | 71.3 | 63.0 | 56.2 | −37 % |
| 25 (low infiltration) | | 128.5 | 118.8 | 108.5 | 98.4 | 88.8 | 80.1 | 72.2 | −31 % |
| 50 (low infiltration) | | 139.4 | 130.6 | 121.1 | 111.1 | 101.9 | 93.2 | 84.8 | −27 % |
| 100 (low infiltration) | | 150.2 | 141.9 | 132.8 | 123.3 | 114.2 | 105.7 | 97.4 | −24 % |
| 2 (high infiltration) | | 61.2 | 50.1 | 39.7 | 31.2 | 24.5 | 18.9 | 14.1 | −60 % |
| 5 (high infiltration) | | 77.7 | 67.1 | 56.3 | 46.7 | 38.6 | 32.4 | 26.7 | −50 % |
| 10 (high infiltration) | | 90.4 | 80.1 | 69.3 | 59.1 | 50.9 | 43.3 | 37.3 | −44 % |
| 25 (high infiltration) | | 106.3 | 96.9 | 86.6 | 76.7 | 67.5 | 59.5 | 52.4 | −36 % |
| 50 (high infiltration) | | 118.0 | 109.4 | 99.6 | 90.0 | 80.5 | 72.4 | 64.3 | −32 % |
| 100 (high infiltration) | | 129.5 | 121.1 | 112.2 | 102.3 | 93.7 | 84.9 | 76.8 | −28 % |

**Infrastructure gap (urban cells):** a · persistente **71.7 km²**, b · responde al drenaje **55.36 km²**, c · rara vez 508.68 km².
Largest class-a 1 km windows (lat, lon): 20.5014, -103.3652 (0.546 km²); 20.6538, -103.2484 (0.528 km²); 20.4705, -103.4470 (0.463 km²).
Largest class-b 1 km windows: 20.6547, -103.3396 (0.681 km²); 20.6324, -103.3686 (0.534 km²); 20.6588, -103.2963 (0.476 km²).

AGEB aggregation: 1948 urban AGEBs with simulated cells → `ageb-drainage.json`.

**Spatially varied capacity (INEGI INV 2020 storm inlets):** Tr 10, 20 mm/h: 82.72 km² uniform → 97.49 km² with inlet-weighted capacity (+14.77 km²); Tr 10, 40 mm/h: 63.24 km² uniform → 91.19 km² with inlet-weighted capacity (+27.96 km²); Tr 2, 20 mm/h: 51.36 km² uniform → 67.19 km² with inlet-weighted capacity (+15.83 km²); Tr 2, 40 mm/h: 34.4 km² uniform → 60.51 km² with inlet-weighted capacity (+26.11 km²); Tr 100, 20 mm/h: 125.06 km² uniform → 137.11 km² with inlet-weighted capacity (+12.05 km²); Tr 100, 40 mm/h: 106.25 km² uniform → 131.43 km² with inlet-weighted capacity (+25.18 km²).


## Method

**Grid (20 m).** The terrain agent's INEGI 5 m grid (EPSG:6368, UTM 13N) aggregated 4×4 → 20 m. Bed elevation =
mean bare-earth DTM of the *non-building* 5 m cells (open-ground / street level). Buildings (Overture footprints
rasterized at 5 m) become **porosity**: φ = max(0.1, 1 − building fraction). φ scales both storage (water depth h
lives in the open fraction; volume = h·φ·A) and face conveyance (face width × min(φᵢ, φⱼ)). Rain on roofs drains
into the open fraction of its cell. This is the coarse-grid counterpart of the brief's "buildings burned in" rule.

**Domain.** Urban cells (≥5 % buildings at 100 m inside the urban bbox) + their D8 contributing slopes
(priority-flood + D8 on a 100 m aggregate), excluding inflow carried by rivers draining >150 km² (Santiago, the main
El Ahogado channel), + downstream paths, dilated 1 km → **2,117 km² active**, 2,397 × 3,032 cells
(origin NW 645980 E, 2312820 N). Cells outside are real-terrain sinks (free outflow; counted as boundary outflow).

**Solver.** Local-inertial shallow-water (Bates et al. 2010 / de Almeida et al. 2012 family), explicit, adaptive
Δt = 0.7·Δx/√(g·h_max) ≤ 5 s, semi-implicit Manning friction, Froude limiter (Fr ≤ 1, stability on the steep
canyon walls), per-cell outflow limiter that keeps depths ≥ 0 **and** keeps the scheme exactly conservative.
Manning n from ESA WorldCover 2021 (trees 0.10, shrub 0.07, grass/crop 0.05, built/bare 0.03, water 0.025).
Two implementations of the same equations: a Node.js CPU reference (`solver.mjs`) and a WebGPU port (`gpu-sim.html`,
f32, run in Chromium on the W10 RX 580 under the shared GPU lock; ~30 s per 120-min run).

**Losses.** Pervious fraction = 1 − imperviousness, imperviousness = max(building fraction, 0.85 × WorldCover built-up
share). On the pervious fraction: initial abstraction then a constant infiltration rate. Three levels (uniform in space,
no soil map is available): low (Ia 3 mm, f 5 mm/h), mid (8 mm, 15 mm/h), high (15 mm, 35 mm/h).

**Drainage capacity.** No storm-sewer network data is public. Drainage is represented as a **sink on urban drainage
cells** (WorldCover built-up ≥ 2 of 4 samples or building fraction ≥ 0.15; 636 km²) that removes up to **C mm/h**
of water (rain-equivalent over the whole cell) whenever water is present, including runoff arriving from upstream.
C = 0, 10, 20, 30, 40, 50, 60 mm/h. Anchor for the "current" range: Atlas Metropolitano de Riesgos AMG 2021 (IMEPLAN/
UNAM, pp. 108–109): collectors were designed for ≈50 mm/h with a runoff coefficient of 0.5 (≈25 mm/h over the area) and
are overwhelmed when rain exceeds ≈30 mm/h → we mark **20–30 mm/h as an inferred, unmeasured current range**.
**Spatially varied capacity (6 extra runs, Tr 2/10/100 × 20/40 mm/h, mid infiltration).** No public storm-sewer network
exists, but INEGI's *Inventario Nacional de Viviendas 2020* records per block whether its frontages have storm inlets
(infra-data agent, `inv_pluvial_*` in `ageb-profile.geojson`). Per AGEB, factor = (blocks with inlets on all frontages
+ 0.5 × on some) / evaluated blocks; each drainage cell gets C × factor (quantized to 1/15). 82 % of drainage cells fall
in AGEBs with INV data (mean factor 0.23: in the median AGEB 80 % of blocks have no inlet on any frontage); the rest keep
C. This is a presence proxy, not pipe capacity (water also reaches inlets on other blocks), so read it as a pessimistic
bound on how much the *distribution* of inlets matters. Per AGEB: `inlet_extra_flooded_share`.

**Storms.** Chen-formula IDF for Guadalajara station 14066 (Campos-Aranda 2010, *Ingeniería Investigación y
Tecnología* XI(2):179–188, Table 4: P₁¹⁰ = 64 mm, F = P₂₄¹⁰⁰/P₂₄¹⁰ = 123.4/91.2, a = 43.093, b = 11.831, c = 0.885):
i(t,Tr) = a·P₁¹⁰·[(2−F) + (F−1)·log₁₀Tr]/(t+b)^c. 60-min alternating-block hyetographs (5-min blocks, centred peak):
Tr 2/5/10/25/50/100 years → 47.3/56.1/62.8/71.6/78.3/84.9 mm. Point rainfall applied uniformly (no areal
reduction: conservative for local flooding, too much water for the whole metro at once). Tr 2 extrapolates below the
formula's stated 5–100-year range. 120 min simulated (60 min of rain + 60 min of drain-down). Cross-check: the infra-data
agent's `/labs/shared/infra/rain-idf.json` (published later) uses the same source and identical parameters; it notes
that the formula is derived from SCT isohyets + daily maxima, not Guadalajara pluviographs (errors of −30…+60 % at the
paper's validation sites). sim-hidro's IMTA-2017-based Tr 10 storm is 56 mm/60 min vs 62.8 mm here.

**Ensemble.** 6 storms × 7 capacities × 3 infiltration levels = 126 planned runs. Statistics use only (storm,
infiltration) combinations that are complete across all 7 capacities (balanced design); `stats.json → combos`.

**Indicators (per 20 m cell, excluding permanent water: WorldCover + OSM water bodies).**
- *Flooded* = maximum depth ≥ **15 cm** (kerb height; water enters properties).
- **Flood frequency** = share of ensemble runs in which the cell floods.
- **Drainage sensitivity** = mean over storms × infiltration of [h_max(C=0) − h_max(C=40)] / 4, in **cm less water per
  +10 mm/h** of capacity.
- **Infrastructure gap** (urban drainage cells only). f_low = flood frequency over runs with C ≤ 10 mm/h;
  f_high = over runs with C ≥ 40 mm/h.
  **a · persistente**: f_low ≥ 0.25 and f_high ≥ 0.5·f_low → floods even with high *distributed* capacity → storage
  (vasos reguladores), a concentrated conveyance (major collector or channel taking the accumulated upstream flow),
  regrading or relocation. Many class-a cells are street flow paths fed by large upstream areas and by the 5-min rain
  peaks (171–307 mm/h) that no distributed capacity can absorb; the model's uniform sink cannot represent a single big
  collector, so "a" means *not solved by more inlets/sewers of this kind*, not *unsolvable*. **b · responde al drenaje**: f_low ≥ 0.25 and f_high < 0.5·f_low → a drainage
  upgrade pays off. **c · rara vez**: f_low < 0.25.

## Validation (honest)

CPU reference vs WebGPU port (Tr 10, 0 mm/h, mid, 90 min): RMSE 0.21 mm, max |Δ| 41 mm, 0.001 % of cells differ by >1 cm, flooded area 237.20 vs 237.16 km², IoU 0.9997; identical step count. CPU mass residual 2.5e-8 (f64 budgets), GPU ≤ 3.3e-5 (f32 per-cell budgets).

Against IMEPLAN MUI 2026 observed flooding (footprints dilated 20 m; points with a 60 m radius). "Random" = the same footprints moved to random urban drainage cells (200 trials). Hit rates are inflated by footprint size because a large share of the city floods in some run; the **AUC** (max ensemble frequency inside the footprint, observed vs random placements; 0.5 = no skill) is the fairer number.

| set | n | AUC | mean max-frequency obs / random | hit (freq ≥60 %) obs / random | hit (gap a or b) obs / random |
|---|---|---|---|---|---|
| sitios (polígonos) | 288 | 0.669 | 0.918 / 0.685 | 0.92 / 0.685 (lift 1.34) | 0.951 / 0.722 |
| zonas críticas (polígonos) | 156 | 0.675 | 0.865 / 0.601 | 0.872 / 0.587 (lift 1.49) | 0.917 / 0.641 |
| puntos (radio 60 m) | 288 | 0.72 | 0.901 / 0.587 | 0.906 / 0.588 (lift 1.54) | 0.938 / 0.64 |

Gap class at observed points: a 171, b 99, c 16, outside urban cells 2 (urban area shares: a 0.113, b 0.087, c 0.8).

Read: the ensemble ranks observed flood sites above random urban locations, but only moderately; the inventory records where people reported flooding (often underpasses, kerb-level street flooding and blocked inlets the 20 m model cannot see) and is not a design-storm extent. For comparison, sim-relieve reports HAND AUC 0.79 with a different control set. No event-specific calibration was done.


## Files

| file | content |
|---|---|
| `stats.json` | design, IDF, hyetographs, per-run table (volumes, mass balance, flooded areas), performance curves, gap-class areas, validation, highlights |
| `tiles/freq/{z}/{x}/{y}.png` | display tiles z9–14: flood frequency (blue ramp, 5–20/20–40/40–60/60–80/≥80 %) |
| `tiles/gap/{z}/{x}/{y}.png` | infrastructure gap: a orange `#d95926`, b aqua `#199e70`, c faint gray |
| `tiles/sens/{z}/{x}/{y}.png` | drainage sensitivity (aqua, opacity ∝ 0.5/1/2/4/≥8 cm per 10 mm/h) |
| `routing-flood-frequency.geojson` | routing polygons: `class` alta (≥60 % of runs) / media (30–60 %), `label`, `score` (mean frequency 0–1), `depth_m_mean_tr10_c20`, `depth_m_max_tr10_c20`, `scenario`, `threshold_m` |
| `web/depth-tr{Tr}.png` | **data image** (not a picture): Web-Mercator, ~20 m/px, bounds in `stats.web.mercatorImage`. 24-bit value V = R·65536 + G·256 + B; depth class for capacity index k = (V >> 3k) & 7 (classes 0 <5 cm, 1 5–15, 2 15–30, 3 30–50, 4 50–100 cm, 5 1–2 m, 6 ≥2 m, 7 permanent water). Mid infiltration. |
| `web/freq-by-cap.png` | same packing; frequency class per capacity (0 <5 %, 1 5–20, 2 20–40, 3 40–60, 4 60–80, 5 ≥80 %) over all storms × infiltration |
| `web/indicators.png` | R = flood frequency % (255 = water), G = gap class (0 none, 1 a, 2 b, 3 c), B = sensitivity × 10 (cm per 10 mm/h, capped 25.5) |
| `web/frame-tNNN.png` | Tr 10, mid infiltration, depth class at minute NNN: R = 0 mm/h, G = 20 mm/h, B = 40 mm/h |
| `ageb-drainage.json` | per-AGEB aggregation keyed by CVEGEO (when the infra-data AGEB profile exists) |
| `grid-meta.json` | georeference of the 20 m grid and W10 paths of the full-resolution products |

Decode data images with `createImageBitmap(blob, {colorSpaceConversion: 'none', premultiplyAlpha: 'none'})`.

Full resolution on W10 (`C:\Users\Felip\contorno-compute\labs\sim-drenaje\`): `domain\` (20 m inputs), `runs\<id>.hmax.u16(.gz)`
(max depth, mm), `runs\<id>.json`, depth snapshots every 10 min for `tr10-c{0,20,40}-mid`, `products\grid\` (per-cell
indicators). Scripts: `aggregate.mjs`, `worldcover.mjs`, `prep-domain.mjs`, `solver.mjs`, `gpu-sim.html`,
`gpu-runner.mjs`, `gpu-loop.mjs`, `ensemble.mjs`, `post.mjs`, `compare.mjs` (copies on the VPS in
`/srv/contorno/data/guadalajara-flood-lab/work/sim-drenaje/src/`).

## Related

`sim-hidro` (5 m, same solver family, IMTA 2017 ZMG design hyetograph: 56 mm/60 min for Tr 10, one sewer rate 10 mm/h)
is the high-resolution single-scenario counterpart; its storms are ~10 % smaller than the Chen/Campos-Aranda storms used
here. `sim-relieve` gives terrain indices (HAND, depressions). They are not calibrated against each other.

## Limits (read before using)

- **No pipe network.** Drainage is a uniform sink; no inlet locations, pipe routing, surcharge, backflow, outfall
  levels, combined-sewer behaviour or blocked inlets. "C mm/h" is an abstraction of system capacity, not a design value.
- **20 m cells** do not resolve streets, kerbs or underpasses (see the router's `underpasses` layer for those).
  Porosity is a single isotropic factor per cell.
- **Terrain:** INEGI 5 m DTM is photogrammetric; bridges and culverts are absent, so water can pond behind road and
  rail embankments that actually have culverts. Some closed depressions in the Santiago canyon floor fill to many metres.
- No river base flow and no inflow from outside the domain; the Santiago and El Ahogado channels are just terrain.
- One storm duration (60 min), spatially uniform rain, uniform infiltration per scenario (no soil map).
- Threshold 15 cm is a convention; frequencies are shares of an ensemble design, **not annual probabilities**.
