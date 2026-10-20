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

  // with a card open, the walking bar must still be clickable
  const barFree = await page.evaluate(() => ['#wbPick', '#wbLoc', '#wbIso'].every((sel) => {
    const b = document.querySelector(sel).getBoundingClientRect();
    return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest(sel);
  }));
  check('walking bar buttons stay clickable with a card open', barFree);

  // --- click a building in the scene (card closed, so the card cannot be in the way)
  await page.evaluate(() => window.twin.select(null));
  await page.evaluate(() => window.twin.controls.flyTo({ target: window.twin.controls.target.clone().set(-260, 35, -470), dist: 650, pitch: 0.9 }, 0.4));
  await settle(page, 1200);
  const icPt = await page.evaluate(() => {
    const { data, camera } = window.twin;
    const inf = data.info.find((i) => i.code === 'IC');
    const V = camera.position.constructor;
    const p = new V(inf.lp[0], inf.top - 100 - 4, -inf.lp[1]).project(camera);
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
  });
  await page.mouse.click(icPt.x, icPt.y + 8);
  await settle(page, 500);
  const picked = await page.evaluate(() => document.querySelector('#card h2')?.textContent);
  check('clicking a building in 3D selects it', picked === 'Instructional Centre', { picked, at: icPt });

  // --- walking times
  const walkInfo = await page.evaluate(() => {
    const { data, net, walkTo, setStart, state, B } = window.twin;
    const out = {};
    const recOf = (code) => B.recs.find((r) => r.info === data.info.findIndex((i) => i.code === code));
    const r = state.walk.route;
    out.cardWalk = document.querySelector('#card .walk-block .wk-main')?.textContent.trim();
    out.pinEnd = !document.querySelector('#pinEnd').hidden && document.querySelector('#pinEndTime').textContent;
    // the drawn route is one continuous line
    let gap = 0;
    for (let i = 1; i < r.pts.length; i++) gap = Math.max(gap, Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
    out.maxGap = gap;
    out.routeLen = r.pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - r.pts[i - 1][0], p[1] - r.pts[i - 1][1]) : 0), 0);
    out.routeDist = r.dist;
    out.netDist = r.dist - state.walk.start.leg - r.endLeg;
    // bus loop → IC, and into the valley and back out
    const ic = walkTo({ outer: recOf('IC').outer });
    out.busToIC = ic.time / 60;
    const ml = recOf('ML');
    out.busToML = walkTo({ outer: ml.outer }).time / 60;
    const start = { ...state.walk.start };
    setStart({ outer: ml.outer }, { en: 'Miller Lash House' });
    out.mlToBus = walkTo({ x: data.walkStart.x, y: data.walkStart.y }).time / 60;
    setStart({ x: start.x, y: start.y }, start.name);
    out.flatCheck = Math.round(net.edges.length);
    return out;
  });
  report.walk = walkInfo;
  check('a clicked building shows the walk in its card and on the map', /min/.test(walkInfo.cardWalk || '') && /min/.test(walkInfo.pinEnd || ''), { card: walkInfo.cardWalk, pin: walkInfo.pinEnd });
  check('the drawn route matches the computed walking distance', Math.abs(walkInfo.routeLen - walkInfo.netDist) < 1, { drawnM: Math.round(walkInfo.routeLen), networkM: Math.round(walkInfo.netDist) });
  check('bus loop → Instructional Centre takes a few minutes', walkInfo.busToIC > 2 && walkInfo.busToIC < 12, +walkInfo.busToIC.toFixed(1));
  check('climbing out of the valley takes longer than walking down', walkInfo.mlToBus > walkInfo.busToML, { down: +walkInfo.busToML.toFixed(1), up: +walkInfo.mlToBus.toFixed(1) });
  // click open ground: a route card and a time bubble
  await page.evaluate(() => window.twin.controls.flyTo({ target: window.twin.controls.target.clone().set(-60, 30, 120), dist: 700, pitch: 0.95, yaw: -0.4 }, 0.3));
  await settle(page, 900);
  let groundSpot = null;
  for (const [fx, fy] of [[0.55, 0.45], [0.62, 0.38], [0.48, 0.58], [0.66, 0.6], [0.4, 0.4]]) {
    const hit = await page.evaluate(([fx, fy]) => {
      const h = window.twin.castRay(window.twin.camera.position.clone(), new (window.twin.camera.position.constructor)(fx * 2 - 1, -(fy * 2 - 1), 0.5).unproject(window.twin.camera).sub(window.twin.camera.position).normalize());
      return h && !h.rec;
    }, [fx, fy]);
    if (hit) { groundSpot = [1440 * fx, 900 * fy]; break; }
  }
  await page.mouse.click(...groundSpot);
  await settle(page, 500);
  const pointCard = await page.evaluate(() => ({ chip: document.querySelector('#card .chip.walk')?.textContent, title: document.querySelector('#card h2')?.textContent, walk: document.querySelector('#card .wk-main')?.textContent.trim() }));
  check('clicking open ground shows the walking time there', pointCard.chip === 'Walking route' && /min/.test(pointCard.walk || ''), pointCard);
  await page.screenshot({ path: join(OUT, 'desktop-walk.png') });
  // hover shows the time without clicking
  await page.mouse.move(groundSpot[0] + 60, groundSpot[1] - 40);
  await settle(page, 400);
  const tipText = await page.evaluate(() => (document.querySelector('#tip').hidden ? '' : document.querySelector('#tip').textContent));
  check('hovering shows the walking time', /🚶/.test(tipText), tipText);
  // choose a new start on the map, then the walk-time map
  await page.click('#wbPick');
  await page.mouse.click(groundSpot[0] - 120, groundSpot[1] + 60);
  await settle(page, 400);
  const from = await page.evaluate(() => document.querySelector('#wbFrom').textContent);
  check('the start can be moved by clicking the map', from === 'Walking from your pin', from);
  await page.click('#wbIso');
  await settle(page, 600);
  await page.screenshot({ path: join(OUT, 'desktop-isochrones.png') });
  const isoOn = await page.evaluate(() => window.twin.state.walk.iso);
  check('the walk-time map turns on', isoOn);
  await page.click('#wbIso');
  await page.evaluate(() => { const { setStart, data } = window.twin; setStart({ x: data.walkStart.x, y: data.walkStart.y }, { en: data.walkStart.en, zh: data.walkStart.zh }); });

  // --- language switch (with the Instructional Centre card open again)
  await page.evaluate(() => { const { data, select } = window.twin; select({ kind: 'campus', info: data.info.findIndex((i) => i.code === 'IC') }); });
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
  const bar = await page.evaluate(() => {
    const b = document.querySelector('#walkbar').getBoundingClientRect(), f = document.querySelector('#wbFrom').getBoundingClientRect();
    return { right: Math.round(b.right), vw: innerWidth, fromW: Math.round(f.width), walk: document.querySelector('#card .wk-main')?.textContent.trim() };
  });
  check('phone: walking bar fits on screen with a card open, and the card shows the walk', bar.right <= bar.vw && bar.fromW > 60 && /min/.test(bar.walk || ''), bar);
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
