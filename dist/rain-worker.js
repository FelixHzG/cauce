import {createSimulation} from './rain-core.js';
self.onmessage = ({data}) => {
  if (data.type !== 'run') return;
  try {
    const simulation = createSimulation(data.terrain, data.parameters), every = Math.max(1, Math.ceil(simulation.steps / 40));
    let step = 0;
    while (simulation.advance()) {
      step++;
      if (step % every === 0 && step < simulation.steps) publish('progress', simulation.snapshot());
    }
    publish('complete', simulation.snapshot());
  } catch (error) { self.postMessage({type:'error', message:error.message}); }
};
function publish(type, result) {
  self.postMessage({type,...result}, [result.depth.buffer, result.flowX.buffer, result.flowY.buffer]);
}
