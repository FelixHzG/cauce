// node mochi-shot.mjs <url> <outPrefix> <w> <h> <times: comma list | "none"> [scale] [waitMs]
// Seeks window.__cauceDemo to each time and screenshots <outPrefix>-<t>.jpg. Prints console errors.
import {createRequire} from 'node:module';
const require=createRequire('C:/Users/Felip/contorno-compute/labs/tools/');
const {chromium}=require('playwright-core');
const [,,url,out,w='1600',h='1000',times='none',scale='1',wait='3000']=process.argv;
const browser=await chromium.launch({executablePath:process.env.LOCALAPPDATA+'\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe',args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:+w,height:+h},deviceScaleFactor:+scale,isMobile:+w<700,hasTouch:+w<700});
const logs=[];page.on('console',m=>{if(['error','warning'].includes(m.type()))logs.push(m.type()+': '+m.text().slice(0,300))});page.on('pageerror',e=>logs.push('pageerror: '+e.message));
const t0=Date.now();setTimeout(()=>{console.log('global timeout',JSON.stringify(logs));process.exit(2)},150000).unref();
await page.goto(url,{waitUntil:'load',timeout:120000});
if(times==='none'){await page.waitForTimeout(+wait);await page.screenshot({path:out+'.jpg',type:'jpeg',quality:88});}
else{
  await page.waitForFunction(()=>window.__cauceDemo,null,{timeout:60000});
  for(const t of times.split(',').map(Number)){
    const s=Date.now();
    const ok=await Promise.race([page.evaluate(t=>window.__cauceDemo.seek(t),t),new Promise(r=>setTimeout(()=>r('timeout'),40000))]);
    if(ok==='timeout'){console.log('seek timeout',t,JSON.stringify(logs.slice(0,20)));const txt=await page.evaluate(()=>document.querySelector('#boot p')?.textContent);console.log('boot:',txt);await page.screenshot({path:out+'-timeout.jpg',type:'jpeg'});break;}
    await page.screenshot({path:`${out}-${String(t).replace('.','_')}.jpg`,type:'jpeg',quality:88});
    console.log('t',t,'ms',Date.now()-s);
  }
}
console.log(JSON.stringify({ms:Date.now()-t0,console:logs.slice(0,40)}));
await browser.close();
