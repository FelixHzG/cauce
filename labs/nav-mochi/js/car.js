// cauce. nav-mochi — chibi car + Gotita copilot, built from three.js primitives (no external assets).
// Rendered as a MapLibre custom 3D layer. Model units ≈ metres of a life-size toy car (length ≈ 3.4);
// the layer scales it so it keeps a constant on-screen size, like a navigation arrow.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const D2R = Math.PI / 180;
const OUTLINE = 0x5b3a63;

function toonGradient() {
  const t = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}

export function createCar(maplibregl) {
  const grad = toonGradient();
  const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: grad, ...extra });
  const flat = color => new THREE.MeshBasicMaterial({ color });
  const outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide });

  const root = new THREE.Group();          // world-fixed (lights live here too)
  const car = new THREE.Group();           // rotated by heading
  const body = new THREE.Group();          // bounces
  root.add(car); car.add(body);

  const add = (parent, geo, mat, pos, opts = {}) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(...pos);
    if (opts.rot) m.rotation.set(...opts.rot); if (opts.scale) m.scale.set(...opts.scale);
    parent.add(m);
    if (opts.outline) { const o = new THREE.Mesh(geo, outlineMat); o.position.copy(m.position); o.rotation.copy(m.rotation); o.scale.copy(m.scale).multiplyScalar(1 + opts.outline); parent.add(o); }
    return m;
  };

  // --- body (front of the car points to -Z) ---
  const PINK = 0xff8fbc, CREAM = 0xfff6fa, GLASS = 0x9fdcff, PLUM = 0x6f5a8f;
  add(body, new RoundedBoxGeometry(2.0, 1.05, 3.1, 5, 0.45), toon(PINK), [0, 0.86, 0], { outline: 0.045 });
  add(body, new RoundedBoxGeometry(1.72, 0.95, 1.75, 5, 0.42), toon(CREAM), [0, 1.62, 0.28], { outline: 0.05 });
  // windows
  add(body, new RoundedBoxGeometry(1.42, 0.6, 0.08, 3, 0.03), toon(GLASS), [0, 1.66, -0.6], { rot: [-0.12, 0, 0] });   // windshield
  add(body, new RoundedBoxGeometry(1.42, 0.55, 0.08, 3, 0.03), toon(GLASS), [0, 1.66, 1.16], { rot: [0.1, 0, 0] });    // rear window
  for (const sx of [-1, 1]) add(body, new RoundedBoxGeometry(0.08, 0.5, 1.25, 3, 0.03), toon(GLASS), [sx * 0.87, 1.66, 0.28]);
  // window shine stripes
  const shine = flat(0xffffff);
  add(body, new THREE.BoxGeometry(0.16, 0.42, 0.02), shine, [-0.38, 1.68, 1.215], { rot: [0.1, 0, 0.5] });
  add(body, new THREE.BoxGeometry(0.07, 0.36, 0.02), shine, [-0.16, 1.68, 1.215], { rot: [0.1, 0, 0.5] });
  // bumpers
  add(body, new RoundedBoxGeometry(2.05, 0.32, 0.4, 3, 0.15), toon(0xffd3e5), [0, 0.5, -1.45], { outline: 0.06 });
  add(body, new RoundedBoxGeometry(2.05, 0.32, 0.4, 3, 0.15), toon(0xffd3e5), [0, 0.5, 1.45], { outline: 0.06 });

  // --- face on the front ---
  const black = flat(0x3a2440), white = flat(0xffffff), blush = new THREE.MeshBasicMaterial({ color: 0xff6f9f, transparent: true, opacity: 0.7 });
  for (const sx of [-1, 1]) {
    add(body, new THREE.SphereGeometry(0.2, 20, 14), black, [sx * 0.45, 1.0, -1.55], { scale: [0.95, 1.25, 0.45] });
    add(body, new THREE.SphereGeometry(0.07, 12, 8), white, [sx * 0.45 - 0.06, 1.09, -1.63]);
    add(body, new THREE.SphereGeometry(0.035, 10, 6), white, [sx * 0.45 + 0.06, 0.95, -1.63]);
    add(body, new THREE.CircleGeometry(0.15, 20), blush, [sx * 0.76, 0.78, -1.557], { rot: [0, Math.PI, 0], scale: [1.3, 0.8, 1] });
  }
  add(body, new THREE.TorusGeometry(0.12, 0.035, 8, 20, Math.PI), black, [0, 0.82, -1.56], { rot: [0, 0, Math.PI] });

  // --- heart tail lights ---
  const heart = new THREE.Shape();
  heart.moveTo(25, 25); heart.bezierCurveTo(25, 25, 20, 0, 0, 0); heart.bezierCurveTo(-30, 0, -30, 35, -30, 35);
  heart.bezierCurveTo(-30, 55, -10, 77, 25, 95); heart.bezierCurveTo(60, 77, 80, 55, 80, 35);
  heart.bezierCurveTo(80, 35, 80, 0, 50, 0); heart.bezierCurveTo(35, 0, 25, 25, 25, 25);
  const hg = new THREE.ExtrudeGeometry(heart, { depth: 8, bevelEnabled: true, bevelSize: 4, bevelThickness: 4, bevelSegments: 3 });
  hg.translate(-25, -47, 0); hg.scale(0.0042, -0.0042, 0.004);
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3d7f });
  for (const sx of [-1, 1]) add(body, hg, tailMat, [sx * 0.62, 1.02, 1.56], { outline: 0.0 });

  // --- wheels ---
  const wheels = [];
  const wGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.36, 28); wGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.38, 20); hubGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.39, 0.06, 0.3);
  for (const [x, zz] of [[-0.98, -1.0], [0.98, -1.0], [-0.98, 1.0], [0.98, 1.0]]) {
    const g = new THREE.Group(); g.position.set(x, 0.43, zz); car.add(g);
    add(g, wGeo, toon(PLUM), [0, 0, 0], { outline: 0.07 });
    add(g, hubGeo, toon(0xfff1c9), [0, 0, 0]);
    add(g, spokeGeo, flat(0xffb3cf), [0, 0, 0]);
    wheels.push(g);
  }

  // --- Gotita, the water-drop copilot, on the roof looking back at the camera ---
  const drop = new THREE.Group(); drop.position.set(0, 2.08, 0.42); body.add(drop);
  const pts = []; for (let i = 0; i <= 32; i++) { const t = Math.PI - i / 32 * Math.PI; pts.push(new THREE.Vector2(Math.sin(t) * Math.pow(Math.sin(t / 2), 1.25) * 0.5, Math.cos(t) * 0.62)); }
  const dGeo = new THREE.LatheGeometry(pts, 32);
  const dropBody = add(drop, dGeo, toon(0x7cc6ff), [0, 0.62, 0], { outline: 0.06 });
  add(drop, new THREE.SphereGeometry(0.07, 10, 8), flat(0xffffff), [-0.2, 0.62 + 0.18, 0.32], { scale: [1, 1.6, 0.6] }); // shine
  for (const sx of [-1, 1]) {
    add(drop, new THREE.SphereGeometry(0.075, 14, 10), black, [sx * 0.16, 0.5, 0.45], { scale: [1, 1.3, 0.5] });
    add(drop, new THREE.SphereGeometry(0.026, 8, 6), white, [sx * 0.16 - 0.025, 0.535, 0.49]);
    add(drop, new THREE.CircleGeometry(0.06, 14), blush, [sx * 0.29, 0.4, 0.43], { rot: [0, sx * 0.5, 0], scale: [1.2, 0.7, 1] });
  }
  add(drop, new THREE.TorusGeometry(0.05, 0.018, 6, 12, Math.PI), black, [0, 0.39, 0.47], { rot: [0, 0, Math.PI] });
  // little waving arm
  const arm = new THREE.Group(); arm.position.set(0.36, 0.38, 0.1); drop.add(arm);
  add(arm, new THREE.CapsuleGeometry(0.06, 0.2, 4, 8), toon(0x7cc6ff), [0, 0.13, 0], { outline: 0.15 });

  // --- puffs + blob shadow ---
  const puffMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: grad, transparent: true, opacity: 0.9 });
  const puffs = [0, 1, 2].map(i => add(car, new THREE.SphereGeometry(0.22, 14, 10), puffMat.clone(), [0.55, 0.45, 1.9 + i * 0.4]));
  const sc = document.createElement('canvas'); sc.width = sc.height = 128; const sg = sc.getContext('2d');
  const rg = sg.createRadialGradient(64, 64, 4, 64, 64, 62); rg.addColorStop(0, 'rgba(110,70,140,.42)'); rg.addColorStop(0.6, 'rgba(110,70,140,.22)'); rg.addColorStop(1, 'rgba(110,70,140,0)');
  sg.fillStyle = rg; sg.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(0.25, 0.02, 0.2); car.add(shadow);

  // lights (world-fixed: car rotates under them)
  root.add(new THREE.HemisphereLight(0xffffff, 0xd9c2ee, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-3, 6, 2); root.add(sun);

  const state = { lngLat: [-103.39, 20.67], heading: 0, meters: 60, dist: 0, t: 0, moving: 0, hop: 0, wave: 0, visible: true };
  let renderer, camera, map;

  const layer = {
    id: 'mochi-car', type: 'custom', renderingMode: '3d',
    onAdd(m, gl) {
      map = m; camera = new THREE.Camera();
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    render(gl, args) {
      if (!state.visible) return;
      const mc = maplibregl.MercatorCoordinate.fromLngLat(state.lngLat, 0);
      const s = mc.meterInMercatorCoordinateUnits() * state.meters / 3.4;
      // animate
      car.rotation.y = -state.heading * D2R;
      const spin = state.dist / (0.43 * (state.meters / 3.4));
      wheels.forEach(w => w.rotation.x = -spin);
      body.position.y = Math.abs(Math.sin(state.t * 11)) * 0.06 * state.moving + state.hop * 0.0;
      body.rotation.z = Math.sin(state.t * 5.5) * 0.02 * state.moving;
      drop.position.y = 2.08 + Math.abs(Math.sin(state.t * 4.2)) * 0.12 + state.hop * 0.9;
      drop.rotation.z = Math.sin(state.t * 3.1) * 0.12;
      dropBody.scale.set(1 + state.hop * 0.08, 1 - state.hop * 0.06, 1 + state.hop * 0.08);
      arm.rotation.z = -0.6 - Math.abs(Math.sin(state.t * 7)) * 0.9 * (0.4 + state.wave);
      puffs.forEach((p, i) => { const ph = (state.t * 1.8 + i / 3) % 1; p.position.set(0.55 + ph * 0.3, 0.45 + ph * 0.5, 1.75 + ph * 1.4); const k = (0.5 + ph * 1.2) * (state.moving > 0.05 ? 1 : 0.001); p.scale.setScalar(k); p.material.opacity = 0.85 * (1 - ph); });
      const m4 = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
      const l = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z).scale(new THREE.Vector3(s, -s, s)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      camera.projectionMatrix = m4.multiply(l);
      renderer.resetState();
      renderer.clearDepth();   // the toy car is drawn over buildings it would otherwise clip
      renderer.render(root, camera);
    }
  };
  return { layer, state };
}
