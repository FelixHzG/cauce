# invertir-1 — "Dónde se cruzan el agua y la necesidad" (cauce. labs)

Editorial priority atlas for the **dónde invertir** question: which urban AGEBs of the Zona Metropolitana de Guadalajara
combine the most evidence of flooding with the most people exposed and the least capacity to recover.
Live: `/labs/invertir-1/` · demo: `/labs/invertir-1/?demo=1` · screenshot: `screenshot.jpg` (W10, 1600×1000).

**Exploratory, not official, not an investment recommendation.** The page says so in the footer, the method drawer and
the legend; modelled inputs are hatched and tagged `MODELADO`, observed ones solid `OBSERVADO`.

## Concept

Data-journalism look (paper, ink, serif headlines): a 3D map where every AGEB

- **rises** by *people exposed* — default: population × share of the AGEB inside IMEPLAN flood polygons (observed);
  switchable to people exposed in the sim-drenaje model (Tr 10, 20 mm/h) or total population. Height is a count of
  people, never relief; the legend says so.
- is **coloured** by a 3×3 bivariate scheme: hazard **P** (water ramp) × vulnerability **V** (rose ramp), multiply
  blended so "both high" is a deep ink-indigo.

Around it: "Las 25 zonas más urgentes" (cards with rank, name, people exposed, a small-multiple bar per factor
percentile — cyan = hazard, hatched = modelled, ochre = exposure, rose = vulnerability — and Δ vs. the balanced
weights), a municipality filter (ranks within the municipality, dims the rest), **¿Por qué aquí?** (rank, KPIs, a
generated sentence, the formula with this AGEB's numbers, stacked contribution bars and a percentile strip per factor,
the IMEPLAN records with street references, DENUE facilities inside the registered polygons, what the models say), and
**Pesos y fórmula** (three presets, group and factor sliders, live formula). Zooming in past ~z13 the towers sink and the
map turns into a street-level view: the selected AGEB outlined, IMEPLAN polygons hatched (critical zones darker),
schools (ochre) and health/care (white) dots. Height mode, municipality, weights and selection are kept in the URL hash
(shareable). "CSV" downloads the current ranking with every percentile.

## The index (shown on screen in full)

```
Prioridad = 100 · P^a · E^b · V^c        (a + b + c = 1; default a = .50, b = .20, c = .30)
P, E, V   = Σ wᵢ·pᵢ / Σ wᵢ              (weighted mean of factor percentiles, 0–1, among the 2,031 inhabited AGEBs)
```

A weighted **geometric** mean (CENAPRED's riesgo = peligro × exposición × vulnerabilidad): an AGEB with no recorded
or modelled water has P = 0 and priority 0, however poor it is. Zero-means-nothing factors keep 0 at 0 and rank
positives into 0.05–1. Missing values drop that factor for that AGEB and the group weights renormalise. AGEBs with
< 100 inhabitants are mapped but not ranked. Presets: *Equilibrado* (.50/.20/.30), *Primero el agua* (.75/.10/.15),
*Primero la gente* (.30/.25/.45 with marginación 4, dependientes 2).

| group | factor (default weight) | source | kind |
|---|---|---|---|
| P | Inundación registrada: % area in IMEPLAN sitios + zonas críticas (zonas count double) (3) | IMEPLAN MUI 2026 | observado |
| P | Prensa + pasos a desnivel (0.5) | press compilation, OSM underpasses (router) | reportado |
| P | Reportes municipales GDL 2010–22 (0) / Llamadas Zapopan 2017–25 (0) | municipal atlases via infra-data | observado, **off by default**: exist for two municipalities only |
| P | Inundación modelada (drenaje): `flood_frequency` (1) | `/labs/shared/hazard/modeled/sim-drenaje/ageb-drainage.json` | modelado |
| P | Susceptibilidad del relieve: `susc_mean` (0.75) | `/labs/shared/hazard/modeled/sim-relieve/ageb-terrain.json` | modelado |
| P | Inundación modelada 5 m Tr 10: `share_ge15` (1.25) | sim-hidro polygons, joined here (`data/ageb-hidro.json`) | modelado |
| E | Densidad de población (2) | INEGI Censo 2020 | censo |
| E | Escuelas, guarderías, hospitales, clínicas, residencias (1) | INEGI DENUE | registro |
| V | Marginación urbana, 1 − IMN (3) | CONAPO IMU 2020 | censo |
| V | Niñez + vejez + discapacidad (1) | Censo 2020 | censo |
| V | Hogares sin auto (1) (values outside 0–100 in the source treated as missing) | Censo 2020 | censo |
| V | Manzanas sin coladera pluvial `inv_pct_sin_pluvial` (2) | INEGI INV 2020 via infra-data | censo |
| V | Suelo sellado `builtup_pct` (1) | ESA WorldCover 2021 | satélite |

"Solo peligro observado" sets every modelled weight to 0 (observed-only mode: 509 ranked AGEBs instead of 1,848, and
the colour key switches to "sin peligro registrado").

## Plug-in behaviour (degrades gracefully)

- **AGEB profile**: loads `data/agebs.json` (a gzip-served copy, 0.7 MB on the wire instead of 5 MB) and HEAD-checks
  `/labs/shared/infra/ageb-profile.geojson`; if the shared file is newer or a different size, the shared one is loaded
  instead. This is how the INEGI INV storm-inlet factor switched itself on when infra-data republished.
- **Simulation joins**: each entry in `JOINS` (`js/app.js`) is fetched at start; when it answers, it becomes a modelled
  P factor automatically (field picked from a preference list, coverage shown). If it is missing or 403 the factor is
  simply absent and the data-status card says "no disponible". sim-drenaje's file is read live, so more ensemble runs
  show up without touching this folder.
- If `ageb-extras.json` is missing the cards fall back to AGEB codes; if facilities fail, the dots are absent.

## Data products (this folder)

| file | what | rebuild |
|---|---|---|
| `data/agebs.json` | copy of the shared AGEB profile, coords rounded to 1e-5° | `node tools/build-extras.mjs` |
| `data/ageb-extras.json` | per AGEB: label point, reference name (CONAPO colonia with ≥ 15 % of the AGEB, else nearest OSM place ≤ 1.5 km), IMEPLAN site details (street reference, category, height range, critical-zone motive), DENUE facilities inside IMEPLAN polygons | same |
| `data/ageb-hidro.json` | per-AGEB share of area with modelled max depth ≥ 15/30/60 cm, sim-hidro T10 (25 m sampling of its routing polygons; 1,877 AGEBs inside the simulated rectangle; AUC 0.69 vs IMEPLAN presence; Spearman 0.81 vs sim-drenaje) | `node tools/join-hidro.mjs T10` |

Inputs read by the build: shared AGEB profile, IMEPLAN, DENUE facilities, `work/infra-data/out/colonias-imc2020.geojson`
(CONAPO colonias, names only), `work/invertir-1/osm-places.json` + `osm-resid.json` (Overpass, 2026-10-30).
Tools: `tools/shot.mjs` (W10 screenshots / demo seek), `tools/interact.mjs` (W10 click-through check). Scripts are Node.

## Demo mode

`?demo=1` hides the zoom control and hover tooltip and autoplays a 25 s loop (`&autoplay=0` to start paused).
`window.__cauceDemo = { duration_s: 25, seek(t), play(), pause() }`; `seek(t)` sets every piece of state from `t` alone
(camera, weights, list positions, tabs, captions) and resolves after the map is idle plus two frames.

| t (s) | chapter |
|---|---|
| 0–4.6 | **1 · El mapa** — slow orbit, towers grow in, caption explains height and colour |
| 4.6–10.4 | **2 · Las más urgentes** — framing of the top 5, ranks 1–5 pulse on map and list |
| 10.4–17.4 | **3 · ¿Por qué aquí?** — fly to #1, towers sink, IMEPLAN hatch + facilities, panel bars grow |
| 17.4–25 | **4 · Tú decides los pesos** — *Primero la gente* animates in the weights tab, the list reorders (▲/▼), the caption names the AGEB that climbs most into the visible top |

Captions are computed from the data (names, ranks, counts), so they stay true when inputs change. Phone (390×844) uses
the same timeline with the caption on top of the map and the bottom sheet switching Ranking → ¿Por qué? → Pesos → Ranking.
W10 Chromium: 30–40 fps at 1920×1080 in autoplay; a seek takes 0.2–9 s depending on tile loading.

## Decisions

- Geometric mean, not a weighted sum: "most need investment AND most flood-prone" should require both; a sum lets
  marginalised but dry AGEBs top the list.
- Models on by default (the brief asked for automatic plug-in) but weighted below observed evidence (3.0 vs 3.5 of P).
- Municipal incident series off by default: turning them on rewards the two municipalities that publish records.
- No terrain mesh: towers stand on a flat plane with the INEGI hillshade as texture; tower height is people, and the
  terrain agent's DTM stays honest at exaggeration 1 elsewhere. No MapLibre padding (padding + pitch dropped far
  tiles); the map canvas sits between the panels instead. A paper gradient fades the horizon.
- Names: CONAPO colonia polygons (official names, 2,016 AGEBs) with OSM fallback (36); 16 unnamed show the AGEB code.
  Duplicate names in the list get the AGEB code appended.
- Self-hosted fonts (Instrument Serif, Libre Franklin, IBM Plex Mono — SIL OFL) for deterministic filming.

## Limits

- The index cannot see storm-sewer capacity or condition (no public network), the upstream catchment that sends the
  water, costs or works in progress. Observed inventories favour places where people report.
- "People exposed" assumes population spread evenly over the AGEB.
- Census and CONAPO are 2020; fast-growing Tlajomulco / Zapopan periphery may be under-represented.
- IMEPLAN "Altura máxima reportada" has no unit in the source (probably cm) — shown verbatim with an asterisk.
- The sim-hidro join is derived from simplified routing polygons, not the 5 m raster; sim-drenaje currently has 21 of
  126 runs; sim-relieve is calibrated on IMEPLAN sites, so it is not independent of the observed factor.
- DENUE facility names have encoding damage, so only counts are shown.

## Attribution

INEGI (Censo 2020, Marco Geoestadístico 2020, DENUE, INV 2020, MDT 5 m hillshade via the terrain agent), CONAPO (IMU 2020,
IMC 2020), IMEPLAN MUI 2026, Atlas de Riesgos de Guadalajara / Gobierno de Zapopan (via infra-data), ESA WorldCover 2021
(CC BY 4.0), © OpenStreetMap contributors (ODbL) via OpenFreeMap, cauce. simulations (sim-drenaje, sim-relieve,
sim-hidro; exploratory). MapLibre GL 5.20.0 (unpkg).
