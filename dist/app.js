'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const status = $('#status');
  let statusTimer;
  function announce(message, error = false, duration = 0) {
    clearTimeout(statusTimer);
    status.replaceChildren();
    if (!error) { const dot = document.createElement('span'); dot.className = 'spinner'; status.append(dot); }
    status.append(document.createTextNode(message));
    status.classList.toggle('error', error); status.classList.remove('hidden');
    if (duration) statusTimer = setTimeout(() => status.classList.add('hidden'), duration);
  }
  $('#collapse').addEventListener('click', () => {
    const collapsed = $('.panel').classList.toggle('collapsed');
    $('#collapse').textContent = collapsed ? '+' : '−';
    $('#collapse').setAttribute('aria-expanded', String(!collapsed));
    $('#collapse').setAttribute('aria-label', collapsed ? 'Expandir controles' : 'Contraer controles');
  });
  document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===button));document.querySelectorAll('[data-section]').forEach(s=>s.classList.toggle('active',s.dataset.section===button.dataset.tab));}));
  $('#sources-open').addEventListener('click', () => $('#sources-dialog').showModal());
  $('#sources-close').addEventListener('click', () => $('#sources-dialog').close());
  $('#sources-dialog').addEventListener('click', event => { if (event.target === $('#sources-dialog')) { const bounds = event.target.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.target.close(); } });
  if (!window.maplibregl || (typeof maplibregl.supported === 'function' && !maplibregl.supported())) { announce('El mapa necesita WebGL y conexión a internet. Prueba con un navegador actualizado.', true); return; }
  const dem = {type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],encoding:'terrarium',tileSize:256,maxzoom:15,attribution:'<a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles / Mapzen</a>'};
  const places = {
    metro:{center:[-103.316,20.722],zoom:11.65,bearing:-24,pitch:62,title:'La forma de lo que habitamos.',description:'Área Metropolitana de Guadalajara'},
    barranca:{center:[-103.277,20.753],zoom:12.45,bearing:38,pitch:68,title:'La ciudad encuentra su borde.',description:'Barranca de Huentitán · Río Santiago'},
    primavera:{center:[-103.583,20.656],zoom:11.6,bearing:-35,pitch:64,title:'El bosque guarda el relieve.',description:'Bosque La Primavera · Jalisco'},
    centro:{center:[-103.3474,20.6752],zoom:15.55,bearing:-28,pitch:65,title:'Una ciudad, miles de historias.',description:'Centro de Guadalajara · Edificios OpenStreetMap'},
    chapala:{center:[-103.194,20.336],zoom:10.25,bearing:7,pitch:58,title:'Un horizonte de agua.',description:'Chapala · El sur de la cuenca'}
  };
  let map;
  const regionalWaterLayers = [];
  const motionDuration = value => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : value;
  try { map = new maplibregl.Map({container:'map',...places.metro,maxPitch:75,maxZoom:17,minZoom:7,renderWorldCopies:false,attributionControl:{compact:true},style:{version:8,sources:{openfreemap:{type:'vector',url:'https://tiles.openfreemap.org/planet',attribution:'<a href="https://openfreemap.org/">OpenFreeMap</a> © OpenMapTiles © OpenStreetMap'},satellite:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'},streets:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'},terrain:dem,shade:dem},layers:[{id:'background',type:'background',paint:{'background-color':'#222a30'}},{id:'satellite',type:'raster',source:'satellite',layout:{visibility:'none'},paint:{'raster-saturation':-.17,'raster-contrast':.06}},{id:'streets',type:'raster',source:'streets',layout:{visibility:'none'},paint:{'raster-saturation':-.6}},{id:'hillshade',type:'hillshade',source:'shade',paint:{'hillshade-exaggeration':.8,'hillshade-shadow-color':'#080e14','hillshade-highlight-color':'#77848b','hillshade-accent-color':'#28343d'}}],terrain:{source:'terrain',exaggeration:1.5},sky:{'sky-color':'#0a1016','horizon-color':'#26343d','fog-color':'#17222c','fog-ground-blend':.16}}}); }
  catch (error) { console.error(error); announce('No se pudo iniciar el mapa 3D. Prueba con aceleración gráfica activada.', true); return; }
  window.cauceMap = map;
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');
  map.addControl(new maplibregl.ScaleControl({maxWidth:110,unit:'metric'}),'bottom-left');
  let loaded = false, errorCounts = {}, activeBasemap = 'relief';
  const slowTimer = setTimeout(() => { if (!loaded) announce('La cartografía está tardando en cargar. Revisa tu conexión.',true); }, 25000);
  map.on('load', () => {loaded = true;clearTimeout(slowTimer); announce('Tu ciudad está lista. Acércate y explora.',false,2300); loadVectorLayers(); loadFloodData(); loadRegionalLayers(); loadInegiCoverage(); });
  map.on('error', event => {
    const source = event.sourceId || 'map'; errorCounts[source] = (errorCounts[source] || 0) + 1;
    if (errorCounts[source] === 3) announce(source === 'terrain' || source === 'shade' ? 'Parte del relieve no está disponible. Puedes seguir explorando el mapa.' : 'Algunas teselas no cargaron. Prueba otra vista del mapa.',true,7000);
  });
  function loadVectorLayers(){
    map.addLayer({id:'vector-water',type:'fill',source:'openfreemap','source-layer':'water',paint:{'fill-color':'#174c59','fill-opacity':.8}});
    map.addLayer({id:'vector-road-glow',type:'line',source:'openfreemap','source-layer':'transportation',minzoom:10,filter:['in',['get','class'],['literal',['motorway','trunk','primary']]],paint:{'line-color':'#719d9f','line-width':['interpolate',['linear'],['zoom'],10,.7,14,3],'line-opacity':.13,'line-blur':2}});
    map.addLayer({id:'vector-roads',type:'line',source:'openfreemap','source-layer':'transportation',minzoom:10,paint:{'line-color':['match',['get','class'],'motorway','#a9b8b5','trunk','#92aaa8','primary','#819395','#414f58'],'line-width':['interpolate',['linear'],['zoom'],10,.35,13,.7,17,2.4],'line-opacity':['interpolate',['linear'],['zoom'],10,.22,13,.55,16,.8]}});
    map.addLayer({id:'vector-water-glow',type:'line',source:'openfreemap','source-layer':'waterway',paint:{'line-color':'#50e4e2','line-width':['interpolate',['linear'],['zoom'],9,3,14,9],'line-opacity':.23,'line-blur':4}});
    map.addLayer({id:'vector-waterways',type:'line',source:'openfreemap','source-layer':'waterway',paint:{'line-color':['match',['get','class'],'river','#5ff8e1','canal','#b6e995','#67dce9'],'line-width':['interpolate',['linear'],['zoom'],9,.8,14,2.4],'line-opacity':.95}});
    map.addLayer({id:'vector-buildings',type:'fill-extrusion',source:'openfreemap','source-layer':'building',minzoom:14,filter:['all',['has','render_height'],['!',['has','hide_3d']]],paint:{'fill-extrusion-color':'#60747d','fill-extrusion-height':['coalesce',['get','render_height'],0],'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':.85}});
  }
  function updateViewAction(){const tilted=map.getPitch()>35;$('#view-3d').innerHTML=tilted?'◈ Ver desde arriba <span>↗</span>':'◈ Explorar en 3D <span>↗</span>';}
  $('#view-3d').addEventListener('click',()=>{map.easeTo({pitch:map.getPitch()>35?0:62,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:900});});
  map.on('pitchend',updateViewAction);
  $('#north-view').addEventListener('click',()=>map.easeTo({bearing:0,duration:motionDuration(800)}));
  $('#buildings-toggle').addEventListener('change',e=>{if(map.getLayer('vector-buildings'))map.setLayoutProperty('vector-buildings','visibility',e.target.checked?'visible':'none');});
  $('#water-toggle').addEventListener('change',e=>{for(const layer of ['vector-water','vector-water-glow','vector-waterways',...regionalWaterLayers])if(map.getLayer(layer))map.setLayoutProperty(layer,'visibility',e.target.checked?'visible':'none');});
  document.querySelectorAll('button[data-basemap]').forEach(button => button.addEventListener('click', () => {
    if (!loaded) return;
    activeBasemap = button.dataset.basemap;
    document.body.dataset.basemap = activeBasemap;
    for (const layer of ['satellite','streets','hillshade']) map.setLayoutProperty(layer,'visibility', (activeBasemap === 'relief' ? layer === 'hillshade' : layer === activeBasemap) ? 'visible':'none');
    document.querySelectorAll('button[data-basemap]').forEach(item => item.classList.toggle('active',item === button));
  }));
  $('#exaggeration').addEventListener('input', event => { const value = Number(event.target.value); $('#exaggeration-value').textContent = value.toFixed(1)+'×'; if (loaded) map.setTerrain(value === 0 ? null : {source:'terrain',exaggeration:value}); });
  $('#pitch').addEventListener('input', event => { $('#pitch-value').textContent = event.target.value+'°'; map.setPitch(Number(event.target.value)); });
  map.on('pitch', () => {const value = Math.round(map.getPitch()); $('#pitch').value = String(value); $('#pitch-value').textContent = value+'°';});
  function goTo(place) { const preset = places[place]; map.flyTo({...preset,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:2200,essential:false}); $('#place-title').textContent = preset.title; $('#place-description').textContent = preset.description; document.querySelectorAll('[data-place]').forEach(item => item.classList.toggle('active',item.dataset.place === place)); }
  document.querySelectorAll('[data-place]').forEach(button => button.addEventListener('click', () => goTo(button.dataset.place)));
  $('#reset-view').addEventListener('click', () => goTo('metro'));
  map.on('click', event => {
    const observations = map.getLayer('flood-observations-fill') ? map.queryRenderedFeatures(event.point,{layers:['flood-observations-fill','flood-observations-point']}) : [];
    if(observations.length && $('#flood-toggle').checked) {
      const feature = observations.find(f=>f.properties.category==='Zonas Criticas') || observations[0];
      const properties = feature.properties; const wrap = document.createElement('div');
      const title=document.createElement('b'); title.textContent=properties.name || 'Registro de inundación'; wrap.append(title);
      const category=document.createElement('p');category.className='popup-note';category.textContent=properties.category==='Zonas Criticas'?'Zona crítica registrada':(properties['Categoría'] || 'Sitio inundable registrado');wrap.append(category);
      if(properties.Referencia){const p=document.createElement('p');p.className='popup-note';p.textContent=properties.Referencia;wrap.append(p);}
      const credit=document.createElement('p');credit.className='popup-note';credit.textContent='IMEPLAN · MUI 2026. Registro publicado; no es una predicción.';wrap.append(credit);
      new maplibregl.Popup({maxWidth:'280px'}).setLngLat(event.lngLat).setDOMContent(wrap).addTo(map);return;
    }
    const mappedWaterLayers=['vector-waterways',...regionalWaterLayers].filter(id=>map.getLayer(id));
    const waters=mappedWaterLayers.length?map.queryRenderedFeatures([[event.point.x-5,event.point.y-5],[event.point.x+5,event.point.y+5]],{layers:mappedWaterLayers}):[];
    if(waters.length){const properties=waters[0].properties;const kind=properties.waterway || properties.class || properties.kind;const labels={river:'Río cartografiado',stream:'Arroyo cartografiado',canal:'Canal cartografiado',drain:'Dren abierto cartografiado',ditch:'Zanja cartografiada'};const wrap=document.createElement('div');const title=document.createElement('b');title.textContent=properties.name || labels[kind] || 'Cauce cartografiado';wrap.append(title);const note=document.createElement('p');note.className='popup-note';note.textContent=(labels[kind] || 'Cauce cartografiado')+' · OpenStreetMap. No representa flujo simulado ni alcantarillado subterráneo.';wrap.append(note);new maplibregl.Popup({maxWidth:'270px'}).setLngLat(event.lngLat).setDOMContent(wrap).addTo(map);return;}
    // MapLibre returns exaggerated elevation; normalize before displaying metres.
    const sampledElevation = map.queryTerrainElevation(event.lngLat);
    const terrainScale = Number(map.getTerrain()?.exaggeration ?? 1);
    const elevation = Number.isFinite(sampledElevation) && terrainScale > 0 ? sampledElevation / terrainScale : null;
    const wrap = document.createElement('div');
    const label = document.createElement('span'); label.className = 'eyebrow'; label.textContent = 'ELEVACIÓN DEL TERRENO'; wrap.append(label);
    const number = document.createElement('div'); number.className = 'elevation-number'; number.textContent = Number.isFinite(elevation) ? Math.round(elevation).toLocaleString('es-MX') : '—'; const unit = document.createElement('small'); unit.textContent = ' m'; number.append(unit); wrap.append(number);
    const note = document.createElement('div'); note.className = 'popup-note'; note.textContent = Number.isFinite(elevation) ? 'Estimación del modelo global de elevación.\nNo es profundidad de inundación.' : 'Elevación no disponible aquí. Activa el relieve y espera a que cargue.'; wrap.append(note);
    const coord = document.createElement('div'); coord.className = 'popup-coordinate'; coord.textContent = event.lngLat.lat.toFixed(5)+'° N · '+Math.abs(event.lngLat.lng).toFixed(5)+'° O'; wrap.append(coord);
    new maplibregl.Popup({maxWidth:'260px'}).setLngLat(event.lngLat).setDOMContent(wrap).addTo(map);
  });
  async function loadFloodData() {
    try {const response = await fetch('./data/flood-observations.geojson'); if (!response.ok) throw new Error('Not available'); const data = await response.json(); if(data.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.length) throw new Error('No observations');
      map.addSource('flood-observations',{type:'geojson',data});
      map.addLayer({id:'flood-observations-fill',type:'fill',source:'flood-observations',filter:['==',['geometry-type'],'Polygon'],layout:{visibility:'visible'},paint:{'fill-color':['match',['get','category'],'Zonas Criticas','#fa7c90','#44ded9'],'fill-opacity':.27}});
      map.addLayer({id:'flood-observations-line',type:'line',source:'flood-observations',filter:['==',['geometry-type'],'Polygon'],layout:{visibility:'visible'},paint:{'line-color':['match',['get','category'],'Zonas Criticas','#ffa2be','#75fff0'],'line-width':1.2}});
      map.addLayer({id:'flood-observations-point',type:'circle',source:'flood-observations',filter:['==',['geometry-type'],'Point'],minzoom:12,layout:{visibility:'visible'},paint:{'circle-radius':4,'circle-color':'#67e7d9','circle-stroke-color':'#153e35','circle-stroke-width':2}});
      $('#flood-toggle').disabled = false; $('#flood-toggle').checked = true; $('#flood-note').textContent = '310 sitios · 188 zonas críticas · IMEPLAN 2026'; const legend=document.createElement('div'); legend.className='flood-legend'; legend.innerHTML='<span><i></i>Sitio inundable</span><span><i></i>Zona crítica</span>'; $('.layer-row').after(legend);
      $('#flood-toggle').addEventListener('change', event => {for(const suffix of ['fill','line','point']) map.setLayoutProperty('flood-observations-'+suffix,'visibility',event.target.checked?'visible':'none');});
    } catch {$('#flood-note').textContent = 'Datos en integración · próxima etapa';}
  }
  async function loadInegiCoverage() {
    try {const response=await fetch('./data/inegi-coverage.geojson');if(!response.ok)return;const data=await response.json();if(!data.features?.length)return;
      map.addSource('inegi-coverage',{type:'geojson',data});
      map.addLayer({id:'inegi-coverage-fill',type:'fill',source:'inegi-coverage',layout:{visibility:'none'},paint:{'fill-color':'#e0ec9c','fill-opacity':.06}});
      map.addLayer({id:'inegi-coverage-line',type:'line',source:'inegi-coverage',layout:{visibility:'none'},paint:{'line-color':'#e0ec9c','line-width':1.4,'line-dasharray':[4,3]}});
      $('#inegi-toggle').disabled=false;$('#inegi-note').textContent=data.features.length+' fichas · DEM aún no integrado';
      $('#inegi-toggle').addEventListener('change',e=>{for(const suffix of ['fill','line'])map.setLayoutProperty('inegi-coverage-'+suffix,'visibility',e.target.checked?'visible':'none');});
    } catch {$('#inegi-note').textContent='Catálogo en integración';}
  }
  async function loadRegionalLayers() {
    try {const response=await fetch('./data/regional-layers.json');if(!response.ok)return;const manifest=await response.json();if(!Array.isArray(manifest.layers))return;
      for(const item of manifest.layers){
        if(!item.id || !item.url || !['line','fill','circle'].includes(item.type))continue;
        const isWater=/water|drain|river|stream|canal|ditch/.test(item.id);
        map.addSource(item.id,{type:'geojson',data:item.url,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'});
        map.addLayer({id:item.id,type:item.type,source:item.id,...(item.filter?{filter:item.filter}:{}),layout:{visibility:isWater&&!$('#water-toggle').checked?'none':'visible'},paint:item.paint || (item.type==='line'?{'line-color':'#72eee2','line-width':1.5}:item.type==='circle'?{'circle-color':'#c8ed9a','circle-radius':3}:{'fill-color':'#72eee2','fill-opacity':.08})});
        if(isWater)regionalWaterLayers.push(item.id);
      }
      if(regionalWaterLayers.length){const note=document.createElement('div');note.className='network-legend';note.innerHTML='<span><i></i>Río / arroyo</span><span><i></i>Canal</span><span><i></i>Dren / zanja abiertos</span>';$('#water-toggle').closest('label').after(note);}
    } catch(error){console.info('Regional overlays not available',error.message);}
  }
})();
