// Dev-server check of the warning → chase → capture presentation (player parked in darkness).
import { chromium } from 'playwright-core';
const base = process.env.LK_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: process.env.LK_BROWSER ?? 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}?shift=2`);
await page.waitForFunction(() => window.__lk?.game?.state === 'ready');
await page.keyboard.press('Space');
await page.waitForFunction(() => ['patrol', 'investigate'].includes(window.__lk.game.world.creature.state), null, { timeout: 30000 });
// Park the caretaker on a dark cell 4 cells from the creature with a clear line of sight.
const placed = await page.evaluate(() => {
  const w = window.__lk.game.world; const c = w.creature; const L = w.level;
  for (let r = 3; r <= 6; r++) for (let i = 0; i < L.w * L.h; i++) {
    if (!L.walk[i] || w.prot.mask[i]) continue;
    const x = (i % L.w) + 0.5, z = Math.floor(i / L.w) + 0.5;
    if (Math.abs(Math.hypot(x - c.x, z - c.z) - r) < 0.5) { w.debugTeleport(x, z); return { x, z, r }; }
  }
  return null;
});
console.log('placed', JSON.stringify(placed));
const seen = {};
for (let i = 0; i < 80; i++) {
  const s = await page.evaluate(() => ({ cs: window.__lk.game.world.creature.state, st: window.__lk.game.state, m: window.__lk.game.menus.current }));
  if (!seen[s.cs]) { seen[s.cs] = true; if (s.cs === 'warn' || s.cs === 'chase') await page.screenshot({ path: `test-artifacts/cap-${s.cs}.png` }); }
  if (s.m === 'capture') { await page.screenshot({ path: 'test-artifacts/cap-overlay.png' }); console.log('capture overlay shown'); break; }
  await page.waitForTimeout(150);
}
console.log('states', Object.keys(seen).join(','), 'errors', errors.join('|'));
await browser.close();
