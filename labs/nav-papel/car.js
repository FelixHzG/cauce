// Folded-paper (origami) car as a MapLibre custom 3D layer, built from flat-shaded primitives with three.js.
import * as THREE from 'three';
import { INK } from './paper.js';

// Model frame: x = right, y = forward, z = up, units = "model metres" (scaled to a constant screen size).
function prism(profile, halfW, ridge, colorFn) {
  // profile: [[y,z],...] convex side silhouette (clockwise seen from +x). Each profile point is swept across x with
  // a raised centre ridge on the upper faces, which reads as a paper crease when flat-shaded.
  const L = [], C = [], Rr = [];
  for (const [y, z, w = halfW, rz = 0] of profile) { L.push([-w, y, z]); C.push([0, y, z + rz * ridge]); Rr.push([w, y, z]); }
  const pos = [], col = [];
  let fi = 0;
  const tri = (a, b, c, color) => { pos.push(...a, ...b, ...c); const k = new THREE.Color(color); const j = 1 + (((fi++ * 2654435761) >>> 0) % 1000 / 1000 - .5) * .10; k.multiplyScalar(j); for (let i = 0; i < 3; i++) col.push(k.r, k.g, k.b); };
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; const role = colorFn('strip', i);
    // left half strip and right half strip (two facets -> crease along the ridge)
    // outward winding (profile is counter-clockwise in the y-z plane)
    tri(L[i], C[j], C[i], role[0]); tri(L[i], L[j], C[j], role[0]);
    tri(C[i], Rr[j], Rr[i], role[1]); tri(C[i], C[j], Rr[j], role[1]);
  }
  // side panels (fan) — orientation fixed by DoubleSide material
  for (let i = 1; i < n - 1; i++) { tri(L[0], L[i + 1], L[i], colorFn('side', i)); tri(Rr[0], Rr[i], Rr[i + 1], colorFn('side', i)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function buildOrigamiCar() {
  const group = new THREE.Group();
  const pink = INK.pink, pinkLight = '#FF86C8', pinkDark = '#E0258F', cream = '#FFF6E6', teal = INK.teal, tealLight = '#3FB6B0';
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.FrontSide });
  // Lower body: front at +y. [y, z, halfWidth, ridgeFlag]
  const body = [
    [-2.25, 0.32, 0.92], [2.25, 0.32, 0.92], [2.42, 0.62, 0.90], [2.15, 0.98, 0.84, 1], [0.9, 1.08, 0.86, 1], [-1.9, 1.10, 0.86, 1], [-2.35, 0.86, 0.88],
  ];
  const strips = [[pinkDark, pinkDark], [pink, pinkDark], [pinkLight, pink], [pinkLight, pinkLight], [pinkLight, pink], [pink, pinkDark], [pinkDark, pink]];
  const bodyCol = (kind, i) => kind === 'side' ? (i % 2 ? pinkDark : pink) : (strips[i] || [pink, pink]);
  const g1 = prism(body, 0.92, 0.14, bodyCol);
  group.add(new THREE.Mesh(g1, mat));
  // Cabin: tapered (narrower roof) for a folded look. Windows teal, roof cream.
  const cabin = [
    [-1.55, 1.06, 0.80], [1.05, 1.06, 0.80], [0.45, 1.78, 0.62, 1], [-1.15, 1.80, 0.62, 1],
  ];
  const cabCol = (kind, i) => kind === 'side' ? tealLight : [[cream, cream], [teal, tealLight], [cream, '#F2E2C4'], [tealLight, teal]][i];
  group.add(new THREE.Mesh(prism(cabin, 0.8, 0.10, cabCol), mat));
  // Wheels: octagonal paper drums
  const wheelG = new THREE.CylinderGeometry(0.44, 0.44, 0.34, 8); wheelG.rotateZ(Math.PI / 2);
  const wheelM = new THREE.MeshLambertMaterial({ color: INK.black, flatShading: true });
  for (const [x, y] of [[-0.86, 1.35], [0.86, 1.35], [-0.86, -1.35], [0.86, -1.35]]) { const w = new THREE.Mesh(wheelG, wheelM); w.position.set(x, y, 0.44); group.add(w); }
  // Headlights / tail lights: tiny cream and dark tabs
  const tabG = new THREE.BoxGeometry(0.34, 0.06, 0.16);
  for (const x of [-0.55, 0.55]) {
    const h = new THREE.Mesh(tabG, new THREE.MeshBasicMaterial({ color: '#FFF4C2' })); h.position.set(x, 2.37, 0.72); group.add(h);
    const t = new THREE.Mesh(tabG, new THREE.MeshBasicMaterial({ color: '#8A0F4F' })); t.position.set(x, -2.33, 0.88); group.add(t);
  }
  // Inked silhouette: back faces of a slightly inflated copy (paper cut-out with a printed key line)
  const hullM = new THREE.MeshBasicMaterial({ color: INK.black, side: THREE.BackSide });
  for (const m of group.children.filter(m => m.isMesh && m.geometry !== tabG)) {
    const h = new THREE.Mesh(m.geometry, hullM); h.position.copy(m.position); h.rotation.copy(m.rotation);
    m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox, ctr = new THREE.Vector3(); bb.getCenter(ctr); const sz = new THREE.Vector3(); bb.getSize(sz);
    const k = new THREE.Vector3(1 + .26 / Math.max(.3, sz.x), 1 + .26 / Math.max(.3, sz.y), 1 + .26 / Math.max(.3, sz.z));
    h.geometry = m.geometry.clone(); h.geometry.translate(-ctr.x, -ctr.y, -ctr.z); h.geometry.scale(k.x, k.y, k.z); h.geometry.translate(ctr.x, ctr.y, ctr.z);
    group.add(h);
  }
  // Printed fold lines: riso warm-black linework on the creases
  const edgeM = new THREE.LineBasicMaterial({ color: INK.black, transparent: true, opacity: .85 });
  group.children.filter(m => m.isMesh && m.geometry !== tabG).forEach(m => {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 18), edgeM); e.position.copy(m.position); e.rotation.copy(m.rotation); group.add(e);
  });
  return group;
}

function shadowTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const ctx = c.getContext('2d');
  // soft rounded-rect shadow, paper-cut style (slightly hard core + blur)
  ctx.filter = 'blur(10px)'; ctx.fillStyle = 'rgba(43,36,32,0.55)';
  const r = 28; ctx.beginPath(); ctx.roundRect(22, 26, 84, 204, r); ctx.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// state: {lngLat:[lon,lat], heading:deg, mapBearing:deg, metersPerModelUnit, visible, hop}
export function createCarLayer(map) {
  const state = { lngLat: [0, 0], heading: 0, mapBearing: 0, scale: 10, visible: false, hop: 0, roll: 0 };
  let renderer, scene, camera, car, shadow, sun;
  const layer = {
    id: 'origami-car', type: 'custom', renderingMode: '3d',
    onAdd(m, gl) {
      camera = new THREE.Camera(); scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 1.25));
      sun = new THREE.DirectionalLight(0xffffff, 3.1); scene.add(sun);
      const pivot = new THREE.Group(); scene.add(pivot);
      car = buildOrigamiCar(); pivot.add(car);
      shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.6), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
      shadow.position.z = 0.02; pivot.add(shadow); shadow.renderOrder = -1;
      layer.pivot = pivot;
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    render(gl, args) {
      if (!state.visible) return;
      const mc = maplibregl.MercatorCoordinate.fromLngLat(state.lngLat, 0);
      const s = mc.meterInMercatorCoordinateUnits() * state.scale;
      const pivot = layer.pivot;
      pivot.rotation.set(0, 0, -state.heading * Math.PI / 180);
      car.position.set(0, 0, state.hop);
      car.rotation.set(0, state.roll, 0);
      // paper drop shadow: always toward screen bottom-right, like the map layers
      const ang = (state.mapBearing + 135 - state.heading) * Math.PI / 180;
      shadow.position.set(Math.sin(ang) * 0.55, Math.cos(ang) * 0.55, 0.02);
      // light from screen top-left, high
      const la = (state.mapBearing - 45) * Math.PI / 180; // sun lives in world space (not in the rotating pivot)
      sun.position.set(Math.sin(la) * 3, Math.cos(la) * 3, 6); sun.target = car;
      const proj = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
      const model = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z).scale(new THREE.Vector3(s, -s, s));
      camera.projectionMatrix = proj.multiply(model);
      // the car is a navigation puck: drawn over buildings/labels, with its own depth for self-occlusion
      renderer.resetState();
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
  return { layer, state };
}
