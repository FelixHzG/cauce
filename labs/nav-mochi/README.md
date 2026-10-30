# cauce. · navegación mochi (`/labs/nav-mochi/`)

A kawaii, candy-pastel take on flood-aware driving directions in Guadalajara. A chibi pink car with a face and **Gotita**,
a water-drop copilot, drive from Glorieta Minerva to the airport. When it starts raining, Gotita checks where the city has
flooded before (IMEPLAN), and the route is recalculated to avoid IMEPLAN critical zones and underpasses. Waze-style alerts
appear as speech bubbles and die-cut stickers. The UI is in Spanish. Agent: `nav-mochi`.

- Live: https://guadalajara.vsfelix.com/labs/nav-mochi/ (interactive) · `?demo=1` (28 s autoplay loop) · `?demo=1&capture=1` (no autoplay, for frame capture)
- Screenshot: `screenshot.jpg` (1600×1000, W10 GPU, demo t = 10.3 s: the reroute overview with the safe route and the dotted normal route)

## What you see
- **Map:** my own MapLibre style over OpenFreeMap vector tiles (OpenMapTiles schema), in candy pastels. Roads are rounded
  pink/butter/white with casings. Buildings are extruded at their OSM `render_height` in five pastel tints, and the
  AWS Terrarium hillshade is faint. The sky and fog are pink and blue.
- **Car:** built only from three.js 0.169 primitives (RoundedBox, Lathe, Extrude, Cylinder, Torus) as a MapLibre custom 3D
  layer, with toon shading and inverted-hull outlines. The face is on the front, the tail lights are hearts, and puffs come
  out the back. Gotita sits on the roof, faces the follow camera and waves. The car keeps a constant on-screen size, like a
  navigation arrow (≈118 px desktop, 78 px phone). The depth buffer is cleared before drawing it so the toy-scale car never
  clips into buildings.
- **Camera:** heading-up, pitch ≈57–61°, with the car in the lower middle (padding pushes the centre down and away from the
  panel). Heading is smoothed with a look-ahead window that scales with speed. Zoom falls as speed rises, from 15.9 to 12.9.
- **Routes:** the safe route is mint with a white casing and a glow, and the part already driven turns pale (`line-gradient`).
  The normal (fastest) route is a lilac dotted line. During the reroute the new route draws itself in.
- **Hazards:**
  - IMEPLAN *sitios inundables*: blue polka-dot fill. *Zonas críticas*: pink candy stripes.
  - OSM underpasses (`underpasses`, kind hotspot): lilac dashed lines.
  - Sites near either route get a billboard sticker (encharcamiento / zona crítica / paso a desnivel / modelo). Stickers
    shrink with distance (perspective). Avoided sites get a mint ✓ badge, and crossed ones get a yellow ! badge.
- **Panel:** rain chips (Seco / Lluvia + one chip per *modeled* layer when one appears), safe vs normal time, km and risk
  points, and «Lo que esquivamos». **Bubble:** Gotita's mood (happy, surprised, worried) and the alert text, with the data
  source written under it. **Trip bar:** ETA, time and km left, and a «cámara rápida ×N» pill, so the speed-up is never hidden.

## Data and how it is used
| layer | source | use |
|---|---|---|
| `observed-imeplan-2026` (observed) | IMEPLAN MUI 2026 via `/labs/shared/hazard/` | Grouped by site code (SI-GDL-031 + SI-GDL-031/1 + point). The alert text uses `Referencia` and the height range in cm. Zona-crítica heights are shown verbatim as «200» with "sin unidad en la fuente", because the source gives no unit. |
| `underpasses` (hotspot) | router agent, from OSM tags | Lines grouped by `site`. Counted as "crossed" only if the route runs along ≥40 m of it, and the router agrees. Labelled «paso inferior», never «sitio inundable». |
| `water-bodies` (water) | router agent, OSM | Passed to the router only. Not drawn (the basemap already shows water) and never an alert. |
| any `modeled` layer | sims (later) | Loaded automatically. Polygons get the lilac dotted pattern, raster-tiles a raster layer, and each one gets its own rain chip labelled «modelo». |
| roads, buildings, labels | OpenFreeMap / OpenMapTiles / © OpenStreetMap | basemap |
| hillshade | AWS Terrain Tiles (Terrarium) | visual only |
| routing | `/labs/shared/router/router.js`, cauce-router/1.0.0 (OSM 2026-10-29) | normal + safe routes and Spanish steps |

**Rain policy (my decision):** in rain, the route is `router.route(A, B, {hazardIds: [observed, hotspot, water layers], compare: true, avoid: X})`.
`X` holds every IMEPLAN zona-crítica polygon plus every IMEPLAN site whose text mentions "desnivel" (223 polygons). The
router treats these as hard blocks and falls back automatically if blocking leaves no route. Everything else is a soft
penalty with the router's defaults. With soft penalties alone, the router's safe route still went through the Héroes
Ferrocarrileros underpass (a critical zone, 30–250 cm), which is the wrong story for a "llegamos secos" product. The block
policy costs +8.6 min on the demo trip and avoids every critical zone and underpass site. The only IMEPLAN site it still
crosses is **La Piedrera** (Carretera a Chapala, which has no reasonable alternative), plus six OSM underpasses on Av.
Solidaridad Iberoamericana. The UI says so.

**Counting:** "crossed" means both my geometry check (polygon within 18 m, or ≥40 m along an underpass line) and the
router's bridge-aware `crossed` list agree. This removes false hits where the road goes over a hazard on a bridge. The
"avoided" sites are those crossed by the normal route but not by the safe route, after the reroute point.

**Stub fallback:** if `router.js` ever returns a `stub` engine, `js/plan.js` builds the safe route itself. It tries
perpendicular via-point detours around the first crossed site and keeps one only if it lowers drive time plus the hazard
penalty.

## Demo mode (`?demo=1`)
`window.__cauceDemo = { duration_s: 28, seek(t) }`. `seek` renders the frame at `t` and resolves after tiles are loaded,
the map is idle and two animation frames have passed. Everything on screen is a pure function of `t`: camera, car, route
gradients, sticker pops, bubbles, rain particles (seeded) and the clock. MapLibre fades and paint transitions are set to 0.
Dev chrome (drive and route buttons, legend) is hidden. `?demo=1` loops with autoplay. Add `&capture=1` to disable
autoplay. Add `&live=1` to plan the demo with the live router instead of the baked file.

Timeline: 0–2 s overview, «¡Hola! Soy Gotita» · 2–4 swoop down to the car · 4–7.4 dry drive around Glorieta Minerva onto
Circunvalación Agustín Yáñez · **5.6 rain starts** (the chip flips to «Lluvia», hazards and stickers pop in) · 7.4 car stops,
close-up of the car's face, alert **«Paso a desnivel inundable adelante: Glorieta Arcos del Milenio»** · **8–10.6 «¡Recalculando!»**,
the camera rises to show the dotted normal route heading into Arcos/Lázaro Cárdenas while the safe route draws in via Av.
Niños Héroes · 11.3–24 drive with slow windows (≈240 m/s for 2.1 s) at each event: **«¡Evitado!» Arcos del Milenio** and
**«Encharcamiento reportado: La Piedrera (30–150 cm)»** · 24–28 arrival, overview of both routes and the summary card
«¡Llegamos secos!».

The demo routes are baked in `data/demo-route.json`, so filming never depends on the 5 MB router download. They come from
the real router: normal 28.2 km / 33 min; reroute at 710 m; safe leg 30.1 km / 40.5 min. To re-bake after the router or the
hazards change: `node labs/nav-mochi/tools/bake-demo.mjs [lon,lat] [lon,lat]` from `/srv/contorno/data/guadalajara-flood-lab`.
It runs in Node and uses the same router module and `plan.js`.

Frame capture on W10: `tools/mochi-shot.mjs` (copy at `C:\Users\Felip\contorno-compute\labs\nav-mochi\mochi-shot.mjs`):
`node mochi-shot.mjs "<url>?demo=1&capture=1" shots\name 1920 1080 0,0.5,1,... [scale]`. Each frame costs about 0.4–2 s
once tiles are cached. The first frame waits for tiles and fonts (≈10–20 s over the Tailscale relay).

## Interactive mode (no `?demo`)
The map shows at once. Gotita narrates while the router graph loads (≈5 MB; about 2–3 s on a normal connection, 20–40 s from
W10 through the relay). Then you get an overview of the normal and safe routes with stickers.
- **▶ Conducir** plays the same follow-camera drive in real time, with alerts.
- Tapping «Seco» or «Lluvia» during a drive **reroutes from the car's current position**: toast, new route reveal, then the
  drive continues.
- **Cambiar ruta**: tap the origin, then the destination. `?from=lon,lat&to=lon,lat&fromName=…&toName=…` also works.
- Tap a sticker or a hazard polygon to see the IMEPLAN record.
- Debug hook: `window.__mochi`.

## Real vs placeholder
- **Real:** roads, buildings and labels (OSM/OpenMapTiles); IMEPLAN polygons, names and height ranges; OSM-derived
  underpasses; normal and safe routes, distances, durations and turn steps from the cauce router.
- **Not live:** "Encharcamiento reportado" is the IMEPLAN historical record of that site, not a live report. Every bubble
  says «registro histórico, no en vivo». No modeled flood layer exists yet, so no «modelo» chip is shown; one appears
  automatically when a `kind:"modeled"` layer is registered.
- **Decorative:** the rain particles and tint; the demo clock (departure fixed at 18:10, a June storm afternoon); the
  car's speed, which is accelerated (labelled «cámara rápida ×N» and «tiempo acelerado»).

## Limits and known gaps
- Durations are the router's free-flow estimates. There is no live traffic and no turn restrictions (see the router README).
- The safe route is only as good as the inventory. IMEPLAN marks where flooding has been recorded, not where water is now.
  On screen: «Registros históricos, no pronóstico».
- Hazard polygons draw over the building extrusions, which I chose for legibility.
- Underpass stickers are shown only where a route actually runs through the underpass. Showing every nearby one cluttered
  the map.
- The interactive mode is less polished than the demo: there is no address search, and a reroute that runs during a drive
  calls the router live.
- The phone layout (390×844) uses a bottom sheet with chips and both routes. «Lo que esquivamos» and the legend are hidden
  there.

## Files
`index.html`, `style.css`, `js/app.js` (timeline engine, layers, UI), `js/plan.js` (hazard model, exposure, router glue,
stub fallback), `js/car.js` (three.js car + Gotita), `js/style.js` (MapLibre style + fill patterns), `js/ui.js`
(stickers, mascot SVG, Spanish maneuvers), `data/demo-route.json`, `tools/bake-demo.mjs`, `tools/mochi-shot.mjs`.
External: maplibre-gl 5.20.0 and three 0.169.0 (unpkg), Fredoka and Nunito (@fontsource 5.1.0 via jsDelivr), OpenFreeMap
glyphs.
