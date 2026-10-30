# cauce. · navegación mochi (`/labs/nav-mochi/`) — v2, the default navigation page

A kawaii, candy-pastel take on flood-aware driving in Guadalajara. A chibi pink car with a face and **Gotita**, its
water-drop copilot, drive from Glorieta Minerva to the airport. When rain starts, Gotita checks where the city has flooded
before and calls «¡Recalculando!» ahead of the first recorded site. The safe route then avoids IMEPLAN critical zones and
underpasses. The UI is in Spanish. Agent: `nav-mochi`. The owner picked this design as THE navigation page (2026-10-30).

- Live: https://guadalajara.vsfelix.com/labs/nav-mochi/ — the page opens **already driving**: the demo trip loops, and
  «📍 Elegir mi destino» lets you tap any point to drive there from where the car is.
- `?demo=1` is the same loop without the destination button (for filming). `?demo=1&capture=1` turns autoplay off; drive
  frames with `window.__cauceDemo.seek(t)`, which resolves once tiles are loaded and two frames have rendered.
  `__cauceDemo.duration_s = 40`, and `__cauceDemo.ready` is a Promise.
- `screenshot.jpg`: 1600×1000, t = 7.6 s, the close follow camera with «¡Recalculando!» and the next recorded site labelled
  ahead.

## v2 changes (owner feedback, 2026-10-30)
1. **No per-layer UI.** The old «Tu viaje» list, which showed all 29 hazard layers, is gone. A compact trip card remains:
   origin → destination, safe vs normal route (time, sites avoided or crossed, km), a two-item legend, the rain state, and
   «exploratorio · no es pronóstico · tiempo acelerado». The page loads a small curated set of layers internally:
   `observed-imeplan-2026` (stickers and routing), `underpasses` (routing; a sticker only when the route drives through
   one), `water-bodies` (routing only), plus the heatmap below.
2. **Nothing overlaps.** Credits sit in a fixed-width box at the bottom right, clear of the centred trip bar. The honesty
   line lives in the trip card. Phone uses a short credit line. Checked at 1440×900, 1600×1000, 1920×1080 and 390×844.
3. **The car is always on top.** Stickers, badges, labels and pins are now MapLibre symbols (`stk` layer) drawn below the
   three.js car layer, so the car occludes them. The bottom-left Gotita bubble is kept out of the car's screen area.
4. **Modeled-risk heatmap** (lavender → pink) replaces the blue dot clouds. Source: `data/riesgo-modelado.geojson` (1.3 MB,
   12k weighted points). `tools/make-heat.mjs` derives it from sim-drenaje's
   `modeled/sim-drenaje/routing-flood-frequency.geojson`: the frequency of flooding ≥15 cm across 126 storm runs, sampled
   on a 140 m grid inside each polygon, weight = `score`.
   - Observed data stays visually distinct: IMEPLAN sites are a dashed rose outline, and critical zones have candy stripes.
   - Legend: «riesgo modelado» vs «sitios registrados IMEPLAN». Both fade in with the rain.
5. **Closer, simpler camera.** Heading-up and tilted 55–61°, zoom 15.0–16.8 while driving, car in the lower middle.
   - Only the next one or two hazards along the route get a sticker; the first one is labelled with its distance
     («Encharcamiento registrado · 550 m»).
   - MapLibre symbol collision spreads overlapping stickers.
   - Sites the route drives through are pinned on the route itself.
6. **Opens navigating.** Default page = demo loop; one small control to choose a destination.
7. **New 40 s video timeline** (below).

## Demo timeline (40.0 s; demo route baked from the real cauce router)
| t (s) | beat |
|---|---|
| 0.0–2.6 | Opening close-up: the camera swings from Gotita and the car's face to behind the car as it rolls out of Minerva. Bubble «¡Hola! Soy Gotita…» |
| 2.6–8.6 | Close follow around Glorieta Minerva onto Circunvalación (dry). **4.4** rain starts: clouds, heatmap and IMEPLAN outlines fade in; bubble «¡Empezó a llover!». ~5.0 the next recorded site appears ahead with a label |
| 6.8–10.4 | **«¡Recalculando!»** bubble and toast: «Adelante: Calle Constelación y Av. Arcos (30–80 cm registrados)». The car stops at 8.6 |
| 8.6–14.2 | **Pull-back**: the safe route (mint) draws in (9.6–11.0) beside the normal route (lilac dots); avoided sites get ✓ «evitado». Bubble «¡Ruta segura! +8 min y esquiva 6 sitios inundables y 1 paso inferior». 12.8–14.2 back down |
| 14.2–22.0 | Close drive on Av. Niños Héroes; 17.1–20.7 alert «Paso a desnivel a 80 m: Niños Héroes y Av. Inglaterra — lo rodeamos» |
| 22.0–24.6 | Time skip «⏩ 25 min después» (the camera rises and comes back down along the route) |
| 24.6–30.0 | Through La Piedrera: «Encharcamiento registrado · 30–150 cm · no hay otra vía razonable» (yellow ! badge) |
| 30.0–32.4 | Second time skip |
| 32.4–36.0 | Arrival at the airport, «¡Llegaste!», «¡Llegamos secos!» |
| 36.0–40.0 | Pull up to an overview of both routes; summary card at 37.6 (sites avoided, +8 min, what had no alternative) |

**Recommended stills / capture times:** 1.2 (opening close-up), 3.5 (close follow, dry), 6.0 (rain and labelled site
ahead), **7.6 (¡Recalculando!)**, 11.8 (pull-back: safe vs normal, ✓ evitado), 13.6 (descending), **18.6 (underpass
alert)**, 23.3 (time skip), **27.6 (La Piedrera)**, 34.8 (arrival), **39.5 (summary)**. For video, render 0 → 40 s at
30 fps with `?demo=1&capture=1` and `seek(i/30)`. On the VPS (SwiftShader, W10 offline) frames took 3–15 s each at
1440×900.

## Data and honesty
- **Routing:** `/labs/shared/router/router.js` (cauce-router/1.0.0, OSM 2026-10-29), with `compare:true`. Rain policy:
  hard-block IMEPLAN critical zones and IMEPLAN underpass sites, and apply soft penalties for the curated layers. Demo
  routes are baked in `data/demo-route.json` (`tools/bake-demo.mjs`); the custom destination plans live in the browser
  (≈5 MB graph download).
- **Real:** roads and buildings (OSM/OpenMapTiles), IMEPLAN sites with their names and cm ranges, OSM underpasses, router
  times and steps, and the sim-drenaje ensemble used for the heatmap.
- **Not live:** «Encharcamiento registrado» is IMEPLAN's historical record and the bubble says so. The heatmap is an
  exploratory model, not a forecast.
- **Decorative:** rain particles, the demo clock (departure 18:10), and the sped-up drive («cámara rápida ×N», «salto en
  el tiempo»).
- **Credits on screen:** IMEPLAN MUI 2026, sim-drenaje, © OpenStreetMap, OpenFreeMap, OpenMapTiles, AWS Terrain Tiles,
  router cauce.

## Files
- `index.html`, `style.css`
- `js/app.js`: timeline engine, layers, stickers, trip card, picker
- `js/plan.js`: hazard model, exposure, router glue
- `js/car.js`: three.js car + Gotita
- `js/style.js`: pastel MapLibre style
- `js/ui.js`: sticker SVGs, mascot, Spanish maneuvers
- `data/demo-route.json`, `data/riesgo-modelado.geojson`
- `tools/bake-demo.mjs`, `tools/make-heat.mjs`, `tools/mochi-shot.mjs` (W10 capture)

v1 backup: `/srv/contorno/data/guadalajara-flood-lab/work/nav-mochi/backup-v1/`.

## Limits
- With the camera this close, the 31 km trip needs two time skips.
- A custom destination drives the whole route, so long routes zoom out at speed.
- Sticker labels near the screen edge can be clipped.
- No turn restrictions or live traffic in the router.
