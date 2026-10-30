# cauce. · nav-pixel — «Misión: llegar seco» (navegación 16-bit)

Live: `https://guadalajara.vsfelix.com/labs/nav-pixel/` · filming: `?demo=1` · agent: `nav-pixel`.

A navigation prototype for cauce. drawn as a **retro 16-bit overworld**: the real Guadalajara street map (OpenFreeMap/OSM),
rendered at 1/3 (desktop) or 1/2 (phone) resolution, quantised to the 32-colour ENDESGA palette with ordered dithering,
animated water tiles on the IMEPLAN flood polygons, a voxel *vocho* driving heading-up with a pitched follow camera,
and the trip framed as a *misión* with a quest log, RPG dialogue boxes and a copilot (AXO, an ajolote in a rain hat).

Default mission: **Glorieta Minerva → Aeropuerto GDL**. With rain on, the fastest route (Av. de los Arcos / Lázaro
Cárdenas) crosses the flooded underpass *Glorieta Arcos del Milenio* (IMEPLAN, 200 cm), a critical zone and six more
recorded sites; the safe route goes by Niños Héroes / Roberto Michel / Carretera a Chapala: **+2.6 km, +9 min**, and
still crosses one recorded site (La Piedrera, 30–150 cm), which AXO warns about because no reasonable detour exists.

## What is on screen

| element | what it shows | data |
|---|---|---|
| map | streets, buildings (extruded), water, parks/forest as tree tiles, airport runways, hillshade (dithered) | OpenFreeMap vector tiles (OSM), AWS Terrarium DEM (or `/labs/shared/terrain/index.json` when it exposes `tiles`) |
| animated blue water tiles + cyan / red outlines | IMEPLAN MUI 2026 *sitios inundables* / *zonas críticas* | `/labs/shared/hazard/observed-imeplan-2026.geojson` via `hazard/index.json` |
| gold route | safe route actually driven | `/labs/shared/router/router.js` (`cauce-router/1.0.0`) |
| red dashed route + ✕ signs | the fastest route's stretch that was avoided and its hazards | same router call (`compare:true`) |
| diamond signs with tags | hazards on/near the route, with street reference and recorded depth | IMEPLAN (point `Referencia` joined to polygons by site code) |
| quest log | objectives (revealed when it starts raining), normal vs safe comparison, hazard layers, legend, router note | all computed live |
| minimap, stats | whole trip, remaining km/min, hazards avoided, time-lapse factor | computed |
| dialogue box | alerts: *¡ENCHARCAMIENTO REPORTADO!*, *¡RECALCULANDO!* (paso a desnivel inundable + zona crítica IMEPLAN), *¡ZONA CRÍTICA A 120 m!*, *¡INUNDABLE BAJO EL PUENTE!*, … each with its source line | computed from the hazard geometry along both routes |

Observed (IMEPLAN, Zapopan incidents), mapped/reported (OSM underpasses, press, municipal lists) and modeled/terrain
layers are kept apart: blue tiles = observed records, orange = mapped/reported points or underpasses, purple tiles =
modeled or terrain index; every alert ends with a source line («registro histórico, no reporte en vivo», «modelo
exploratorio, no pronóstico», «reportado/mapeado, no observación oficial»).

## Demo mode (`?demo=1`)

* 26 s, deterministic. Dev chrome hidden (no buttons; only active layer chips). Autoplays 0.4 s after load.
* `window.__cauceDemo = { duration_s: 26, seek(t), ready, state() }` — `seek(t)` applies the frame at `t` seconds,
  waits for MapLibre `idle` (max 6 s) plus two animation frames, and resolves. `state()` returns the timeline
  (`ev` with times), engine, active layers and a frame-time profile. `?demo=1&capture=1` disables autoplay and blinking
  CSS so captures only come from `seek`.
* Timeline (default route, real router): 0–3.2 s mission card over the overview → camera dives to the car at Minerva →
  3.2 «cielo despejado» (fastest route planned) → **5.0 rain starts**, IMEPLAN tiles pop in, lightning →
  **8.0 ¡RECALCULANDO!** (the fastest route is about to enter the Arcos del Milenio underpass + critical zone; planned
  route flips to the safe one, avoided stretch turns red/dashed) → 10.9 «¡ESQUIVADO! +8» → 13.9 near-miss alert
  (critical zone 120 m to the left) → fast travel (zoom out, ×300) → **17.8 ¡ENCHARCAMIENTO REPORTADO!** La Piedrera →
  22.5 arrival → overview with both routes and the mission summary.
  Times come from `buildTimeline()` and adapt to any route: slow windows around every event (each dialogue gets its
  reading time), fast travel in between (monotone cubic s(t), camera zoom follows speed).
* Other params: `?t=12` (static frame), `?layers=id1,id2` or `?layers=all`, `?dry=1` (no hazards), `?baked=1` (use the
  local route copy instead of the router), `?px=2` (pixel size), `?nofx=1` (no palette pass), `?off=building,hillshade`
  (debug: drop style layers by prefix).

## Interactive mode (no params)

Overview of the mission with both routes; **▶ JUGAR MISIÓN** plays the same timeline in real time. Chips switch hazard
layers (each listed layer in `hazard/index.json` except `kind:water`, which is drawn as permanent water context);
GeoJSON layers are fetched only when switched on. **✎ DESTINO / ✎ INICIO** then tap the map routes anywhere in the AOI
(router `OUT_OF_AREA`/`NO_ROUTE` errors show a message). Phone: the quest log opens from **📜 MISIÓN**.

## Routing decisions

* Router: `loadRouter()` from `/labs/shared/router/router.js`, one call
  `route(A, B, {hazardIds: [active layers], avoid: severe, compare: true})`.
  **Policy (mine):** IMEPLAN *zonas críticas* and flooded underpass sites (and modeled depth ≥ 30 cm, when a modeled
  layer appears) are passed as `avoid` polygons, i.e. **blocked**; everything else uses the router's own soft penalties.
  With soft penalties only, the router's safe route still went through the Héroes Ferrocarrileros underpass
  (30–250 cm) and a critical zone; blocking every IMEPLAN polygon produced a 41 km detour. Blocking only the severe ones
  gives a sensible +2.6 km.
* Alerts are computed in the browser from the hazard geometry (`avoid.js`: polygons, lines that the route runs *along*
  for ≥ 30 m, points with a 40 m radius), then **reconciled with the router's bridge-aware `crossed` list** (hazards the
  router says the route passes over on a bridge become «¡INUNDABLE BAJO EL PUENTE!» notes instead of hits).
* Fallbacks: if the router fails, the default mission uses `demo-route.json` (a copy of the same router result, baked
  2026-10-29). If only the old OSRM stub is present, `avoid.js` searches via-points around hazards (slow, public OSRM).
* The default airport endpoint is `[-103.3050, 20.5262]` (terminal road). The brief's `[-103.3111, 20.5218]` snapped
  429 m away to an unnamed road and produced a 28.7 km route through Tlajomulco with OSRM.

## Rendering decisions

* MapLibre GL 5.20 (unpkg, pinned) with `pixelRatio = 1/3` (desktop) or `1/2` (phone) and `image-rendering: pixelated`:
  every road, building and line is drawn at game resolution (640×360 at 1080p).
* `pixel.js`: a MapLibre custom layer drawn last copies the frame (`copyTexSubImage2D`, same GL context) and redraws it
  quantised to ENDESGA 32 with 4×4 Bayer dithering, plus storm grade, deterministic rain streaks, lightning flash and a
  dithered horizon haze. (A first version copied the canvas into a second WebGL context: ~25 ms per frame; removed.)
* `voxcar.js`: the car is 28 boxes in a hand-written WebGL custom layer (no three.js), lit per face, scaled so it stays
  ~84 px long whatever the zoom.
* `sprites.js`: all pixel art is procedural (water/flood/model tiles in 4 animation frames, trees, signs, arrows,
  AXO portrait, 9-slice frames for the HUD boxes). Fonts: Silkscreen (headings; handles Ó/Á/Í/Ú, unlike Press Start 2P)
  and Pixelify Sans (text), self-hosted in `fonts/` (OFL).
* Camera: heading-up, look-ahead bearing that widens with speed, car at ~71 % of the height (phone ~60 %), pitch 46–60°.
  Intro/outro: overview ↔ follow transitions (zoom first, then pan).
* Time-lapse is explicit on screen (`RELOJ ×12`, `» VIAJE RÁPIDO »  tiempo acelerado ×300`).

## Real vs placeholder

* Real: streets/buildings (OSM via OpenFreeMap), IMEPLAN polygons, depths and street references, routes and steps
  (cauce-router on OSM 2026-10-29), all distances/durations, every alert.
* Scenario framing: «empieza a llover» switches the IMEPLAN inventory on. IMEPLAN is a historical inventory: the
  dialogue and source lines say «registro histórico, no reporte en vivo»; nothing is a forecast or live report.
* Building heights are OpenMapTiles `render_height` (estimates), capped at 90 m.
* The car is not a GPS trace: it drives the computed route on a scripted, time-lapsed schedule.

## Known gaps

* Live playback at 1080p on W10 ran at ~28–42 fps in the heaviest stretch (tile loading); seek-based capture is
  deterministic and unaffected. Tiles along the route are prefetched in the background after routing.
* Point-only layers (Zapopan incidents, press hotspots, municipal underpass list) use a fixed 40 m radius; very dense
  layers can add many alerts — the timeline keeps at most 2–3 plus one near-miss.
* Terrain/modeled raster layers are display only (not used for alerts); the router decides whether it samples them.
* Headless Chrome screenshots on W10 show a ~15 px band at the top where the WebGL canvas is not composited; the map
  background is set to the haze colour so the band blends in.

## Files

`index.html`, `style.css`, `app.js` (app, timeline, HUD), `avoid.js` (hazard geometry + stub fallback), `pixel.js`
(palette pass), `voxcar.js` (car), `sprites.js` (pixel art), `demo-route.json` (offline route copy), `fonts/`,
`screenshot.jpg` (W10, 1600×1000, t = 10.45 s), `screenshot-phone.jpg` (390×844 @2x, t = 9.6 s), `screenshot-alert.jpg` (t = 18.6 s).
Work files: VPS `/srv/contorno/data/guadalajara-flood-lab/work/nav-pixel/` (route probes, grid searches, W10 capture
scripts `w10/shotpx.mjs`), W10 `C:\Users\Felip\contorno-compute\labs\nav-pixel\` (capture helper and shots).

Attribution: © OpenStreetMap contributors (ODbL) · OpenFreeMap / OpenMapTiles · AWS Terrain Tiles (Mapzen) ·
IMEPLAN Mapa Único de Inundaciones 2026 · cauce-router (OSM 2026-10-29) · ENDESGA 32 palette ·
Silkscreen and Pixelify Sans fonts (SIL OFL).
