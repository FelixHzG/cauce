# terrain-check — verificación de terreno INEGI (cauce. labs)

Technical check page for the terrain agent's web layers, not a prototype.

- MapLibre GL 5.20 (unpkg), OpenFreeMap "liberty" basemap (its 3D buildings hidden).
- 3D terrain = `/labs/shared/terrain/dtm/{z}/{x}/{y}.png` (INEGI MDT 5 m, Terrarium encoding), exaggeration 1.
- Overlays: hillshade (`terrain/hillshade`), nDSM "altura sobre el terreno (MDS−MDT INEGI, incluye árboles)" (`terrain/ndsm`),
  optional Overture building outlines (`infra/buildings`, z14+), optional switch to AWS Terrarium for comparison.
- Click → elevation from the 3D terrain mesh.
- URL params: `view=zmg|centro|barranca|norte|costura`, `bld=1` (outlines), `ndsm=0`, `aws=1`, `shot=1` (hide panel).
- `window.__terrainCheck = { map, loaded, idle(), view(name) }` for scripted screenshots (W10: `shots.mjs` in
  `/srv/contorno/data/guadalajara-flood-lab/work/terrain/scripts/`).

What was checked (W10 GPU screenshots, 1600×1000): no seams between INEGI sheets or at the Terrarium fill border, nDSM
blocks/streets line up with OpenFreeMap streets (no horizontal offset), Río Santiago (OSM) lies on the canyon floor of the
INEGI DTM in the Barranca de Huentitán. Beyond the tile-set bounds MapLibre has no terrain (flat edge visible from
high altitude) — by design; consumers can constrain the camera or fall back to AWS.

Data: INEGI MDT/MDS 5 m (satellite photogrammetry, 2016–2024 editions). Buildings © Overture Maps Foundation /
OpenStreetMap / Microsoft / Google. Basemap © OpenFreeMap, OpenMapTiles, OpenStreetMap.
