// Extract named OSM place nodes (colonias etc.) inside the urban bbox from the router's Jalisco extract.
import fs from 'node:fs';
import { blocks, decodePrimitive } from '../router/pbf.mjs';
const buf = fs.readFileSync('../router/jalisco-latest.osm.pbf');
const B = [-103.6, 20.35, -103.12, 20.92];
const KEEP = new Set(['neighbourhood', 'suburb', 'quarter', 'village', 'town', 'city', 'hamlet', 'locality', 'city_block', 'borough']);
const out = [];
for (const b of blocks(buf)) {
  if (b.type !== 'OSMData') continue;
  decodePrimitive(b.data, {
    node(id, lon, lat, tags) {
      if (!tags || !tags.place || !tags.name || !KEEP.has(tags.place)) return;
      if (lon < B[0] || lon > B[2] || lat < B[1] || lat > B[3]) return;
      out.push({ name: tags.name, place: tags.place, lon: +lon.toFixed(6), lat: +lat.toFixed(6) });
    }, way() {}, relation() {}
  }, { nodes: true, ways: false, relations: false });
}
fs.writeFileSync('places.json', JSON.stringify(out));
const c = {}; for (const p of out) c[p.place] = (c[p.place] || 0) + 1;
console.log(out.length, JSON.stringify(c));
