// Dev-server lifecycle checks: repeated restarts don't leak loops/resources; blackout warning
// and low-quality mode screenshots.
import { chromium } from 'playwright-core';
const base = process.env.LK_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: process.env.LK_BROWSER ?? 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  // Count animation-frame callbacks and global (window/document) listener registrations.
  window.__raf = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { window.__raf++; cb(t); });
  window.__listeners = 0;
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (...a) { if (this === window || this === document || this === window.visualViewport) window.__listeners++; return add.apply(this, a); };
});
await page.goto(`${base}?shift=2`);
await page.waitForFunction(() => window.__lk?.game?.state === 'ready');
await page.keyboard.press('Space');
await page.waitForTimeout(800);
const sample = () => page.evaluate(async () => {
  const g = window.__lk.game;
  const r0 = window.__raf;
  await new Promise((r) => setTimeout(r, 1000));
  const m = g.render.renderer.info.memory;
  return { rafPerSec: window.__raf - r0, listeners: window.__listeners, geometries: m.geometries, textures: m.textures, sceneChildren: g.render.scene.children.length };
});
const before = await sample();
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('Escape');
  await page.waitForSelector('.overlay button');
  await page.click('text=Restart shift');
  await page.waitForFunction(() => window.__lk.game.state === 'playing');
  await page.waitForTimeout(150);
}
const after = await sample();
console.log(JSON.stringify({ before, after }));
// Blackout warning: switch A off and capture mid-warning.
await page.evaluate(() => window.__lk.game.world.toggleCircuit(0));
await page.waitForTimeout(350);
await page.screenshot({ path: 'test-artifacts/blackout-warning.png' });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'test-artifacts/blackout-after.png' });
// Low quality mode.
await page.keyboard.press('Escape');
await page.click('text=Settings');
await page.click('button[data-key="Quality"][data-val="low"]');
await page.click('text=Back');
await page.click('text=Resume');
await page.evaluate(() => window.__lk.game.world.toggleCircuit(0));
await page.waitForTimeout(1200);
await page.screenshot({ path: 'test-artifacts/quality-low.png' });
const low = await page.evaluate(() => ({ q: window.__lk.game.render.getQuality(), shadows: window.__lk.game.render.renderer.shadowMap.enabled, lights: window.__lk.game.render.warmLights.length }));
console.log(JSON.stringify({ low, errors }));
await browser.close();
