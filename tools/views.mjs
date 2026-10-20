// Render a set of named views to qa/view-*.png (also used for the README preview image).
// Usage: deno run -A --unsafe-proto tools/views.mjs [url]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'qa');
mkdirSync(OUT, { recursive: true });
const URL_ = process.argv[2] || 'http://localhost:8642/';
const VIEWS = [
  // name, minutes after midnight, target [x, yNorth], dist, yaw, pitch, select code
  ['core-day', 14 * 60 + 30, [-40, -170], 520, -0.35, 0.5, null],
  ['valley', 15 * 60 + 30, [60, -620], 900, 0.4, 0.32, null],
  ['north-day', 11 * 60, [-300, 420], 640, -1.9, 0.48, 'AM'],
  ['core-night', 20 * 60 + 30, [-40, -170], 700, -0.35, 0.55, null],
  ['andrews', 16 * 60, [-170, -250], 330, 0.9, 0.42, 'SW'],
];
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(URL_);
await page.waitForFunction(() => window.twin && window.twin.frames > 5, null, { timeout: 60000 });
await page.waitForTimeout(3000);
for (const [name, minutes, [x, y], dist, yaw, pitch, code] of VIEWS) {
  await page.evaluate(([m, x, y, dist, yaw, pitch, code]) => {
    const r = document.querySelector('#timeRange');
    r.value = String(m);
    r.dispatchEvent(new Event('input', { bubbles: true }));
    const { controls, T, data, select } = window.twin;
    if (code) select({ kind: 'campus', info: data.info.findIndex((i) => i.code === code) });
    else select(null);
    controls.flyTo({ target: controls.target.clone().set(x, T.worldY(x, -y), -y), dist, yaw, pitch }, 0.2);
  }, [minutes, x, y, dist, yaw, pitch, code]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `view-${name}.png`) });
  console.log('view', name);
}
await browser.close();
