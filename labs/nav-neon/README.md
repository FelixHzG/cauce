# cauce. · nav-neon — navegación en tormenta (prototype)

Live: https://guadalajara.vsfelix.com/labs/nav-neon/ · demo: `?demo=1` · screenshot: `screenshot.jpg` (W10, 1600×1000, demo t = 9.2 s).

Art direction: **stormy night, neon HUD**. A dark, wet Guadalajara (OpenFreeMap vectors restyled: navy roads with
sodium-orange bloom, purple extruded buildings, horizon fog), heavy screen-space rain with lens drops and two lightning
strikes, a procedural neon coupé with headlight beams, light pools, under-glow, tail-light trails and wheel spray, glowing
route lines, chevrons running ahead of the car, IMEPLAN polygons rendered as rippling "puddles" with light pillars and
pulsing rings, and a game HUD (maneuver banner, speedometer, ETA bar with hazard ticks, rain gauge, water radar).

## What it shows

Route A → B by car that avoids registered flooding, Waze-style:

- **Ruta más rápida** (red dashed): `router.route(A, B, {hazardIds, compare:true}).normal`. Segments inside IMEPLAN
  polygons glow.
- **Ruta segura cauce.** (cyan): the router's `safe` route. If it still crosses a registered *zona crítica* or
  *paso a desnivel* more than 1.5 km ahead, the app **blocks that place** (`avoid` = its IMEPLAN polygons) and re-routes
  from 1.2 / 2.0 / 2.6 km before it, keeping the quickest option. That is the "RECALCULANDO" moment.
- Alerts (cards + banner + radar), built from the real polygons along the driven route:
  - `Encharcamiento registrado` = IMEPLAN *Sitio inundable* (blue), with the IMEPLAN street reference and the registered
    height range in cm (from the matching category point, e.g. "Av. 16 de Septiembre frente a Walmart · 30–60 cm").
  - `Zona crítica IMEPLAN` = *Zonas Críticas* polygon (magenta).
  - `Paso a desnivel inundable` = IMEPLAN feature whose motive/infrastructure mentions *desnivel* (amber).
  - scopes: *en tu ruta · buscando otra* (before a reroute), *en tu ruta · sin desvío* (the router found no reasonable
    alternative: speed drops to 18 km/h, banner says "Cruza despacio"), *a un costado · precaución* (critical/underpass
    ≤ 90 m from the route).
- End card: fastest vs safe (km, min, +min, how many registered places each crosses) and what was avoided.

Default demo route: **Glorieta Minerva (-103.3925, 20.6743) → Aeropuerto GDL (-103.3111, 20.5218)**. Kept as given: with
the real router it tells the story well — the fastest route (Av. de los Arcos → Lázaro Cárdenas) crosses 8 registered
places (incl. Paso a desnivel Glorieta Arcos del Milenio, Colón y Lázaro, Zona Industrial calles 10–22); the safe route
crosses 2; the reroute then blocks **Paso a desnivel Héroes Ferrocarrileros (frente a UTEG), SI-GDL-031** and the trip
ends crossing only **La Piedrera (SI-SLT-005)** on Av. Solidaridad Iberoamericana, flagged "sin desvío razonable".
Totals (router, 2026-10-29): fastest 28.2 km / 33 min; driven 30.7 km / 41 min (+8 min); 7 of 8 avoided.

## Demo mode (filming)

`?demo=1` autoplays 25 s (loops after a 3 s hold) with dev chrome hidden. Ready when `window.__cauceDemo` exists
(on W10 that takes ~15–25 s: the router graph is ~5 MB served at ~0.5 MB/s).

```js
window.__cauceDemo = { duration_s: 25, seek(t) /* Promise, resolves after frame t is rendered and tiles are loaded */, play(), pause(), trip, timeline /* [{t,type,scope,places}] */ }
```

Everything on screen is a pure function of t (camera, car, rain, lightning, alerts, cards, labels), so `seek(t)` is
deterministic. Timeline (times adapt to the computed route):

| t (s) | phase |
|---|---|
| 0–1.0 | full-trip overview, title "Llegar sin cruzar el agua", fastest vs safe card |
| 1.0–3.5 | glide to the part of the city where fastest and safe differ (labels on the crossed places) |
| 3.5–5.4 | dive to the car (departure hyperlapse) |
| 5.4–12.6 | street-level follow, heading-up, pitch ≈ 60°; **alert 1** (paso a desnivel ahead) ≈ 6.3 s, **reroute** ≈ 8.6 s, camera lifts to show the fork |
| 12.6–16.9 | hyperlapse (zoom out with speed, chevrons and long tail-light streaks) |
| 16.9–21.2 | street level again; **alert 2** ≈ 17.6 s: "Encharcamiento en tu ruta · La Piedrera · sin desvío", car crosses the rippling polygon at 18 km/h; **alert 3** ≈ 20.1 s: zona crítica SI-SLT-013 a un costado |
| 21.2–25 | arrival, pull back to the overview, end card with what was avoided |

Extra URL params: `?t=12.5` (freeze at t), `?router=snapshot` (use the stored OSRM snapshot instead of the live router),
`?layers=id1,id2` (routing/alert layers; demo default is `observed-imeplan-2026` only so the film does not change when
other layers are registered), `?route=chapultepec-plaza-sol|centro-tlaquepaque` (other presets).

Capture recipe used on W10 (`C:\Users\Felip\contorno-compute\labs\nav-neon\cap.mjs`):
`node cap.mjs "https://guadalajara.vsfelix.com/labs/nav-neon/?demo=1" out 1920 1080 0,0.5,1 800` → `out_<t>.jpg`.

## Interactive mode (no `?demo`)

Panel "Ruta y escenario": presets, *Elegir origen y destino en el mapa* (two clicks), rain chips, one checkbox per layer
in `/labs/shared/hazard/index.json` (drawn + passed to the router as `hazardIds`), ▶ Conducir (real-time follow drive,
×10/×30/×80), Vista general, link to the demo. Phone: bottom sheet.

## Data and sources

- Basemap: OpenFreeMap `planet` vector tiles (OpenMapTiles schema, © OpenStreetMap contributors) with a custom night
  style; glyphs from OpenFreeMap. Hillshade from AWS Terrain Tiles (Terrarium) for texture only.
- Hazards: everything in `/labs/shared/hazard/index.json`, loaded at runtime:
  - `observed-imeplan-2026` (IMEPLAN MUI 2026, 498 polygons + 310 points): routing, alerts, beacons, radar.
  - `underpasses` (router agent, OSM, kind `hotspot`): dashed amber lines + hollow radar diamonds; **never shown as
    observed** and never alerted; passed to the router in interactive mode.
  - `water-bodies` (router agent, OSM, kind `water`): faint fill; passed to the router in interactive mode.
  - `modeled` layers (none yet): GeoJSON polygons are drawn lime-dashed and alerted as "Agua modelada" with
    `depth_m_min/max` and "modelo exploratorio"; raster tiles are drawn only; vector tiles need `sourceLayer`. Rain chips
    select modeled layers whose metadata (`rain_mm_h`, `scenario.rain_mm_h`, or "NN mm/h" in the label) is closest.
- Routing: `/labs/shared/router/router.js` — live `cauce-router/1.0.0 (OSM 2026-10-29)`. Fallbacks: if the router is the
  stub/unready, the preset uses `data/minerva-aeropuerto.json` (OSRM demo snapshot, see below); custom routes run a
  small via-point detour search through the stub (`hazards.js: searchDetour`).

## Decisions (made without the owner; change freely)

- **No 3D terrain mesh.** Flat 3D map + hillshade: the city part of the route is nearly flat, a terrain mesh would complicate
  the three.js car/beacon placement and cost frames, and displayed elevation must not be exaggerated. Swap in the 5 m
  terrain later if needed.
- **The car is not to scale** (~84–120 px long on screen, i.e. 6–10× real size at street zoom) so it reads on video.
- **Speed is simulated** from the router's average speed (slower in turns, 18 km/h inside a registered polygon) and the
  demo is a time-lapse; the HUD always says "vel. simulada · reproducción ×N".
- **Rain is a visual scenario.** "LLUVIA 40 mm/h · escenario" drives the rain effect only; the IMEPLAN inventory is
  historical and does not depend on rain (the UI says so when a rain chip is pressed and no modeled layer exists).
- **Clock is fixed at 23:12 in the demo** (night) for determinism; interactive mode uses the local clock.
- **Reroute policy:** the router's safe route uses penalties, so it can still cross a critical place; the app blocks the
  first crossed *zona crítica / paso a desnivel* more than 1.5 km ahead and re-routes. Sites with no reasonable
  alternative stay on the route with a "sin desvío" alert. Place grouping is by IMEPLAN base id (SI-GDL-031 and
  SI-GDL-031/1 count as one place).
- Demo routing pinned to the observed IMEPLAN layer (see `?layers`). Interactive mode uses every checked layer.
- Line-gradient (traveled / not-yet-drawn route) is only updated when the reroute front moves; the moving chevrons are a
  three.js ribbon, cheap per frame.

## Real vs placeholder

Real: roads, buildings, water, IMEPLAN polygons/ids/references/height ranges, router geometry, distances, durations,
turn-by-turn text (Spanish, from the router), counts of crossed/avoided places. Simulated/decorative: car model and size,
speed profile and time-lapse factor, rain amount, lightning, splashes, the 23:12 clock. Snapshot fallback
(`data/minerva-aeropuerto.json`): OSRM demo routes captured 2026-10-29 with via points chosen by a grid search to dodge
IMEPLAN polygons — provisional, labelled "desvío provisional" on screen; only used when the real router is unavailable or
`?router=snapshot`.

## Limitations / known gaps

- Autoplay frame rate on W10 measured 7–15 fps while other agents were using the GPU/CPU; use `seek()` for filming.
- Start-up waits for the ~5 MB router graph; there is no offline cache.
- Raster-only modeled layers are drawn but not used for alerts (no polygons to test against); vector tiles need
  `sourceLayer`.
- OSM underpasses are not alerted (mapped, not observed); the router already penalises them.
- Phone (390×844) works but is dense; labels are clamped to the screen edge.
- No live/user flood reports exist; "encharcamiento registrado" always means the IMEPLAN historical inventory.

## Files

`index.html`, `styles.css`, `app.js` (data, trip model, demo director, HUD), `scene3d.js` (three.js custom layer: car,
beams, trails, chevrons, beacons, puddles, spray), `rain.js` (canvas rain + lightning), `hazards.js` (hazard index,
route exposure, OSRM-stub detour search; runs in Node too), `data/minerva-aeropuerto.json` (snapshot), `screenshot.jpg`.
Libraries: MapLibre GL 5.20.0 (unpkg), three 0.169.0 (unpkg), Google Fonts Chakra Petch + JetBrains Mono.

Work files: VPS `/srv/contorno/data/guadalajara-flood-lab/work/nav-neon/` (snapshot/search scripts `search.mjs`,
`grid.mjs`, `build-snapshot.mjs`, `realtrip*.mjs`; W10 capture scripts `cap.mjs`, `shoot.sh`, `probe.mjs`, `drive.mjs`,
`fps*.mjs`; screenshots in `shots/`). W10: `C:\Users\Felip\contorno-compute\labs\nav-neon\` (capture scripts + shots).
