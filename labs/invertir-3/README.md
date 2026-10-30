# Alcaldía por un día — `invertir-3` (cauce. labs)

**Live:** https://guadalajara.vsfelix.com/labs/invertir-3/ · demo: `?demo=1` · screenshot: `screenshot.jpg` (1600×1000, W10)

A cozy strategy toy for the "dónde invertir" question. The player gets **$2,000 millones de pesos**, picks one of five
flood works from a city-builder toolbar and drops it on an urban AGEB of the ZMG, drawn as a floating isometric diorama.
Each placement shows how many people stop living in the modeled flood zone, the cost per person, the facilities
(schools, childcare, clinics, hospitals, care homes) and the share of the benefit that reaches high-marginalization
AGEBs. A mascot (*Gota*, a raindrop in a hard hat) explains why a work fits or not, a reference "plan de Gota" (greedy
people-per-peso) scores the player, and the plan can be shared as a PNG card or a `#plan=` link.

On screen everywhere: **"Es un juguete para entender trade-offs, no una herramienta de planeación. Efectos y costos son
ilustrativos."** The model badge (top left) opens a "¿Cómo funciona?" sheet with the method, unit costs and sources.

## What the player learns (the trade-offs the model encodes)

- **Drainage vs storage.** sim-drenaje classifies urban cells as *responde al drenaje* (b: floods mostly at low drainage
  capacity) or *agua que se queda* (a: floods even at 40–60 mm/h). A colector reads the AGEB's own capacity curve from the
  ensemble, so it pays off in class b and barely moves class a; vasos and rain gardens remove a volume, so they work in
  class a. The inspector card shows the class and the sensitivity ("≈5 cm less water per +10 mm/h").
- **Cheap is not always good.** Pozos de absorción cost $10 M but add ~200 l/s, i.e. a couple of mm/h over an AGEB: a
  small effect on the storm peak (Gota says so). Reubicar is certain but costs ~$120k+ per person.
- **Efficiency vs equity.** With the final sim-drenaje ensemble (126 runs), the greedy reference plan for the full budget
  (26 works: 6 colectores, 16 vasos, 4 jardines) protects **≈48,100 people** at **≈$41,500 per person**, and only
  **0.3 %** of that benefit reaches AGEBs of high/very high marginalization, which hold **12.6 %** of the exposed
  population. The equity bar makes that visible; the scripted demo deliberately puts its rain garden in a
  high-marginalization AGEB (Santa Ana Tepetitlán) and ends at 5,063 people for $192 M with 6 % equity (87 % of the
  reference plan at the same spend, two stars).
- **Scale.** **≈692,000 people** live in AGEB area that floods ≥15 cm in the ensemble average at 20 mm/h; $2,000 M reaches
  about 7 % of them. The info sheet cites IMTA's estimate of >25,000 MDP of metropolitan stormwater needs.

## Data used (all loaded at runtime from `/labs/shared/`, except the prepared board)

| what | source | how it is used |
|---|---|---|
| AGEB polygons, population, households/occupancy, DENUE facilities, CONAPO IMU 2020 grade, IMEPLAN overlap, press points, underpasses, WorldCover green share | `/labs/shared/infra/ageb-profile.geojson` (infra-data) | board tiles (2,031 populated AGEBs), exposure, equity, facilities, vaso/jardín site factor, provisional model |
| per-AGEB drainage ensemble: `flooded_share_by_cap` (0–60 mm/h), `gap_class`, `drainage_sensitivity_cm_per_10mmh`, `area_urban_km2`; final-ensemble extras `population_benefit_0_to_40`, `rank_drainage_benefit`, `rank_residual_exposure`, `inlet_extra_flooded_share` | `/labs/shared/hazard/modeled/sim-drenaje/ageb-drainage.json` (126 runs, final) | **the effect model** (preferred source); colector candidates, inspector ranks and storm-inlet note |
| storm-inlet presence `inv_pct_sin_pluvial` | ageb-profile (INEGI INV 2020, republished by infra-data) | inspector fallback note when sim-drenaje has no inlet figure |
| ensemble data images `web/freq-by-cap.png`, `web/indicators.png` + `stats.json` (grid, curves, run count) | sim-drenaje | blue water layer per AGEB at its current capacity; fallback per-AGEB aggregation in the browser; mean flood depth (0.29 m) for storage → area |
| natural depressions per AGEB (`dep_vol_m3_ha`) | `/labs/shared/hazard/modeled/sim-relieve/ageb-terrain.json` | vaso efficiency (percentile rank) |
| IMEPLAN MUI 2026 points + "Referencia" text | `/labs/shared/hazard/observed-imeplan-2026.geojson` | red diamonds (observed, toggle) and street references in the inspector |
| OSM water bodies, major roads (router graph), place names | `/labs/shared/hazard/water-bodies.geojson`, `/labs/shared/router/data/graph.bin.gz`, OSM Jalisco extract (W10) | lakes, painted roads, colonia names (nearest OSM place node; approximate) |

**Model source switching (automatic).** At load the app tries, in order: (1) `ageb-drainage.json` → badge
"Modelo: sim-drenaje (N corridas)"; (2) aggregate sim-drenaje's published data images per AGEB in the browser (same
rule as sim-drenaje's final `post.mjs`, class c below 5 % a+b cells; on the preview data it matched the official table:
same top AGEBs, 629k vs 672k exposed) → yellow
badge "preliminar"; (3) observed-only heuristic → red badge **"Modelo provisional: solo lo observado"**. A normal session
also polls for `ageb-drainage.json` every 90 s and rebuilds the model in place (keeping the plan) when it appears.
`?modelo=observado` forces (3) for comparison. The JSON and images are re-read on every load (run count in the badge).

**Integration pass with the final ensemble (2026-10-30).** sim-drenaje finished 126 runs (+6 storm-inlet-weighted runs)
with the same 2427×3073 image grid and bounds, so `labels.png` is byte-identical after re-running `tools/prep.mjs`; the
re-run only refreshed `board.json` with infra-data's republished profile (same AGEB order, so `#plan=` links and demo
targets are unchanged; adds `inv_pct_sin_pluvial`). Gap classes now follow sim-drenaje's 5 % rule: 922 a / 618 b / 408 c
of its 1,948 AGEBs (902 / 614 / 397 among the 2,031 populated AGEBs drawn here; 118 have no urban sim cells).
`population_benefit_0_to_40` is used to **show where a colector is worth it**: with the colector selected, the 40 AGEBs
with most people taken out of the water when drainage goes 0→40 mm/h get a dashed green outline, the preview shows a
"top 10/40 drenaje" tag, Gota praises a pick in that list, and the demo's colector target is restricted to the top 60
(it already was #3: Jardines de San José). It is not used as the colector's effect, because it measures 0→40 mm/h while
the game starts from 20 mm/h; the effect still comes from the same per-AGEB curve (`flooded_share_by_cap`).

## Effect model (illustrative; `js/model.js`)

- Exposure of AGEB *i*: `E = población × s(C)`, where `s(C)` = share of its urban area flooded ≥15 cm, ensemble mean, at
  drainage capacity C (sim-drenaje). **Current capacity C₀ = 20 mm/h** (low end of sim-drenaje's inferred 20–30 mm/h).
- **Capacity works** add `ΔC = 3.6·Q / área urbana (km²)` mm/h (Q in m³/s), capped at 60: colector Q = 3 m³/s, pozos
  Q = 0.2 m³/s (4 wells × 50 l/s, optimistic). New share = curve at C₀+ΔC.
- **Storage works** remove flooded area = `V × η / d̄`, d̄ = mean depth of the modeled flooded urban area (0.29 m, from
  sim-drenaje volume/area at C₀). Vaso: V = 60,000 m³, η = 0.6·(0.7+0.3·verde)·(0.8+0.4·depresión) shared with AGEBs within
  1.5 km (host weight 1.6, others linear decay), capped by their remaining flooded area. Jardín: V = 10,000 m³,
  η = 0.6·(0.6+0.4·verde), host only.
- **Reubicar** removes up to 100 × occupants-per-dwelling exposed people from the AGEB (no change to the water).
- Facilities protected = facilities × reduction of the flooded share (expected value, shown as "≈").
- One work of each type per AGEB. Evaluation is a pure function of the ordered plan (capacity first, then storage in
  order, then relocation), so undo, share links and the demo are deterministic.
- **Plan de Gota**: greedy, each step the (tool, AGEB) with most people per peso; its spend→people curve is the
  "mismo gasto" yardstick for the stars (≥90 % ★★★, ≥65 % ★★, ≥35 % ★). "¿Dónde invertiría Gota?" draws its next 12
  picks for the remaining budget as numbered ghost pieces — the direct "where to invest" answer of this toy.

### Costos unitarios (orders of magnitude from public notes, not budgets)

| obra (game unit) | costo | referencia |
|---|---|---|
| Colector pluvial (1 km, ≈3 m³/s) | $65 M | Colector Villa Fontana: 36.2 MDP for ~570 m of prestressed concrete pipe ≈ 63 MDP/km (Plan Integral del Agua, Jalisco, https://planintegraldelagua.jalisco.gob.mx/pdf/an-0030.pdf); context: Juan de la Barrera/Ojo de Agua 160 MDP incl. 2.2 km storm network (Crónica 2026-08-11) |
| Vaso regulador (60,000 m³) | $95 M | Gran Parque Zapopan Sur, stage 1: 100 MDP for 4 tanks, 62,000 m³ (Siker 2025-03-11) ≈ 1,600 $/m³; also El Deán expansion 76 MDP (Informador 2025-05-11), Zapopan 12 vasos >300 MDP (Informador 2024-08-02) |
| Jardín de lluvia (10,000 m³) | $22 M | Jardín de Lluvia de Coapa, CDMX: 22 MDP, >10 million litres (Crónica 2026-03-19) |
| Pozos de absorción (4) | $10 M | Alcaldía Iztapalapa 2025: 3 pozos de infiltración pluvial for 7.2 MDP ≈ 2.4 MDP each (boletín 276/130625); CDMX 2014: 13 pozos 58 MDP |
| Reubicar 100 viviendas | $60 M | Vivienda para el Bienestar ≈ 600 mil pesos per dwelling (Infonavit/Conavi 2025 press); land, demolition and social cost not included |

Most Jalisco figures come from infra-data's compilation `work/infra-data/research/pluvial-works.json` (sources and
dates per work). Effects (Q, η, radius) are game assumptions and are labelled as such on screen.

## Look and interaction

- Custom Canvas 2D renderer (`js/board.js`), no map library: Web-Mercator world metres, rotated 28°, tilted (0.6),
  extruded AGEB tiles on floating "islands" (marching-squares blob around the urban fabric, soil walls), painted roads,
  OSM lakes, sim-drenaje water drawn affinely from its Mercator data image, trees when zoomed in. The static layer is
  cached as a bitmap (pan/zoom are a uniform scale + shift of it) and re-rendered when the view settles.
- Pieces drop with squash/bounce, dust, sparkles, coins fly from the purse, "+N personas" floats up, the water in the
  affected AGEBs fades to the new capacity, the score counts up, stars pop.
- Map modes: **Agua** (modeled frequency), **Riesgo** (exposed people per km²), **Marginación** (CONAPO grade); IMEPLAN
  observed points toggle; three "!" markers = most exposed untouched AGEBs.
- Colector selected: dashed green outlines on the 40 AGEBs where sim-drenaje's `population_benefit_0_to_40` is
  largest ("dónde vale la pena un colector"). Inspector adds the drainage-benefit rank (#n of 1,948) and the storm-inlet
  note.
- Desktop (≥720 px): hover previews ("+1,866 personas · $34,837 por persona · +23 mm/h en 48 ha"), click builds; keys 1–5,
  Esc, ± zoom. Phone (390×844): tap selects and flies the AGEB above a bottom sheet with "Construir aquí"; score as a chip
  that opens a sheet; scrollable toolbar.
- Share card: 1200×660 PNG drawn on canvas (mini diorama, totals, stars, sources, disclaimer) + `#plan=` link
  (`c|v|j|p|r` + AGEB index base-36, `.`-separated).

## Demo mode

`?demo=1` autoplays a 25 s loop; `?demo=1&autoplay=0` waits for seeks. `window.__cauceDemo = { duration_s: 25, ready,
seek(t), steps }`; `seek(t)` rebuilds the plan state for time t, renders the frame at full quality (no cache) and resolves
after the next animation frame (~0.2–0.8 s per 1600×1000 frame on W10). Script: title card (0–2.6 s, rain) → fly to a
class-a AGEB, select **vaso** and place it (5.4 s) → **colector** in a class-b AGEB (10.4 s) → **jardín** in a
high-marginalization AGEB (14.4 s, equity bar moves) → **pozos** (18.2 s, small effect) → pull back (21 s) → plan card
(21–25 s). Targets are chosen from the data at load (best people-per-peso for each tool near the core), so they follow
model updates deterministically; `__cauceDemo.steps` lists them. CSS transitions/animations are disabled in demo mode;
everything (camera, hand cursor, counters, bubbles, card) is a function of t.

## Files

- `index.html`, `style.css`, `js/app.js` (UI, state, demo, card), `js/board.js` (renderer + water layer),
  `js/model.js` (effect model, greedy, plan codec), `js/art.js` (SVG art).
- `data/board.json` (1.3 MB: simplified AGEB geometry in world metres + fields, islands, roads, lakes, IMEPLAN points,
  municipality labels), `data/labels.png` (AGEB index on sim-drenaje's 2427×3073 Mercator image grid).
- `tools/prep.mjs` (builds `data/` on the VPS from shared files; `node prep.mjs` from a folder with `in/places.json` and
  `pngjs`), `tools/places.mjs` (OSM place names, run on W10 next to `labs/router/pbf.mjs`), `tools/ishot.mjs` (W10
  screenshot/seek helper), `tools/test-model.mjs` (Node check of the model and greedy plan).
- Work copies: VPS `/srv/contorno/data/guadalajara-flood-lab/work/invertir-3/`, W10
  `C:\Users\Felip\contorno-compute\labs\invertir-3\` (shots, helper scripts).

## Limits

- Not a planning tool: no pipe network (capacity is a uniform number per AGEB), no downstream effects of colectores,
  no land availability, maintenance, timing, operating costs or social cost of relocation. Storage efficiency and the
  1.5 km vaso reach are assumptions. Costs are orders of magnitude from press/official notes.
- "Personas protegidas" is an ensemble-average expected value of people whose AGEB share stops flooding ≥15 cm, assuming
  people are spread uniformly over the AGEB's urban cells. sim-drenaje (126 runs: 6 storms × 7 capacities × 3
  infiltration levels) is exploratory, not a forecast; its IMEPLAN check gives AUC 0.67–0.72. Its storm-inlet-weighted
  runs suggest uniform capacity is optimistic (+12–28 km² flooded), which this toy does not include in the effects.
- 37 AGEBs with zero population are not drawn; 118 drawn AGEBs have no sim-drenaje urban cells (treated as not flooding).
- Colonia names are the nearest OSM place node (inside the AGEB or within 1.2 km): approximate; otherwise the AGEB key.
- The water layer needs `labels.png` to match sim-drenaje's image grid (2427×3073 now); if sim-drenaje changes its grid,
  re-run `tools/prep.mjs` (the effect model keeps working from `ageb-drainage.json` regardless).
