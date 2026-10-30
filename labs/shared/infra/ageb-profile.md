# `ageb-profile.geojson` — urban AGEB profile, ZMG

One polygon per **urban AGEB** (INEGI *Área Geoestadística Básica urbana*, Marco Geoestadístico 2020) in the ten
municipalities of the Área Metropolitana de Guadalajara: Guadalajara (039), Zapopan (120), San Pedro Tlaquepaque (098),
Tonalá (101), Tlajomulco de Zúñiga (097), El Salto (070), Juanacatlán (051), Ixtlahuacán de los Membrillos (044),
Zapotlanejo (124) and Acatlán de Juárez (002). **2,068 features**, 5.11 M inhabitants (Censo 2020). Rural AGEBs and
rural localities are not included (about 3% of the metro population).

Producer: `infra-data` agent, 2026-10-29. Feature `id` = `cvegeo`. A flat copy without geometry is `ageb-profile.csv`
(UTF-8 with BOM, same columns).

**Nothing in this file is modeled.** It joins census and marginalization statistics (INEGI, CONAPO), official observed
flood inventory (IMEPLAN), public block-level street-environment survey data (INEGI INV 2020), mapped features
(OpenStreetMap), satellite land cover (ESA WorldCover), and two compilations of approximate locations (press reports,
pluvial works). `prio_exploratoria` is an editorial composite for the "dónde invertir" prototypes, **not an official
index and not a recommendation**. Say so on screen.

## Geometry and method

- Source polygons: `14a.shp` from INEGI *Marco Geoestadístico, Censo de Población y Vivienda 2020* (Jalisco,
  UPC 889463807469), CRS `MEXICO_ITRF_2008_LCC` (EPSG:6372 parameters), reprojected with proj4 to WGS84 and simplified
  with Douglas–Peucker at 2 m; coordinates rounded to 1e-6°.
- Areas (`area_km2`) are computed in the original LCC projection before simplification.
- Spatial counts (IMEPLAN, OSM, underpasses, buildings, press points, works) use a label raster of the AGEBs on the
  **ESA WorldCover 10 m pixel grid** (1/12000°, ≈ 8.7 × 9.3 m): a point belongs to the AGEB whose cell contains it; a
  line is sampled every ≤ 3 m; a polygon is filled at cell centres. Features in streets on an AGEB boundary go to the
  AGEB whose cell they fall in. Points that fall in no urban AGEB (rural, outside the metro) are not counted.
- DENUE facility counts use DENUE's own AGEB key (`cve_ent+cve_mun+cve_loc+ageb`), not geometry.
- `null` = not available (suppressed by INEGI confidentiality `*`, AGEB absent from CONAPO, or INV query not yet
  available). `0` = looked for and none found **in that source**, which for OSM fields mostly means "not mapped".

## Fields

### Identity
| field | meaning |
|---|---|
| `cvegeo` | 13-char INEGI key: entidad(2) + municipio(3) + localidad(4) + AGEB(4) |
| `mun`, `mun_nombre` | municipality code and name |
| `loc`, `ageb` | locality code, AGEB code |
| `area_km2` | AGEB area, km² (LCC) |

### Population and housing — INEGI Censo de Población y Vivienda 2020, results by AGEB (row `MZA=000`)
Source: `ageb_mza_urbana_14_cpv2020_csv.zip`. Mnemonics in brackets.

| field | meaning |
|---|---|
| `pob` | total population [POBTOT] |
| `hogares` | census households [TOTHOG] |
| `viv_hab` | inhabited private dwellings [VIVPAR_HAB] |
| `viv_tot` | all dwellings incl. uninhabited [VIVTOT] |
| `dens_hab_km2` | `pob / area_km2` (gross density, includes streets/parks) |
| `pob_0_14`, `pct_0_14` | population aged 0–14 [POB0_14] and % of `pob` |
| `pob_65_mas`, `pct_65_mas` | population aged 65+ [POB65_MAS] and % |
| `pob_60_mas` | population 60+ [P_60YMAS] |
| `pob_discap`, `pct_discap` | population with disability [PCON_DISC] and % |
| `pob_sin_salud`, `pct_sin_salud` | population without health-service affiliation [PSINDER] and % |
| `graproes` | mean years of schooling, 15+ [GRAPROES] |
| `prom_ocup` | mean occupants per inhabited private dwelling [PROM_OCUP] |
| `pob_fem`, `hog_jefa` | female population; households headed by a woman [POBFEM, HOGJEF_F] |
| `pob_lengua_ind` | 3+ speaking an Indigenous language [P3YM_HLI] |
| `viv_sin_drenaje` | dwellings **without sanitary drainage** (sewer/septic) [VPH_NODREN]. Not storm drainage. |
| `viv_piso_tierra` | dwellings with dirt floor [VPH_PISOTI] |
| `viv_con_auto`, `pct_viv_sin_auto` | dwellings with car/van [VPH_AUTOM]; % of `viv_hab` without one (evacuation/mobility proxy) |
| `viv_sin_compu_int` | dwellings without computer nor internet [VPH_SINCINT] |
| `mza_censo` | number of census blocks (manzanas) listed for the AGEB |

### Marginalization — CONAPO Índice de Marginación Urbana 2020 (`IMU_2020.xls`)
| field | meaning |
|---|---|
| `im_2020` | IMU 2020 index (DP2 distance method). **Higher = less marginalized.** Comparable only within CONAPO's 2020 national urban set. |
| `imn_2020` | normalized index 0–1. **Higher = less marginalized.** |
| `gm_2020` | grade: `Muy alto`, `Alto`, `Medio`, `Bajo`, `Muy bajo` (marginalization). 200 AGEBs (mostly low-population) are not in CONAPO's table → `null`. ZMG distribution: Muy alto 63, Alto 250, Medio 543, Bajo 536, Muy bajo 476. |

### Facilities — INEGI DENUE, Jalisco CSV (counts by DENUE AGEB key)
Points are in `exposure-facilities.geojson` (8,340 points; 39 fall outside urban AGEBs).

| field | SCIAN codes | meaning |
|---|---|---|
| `n_escuela` | 6111* | schools: preschool, primary, secondary, upper-secondary, special education (public and private) |
| `n_guarderia` | 6244* | childcare centres |
| `n_hospital` | 622* | hospitals |
| `n_clinica` | 6214* | outpatient centres (clinics, health centres) |
| `n_consultorio` | 62111* | general/specialist medical offices |
| `n_residencia_cuidado` | 623* | care residences (elderly, disability) |
| `n_emergencia` | name match | establishments whose name contains "bomberos" or "protección civil" |
| `osm_emergencia_n` | OSM | fire stations, police, civil protection, shelters, assembly points mapped in OSM (`osm-emergency.geojson`) |

DENUE counts establishments (a school with two shifts may appear twice); it is a register, not an audit. Universities
(6113) are excluded.

### Observed flooding — IMEPLAN *Mapa Único de Inundaciones 2026* (`/labs/shared/hazard/observed-imeplan-2026.geojson`)
| field | meaning |
|---|---|
| `imeplan_sitios_n` | number of *Sitios inundables* polygons (historic flooding > 30 cm) that touch the AGEB (one site can touch several AGEBs) |
| `imeplan_zonas_n` | number of *Zonas críticas* polygons touching the AGEB (water entering properties, strong currents, etc.) |
| `imeplan_puntos_n` | IMEPLAN category points inside the AGEB |
| `imeplan_area_pct` | % of AGEB area (10 m cells) covered by any IMEPLAN site or critical-zone polygon |
| `imeplan_zona_area_pct` | % of AGEB area inside a critical zone |
| `imeplan_altura_max_rep` | maximum "Altura máxima reportada" among critical zones touching the AGEB, **verbatim value; the source does not state units** (category ranges are in cm, so cm is likely) |
| `imeplan_ids` | space-separated IMEPLAN site IDs (e.g. `SI-GDL-062`) |

An inventory of where flooding has been recorded, not a forecast for any storm. 491 AGEBs touch at least one polygon.

### Storm-drain presence — INEGI *Inventario Nacional de Viviendas 2020*, urban environment (`inv_*`)
The 2020 census *Cuestionario de entorno urbano* records, for every block (manzana), whether its street frontages have
an **"alcantarilla de drenaje pluvial"** (storm-water inlet/grate) in *all*, *some* or *none* of them. INEGI publishes
this only through its INV web app; we queried the app's own aggregation service once per AGEB with the AGEB polygon
shrunk 4 m inward (so neighbouring blocks across the boundary street are not counted; verified against census block
counts). Survey date 2020.

| field | meaning |
|---|---|
| `inv_mza_n` | blocks returned for the AGEB polygon |
| `inv_mza_eval` | blocks with an entorno-urbano answer for storm inlets (todas + alguna + ninguna) |
| `inv_pluvial_todas` / `_alguna` / `_ninguna` / `_ne` | blocks with inlets on all / some / no frontages / not specified |
| `inv_pct_sin_pluvial` | `100 × ninguna / (todas + alguna + ninguna)` — share of blocks with **no storm inlet on any frontage** |
| `inv_pct_calle_sin_recubrimiento` | % of blocks whose streets have no paving on any frontage |
| `inv_pct_calle_recubrimiento_parcial` | % of blocks with paving on only some frontages |
| `inv_pct_sin_banqueta` | % of blocks with no sidewalk on any frontage |
| `inv_pct_sin_arboles` | % of blocks with no trees on any frontage |

This is **presence of inlets observed from the street**, not pipe capacity, connectivity, or condition. A block with an
inlet can still flood (undersized or clogged collectors); a block without one may drain by surface to a nearby inlet.
Coverage: 2,067 of 2,068 AGEBs (INEGI's service returned an error page for `1409708221545`, Tlajomulco, on 3 attempts);
82 more AGEBs have no block with an answer (industrial, institutional or newly built areas) → `inv_pct_sin_pluvial = null`.
ZMG totals: 3,057 blocks with inlets on all frontages, 13,995 on some, 33,028 on none (66.0%); by municipality from
47.8% (Guadalajara) to 91.5% (Zapotlanejo) — table in `README.md`.

### Municipal records and infrastructure — Gobierno de Guadalajara (Atlas de Riesgos) and Gobierno de Zapopan
Available only for those two municipalities; `null`/`0` elsewhere means *no data published*, not *no flooding*.
Not comparable between the two (different agencies, periods and recording rules).

| field | meaning |
|---|---|
| `incidentes_municipales_disponibles` | `"Guadalajara 2010-2022"`, `"Zapopan 2017-2025"` or `null` — which incident series covers this AGEB |
| `gdl_reportes_n` | dated flood reports 2010–2022 inside the AGEB (`/labs/shared/hazard/observed-gdl-reportes-2010-2022.geojson`) |
| `gdl_reportes_nivel_max_cm` | maximum reported water level among them (`nivel`; unit not stated by the service, cm by context) |
| `zap_servicios_n` | flood emergency calls attended 2017–2025 (`observed-zapopan-incidentes-2017-2025.geojson`) |
| `zap_servicios_vivienda_n` | of which tipo = casa habitación (water in homes) |
| `gdl_colector_m` | metres of SIAPA collectors published in the Guadalajara atlas (`gdl-colectores-siapa.geojson`) |
| `gdl_canal_pluvial_m` | metres of Guadalajara storm canals (`gdl-canales-pluviales.geojson`) |
| `vasos_oficiales_n` | Guadalajara-atlas vasos reguladores whose centroid is in the AGEB |
| `zap_arroyo_intervenir_m`, `zap_arroyo_prioridad_alta_m` | metres of Zapopan stream reaches marked for intervention (all / priority Alto) |

### Mapped drainage and mobility — OpenStreetMap (ODbL) and router agent
| field | meaning |
|---|---|
| `osm_canal_dren_m` | metres of OSM `waterway=canal|drain|ditch` (`/labs/shared/infra/osm-waterways.geojson`) |
| `osm_entubado_m` | metres of OSM waterways in culvert/tunnel (`osm-drainage.geojson`, kind `alcantarilla_o_entubamiento`) |
| `osm_rio_arroyo_m` | metres of OSM `waterway=river|stream` |
| `osm_drenaje_km_por_km2` | `(osm_canal_dren_m + osm_entubado_m)/1000 / area_km2` |
| `osm_bocas_n`, `osm_vasos_n`, `osm_carcamos_n` | OSM storm inlets, basins/vasos, pumping stations (very sparsely mapped: 4 inlets and 32 basins in the whole AOI) |
| `obras_pluviales_n` | pluvial works 2023–2026 and named existing vasos reguladores from press/official announcements, **approximate geocodes** (`pluvial-works.geojson`) |
| `pasos_desnivel_n` | underpass sites with confidence `alta` (road mapped below grade in OSM) from the router's `/labs/shared/hazard/underpasses.geojson` |
| `cruces_bajo_puente_n` | sites with confidence `media` (at-grade road crossed by a bridge; inferred) from the same file |
| `prensa_puntos_n` | recurring flood points reported by the press 2023–2026 (`press-hotspots.geojson`, **reportes de prensa**, approximate geocodes) |

OSM drainage fields measure mapping effort as much as infrastructure. Do not present them as an inventory of the
storm-sewer network; there is no public one (see `README.md`).

### Surface — ESA WorldCover 10 m 2021 v200 (CC BY 4.0) and buildings
| field | meaning |
|---|---|
| `builtup_pct` | % of AGEB cells classed *Built-up* (class 50): proxy for impervious cover |
| `verde_pct` | % tree cover + shrubland + grassland (classes 10, 20, 30) |
| `arbol_pct` | % tree cover (10) |
| `agua_pct` | % permanent water + herbaceous wetland (80, 90) |
| `wc_celdas` | number of 10 m cells in the AGEB |
| `edif_n` | building footprints whose centroid is in the AGEB (Overture 2026-10-21.0, terrain agent's `buildings-attrs.csv`) |
| `edif_cobertura_pct` | sum of footprint areas / AGEB area × 100 (roof cover) |

WorldCover is 2021 imagery at 10 m; small parks and street trees are under-detected and dense new housing may lag.

### Exploratory priority (editorial)
`prio_exploratoria` (0–100, higher = more need in this composite) is a weighted mean of percentile ranks among populated
AGEBs (`pob > 0`). Components (`c_*`, 0–1):

| component | weight | input | rank direction |
|---|---|---|---|
| `c_obs` | 0.30 | `imeplan_area_pct` (AGEBs with no IMEPLAN polygon = 0; others ranked 0.05–1) | more observed flooding → higher |
| `c_sin_pluvial` | 0.20 | `inv_pct_sin_pluvial` | fewer storm inlets → higher |
| `c_marg` | 0.20 | `imn_2020` | more marginalized → higher |
| `c_dens` | 0.15 | `dens_hab_km2` | more people per km² → higher |
| `c_imperv` | 0.10 | `builtup_pct` | more built-up → higher |
| `c_dep` | 0.05 | `pct_0_14 + pct_65_mas + pct_discap` | more dependent population → higher |

Missing components are dropped and the remaining weights renormalized; `prio_pesos_usados` is the weight sum actually
used (1.0 when everything is present; 235 AGEBs use less, mostly because CONAPO has no index for them).
`prio_rank` = 1 for the highest score (2,031 ranked AGEBs; 37 have no population and get `null`). Prototypes are encouraged to let users
change weights (all inputs are in the file). Limits: observed inventories favour places where people report flooding;
upstream catchment, slope, pipe capacity and soil are not represented; no causal claim.

## Licences and attribution
INEGI (Censo 2020, Marco Geoestadístico, DENUE, INV 2020): *Términos de libre uso de la información del INEGI* — cite
"Fuente: INEGI". CONAPO: datos abiertos, Gobierno de México (Libre Uso MX). IMEPLAN MUI 2026: public inventory, cite
IMEPLAN. OpenStreetMap: © OpenStreetMap contributors, ODbL 1.0 (this file is a Produced Work with derived counts).
ESA WorldCover: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data, CC BY 4.0. Overture Maps:
ODbL / CDLA-Permissive per theme.

## Reproduce
W10 `C:\Users\Felip\contorno-compute\labs\infra-data\`: `node ageb-build.mjs` (base joins + rasters),
`node inv-scrape.mjs --shrink 4` (INV, resumable, ~1 request/s), `node ageb-publish.mjs` (this file). Copies of the
scripts: `/srv/contorno/data/guadalajara-flood-lab/work/infra-data/w10/`.
