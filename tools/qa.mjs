// Automated browser checks for the built site: language default, zoom smoothness, interactions,
// views, and screenshots for desktop and phone. Writes qa/report.json and qa/*.png.
// Usage: deno run -A tools/serve.mjs &  then  deno run -A tools/qa.mjs [url]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'qa');
mkdirSync(OUT, { recursive: true });
const URL_ = process.argv[2] || 'http://localhost:8642/';
const report = { url: URL_, when: new Date().toISOString(), checks: [], errors: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`); };

// Installed Chrome renders headless on the real GPU; set CHROME to use another browser binary.
const browser = await chromium.launch({
  executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--ignore-gpu-blocklist'],
});

async function open(ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push(m.text()); });
  page.on('pageerror', (e) => report.errors.push(String(e)));
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => window.twin && window.twin.frames > 5, null, { timeout: 60000 });
  return { ctx, page };
}
const settle = (page, ms = 2800) => page.waitForTimeout(ms);
const setTime = (page, minutes) => page.evaluate((m) => {
  const r = document.querySelector('#timeRange');
  r.value = String(m);
  r.dispatchEvent(new Event('input', { bubbles: true }));
}, minutes);

// ---------------------------------------------------------------- desktop
{
  const { ctx, page } = await open({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const lang = await page.evaluate(() => ({ html: document.documentElement.lang, brand: document.querySelector('.brand h1').textContent, btn: document.querySelector('#langBtn').textContent }));
  check('opens in English even for a Chinese browser', lang.html === 'en' && lang.brand === 'UTSC Digital Twin' && lang.btn === '中文', lang);
  const gl = await page.evaluate(() => {
    const g = window.twin.renderer.getContext();
    const ext = g.getExtension('WEBGL_debug_renderer_info');
    return ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  report.renderer = gl;
  await settle(page, 3500);
  await page.screenshot({ path: join(OUT, 'desktop-live.png') });

  await setTime(page, 13 * 60);
  await settle(page, 600);
  await page.screenshot({ path: join(OUT, 'desktop-day.png') });

  // --- frame rate while orbiting
  const fps = await page.evaluate(() => new Promise((res) => {
    const c = window.twin.controls;
    let n = 0, t0 = performance.now();
    const step = () => {
      c.rotateBy(0.02, 0);
      if (++n < 90) requestAnimationFrame(step); else res(90 / ((performance.now() - t0) / 1000));
    };
    requestAnimationFrame(step);
  }));
  report.fps = Math.round(fps);
  check('frame rate while orbiting (headless)', fps > 20, Math.round(fps));

  // --- zoom smoothness: one wheel notch, sampled every frame
  await page.evaluate(() => window.twin.controls.flyTo({ dist: 900, pitch: 0.75 }, 0.3));
  await settle(page, 900);
  const cx = 900, cy = 420;
  const zoom = await page.evaluate(([x, y]) => new Promise((res) => {
    const { controls, camera, castRay } = window.twin;
    const THREE_V = camera.position.constructor;
    const rect = document.querySelector('#scene').getBoundingClientRect();
    const ndc = { x: ((x - rect.left) / rect.width) * 2 - 1, y: -((y - rect.top) / rect.height) * 2 + 1 };
    const dir = new THREE_V(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const anchor = castRay(camera.position.clone(), dir).point.clone();
    const samples = [];
    const d0 = controls.dist;
    document.querySelector('#scene').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    let n = 0;
    const tick = (now) => {
      const p = anchor.clone().project(camera);
      samples.push({ t: now, dist: controls.dist, px: ((p.x + 1) / 2) * rect.width + rect.left, py: ((1 - p.y) / 2) * rect.height + rect.top });
      if (++n < 60) requestAnimationFrame(tick); else res({ d0, samples });
    };
    requestAnimationFrame(tick);
  }), [cx, cy]);
  const ds = zoom.samples.map((s) => s.dist);
  const steps = ds.slice(1).map((d, i) => Math.abs(Math.log(d / ds[i])));
  const total = Math.abs(Math.log(ds[ds.length - 1] / zoom.d0));
  const biggest = Math.max(...steps);
  const drift = Math.max(...zoom.samples.map((s) => Math.hypot(s.px - cx, s.py - cy)));
  const framesMoving = steps.filter((s) => s > 1e-4).length;
  report.zoom = { d0: zoom.d0, d1: ds[ds.length - 1], total, biggestStepShare: biggest / total, framesMoving, driftPx: drift };
  check('one wheel notch zooms in', ds[ds.length - 1] < zoom.d0 * 0.9, { from: Math.round(zoom.d0), to: Math.round(ds[ds.length - 1]) });
  check('zoom is spread over many frames (no single-frame jump)', framesMoving >= 12 && biggest / total < 0.25, { framesMoving, biggestStepShare: +(biggest / total).toFixed(3) });
  check('point under the cursor stays put while zooming', drift < 3, { driftPx: +drift.toFixed(2) });
  // monotonic easing: every frame moves the same way and steps shrink after the first few
  const mono = ds.slice(1).every((d, i) => d <= ds[i] + 1e-6);
  check('zoom eases monotonically', mono);

  // --- rapid wheel burst (like a fast mouse spin) still stays smooth
  const burst = await page.evaluate(([x, y]) => new Promise((res) => {
    const { controls } = window.twin;
    const out = [];
    let n = 0;
    const tick = () => {
      if (n < 6) document.querySelector('#scene').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      out.push(controls.dist);
      if (++n < 70) requestAnimationFrame(tick); else res(out);
    };
    requestAnimationFrame(tick);
  }), [cx, cy]);
  const bsteps = burst.slice(1).map((d, i) => Math.abs(Math.log(d / burst[i])));
  const btotal = Math.abs(Math.log(burst[burst.length - 1] / burst[0]));
  check('burst of six notches: no frame takes more than 15% of the zoom', Math.max(...bsteps) / btotal < 0.15, { share: +(Math.max(...bsteps) / btotal).toFixed(3), from: Math.round(burst[0]), to: Math.round(burst[burst.length - 1]) });

  // --- select from the directory and fly there
  await page.locator('.dir-item', { hasText: 'Sam Ibrahim Building' }).click();
  await settle(page, 3000);
  const card = await page.evaluate(() => ({ title: document.querySelector('#card h2')?.textContent, hash: location.hash, dist: Math.round(window.twin.controls.dist) }));
  check('directory click opens the card and flies in', card.title === 'Sam Ibrahim Building' && card.hash === '#IA' && card.dist < 800, card);
  await page.screenshot({ path: join(OUT, 'desktop-card.png') });

  // --- click a building in the scene
  const tapped = await page.evaluate(() => {
    const { data, camera } = window.twin;
    const inf = data.info.find((i) => i.code === 'IC');
    const V = camera.position.constructor;
    const p = new V(inf.lp[0], inf.top - 100 - 3, -inf.lp[1]).project(camera);
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
  });
  await page.evaluate(() => window.twin.controls.flyTo({ target: window.twin.controls.target.clone().set(-260, 35, -470), dist: 650, pitch: 0.9 }, 0.4));
  await settle(page, 1200);
  const icPt = await page.evaluate(() => {
    const { data, camera } = window.twin;
    const inf = data.info.find((i) => i.code === 'IC');
    const V = camera.position.constructor;
    const p = new V(inf.lp[0], inf.top - 100 - 4, -inf.lp[1]).project(camera);
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
  });
  void tapped;
  await page.mouse.click(icPt.x, icPt.y + 8);
  await settle(page, 500);
  const picked = await page.evaluate(() => document.querySelector('#card h2')?.textContent);
  check('clicking a building in 3D selects it', picked === 'Instructional Centre', { picked, at: icPt });

  // --- language switch
  await page.click('#langBtn');
  await settle(page, 400);
  const zh = await page.evaluate(() => ({ html: document.documentElement.lang, brand: document.querySelector('.brand h1').textContent, card: document.querySelector('#card h2')?.textContent, btn: document.querySelector('#langBtn').textContent, mode: document.querySelector('[data-mode="func"]').textContent }));
  check('switches to Chinese', zh.html === 'zh-CN' && zh.brand === 'UTSC 数字孪生' && zh.card === '教学中心' && zh.btn === 'EN' && zh.mode === '功能', zh);
  await page.screenshot({ path: join(OUT, 'desktop-zh.png') });
  await page.click('#langBtn');
  await settle(page, 300);
  const en = await page.evaluate(() => document.querySelector('.brand h1').textContent);
  check('switches back to English', en === 'UTSC Digital Twin', en);

  // --- views
  await page.evaluate(() => { window.twin.select(null); window.twin.controls.flyTo({ target: window.twin.controls.target.clone().set(-60, 32, 40), dist: 1900, pitch: 0.7, yaw: -0.62 }, 0.4); });
  await settle(page, 1200);
  for (const mode of ['func', 'height', 'age']) {
    await page.click(`[data-mode="${mode}"]`);
    await settle(page, 500);
    await page.screenshot({ path: join(OUT, `desktop-${mode}.png`) });
  }
  await page.click('[data-mode="real"]');
  await page.evaluate(() => window.twin.setYear(1995));
  await settle(page, 600);
  await page.screenshot({ path: join(OUT, 'desktop-1995.png') });
  const hidden1995 = await page.evaluate(() => {
    const { data, B } = window.twin;
    const ic = data.info.findIndex((i) => i.code === 'IC');
    const rec = B.recs.find((r) => r.info === ic);
    const mid = [(rec.bbox[0] + rec.bbox[2]) / 2, (rec.bbox[1] + rec.bbox[3]) / 2];
    return B.at(mid[0], rec.zb + 6, -mid[1]) === -1;
  });
  check('timeline 1995 hides the 2011 Instructional Centre', hidden1995);
  await page.evaluate(() => window.twin.setYear(2026));
  await setTime(page, 21 * 60);
  await settle(page, 600);
  await page.screenshot({ path: join(OUT, 'desktop-night.png') });
  await ctx.close();
}

// ---------------------------------------------------------------- phone
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' });
  await settle(page, 3500);
  await setTime(page, 14 * 60);
  await settle(page, 600);
  await page.screenshot({ path: join(OUT, 'phone-home.png') });
  await page.click('#dirToggle');
  await settle(page, 300);
  await page.screenshot({ path: join(OUT, 'phone-directory.png') });
  await page.locator('.dir-item', { hasText: 'Harmony Commons' }).click();
  await settle(page, 3000);
  await page.screenshot({ path: join(OUT, 'phone-card.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth);
  check('phone layout has no horizontal overflow', !overflow);
  await page.click('[data-tab="sun"]');
  await settle(page, 300);
  await page.screenshot({ path: join(OUT, 'phone-sun.png') });
  await ctx.close();
}

await browser.close();
check('no console errors', report.errors.length === 0, report.errors.slice(0, 5));
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const failed = report.checks.filter((c) => !c.ok).length;
console.log(`\n${report.checks.length - failed}/${report.checks.length} checks passed · renderer: ${report.renderer} · fps ${report.fps}`);
process.exit(failed ? 1 : 0);
