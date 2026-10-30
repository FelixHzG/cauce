// cauce. nav-neon — three.js custom layer: procedural neon car, headlight beams, tail-light trails,
// hazard beacons (light pillars, pulsing rings, glowing puddles shaped like the IMEPLAN polygons)
// and wet-road splashes. Everything is a pure function of the state passed to update() so frames
// are deterministic for __cauceDemo.seek(t).
import * as THREE from 'three';

export const KIND_COLORS = {
  site: '#3d8bff',      // encharcamiento registrado (IMEPLAN sitio inundable)
  critical: '#ff2bd6',  // zona crítica IMEPLAN
  underpass: '#ffb020', // paso a desnivel inundable
  modeled: '#4dffc3',   // agua modelada (simulaciones, cuando existan)
};

const glowVert = /* glsl */`
  varying vec3 vPos; varying vec2 vUv;
  void main(){ vPos = position; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

function additive(fragment, uniforms = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: glowVert, fragmentShader: fragment,
    uniforms: { uColor: { value: new THREE.Color('#ffffff') }, uTime: { value: 0 }, uAlpha: { value: 1 }, ...uniforms },
    // shaders output premultiplied colour → pure additive ONE/ONE (alpha channel untouched)
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
}

// --- the car ---------------------------------------------------------------------------------
function buildCar() {
  const car = new THREE.Group();          // car frame: x forward, y left, z up (metres)
  const W = 1.9;
  const extrude = (pts, depth, bevel = 0.05) => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8 });
    g.rotateX(Math.PI / 2); g.translate(0, depth / 2, 0);
    return g;
  };
  // low fastback coupé silhouette
  const bodyGeo = extrude([[-2.28, 0.26], [2.18, 0.26], [2.36, 0.38], [2.34, 0.56], [2.06, 0.72], [1.02, 0.84], [-1.40, 0.92], [-2.16, 0.90], [-2.33, 0.70]], W, 0.07);
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#3a2a8a', metalness: 0.5, roughness: 0.3, emissive: '#1e1050', emissiveIntensity: 1 });
  const body = new THREE.Mesh(bodyGeo, bodyMat); car.add(body);
  const cabinGeo = extrude([[1.05, 0.82], [0.12, 1.26], [-0.78, 1.28], [-1.95, 0.90]], 1.5, 0.05);
  const glass = new THREE.MeshStandardMaterial({ color: '#04101c', metalness: 0.9, roughness: 0.08, emissive: '#0d4a6e', emissiveIntensity: 1.2 });
  car.add(new THREE.Mesh(cabinGeo, glass));
  // Neon outlines (Tron-like) — the car reads by its light at night.
  const edgeMat = new THREE.LineBasicMaterial({ color: '#4ff7ff', transparent: true, opacity: 1 });
  car.add(new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo, 25), edgeMat));
  car.add(new THREE.LineSegments(new THREE.EdgesGeometry(cabinGeo, 25), new THREE.LineBasicMaterial({ color: '#c8fcff', transparent: true, opacity: 0.85 })));
  const stripeMat = new THREE.MeshBasicMaterial({ color: '#ff2bd6' });
  for (const side of [1, -1]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.04, 0.07), stripeMat); st.position.set(-0.05, side * (W / 2 + 0.075), 0.5); car.add(st);
    const roofRail = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: '#4ff7ff' })); roofRail.position.set(-0.33, side * 0.62, 1.30); car.add(roofRail);
  }
  // hood chevron + roof light bar
  const chevMat = new THREE.MeshBasicMaterial({ color: '#4ff7ff' });
  for (const side of [1, -1]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.03), chevMat); c.position.set(1.62, side * 0.32, 0.80); c.rotation.z = side * 0.55; car.add(c); }
  // Wheels with glowing rims.
  const tyre = new THREE.MeshStandardMaterial({ color: '#05050a', roughness: 0.8 });
  const rimMat = new THREE.MeshBasicMaterial({ color: '#4ff7ff' });
  const wheels = [];
  for (const x of [1.42, -1.42]) for (const side of [1, -1]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.28, 20), tyre));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 6, 20), rimMat); rim.rotation.x = Math.PI / 2; rim.position.y = side * 0.145; w.add(rim);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 0.05), rimMat); spoke.position.y = side * 0.146; w.add(spoke);
    w.position.set(x, side * (W / 2 - 0.06), 0.37); car.add(w); wheels.push(w);
  }
  // Lights.
  const head = new THREE.MeshBasicMaterial({ color: '#f2fdff' });
  for (const side of [1, -1]) { const h = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.08), head); h.position.set(2.31, side * 0.62, 0.62); h.rotation.z = side * -0.25; car.add(h); }
  const tail = new THREE.MeshBasicMaterial({ color: '#ff2340' });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.7, 0.07), tail); bar.position.set(-2.34, 0, 0.8); car.add(bar);
  for (const side of [1, -1]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.15), new THREE.MeshBasicMaterial({ color: '#ff6a7c' })); t.position.set(-2.35, side * 0.78, 0.8); car.add(t); }
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.86, 0.05), bodyMat); spoiler.position.set(-2.05, 0, 1.02); car.add(spoiler);
  car.add(new THREE.LineSegments(new THREE.EdgesGeometry(spoiler.geometry), edgeMat)).position.copy(spoiler.position);

  // Headlight beams (volumetric cones) and ground pools.
  const beamMat = additive(`
    uniform vec3 uColor; uniform float uAlpha; varying vec3 vPos;
    void main(){ float a = clamp(vPos.x/22.0,0.0,1.0); float r = length(vPos.yz)/(0.15+a*5.0);
      float k = pow(1.0-a,1.6)*(1.0-smoothstep(0.55,1.0,r))*0.30*uAlpha; gl_FragColor = vec4(uColor*k, k); }`);
  beamMat.uniforms.uColor.value.set('#c9f6ff');
  for (const side of [1, -1]) {
    const g = new THREE.CylinderGeometry(0.15, 5.2, 22, 28, 1, true);
    g.rotateZ(Math.PI / 2); g.translate(11, 0, 0);
    const beam = new THREE.Mesh(g, beamMat); beam.position.set(2.3, side * 0.6, 0.7); beam.rotation.y = 0.07; beam.rotation.z = side * -0.05; car.add(beam);
  }
  const poolMat = additive(`
    uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
    void main(){ vec2 p = vUv*2.0-1.0; float d = length(vec2(p.x*0.85+0.15, p.y*1.25));
      float k = (1.0-smoothstep(0.0,1.0,d))*0.55*uAlpha; gl_FragColor = vec4(uColor*k, k); }`);
  poolMat.uniforms.uColor.value.set('#a8ecff');
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(24, 11), poolMat); pool.position.set(13, 0, 0.06); car.add(pool);
  const tailPoolMat = poolMat.clone(); tailPoolMat.uniforms = THREE.UniformsUtils.clone(poolMat.uniforms); tailPoolMat.uniforms.uColor.value.set('#ff1e3c');
  const tailPool = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), tailPoolMat); tailPool.position.set(-6, 0, 0.05); tailPool.rotation.z = Math.PI; car.add(tailPool);
  // Wet-road reflection streaks under the tail lights (pointing back, toward the follow camera).
  const streakMat = additive(`
    uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
    void main(){ float along = vUv.x; float across = abs(vUv.y-0.5)*2.0;
      float k = pow(along,2.2)*(1.0-across*across)*0.75*uAlpha; gl_FragColor = vec4(uColor*k,k);} `);
  streakMat.uniforms.uColor.value.set('#ff2a48');
  for (const side of [1, -1]) { const st = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.5), streakMat); st.position.set(-5.8, side * 0.74, 0.04); car.add(st); }
  // Neon underglow.
  const ugMat = additive(`
    uniform float uAlpha; varying vec2 vUv;
    void main(){ vec2 p = vUv*2.0-1.0; float d = length(vec2(p.x*0.8, p.y*1.2)); vec3 c = mix(vec3(1.0,0.17,0.84), vec3(0.2,0.95,1.0), vUv.x);
      float k = (1.0-smoothstep(0.2,1.0,d))*0.9*uAlpha; gl_FragColor = vec4(c*k,k);} `);
  const ug = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 3.8), ugMat); ug.position.set(0, 0, 0.05); car.add(ug);
  car.userData = { wheels, beamMat, poolMat, tailPoolMat, streakMat, ugMat };
  return car;
}

// --- shared materials ---------------------------------------------------------------------------
function pillarMaterial() {
  return additive(`
    uniform vec3 uColor; uniform float uTime; uniform float uAlpha; varying vec2 vUv;
    void main(){ float h = vUv.y; float scan = 0.55+0.45*sin(h*40.0 - uTime*6.0);
      float k = pow(1.0-h,1.7)*(0.55+0.45*scan)*0.85*uAlpha; gl_FragColor = vec4(uColor*k,k);} `);
}
function ringMaterial() {
  return additive(`
    uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
    void main(){ float k = 0.9*uAlpha; gl_FragColor = vec4(uColor*k,k);} `);
}
function puddleMaterial() {
  return additive(`
    uniform vec3 uColor; uniform float uTime; uniform float uAlpha; uniform vec2 uCenter; varying vec3 vPos;
    void main(){ float d = length(vPos.xy-uCenter);
      float rip = 0.5+0.5*sin(d*0.22 - uTime*3.2); float n = 0.5+0.5*sin(vPos.x*0.37+uTime*1.3)*sin(vPos.y*0.41-uTime*1.1);
      float k = (0.20 + 0.22*pow(rip,6.0) + 0.08*n)*uAlpha; gl_FragColor = vec4(uColor*k,k);} `, { uCenter: { value: new THREE.Vector2() } });
}

// --- layer ------------------------------------------------------------------------------------
export function createNeonLayer(map, origin) {
  const o = maplibregl.MercatorCoordinate.fromLngLat(origin, 0);
  const sMerc = o.meterInMercatorCoordinateUnits();
  const ll2local = ll => { const m = maplibregl.MercatorCoordinate.fromLngLat(ll, 0); return [(m.x - o.x) / sMerc, -(m.y - o.y) / sMerc]; };

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  scene.add(new THREE.HemisphereLight('#9d8bff', '#0a0820', 2.2));
  const key = new THREE.DirectionalLight('#c0f6ff', 1.2); key.position.set(-0.4, -0.6, 1); scene.add(key);
  const carLight = new THREE.PointLight('#ff3fd8', 30, 0, 1.6); scene.add(carLight);

  const car = buildCar(); scene.add(car);

  // Tail-light trails: two ribbons rebuilt from the path every frame.
  const TRAIL_N = 120;
  const trailMat = additive(`
    uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
    void main(){ float across = abs(vUv.y-0.5)*2.0; float k = pow(vUv.x,1.5)*(1.0-across*across)*uAlpha; gl_FragColor = vec4(uColor*k,k);} `);
  trailMat.uniforms.uColor.value.set('#ff2244');
  const trails = [1, -1].map(side => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
    const uv = new Float32Array(TRAIL_N * 2 * 2); for (let i = 0; i < TRAIL_N; i++) { uv.set([i / (TRAIL_N - 1), 0, i / (TRAIL_N - 1), 1], i * 4); }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx = []; for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const m = new THREE.Mesh(g, trailMat); m.frustumCulled = false; scene.add(m);
    return { side, mesh: m, g };
  });

  // Route-ahead ribbon with chevrons running toward the destination (cheap per-frame update).
  const AHEAD_N = 180;
  const aheadGeo = new THREE.BufferGeometry();
  aheadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(AHEAD_N * 2 * 3), 3));
  aheadGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(AHEAD_N * 2 * 2), 2));
  { const idx = []; for (let i = 0; i < AHEAD_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } aheadGeo.setIndex(idx); }
  const aheadMat = additive(`
    uniform float uTime; uniform float uAlpha; uniform float uSpacing; varying vec2 vUv;
    void main(){ float along = vUv.x; float x = abs(vUv.y - 0.5) * 2.0;
      float f = fract(along / uSpacing - uTime * 1.6);
      float c = f - x * 0.32;
      float chev = smoothstep(0.0, 0.06, c) * (1.0 - smoothstep(0.16, 0.24, c));
      float edge = smoothstep(0.75, 0.95, x) * (1.0 - smoothstep(0.95, 1.0, x));
      float k = (0.10 + 0.85 * chev + 0.5 * edge) * uAlpha;
      vec3 col = mix(vec3(0.0, 0.94, 1.0), vec3(0.85, 1.0, 1.0), chev);
      gl_FragColor = vec4(col * k, k); }`, { uSpacing: { value: 30 } });
  const ahead = new THREE.Mesh(aheadGeo, aheadMat); ahead.frustumCulled = false; scene.add(ahead);

  // Splash / spray particles (deterministic in t).
  const SPLASH_N = 60;
  const splashGeo = new THREE.RingGeometry(0.75, 1.0, 24);
  const splashMat = additive(`uniform vec3 uColor; uniform float uAlpha; void main(){ float k=uAlpha; gl_FragColor=vec4(uColor*k,k);} `);
  splashMat.uniforms.uColor.value.set('#9fe9ff');
  const splashes = new THREE.InstancedMesh(splashGeo, splashMat, SPLASH_N); splashes.frustumCulled = false; scene.add(splashes);
  splashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const splashColor = new Float32Array(SPLASH_N * 3); splashes.instanceColor = new THREE.InstancedBufferAttribute(splashColor, 3);
  // three.js declares instanceMatrix / instanceColor for ShaderMaterial when instancing is used.
  splashMat.vertexShader = `varying float vK; void main(){ vK = instanceColor.x; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }`;
  splashMat.fragmentShader = `uniform vec3 uColor; varying float vK; void main(){ float k = vK; gl_FragColor = vec4(uColor*k,k);} `;
  const SPRAY_N = 90;
  const sprayGeo = new THREE.SphereGeometry(1, 6, 4);
  const sprayMat = new THREE.MeshBasicMaterial({ color: '#bfefff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const spray = new THREE.InstancedMesh(sprayGeo, sprayMat, SPRAY_N); spray.frustumCulled = false; car.add(spray);

  // Hazard beacons.
  const hazardGroup = new THREE.Group(); scene.add(hazardGroup);
  let beacons = [];
  function setHazards(list) {
    for (const b of beacons) { hazardGroup.remove(b.group); b.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    beacons = list.map(h => {
      const group = new THREE.Group();
      const color = new THREE.Color(KIND_COLORS[h.kind] || '#ffffff');
      const c = ll2local(h.centroid);
      let radius = 0;
      const shapes = h.feature.geometry.type === 'Polygon' ? [h.feature.geometry.coordinates] : h.feature.geometry.coordinates;
      const pm = puddleMaterial(); pm.uniforms.uColor.value.copy(color); pm.uniforms.uCenter.value.set(c[0], c[1]);
      for (const poly of shapes) {
        const pts = poly[0].map(ll => { const p = ll2local(ll); radius = Math.max(radius, Math.hypot(p[0] - c[0], p[1] - c[1])); return new THREE.Vector2(p[0], p[1]); });
        const shape = new THREE.Shape(pts);
        for (const hole of poly.slice(1)) shape.holes.push(new THREE.Path(hole.map(ll => { const p = ll2local(ll); return new THREE.Vector2(p[0], p[1]); })));
        const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), pm); m.position.z = 0.4; group.add(m);
      }
      const pillMat = pillarMaterial(); pillMat.uniforms.uColor.value.copy(color);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 28, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5), pillMat);
      pillar.position.set(c[0], c[1], 0); group.add(pillar);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5), pillMat);
      core.position.set(c[0], c[1], 0); group.add(core);
      const rings = [0, 1, 2].map(() => { const rm = ringMaterial(); rm.uniforms.uColor.value.copy(color); const r = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 72), rm); r.position.set(c[0], c[1], 0.6); group.add(r); return r; });
      hazardGroup.add(group);
      return { h, group, pillar, core, rings, pm, pillMat, radius: Math.max(20, radius), phase: (h.name.length * 0.37) % 1 };
    });
  }

  let state = null;
  const layer = {
    id: 'neon-3d', type: 'custom', renderingMode: '3d',
    onAdd(m, gl) {
      this.renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
    },
    render(gl, args) {
      if (!state) return;
      const mm = args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : args.modelViewProjectionMatrix;
      const M = new THREE.Matrix4().fromArray(mm);
      const L = new THREE.Matrix4().makeTranslation(o.x, o.y, 0).scale(new THREE.Vector3(sMerc, -sMerc, sMerc));
      camera.projectionMatrix = M.multiply(L);
      this.renderer.resetState();
      this.renderer.render(scene, camera);
    },
  };

  // Path helpers supplied by the app: pathPoint(s) -> {ll:[lon,lat]}.
  function update(st) {
    state = st;
    const { t, mpp, carLL, heading, carScale, speedFactor, visibleCar, path, s, trailLen, inHazard, activeHazards, hazardBoost, flash } = st;
    const cl = ll2local(carLL);
    const phi = (90 - heading) * Math.PI / 180;
    car.visible = visibleCar !== false;
    car.position.set(cl[0], cl[1], 0);
    car.rotation.set(0, 0, phi);
    car.scale.setScalar(carScale);
    for (const w of car.userData.wheels) w.rotation.y = (s / 0.36) % (Math.PI * 2);
    const ud = car.userData;
    const ffDim = 1 - 0.75 * clamp((mpp - 1.4) / 5, 0, 1);   // hyperlapse: the car is scaled up, keep its light pools modest
    const fx = (st.carFx ?? 1) * ffDim;
    ud.beamMat.uniforms.uAlpha.value = fx; ud.poolMat.uniforms.uAlpha.value = fx; ud.tailPoolMat.uniforms.uAlpha.value = fx; ud.streakMat.uniforms.uAlpha.value = fx;
    ud.ugMat.uniforms.uAlpha.value = (0.75 + 0.25 * Math.sin(t * 5.0)) * (0.4 + 0.6 * fx);
    carLight.position.set(cl[0], cl[1], 6 * carScale); carLight.distance = 0; carLight.intensity = 25 * carScale * carScale;
    key.intensity = 1.2 + (flash || 0) * 4;

    // Trails: sample the path behind the car.
    const L = trailLen;
    for (const tr of trails) {
      const pos = tr.g.attributes.position.array;
      for (let i = 0; i < TRAIL_N; i++) {
        const f = i / (TRAIL_N - 1);                     // 0 = tail end, 1 = at car
        const si = Math.max(0, s - L * (1 - f) - 2.3 * carScale);
        const p = path.pointAt(si); const q = path.pointAt(Math.min(path.len, si + 3));
        const a = ll2local(p), b = ll2local(q);
        let dx = b[0] - a[0], dy = b[1] - a[1]; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        const nx = -dy, ny = dx;                           // left normal
        const off = tr.side * 0.78 * carScale, w = 0.11 * carScale * (0.25 + 0.75 * f);
        const z = 0.8 * carScale;
        pos.set([a[0] + nx * (off + w), a[1] + ny * (off + w), z, a[0] + nx * (off - w), a[1] + ny * (off - w), z], i * 6);
      }
      tr.g.attributes.position.needsUpdate = true;
    }
    trailMat.uniforms.uAlpha.value = Math.min(1, 0.35 + speedFactor * 0.65) * (0.3 + 0.7 * fx);

    // Route-ahead chevrons.
    {
      const P = st.aheadPath || path;
      const end = Math.min(st.aheadPath ? st.aheadPath.len : (st.aheadEnd ?? path.len), P.len);
      const k = Math.max(1, mpp / 0.7);
      const s0 = Math.min(end, s + 2.6 * carScale), s1 = Math.min(end, s + 520 * k);
      const w = 5.5 * mpp, pos = aheadGeo.attributes.position.array, uv = aheadGeo.attributes.uv.array;
      for (let i = 0; i < AHEAD_N; i++) {
        const si = s0 + (s1 - s0) * i / (AHEAD_N - 1);
        const a = ll2local(P.pointAt(si)), b = ll2local(P.pointAt(Math.min(P.len, si + 4 * k)));
        let dx = b[0] - a[0], dy = b[1] - a[1]; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        const nx = -dy, ny = dx;
        pos.set([a[0] + nx * w, a[1] + ny * w, 0.5, a[0] - nx * w, a[1] - ny * w, 0.5], i * 6);
        uv.set([si - s, 0, si - s, 1], i * 4);
      }
      aheadGeo.attributes.position.needsUpdate = true; aheadGeo.attributes.uv.needsUpdate = true;
      aheadMat.uniforms.uTime.value = t; aheadMat.uniforms.uSpacing.value = 26 * k;
      aheadMat.uniforms.uAlpha.value = (st.carFx ?? 1) * (s1 - s0 > 5 ? 0.9 : 0);
      // fade the far end: done in shader via along? keep simple — alpha ramps down with a second pass below
    }

    // Rain splashes around the car (screen-sized radius) — rings that pop and fade.
    const dummy = new THREE.Object3D();
    const R = 120 * mpp;
    for (let i = 0; i < SPLASH_N; i++) {
      const life = 0.55, ph = ((t / life) + hash(i * 3.1)) ;
      const cycle = Math.floor(ph), age = ph - cycle;
      const rx = (hash(i * 7.7 + cycle * 1.37) * 2 - 1) * R, ry = (hash(i * 5.3 + cycle * 2.11) * 2 - 1) * R * 1.4;
      const ang = phi; const x = cl[0] + Math.cos(ang) * (ry + R * 0.5) - Math.sin(ang) * rx, y = cl[1] + Math.sin(ang) * (ry + R * 0.5) + Math.cos(ang) * rx;
      dummy.position.set(x, y, 0.3); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar((0.4 + age * 2.4) * mpp * 2.2);
      dummy.updateMatrix(); splashes.setMatrixAt(i, dummy.matrix);
      const k = (1 - age) * 0.5 * st.rainLevel; splashColor[i * 3] = k;
    }
    splashes.instanceMatrix.needsUpdate = true; splashes.instanceColor.needsUpdate = true;

    // Wheel spray: always a little in the rain, a lot inside a flood polygon.
    const sprayAmt = Math.min(1, 0.25 * st.rainLevel + (inHazard ? 1 : 0));
    for (let i = 0; i < SPRAY_N; i++) {
      const age = ((t * 2.2 + hash(i * 1.91)) % 1);
      const side = i % 2 ? 1 : -1, back = i % 4 < 2 ? -1.42 : 1.42;
      const spread = (hash(i * 4.4) - 0.5);
      const x = back - age * (2.6 + 2.0 * hash(i * 2.2)), y = side * (1.05 + age * (0.9 + spread)), z = 0.15 + Math.sin(age * Math.PI) * (0.6 + 0.9 * hash(i * 8.1)) * (inHazard ? 1.6 : 0.6);
      dummy.position.set(x, y, z); dummy.scale.setScalar(i < SPRAY_N * sprayAmt ? 0.07 * (1 - age) + 0.02 : 0.0001); dummy.updateMatrix(); spray.setMatrixAt(i, dummy.matrix);
    }
    spray.instanceMatrix.needsUpdate = true;
    sprayMat.opacity = inHazard ? 0.8 : 0.45;

    // Beacons.
    for (const b of beacons) {
      const act = activeHazards && activeHazards.get(b.h.id);
      const emph = act ? act : 0;
      const vis = b.h._visible !== false;
      b.group.visible = vis;
      if (!vis) continue;
      const pulse = 0.65 + 0.35 * Math.sin(t * (3 + emph * 4) + b.phase * 6.28);
      const pr = Math.max(4.5 * mpp, Math.min(b.radius * 0.12, 18 * mpp));
      const ph = (80 + 70 * emph) * mpp * (st.pillarScale || 1);
      const prw = (st.pillarScale || 1) < 1 ? 0.6 : 1;
      b.pillar.scale.set(pr * 2.2 * prw, pr * 2.2 * prw, ph); b.core.scale.set(pr * 0.7 * prw, pr * 0.7 * prw, ph * 1.25);
      b.pillMat.uniforms.uTime.value = t; b.pillMat.uniforms.uAlpha.value = (0.45 + 0.55 * emph) * pulse * (hazardBoost || 1);
      b.pm.uniforms.uTime.value = t; b.pm.uniforms.uAlpha.value = (0.55 + 0.6 * emph) * (hazardBoost || 1);
      b.rings.forEach((r, k) => {
        const p = ((t * (0.55 + emph * 0.5)) + k / 3 + b.phase) % 1;
        const RR = clamp(Math.max(b.radius * 1.15, 34 * mpp), 0, Math.max(150 * mpp, 60)) * (0.2 + p * (0.9 + emph * 0.5));
        r.scale.set(RR, RR, 1); r.material.uniforms.uAlpha.value = (1 - p) * (1 - p) * (0.5 + 0.6 * emph) * (hazardBoost || 1);
      });
    }
  }
  return { layer, update, setHazards, ll2local };
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
