// Multi-touch checks (CDP touch emulation, dev server): stick + action at once, touch cancel,
// focus loss, and resize while held never leave input stuck.
import { chromium } from 'playwright-core';
const base = process.env.LK_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: process.env.LK_BROWSER ?? 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const page = await ctx.newPage();
const results = {};
await page.goto(`${base}?shift=1`);
await page.waitForFunction(() => window.__lk?.game?.state === 'ready');
await page.touchscreen.tap(590, 300);
await page.waitForFunction(() => window.__lk.game.state === 'playing');
await page.evaluate(() => window.__lk.game.tutorial?.skip?.());
const cdp = await ctx.newCDPSession(page);
const btn = await page.evaluate(() => { const r = document.querySelector('.action-btn').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
const st = () => page.evaluate(() => { const g = window.__lk.game; const w = g.world; return { rawStick: +Math.hypot(g.input['touchX'], g.input['touchY']).toFixed(2), rawAction: g.input['touchAction'], mx: +g.input.moveX.toFixed(2), my: +g.input.moveY.toFixed(2), action: g.input.action, px: +w.px.toFixed(2), pz: +w.pz.toFixed(2), repairs: w.repairs, repairing: w.repairing, target: w.target?.kind ?? null, on: w.circuits.on.slice() }; });
// Screen direction for world north (0,-1): sx = r·d, sy = f·d with the camera yaw.
const dir = await page.evaluate(() => { const yaw = (32 * Math.PI) / 180; return { sx: Math.sin(yaw), sy: Math.cos(yaw) }; });
const O = { x: 160, y: 680 };
const stickPt = (k = 50) => ({ x: O.x + dir.sx * k, y: O.y - dir.sy * k, id: 1 });
// 1) Stand under the broken nook lamp and hold the stick pushing north into its wall.
await page.evaluate(() => window.__lk.game.world.debugTeleport(4.5, 7.4));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...O, id: 1 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [stickPt()] });
await page.waitForTimeout(2500);
results.walking = await st();
// 2) Second finger holds REPAIR while the first keeps pushing the stick.
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stickPt(), { ...btn, id: 2 }] });
await page.waitForTimeout(400);
results.duringRepair = await st();
await page.waitForTimeout(3000);
results.afterRepairHold = await st();
// 3) Lift only the action finger: the stick must stay active.
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ ...btn, id: 2 }] });
await page.waitForTimeout(200);
results.actionLifted = await st();
// 4) Touch cancel (e.g. system gesture) releases everything.
await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
await page.waitForTimeout(200);
results.afterCancel = await st();
// 5) Hold both, then lose focus: inputs clear and the pause menu appears.
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...O, id: 3 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...stickPt(), id: 3 }, { ...btn, id: 4 }] });
await page.waitForTimeout(200);
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
await page.waitForTimeout(200);
results.afterBlur = { ...(await st()), menu: await page.evaluate(() => window.__lk.game.menus.current) };
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
// 6) Resume, hold the stick, resize (orientation-like change), release: nothing sticks.
await page.tap('.overlay button.primary');
await page.waitForTimeout(300);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...O, id: 5 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: O.x + 45, y: O.y, id: 5 }] });
await page.waitForTimeout(200);
const heldBeforeResize = await st();
await page.setViewportSize({ width: 820, height: 1180 });
await page.waitForTimeout(400);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
// Software rendering can take a few hundred ms per frame after a resize; let input settle.
await page.waitForTimeout(1200);
results.resize = { heldBeforeResize, afterRelease: await st(), state: await page.evaluate(() => window.__lk.game.state) };
console.log(JSON.stringify(results, null, 1));
await browser.close();
