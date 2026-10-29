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
  $('#sources-open').addEventListener('click', () => $('#sources-dialog').showModal());
  $('#sources-close').addEventListener('click', () => $('#sources-dialog').close());
  $('#sources-dialog').addEventListener('click', event => { if (event.target === $('#sources-dialog')) { const bounds = event.target.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.target.close(); } });
  if (!window.maplibregl || (typeof maplibregl.supported === 'function' && !maplibregl.supported())) { announce('El mapa necesita WebGL y conexión a internet. Prueba con un navegador actualizado.', true); return; }
  const dem = {type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],encoding:'terrarium',tileSize:256,maxzoom:15,attribution:'<a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles / Mapzen</a>'};
  const places = {
    metro:{center:[-103.357,20.71],zoom:10.75,bearing:-22,pitch:58,title:'Una ciudad entre cuencas.',description:'Área Metropolitana de Guadalajara'},
    barranca:{center:[-103.277,20.753],zoom:12.45,bearing:38,pitch:68,title:'La ciudad encuentra su borde.',description:'Barranca de Huentitán · Río Santiago'},
    primavera:{center:[-103.583,20.656],zoom:11.6,bearing:-35,pitch:64,title:'El bosque guarda el relieve.',description:'Bosque La Primavera · Jalisco'},
    chapala:{center:[-103.194,20.336],zoom:10.25,bearing:7,pitch:58,title:'Un horizonte de agua.',description:'Chapala · El sur de la cuenca'}
  };
  let map;
  try { map = new maplibregl.Map({container:'map',...places.metro,maxPitch:75,maxZoom:17,minZoom:7,renderWorldCopies:false,attributionControl:{compact:true},style:{version:8,sources:{satellite:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'},streets:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'},terrain:dem,shade:dem},layers:[{id:'background',type:'background',paint:{'background-color':'#dce1ca'}},{id:'satellite',type:'raster',source:'satellite',paint:{'raster-saturation':-.17,'raster-contrast':.06}},{id:'streets',type:'raster',source:'streets',layout:{visibility:'none'},paint:{'raster-saturation':-.6}},{id:'hillshade',type:'hillshade',source:'shade',layout:{visibility:'none'},paint:{'hillshade-exaggeration':.55,'hillshade-shadow-color':'#3c5c4c','hillshade-highlight-color':'#f7f5dd','hillshade-accent-color':'#778d68'}}],terrain:{source:'terrain',exaggeration:1.5},sky:{'sky-color':'#c3d9d4','horizon-color':'#dce4d7','fog-color':'#dce4d7','fog-ground-blend':.16}}}); }
  catch (error) { console.error(error); announce('No se pudo iniciar el mapa 3D. Prueba con aceleración gráfica activada.', true); return; }
  window.cauceMap = map;
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');
  map.addControl(new maplibregl.ScaleControl({maxWidth:110,unit:'metric'}),'bottom-left');
  let loaded = false, errorCounts = {}, activeBasemap = 'satellite';
  const slowTimer = setTimeout(() => { if (!loaded) announce('La cartografía está tardando en cargar. Revisa tu conexión.',true); }, 25000);
  map.on('load', () => {loaded = true;clearTimeout(slowTimer); announce('Relieve listo · Explora el territorio',false,2300); loadFloodData(); loadRegionalLayers(); loadInegiCoverage(); });
  map.on('error', event => {
    const source = event.sourceId || 'map'; errorCounts[source] = (errorCounts[source] || 0) + 1;
    if (errorCounts[source] === 3) announce(source === 'terrain' || source === 'shade' ? 'Parte del relieve no está disponible. Puedes seguir explorando el mapa.' : 'Algunas teselas no cargaron. Prueba otra vista del mapa.',true,7000);
  });
  document.querySelectorAll('[data-basemap]').forEach(button => button.addEventListener('click', () => {
    if (!loaded) return;
    activeBasemap = button.dataset.basemap;
    document.body.dataset.basemap = activeBasemap;
    for (const layer of ['satellite','streets','hillshade']) map.setLayoutProperty(layer,'visibility', (activeBasemap === 'relief' ? layer === 'hillshade' : layer === activeBasemap) ? 'visible':'none');
    document.querySelectorAll('[data-basemap]').forEach(item => item.classList.toggle('active',item === button));
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
      map.addLayer({id:'flood-observations-fill',type:'fill',source:'flood-observations',filter:['==',['geometry-type'],'Polygon'],layout:{visibility:'visible'},paint:{'fill-color':['match',['get','category'],'Zonas Criticas','#f47d66','#43cec8'],'fill-opacity':.34}});
      map.addLayer({id:'flood-observations-line',type:'line',source:'flood-observations',filter:['==',['geometry-type'],'Polygon'],layout:{visibility:'visible'},paint:{'line-color':['match',['get','category'],'Zonas Criticas','#ffae94','#85f0e1'],'line-width':1.2}});
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
    // Parent acquisition may add validated regional overlays without requiring a UI rebuild.
    try {const response = await fetch('./data/regional-layers.json'); if(!response.ok) return; const manifest = await response.json(); if(!Array.isArray(manifest.layers)) return;
      for(const item of manifest.layers) {if(!item.id || !item.url || !['line','fill','circle'].includes(item.type)) continue; map.addSource(item.id,{type:'geojson',data:item.url}); map.addLayer({id:item.id,type:item.type,source:item.id,paint:item.paint || (item.type==='line'?{'line-color':'#92e4d2','line-width':1.4}:item.type==='circle'?{'circle-color':'#d5ee9a','circle-radius':3}:{'fill-color':'#d5ee9a','fill-opacity':.05})});}
    } catch(error) {console.info('Regional overlays not available',error.message);}
  }
})();
