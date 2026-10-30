// W10 screenshot helper for invertir-1 (copy to C:\Users\Felip\contorno-compute\labs\invertir-1\).
// node shot.mjs <url> <outPrefix> <w> <h> <times: comma list | "none"> [waitMs] [jsFile]
//   times = "none": wait waitMs after load (and after optional jsFile), write <outPrefix>.jpg
//   times = "0,5,12": window.__cauceDemo.seek(t) for each, write <outPrefix>-<t>.jpg
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('C:/Users/Felip/contorno-compute/labs/tools/');
const { chromium } = require('playwright-core');
const [, , url, out, w = '1600', h = '1000', times = 'none', wait = '6000', js] = process.argv;
const phone = +w < 700;
const browser = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
const logs = []; page.on('response', r => { if (r.status() >= 400) logs.push('HTTP ' + r.status() + ' ' + r.url().slice(-90)); }); page.on('requestfailed', r => logs.push('FAILED ' + r.url().slice(-90))); page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 300)); }); page.on('pageerror', e => logs.push('pageerror: ' + e.message));
const t0 = Date.now(); setTimeout(() => { console.log('global timeout', JSON.stringify(logs)); process.exit(2); }, 240000).unref();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
if (times === 'none') {
  await page.waitForTimeout(+wait);
  if (js) console.log('eval:', JSON.stringify(await page.evaluate(fs.readFileSync(js, 'utf8'))));
  if (js) await page.waitForTimeout(2500);
  await page.screenshot({ path: out + '.jpg', type: 'jpeg', quality: 90 });
} else {
  await page.waitForFunction(() => window.__cauceDemo, null, { timeout: 90000 });
  for (const t of times.split(',').map(Number)) {
    const s = Date.now();
    const ok = await Promise.race([page.evaluate(t => window.__cauceDemo.seek(t), t), new Promise(r => setTimeout(() => r('timeout'), 40000))]);
    if (ok === 'timeout') { console.log('seek timeout', t); break; }
    await page.screenshot({ path: `${out}-${String(t).replace('.', '_')}.jpg`, type: 'jpeg', quality: 90 });
    console.log('t', t, 'ms', Date.now() - s);
  }
}
console.log(JSON.stringify({ ms: Date.now() - t0, console: logs.slice(0, 40) }));
await browser.close();
