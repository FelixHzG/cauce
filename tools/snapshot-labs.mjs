// Copy the /labs prototypes' source (code, docs, small JSON, fonts, screenshots) into site/labs/ for versioning.
// Heavy data (tile pyramids, animation frames, GeoJSON, rasters, video) stays on the VPS at
// /srv/contorno/data/guadalajara-flood-lab/labs and is listed in labs/DATA-MANIFEST.json instead.
// Usage (from the project root): sudo node site/tools/snapshot-labs.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const src='/srv/contorno/data/guadalajara-flood-lab/labs';
const dst=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','labs');
const MAX=1024*1024;
const code=/\.(html|js|mjs|cjs|css|md|txt|sh|svg|woff2?|ttf|otf)$/i;
const small=/\.(json|jpg|jpeg|png|webp)$/i;
const heavyDir=/(^|\/)(tiles|frames[^/]*|web|dtm|ndsm|hillshade|buildings|T2|T10|T100|data\/frames-[^/]+)(\/|$)|\/\d+\/\d+\//;
const kept=[],skipped={};
function walk(rel){
  for(const e of fs.readdirSync(path.join(src,rel),{withFileTypes:true})){
    const r=rel?`${rel}/${e.name}`:e.name;
    if(e.isDirectory()){walk(r);continue}
    const size=fs.statSync(path.join(src,r)).size;
    const ok=!heavyDir.test('/'+r)&&size<=MAX&&(code.test(r)||(small.test(r)&&(!/\.png$/i.test(r)||size<=200*1024)));
    if(ok)kept.push(r);
    else{const top=r.split('/').slice(0,r.startsWith('shared/')?3:1).join('/');const s=skipped[top]??={files:0,bytes:0,examples:[]};s.files++;s.bytes+=size;if(s.examples.length<3)s.examples.push(r)}
  }
}
walk('');
fs.rmSync(dst,{recursive:true,force:true});
for(const r of kept){const to=path.join(dst,r);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(src,r),to)}
const totals=Object.values(skipped).reduce((a,s)=>({files:a.files+s.files,bytes:a.bytes+s.bytes}),{files:0,bytes:0});
fs.writeFileSync(path.join(dst,'DATA-MANIFEST.json'),JSON.stringify({source:src,served:'https://guadalajara.vsfelix.com/labs/',snapshot:new Date().toISOString(),kept:kept.length,excluded:totals,excludedByFolder:Object.fromEntries(Object.entries(skipped).sort((a,b)=>b[1].bytes-a[1].bytes))},null,1));
console.log(JSON.stringify({kept:kept.length,keptBytes:kept.reduce((a,r)=>a+fs.statSync(path.join(dst,r)).size,0),excluded:totals}));
