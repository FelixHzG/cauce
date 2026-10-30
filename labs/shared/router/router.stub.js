// STUB router (orchestrator). Same API the real router will ship; swap is transparent.
// Uses the public OSRM demo server and cannot avoid hazards yet: avoided is always [].
// API: const router = await loadRouter(); const r = await router.route([lon,lat],[lon,lat],{avoid: FeatureCollection|null});
//  -> {coordinates:[[lon,lat],...], distance_m, duration_s, steps:[{instruction, distance_m, location:[lon,lat]}], avoided:[], engine}
export async function loadRouter(){
  return {
    engine:'stub-osrm-demo',
    ready:false,
    async route(from,to,opts={}){
      const u=`https://router.project-osrm.org/route/v1/driving/${from.join(',')};${to.join(',')}?overview=full&geometries=geojson&steps=true`;
      const j=await (await fetch(u)).json();
      const r=j.routes[0];
      const steps=r.legs.flatMap(l=>l.steps).map(s=>({instruction:[s.maneuver.type,s.maneuver.modifier,s.name].filter(Boolean).join(' '),distance_m:s.distance,location:s.maneuver.location}));
      return {coordinates:r.geometry.coordinates,distance_m:r.distance,duration_s:r.duration,steps,avoided:[],engine:'stub-osrm-demo'};
    }
  };
}
