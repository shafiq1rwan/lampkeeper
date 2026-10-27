// Dev-server exploration: run the autopilot in the real game and capture key moments.
// node tests/e2e/explore.mjs <shift> <prefix> [width] [height]
import { chromium } from 'playwright-core';
const [shift = '1', prefix = 'test-artifacts/explore', w = '1280', h = '720'] = process.argv.slice(2);
const base = process.env.LK_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: process.env.LK_BROWSER ?? 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (!m.text().includes('[vite]')) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?shift=${shift}`);
await page.waitForFunction(() => window.__lk?.game?.state === 'ready', null, { timeout: 30000 });
await page.keyboard.press('Space');
await page.waitForTimeout(400);
await page.evaluate(() => window.__lk.startBot());
const shots = new Set();
const t0 = Date.now();
let last = '';
while (Date.now() - t0 < 240000) {
  const s = await page.evaluate(() => {
    const g = window.__lk.game; const wd = g.world; const c = wd.creature;
    return { state: g.state, cs: c.state, d: Math.hypot(c.x - wd.px, c.z - wd.pz), repairs: wd.repairs, t: wd.time, menu: g.menus.current, tut: g.tutorialStep };
  });
  const line = `${s.state} ${s.cs} rep=${s.repairs} tut=${s.tut} menu=${s.menu}`;
  if (line !== last) { console.log(`${((Date.now()-t0)/1000).toFixed(1)}s sim=${s.t.toFixed(1)} ${line} d=${s.d.toFixed(1)}`); last = line; }
  const snap = async (name) => { if (!shots.has(name)) { shots.add(name); await page.screenshot({ path: `${prefix}-${name}.png` }); } };
  if (s.state === 'playing' && s.cs !== 'inactive' && s.cs !== 'gone' && s.d < 7) await snap('creature');
  if (s.cs === 'staged') await snap('staged');
  if (s.cs === 'warn') await snap('warn');
  if (s.cs === 'chase') await snap('chase');
  if (s.state === 'captured' && s.menu === 'capture') { await snap('captured'); break; }
  if (s.menu === 'ending-skip') { for (const ms of [1500, 2200, 2000]) { await page.waitForTimeout(ms); await page.screenshot({ path: `${prefix}-ending-${ms}.png` }); } }
  if (s.menu === 'results' || s.menu === 'ending') { await page.waitForTimeout(300); await snap(s.menu); break; }
  await page.waitForTimeout(250);
}
console.log(logs.slice(-15).join('\n'));
await browser.close();
