// cauce. nav-mochi — candy-pastel MapLibre style over OpenFreeMap (OpenMapTiles schema).
export const C = {
  bg: '#fff3f1', resid: '#ffecef', comm: '#fff1dc', indus: '#f1e8ff', park: '#c9f0d6', wood: '#b6e8c8',
  grass: '#d9f5dc', farm: '#fbf3df', water: '#b5e2ff', waterLine: '#86c8fb', aero: '#efe6ff', runway: '#dccdfb',
  motorway: '#ffb3cf', motorwayCase: '#f48bb3', trunk: '#ffc6db', primary: '#ffe39a', primaryCase: '#f1c063',
  secondary: '#ffffff', secondaryCase: '#e9cbe8', minor: '#ffffff', minorCase: '#f1dfee', rail: '#d9c7ee',
  label: '#8a5f8f', labelHalo: '#ffffff', place: '#b0729f',
  bld: ['#ffd7e6', '#e5dcff', '#d3f2e8', '#ffe7c4', '#dbeeff']
};
const FONT_B = ['Noto Sans Bold'], FONT_R = ['Noto Sans Regular'];
const z = (...stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops];
const cls = (...c) => ['match', ['get', 'class'], c, true, false];

export function mochiStyle() {
  const layers = [
    { id: 'bg', type: 'background', paint: { 'background-color': C.bg } },
    { id: 'landuse-res', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('residential', 'suburb', 'neighbourhood'), paint: { 'fill-color': C.resid, 'fill-opacity': 0.9 } },
    { id: 'landuse-comm', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('commercial', 'retail'), paint: { 'fill-color': C.comm } },
    { id: 'landuse-indus', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('industrial', 'garages', 'railway'), paint: { 'fill-color': C.indus } },
    { id: 'landuse-edu', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('school', 'university', 'college', 'hospital', 'stadium', 'cemetery'), paint: { 'fill-color': '#ffe9f4' } },
    { id: 'landcover-farm', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: cls('farmland'), paint: { 'fill-color': C.farm } },
    { id: 'landcover-grass', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: cls('grass', 'wetland'), paint: { 'fill-color': C.grass } },
    { id: 'landcover-wood', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: cls('wood', 'forest'), paint: { 'fill-color': C.wood } },
    { id: 'park', type: 'fill', source: 'ofm', 'source-layer': 'park', paint: { 'fill-color': C.park, 'fill-opacity': 0.85 } },
    { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 9, 0.35, 13, 0.22, 15, 0.08], 'hillshade-shadow-color': '#c3a9dc', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#e9cde6', 'hillshade-illumination-direction': 315 } },
    { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', paint: { 'fill-color': C.water } },
    { id: 'water-edge', type: 'line', source: 'ofm', 'source-layer': 'water', paint: { 'line-color': C.waterLine, 'line-width': z(10, 0.4, 16, 2) } },
    { id: 'waterway', type: 'line', source: 'ofm', 'source-layer': 'waterway', paint: { 'line-color': C.waterLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 'class'], 'river', 1.6, 0.7], 16, ['match', ['get', 'class'], 'river', 6, 3]], 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } },
    { id: 'aeroway-area', type: 'fill', source: 'ofm', 'source-layer': 'aeroway', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': C.aero } },
    { id: 'aeroway-runway', type: 'line', source: 'ofm', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'LineString'], cls('runway', 'taxiway')], paint: { 'line-color': C.runway, 'line-width': z(10, ['match', ['get', 'class'], 'runway', 3, 1], 16, ['match', ['get', 'class'], 'runway', 60, 14]) }, layout: { 'line-cap': 'round' } },
    // roads: casing then fill, rounded
    { id: 'road-case', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: ['all', ['!=', ['get', 'brunnel'], 'tunnel'], cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service')], layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['match', ['get', 'class'], 'motorway', 6, 'trunk', 5, 'primary', 4, 'secondary', 3, 'tertiary', 2, 1] },
      paint: { 'line-color': ['match', ['get', 'class'], 'motorway', C.motorwayCase, 'trunk', C.motorwayCase, 'primary', C.primaryCase, 'secondary', C.secondaryCase, 'tertiary', C.secondaryCase, C.minorCase],
        'line-width': z(10, ['match', ['get', 'class'], ['motorway', 'trunk'], 2.6, 'primary', 2.0, ['secondary', 'tertiary'], 1.2, 0.4], 17, ['match', ['get', 'class'], ['motorway', 'trunk'], 30, 'primary', 26, ['secondary', 'tertiary'], 22, 14]) } },
    { id: 'road', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: ['all', ['!=', ['get', 'brunnel'], 'tunnel'], cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service')], layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['match', ['get', 'class'], 'motorway', 6, 'trunk', 5, 'primary', 4, 'secondary', 3, 'tertiary', 2, 1] },
      paint: { 'line-color': ['match', ['get', 'class'], 'motorway', C.motorway, 'trunk', C.trunk, 'primary', C.primary, C.secondary],
        'line-width': z(10, ['match', ['get', 'class'], ['motorway', 'trunk'], 1.6, 'primary', 1.1, ['secondary', 'tertiary'], 0.6, 0.1], 17, ['match', ['get', 'class'], ['motorway', 'trunk'], 24, 'primary', 21, ['secondary', 'tertiary'], 17, 10]) } },
    { id: 'rail', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: cls('rail', 'transit'), paint: { 'line-color': C.rail, 'line-width': z(11, 0.8, 17, 4), 'line-dasharray': [2, 1.5] } },
    { id: 'building', type: 'fill-extrusion', source: 'ofm', 'source-layer': 'building', minzoom: 13.5, filter: ['!', ['has', 'hide_3d']],
      paint: { 'fill-extrusion-color': ['match', ['%', ['to-number', ['coalesce', ['get', 'render_height'], 3]], 5], 0, C.bld[0], 1, C.bld[1], 2, C.bld[2], 3, C.bld[3], C.bld[4]],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 4], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.3, 0.92], 'fill-extrusion-vertical-gradient': true } },
    // labels
    { id: 'road-label', type: 'symbol', source: 'ofm', 'source-layer': 'transportation_name', minzoom: 13, filter: cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary'),
      layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:es'], ['get', 'name']], 'text-font': FONT_B, 'text-size': z(13, 10, 17, 14), 'text-max-angle': 30, 'symbol-spacing': 420, 'text-padding': 8 },
      paint: { 'text-color': C.label, 'text-halo-color': C.labelHalo, 'text-halo-width': 2.2 } },
    { id: 'place-label', type: 'symbol', source: 'ofm', 'source-layer': 'place', filter: cls('city', 'town', 'suburb', 'quarter', 'neighbourhood'),
      layout: { 'text-field': ['coalesce', ['get', 'name:es'], ['get', 'name']], 'text-font': FONT_B, 'text-size': ['match', ['get', 'class'], 'city', 17, 'town', 14, 11.5], 'text-transform': 'uppercase', 'text-letter-spacing': 0.12, 'text-max-width': 8, 'text-padding': 14 },
      paint: { 'text-color': C.place, 'text-halo-color': 'rgba(255,255,255,.95)', 'text-halo-width': 2.4, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.95, 15, 0.75] } }
  ];
  return {
    version: 8,
    transition: { duration: 0, delay: 0 },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' },
      dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 12, attribution: '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">AWS Terrain Tiles</a>' }
    },
    sky: { 'sky-color': '#cfe6ff', 'horizon-color': '#ffe2f0', 'fog-color': '#fff1f6', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.75, 'atmosphere-blend': 0 },
    layers
  };
}

// Repeating fill patterns (polka dots for sitios, candy stripes for zonas críticas, dotted lilac for models).
export function makePatterns(map) {
  const mk = (name, size, draw) => { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); draw(g, size); map.addImage(name, g.getImageData(0, 0, size, size), { pixelRatio: 2 }); };
  mk('pat-dots', 28, (g, s) => { g.fillStyle = 'rgba(126,186,255,.30)'; g.fillRect(0, 0, s, s); g.fillStyle = 'rgba(80,150,245,.55)'; for (const [x, y] of [[7, 7], [21, 21]]) { g.beginPath(); g.arc(x, y, 3.6, 0, 7); g.fill(); } });
  mk('pat-stripes', 24, (g, s) => { g.fillStyle = 'rgba(255,140,175,.34)'; g.fillRect(0, 0, s, s); g.strokeStyle = 'rgba(255,92,141,.62)'; g.lineWidth = 5; for (let o = -s; o <= s; o += 12) { g.beginPath(); g.moveTo(o, s); g.lineTo(o + s, 0); g.stroke(); } });
  mk('pat-model', 24, (g, s) => { g.fillStyle = 'rgba(178,140,255,.26)'; g.fillRect(0, 0, s, s); g.fillStyle = 'rgba(140,96,240,.6)'; g.beginPath(); g.arc(6, 6, 2.4, 0, 7); g.fill(); g.beginPath(); g.arc(18, 18, 2.4, 0, 7); g.fill(); });
}
