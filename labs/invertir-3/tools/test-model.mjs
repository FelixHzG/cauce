import fs from 'node:fs'; import { PNG } from 'pngjs';
import * as M from '../js/model.js';
const L='/srv/contorno/data/guadalajara-flood-lab/labs/';
const board=JSON.parse(fs.readFileSync(L+'invertir-3/data/board.json','utf8'));
const stats=JSON.parse(fs.readFileSync(L+'shared/hazard/modeled/sim-drenaje/stats.json','utf8'));
const rd=f=>PNG.sync.read(fs.readFileSync(f));
const a=rd(L+'shared/hazard/modeled/sim-drenaje/web/freq-by-cap.png'), b=rd(L+'shared/hazard/modeled/sim-drenaje/web/indicators.png'), c=rd(L+'invertir-3/data/labels.png');
const W=a.width,H=a.height, N=W*H; const freqV=new Uint32Array(N), ind=new Uint8Array(N*3), lab=new Uint16Array(N);
for(let i=0;i<N;i++){freqV[i]=a.data[i*4]*65536+a.data[i*4+1]*256+a.data[i*4+2]; ind[i*3]=b.data[i*4];ind[i*3+1]=b.data[i*4+1];ind[i*3+2]=b.data[i*4+2]; lab[i]=c.data[i*4]*256+c.data[i*4+1];}
const lb=board.meta.labels.world; const drainage=JSON.parse(fs.readFileSync(L+"shared/hazard/modeled/sim-drenaje/ageb-drainage.json","utf8")); const terrain=JSON.parse(fs.readFileSync(L+"shared/hazard/modeled/sim-relieve/ageb-terrain.json","utf8")); const pxKm2=Math.abs((lb.x1-lb.x0)/W*(lb.y0-lb.y1)/H)*board.meta.mScale**2/1e6;
const forceObs=process.argv[2]==='obs';
let t0=Date.now();
const m=M.buildModel(board,{stats, drainage: process.argv[2]==="img"?null:drainage, terrain, images: forceObs?null:{freqV,ind,lab,W,H,pxKm2}});
console.log('mode',m.mode,'build ms',Date.now()-t0,'dmean',m.dmean.toFixed(3),'pxKm2',pxKm2.toFixed(5));
console.log('E0 total',Math.round(m.E0total),'F0',Math.round(m.F0total),'margShare0',m.margShare0.toFixed(2));
const gaps={}; m.gap.forEach(g=>gaps[g]=(gaps[g]||0)+1); console.log('gaps',gaps);
// top exposed
const idx=[...Array(m.n).keys()].sort((x,y)=>m.E0[y]-m.E0[x]).slice(0,10);
for(const i of idx){const A=m.agebs[i]; console.log(A.id,A.col,A.m,'pob',A.pob,'s0',m.s0[i].toFixed(2),'E0',Math.round(m.E0[i]),'gap',m.gap[i],'area',m.area[i].toFixed(2), 'curve',Array.from(m.curve.slice(i*7,i*7+7)).map(v=>v.toFixed(2)).join(' '));}
t0=Date.now(); const g=M.greedyPlan(m,M.BUDGET); console.log('greedy ms',Date.now()-t0,'items',g.items.length,'people',Math.round(g.ev.people),'fac',g.ev.fac.toFixed(1),'cost',g.ev.cost,'km2',g.ev.km2.toFixed(2),'marg',g.ev.margShare.toFixed(2));
const cnt={}; g.items.forEach(it=>cnt[it.tool]=(cnt[it.tool]||0)+1); console.log(cnt);
for(const p of g.picks.slice(0,12)) console.log(p.tool, m.agebs[p.i].col, m.agebs[p.i].m, 'gain',Math.round(p.gain),'per MDP',(p.gain/M.TOOL[p.tool].cost).toFixed(1), 'gap', m.gap[p.i], 'area', m.area[p.i].toFixed(2));
// per tool best single
for(const t of M.TOOLS){ const ev=M.evaluate(m,[]); let best=0,bi=-1; for(let i=0;i<m.n;i++){const v=M.marginal(m,ev,t.id,i,[]); if(v>best){best=v;bi=i;}} console.log('best',t.id,Math.round(best),'per MDP',(best/t.cost).toFixed(1), m.agebs[bi].col, m.gap[bi]); }
