# cauce. navegación — maqueta de juguete (`nav-juguete`)

Live: https://guadalajara.vsfelix.com/labs/nav-juguete/ · demo: `?demo=1` · screenshot: `screenshot.jpg` (1600×1000, W10 Chromium/RX 580).

A navigation prototype for cauce.: drive from A to B by car while avoiding flood-prone places, with Waze-style
flood alerts, a heading-up follow camera at 60° pitch and a 3D toy car in the lower middle of the screen.
Art direction: **toy-town diorama**. Tilt-shift blur, a sand-coloured play-mat with grey toy-road asphalt and
white dashes, chunky pastel vinyl buildings with fake contact shadows, glossy resin water slabs with cartoon
glints on the flood polygons, caution-tape stripes on underpasses, chunky toy road signs and striped barriers,
and a bouncing yellow toy car with a water-drop beacon. It is still data-driven: real roads, real building
footprints with real heights, real IMEPLAN polygons and other registered layers, and real routes from the shared cauce. router.

## The demo story (`?demo=1`, 30 s)

**Glorieta Minerva → Estadio Jalisco**, 18:30, match-day rain.

| t (s) | what happens |
|---|---|
| 0–2.7 | Overview of the trip. Dry; the fastest route is shown in indigo. |
| 1.8 | **It starts to rain**: the scenario toggle switches to *Lluvia*, resin pools rise out of the ground, caution tape and toy signs pop up, and the hazard stretches of the fastest route turn coral. |
| 2.7–4.6 | The camera swoops down behind the car at Minerva. |
| 5.3 / 6.9 | **Alert 1**: *Encharcamiento reportado · Glorieta Av. México y López Mateos · 60 cm reportados · en tu ruta a 1.3 km* (IMEPLAN). **Alert 2**: *Paso inferior o túnel · Túnel vehicular en Av. Adolfo López Mateos Norte* (OSM). |
| 5.5–9.2 | Look-ahead shot: the camera glides to the first named hazard (glossy pool, sign, tag) and comes back. |
| 9.6–12 | **Reroute**: *Recalculando ruta segura…* The camera pulls up to show both routes. The new green route draws in, barriers drop onto the fastest route at each avoided place and the tags flip to *evitado*. Card: *Evita 11 puntos con agua · +4 min*. |
| 12.9–24.6 | The car drives the safe route through the city. A speed-dependent zoom (17.2 → 15.75) acts as a time-lapse. "Fuera de tu ruta ✓" alerts appear when the car passes hazards within 220 m. Near the stadium: *Sin alternativa: área de inundación registrada* (the router could not avoid 2 features next to the destination). |
| 24.5–26.7 | Arrival close-up at the (pink toy) Estadio Jalisco. *Llegaste* card with the top avoided places. |
| 26.7–30 | Pull-back to the whole trip: the green path taken against the dashed coral fastest route, with barriers and *evitado* tags. |

`window.__cauceDemo = { duration_s: 30, ready: true, seek(t) }`. `seek(t)` stops autoplay, renders the exact state at `t` and
waits until all tiles are loaded. If the terrain changed, it re-drapes the pools and renders again. It resolves after a
`requestAnimationFrame`. Every animation is a pure function of `t`: car position, speed profile, bounce, camera, alerts,
rain drops, pool growth, sign and barrier pops and the clock. Without `seek`, demo mode autoplays after the first tiles load and loops.
Dev chrome (destination picker, play button) is hidden in demo mode. A frame takes 1–10 s to settle on the shared W10, almost all of it tile loading.
Capture helper: `tools/frames.mjs <url> <outPrefix> <w> <h> <t1,t2,…>` (W10, playwright-core from `labs/tools`).

Interactive mode (no `?demo`): pan, zoom and tilt the map. Pick a destination (Estadio Jalisco, Catedral, Centro de
Tlaquepaque, Expo Guadalajara, Aeropuerto GDL). Switch scenario: *Sin lluvia* / *Lluvia* / *Modelo*; the *Modelo* button cycles
through the modeled layers. **▶ Conducir** plays the same scripted drive for the current routes. Any destination
other than the cached demo one is routed live with the shared router (about 5 MB download, then about 50 ms per route).

## Decisions (made without the owner, as the brief asks)

- **Demo pair changed from Minerva → Aeropuerto to Minerva → Estadio Jalisco.**
  - With IMEPLAN alone, the airport route's best alternative still crossed 3 of 4 sites (+6 min).
  - With the real router plus all default hazard layers, the safe airport route still crosses 10 features, over 28 km, which is too long for a ~12 s follow-cam drive.
  - Minerva → Estadio Jalisco (9.7 km) has a clean story. The fastest route crosses 15 hazard features in 11 places: IMEPLAN sites, Glorieta Colón underpass, 4 Circunvalación tunnels, Parque Hundido, registered GDL flood areas and PC Zapopan reports. The safe route avoids all 15 for about +4 min and only touches 2 features at the destination.
  - The stadium also lies inside the building tile area and looks great as a toy.
  - The airport stays available as an interactive destination; it is outside the building tile box, so OSM buildings are used there.
- **Reroute moment.** P = a point on the fastest route before its first crossed hazard: clamp(first − 1500 m, min(400 m, first/2), first − 250 m). The safe route is `router.route(P, B, {hazardIds})`. The car drives fastest[0..P] and then safe(P..B).
- **Rain scenario = the router's default hazard set.** These are `index.json` layers with kind observed, hotspot or water, type geojson, and `router.default !== false`: IMEPLAN, water bodies, OSM underpasses, PC Zapopan incidents, Zapopan underpass risk, and GDL registered flood areas. Layers with `default:false` stay out because the router agent excluded them on purpose: press hotspots, 3,870 GDL report points, the duplicated GDL underpass atlas and every terrain-index layer. Routing with all of them gives zig-zag routes through residential streets.
  - Each modeled layer becomes a *Modelo* scenario: its geojson is routed and displayed in lilac; raster tiles are display-only and labelled as such.
- **Demo routes are cached** in `demo-estadio.json`, generated by `tools/make-demo-routes.mjs` with the shared router (`cauce-router/1.0.0 (OSM 2026-10-29)`, 2026-10-30T01:11Z) through the same `routing.js` code path. The page shows exactly the hazard layers stored in the cache (`hazardIds`), so the display and the routing always match. `?demo=1&live=1` routes live instead.
- **Buildings: own vector tiles.** OpenFreeMap has almost no buildings in central Guadalajara (4–33 per z14 tile).
  - Footprints: the **Overture Maps** buildings that the terrain agent downloaded on W10 (release 2026-10-21.0: Google Open Buildings, Microsoft, OSM). 554,328 footprints in the bbox [-103.44, 20.60, -103.29, 20.73].
  - Height: Overture `height` when tagged (4,867 buildings). Otherwise the **median of the INEGI 5 m nDSM (DSM−DTM)** cells inside the footprint, from the terrain agent's mosaic. Floor 3 m (113,187 buildings), cap 120 m. The median limits tree-canopy contamination; the nDSM still includes trees and the legend says so.
  - MVT z13–15 (≥120 m² at z13, ≥30 m² at z14), 36 MB. Outside the box, OpenFreeMap buildings are switched on automatically.
- **Visual exaggerations, labelled on screen:** terrain ×1.4, building heights ×1.5. The toy car, signs, barriers and flag have a constant screen size (car ≈ 10 % of the short side), not to scale. Pools are 5 m resin slabs draped on the terrain. Slab thickness carries **no depth meaning**; reported depths appear only as text, verbatim (`cm` only where the source field says cm).
- **Honesty labels:** every alert has a source chip. IMEPLAN: *registro histórico*. PC Zapopan / Bomberos: *histórico*. OSM underpasses: *vía bajo nivel, no es registro*. Models: *exploratorio, no pronóstico*. The legend says *histórico, no en vivo*. "Encharcamiento reportado" means reported in the inventory, not a live report.
- **Terrain:** AWS Terrarium now. The page switches automatically to `/labs/shared/terrain/` tiles when `status/terrain.json` is `ready` or `done` and `terrain/index.json` lists a `{z}/{x}/{y}` DEM. It accepts `tiles`, `url` or `tileUrl` plus `encoding`, either at top level or under `web`, `terrain`, `dem`, `layers[]` or `tilesets[]`.
- The demo clock starts at 18:30 (deterministic). Interactive mode uses the local time.

## Real vs placeholder

Real data: the roads (OpenFreeMap/OSM), the building footprints (Overture), the building heights (INEGI nDSM), every hazard polygon, line and point (the shared registry), the routes, durations and Spanish turn instructions (shared cauce. router over OSM), the terrain (Terrarium), and the hazard names and depths (source attributes).
Not real or stylised:
- The 30 s compressed drive timing and the speed profile.
- The rain particles, which are decoration, not a rain dataset.
- The arrival clock time in the demo.
- The sizes of the car, signs and barriers.
- The pool thickness.
- The building colours (palette by height band plus an id hash).
- The ETA: router free-flow durations scaled by remaining distance; no traffic.

## Data used

- OpenFreeMap planet vector tiles and fonts (OpenMapTiles schema, © OpenStreetMap).
- `tiles/{z}/{x}/{y}.pbf`, layer `buildings`, properties `h` (m), `k` (colour hash 0–7) and `s` (height source: `o` tag, `n` nDSM, `…m` floored). Metadata in `buildings-meta.json`.
- `/labs/shared/hazard/index.json` and every geojson layer it lists. Rendering:
  - observed and modeled polygons: resin pools in three.js plus draped footprints;
  - observed and hotspot points: draped circles;
  - hotspot lines: caution tape.
  The router's `crossed`, `avoided` and `exposure` lists drive the alerts.
- `/labs/shared/router/router.js` (real router; the OSRM fallback in `routing.js` only runs if the shared router ever reports a stub engine again).
- AWS Terrain Tiles (Terrarium).

## Files

`index.html`, `style.css`, `app.js` (style, timeline, HUD, demo API), `toy3d.js` (three.js r170 custom layer: car, pools, signs,
barriers, flag), `geo.js` (metric frame, polyline measure and projection, IMEPLAN normalisation, OSRM-step Spanish),
`routing.js` (shared-router glue, reroute point, provisional OSRM fallback), `demo-estadio.json`, `buildings-meta.json`,
`tiles/`, `fonts/` (Fredoka variable, OFL), `tools/` (`buildings.mjs` for W10, `make-demo-routes.mjs` for VPS Node, `frames.mjs` for W10 capture).
Libraries: MapLibre GL 5.20.0 and three 0.170.0 from unpkg, pinned.

Rebuild the building tiles on W10: `cd C:\Users\Felip\contorno-compute\labs\nav-juguete && node --max-old-space-size=8000 buildings.mjs` (about 60 s), then copy `tiles/` as a tar.
Rebuild the demo routes on the VPS: `node tools/make-demo-routes.mjs '[-103.3283,20.7051]' demo-estadio.json` (Node ≥ 20; the router runs in Node).

## Limitations / known gaps

- Realtime autoplay measured only about 8 fps at 1920×1080 on W10, but the GPU was shared with the simulation agents and 25+ other Chromium processes. With 5 tilt-shift layers it was 2 fps, so it was cut to 2. Use `seek()` for filming. Profiling switches: `?perf=notilt,nofilter,nobld,no3d,norain,nograd`.
- Cartography tiles beyond the building box come from OpenFreeMap (sparse buildings). The Overture data has gaps; trees under small footprints can still give tall "sticks".
- Map tags for nearby avoided places can overlap in the pull-back shots (clustered per 350 m, but not collision-checked).
- Router step names come from the router (e.g. it calls the Minerva exit toward Av. México "Av. Adolfo López Mateos Sur").
- The cached demo freezes the hazard set of 2026-10-30. Re-run `tools/make-demo-routes.mjs` after the registry changes.
- Modeled raster layers (Zapopan Tr100) are display-only. No cauce. simulation was in the registry when this was built; it will appear as a *Modelo* scenario automatically.
- MapLibre logs a harmless warning: "cannot calculate elevation if elevation maxzoom > source.maxzoom".
