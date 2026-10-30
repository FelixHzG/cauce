// W10 interaction check for invertir-1: node interact.mjs <baseUrl> <outPrefix>
// Loads the page (desktop + phone), clicks through municipality filter, ranking card, preset, method drawer; screenshots each.
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/Felip/contorno-compute/labs/tools/');
const { chromium } = require('playwright-core');
const [, , url, out = 'i'] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const logs = [];
const hook = p => { p.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 300)); }); p.on('pageerror', e => logs.push('pageerror: ' + e.message)); };
const idle = p => p.evaluate(() => new Promise(r => { const m = window.__map; let d = false; const f = () => { if (!d) { d = true; r(); } }; m.once('idle', f); m.triggerRepaint(); setTimeout(f, 8000); }));
setTimeout(() => { console.log('timeout', JSON.stringify(logs)); process.exit(2); }, 240000).unref();

// desktop
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); hook(page);
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__map && !document.querySelector('#app').classList.contains('booting'), null, { timeout: 90000 });
await idle(page); await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}-home.jpg`, type: 'jpeg', quality: 90 });
// hover a tower
await page.mouse.move(820, 520); await page.waitForTimeout(400);
await page.screenshot({ path: `${out}-hover.jpg`, type: 'jpeg', quality: 90 });
// municipality filter: Tlaquepaque
await page.click('#munis [data-mun="098"]'); await page.waitForTimeout(1800); await idle(page);
await page.screenshot({ path: `${out}-mun.jpg`, type: 'jpeg', quality: 90 });
// click second card
await page.click('.card-r:nth-child(2)'); await page.waitForTimeout(2200); await idle(page);
await page.screenshot({ path: `${out}-card.jpg`, type: 'jpeg', quality: 90 });
// back to all, preset "agua", weights tab
await page.click('#munis [data-mun="all"]'); await page.waitForTimeout(400);
await page.click('#right .tabs [data-tab="weights"]');
await page.click('[data-preset="agua"]'); await page.waitForTimeout(1600); await idle(page);
await page.screenshot({ path: `${out}-preset.jpg`, type: 'jpeg', quality: 90 });
// height mode: modelo
await page.click('#heightmode [data-h="mod"]').catch(() => logs.push('no mod height mode'));
await page.waitForTimeout(1200); await idle(page);
await page.screenshot({ path: `${out}-hmod.jpg`, type: 'jpeg', quality: 90 });
// method drawer
await page.click('#btn-method'); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}-method.jpg`, type: 'jpeg', quality: 90 });
const hash = await page.evaluate(() => location.hash);
await page.close();

// phone
const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); hook(ph);
await ph.goto(url, { waitUntil: 'load' });
await ph.waitForFunction(() => window.__map && !document.querySelector('#app').classList.contains('booting'), null, { timeout: 90000 });
await idle(ph); await ph.waitForTimeout(1200);
await ph.screenshot({ path: `${out}-phone.jpg`, type: 'jpeg', quality: 90 });
await ph.tap('#phonetabs [data-ptab="why"]'); await ph.waitForTimeout(400);
await ph.screenshot({ path: `${out}-phone-why.jpg`, type: 'jpeg', quality: 90 });
await ph.tap('#phonetabs [data-ptab="weights"]'); await ph.waitForTimeout(400);
await ph.screenshot({ path: `${out}-phone-w.jpg`, type: 'jpeg', quality: 90 });
console.log(JSON.stringify({ hash, logs: logs.slice(0, 30) }));
await browser.close();
