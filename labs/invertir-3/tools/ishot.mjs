// invertir-3 screenshot helper (W10). node ishot.mjs <url> <out> [w] [h] [mode] [arg] [scale]
// mode: wait (arg = extra ms after load) | seek (arg = comma list of seconds; out contains {t}) | js (arg = js file evaluated, may return Promise)
import { createRequire } from 'node:module'; import fs from 'node:fs';
const require = createRequire('C:/Users/Felip/contorno-compute/labs/tools/package.json');
const { chromium } = require('playwright-core');
const [, , url, out, w = '1600', h = '1000', mode = 'wait', arg = '1500', scale = '1'] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const mobile = +w < 600;
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +scale, isMobile: mobile, hasTouch: mobile });
const logs = []; page.on('response', r => { if (r.status() >= 400) logs.push('HTTP ' + r.status() + ' ' + r.url()); }); page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); }); page.on('pageerror', e => logs.push('pageerror: ' + e.message));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done') || /No pude/.test(document.getElementById('ldTxt')?.textContent || ''), null, { timeout: 120000 });
const tReady = Date.now() - t0;
const shotOpts = p => ({ path: p, type: p.endsWith('.jpg') ? 'jpeg' : 'png', quality: p.endsWith('.jpg') ? 90 : undefined });
if (mode === 'seek') {
  await page.evaluate(() => window.__cauceDemo.ready);
  for (const t of arg.split(',')) { const ts = Date.now(); await page.evaluate(t => window.__cauceDemo.seek(+t), t); const te = Date.now() - ts; await page.screenshot(shotOpts(out.replace('{t}', String(t).padStart(4, '0')))); console.log('t', t, 'seek ms', te); }
} else if (mode === 'js') {
  console.log('eval:', JSON.stringify(await page.evaluate(fs.readFileSync(arg, 'utf8'))));
  await page.screenshot(shotOpts(out));
} else { await page.waitForTimeout(+arg); await page.screenshot(shotOpts(out)); }
console.log(JSON.stringify({ out, readyMs: tReady, console: logs.slice(0, 30) }));
await browser.close();
