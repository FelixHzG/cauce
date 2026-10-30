// node shot2.mjs <url> <outPrefix> <w> <h> <times: comma list | "none" | "scroll:k1,k2"> [scale] [waitMs]
// times: seeks window.__cauceDemo to each t and screenshots <outPrefix>-<t>.jpg
// scroll:k,...: live mode, scrolls to step k (uses ?step and rail anchors) and screenshots <outPrefix>-s<k>.jpg
import {createRequire} from 'node:module';
const require=createRequire('C:/Users/Felip/contorno-compute/labs/tools/');
const {chromium}=require('playwright-core');
const [,,url,out,w='1600',h='1000',times='none',scale='1',wait='3000']=process.argv;
const browser=await chromium.launch({executablePath:process.env.LOCALAPPDATA+'\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe',args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-webgpu']});
const mobile=+w<700;
const page=await browser.newPage({viewport:{width:+w,height:+h},deviceScaleFactor:+scale,isMobile:mobile,hasTouch:mobile});
const logs=[];page.on('console',m=>{if(['error','warning'].includes(m.type()))logs.push(m.type()+': '+m.text().slice(0,240))});page.on('pageerror',e=>logs.push('pageerror: '+e.message));
page.on('requestfailed',r=>logs.push('reqfail: '+r.url().slice(0,140)));
const t0=Date.now();setTimeout(()=>{console.log('global timeout',JSON.stringify(logs.slice(0,30)));process.exit(2)},240000).unref();
await page.goto(url,{waitUntil:'load',timeout:120000});
if(times==='none'){await page.waitForTimeout(+wait);await page.screenshot({path:out+'.jpg',type:'jpeg',quality:90});}
else if(times.startsWith('scroll:')){
  await page.waitForFunction(()=>document.getElementById('boot')?.classList.contains('gone'),null,{timeout:90000});
  for(const k of times.slice(7).split(',').map(Number)){
    await page.evaluate(k=>{document.querySelectorAll('#rail button')[k]?.click()},k);
    await page.waitForTimeout(+wait);
    await page.screenshot({path:`${out}-s${k}.jpg`,type:'jpeg',quality:90});
    console.log('step',k);
  }
}
else{
  await page.waitForFunction(()=>window.__cauceDemo,null,{timeout:60000});
  for(const t of times.split(',').map(Number)){
    const s=Date.now();
    const ok=await Promise.race([page.evaluate(t=>window.__cauceDemo.seek(t),t),new Promise(r=>setTimeout(()=>r('timeout'),90000))]);
    if(ok==='timeout'){console.log('seek timeout',t);await page.screenshot({path:out+'-timeout.jpg',type:'jpeg'});break;}
    await page.screenshot({path:`${out}-${String(t).replace('.','_')}.jpg`,type:'jpeg',quality:90});
    console.log('t',t,'ms',Date.now()-s);
  }
}
console.log(JSON.stringify({ms:Date.now()-t0,console:logs.slice(0,40)}));
await browser.close();
