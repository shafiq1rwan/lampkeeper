// Capture real rendered scenes for art-direction review. Development hooks are used only
// to choose repeatable camera positions; these are not gameplay playthrough assertions.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'test-artifacts/visual-review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.LK_BROWSER ?? 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const base = process.env.LK_URL ?? 'http://localhost:5173/';
const report = [];
try {
  for (const vp of [
    { name: 'desktop', width: 1440, height: 900, touch: false },
    { name: 'mobile', width: 844, height: 390, touch: true },
    { name: 'portrait', width: 390, height: 844, touch: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${vp.name}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${vp.name}: ${m.text()}`); });
    await page.goto(`${base}?shift=1&seed=48104`);
    await page.waitForFunction(() => window.__lk?.game?.state === 'ready');
    await page.keyboard.press('Space');
    await page.keyboard.press('F3');
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${output}/${vp.name}-opening.png` });
    await page.evaluate(() => {
      const g = window.__lk.game;
      g.autopilot = () => ({ moveX: 0, moveZ: 0, action: false });
      g.world.px = 11.5; g.world.pz = 7.5;
      g.render.rig.snap(11.5, 7.5);
    });
    if (await page.locator('.tutorial-skip').isVisible()) await page.locator('.tutorial-skip').click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${output}/${vp.name}-hall.png` });
    report.push(await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight }, draws: window.__lk.game.render.drawCalls, triangles: window.__lk.game.render.renderer.info.render.triangles, state: window.__lk.game.state })));
    // An explicitly staged reference composition, not a claimed gameplay milestone.
    await page.evaluate(() => {
      const g = window.__lk.game, w = g.world;
      w.px = 9.5; w.pz = 7.5; w.facing = Math.PI / 4;
      g.render.rig.snap(w.px, w.pz);
      w.creature.beginStaged(6 * w.level.w + 14);
      w.creature.stagedPhase = 'watch'; w.creature.t = 3;
      g.pause.add('overlay');
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${output}/${vp.name}-reference-staged.png` });
    if (!vp.touch) {
      await page.evaluate(() => { const g = window.__lk.game; g.render.setQuality('low'); });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${output}/desktop-low.png` });
    }
    await context.close();
  }
  await writeFile(`${output}/report.json`, JSON.stringify({ report, errors }, null, 2));
  console.log(JSON.stringify({ report, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
