// Precompute the demo routes with the shared cauce. router (same code path as the page) -> labs/nav-juguete/demo-routes*.json
import fs from 'node:fs';
const L='/srv/contorno/data/guadalajara-flood-lab/labs/';
const {planRoutes}=await import(L+'nav-juguete/routing.js');
const {loadRouter}=await import(L+'shared/router/router.js');
const rt=await loadRouter({hazardIndexUrl: L+'shared/hazard/index.json'});
const idx=JSON.parse(fs.readFileSync(L+'shared/hazard/index.json','utf8'));
const ids=idx.layers.filter(l=>!['modeled','terrain-index'].includes(l.kind)&&(l.router||{}).default!==false&&l.type==='geojson').map(l=>l.id); console.log('hazardIds',ids.join(','));
const A=[-103.3925,20.6743], B=JSON.parse(process.argv[2]), out=process.argv[3];
const R=await planRoutes(rt,A,B,{hazardIds:ids,log:console.log});
R.generated=new Date().toISOString(); R.routerEngine=rt.engine;
const e=R.events; const lab=x=>x.map(h=>`${h.kind[0]}:${(h.label||'').slice(0,40)}@${Math.round(h.s)}${h.distance_m?'/'+Math.round(h.distance_m)+'m':''}`).join(' | ');
console.log('engine',R.engine,'reroute',R.reroute&&Math.round(R.reroute.s),'fast',(R.fastest.distance_m/1000).toFixed(2),'km',(R.fastest.duration_s/60).toFixed(1),'min; safe from P',R.safe&&(R.safe.distance_m/1000).toFixed(2),'km',R.safe&&(R.safe.duration_s/60).toFixed(1),'min');
console.log('fastCrossed:',lab(e.fastCrossed));console.log('avoided:',lab(e.avoided));console.log('safeCrossed:',lab(e.safeCrossed));console.log('safeNear:',lab(e.safeNear));
console.log('safe steps:',R.safe&&R.safe.steps.map(s=>s.instruction).join(' / '));
fs.writeFileSync(out,JSON.stringify(R));
process.exit(0);
