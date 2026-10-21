// Render the promo video from the real viewer, frame by frame on a virtual clock, and mux it with the
// soundtrack from tools/promo/music.mjs. Needs the site served locally (tools/serve.mjs) and ffmpeg.
// Usage:
//   deno run -A --unsafe-proto tools/promo/record.mjs                 full 60 s video → promo/utsc-digital-twin-promo.mp4
//   deno run -A --unsafe-proto tools/promo/record.mjs --stills 3,12   single frames → promo/stills/
//   add --hq for a constant-quality master, or --encode-only to re-encode frames already rendered
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = join(ROOT, 'tools', 'promo');
const OUT = join(ROOT, 'promo');
const URL_ = process.env.TWIN_URL || 'http://localhost:8642/';
const FPS = 30, SECONDS = 60, W = 1920, H = 1080;
const args = process.argv.slice(2);
const stills = args.includes('--stills') ? args[args.indexOf('--stills') + 1].split(',').map(Number) : null;
const FRAMES = process.env.PROMO_FRAMES || join(OUT, 'frames');
if (args.includes('--encode-only')) { encode(); process.exit(0); } // re-encode frames already on disk

// the page's own clock: requestAnimationFrame and performance.now only advance when we say so
const VIRTUAL_CLOCK = `(() => {
  let vt = 0, id = 0;
  const q = [];
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => { q.push([++id, cb]); return id; };
  window.cancelAnimationFrame = (h) => { const i = q.findIndex((e) => e[0] === h); if (i >= 0) q.splice(i, 1); };
  window.__step = (ms) => { vt += ms; for (const [, cb] of q.splice(0)) { try { cb(vt); } catch (e) { console.error(e); } } };
})();`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'en-CA' });
await ctx.addInitScript(VIRTUAL_CLOCK);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto(URL_);
// pump the virtual clock until the twin has loaded and live weather has arrived
for (let i = 0; i < 2000; i++) {
  const ready = await page.evaluate(() => { window.__step(16); return !!(window.twin && window.twin.frames > 3 && window.twin.state.weather); });
  if (ready) break;
  await page.waitForTimeout(15);
}
await page.addStyleTag({ content: readFileSync(join(HERE, 'overlay.css'), 'utf8') });
await page.addScriptTag({ content: readFileSync(join(HERE, 'director.js'), 'utf8') });
await page.evaluate(() => document.fonts.ready);

if (stills) {
  const dir = join(OUT, 'stills');
  mkdirSync(dir, { recursive: true });
  for (const t of stills) {
    // settle a few frames at that moment so labels and state catch up
    for (let k = 0; k < 3; k++) await page.evaluate((x) => window.__promo.frame(x), t);
    await page.screenshot({ path: join(dir, `t${String(t).replace('.', '_')}.jpg`), type: 'jpeg', quality: 90 });
    console.log('still', t);
  }
  await browser.close();
  process.exit(0);
}

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
const total = FPS * SECONDS, t0 = Date.now();
for (let f = 0; f < total; f++) {
  await page.evaluate((x) => window.__promo.frame(x), f / FPS);
  writeFileSync(join(FRAMES, `${String(f).padStart(5, '0')}.jpg`), await page.screenshot({ type: 'jpeg', quality: 93 }));
  if (f % 150 === 0) console.log(`frame ${f}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
console.log(`frames rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
encode();

// Two-pass H.264 at ~4.5 Mbit/s keeps the file shareable (~35 MB); dense autumn foliage would push a
// constant-quality encode past 150 MB. Pass --hq for a constant-quality master instead.
function encode() {
  const music = join(OUT, 'music.wav'), video = join(OUT, args.includes('--hq') ? 'utsc-digital-twin-promo-hq.mp4' : 'utsc-digital-twin-promo.mp4');
  const FF = process.env.FFMPEG || 'ffmpeg', frames = ['-framerate', String(FPS), '-i', join(FRAMES, '%05d.jpg')];
  const h264 = ['-c:v', 'libx264', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1'];
  const rate = ['-b:v', '4500k', '-maxrate', '6500k', '-bufsize', '9000k', '-passlogfile', join(OUT, 'x264pass')];
  const aac = ['-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', video];
  const run = (a) => { const r = spawnSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', ...a], { stdio: 'inherit' }); if (r.status !== 0) throw new Error('ffmpeg failed'); };
  if (args.includes('--hq')) run([...frames, '-i', music, ...h264, '-crf', '19', ...aac]);
  else {
    run([...frames, ...h264, ...rate, '-pass', '1', '-an', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null']);
    run([...frames, '-i', music, ...h264, ...rate, '-pass', '2', ...aac]);
  }
  console.log(`${video} (${(readFileSync(video).length / 1048576).toFixed(1)} MB)`);
}
