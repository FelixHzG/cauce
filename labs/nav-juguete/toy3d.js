// nav-juguete · three.js custom layer: chunky toy car, glossy resin flood pools, toy road signs, barriers, flag.
// Coordinates: a local ENU frame (metres: x east, y north, z up) around `origin`, mapped into MapLibre's
// mercator space. Terrain heights come from map.queryTerrainElevation (includes the terrain exaggeration).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const INK = 0x2b2440;
const vinyl = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: .42, metalness: 0, clearcoat: .7, clearcoatRoughness: .22, ...o });
const outlineMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
function withOutline(mesh, k = 1.07) { const o = new THREE.Mesh(mesh.geometry, outlineMat); o.scale.setScalar(k); mesh.add(o); return mesh; }
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

// ---- icon drawing shared with signs ----
export function drawIcon(g, kind, cx, cy, s) {
  g.save(); g.translate(cx, cy); g.scale(s / 100, s / 100); g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = '#2b2440'; g.fillStyle = '#2b2440'; g.lineWidth = 9;
  if (kind === 'underpass') { // bridge deck over a road that dips into water
    g.fillRect(-44, -40, 88, 16);
    g.fillStyle = '#2ea8ff'; g.beginPath(); g.moveTo(-18, 6); g.quadraticCurveTo(0, 40, 18, 6); g.closePath(); g.fill(); g.lineWidth = 6; g.stroke();
    g.lineWidth = 9; g.beginPath(); g.moveTo(-46, -2); g.lineTo(-24, -2); g.quadraticCurveTo(0, 50, 24, -2); g.lineTo(46, -2); g.stroke();
  } else if (kind === 'critical') { // exclamation
    g.lineWidth = 15; g.beginPath(); g.moveTo(0, -36); g.lineTo(0, 10); g.stroke(); g.beginPath(); g.arc(0, 33, 9, 0, 7); g.fill();
  } else if (kind === 'modeled') { // wave
    g.beginPath(); for (let k = 0; k < 2; k++) { g.moveTo(-40, -6 + k * 26); g.bezierCurveTo(-20, -26 + k * 26, -10, 14 + k * 26, 0, -6 + k * 26); g.bezierCurveTo(10, -26 + k * 26, 20, 14 + k * 26, 40, -6 + k * 26); } g.stroke();
  } else { // drop (site / generic water)
    g.fillStyle = '#2ea8ff'; g.beginPath(); g.moveTo(0, -42); g.bezierCurveTo(14, -18, 32, 0, 32, 16); g.arc(0, 16, 32, 0, Math.PI); g.bezierCurveTo(-32, 0, -14, -18, 0, -42); g.closePath(); g.fill(); g.lineWidth = 7; g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(-12, 12, 6, 11, -.4, 0, 7); g.fill();
  }
  g.restore();
}

function buildCar() {
  const car = new THREE.Group(); // local: x right, y forward, z up; ~4.4 m long
  const body = withOutline(new THREE.Mesh(new RoundedBoxGeometry(2.05, 4.3, .95, 4, .34), vinyl(0xffc83d)), 1.05);
  body.position.z = .82; car.add(body);
  const cabin = withOutline(new THREE.Mesh(new RoundedBoxGeometry(1.74, 2.15, .86, 4, .3), vinyl(0xfff6e6)), 1.05);
  cabin.position.set(0, -.3, 1.62); car.add(cabin);
  const glass = vinyl(0x67c6ff, { roughness: .08, clearcoat: 1, clearcoatRoughness: .05 });
  const wf = new THREE.Mesh(new RoundedBoxGeometry(1.5, .12, .6, 2, .05), glass); wf.position.set(0, .8, 1.66); wf.rotation.x = -.35; car.add(wf);
  const wr = wf.clone(); wr.position.y = -1.4; wr.rotation.x = .35; car.add(wr);
  for (const sx of [-1, 1]) { const w = new THREE.Mesh(new RoundedBoxGeometry(.1, 1.75, .52, 2, .04), glass); w.position.set(sx * .87, -.3, 1.68); car.add(w); }
  const stripe = new THREE.Mesh(new RoundedBoxGeometry(2.09, 1.0, .2, 2, .08), vinyl(0xff5d73)); stripe.position.set(0, 1.35, .96); car.add(stripe);
  const tire = new THREE.MeshStandardMaterial({ color: 0x2f3042, roughness: .85 }); const hub = vinyl(0xf7f4ee);
  car.wheels = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(sx * 1.0, sy * 1.38, .52);
    const t = withOutline(new THREE.Mesh(new THREE.CylinderGeometry(.54, .54, .46, 22), tire), 1.06); t.rotation.z = Math.PI / 2; w.add(t);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(.27, .27, .5, 16), hub); h.rotation.z = Math.PI / 2; w.add(h);
    car.add(w); car.wheels.push(w);
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6c9, emissive: 0xfff2a8, emissiveIntensity: .9 });
  for (const sx of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(.2, 14, 10), lampMat); l.position.set(sx * .62, 2.12, .9); car.add(l); }
  const tail = new THREE.MeshStandardMaterial({ color: 0xff4d5e, emissive: 0xff2a3a, emissiveIntensity: .5 });
  for (const sx of [-1, 1]) { const l = new THREE.Mesh(new RoundedBoxGeometry(.42, .12, .22, 2, .05), tail); l.position.set(sx * .62, -2.16, .95); car.add(l); }
  const bump = vinyl(0xb9c0cc);
  for (const sy of [-1, 1]) { const b = new THREE.Mesh(new RoundedBoxGeometry(2.0, .34, .34, 2, .14), bump); b.position.set(0, sy * 2.15, .5); car.add(b); }
  // roof beacon: a glossy water drop (the cauce. mascot)
  const dropMat = vinyl(0x2ea8ff, { roughness: .12, clearcoat: 1, emissive: 0x2ea8ff, emissiveIntensity: 0 });
  const drop = new THREE.Group(); drop.position.set(0, -.3, 2.42);
  const ball = withOutline(new THREE.Mesh(new THREE.SphereGeometry(.42, 24, 16), dropMat), 1.08); drop.add(ball);
  const tip = withOutline(new THREE.Mesh(new THREE.ConeGeometry(.4, .62, 24), dropMat), 1.08); tip.rotation.x = Math.PI / 2; tip.position.z = .42; drop.add(tip);
  car.add(drop); car.drop = drop; car.dropMat = dropMat;
  // soft blob shadow
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 6.2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: canvasTex(128, 192, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(43,36,64,.55)'); r.addColorStop(1, 'rgba(43,36,64,0)'); g.fillStyle = r; g.save(); g.translate(w / 2, h / 2); g.scale(1, h / w); g.translate(-w / 2, -h / 2); g.fillRect(0, 0, w, h); g.restore(); }) }));
  sh.position.z = .06; car.add(sh); car.shadow = sh;
  return car;
}

function buildSign(kind) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, 4.2, 10), vinyl(0xf4efe6)); pole.rotation.x = Math.PI / 2; pole.position.z = 2.1; g.add(pole);
  const color = kind === 'underpass' ? 0xff5d73 : kind === 'critical' ? 0xff9f43 : kind === 'modeled' ? 0xb9a6ff : 0xffc83d;
  const board = new THREE.Group(); board.position.z = 5.2; g.add(board);
  const diamond = withOutline(new THREE.Mesh(new RoundedBoxGeometry(2.5, .42, 2.5, 3, .3), vinyl(color)), 1.08); diamond.rotation.y = Math.PI / 4; board.add(diamond);
  const tex = canvasTex(128, 128, (c, w, h) => drawIcon(c, kind, w / 2, h / 2 + 2, 92));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  face.rotation.x = Math.PI / 2; face.position.y = -.23; board.add(face); // faces -y (toward the viewer after yaw)
  const back = face.clone(); back.rotation.y = Math.PI; back.position.y = .23; back.rotation.x = -Math.PI / 2; board.add(back);
  return g;
}

function buildBarrier() {
  const g = new THREE.Group();
  const tex = canvasTex(256, 64, (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.fillStyle = '#ff4d5e'; for (let x = -64; x < w + 64; x += 64) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 32, h); c.lineTo(x + 64, 0); c.lineTo(x + 32, 0); c.closePath(); c.fill(); } });
  const bar = withOutline(new THREE.Mesh(new RoundedBoxGeometry(7, .55, 1.3, 3, .22), vinyl(0xffffff, { map: tex })), 1.06); bar.position.z = 2.0; g.add(bar);
  for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new RoundedBoxGeometry(.4, 1.6, 1.6, 2, .15), vinyl(0x5d5677)); leg.position.set(sx * 2.6, 0, .8); g.add(leg); }
  for (const sx of [-1, 1]) { const lamp = new THREE.Mesh(new THREE.SphereGeometry(.32, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xff9a00, emissiveIntensity: .8 })); lamp.position.set(sx * 2.8, 0, 3.0); g.add(lamp); }
  return g;
}

function buildFlag() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, 9, 10), vinyl(0xf4efe6)); pole.rotation.x = Math.PI / 2; pole.position.z = 4.5; g.add(pole);
  const tex = canvasTex(128, 96, (c, w, h) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) { c.fillStyle = (i + j) % 2 ? '#2b2440' : '#ffffff'; c.fillRect(i * 16, j * 16, 16, 16); } });
  const flag = withOutline(new THREE.Mesh(new RoundedBoxGeometry(3.6, .2, 2.5, 2, .08), vinyl(0xffffff, { map: tex })), 1.05); flag.position.set(1.9, 0, 7.6); g.add(flag); g.flag = flag;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.42, 16, 12), vinyl(0xffc83d)); ball.position.z = 9.2; g.add(ball);
  const base = withOutline(new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, .6, 24), vinyl(0x16b873)), 1.05); base.rotation.x = Math.PI / 2; base.position.z = .3; g.add(base);
  return g;
}
function buildPin() {
  const g = new THREE.Group(); const m = vinyl(0x5b4dff);
  const ball = withOutline(new THREE.Mesh(new THREE.SphereGeometry(1.3, 24, 16), m), 1.07); ball.position.z = 4.2; g.add(ball);
  const cone = withOutline(new THREE.Mesh(new THREE.ConeGeometry(1.0, 3, 20), m), 1.07); cone.rotation.x = -Math.PI / 2; cone.position.z = 2.1; g.add(cone);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(.5, 12, 8), vinyl(0xffffff)); dot.position.set(0, -1.05, 4.5); g.add(dot);
  return g;
}

export class Toy {
  constructor(map, origin) {
    this.map = map; this.origin = origin; this.state = null; this.pools = []; this.signs = []; this.barriers = [];
    const mo = maplibregl.MercatorCoordinate.fromLngLat(origin, 0); this.mo = mo; this.s = mo.meterInMercatorCoordinateUnits();
    this.layer = { id: 'toy3d', type: 'custom', renderingMode: '3d', onAdd: (m, gl) => this.onAdd(gl), render: (gl, args) => this.render(gl, args) };
  }
  local(lon, lat) { const m = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], 0); return [(m.x - this.mo.x) / this.s, -(m.y - this.mo.y) / this.s]; }
  elev(lon, lat) { const e = this.map.queryTerrainElevation([lon, lat]); if (Number.isFinite(e) && e > 1) { this.lastElev = e; return e; } return this.lastElev ?? 0; }
  onAdd(gl) {
    this.camera = new THREE.Camera(); this.camera.matrixWorldAutoUpdate = false; this.camera.matrixAutoUpdate = false; this.scene = new THREE.Scene();
    this.root = new THREE.Group(); this.scene.add(this.root); // ENU frame; the y flip (north -> mercator south) lives in the model matrix
    this.root.add(new THREE.HemisphereLight(0xfff8ea, 0xb7a6e8, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1); sun.position.set(-0.5, 0.35, 1); this.root.add(sun); this.root.add(sun.target);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false; this.renderer.toneMapping = THREE.NoToneMapping; this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.car = buildCar(); this.carRig = new THREE.Group(); this.carRig.add(this.car); this.root.add(this.carRig);
    this.flag = buildFlag(); this.root.add(this.flag); this.flag.visible = false;
    this.pin = buildPin(); this.root.add(this.pin); this.pin.visible = false;
    this.poolGroup = new THREE.Group(); this.root.add(this.poolGroup);
  }
  // ---- resin pools from hazard polygons ----
  setPools(hazards) {
    if (!this.root) return;
    for (const p of this.pools) { this.poolGroup.remove(p.mesh); p.mesh.geometry.dispose(); }
    this.pools = [];
    // cartoon glints on the top face (emissive map, world-metre UVs from ExtrudeGeometry) + deeper sides
    if (!this.glint) {
      this.glint = canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.lineCap = 'round'; g.strokeStyle = '#fff';
        const streak = (x, y, l, wd) => { g.lineWidth = wd; g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y - l * .55); g.stroke(); };
        streak(30, 120, 70, 14); streak(118, 92, 26, 12); streak(150, 230, 60, 12); streak(205, 60, 34, 10);
        g.fillStyle = '#fff'; for (const [x, y, r] of [[60, 200, 6], [220, 160, 5], [100, 40, 5]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
      });
      this.glint.wrapS = this.glint.wrapT = THREE.RepeatWrapping; this.glint.repeat.set(1 / 52, 1 / 52); this.glint.colorSpace = THREE.NoColorSpace;
    }
    const resin = (c, o, top) => new THREE.MeshPhysicalMaterial({ color: c, roughness: .1, metalness: 0, clearcoat: 1, clearcoatRoughness: .03, envMapIntensity: 1.1, transparent: true, opacity: o, emissive: top ? 0xffffff : 0x062a6e, emissiveIntensity: top ? .75 : .3, emissiveMap: top ? this.glint : null });
    const pair = (top, side, o) => [resin(top, o, true), resin(side, o, false)];
    const mats = { underpass: pair(0x1a7ff0, 0x0b5cc8, .92), critical: pair(0x2189f2, 0x0d62cc, .92), site: pair(0x2a9cf7, 0x1170d6, .9), modeled: pair(0x9277ff, 0x6a4fe0, .84) };
    const rimMat = new THREE.LineBasicMaterial({ color: 0xeafaff, transparent: true, opacity: .9 });
    for (const h of hazards) {
      const c = h.c; const [ox, oy] = this.local(c[0], c[1]);
      const pts = h.ring.map(p => { const [x, y] = this.local(p[0], p[1]); return new THREE.Vector2(x - ox, y - oy); });
      if (pts.length > 2 && pts[0].distanceTo(pts.at(-1)) < 1e-6) pts.pop();
      if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
      const size = Math.sqrt(Math.max(h.area, 1));
      const bevel = Math.min(2.4, size * .12);
      let geo;
      try { geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 3.4, bevelEnabled: true, bevelThickness: 1.6, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 4, curveSegments: 2 }); } catch (e) { continue; }
      const mat = mats[h.cat] || (h.kind === 'observed' ? mats.site : mats.modeled);
      const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 2; mesh.visible = false;
      const rimPts = pts.map(p => new THREE.Vector3(p.x, p.y, 3.4 + 1.6 + .15)); const rim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(rimPts), rimMat); mesh.add(rim);
      mesh.position.set(ox, oy, 0); this.poolGroup.add(mesh);
      this.pools.push({ h, mesh, base: geo.attributes.position.array.slice(), ox, oy, grown: 0, elevKey: '' });
    }
    this.terrainDirty = true;
  }
  // drape pool vertices on terrain using a 3x3 sample grid per polygon (bilinear)
  drapePools() {
    const ex = this.map.getTerrain() ? 1 : 0; if (!ex) return;
    for (const p of this.pools) {
      const [minx, miny, maxx, maxy] = p.h.bbox; // metres in geo frame; use lon/lat ring bounds instead
      let lo0 = Infinity, la0 = Infinity, lo1 = -Infinity, la1 = -Infinity;
      for (const [lo, la] of p.h.ring) { lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); la0 = Math.min(la0, la); la1 = Math.max(la1, la); }
      const E = []; for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) E.push(this.elev(lo0 + (lo1 - lo0) * i / 2, la0 + (la1 - la0) * j / 2));
      const [ax, ay] = this.local(lo0, la0), [bx, by] = this.local(lo1, la1);
      const ec = this.elev(p.h.c[0], p.h.c[1]);
      const pos = p.mesh.geometry.attributes.position; const a = pos.array, b = p.base;
      for (let k = 0; k < a.length; k += 3) {
        const x = b[k] + p.ox, y = b[k + 1] + p.oy;
        const u = Math.max(0, Math.min(1, (x - ax) / ((bx - ax) || 1))) * 2, v = Math.max(0, Math.min(1, (y - ay) / ((by - ay) || 1))) * 2;
        const i = Math.min(1, Math.floor(u)), j = Math.min(1, Math.floor(v)), fu = u - i, fv = v - j;
        const e = (E[j * 3 + i] * (1 - fu) + E[j * 3 + i + 1] * fu) * (1 - fv) + (E[(j + 1) * 3 + i] * (1 - fu) + E[(j + 1) * 3 + i + 1] * fu) * fv;
        a[k + 2] = b[k + 2] + (e - ec);
      }
      pos.needsUpdate = true; p.mesh.geometry.computeBoundingSphere(); p.ec = ec; // terrain offsets are small: keep the extrusion normals
    }
    this.terrainDirty = false;
  }
  setSigns(list) { // [{lon,lat,kind}]
    if (!this.root) return;
    for (const s of this.signs) this.root.remove(s.obj);
    this.signs = list.map(s => { const obj = buildSign(s.kind); obj.visible = false; this.root.add(obj); return { ...s, obj }; });
  }
  setBarriers(list) { // [{lon,lat,heading}]
    if (!this.root) return;
    for (const s of this.barriers) this.root.remove(s.obj);
    this.barriers = list.map(s => { const obj = buildBarrier(); obj.visible = false; this.root.add(obj); return { ...s, obj }; });
  }
  update(st) { this.state = st; }
  render(gl, args) {
    const st = this.state; if (!st || !this.renderer) return;
    if (!this.envReady) { const pm = new THREE.PMREMGenerator(this.renderer); this.scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; this.scene.environmentIntensity = .9; pm.dispose(); this.envReady = true; this.renderer.resetState(); }
    if (this.terrainDirty || st.redrape) this.drapePools();
    const map = this.map, zoom = map.getZoom(), bearing = map.getBearing() * Math.PI / 180;
    const mpp = 40075016.686 * Math.cos(this.origin[1] * Math.PI / 180) / (512 * 2 ** zoom);
    const unit = st.carPx * mpp / 4.4; // car-scale factor (screen-constant size)
    // car
    const [cx, cy] = this.local(st.car[0], st.car[1]); const ce = this.elev(st.car[0], st.car[1]);
    this.carRig.position.set(cx, cy, ce); this.carRig.rotation.z = -st.heading * Math.PI / 180; this.carRig.scale.setScalar(unit);
    this.car.position.z = st.bounce; this.car.rotation.x = st.pitchWobble; this.car.rotation.y = st.roll;
    for (const w of this.car.wheels) w.children[0].rotation.x = 0, w.rotation.x = -st.wheelTurn;
    this.car.drop.rotation.z = st.t * 1.6; this.car.dropMat.emissiveIntensity = st.beacon;
    if (this.glint) this.glint.offset.set((st.t * .012) % 1, (st.t * .006) % 1);
    this.car.visible = st.carVisible !== false;
    // pools: rising resin
    for (const p of this.pools) {
      const g = st.poolGrow ? st.poolGrow(p.h) : 0;
      p.mesh.visible = g > 0.001;
      if (p.mesh.visible) { const sink = 7.5; p.mesh.position.z = (p.ec ?? this.elev(p.h.c[0], p.h.c[1])) - sink + g * (sink + 1.2) + (st.poolBob ? st.poolBob(p.h) : 0); }
    }
    // signs (billboard yaw toward camera), barriers, flag, pin
    const signScale = unit * 1.05;
    for (const s of this.signs) {
      const k = st.signPop ? st.signPop(s) : 0; s.obj.visible = k > 0.001; if (!s.obj.visible) continue;
      const [x, y] = this.local(s.lon, s.lat); s.obj.position.set(x, y, this.elev(s.lon, s.lat));
      s.obj.rotation.z = -bearing; s.obj.scale.setScalar(signScale * k);
    }
    for (const b of this.barriers) {
      const k = st.barrierPop ? st.barrierPop(b) : 0; b.obj.visible = k > 0.001; if (!b.obj.visible) continue;
      const [x, y] = this.local(b.lon, b.lat); b.obj.position.set(x, y, this.elev(b.lon, b.lat));
      b.obj.rotation.z = -b.heading * Math.PI / 180; b.obj.scale.setScalar(unit * .9 * k);
    }
    if (st.dest) { const [x, y] = this.local(st.dest[0], st.dest[1]); this.flag.position.set(x, y, this.elev(st.dest[0], st.dest[1])); this.flag.scale.setScalar(unit * 1.1 * (st.flagPop ?? 1)); this.flag.visible = (st.flagPop ?? 1) > 0.001; this.flag.rotation.z = -bearing + .5; this.flag.flag.rotation.z = Math.sin(st.t * 5) * .12; }
    if (st.origin) { const [x, y] = this.local(st.origin[0], st.origin[1]); this.pin.position.set(x, y, this.elev(st.origin[0], st.origin[1])); this.pin.scale.setScalar(unit * .8 * (st.pinPop ?? 1)); this.pin.visible = (st.pinPop ?? 1) > 0.001; this.pin.rotation.z = -bearing; }
    // matrices: projection * view * (translate to origin, scale metres -> mercator units)
    const mvp = new THREE.Matrix4().fromArray(args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : args.modelViewProjectionMatrix);
    const model = new THREE.Matrix4().makeTranslation(this.mo.x, this.mo.y, 0).scale(new THREE.Vector3(this.s, -this.s, this.s));
    if (args.projectionMatrix && !this.noSplit) {
      const P = new THREE.Matrix4().fromArray(args.projectionMatrix);
      const V = P.clone().invert().multiply(mvp).multiply(model);
      this.camera.projectionMatrix.copy(P); this.camera.projectionMatrixInverse.copy(P).invert();
      this.camera.matrixWorldInverse.copy(V); this.camera.matrixWorld.copy(V).invert();
      this.camera.matrixAutoUpdate = false;
    } else {
      this.camera.projectionMatrix.copy(mvp.multiply(model)); this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    }
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }
}
