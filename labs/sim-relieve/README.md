# cauce. relieve — ¿dónde se junta el agua?

Viewer for the `sim-relieve` static terrain analysis (5 m, whole AOI) and the test of the owner's hypothesis
*"en mi pueblo se inundan las zonas planas; seguramente aquí también"*. Spanish UI, MapLibre GL 5.20.0.
Data products and full method: `/labs/shared/hazard/modeled/sim-relieve/README.md` (numbers in `stats.json`).

## Concept

A dark topographic "night atlas": INEGI 5 m hillshade under one glowing terrain index at a time, the IMEPLAN observed
sites in coral on top, and a side panel that answers the question with the actual test.

- **Índice switcher**: Relieve (hillshade only) · Flujo (D8 upslope area, building-aware) · Depresiones (fill depth ≥ 10 cm)
  · Altura sobre el cauce (HAND) · Planitud (slope over ~175 m) · Susceptibilidad (0–1 model score). Each has a legend with
  the exact tile palette, ticks in real units, and a one-paragraph explanation.
- **Capas de referencia**: IMEPLAN MUI 2026 observed polygons/points (coral, tagged *observado*), the routing polygons of
  the active index (depressions or high susceptibility outlines; depressions GeoJSON is 10.9 MB so it loads on first use),
  optional 3D terrain (exaggeration 1, as required).
- **Panel "¿Lo plano se inunda?"**: verdict built from `stats.json`; a 2×2 grid (flat/steep × low/high HAND) with the ratio
  of flood-site share to area share; an AUC bar chart (flatness bars amber, HAND cyan, others neutral, model white, with
  bootstrap CIs and the 0.5 "azar" line); a decile chart (log y, 1 = urban average) for flatness vs HAND; the independent
  Zapopan check; a collapsible method table with every index.
- Click on a polygon for its properties (IMEPLAN: name, regime, reported depths; depressions: max depth, volume, catchment,
  rain to fill; susceptibility class).

## Answer shown (from `stats.json`)

"En parte — pero no por ser planas: **por estar bajas**." Flattest 10 % of the urban fabric: 2.5× the expected sites, but
within HAND strata flatness AUC is 0.49–0.57 and removing it from the model leaves spatial-CV AUC at 0.807 (0.808 with it).
HAND alone: AUC 0.79. Street-scale slope: 0.49. Low & steep 5.3×, low & flat 4.2×, high & flat 0.74×, high & steep 0.39×.

## Demo mode (filming)

`?demo=1` hides the dev chrome (layer panel, nav control, tabs), turns on 3D terrain (exaggeration 1) and autoplays a 26 s
sequence: overview of the flow network (0–5 s) → street-level flow in western Guadalajara (5–9.5 s) → depressions along
Calzada Independencia with IMEPLAN sites (9.5–14.5 s) → HAND, pulling back (14.5–19 s) → susceptibility + the answer panel
sliding in (19–26 s). Captions are in Spanish.

`window.__cauceDemo = { duration_s: 26, seek(t) }`: `seek` jumps the camera, layer cross-fades, captions and panel to
time *t* and resolves after `map.loaded() && map.areTilesLoaded()` plus two animation frames (30 s cap). Add
`&autoplay=0` (optionally `&t=12`) to stop the autoplay and drive it only with `seek`. Example capture script used on W10:
`C:\Users\Felip\contorno-compute\labs\sim-relieve\demoshots.mjs <url> <prefix> 1920 1080 2,7,12,16.5,23`.
Note: tiles come from the VPS to W10 at ~50–100 KB/s per request, so the first seek at a new place can take 5–12 s; later
frames hit the browser cache.

## Data used

- Modeled (this agent): `/labs/shared/hazard/modeled/sim-relieve/tiles/*`, `depresiones.geojson`,
  `susceptibilidad-alta.geojson`, `stats.json`.
- Observed: `/labs/shared/hazard/observed-imeplan-2026.geojson` (IMEPLAN MUI 2026). Zapopan civil-protection calls
  (infra-data agent) only as numbers in the panel.
- Terrain: `/labs/shared/terrain/dtm/{z}/{x}/{y}.png` (terrain agent, INEGI 5 m, terrarium encoding) for hillshade and 3D.
- Basemap: OpenFreeMap vector tiles (OpenStreetMap), own minimal dark style; fonts Fraunces, IBM Plex Sans/Mono
  (fontsource via jsDelivr, pinned 5.1.0).

## Limitations (also on screen)

Static terrain only: no rain, infiltration, sewers, culverts or bridges; DTM is photogrammetric; buildings by cell centre;
IMEPLAN is a reported inventory; the susceptibility score is a relative rank, not a probability or a depth. Tiles stop at
the AOI edge. On phones the two panels become a bottom sheet with tabs.

`screenshot.jpg`: 1600×1000, HAND layer, taken on W10 (Chromium, D3D11).
