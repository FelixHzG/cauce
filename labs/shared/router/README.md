# cauce. router — in-browser, hazard-aware driving router for the ZMG

`/labs/shared/router/router.js` is an ES module that routes cars across the Guadalajara metro area in the
browser (a module Web Worker by default), with no server. It replaces the orchestrator's OSRM-demo stub and keeps
its API. It adds hazard avoidance, a normal-vs-safe comparison, Spanish turn-by-turn steps, the hazards avoided, and
the hazards near the route. Producer: routing agent (`router`). Test page: `/labs/router-test/`.

## Files

| file | what |
|---|---|
| `router.js` | entry: `loadRouter()`; spawns `router-worker.js`, falls back to the main thread; works in Node 18+ (file: URLs) |
| `router-core.js` | the engine: graph decode, spatial index, A*, hazard matching, steps, exposure (environment-agnostic) |
| `router-worker.js` | worker host (message protocol `{id, cmd, args}`) |
| `router.stub.js` | the old OSRM-demo stub, kept for rollback/reference only |
| `data/graph.bin.gz` | road graph, typed arrays, 4.42 MB gzip (12.9 MB raw) |
| `data/graph.meta.json` | sections, string table (names/refs/destinations), stats, provenance (699 KB, 212 KB gzip on the wire) |
| `../hazard/water-bodies.geojson`, `../hazard/underpasses.geojson` | hazard layers owned by this agent (listed in `hazard/index.json`) |

## Data snapshot and licence

- Source: OpenStreetMap extract `jalisco-latest.osm.pbf` from download.openstreetmap.fr
  (`https://download.openstreetmap.fr/extracts/north-america/mexico/jalisco-latest.osm.pbf`),
  replication timestamp **2026-10-29T00:55:20Z**, 44,070,688 bytes, sha256 `f239edcee2e875540236a0c10e5ccd73a11e1d702c65cfd6a6072f9c845a741b`.
- Licence: **ODbL 1.0**. Show "© OpenStreetMap contributors" on any page that displays routes or these layers.
  The graph, `water-bodies` and `underpasses` are derived databases and stay under the ODbL.
- Coverage: AOI bbox `[-103.75, 20.25, -103.05, 21.0]` plus a 0.03° pad (`config/aoi.json`), so it covers the whole AOI,
  not only the urban bbox.

## Graph

Built on W10 by `build.mjs` (my own zero-dependency PBF reader `pbf.mjs`, single thread, 6.8 s end to end).
Source: VPS `/srv/contorno/data/guadalajara-flood-lab/work/router/build/`, W10 `C:\Users\Felip\contorno-compute\labs\router\`.
Rebuild: download the extract, `node build.mjs jalisco-latest.osm.pbf out <sourceUrl>`, then copy `out/graph.*` to
`data/` and the two GeoJSON files to `../hazard/`.

| stat | value |
|---|---|
| nodes (intersections, dead ends, signals, barrier stubs) | 192,342 |
| edges (contracted chains between nodes, one OSM way each) | 259,317 |
| directed arcs | 445,759 |
| interior shape points (Douglas-Peucker 1 m) | 196,876 (from 826,586 raw OSM vertices) |
| traffic-signal nodes | 1,581 (8 s penalty each) |
| strongly connected components | 8,265; only the largest is kept (192,342 of 211,987 nodes) |
| km by class | residential 12,943 · unclassified 3,691 · service 2,030 · tertiary 1,720 · primary 1,111 · secondary 679 · motorway 534 · living_street 478 · trunk 214 · links 241 |

Included roads: `motorway…living_street, service, road` and their `_link` roads. Excluded: `service=parking_aisle|driveway|drive-through|emergency_access`,
`access=no|private|agricultural|forestry|emergency|military` (unless `motor_vehicle`/`motorcar`/`vehicle` says yes or destination),
`oneway=reversible`, `area=yes`, and `highway=track`. Oneway: `oneway=*`; it is implied on `junction=roundabout|circular` and on `highway=motorway`.
Blocking barriers (gate, lift_gate, bollard, block, chain, jersey_barrier, …, without `access=yes`) cut the edge, so
gated *cotos* are not crossed. Speeds: `maxspeed × 0.8` when tagged, otherwise class defaults (km/h): motorway 90, trunk 70,
primary 50, secondary 42, tertiary 35, unclassified 30, residential 25, service 15, living_street 10, links 25–45.
Residential/service are capped at 1.25× their default, and unpaved roads run at ×0.6.
Per edge, the graph keeps: name, ref, destination, class, oneway direction, maxspeed-derived speed,
bridge/tunnel/cutting/roundabout/toll/unpaved/link flags, layer and OSM way id.

Binary layout (little-endian, sections aligned to 4 bytes, listed in `graph.meta.json.sections`): node lon/lat as Int32
1e-6° delta-coded in Morton order; edges sorted by `from` (`edgeFrom/To` Uint32, `edgeLen` Float32 m, `edgeSpeed` Uint8,
`edgeFlags` Uint16, `edgeClass` Uint8, `edgeLayer` Int8, `edgeName/Ref/Dest` Uint32 into `strings`, `edgeWay` Uint32);
`geomOff` Uint32 (E+1) with `geomLon/Lat` Int32 deltas starting from each edge's first node.

## API

```js
import { loadRouter } from '/labs/shared/router/router.js';
const router = await loadRouter();           // shared per page; ~5 MB download, ~0.5 s to index on a laptop
router.preload();                            // optional: fetch + index all hazard layers in the background now

// 1. exactly the stub call (fastest route, no hazards)
const r = await router.route([-103.3925, 20.6743], [-103.3111, 20.5218]);

// 2. hazard-aware (mode defaults to "safe" as soon as hazardIds / avoid / hazardCost is given)
const s = await router.route(A, B, { hazardIds: ['observed-imeplan-2026', 'underpasses', 'water-bodies'] });

// 3. normal vs safe in one call
const c = await router.route(A, B, { hazardIds: 'all', compare: true });
c.normal.coordinates; c.safe.coordinates; c.comparison; // {extra_distance_m, extra_duration_s, avoided_count, crossed_normal, crossed_safe, ...}

// 4. your own areas to avoid (blocked) + custom penalties
await router.route(A, B, { avoid: myFeatureCollection, penalties: { observed: 'block', hotspot: 3 } });

// 5. custom cost hook (a self-contained function; it runs in the worker)
await router.route(A, B, { hazardCost: e => e.tunnel ? Infinity : (e.highway === 'motorway' ? 1.5 : 1) });
```

`loadRouter(opts)`: `{worker=true, hazardIndexUrl='/labs/shared/hazard/index.json', base, fresh}`.
The router object provides `engine` (string), `ready` (true), `thread` ('worker'|'main-thread'), `info()`,
`route(from, to, opts)`, `nearest([lon,lat])`, `hazards()` (registry + load state), `preload(ids?)`, `reloadHazards()` and `close()`.
Points are `[lon, lat]`; `{lng, lat}` and `{lon, lat}` objects also work.

`route` options:

| option | default | meaning |
|---|---|---|
| `hazardIds` | – | ids from `hazard/index.json`, or `'all'` (all layers except those with `router.default:false`) |
| `avoid` | – | GeoJSON FeatureCollection / Feature / geometry / array. Polygons are blocked; points use `properties.radius_m` (default 40 m), lines 10 m |
| `mode` | `'safe'` if any hazard input, else `'fastest'` | `'safe'` alone (no ids) uses all registered layers |
| `compare` | false | also return `normal`, `safe`, `comparison` |
| `penalties` | – | `{ [layerId or kind]: multiplier or 'block' }`, overriding the defaults below (`penalties.blockCritical` is read too) |
| `blockCritical` | `true` in safe mode | block the worst observed hazards (see *Critical hazards* below); `false` turns it off. Has no effect on `avoid` or in fastest mode |
| `hazardCost` | – | `fn(edge) → multiplier or Infinity`, as a function (serialised into the worker, so no closures), a source string, or `{module: url}` exporting `hazardCost`/`default` |
| `exposureRadius_m` | 50 | radius for `exposure` |
| `steps` | true | false skips instruction generation |
| `snapMaxM` | 2500 | farthest a point may be from a road |

Result (top level = the chosen mode's route; every field the stub had is still there):

```
{ coordinates:[[lon,lat]...], distance_m, duration_s,              // duration = driving time WITHOUT hazard penalties
  steps:[{instruction, distance_m, duration_s, location:[lon,lat], type, modifier, name, along_m, bearing_before, bearing_after, exit?}],
  avoided:[{layer, kind, id, label, location, multiplier, critical?, properties}], // hit by the fastest route, not by this one (safe mode); critical = 'zona-critica'|'paso-desnivel'|'hotspot-alto'|'marcado'
  crossed:[...same shape...],                                       // hazard features this route still traverses
  exposure:[{layer, kind, id, label, distance_m, along_m, location, feature_location, on_bridge, critical?, properties}], // within exposureRadius_m, sorted by along_m
  engine:'cauce-router/1.0.0 (OSM 2026-10-29)', mode, cost_s, warnings:[], blocked_fallback, block_critical,
  snapped:{from:{location, distance_m, name}, to:{...}}, hazards:{used:[ids], missing:[{id,error}]},
  timing_ms, settled,
  normal?, safe?, comparison? }                                     // only with compare:true
```

Step types: `depart, turn, continue, roundabout, exit roundabout, off ramp, on ramp, merge, uturn, arrive`. Modifiers use
OSRM vocabulary (`left`, `slight right`, `sharp left`, `straight`, `uturn`), so code that drew OSRM arrows keeps working.
Example instructions: "Sal hacia el este por Av. Ignacio L. Vallarta", "En la Glorieta Minerva, toma la 2.ª salida hacia …",
"Gira a la derecha en Av. Adolfo López Mateos Sur", "Toma la salida a la derecha hacia MEX 23", "Incorpórate a Periférico",
"Da vuelta en U", "Has llegado a tu destino". Names are shortened (Avenida→Av., Calzada→Calz., Boulevard→Blvd.).

Errors are thrown as `Error` with `code`: `OUT_OF_AREA` (point > 2.5 km from any road) or `NO_ROUTE`.

## Hazard model

- Every hazard feature is matched to the road edges it covers. Each edge is sampled every 8 m, and the multiplier applies to the
  **covered fraction**: `cost = time × (1 + (m−1)·fraction)`. The edge multiplier is the **max** over features, never a product.
  Infinity means blocked.
- **Critical hazards (`blockCritical`, on by default in safe mode and in the safe leg of `compare:true`).** Added 2026-10-29 after
  three nav prototypes found that with ×20 the safe Minerva → airport route still went through the Héroes Ferrocarrileros
  underpass (SI-GDL-031, zona crítica). The ×20 also only applied to the covered fraction of long edges.
  With it on:
  - in `kind:"observed"` layers, polygons whose `category` is "Zonas Criticas" are **blocked**;
  - in `kind:"observed"` layers, any feature whose text mentions "desnivel" is **blocked**, and so is every feature sharing a
    `name` with one (IMEPLAN publishes the street reference on the point and the polygon separately). In IMEPLAN 2026 that is
    224 blocked sites: 188 zonas críticas and 36 desnivel sites;
  - in `kind:"hotspot"` layers, features with `confidence` (or `riesgo`/`risk`) `alta|alto|high` get **×50**. That covers the 297 OSM
    below-grade roads in `underpasses` and the `riesgo:'alto'` points of `zapopan-pasos-desnivel-riesgo`. They get
    ×50 instead of ×10. They are not blocked, because they come from road tags, not observed flooding, and the observed underpasses are already blocked
    through IMEPLAN;
  - any feature with `critical: true` is blocked.

  Critical polygons that slip between the 8 m samples are caught by an exact segment-crossing test. Per-feature
  `router_cost` wins over this rule, and a layer opts out with `router.critical:false` in its index entry (`water-bodies` does).
  The blocked-fallback still applies: if no route exists, blocks become ×1000 on the covered fraction, `blocked_fallback:true` is set and a
  Spanish warning is added. Pass `blockCritical:false` to get the previous behaviour.
- Default multipliers by `kind`: `observed` ×20, `modeled` ×10 (or by `depth_m`/`max_depth_m`: <5 cm ×2, <15 cm ×5,
  <30 cm ×20, ≥30 cm blocked), `hotspot` ×6 (`confidence`/`riesgo` alta|alto ×10, media|medio ×4, baja|bajo ×2), `water` ×50, `terrain-index` ×3,
  `avoid` blocked. Precedence: per-feature `router_cost` (number or 'block'), then the index entry's `router.penalty`,
  then the call's `penalties`.
- Bridges are exempt from ground-level hazards (`router.affectsBridges:true` turns that off). Tunnels are not exempt.
- Line features with `osm_way_id` (e.g. `underpasses`) only affect edges of that OSM way, so the bridge above an
  underpass is not penalised. Lines buffer 10 m, points 40 m (`radius_m`, `router.pointRadius_m`, `router.lineRadius_m`).
  A point within 30 m of a polygon of the same layer is a duplicate (IMEPLAN publishes a point per site): it is reported, but adds no cost.
- If blocked edges leave no route, the router retries with blocked = ×1000 and sets `blocked_fallback:true` plus a
  Spanish warning. A route is always returned when one exists.
- Each layer is prepared once per page on first use (IMEPLAN 0.1–0.25 s, underpasses 0.1–0.2 s, water 0.35 s on the VPS;
  network time comes on top). Call `router.preload()` early.
- `exposure` labels: IMEPLAN polygons inherit the street reference of their matching point (`Referencia`).
  `exposure` entries for the same layer + name are merged.

### Plug-in points for simulations (pluggable `hazardCost`)

A simulation agent can publish in any of these forms, with no router change needed:
1. **GeoJSON** depth polygons/lines/points with `depth_m` (or `router_cost`) per feature, `kind:"modeled"`, `type:"geojson"`.
2. **Raster tiles** (`type:"raster-tiles"`, `url` or `tiles[0]` template `{z}/{x}/{y}`, `bounds`) with
   `router:{zoom (default 13), encoding:'terrarium'|'mapbox'|'gray'|'alpha', scale, offset, thresholds:[[value, multiplier|'block'], …]}`.
   The worker samples every road edge every 10 m with OffscreenCanvas, then reports `exposure` as contiguous stretches above the first threshold,
   with `max_value`. This path is browser-only and **untested against real simulation output** (no simulation had published at build time).
   Keep the tile count of `bounds` at the sample zoom ≤ 600.
3. **Plug-in module**: `router:{plugin:'/labs/…/router-plugin.js'}` exporting `prepare(ctx)` (ctx: `meta, entry, edgeCount, edgeInfo(e), resolveUrl`)
   that returns `{hazardCost(edge, ctx) → multiplier|Infinity, features?}`, or exporting `hazardCost` directly.

`edge` passed to hooks: `{id, wayId, name, ref, highway, layer, bridge, tunnel, oneway, length_m, speed_kmh, from, to, mid, coords}`.
Other `router.*` keys a producer may set in its index entry: `penalty`, `affectsBridges`, `radius_m`, `pointRadius_m`,
`lineRadius_m`, `default:false` (exclude from `'all'`/default safe mode).

## Hazard layers produced here

- **`water-bodies`** (kind `water`): 408 OSM areas (`natural=water`, `landuse=reservoir|basin`, `waterway=riverbank|dock`;
  pools and fountains excluded), clipped to the AOI, simplified to 2 m, < 300 m² dropped. Types: 120 reservoirs, 115 ponds, 75 untyped water,
  41 river areas, 26 lakes, 16 basins (vasos reguladores), 14 wastewater, 1 canal. Largest inside the AOI: Lago de Chapala (214 km² inside
  the AOI), Laguna de San Marcos, Laguna de Atotonilco, Laguna de Cajititlán, Laguna de Zacoalco, Presa de Santa Rosa, Represa El Ahogado,
  Presa Valencia. This is mapped permanent water, not flooding. Routing: ×50 (kind default) on non-bridge edges, `router.critical:false`. Only 22 road edges fall inside one (non-bridge).
- **`underpasses`** (kind `hotspot`; ×10 alta / ×4 media, ×50 alta with `blockCritical`): 776 LineStrings in 404 sites (`site` groups features within 120 m).
  `confidence:'alta'` (297): road mapped below grade in OSM (264 `tunnel=*`, 25 `layer<0`, 8 `cutting=*`).
  `confidence:'media'` (479): an at-grade road crossed by a road bridge (468) or rail bridge (11). This is the inferred lower road, ±45 m
  around the crossing. Bridge chains > 600 m (viaducts) and light-rail/metro structures are skipped, because the streets under
  Line 3's viaduct run at grade. Properties: `label` (e.g. "Paso inferior en Calzada Lázaro Cárdenas bajo …"), `reason`,
  `name`, `highway`, `over`, `osm_way_id`, `length_m`, `marker`.
  **Check against IMEPLAN:** 79 of the 82 IMEPLAN MUI 2026 features whose text mentions "desnivel" have an underpass feature within 150 m,
  against 55 of the 726 other IMEPLAN features. This layer is derived from road tags, not from observed flooding.

## Performance (measured 2026-10-29)

| where | load (graph + index) | fastest route | safe + compare (3 layers) |
|---|---|---|---|
| W10 Chromium 1217, Web Worker, 13 routes | 9.8 s total, of which 8.9 s network (W10 pulls ~1 MB/s from the VPS) + 0.5 s indexing | 4–57 ms | 15–125 ms (first call 1.8 s while layers download) |
| W10 Node 22, main thread, 13 routes | 0.6–0.7 s (local files) | median 16 ms, max 72 ms | median 42 ms, max 452 ms (first call includes layer prep) |
| VPS Node 22 (smoke test) | 0.65–0.8 s | Minerva → airport 70–90 ms | ~0.24–0.5 s cold |

The algorithm is unidirectional A* over travel time, using a straight-line/max-speed heuristic, typed-array CSR adjacency and a binary heap.
Bidirectional search was not needed: the slowest cross-metro route settles about 86k nodes in < 100 ms.

**Re-run with `blockCritical`** (W10 Node, `--ids observed-imeplan-2026,underpasses,water-bodies`, same 13 routes): no failures,
0 blocked fallbacks, 0 critical features crossed by any safe route, 0–2 IMEPLAN features crossed per safe route. Fastest median 14 ms
(max 62 ms), safe+compare median 39 ms (max 470 ms, first call). The test now asserts that no blocked critical feature is crossed
unless `blocked_fallback` is set.

**Validation** (`/labs/router-test/route-test.mjs --osrm`, seed 7, 12 random on-network OD pairs + the demo route, no
failures): median distance ratio vs the public OSRM demo is **1.001**, median duration ratio **1.098**. Our durations
include 8 s per traffic signal and are deliberately conservative. Demo route Glorieta Minerva → Aeropuerto GDL: **28.2 km, 33 min**
(OSRM: 28.7 km, 32 min). With IMEPLAN + underpasses + water as hazards, the safe route is 29.1 km / 38 min: it crosses 10 hazard features instead of 17 and
avoids 10, mostly the Lázaro Cárdenas underpasses and the Arcos/Niños Héroes sites. That safe route still went through the Héroes
Ferrocarrileros underpass (SI-GDL-031/1, zona crítica). With **`blockCritical`** (the default since 2026-10-29) the safe route is
**30.8 km / 41.7 min**. It crosses 1 IMEPLAN feature (SI-SLT-005, a sitio inundable that is not critical), against 8 for the normal route, 0 critical, no fallback.

## Limits (be honest on screen)

- No live traffic and no time-of-day speeds. Durations are free-flow estimates plus signal delay.
- **No turn restrictions** (OSM `type=restriction` relations are not applied) and no lane guidance. A route may take a
  forbidden left turn now and then.
- Rural/forest roads (La Primavera, hills) are slow (unpaved ×0.6) and `highway=track` is excluded, so routes that start there can be
  much longer than OSRM's. Test points are therefore drawn on the street network (≤ 150 m from a road).
- The hazard multipliers are design choices, not calibrated risk. "Safe" means "avoids the listed layers"; it does not mean "safe to drive in a storm".
- IMEPLAN polygons are a historical inventory, and underpasses/water are OSM-derived. Neither is a forecast.
- Snapping picks the nearest edge, nudged away from motorways/bridges/tunnels by 12 m. A click in a park can snap to a service road.
- Step text is generated from geometry and names. Unnamed links and junction stubs are merged heuristically, so some steps can be
  redundant ("Continúa por …") or missing on complex interchanges.
- The raster-tiles hazard path has not been tested with real simulation output.

## Switching from the stub (for prototype authors)

- No code change is required: `loadRouter()` and `route(from, to, {avoid, hazardIds})` keep their shape.
  `engine` no longer contains `stub` and `router.ready === true`, so detour fallbacks keyed on those (nav-mochi, nav-pixel, nav-neon) switch
  off automatically.
- Behaviour changes: passing `avoid` or `hazardIds` now makes the route **actually avoid** them (mode `safe`), and
  `avoided` is filled. `duration_s` never includes penalties (use `cost_s` for that). `steps[].instruction` is now Spanish
  prose instead of `"turn left Name"`. `type`/`modifier`/`name` remain available for icons.
- Since 2026-10-29, safe mode **blocks IMEPLAN zonas críticas and desnivel sites by itself** (`blockCritical`, default on).
  Prototypes no longer need their own hard-block lists for those; existing `avoid` lists keep working unchanged on top of it.
  `blockCritical:false` restores the plain ×20 behaviour.
- `avoid` polygons are hard blocks. If you also pass the same layer in `hazardIds`, both apply. That is fine, but `avoided` will list
  the feature once per layer (`layer:'avoid'` and the layer id).
- One shared worker per page: calling `loadRouter()` again returns the same instance.
- To keep using OSRM for comparison, import `/labs/shared/router/router.stub.js`.
