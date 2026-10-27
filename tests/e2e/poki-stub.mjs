// Poki build check with a stub SDK (the real SDK/Inspector check still has to be done on Poki).
// Verifies event order, no events during a break, frozen simulation during the break, and that
// the game still works when the SDK is blocked.  Run after `npm run build:poki`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const PREFIX = '/poki/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = normalize(url.pathname.slice(PREFIX.length) || 'index.html');
  if (!url.pathname.startsWith(PREFIX) || p.includes('..')) { res.writeHead(404); res.end(); return; }
  try { res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(await readFile(join('dist-poki', p))); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(5289, r));
const STUB = `window.__poki = [];
window.PokiSDK = {
  init: () => { __poki.push('init'); return Promise.resolve(); },
  gameLoadingFinished: () => __poki.push('gameLoadingFinished'),
  gameplayStart: () => __poki.push('gameplayStart'),
  gameplayStop: () => __poki.push('gameplayStop'),
  commercialBreak: (cb) => { __poki.push('commercialBreak'); cb && cb(); return new Promise((r) => setTimeout(() => { __poki.push('breakDone'); r(); }, 1500)); },
};`;
const browser = await chromium.launch({ channel: process.env.LK_BROWSER ?? 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const out = {};
for (const mode of ['stub', 'blocked']) {
  const page = await browser.newPage({ viewport: { width: 1031, height: 580 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://game-cdn.poki.com/**', (route) => (mode === 'stub' ? route.fulfill({ contentType: 'text/javascript', body: STUB }) : route.abort()));
  await page.goto(`http://localhost:5289${PREFIX}`);
  await page.waitForSelector('.overlay.start');
  const log = () => page.evaluate(() => (window.__poki ?? []).slice());
  const atLoad = await log();
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(400);
  const afterStart = await log();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const afterPause = await log();
  await page.click('text=Resume');
  await page.waitForTimeout(500);
  const duringBreak = await log();
  const pausedDuringBreak = await page.evaluate(() => !!document.querySelector('.hud') && document.querySelector('.overlay')?.classList.contains('hidden'));
  await page.waitForTimeout(1600);
  const afterBreak = await log();
  // Restart through the pause menu (natural break between runs).
  await page.keyboard.press('Escape');
  await page.click('text=Restart shift');
  await page.waitForTimeout(2200);
  const afterRestart = await log();
  out[mode] = { atLoad, afterStart, afterPause, duringBreak, afterBreak, afterRestart, pausedDuringBreak, errors };
  await page.close();
}
await browser.close();
server.close();
console.log(JSON.stringify(out, null, 1));
