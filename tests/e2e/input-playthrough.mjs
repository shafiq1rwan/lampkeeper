// Input-driven playthrough on the dev server. The autopilot only decides; this script delivers
// its intent through real keyboard events or real multi-touch events (CDP touch emulation).
// node tests/e2e/input-playthrough.mjs <keyboard|touch> [shift]
import { chromium } from 'playwright-core';
const mode = process.argv[2] ?? 'keyboard';
const shift = process.argv[3] ?? '1';
const base = process.env.LK_URL ?? 'http://localhost:5173/';
const touch = mode === 'touch';
const vp = touch ? { width: 1024, height: 768 } : { width: 1280, height: 720 };
const browser = await chromium.launch({ channel: process.env.LK_BROWSER ?? 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: vp, hasTouch: touch });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${base}?shift=${shift}`);
await page.waitForFunction(() => window.__lk?.game?.state === 'ready', null, { timeout: 30000 });
const cdp = touch ? await ctx.newCDPSession(page) : null;
const stick = { x: 150, y: vp.height - 150 };
if (touch) {
  await page.touchscreen.tap(vp.width / 2, vp.height / 3);
} else await page.keyboard.press('Space');
await page.waitForFunction(() => window.__lk.game.state === 'playing');
// The action button only lays out once play has started.
const btn = await page.evaluate(() => { const r = document.querySelector('.action-btn').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
const held = new Set();
let stickOn = false, actionOn = false;
const points = () => [...(stickOn ? [{ x: stick.x + cur.dx, y: stick.y + cur.dy, id: 1 }] : []), ...(actionOn ? [{ x: btn.x, y: btn.y, id: 2 }] : [])];
const cur = { dx: 0, dy: 0 };
let prev = []; // points the browser currently has pressed
// CDP: a finger is only released by a touchEnd that lists it; touchStart/touchMove carry every
// active point.
async function sendPoints() {
  const pts = points();
  const removed = prev.filter((p) => !pts.some((q) => q.id === p.id));
  const added = pts.some((p) => !prev.some((q) => q.id === p.id));
  if (removed.length) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: removed });
  if (pts.length) await cdp.send('Input.dispatchTouchEvent', { type: added ? 'touchStart' : 'touchMove', touchPoints: pts });
  prev = pts;
}
const t0 = Date.now();
if (process.env.LK_STOP) setTimeout(() => process.exit(0), +process.env.LK_STOP);
let last = '', result = 'timeout', pollTimes = 0, simultaneous = 0;
while (Date.now() - t0 < 360000) {
  const w = await page.evaluate(() => { const g = window.__lk.game; return { ...window.__lk.wish(0.06), state: g.state, menu: g.menus.current, rep: g.world.repairs, tut: g.tutorialStep }; });
  pollTimes++;
  const line = `${w.state} rep=${w.rep} tut=${w.tut} ${w.status}`;
  if (line !== last) { console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${line}`); last = line; }
  if (w.menu === 'results') { result = 'results'; break; }
  if (w.menu === 'capture') { result = 'captured'; break; }
  const mag = Math.hypot(w.sx, w.sy);
  if (touch) {
    const wantStick = mag > 0.1;
    if (wantStick && !stickOn) {
      stickOn = true; // floating stick: land at the origin first, then drag
      cur.dx = 0;
      cur.dy = 0;
      await sendPoints();
    }
    if (!wantStick) stickOn = false;
    actionOn = w.action;
    cur.dx = wantStick ? (w.sx / mag) * 50 : 0;
    cur.dy = wantStick ? (-w.sy / mag) * 50 : 0;
    await sendPoints();
    if (stickOn && actionOn) simultaneous++;
  } else {
    const want = new Set();
    if (mag > 0.1) {
      const nx = w.sx / mag, ny = w.sy / mag;
      if (nx > 0.38) want.add('KeyD'); if (nx < -0.38) want.add('KeyA');
      if (ny > 0.38) want.add('KeyW'); if (ny < -0.38) want.add('KeyS');
    }
    if (w.action) want.add('KeyE');
    for (const k of held) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  }
  await page.waitForTimeout(40);
}
await page.screenshot({ path: `test-artifacts/input-${mode}-shift${shift}-${result}.png` });
const diag = await page.evaluate(() => window.__lk.game.diag.events().map((e) => e.type).filter((t) => t !== 'loaded'));
console.log(JSON.stringify({ mode, shift, result, seconds: Math.round((Date.now() - t0) / 1000), polls: pollTimes, simultaneousTouchFrames: simultaneous, diag: [...new Set(diag)], errors }));
await browser.close();
