// Publish static assets from this source repository's main branch to production.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const branch=execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim();
if(branch!=='main')throw Error('Production deployments must come from main');
execFileSync(process.execPath,['--check','dist/app.js'],{cwd:root,stdio:'inherit'});
const dirty=execFileSync('git',['status','--porcelain','--','dist'],{cwd:root,encoding:'utf8'}).trim();
if(dirty)throw Error('Commit the reviewed dist assets to main before deploying');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const base='/srv/contorno/data/guadalajara-flood-lab';
const release=path.join(base,'releases',commit);
fs.mkdirSync(path.dirname(release),{recursive:true,mode:0o755});
if(!fs.existsSync(release))fs.cpSync(path.join(root,'dist'),release,{recursive:true});
const tmp=path.join(base,'current.next');if(fs.existsSync(tmp))fs.unlinkSync(tmp);fs.symlinkSync(release,tmp);fs.renameSync(tmp,path.join(base,'current'));
fs.writeFileSync(path.join(base,'deployment.json'),JSON.stringify({commit,branch,deployedAt:new Date().toISOString(),release,hosts:['guadalajara.vsfelix.com','codex-hackaton.vsfelix.com']},null,2));
console.log(JSON.stringify({commit,branch,release,production:true}));
