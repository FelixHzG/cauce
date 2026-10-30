# cauce. labs · Drenaje: ¿dónde sí ayuda?

Viewer for the `sim-drenaje` ensemble. Spanish UI, MapLibre GL 5.20 (unpkg), OpenFreeMap vector tiles,
AWS Terrain Tiles (hillshade + 3D terrain, exaggeration 1). Data and full method:
`/labs/shared/hazard/modeled/sim-drenaje/README.md`.

## Concept

Flood maps usually answer "how deep". This one answers an infrastructure question: **where does more drainage
capacity remove flooding, and where it does not** (those places need storage, regrading or relocation).
The capacity slider swaps **precomputed** model runs (0–60 mm/h, 7 steps), so people see drainage changing the map.
Nothing is simulated in the browser.

Modes:
- **Agua** — maximum simulated depth for the chosen storm (Tr 2…100 years, 60 min) and capacity (mid infiltration).
  "▶ minuto a minuto" animates the Tr 10 storm every 10 minutes (capacity 0/20/40 mm/h, nearest to the slider).
- **Frecuencia** — share of ensemble runs (storms × infiltration) flooding ≥15 cm at the chosen capacity.
- **Brecha** — infrastructure-gap class: **a (naranja)** floods even with ≥40 mm/h of *distributed* capacity → storage (vasos reguladores), a major collector/channel, regrading or relocation;
  **b (verde-agua)** floods at low capacity and dries with more → drainage upgrade pays off; c rarely floods.
- **Sensibilidad** — cm less water per +10 mm/h of capacity.
- **AGEB** — census-tract aggregation of the same cells (`ageb-drainage.json` × infra-data `ageb-profile.geojson`);
  click an AGEB for population (Censo 2020), flooded share at 0 vs 40 mm/h, people taken out of flooded cells and
  the effect of weighting capacity by real storm-inlet presence (INEGI INV 2020 scenario).

The chart is the "performance curve": urban area flooded ≥15 cm vs capacity, one line per storm (ordinal blue ramp),
band = infiltration uncertainty (low–high) for the selected storm, amber band = inferred current capacity (20–30 mm/h).
Click the map for a cell probe (frequency, class, sensitivity). Observed IMEPLAN sites are hollow white rings — a
separate, real dataset, never mixed with the model colours.

## Decisions

- Data images (`web/*.png`) pack 7 capacity levels × 3-bit classes into RGB, decoded client-side with
  `createImageBitmap(..., {colorSpaceConversion:'none'})` and recoloured into a MapLibre `canvas` source:
  one 4 MB download per storm instead of 7 overlays. Phones decode at half resolution.
- Palette from the dataviz reference: blue sequential ramp (deeper/more frequent = lighter on the dark map);
  gap classes orange `#d95926` / aqua `#199e70` (validated all-pairs on dark, CVD ΔE 9.4); observed sites white rings.
- Honesty copy on screen: "Modelo exploratorio… no hay red de colectores real. No es pronóstico."; current capacity
  band labelled "inferida, no medida".

## Deep links

`?mode=depth|freq|gap|sens|ageb&tr=10&cap=20&ll=-103.35,20.66&z=12.5&pitch=50&bearing=10` opens a given view
(capacity must be one of the modeled steps).

## Demo mode

`?demo=1` autoplays a 32 s sequence (storm minute by minute at 0 mm/h → capacity sweep 0→60 mm/h → Tr 100 at 60 mm/h
→ gap classes, fly to the top class-a and class-b 1 km windows from `stats.highlights` → observed sites + validation
AUC → zoom out). `?demo=1&t=12.5` freezes at a time. The panel stays (it is part of the story) but is not interactive;
navigation controls and the loading pill are hidden.

```js
await window.__cauceDemo.seek(t) // renders the frame at t seconds (waits for data + tiles), resolves after paint
window.__cauceDemo.duration_s     // 32
window.__cauceDemoReady           // true once the hook is installed
```

State is a pure function of t (camera keyframes with smoothstep easing), so captures are deterministic.

## Limitations

See the product README. In short: 20 m cells, drainage as a uniform sink (no pipe network), photogrammetric DTM without
culverts, uniform design storms, one duration. Frequencies are shares of an ensemble design, not annual probabilities.

Attribution: OpenFreeMap © OpenMapTiles © OpenStreetMap · AWS Terrain Tiles · INEGI MDT/MDS 5 m · ESA WorldCover 2021 ·
Overture Maps buildings · IMEPLAN MUI 2026 · IDF Campos-Aranda (2010) · INEGI Censo 2020 (AGEB).
