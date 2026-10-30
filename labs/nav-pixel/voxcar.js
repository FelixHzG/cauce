// nav-pixel · voxel "vocho" built from boxes, drawn as a MapLibre custom 3D layer (no three.js).
// getState() -> { visible, lngLat:[lon,lat], heading (deg, clockwise from north), unitMeters, bob }
import { PAL } from './sprites.js';

const C = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
// [x0,x1, y0,y1, z0,z1, colour]  x = right, y = forward, z = up, 1 unit = 1 voxel
const BOXES = [
  [-3.9, 3.9, -6.4, 6.4, 0.02, 0.08, PAL.wine],              // drop shadow
  [-3.6, -2.4, 2.2, 4.6, 0, 2.2, PAL.ink], [2.4, 3.6, 2.2, 4.6, 0, 2.2, PAL.ink],
  [-3.6, -2.4, -4.6, -2.2, 0, 2.2, PAL.ink], [2.4, 3.6, -4.6, -2.2, 0, 2.2, PAL.ink],
  [-3.75, -3.6, 3.0, 3.8, 0.7, 1.5, PAL.mist], [3.6, 3.75, 3.0, 3.8, 0.7, 1.5, PAL.mist],
  [-3.75, -3.6, -3.8, -3.0, 0.7, 1.5, PAL.mist], [3.6, 3.75, -3.8, -3.0, 0.7, 1.5, PAL.mist],
  [-3.2, 3.2, -5.6, 5.6, 0.9, 3.0, PAL.red],                 // lower body
  [-3.5, -2.3, 1.9, 4.9, 1.9, 3.1, PAL.red], [2.3, 3.5, 1.9, 4.9, 1.9, 3.1, PAL.red],   // front fenders
  [-3.5, -2.3, -4.9, -1.9, 1.9, 3.1, PAL.red], [2.3, 3.5, -4.9, -1.9, 1.9, 3.1, PAL.red], // rear fenders
  [-2.8, 2.8, 1.8, 5.3, 3.0, 3.6, PAL.red],                  // hood
  [-2.8, 2.8, -5.3, -2.4, 3.0, 3.9, PAL.red],                // engine lid
  [-2.6, 2.6, -2.8, 1.8, 3.0, 5.3, PAL.red],                 // cabin
  [-2.75, 2.75, -2.3, 1.2, 3.7, 4.9, PAL.cyan],              // side windows
  [-2.2, 2.2, 1.8, 1.95, 3.7, 5.0, PAL.cyan],                // windshield
  [-1.9, 1.9, -2.95, -2.8, 3.9, 4.9, PAL.navy],              // rear window
  [-2.3, 2.3, -2.4, 1.4, 5.3, 5.6, PAL.white],               // roof
  [-0.9, 0.9, -0.8, 0.4, 5.6, 6.4, PAL.gold],                // roof beacon
  [-2.6, -1.5, 5.6, 5.85, 1.9, 2.7, PAL.yellow], [1.5, 2.6, 5.6, 5.85, 1.9, 2.7, PAL.yellow],   // headlights
  [-2.6, -1.6, -5.85, -5.6, 2.0, 2.6, PAL.blood], [1.6, 2.6, -5.85, -5.6, 2.0, 2.6, PAL.blood], // tail lights
  [-3.3, 3.3, 5.6, 6.0, 0.9, 1.5, PAL.mist], [-3.3, 3.3, -6.0, -5.6, 0.9, 1.5, PAL.mist],       // bumpers
];

function mesh() {
  const v = [];
  const face = (p, n, c) => { for (const i of [0, 1, 2, 0, 2, 3]) v.push(...p[i], ...c, ...n); };
  for (const [x0, x1, y0, y1, z0, z1, col] of BOXES) {
    const c = C(col);
    face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], c);
    face([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], c);
    face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], c);
    face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0], c);
    face([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0], c);
  }
  return new Float32Array(v);
}

const VS = `attribute vec3 a_pos; attribute vec3 a_col; attribute vec3 a_nrm;
uniform mat4 u_m; uniform float u_h; uniform vec3 u_light;
varying vec3 v_col;
void main(){
  float c = cos(u_h), s = sin(u_h);
  vec3 n = vec3(c*a_nrm.x + s*a_nrm.y, -s*a_nrm.x + c*a_nrm.y, a_nrm.z);
  float d = max(dot(n, u_light), 0.0);
  v_col = a_col * (0.52 + 0.55*d);
  gl_Position = u_m * vec4(a_pos, 1.0);
}`;
const FS = `precision mediump float; varying vec3 v_col; void main(){ gl_FragColor = vec4(v_col, 1.0); }`;

function mul(a, b) { // column-major 4x4
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}

export function voxelCarLayer(getState) {
  let prog, buf, n, loc = {};
  return {
    id: 'voxcar', type: 'custom', renderingMode: '3d',
    onAdd(map, gl) {
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      const data = mesh(); n = data.length / 9;
      buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      for (const k of ['a_pos', 'a_col', 'a_nrm']) loc[k] = gl.getAttribLocation(prog, k);
      for (const k of ['u_m', 'u_h', 'u_light']) loc[k] = gl.getUniformLocation(prog, k);
    },
    render(gl, args) {
      const s = getState(); if (!s || !s.visible) return;
      const mc = maplibregl.MercatorCoordinate.fromLngLat(s.lngLat, 0);
      const u = mc.meterInMercatorCoordinateUnits() * s.unitMeters;
      const h = s.heading * Math.PI / 180, ch = Math.cos(h), sh = Math.sin(h);
      const model = [u * ch, u * sh, 0, 0, u * sh, -u * ch, 0, 0, 0, 0, u, 0, mc.x, mc.y, (s.bob || 0) * u, 1];
      const m = mul(args.defaultProjectionData.mainMatrix, model);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(loc.u_m, false, new Float32Array(m));
      gl.uniform1f(loc.u_h, h);
      const L = [-0.45, 0.35, 0.82], ll = Math.hypot(...L); gl.uniform3f(loc.u_light, L[0] / ll, L[1] / ll, L[2] / ll);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc.a_pos); gl.vertexAttribPointer(loc.a_pos, 3, gl.FLOAT, false, 36, 0);
      gl.enableVertexAttribArray(loc.a_col); gl.vertexAttribPointer(loc.a_col, 3, gl.FLOAT, false, 36, 12);
      gl.enableVertexAttribArray(loc.a_nrm); gl.vertexAttribPointer(loc.a_nrm, 3, gl.FLOAT, false, 36, 24);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.drawArrays(gl.TRIANGLES, 0, n);
      gl.disableVertexAttribArray(loc.a_col); gl.disableVertexAttribArray(loc.a_nrm);
    }
  };
}
