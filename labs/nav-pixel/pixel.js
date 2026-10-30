// nav-pixel · post-process: a MapLibre custom layer drawn LAST. It copies the (low-resolution) frame MapLibre has
// just drawn into a texture (copyTexSubImage2D, same GL context, GPU only) and redraws it quantised to the
// ENDESGA 32 palette with 4x4 ordered (Bayer) dithering, plus a deterministic screen-space rain layer and a storm grade.
// (A first version copied the canvas into a second WebGL context: ~25 ms per 1080p frame on W10, so it was replaced.)
import { PALETTE32 } from './sprites.js';

const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
const FS = `precision highp float;
uniform sampler2D tex; uniform vec2 res; uniform float time, rain, flash, spread, vignette;
uniform vec3 pal[32];
float bayer2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y*0.75))); }
float bayer4(vec2 a){ return bayer2(0.5*a)*0.25 + bayer2(a); }
float hash(float n){ return fract(sin(n*91.345)*43758.5453); }
void main(){
  vec2 px = floor(gl_FragCoord.xy);
  vec2 uv = (px + 0.5) / res;
  vec3 c = texture2D(tex, (px+0.5)/res).rgb;
  // storm grade (rain scenario): cooler and darker, but keep route/UI colours readable
  float lum = dot(c, vec3(0.299,0.587,0.114));
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float keep = smoothstep(0.5, 0.62, sat);           // vivid UI-on-map colours (route, water, alerts) stay vivid
  c = mix(c, mix(vec3(lum), c, 0.75) * vec3(0.78,0.86,1.02), rain*0.55*(1.0-keep));
  // vignette toward the top so the HUD reads better, then a dithered horizon haze: it hides the band beyond
  // MapLibre's far tile range (plain background colour) and reads as distance fog
  c *= 1.0 - vignette*smoothstep(0.55, 1.0, uv.y);
  vec3 haze = mix(vec3(0.75,0.80,0.86), vec3(0.36,0.41,0.53), rain);
  c = mix(c, haze, smoothstep(0.90, 0.99, uv.y));
  // rain streaks: slanted 1px columns, seeded per column, deterministic from time
  if (rain > 0.01) {
    float x = px.x + px.y*0.42;
    float col = floor(x/3.0);
    float h = hash(col);
    float len = 5.0 + 6.0*h;
    float period = 70.0 + 80.0*hash(col+7.0);
    float y = mod(px.y + time*(260.0+140.0*h) + h*900.0, period);
    float on = step(y, len) * step(mod(x,3.0), 0.99) * step(h, 0.62*rain + 0.1);
    c = mix(c, vec3(0.75,0.80,0.86), on*0.85);
  }
  c += flash*0.35;
  c += (bayer4(px) - 0.5) * spread;
  vec3 best = pal[0]; float bd = 1e9;
  for (int i = 0; i < 32; i++) {
    vec3 d = c - pal[i];
    float e = dot(d*d, vec3(0.30, 0.59, 0.11));
    if (e < bd) { bd = e; best = pal[i]; }
  }
  gl_FragColor = vec4(best, 1.0);
}`;

export function pixelLayer(getParams) {
  let prog, buf, tex, loc, u = {}, tw = 0, th = 0;
  return {
    id: 'pixelfx', type: 'custom', renderingMode: '2d',
    onAdd(map, gl) {
      const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      loc = gl.getAttribLocation(prog, 'p');
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      for (const n of ['tex', 'pal', 'res', 'time', 'rain', 'flash', 'spread', 'vignette']) u[n] = gl.getUniformLocation(prog, n);
      gl.useProgram(prog);
      gl.uniform3fv(u.pal, new Float32Array(PALETTE32.flatMap(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255))));
    },
    render(gl) {
      const { time = 0, rain = 0, flash = 0, spread = 0.09, vignette = 0.12, off = false } = getParams() || {};
      if (off) return;
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      if (gl.bindVertexArray) gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      if (tw !== W || th !== H) { gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, W, H, 0); tw = W; th = H; }
      else gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H);
      gl.useProgram(prog);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.depthMask(false);
      gl.uniform1i(u.tex, 0); gl.uniform2f(u.res, W, H); gl.uniform1f(u.time, time); gl.uniform1f(u.rain, rain);
      gl.uniform1f(u.flash, flash); gl.uniform1f(u.spread, spread); gl.uniform1f(u.vignette, vignette);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(loc);
    }
  };
}
