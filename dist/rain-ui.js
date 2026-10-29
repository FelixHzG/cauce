'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const say = message => { $('rain-status').textContent = message; };
  let map, terrain, worker, running = false, lastResult = null;
  const sourceId = 'rain-simulation', layerId = 'rain-depth';
  const canvas = document.createElement('canvas'); canvas.id = 'rain-depth-canvas'; canvas.style.display = 'none'; document.body.append(canvas);
  const context = canvas.getContext('2d',{willReadFrequently:false});
  const units = {intensity:' mm/h',duration:' min',infiltration:' mm/h'};
  for(const [name,suffix] of Object.entries(units)) $('rain-'+name).addEventListener('input',event=>{
    $('rain-'+name+'-value').textContent = event.target.value+suffix;
    if(name==='intensity')document.querySelectorAll('[data-rain]').forEach(button=>button.classList.toggle('active',button.dataset.rain===event.target.value));
  });
  document.querySelectorAll('[data-rain]').forEach(button=>button.addEventListener('click',()=>{
    $('rain-intensity').value=button.dataset.rain;$('rain-intensity').dispatchEvent(new Event('input'));
  }));
  function setRunning(value){running=value;$('rain-run').textContent=value?'■ Detener simulación':'☂ Simular esta lluvia';$('rain-run').disabled=!terrain;$('rain-reset').disabled=!lastResult&&!value;for(const name of Object.keys(units))$('rain-'+name).disabled=value;document.querySelectorAll('[data-rain]').forEach(b=>b.disabled=value);}
  function endWorker(){if(worker){worker.terminate();worker=null;}map?.getSource(sourceId)?.pause();setRunning(false);}
  function draw(result){
    if(!map || !terrain || !result.depth || !Number.isFinite(result.width) || !Number.isFinite(result.height))return;
    if(canvas.width!==result.width || canvas.height!==result.height){canvas.width=result.width;canvas.height=result.height;}
    const image=context.createImageData(result.width,result.height), pixels=image.data;
    // Fixed 0–50 cm scale: repeated scenarios remain visually comparable.
    const stops=[[0,29,120,142],[.25,66,213,230],[.65,89,132,226],[1,218,123,221]];
    for(let index=0;index<result.depth.length;index++){
      const depth=result.depth[index];if(!Number.isFinite(depth)||depth<=.0005)continue;
      const value=Math.min(1,depth/.5);let a=stops[0],b=stops[1];for(let k=1;k<stops.length;k++){b=stops[k];if(value<=b[0]){a=stops[k-1];break;}}
      const mix=Math.max(0,Math.min(1,(value-a[0])/(b[0]-a[0]))),offset=index*4;
      for(let channel=0;channel<3;channel++)pixels[offset+channel]=Math.round(a[channel+1]+mix*(b[channel+1]-a[channel+1]));
      pixels[offset+3]=Math.round(Math.min(210,65+Math.sqrt(value)*145));
    }
    context.putImageData(image,0,0);
    if(!map.getSource(sourceId)){
      const [west,south,east,north]=terrain.bbox;
      map.addSource(sourceId,{type:'canvas',canvas,animate:true,coordinates:[[west,north],[east,north],[east,south],[west,south]],attribution:'Modelo exploratorio Cauce · DEM AWS Terrain Tiles'});
      map.addLayer({id:layerId,type:'raster',source:sourceId,layout:{visibility:$('rain-layer-toggle').checked?'visible':'none'},paint:{'raster-opacity':.8,'raster-fade-duration':0,'raster-resampling':'nearest'}});
    }else map.getSource(sourceId).play();
    map.triggerRepaint();
    $('rain-progress-bar').style.width=(Math.max(0,Math.min(1,result.fraction||0))*100)+'%';
    const stats=result.stats||{}, volume=value=>Number.isFinite(value)?(Math.abs(value)<.5?0:Math.round(value)).toLocaleString('es-MX')+' m³':'—';
    $('rain-total').textContent=volume(stats.rainVolumeM3);$('rain-absorbed').textContent=volume(stats.infiltrationVolumeM3);$('rain-outflow').textContent=volume(stats.outflowVolumeM3);$('rain-stored').textContent=volume(stats.storedVolumeM3);$('rain-error').textContent=volume(stats.massBalanceErrorM3);$('rain-max-depth').textContent=Number.isFinite(stats.maxDepthM)?(stats.maxDepthM*100).toLocaleString('es-MX',{maximumFractionDigits:1})+' cm':'—';
    lastResult=result;
    drawFlow(result);
  }
  function drawFlow(result){
    if(!result.flowX||!result.flowY)return;
    const [west,south,east,north]=terrain.bbox, sx=(east-west)/terrain.width, sy=(north-south)/terrain.height;
    const candidates=[];
    for(let row=2;row<terrain.height-2;row+=4)for(let col=2;col<terrain.width-2;col+=4){const index=row*terrain.width+col,x=result.flowX[index],y=result.flowY[index],m=Math.hypot(x,y);if(Number.isFinite(m)&&m>.00001)candidates.push({row,col,x,y,m});}
    candidates.sort((a,b)=>b.m-a.m);
    const features=candidates.slice(0,350).map(v=>{const x=west+(v.col+.5)*sx,y=north-(v.row+.5)*sy,ux=v.x/v.m,uy=-v.y/v.m,dx=ux*sx*1.2,dy=uy*sy*1.2,tip=[x+dx,y+dy],tail=[x-dx,y-dy],left=[x+dx*.4-uy*sx*.35,y+dy*.4+ux*sy*.35],right=[x+dx*.4+uy*sx*.35,y+dy*.4-ux*sy*.35];return{type:'Feature',properties:{simulated:true,fluxM3S:v.m},geometry:{type:'MultiLineString',coordinates:[[tail,tip],[left,tip,right]]}};});
    const data={type:'FeatureCollection',features};
    if(map.getSource('rain-flow'))map.getSource('rain-flow').setData(data);else{map.addSource('rain-flow',{type:'geojson',data});map.addLayer({id:'rain-flow',type:'line',source:'rain-flow',layout:{visibility:$('rain-layer-toggle').checked?'visible':'none'},paint:{'line-color':'#abfff3','line-width':1.2,'line-opacity':.8}});}
  }
  $('rain-run').addEventListener('click',()=>{
    if(running){endWorker();say('Simulación detenida. El mapa conserva el último estado calculado.');return;}
    if(!terrain||!map)return;
    try{
      lastResult=null;setRunning(true);$('rain-progress-bar').style.width='0%';say('Calculando escurrimiento en la malla regional…');
      worker=new Worker(new URL('./rain-worker.js',location.href),{type:'module'});
      worker.addEventListener('message',event=>{
        const result=event.data;
        if(result.type==='error'){endWorker();say('No se pudo calcular: '+result.message);return;}
        if(!['progress','complete'].includes(result.type))return;
        draw(result);
        const minute=Number.isFinite(result.timeMinutes)?result.timeMinutes.toFixed(1):'?';
        if(result.type==='complete'){
          $('rain-progress-bar').style.width='100%';say('Listo · '+minute+' min de lluvia simulados. Cambia un escenario y compáralo.');
          // Let the renderer upload the final canvas before pausing continuous repaint.
          const finalWorker=worker;worker=null;finalWorker?.terminate();setRunning(false);setTimeout(()=>{if(!running)map.getSource(sourceId)?.pause();},350);
        }else say(minute+' min simulados · '+Math.round((result.fraction||0)*100)+'%');
      });
      worker.addEventListener('error',event=>{endWorker();say('No se pudo iniciar el cálculo. '+(event.message||'Intenta recargar la página.'));});
      worker.postMessage({type:'run',terrain,parameters:{rainfallMmH:Number($('rain-intensity').value),durationMinutes:Number($('rain-duration').value),infiltrationMmH:Number($('rain-infiltration').value)}});
      const [west,south,east,north]=terrain.bbox;
      map.fitBounds([[west,south],[east,north]],{padding:{left:innerWidth>600?335:25,right:45,top:100,bottom:innerWidth>600?90:Math.min(innerHeight*.45,350)},pitch:40,bearing:0,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:1200});
    }catch(error){endWorker();say('No se pudo iniciar: '+error.message);}
  });
  $('rain-reset').addEventListener('click',()=>{
    endWorker();lastResult=null;context.clearRect(0,0,canvas.width,canvas.height);if(map.getLayer('rain-flow'))map.removeLayer('rain-flow');if(map.getSource('rain-flow'))map.removeSource('rain-flow');if(map.getLayer(layerId))map.removeLayer(layerId);if(map.getSource(sourceId))map.removeSource(sourceId);$('rain-progress-bar').style.width='0%';for(const id of ['rain-total','rain-absorbed','rain-outflow','rain-stored','rain-error','rain-max-depth'])$(id).textContent='—';$('rain-reset').disabled=true;say('Todo limpio. Elige una lluvia y vuelve a explorar.');
  });
  $('rain-layer-toggle').addEventListener('change',event=>{for(const layer of [layerId,'rain-flow'])if(map?.getLayer(layer))map.setLayoutProperty(layer,'visibility',event.target.checked?'visible':'none');});
  async function prepare(){
    try{
      const response=await fetch('./data/simulation-terrain.json');if(!response.ok)throw Error('el terreno regional aún no está disponible');const data=await response.json();
      if(!Array.isArray(data.bbox)||data.bbox.length!==4||!Number.isInteger(data.width)||!Number.isInteger(data.height)||data.width*data.height>50000||!data.elevation||data.elevation.length!==data.width*data.height)throw Error('la malla de terreno no tiene el formato esperado');
      terrain=data;
      const dx=Number(data.cellSizeX),dy=Number(data.cellSizeY);
      $('rain-grid-label').textContent=data.width+' × '+data.height+' celdas'+(dx>0&&dy>0?' · ≈ '+Math.round(dx)+' × '+Math.round(dy)+' m':' · malla regional gruesa');
      const [west,south,east,north]=data.bbox;
      map.addSource('rain-domain',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]}}});
      map.addLayer({id:'rain-domain',type:'line',source:'rain-domain',paint:{'line-color':'#83d9e5','line-width':1,'line-opacity':.5,'line-dasharray':[5,4]}});
      setRunning(false);say('Terreno listo. Escoge tu escenario: el cálculo ocurre en tu navegador.');
    }catch(error){$('rain-run').disabled=true;$('rain-run').textContent='Terreno no disponible';$('rain-grid-label').textContent='Modelo pendiente de carga';say('No se pudo preparar: '+error.message+'. Recarga cuando esté disponible.');}
  }
  function connect(){map=window.cauceMap;if(!map){setTimeout(connect,150);return;}if(map.loaded())prepare();else map.once('load',prepare);}
  connect();
  window.addEventListener('pagehide',()=>worker?.terminate());
})();
