/** Conservative, coarse surface-storage experiment; not a calibrated flood forecast. */
export function createSimulation(terrain, parameters = {}) {
  const {width, height, elevation} = terrain;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width * height > 50000 || !elevation || elevation.length !== width * height) throw new Error('Invalid terrain grid (maximum 50,000 cells).');
  const dx = Number(terrain.cellSizeX), dy = Number(terrain.cellSizeY);
  if (!(dx > 0) || !(dy > 0)) throw new Error('Terrain cell sizes must be positive metres.');
  const number = (name, fallback, max) => {
    const value = parameters[name] ?? fallback;
    if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`Invalid ${name}.`);
    return value;
  };
  const rainfall = number('rainfallMmH', 30, 1000) / 3600000;
  const infiltration = number('infiltrationMmH', 3, 1000) / 3600000;
  const drainage = number('drainageMmH', 0, 1000) / 3600000;
  const duration = number('durationMinutes', 60, 1440) * 60;
  const requestedDt = number('dtSeconds', 10, 3600);
  if (!requestedDt) throw new Error('dtSeconds must be positive.');
  const steps = Math.max(1, Math.min(1200, Math.ceil(duration / requestedDt)));
  const dt = duration / steps, area = dx * dy, n = width * height;
  const valid = Uint8Array.from(elevation, z => z !== null && Number.isFinite(z) ? 1 : 0);
  const bed = Float64Array.from(elevation, z => z ?? 0), depth = new Float64Array(n);
  const demand = new Float64Array(n), delta = new Float64Array(n);
  const flowX = new Float32Array(n), flowY = new Float32Array(n);
  const pairs = [];
  let activeCells = 0;
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    activeCells++;
    const x = i % width, y = Math.floor(i / width);
    if (x + 1 < width && valid[i + 1]) pairs.push([i, i + 1, dx, dy, 0]);
    if (y + 1 < height && valid[i + width]) pairs.push([i, i + width, dy, dx, 1]);
  }
  if (!activeCells) throw new Error('Terrain has no valid elevation cells.');
  const edges = [];
  if (parameters.openBoundary !== false) {
    for (let i = 0; i < n; i++) if (valid[i]) {
      const x = i % width, y = Math.floor(i / width);
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) edges.push(i);
    }
  }
  let step = 0, rainVolumeM3 = 0, infiltrationVolumeM3 = 0, drainageVolumeM3 = 0, outflowVolumeM3 = 0;
  const flux = new Float64Array(pairs.length);
  // A capped 1 m/s conveyance and donor limit keep this explicit toy model inexpensive.
  function advance() {
    if (step >= steps) return false;
    demand.fill(0); delta.fill(0); flowX.fill(0); flowY.fill(0);
    for (let i = 0; i < n; i++) if (valid[i]) {
      const rain = rainfall * dt; depth[i] += rain; rainVolumeM3 += rain * area;
      const inf = Math.min(depth[i], infiltration * dt); depth[i] -= inf; infiltrationVolumeM3 += inf * area;
      const drain = Math.min(depth[i], drainage * dt); depth[i] -= drain; drainageVolumeM3 += drain * area;
    }
    for (let p = 0; p < pairs.length; p++) {
      const [a,b,distance,face] = pairs[p], head = bed[a] + depth[a] - bed[b] - depth[b];
      const donor = head >= 0 ? a : b, receiver = head >= 0 ? b : a;
      // Hydraulic depth above the higher bed prevents flow through dry topographic barriers.
      const wet = Math.max(0, bed[donor] + depth[donor] - Math.max(bed[donor], bed[receiver]));
      const speed = Math.min(1, Math.sqrt(9.81 * wet * Math.abs(head) / distance));
      // Pairwise equalization cap avoids overshooting an equilibrium surface in one exchange.
      const volume = Math.min(wet * speed * face * dt, Math.abs(head) * area * 0.125);
      flux[p] = head >= 0 ? volume : -volume; demand[donor] += volume;
    }
    for (const i of edges) demand[i] += depth[i] * area * Math.min(0.25, dt / 600);
    for (let p = 0; p < pairs.length; p++) {
      const [a,b,,,axis] = pairs[p], donor = flux[p] >= 0 ? a : b;
      const scale = demand[donor] > 0 ? Math.min(1, depth[donor] * area / demand[donor]) : 0;
      const volume = flux[p] * scale; delta[a] -= volume; delta[b] += volume;
      if (dt) { const flow = volume / dt; const output = axis === 0 ? flowX : flowY; output[a] += flow; output[b] += flow; }
    }
    for (const i of edges) {
      const wanted = depth[i] * area * Math.min(0.25, dt / 600);
      const volume = wanted * (demand[i] > 0 ? Math.min(1, depth[i] * area / demand[i]) : 0);
      delta[i] -= volume; outflowVolumeM3 += volume;
    }
    for (let i = 0; i < n; i++) if (valid[i]) depth[i] = Math.max(0, depth[i] + delta[i] / area);
    step++; return true;
  }
  function snapshot() {
    let storedVolumeM3 = 0, maxDepthM = 0, wetCells = 0;
    for (let i = 0; i < n; i++) if (valid[i]) { storedVolumeM3 += depth[i] * area; maxDepthM = Math.max(maxDepthM, depth[i]); if (depth[i] >= 0.001) wetCells++; }
    return {fraction: step / steps, timeMinutes: step * dt / 60, width, height, depth: Float32Array.from(depth), flowX: flowX.slice(), flowY: flowY.slice(), stats: {rainVolumeM3, infiltrationVolumeM3, drainageVolumeM3, outflowVolumeM3, storedVolumeM3, massBalanceErrorM3: rainVolumeM3 - infiltrationVolumeM3 - drainageVolumeM3 - outflowVolumeM3 - storedVolumeM3, maxDepthM, wetCells, activeCells, simulatedAreaM2: activeCells * area, steps:step, totalSteps:steps, openBoundary:parameters.openBoundary !== false}};
  }
  return {advance, snapshot, steps};
}
export function runSimulation(terrain, parameters = {}, onProgress) {
  const simulation = createSimulation(terrain, parameters), every = Math.max(1, Math.ceil(simulation.steps / 40));
  let step = 0;
  while (simulation.advance()) { step++; if (onProgress && step % every === 0) onProgress(simulation.snapshot()); }
  return simulation.snapshot();
}
