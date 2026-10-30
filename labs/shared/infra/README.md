# `/labs/shared/infra/` — infrastructure and exposure data for cauce. labs

Producer: `infra-data` agent, 2026-10-29. Registry: `index.json` (`{layers:[{id,label,category,kind,type,url,source,licence,retrieved,features,notes}]}`;
other agents' entries such as `buildings-overture` are kept). Visual check: `preview.html` (MapLibre, all main layers,
AGEB choropleth by field: `preview.html?field=inv_pct_sin_pluvial&on=gdlrep,zapinc`).

The question this folder answers: **where does the ZMG lack flood (storm-water) infrastructure, and who is exposed?**
Short answer on the data: there is **no public storm-sewer inventory for the metro area**. What exists publicly is
(1) INEGI's 2020 street-environment survey, which says for every block whether its street frontages have a storm-water
inlet; (2) the municipal risk atlases of **Guadalajara** (collectors, canals, vasos, dated flood reports) and **Zapopan**
(dated emergency calls, streams to intervene); (3) IMEPLAN's 2026 flood inventory; (4) scattered OSM mapping and press.
Everything here is observed, surveyed or mapped — nothing is modeled by us. The two third-party municipal models are
registered in `../hazard/index.json` with `kind:"modeled"`.

## Main product: `ageb-profile.geojson`
2,068 urban AGEBs of the 10 AMG municipalities with ~100 fields: population and households, age groups, disability,
health-service affiliation, CONAPO marginalization 2020, DENUE schools/health/care counts, IMEPLAN 2026 overlap,
INEGI INV 2020 storm-inlet presence, Guadalajara and Zapopan dated flood records, SIAPA collectors (GDL only), OSM
drainage, underpasses, built-up share, building cover, and an editorial `prio_exploratoria`. **Every field is documented
in `ageb-profile.md`.** `ageb-profile.csv` is the same table without geometry.

## Layers (all EPSG:4326)

| id / file | what | features | source · licence |
|---|---|---|---|
| `ageb-profile.geojson` | urban AGEB profile (see above) | 2,068 | INEGI, CONAPO, IMEPLAN, Gob. GDL/Zapopan, OSM, ESA · mixed (see md) |
| `exposure-facilities.geojson` | schools, childcare, hospitals, clinics, medical offices, care homes, fire/civil-protection names (DENUE) | 8,340 | INEGI DENUE Jalisco CSV · INEGI libre uso |
| `colonias-imc2020.geojson` | colonias with names, CP and CONAPO marginalization 2020 + 11 indicators | 1,991 | CONAPO imc2020_shp · Libre Uso MX |
| `gdl-colectores-siapa.geojson` | SIAPA collectors in Guadalajara (368 km; "colector mayor", year or diameter label) | 280 | Gob. Guadalajara Atlas de Riesgos WMS (fuente SIAPA) |
| `gdl-canales-pluviales.geojson` | named storm canals, cuenca, desilting m³ | 24 | Gob. Guadalajara Atlas de Riesgos |
| `gdl-vasos-reguladores.geojson` | detention basins (names only) | 13 | Gob. Guadalajara Atlas de Riesgos |
| `gdl-bases-bomberos.geojson` | municipal fire stations 2022 | 12 | Gob. Guadalajara |
| `zapopan-arroyos-a-intervenir.geojson` | stream reaches marked for intervention, riesgo/prioridad | 114 | Gob. Zapopan ArcGIS Online (CGSM) |
| `zapopan-cuencas-urbanas.geojson` | urban catchments of Zapopan | 18 | Gob. Zapopan ArcGIS Online |
| `osm-waterways.geojson` | rivers, streams, canals, drains, ditches (orchestrator, 2026-10-28) | 2,275 | OSM · ODbL |
| `osm-drainage-structures.geojson` | culverts/piped streams 781, basins 32, dams/weirs 54, WWTP 30, pumps 9, storm inlets 4 | 910 | OSM Jalisco extract 2026-10-29 · ODbL |
| `osm-emergency.geojson` | hospitals 123, clinics 84, police 33, assembly points 22, fire 15, civil protection 3, shelters 2 | 282 | OSM · ODbL |
| `osm-transit.geojson` | Tren Ligero L1–L3, Mi Macro Calzada/Periférico routes, busways, rails, stations | 517 | OSM · ODbL |
| `osm-green.geojson` | parks and green areas ≥ 1,000 m² | 3,395 | OSM · ODbL |
| `pluvial-works.geojson` | pluvial works 2023–2026 + named vasos, **approximate geocodes** | 31 | press/official releases (cited per feature) |
| `smn-estaciones.geojson` | 14 SMN climatological stations: normals 1991–2020, record 24 h rain + date | 14 | CONAGUA/SMN · Libre Uso MX |
| `rain-idf.json` | one regional IDF curve (Chen formula, station 14066) + design values | 1 curve, 48 cells | Campos-Aranda 2010; Atlas Metropolitano de Riesgos 2021; SMN; UdG |
| `worldcover-urban.png` | land cover 10 m, urban bbox, Mercator-row-resampled RGBA (image source) | 4440×5040 px | ESA WorldCover 2021 v200 · CC BY 4.0 |
| `worldcover-builtup-urban.png` | built-up mask (class 50) | 4440×5040 px | ESA WorldCover · CC BY 4.0 |
| `buildings/` (terrain agent) | Overture footprints as vector tiles | 1.8 M | see `buildings.json` |

Added to `../hazard/index.json` (kinds as noted):

| id | kind | features | note |
|---|---|---|---|
| `observed-gdl-reportes-2010-2022` | observed | 3,870 | dated reports with water level (`nivel_cm`), street + cross street, sector; Guadalajara only; `router.default:false` |
| `observed-gdl-areas-inundacion` | observed | 198 | areas with level class 10–30 / 30–100 cm or historic; Bomberos, UEPCyB, SVT, UdG |
| `modeled-gdl-riesgo-mdte` | modeled (municipal) | 112 | GDL atlas DEM-based risk areas; method undocumented; `router.default:false` |
| `observed-zapopan-incidentes-2017-2025` | observed | 2,230 | dated emergency calls for flooding (vía pública, vivienda, paso a desnivel…); Zapopan only; personal fields removed; included in the router's `hazardIds:"all"` (the router agent evaluated it and blocks its 84 paso-a-desnivel points) |
| `zapopan-pasos-desnivel-riesgo` | hotspot | 29 | municipal underpass risk alto/medio/bajo + cause |
| `gdl-pasos-desnivel-atlas` | hotspot | 11 | named underpasses from the GDL atlas; `router.default:false` (router's OSM `underpasses` already covers them) |
| `press-hotspots` | hotspot ("reportes de prensa") | 78 | recurring points named in news 2023–2026; approximate geocodes; `router.default:false` |
| `modeled-zapopan-peligro-tr100`, `modeled-zapopan-mancha-tr100` | modeled (municipal), raster-tiles | — | Zapopan's own Tr 100 yr flood model as ArcGIS cached tiles (z9–15, CORS ok); legend undocumented; `router.default:false` |

Water bodies and underpasses for the whole metro were already published by the router agent
(`../hazard/water-bodies.geojson`, `../hazard/underpasses.geojson`); they are referenced, not duplicated. The AGEB profile
counts the router's underpasses (`pasos_desnivel_n`, `cruces_bajo_puente_n`).

## Storm-inlet presence (INEGI INV 2020) — how it was obtained
INEGI's *Inventario Nacional de Viviendas 2020* includes, per block, "Alcantarilla de drenaje pluvial: en todas / alguna /
ninguna vialidad". There is no bulk download (the web app's download needs captcha + e-mail). We used the app's own
polygon-aggregation endpoint (`servicios/Inventario.ashx`, `metodo=seccHerramientasINV`) from INEGI's page in W10
Chromium, one sequential query per AGEB polygon shrunk 4 m inward (verified: block counts equal census block counts;
without shrinking, neighbouring blocks across the boundary street were included). Raw responses:
W10 `C:\Users\Felip\contorno-compute\labs\infra-data\out\inv-ageb.jsonl` (one line per AGEB, full 150-value array;
decoding in `ageb-publish.mjs`, order from INEGI's `inventario.js`).

<!--INV-->
Result: 2067 of 2068 AGEBs queried successfully (1 without data); 50,080 blocks with an answer.

| municipio | AGEBs | blocks: inlets on all frontages | some | none | % blocks with none | ≈ residents of blocks with no inlet (pob × % none, assumes even spread within the AGEB) |
|---|---|---|---|---|---|---|
| Zapotlanejo | 45 | 7 | 44 | 548 | 91.5 | 35,549 |
| Ixtlahuacán de los Membrillos | 37 | 1 | 68 | 673 | 90.7 | 40,290 |
| Juanacatlán | 18 | 0 | 37 | 290 | 88.7 | 22,455 |
| Acatlán de Juárez | 31 | 4 | 62 | 251 | 79.2 | 16,921 |
| Tlajomulco de Zúñiga | 377 | 438 | 1,269 | 6,012 | 77.9 | 490,471 |
| Tonalá | 228 | 411 | 796 | 4,131 | 77.4 | 419,461 |
| San Pedro Tlaquepaque | 234 | 273 | 1,364 | 4,538 | 73.5 | 468,951 |
| El Salto | 127 | 196 | 789 | 2,201 | 69.1 | 147,306 |
| Zapopan | 529 | 980 | 3,697 | 8,314 | 64.0 | 833,404 |
| Guadalajara | 442 | 747 | 5,869 | 6,070 | 47.8 | 692,001 |
| **ZMG** | 2068 | 3,057 | 13,995 | 33,028 | 66.0 | 3,166,810 |

Reading: "none" = no storm-water inlet on any frontage of the block, as observed by census enumerators in 2020. It is presence, not capacity: Guadalajara has inlets on about half of its blocks yet floods heavily, because its collectors are largely combined and were designed for ~50 mm/h (Atlas Metropolitano de Riesgos 2021). Block-level detail can be queried the same way if needed (INV app, per manzana).
<!--/INV-->

## What is NOT publicly obtainable (searched 2026-10-29)
- **SIAPA storm/combined sewer network** (pipes, diameters, depths, capacities, condition) for the metro area: no open
  data, no public GIS service. `www.siapa.gob.mx` itself fails TLS in modern browsers (ERR_SSL_VERSION_OR_CIPHER_MISMATCH).
  The only collector geometry public anywhere is the Guadalajara atlas layer (280 segments, labels only).
- **Storm-inlet (bocas de tormenta) locations**: SIAPA reports ~19,500 inlets in the AMG (2025 desilting campaign) but
  publishes no coordinates. Proxy used: INEGI INV 2020 block-level presence. OSM has 4 mapped inlets.
- **Metro inventory of vasos reguladores / tanques de tormenta / pozos de absorción** with locations and capacities: none.
  Partial: 13 polygons in the GDL atlas, 32 basins in OSM, 15 named vasos in the press (Tlajomulco says it maintains 18,
  Zapopan built 12 in 2021–24). No pozos de absorción data at all.
- **Plan Maestro / PIMI / "Plan Lluvias" works as GIS**: not published; only press releases without coordinates
  (compiled in `pluvial-works.geojson` with approximate geocodes).
- **Municipal atlases as data for Tlaquepaque, Tonalá, Tlajomulco, El Salto, Juanacatlán, Ixtlahuacán, Zapotlanejo,
  Acatlán**: not found as services (ArcGIS Online search, state geoservers). Their atlases, where they exist, are PDFs.
- **State portals**: `mapa.jalisco.gob.mx` GeoServer (2,533 layers) has drainage layers only for Puerto Vallarta and
  regional hydrography; IIEG MapaLab has no drainage layers; `datos.jalisco.gob.mx` no longer resolves (DNS).
- **IDF curves fitted to Guadalajara pluviographs**: not published (SIAPA criteria document offline; SCT isohyets are
  maps only; the UdG IDF article link is dead). Only a regional Chen-formula curve and design values (`rain-idf.json`).
- **Real-time / sub-hourly rain gauges** (SIAPA network, UdG/CUAAD stations, CONAGUA EMAs): not published as data; only
  SMN daily climatological stations (`smn-estaciones.geojson`).
- **Official shelter (refugio temporal) list as data**: not found; OSM has 2.
- **Flood incident records for municipalities other than Guadalajara and Zapopan**: not found.

## Decisions
- ZMG = the 10 AMG municipalities (incl. Acatlán de Juárez, which `config/aoi.json` omits). Urban AGEBs only.
- Joins on the INEGI 2020 frame (Censo 2020 + MG 2020 + CONAPO IMU 2020 share `cvegeo`). Spatial counts on a 10 m
  label raster aligned to WorldCover (exact enough for points/lines/areas at AGEB scale; documented in the md).
- Incident layers keep only date, time, type, colonia, street, casualties and source layer; names of crews/capturists
  and free-text narratives were removed. Raw downloads stay on the VPS work dir, not published.
- Municipal incident layers are not comparable across municipalities (different agencies and periods); the profile
  keeps them as separate fields and does not use them in `prio_exploratoria`.
- `prio_exploratoria` is an editorial composite (weights in `ageb-profile.md` and `metadata.priority_weights`), shown
  only to give prototypes a starting point; all its inputs are in the file so UIs can re-weight.

## Reproduce
Scripts: VPS `/srv/contorno/data/guadalajara-flood-lab/work/infra-data/` (`publish-layers.mjs` Zapopan/press/works,
`publish-gdl.mjs` Guadalajara atlas, `zapopan-fetch.mjs`, `registry.mjs`, `status.mjs`) and `w10/` (copies of the W10
scripts). W10 `C:\Users\Felip\contorno-compute\labs\infra-data\`: `raw/` (INEGI MG 2020 Jalisco, Censo 2020 AGEB/manzana,
DENUE, CONAPO IMU/IMC, WorldCover tile), `osm-extract.mjs`, `ageb-build.mjs`, `inv-scrape.mjs`, `ageb-publish.mjs`,
`colonias.mjs`, `gdl-fetch.mjs`, `smn-stations.mjs`, `worldcover-export.mjs`; outputs in `out/` (incl. full-resolution
`worldcover-aoi-10m.u8` + `.json` for simulations, `ageb-label.u16` AGEB label raster, `inv-ageb.jsonl`).
