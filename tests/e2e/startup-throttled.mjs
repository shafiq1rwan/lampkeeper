// Startup under emulated mobile constraints (production build): 4× CPU slowdown and a
// "slow 4G"-like network (1.6 Mbps down, 150 ms RTT). Pass --gzip to serve compressed assets. Emulation on a desktop machine — not a
// substitute for a real midrange phone.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
const GZIP = process.argv.includes('--gzip');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const p = normalize(new URL(req.url, 'http://x').pathname.slice(1) || 'index.html');
  if (p.includes('..')) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(join('dist', p));
    const headers = { 'content-type': types[extname(p)] ?? 'application/octet-stream' };
    if (GZIP) headers['content-encoding'] = 'gzip';
    res.writeHead(200, headers);
    res.end(GZIP ? gzipSync(body) : body);
  }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(5290, r));
const browser = await chromium.launch({ channel: process.env.LK_BROWSER ?? 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const runs = [];
for (let i = 0; i < 3; i++) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const t0 = Date.now();
  await page.goto('http://localhost:5290/', { waitUntil: 'commit' });
  await page.waitForSelector('.overlay.start', { timeout: 120000 });
  const interactive = Date.now() - t0;
  const bytes = await page.evaluate(() => performance.getEntriesByType('resource').reduce((n, e) => n + (e.transferSize || 0), 0) + (performance.getEntriesByType('navigation')[0]?.transferSize ?? 0));
  const fcp = await page.evaluate(() => Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1));
  runs.push({ firstPaintLoadingTextMs: fcp, startScreenMs: interactive, transferredKB: Math.round(bytes / 1024) });
  await ctx.close();
}
await browser.close();
server.close();
console.log(GZIP ? 'gzip' : 'uncompressed', JSON.stringify(runs));
