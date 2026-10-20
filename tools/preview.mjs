// Render preview.png for the README: the whole campus in afternoon light, directory folded away.
// Usage: deno run -A --unsafe-proto tools/preview.mjs [url]
import { chromium } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
await page.goto(process.argv[2] || 'http://localhost:8642/');
await page.waitForFunction(() => window.twin && window.twin.frames > 5, null, { timeout: 60000 });
await page.waitForTimeout(3200);
await page.evaluate(() => {
  const r = document.querySelector('#timeRange');
  r.value = String(15 * 60);
  r.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#dirToggle').click();
  const { controls, T } = window.twin;
  controls.flyTo({ target: controls.target.clone().set(-80, T.worldY(-80, 60), 60), dist: 1650, yaw: -0.5, pitch: 0.6 }, 0.2);
});
await page.waitForTimeout(1800);
await page.screenshot({ path: join(ROOT, 'preview.png') });
await browser.close();
console.log('preview.png');
