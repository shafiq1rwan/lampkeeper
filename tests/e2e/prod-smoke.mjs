// Production smoke test: serves dist/ under a non-root sub-path, checks console errors,
// external requests, start → play → pause → hidden-tab → resume, touch-control visibility,
// and captures screenshots at several viewports.  Usage: node tests/e2e/prod-smoke.mjs [distDir]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const dist = process.argv[2] ?? 'dist';
const PREFIX = '/games/lampkeeper/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(PREFIX)) { res.writeHead(404); res.end('outside base path'); return; }
  let p = url.pathname.slice(PREFIX.length) || 'index.html';
  p = normalize(p);
  if (p.includes('..')) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(join(dist, p));
    res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(5288, r));
const base = `http://localhost:5288${PREFIX}`;

const viewports = [
  { name: 'desktop-1280x720', width: 1280, height: 720 },
  { name: 'small-640x360', width: 640, height: 360 },
  { name: 'phone-landscape-844x390', width: 844, height: 390, touch: true },
  { name: 'phone-portrait-390x844', width: 390, height: 844, touch: true },
  { name: 'tablet-1180x820-touch', width: 1180, height: 820, touch: true },
];
const browser = await chromium.launch({ channel: process.env.LK_BROWSER ?? 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = [];
for (const vp of viewports) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch && vp.width < 900, deviceScaleFactor: vp.touch ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  const external = [];
  const notFound = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost:5288/') && !r.url().startsWith('data:')) external.push(r.url()); });
  page.on('response', (r) => { if (r.status() >= 400) notFound.push(`${r.status()} ${r.url()}`); });
  const t0 = Date.now();
  await page.goto(base);
  await page.waitForSelector('.overlay.start', { timeout: 30000 });
  const readyMs = Date.now() - t0;
  await page.screenshot({ path: `test-artifacts/prod-${vp.name}-start.png` });
  const touchVisible = await page.evaluate(() => !document.querySelector('.touch')?.classList.contains('hidden'));
  // Start with a real gesture and move.
  if (vp.touch) await page.touchscreen.tap(vp.width / 2, vp.height * 0.4);
  else await page.keyboard.press('KeyD');
  await page.waitForTimeout(300);
  const playing = await page.evaluate(() => !document.querySelector('.hud')?.classList.contains('hidden') && !document.querySelector('.overlay:not(.hidden)'));
  if (!vp.touch) { await page.keyboard.down('KeyD'); await page.waitForTimeout(900); await page.keyboard.up('KeyD'); }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-artifacts/prod-${vp.name}-play.png` });
  // Pause with Escape (desktop) or the pause button (touch).
  if (vp.touch) await page.tap('.hud-pause'); else await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const paused = await page.evaluate(() => document.querySelector('.overlay h2')?.textContent);
  await page.screenshot({ path: `test-artifacts/prod-${vp.name}-pause.png` });
  // Resume, then simulate the tab being hidden: the pause menu must come back and stay.
  await page.click('.overlay button.primary');
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(150);
  const pausedAfterHidden = await page.evaluate(() => document.querySelector('.overlay h2')?.textContent ?? null);
  // Resize mid-run must not reset it.
  await page.setViewportSize({ width: Math.round(vp.width * 0.8), height: vp.height });
  await page.waitForTimeout(200);
  const stillPaused = await page.evaluate(() => document.querySelector('.overlay h2')?.textContent ?? null);
  report.push({ vp: vp.name, readyMs, touchVisible, playing, paused, pausedAfterHidden, stillPausedAfterResize: stillPaused, errors, external, notFound });
  await ctx.close();
}
await browser.close();
server.close();
console.log(JSON.stringify(report, null, 2));
