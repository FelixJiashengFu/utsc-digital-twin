// UTSC digital twin: loads the processed campus data, builds the scene and wires up the interface.
import * as THREE from 'three';
import { DATUM, Terrain, buildTerrainMeshes, paintGround, buildRoads, buildWater, buildBuildings, buildTrees, buildOutline, buildStreetLights } from './world.js';
import { TwinControls } from './controls.js';
import { SkySystem, sunPosition, sunTimes } from './sky.js';
import { LabelLayer } from './labels.js';
import { STR, fmt } from './i18n.js';
import { WalkNet, walkSeconds, ribbon, buildIsoMesh, ISO_RAMP, STEPS, INDOOR } from './walk.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TZ = 'America/Toronto';
const LAT = 43.7845, LON = -79.187;

// ---------------------------------------------------------------- state
const params = new URLSearchParams(location.search);
const state = {
  lang: params.get('lang') === 'zh' ? 'zh' : 'en', // the page always opens in English
  mode: 'real',
  layers: { trees: true, labels: true, pois: true, context: true, shadows: true },
  live: true,
  day: null,        // {y, m, d} in Toronto
  minutes: 0,       // minutes after midnight, Toronto
  year: 2026,
  timeline: false,
  playing: false,
  sel: null,        // {kind: 'campus', info} | {kind: 'ctx', rec} | {kind: 'point', x, y}
  hoverKey: -1,
  weather: null,
  tour: null,
  // walking: start {x, y, name, leg}, shortest-time tree from it, destination and its route
  walk: { start: null, tree: null, dest: null, route: null, pick: false, iso: false },
};
const touch = matchMedia('(pointer: coarse)').matches;
const small = Math.min(innerWidth, innerHeight) < 720;
const weak = (navigator.deviceMemory || 8) <= 4 || (touch && small);
// layout follows the same breakpoint as styles.css, so a phone turned sideways gets the wide layout
const narrow = () => matchMedia('(max-width: 760px)').matches;
const Q = weak ? { tex: 0.62, shadow: 2048, trees: 0.55, dpr: 1.5 } : { tex: 1.25, shadow: 4096, trees: 1, dpr: 2 };
const t = (k, vars) => fmt(STR[state.lang][k] ?? STR.en[k] ?? k, vars);
const S = () => STR[state.lang];

// ---------------------------------------------------------------- time helpers (Toronto local)
function torontoParts(ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms));
  const g = (k) => +parts.find((p) => p.type === k).value;
  return { y: g('year'), m: g('month') - 1, d: g('day'), h: g('hour') % 24, mi: g('minute'), s: g('second') };
}
function torontoToUTC(y, m, d, minutes) {
  let guess = Date.UTC(y, m, d, 0, minutes);
  for (let i = 0; i < 2; i++) {
    const p = torontoParts(guess);
    const asUTC = Date.UTC(p.y, p.m, p.d, p.h, p.mi, p.s);
    guess += Date.UTC(y, m, d, 0, minutes) - asUTC;
  }
  return guess;
}
const dayOfYear = ({ y, m, d }) => Math.round((Date.UTC(y, m, d) - Date.UTC(y, 0, 1)) / 864e5) + 1;
const simMs = () => torontoToUTC(state.day.y, state.day.m, state.day.d, state.minutes);
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
function syncNow() {
  const p = torontoParts(Date.now());
  state.day = { y: p.y, m: p.m, d: p.d };
  state.minutes = p.h * 60 + p.mi;
}

// ---------------------------------------------------------------- loading
const loadEl = $('#loading');
const loadMsg = (k, vars) => { $('#loadMsg').textContent = t(k, vars); };
async function fetchOk(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}
async function loadTerrain(spec) {
  let bytes = new Uint8Array(await (await fetchOk('data/' + spec.file)).arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const d = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const h = new Float32Array(spec.nx * spec.ny);
  for (let j = 0; j < spec.ny; j++) {
    let v = 0;
    for (let i = 0; i < spec.nx; i++) {
      const k = j * spec.nx + i;
      v = i === 0 ? d[k] : v + d[k];
      h[k] = spec.base + v * spec.unit;
    }
  }
  return h;
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------------------------------------------------------------- main
let data, T, B, trees, roads, water, lamps, outline, controls, sky, labels, renderer, scene, camera, terrainMat, groundTex;
let net, iso, routeGroup = null, routeWidth = 0;
let needsRender = true;
const canvas = $('#scene');
const tiltBtn = $('#tiltBtn');

async function main() {
  applyLang();
  syncNow();
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    loadEl.classList.add('error');
    $('#loadMsg').textContent = t('noWebgl');
    return;
  }
  loadMsg('loading');
  data = await (await fetchOk('data/campus.json')).json();
  loadMsg('loadTerrain');
  const heights = await loadTerrain(data.terrain);
  T = new Terrain(data.terrain, heights, data.bounds);

  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.dpr));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc4dbef, 4000, 14000);
  camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 20000);

  loadMsg('loadGround');
  await nextFrame();
  const maxTex = renderer.capabilities.maxTextureSize;
  const [X0, Y0, X1, Y1] = data.bounds;
  const scale = Math.min(Q.tex, maxTex / (Y1 - Y0), maxTex / (X1 - X0));
  groundTex = new THREE.CanvasTexture(paintGround(data, scale, dayOfYear(state.day)));
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  terrainMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.97, metalness: 0 });
  const sideMat = new THREE.MeshStandardMaterial({ map: strataTexture(), roughness: 1, metalness: 0 });
  scene.add(buildTerrainMeshes(T, terrainMat, sideMat));
  roads = buildRoads(data, T);
  water = buildWater(data, T);
  scene.add(roads, water);

  loadMsg('loadBuildings', { n: data.buildings.length.toLocaleString() });
  await nextFrame();
  B = buildBuildings(data, T);
  scene.add(B.group);

  loadMsg('loadTrees');
  await nextFrame();
  trees = buildTrees(data, T, Q.trees);
  trees.setSeason(dayOfYear(state.day));
  scene.add(trees.group);
  lamps = buildStreetLights(data, T);
  scene.add(lamps.group);
  net = new WalkNet(data, T);
  iso = buildIsoMesh(net, T);
  scene.add(iso.mesh);

  sky = new SkySystem(scene, renderer, Q);
  setupControls();
  setupLabels();
  setupUI();
  setupWalk();
  updateSun();
  fetchWeather();
  setInterval(tick, 20000);
  addEventListener('resize', onResize);
  onResize();

  // open on the whole campus, easing in from further out
  controls.target.set(-60, T.worldY(-60, 40), 40);
  controls.dist = 4300; controls.yaw = -0.62; controls.pitch = 0.95;
  controls.apply();
  controls.flyTo(homeView(), 2.4);
  requestAnimationFrame(frame);
  // handle for debugging from the console and for the automated browser checks in tools/qa.mjs
  window.twin = { state, controls, data, B, T, camera, renderer, scene, select, setYear, applyMode, castRay, net, setStart, walkTo, frames: 0 };
  loadEl.classList.add('done');
  setTimeout(() => loadEl.remove(), 900);
  if (location.hash.length > 1) selectByCode(decodeURIComponent(location.hash.slice(1)), true);
}

function homeView() {
  return { target: new THREE.Vector3(-60, T.worldY(-60, 40), 40), dist: 2350, yaw: -0.62, pitch: 0.66 };
}

function strataTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const bands = [['#6f5a43', 0], ['#7d664b', 0.18], ['#6a5540', 0.3], ['#8a7457', 0.46], ['#5f4c3a', 0.62], ['#76644f', 0.8], ['#4f4033', 1]];
  const grad = g.createLinearGradient(0, 256, 0, 0);
  for (const [col, at] of bands) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------- picking: march along the ray
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
function castRay(origin, dir, wantBuilding = true) {
  const o = _o.copy(origin), d = _d.copy(dir).normalize();
  const [X0, Y0, X1, Y1] = data.bounds;
  const top = Math.max(B.maxTop, T.max - DATUM) + 2, bottom = T.min - DATUM - 2;
  // clip the ray to the model's box
  let t0 = 0, t1 = 1e6;
  for (const [oc, dc, lo, hi] of [[o.x, d.x, X0, X1], [o.y, d.y, bottom, top], [o.z, d.z, -Y1, -Y0]]) {
    if (Math.abs(dc) < 1e-9) { if (oc < lo || oc > hi) return null; continue; }
    let a = (lo - oc) / dc, b = (hi - oc) / dc;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  if (t0 > t1) return null;
  const at = (s) => [o.x + d.x * s, o.y + d.y * s, o.z + d.z * s];
  const test = (s) => {
    const [x, y, z] = at(s);
    if (y <= T.worldY(x, z)) return { kind: 'ground' };
    if (wantBuilding) { const i = B.at(x, y, z); if (i >= 0) return { kind: 'building', i }; }
    return null;
  };
  let prev = t0, s = t0;
  while (s <= t1) {
    const hit = test(s);
    if (hit) {
      let a = prev, b = s;
      for (let k = 0; k < 14; k++) {
        const m = (a + b) / 2;
        const h2 = test(m);
        if (h2 && (h2.kind === hit.kind && (hit.kind === 'ground' || h2.i === hit.i))) b = m; else a = m;
      }
      const [x, y, z] = at(b);
      return { point: new THREE.Vector3(x, y, z), rec: hit.kind === 'building' ? B.recs[hit.i] : null };
    }
    prev = s;
    s += Math.max(0.3, s * 0.0028);
  }
  return null;
}
const ray = new THREE.Raycaster();
function pickAt(cx, cy) {
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
  return castRay(ray.ray.origin, ray.ray.direction);
}

// ---------------------------------------------------------------- controls
function setupControls() {
  const [X0, Y0, X1, Y1] = data.bounds;
  controls = new TwinControls(camera, canvas, {
    cast: (o, d) => castRay(o, d),
    groundY: (x, z) => T.worldY(x, z),
    bounds: { minX: X0, maxX: X1, minZ: -Y1, maxZ: -Y0 },
  });
  controls.on('start', () => { stopTour(false); hideTip(); });
  controls.on('tap', (cx, cy) => {
    const hit = pickAt(cx, cy);
    if (state.walk.pick) {
      state.walk.pick = false;
      if (hit) setStart(hit.rec ? { outer: mainRec(hit.rec).outer } : { x: hit.point.x, y: -hit.point.z }, hit.rec ? recName(hit.rec) : { key: 'walkPinned' });
      renderWalkbar();
      return;
    }
    // any spot on the map: buildings open their card, open ground gets a route card; both show the walk there
    if (hit && hit.rec) select(hit.rec.info >= 0 ? { kind: 'campus', info: hit.rec.info } : { kind: 'ctx', rec: hit.rec });
    else if (hit) select({ kind: 'point', x: hit.point.x, y: -hit.point.z });
    else select(null);
  });
  let hoverXY = null;
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || controls.mode) { hideTip(); return; }
    hoverXY = [e.clientX, e.clientY];
    requestHover();
  });
  canvas.addEventListener('pointerleave', () => { hoverXY = null; setHover(-1); hideTip(); });
  let hoverQueued = false;
  function requestHover() {
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      if (!hoverXY || controls.mode) return;
      const hit = pickAt(...hoverXY);
      const rec = hit && hit.rec;
      setHover(rec ? rec.key : -1);
      if (hit) showTip(rec, ...hoverXY, hoverWalk(hit)); else hideTip();
    });
  }
}
function setHover(key) {
  if (key === state.hoverKey) return;
  state.hoverKey = key;
  B.uniforms.uHover.value = key;
  canvas.style.cursor = key >= 0 ? 'pointer' : '';
  needsRender = true;
}

// ---------------------------------------------------------------- labels
function infoName(inf, lang = state.lang) { return (lang === 'zh' && inf.zh) || inf.en || ''; }
function setupLabels() {
  labels = new LabelLayer($('#labels'));
  // labels sit over the canvas; scrolling over one should still zoom the map
  $('#labels').addEventListener('wheel', (e) => controls._wheel(e), { passive: false });
  data.info.forEach((inf, i) => {
    const name = inf.en;
    if (!name || name === 'Shelter') return;
    const big = inf.area > 1500 || inf.isNew;
    const tiny = inf.area < 220;
    labels.add({
      kind: 'building', anchor: 'bottom',
      pos: new THREE.Vector3(inf.lp[0], inf.top - DATUM + 3, -inf.lp[1]),
      pri: 1000 + Math.sqrt(inf.area) + (inf.isNew ? 120 : 0) + (inf.code && inf.code.length === 2 ? 60 : 0),
      maxD: big ? 2900 : tiny ? 420 : 1100,
      visible: () => !(state.timeline && inf.year && inf.year > state.year + 0.2),
      onClick: () => select({ kind: 'campus', info: i }, true),
      html: (lang) => {
        const c = data.categories[inf.cat] || { color: '#888' };
        const code = inf.code ? `<b class="code" style="--c:${c.color}">${esc(inf.code)}</b>` : `<i class="dot" style="--c:${c.color}"></i>`;
        return `${code}<span class="nm">${esc(infoName(inf, lang))}</span>${inf.isNew ? `<em class="new">${esc(STR[lang].newBadge)}</em>` : ''}`;
      },
    });
  });
  for (const L of data.labels) {
    const h = T.height(L.x, L.y) - DATUM + (L.t === 'road' ? 2 : 4);
    const big = L.s > 300, mid = L.s > 110;
    labels.add({
      kind: L.t === 'road' ? 'road' : L.t === 'water' ? 'water' : 'area', anchor: 'center',
      pos: new THREE.Vector3(L.x, h, -L.y),
      pri: L.t === 'road' ? 300 + L.s / 20 : 200 + L.s / 3,
      maxD: L.t === 'road' ? (['motorway', 'primary', 'secondary'].includes(L.c) ? 2400 : L.c === 'service' ? 520 : 1200) : L.t === 'water' ? 2600 : big ? 3200 : mid ? 1500 : 650,
      minD: L.t === 'parking' ? 0 : 0,
      html: (lang) => esc((lang === 'zh' && L.zh) || L.en),
    });
  }
  for (const p of data.pois) {
    labels.add({
      kind: 'poi', anchor: 'bottom',
      pos: new THREE.Vector3(p.x, p.h - DATUM + 2.5, -p.y),
      pri: p.t === 'bus' ? 500 : 80,
      maxD: p.t === 'bus' ? 1300 : 480,
      html: (lang) => `<i class="pi pi-${p.t}"></i><span class="nm">${esc(p.n || STR[lang].poi[p.t] || '')}</span>`,
    });
  }
  labels.setLang(state.lang);
}

// ---------------------------------------------------------------- selection and info card
function recsOf(infoIdx) { return B.recs.filter((r) => r.info === infoIdx); }
function viewFor(inf) {
  const g = inf.ground - DATUM;
  const h = inf.top - inf.ground;
  return {
    target: new THREE.Vector3(inf.lp[0], g + h * 0.35, -inf.lp[1]),
    dist: clamp(Math.sqrt(inf.area) * 3.4 + h * 3.2, 120, 700),
    pitch: 0.6,
    yaw: controls.yaw,
  };
}
function select(sel, fly = false) {
  state.sel = sel;
  const key = !sel || sel.kind === 'point' ? -1 : sel.kind === 'campus' ? 100000 + sel.info : sel.rec.key;
  B.uniforms.uSel.value = key;
  if (outline) { scene.remove(outline); outline.children[0].geometry.dispose(); outline = null; }
  if (sel && sel.kind !== 'point') { outline = buildOutline(sel.kind === 'campus' ? recsOf(sel.info) : [sel.rec], T); scene.add(outline); }
  // the walk from the current start to whatever was picked
  if (!sel) setDest(null);
  else if (sel.kind === 'point') setDest({ x: sel.x, y: sel.y });
  else setDest({ outer: mainRec(sel.kind === 'campus' ? recsOf(sel.info)[0] : sel.rec).outer });
  renderCard();
  if (sel && sel.kind === 'campus') {
    const inf = data.info[sel.info];
    history.replaceState(null, '', inf.code ? '#' + encodeURIComponent(inf.code) : location.pathname + location.search);
    if (fly) controls.flyTo(viewFor(inf));
  } else history.replaceState(null, '', location.pathname + location.search);
  $$('.dir-item').forEach((el) => el.classList.toggle('active', sel && sel.kind === 'campus' && +el.dataset.i === sel.info));
  needsRender = true;
}
function selectByCode(code, fly) {
  const i = data.info.findIndex((inf) => inf.code && inf.code.toLowerCase() === code.toLowerCase());
  if (i >= 0) select({ kind: 'campus', info: i }, fly);
}

function renderCard() {
  const card = $('#card');
  const sel = state.sel;
  if (!sel) { card.hidden = true; document.body.classList.remove('has-card'); return; }
  card.hidden = false;
  document.body.classList.add('has-card');
  const s = S();
  let html;
  if (sel.kind === 'campus') {
    const inf = data.info[sel.info];
    const cat = data.categories[inf.cat] || { en: '', zh: '', color: '#888' };
    const other = state.lang === 'zh' ? inf.en : inf.zh;
    const facts = [];
    if (inf.when && inf.when[state.lang]) facts.push([s.opened, esc(inf.when[state.lang])]);
    if (inf.levels) facts.push([s.floors, String(inf.levels)]);
    facts.push([s.height, `${(inf.top - inf.ground).toFixed(inf.hs === 'official' ? 1 : 0)} m <span class="src src-${inf.hs}">${esc(s.hs[inf.hs] || '')}</span>`]);
    facts.push([s.footprint, fmt(s.area, { a: inf.area.toLocaleString() })]);
    facts.push([s.ground, fmt(s.asl, { m: inf.ground.toFixed(0) })]);
    if (inf.arch) facts.push([s.architects, esc(inf.arch)]);
    if (inf.group) facts.push([s.partOf, esc(inf.group[state.lang] || inf.group.en)]);
    if (inf.addr) facts.push([s.address, esc(inf.addr)]);
    const links = [];
    if (inf.wikipedia) {
      const [lang, title] = inf.wikipedia.split(':');
      links.push(`<a href="https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}" target="_blank" rel="noopener">${s.links.wikipedia}</a>`);
    }
    if (inf.wikidata) links.push(`<a href="https://www.wikidata.org/wiki/${encodeURIComponent(inf.wikidata)}" target="_blank" rel="noopener">${s.links.wikidata}</a>`);
    links.push(`<a href="https://www.openstreetmap.org/${inf.osmType}/${inf.osmId}" target="_blank" rel="noopener">${s.links.osm}</a>`);
    html = `
      <div class="card-head">
        <div class="chips">
          ${inf.code ? `<span class="chip code" style="--c:${cat.color}">${esc(inf.code)}</span>` : ''}
          <span class="chip cat" style="--c:${cat.color}">${esc(cat[state.lang])}</span>
          ${inf.isNew ? `<span class="chip new">${esc(s.newBadge)}</span>` : ''}
        </div>
        <button class="icon-btn card-close" type="button" aria-label="${esc(s.close)}" title="${esc(s.close)}">×</button>
      </div>
      <h2>${esc(infoName(inf))}</h2>
      ${other && other !== infoName(inf) ? `<p class="alt" lang="${state.lang === 'zh' ? 'en' : 'zh-CN'}">${esc(other)}</p>` : ''}
      ${walkBlock()}
      ${inf.status ? `<p class="status">${esc(inf.status[state.lang])}</p>` : ''}
      <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      ${inf.desc ? `<p class="desc">${esc(inf.desc[state.lang])}</p>` : ''}
      <div class="card-foot"><button class="btn primary card-fly" type="button">${esc(s.fly)}</button><span class="links">${links.join('')}</span></div>`;
  } else if (sel.kind === 'ctx') {
    const rec = sel.rec, b = data.buildings[rec.bi];
    const type = data.ctx[b.k] ? data.ctx[b.k].en : 'other';
    const facts = [];
    if (b.l) facts.push([s.floors, String(b.l)]);
    facts.push([s.height, fmt(s.approxHeight, { h: (rec.zt - rec.zb - 0.6).toFixed(0) })]);
    html = `
      <div class="card-head"><div class="chips"><span class="chip ctx">${esc(s.ctxTitle)}</span></div>
        <button class="icon-btn card-close" type="button" aria-label="${esc(s.close)}" title="${esc(s.close)}">×</button></div>
      <h2>${esc(b.n || s.ctx[type] || s.ctx.other)}</h2>
      ${b.n ? `<p class="alt">${esc(s.ctx[type] || '')}</p>` : ''}
      ${walkBlock()}
      <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
  } else {
    const ground = T.height(sel.x, sel.y);
    html = `
      <div class="card-head"><div class="chips"><span class="chip walk">${esc(s.walkRoute)}</span></div>
        <button class="icon-btn card-close" type="button" aria-label="${esc(s.close)}" title="${esc(s.close)}">×</button></div>
      <h2>${esc(placeName(sel.x, sel.y))}</h2>
      <p class="alt">${esc(fmt(s.asl, { m: ground.toFixed(0) }))}</p>
      ${walkBlock()}`;
  }
  card.innerHTML = html;
  $('.card-close', card).addEventListener('click', () => select(null));
  const here = $('.wk-here', card);
  if (here) here.addEventListener('click', walkFromHere);
  const fly = $('.card-fly', card);
  if (fly) fly.addEventListener('click', () => controls.flyTo(viewFor(data.info[state.sel.info])));
}

// ---------------------------------------------------------------- tooltip
const tip = () => $('#tip');
function showTip(rec, x, y, w) {
  const s = S();
  let html = '';
  if (rec && rec.info >= 0) {
    const inf = data.info[rec.info];
    const cat = data.categories[inf.cat];
    html = `${inf.code ? `<b style="--c:${cat ? cat.color : '#888'}">${esc(inf.code)}</b>` : ''}${esc(infoName(inf) || s.ctx.other)}`;
  } else if (rec) {
    const b = data.buildings[rec.bi];
    const type = data.ctx[b.k] ? data.ctx[b.k].en : 'other';
    html = esc(b.n || s.ctx[type] || s.ctx.other);
  }
  if (w) html += `<span class="tip-walk">🚶 ${esc(fmtDur(w.time))} · ${esc(fmtDist(w.dist))}</span>`;
  if (!html) { hideTip(); return; }
  const el = tip();
  el.innerHTML = html;
  el.hidden = false;
  el.style.transform = `translate(${x + 14}px, ${y + 16}px)`;
}
function hideTip() { const el = tip(); if (el) el.hidden = true; }

// ---------------------------------------------------------------- walking times
// One shortest-time tree from the start answers "how long to walk there?" for any spot instantly;
// the route itself is drawn only for the spot that was clicked.
const OFF_PATH = 1.2; // the stretch between a clicked spot and the nearest path is slower than a path
const walk = state.walk;
let walkVersion = 0;
const hoverCache = new Map();

function mainRec(rec) { return rec.info >= 0 ? recsOf(rec.info)[0] : rec; }
function recName(rec) {
  if (rec.info >= 0) { const inf = data.info[rec.info]; return { en: inf.en, zh: inf.zh || inf.en }; }
  const b = data.buildings[rec.bi], type = data.ctx[b.k] ? data.ctx[b.k].en : 'other';
  return { en: b.n || STR.en.ctx[type], zh: b.n || STR.zh.ctx[type] };
}
const nameText = (n) => (!n ? '' : n.key ? S()[n.key] : (state.lang === 'zh' && n.zh) || n.en);
function fmtDur(sec) {
  const s = S(), m = Math.round(sec / 60);
  if (sec < 40) return s.durLess;
  if (m < 60) return fmt(s.durMin, { m: Math.max(1, m) });
  return fmt(s.durHour, { h: Math.floor(m / 60), m: m % 60 });
}
const fmtDist = (d) => (d < 1000 ? `${Math.max(10, Math.round(d / 10) * 10)} m` : `${(d / 1000).toFixed(1)} km`);
// a friendly name for a spot on open ground: the nearest named place within 150 m
function placeName(x, y) {
  let best = null, bd = 150;
  for (const L of data.labels) {
    if (L.t === 'road') continue;
    const d = Math.hypot(L.x - x, L.y - y);
    if (d < bd) { bd = d; best = L; }
  }
  return best ? fmt(S().walkNear, { p: (state.lang === 'zh' && best.zh) || best.en }) : S().walkPoint;
}
// snap a target ({x, y} or a building {outer}) onto the path network
function snapTarget(tg) {
  if (tg.outer) {
    const p = net.snapFootprint(tg.outer);
    if (p) return { p, x: p.fx, y: p.fy };
  }
  const p = net.snap(tg.x, tg.y);
  return p && { p, x: tg.x ?? p.x, y: tg.y ?? p.y };
}
function setStart(tg, name) {
  const s = snapTarget(tg);
  if (!s) return;
  const leg = Math.hypot(s.x - s.p.x, s.y - s.p.y);
  walk.start = { x: s.x, y: s.y, name, leg };
  walk.tree = net.tree(s.p, walkSeconds(leg, s.p.z - T.height(s.x, s.y)) * OFF_PATH);
  walkVersion++;
  hoverCache.clear();
  if (walk.iso) iso.color(walk.tree);
  if (walk.dest) computeRoute();
  renderWalkbar();
  renderCard();
  placePins();
  needsRender = true;
}
// time and distance from the start to a target
function walkTo(tg) {
  if (!walk.tree) return null;
  const s = snapTarget(tg);
  if (!s) return null;
  const q = net.query(walk.tree, s.p);
  const d = Math.hypot(s.x - s.p.x, s.y - s.p.y);
  return { ...s, q, end: d, time: q.time + walkSeconds(d, T.height(s.x, s.y) - s.p.z) * OFF_PATH, dist: walk.start.leg + q.dist + d };
}
function hoverWalk(hit) {
  if (hit.rec) {
    const key = `${walkVersion}:${mainRec(hit.rec).bi}`;
    if (!hoverCache.has(key)) hoverCache.set(key, walkTo({ outer: mainRec(hit.rec).outer }));
    return hoverCache.get(key);
  }
  return walkTo({ x: hit.point.x, y: -hit.point.z });
}
function setDest(tg) {
  walk.dest = tg;
  if (tg) computeRoute(); else { walk.route = null; drawRoute(); }
}
function computeRoute() {
  const w = walkTo(walk.dest);
  if (!w) { walk.route = null; drawRoute(); return; }
  const path = net.path(walk.tree, w.p, w.q);
  walk.route = { ...path, time: w.time, dist: w.dist, end: [w.x, w.y], endLeg: w.end };
  drawRoute();
}
const routeWidthFor = (d) => clamp(d * 0.0065, 2.4, 16);
function drawRoute() {
  if (routeGroup) {
    scene.remove(routeGroup);
    routeGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    routeGroup = null;
  }
  const r = walk.route;
  if (r && r.pts.length >= 2) {
    const w = (routeWidth = routeWidthFor(controls.dist));
    routeGroup = new THREE.Group();
    const add = (pts, width, color, opacity, depthTest, order) => {
      const m = new THREE.Mesh(ribbon(pts, width, T, 0.9), new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthWrite: false, depthTest, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -40,
      }));
      m.renderOrder = order;
      routeGroup.add(m);
    };
    add(r.pts, w * 1.75, '#ffffff', 0.95, true, 46);
    add(r.pts, w, '#2f7bff', 1, true, 47);
    add(r.pts, w, '#2f7bff', 0.3, false, 48); // faint where buildings or trees hide it
    const legs = [[[walk.start.x, walk.start.y, T.height(walk.start.x, walk.start.y)], r.pts[0]], [r.pts[r.pts.length - 1], [r.end[0], r.end[1], T.height(r.end[0], r.end[1])]]];
    for (const leg of legs) if (Math.hypot(leg[1][0] - leg[0][0], leg[1][1] - leg[0][1]) > 2) add(leg, w * 0.75, '#a8c8ff', 0.95, true, 47);
    scene.add(routeGroup);
  }
  const end = $('#pinEnd');
  end.hidden = !r;
  if (r) $('#pinEndTime').textContent = `🚶 ${fmtDur(r.time)}`;
  placePins();
  needsRender = true;
}
const _pv = new THREE.Vector3();
function placePin(el, x, y) {
  _pv.set(x, T.height(x, y) - DATUM + 1.2, -y).project(camera);
  const vis = _pv.z < 1 && Math.abs(_pv.x) < 1.2 && Math.abs(_pv.y) < 1.2;
  el.style.visibility = vis ? '' : 'hidden';
  if (vis) el.style.transform = `translate3d(${(((_pv.x + 1) / 2) * W).toFixed(1)}px,${(((1 - _pv.y) / 2) * H).toFixed(1)}px,0)`;
}
function placePins() {
  if (!camera) return;
  if (walk.start) placePin($('#pinStart'), walk.start.x, walk.start.y);
  if (walk.route) placePin($('#pinEnd'), walk.route.end[0], walk.route.end[1]);
}
function walkBlock() {
  const r = walk.route;
  if (!r) return '';
  const s = S();
  const notes = [];
  if (r.flags & STEPS) notes.push(s.walkSteps);
  if (r.flags & INDOOR) notes.push(s.walkIndoor);
  const climb = r.up >= 2 || r.down >= 2 ? ` · ↑${Math.round(r.up)} m ↓${Math.round(r.down)} m` : '';
  return `<div class="walk-block">
    <div class="wk-main"><span class="wk-ico" aria-hidden="true">🚶</span><b>${esc(fmtDur(r.time))}</b><span class="wk-dist">${esc(fmtDist(r.dist))}</span></div>
    <div class="wk-sub">${esc(fmt(s.walkFromName, { s: nameText(walk.start.name) }))}${climb}${notes.length ? ' · ' + esc(notes.join(' · ')) : ''}</div>
    <button class="btn small wk-here" type="button">${esc(s.walkFromHere)}</button>
  </div>`;
}
// make the current destination the new start
function walkFromHere() {
  const sel = state.sel;
  if (!sel || !walk.dest) return;
  const name = sel.kind === 'point' ? { key: 'walkPinned' } : recName(sel.kind === 'campus' ? recsOf(sel.info)[0] : sel.rec);
  const dest = walk.dest;
  select(null);
  setStart(dest, name);
}
function renderWalkbar() {
  const s = S();
  $('#wbFrom').textContent = walk.start ? fmt(s.walkFrom, { s: nameText(walk.start.name) }) : '';
  const hint = $('#wbHint');
  if (!hint.classList.contains('msg')) hint.textContent = walk.pick ? s.walkPickHint : s.walkHint;
  const pick = $('#wbPick');
  pick.textContent = walk.pick ? s.walkCancel : s.walkSetStart;
  pick.setAttribute('aria-pressed', String(walk.pick));
  document.body.classList.toggle('picking-start', walk.pick);
  const isoBtn = $('#wbIso');
  $('#wbIsoLong').textContent = s.walkIso;
  isoBtn.title = s.walkIso;
  isoBtn.setAttribute('aria-pressed', String(walk.iso));
  $('#wbLegend').hidden = !walk.iso;
  $('#wbLegendLabel').textContent = s.walkIsoLegend;
  const loc = $('#wbLoc');
  loc.title = s.walkLoc;
  loc.setAttribute('aria-label', s.walkLoc);
  $('#pinStart').title = s.walkDrag;
}
function walkMessage(text) {
  const hint = $('#wbHint');
  hint.textContent = text;
  hint.classList.add('msg');
  clearTimeout(walkMessage.timer);
  walkMessage.timer = setTimeout(() => { hint.classList.remove('msg'); renderWalkbar(); }, 5000);
}
// latitude / longitude to the model's local metres (same tangent plane as tools/process.mjs)
function toLocal(lat, lon) {
  const [lat0, lon0] = data.origin, phi = (lat0 * Math.PI) / 180;
  const mLat = 111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const mLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
  return [(lon - lon0) * mLon, (lat - lat0) * mLat];
}
function locate() {
  if (!navigator.geolocation) { walkMessage(S().walkLocErr); return; }
  walkMessage(S().walkLocBusy);
  navigator.geolocation.getCurrentPosition((pos) => {
    const [x, y] = toLocal(pos.coords.latitude, pos.coords.longitude);
    const [X0, Y0, X1, Y1] = data.bounds;
    if (x < X0 || x > X1 || y < Y0 || y > Y1) {
      walkMessage(fmt(S().walkLocFar, { d: (Math.hypot(x, y) / 1000).toFixed(1) }));
      return;
    }
    $('#wbHint').classList.remove('msg');
    setStart({ x, y }, { key: 'walkMyLoc' });
    controls.flyTo({ target: new THREE.Vector3(x, T.height(x, y) - DATUM, -y), dist: Math.min(controls.dist, 700) });
  }, () => walkMessage(S().walkLocErr), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}
function setupWalk() {
  setStart({ x: data.walkStart.x, y: data.walkStart.y }, { en: data.walkStart.en, zh: data.walkStart.zh });
  $('#wbPick').addEventListener('click', () => { walk.pick = !walk.pick; renderWalkbar(); });
  $('#wbLoc').addEventListener('click', locate);
  $('#wbIso').addEventListener('click', () => {
    walk.iso = !walk.iso;
    iso.mesh.visible = walk.iso;
    if (walk.iso) iso.color(walk.tree);
    renderWalkbar();
    needsRender = true;
  });
  $('#wbLegendBar').style.background = `linear-gradient(90deg, ${ISO_RAMP.join(',')})`;
  // drag the start pin anywhere; dropping it on a building starts from that building
  const pin = $('#pinStart');
  let drag = null;
  pin.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    pin.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, queued: false };
    pin.classList.add('dragging');
  });
  pin.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.queued) return;
    drag.queued = true;
    requestAnimationFrame(() => {
      if (!drag) return;
      drag.queued = false;
      const hit = pickAt(drag.x, drag.y);
      if (hit) setStart({ x: hit.point.x, y: -hit.point.z }, { key: 'walkPinned' });
    });
  });
  const end = (e) => {
    if (!drag) return;
    const hit = pickAt(e.clientX, e.clientY);
    drag = null;
    pin.classList.remove('dragging');
    if (hit && hit.rec) setStart({ outer: mainRec(hit.rec).outer }, recName(hit.rec));
  };
  pin.addEventListener('pointerup', end);
  pin.addEventListener('pointercancel', end);
  pin.addEventListener('wheel', (e) => controls._wheel(e), { passive: false });
  $('#pinEnd').addEventListener('wheel', (e) => controls._wheel(e), { passive: false });
}

// ---------------------------------------------------------------- colour views and legend
const RAMP_H = ['#fde9a9', '#f8b45d', '#ea6f3c', '#c13b4a', '#7a2a6e'];
const RAMP_Y = ['#3a2f86', '#2b6f9e', '#2aa58f', '#7cc45a', '#f2dc3b'];
function ramp(stops, t) {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return new THREE.Color(stops[i]).lerp(new THREE.Color(stops[i + 1]), t - i);
}
const NEUTRAL = new THREE.Color('#d6d9de');
function applyMode() {
  const m = state.mode;
  if (m === 'real') B.recolor(null);
  else {
    const catC = Object.fromEntries(Object.entries(data.categories).map(([k, v]) => [k, new THREE.Color(v.color)]));
    B.recolor((key, c) => {
      if (key >= 100000) {
        const inf = data.info[key - 100000];
        if (m === 'func') c.copy(catC[inf.cat] || NEUTRAL);
        else if (m === 'height') c.copy(ramp(RAMP_H, (inf.top - inf.ground) / 35));
        else c.copy(inf.year ? ramp(RAMP_Y, (inf.year - 1964) / 62) : NEUTRAL).multiplyScalar(inf.year ? 1 : 0.85);
      } else {
        const r = B.recs[key];
        if (m === 'height') c.copy(ramp(RAMP_H, (r.zt - r.zb - 0.6) / 35));
        else c.copy(NEUTRAL);
      }
    });
  }
  $$('#modes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  renderLegend();
  needsRender = true;
}
function renderLegend() {
  const el = $('#legend');
  const s = S();
  const m = state.mode;
  if (m === 'real') { el.hidden = true; return; }
  el.hidden = false;
  if (m === 'func') {
    el.innerHTML = `<div class="lg-title">${esc(s.legendFunc)}</div><div class="lg-items">${Object.values(data.categories)
      .map((c) => `<span class="lg-item"><i style="background:${c.color}"></i>${esc(c[state.lang])}</span>`).join('')}<span class="lg-item"><i style="background:#d6d9de"></i>${esc(s.neighbourhood)}</span></div>`;
  } else {
    const stops = m === 'height' ? RAMP_H : RAMP_Y;
    const [a, b] = m === 'height' ? ['0 m', '35 m+'] : ['1964', '2026'];
    el.innerHTML = `<div class="lg-title">${esc(m === 'height' ? s.legendHeight : s.legendAge)}</div>
      <div class="lg-ramp" style="background:linear-gradient(90deg,${stops.join(',')})"></div>
      <div class="lg-ends"><span>${a}</span><span>${b}</span></div>
      ${m === 'age' ? `<div class="lg-items"><span class="lg-item"><i style="background:#b6b9bd"></i>${esc(s.unknown)}</span><span class="lg-item"><i style="background:#d6d9de"></i>${esc(s.neighbourhood)}</span></div>` : ''}`;
  }
}

// ---------------------------------------------------------------- directory and search
const CAT_ORDER = ['teach', 'library', 'student', 'health', 'res', 'sport', 'heritage', 'ops', 'partner'];
function renderDirectory() {
  const q = $('#search').value.trim().toLowerCase();
  const list = $('#dirList');
  const groups = new Map();
  data.info.forEach((inf, i) => {
    if (!inf.en || inf.en === 'Shelter') return;
    const hay = `${inf.code} ${inf.en} ${inf.zh}`.toLowerCase();
    if (q && !hay.includes(q)) return;
    if (!groups.has(inf.cat)) groups.set(inf.cat, []);
    groups.get(inf.cat).push(i);
  });
  let html = '';
  let n = 0;
  for (const cat of CAT_ORDER) {
    const ids = groups.get(cat);
    if (!ids) continue;
    const c = data.categories[cat];
    ids.sort((a, b) => (data.info[a].code || 'zz').localeCompare(data.info[b].code || 'zz') || data.info[a].en.localeCompare(data.info[b].en));
    html += `<li class="dir-group"><h3><i style="background:${c.color}"></i>${esc(c[state.lang])}</h3><ul>`;
    for (const i of ids) {
      const inf = data.info[i];
      n++;
      html += `<li><button type="button" class="dir-item${state.sel && state.sel.kind === 'campus' && state.sel.info === i ? ' active' : ''}" data-i="${i}">
        <span class="code" style="--c:${c.color}">${esc(inf.code || '·')}</span>
        <span class="nm">${esc(infoName(inf))}</span>
        ${inf.isNew ? `<em class="new">${esc(S().newBadge)}</em>` : inf.year ? `<span class="yr">${inf.year}</span>` : ''}
      </button></li>`;
    }
    html += '</ul></li>';
  }
  list.innerHTML = html || `<li class="empty">${esc(t('noMatch', { q: $('#search').value.trim() }))}</li>`;
  $('#dirCount').textContent = String(n);
  $$('.dir-item', list).forEach((el) => el.addEventListener('click', () => {
    select({ kind: 'campus', info: +el.dataset.i }, true);
    if (narrow()) {
      document.body.classList.remove('dir-open');
      document.activeElement?.blur();
    }
  }));
}

// ---------------------------------------------------------------- sun, date and timeline
function updateSun() {
  const ms = simMs();
  const { alt, az } = sunPosition(new Date(ms), LAT, LON);
  sky.update(alt, az, state.weather);
  B.uniforms.uNight.value = sky.night;
  lamps.setNight(sky.night);
  const dayStart = torontoToUTC(state.day.y, state.day.m, state.day.d, 0);
  const st = sunTimes(new Date(ms), LAT, LON, dayStart);
  const toMin = (x) => (x == null ? null : Math.round((x - dayStart) / 60000));
  const rise = toMin(st.rise), set = toMin(st.set);
  $('#sunInfo').textContent = rise != null && set != null ? `${t('sunrise', { t: hhmm(rise) })} · ${t('sunset', { t: hhmm(set) })}` : '';
  $('#timeVal').textContent = hhmm(state.minutes);
  $('#timeRange').value = String(state.minutes);
  $('#dateInput').value = `${state.day.y}-${String(state.day.m + 1).padStart(2, '0')}-${String(state.day.d).padStart(2, '0')}`;
  $('#liveBtn').classList.toggle('on', state.live);
  $('#liveBtn').setAttribute('aria-pressed', String(state.live));
  renderClock();
  needsRender = true;
}
let lastDoy = null;
function updateSeason() {
  const doy = dayOfYear(state.day);
  if (doy === lastDoy) return;
  lastDoy = doy;
  trees.setSeason(doy);
  const [X0, , X1] = data.bounds;
  const cv = paintGround(data, groundTex.image.width / (X1 - X0), doy);
  groundTex.image = cv;
  groundTex.needsUpdate = true;
  needsRender = true;
}
function tick() {
  if (state.live) { syncNow(); updateSun(); updateSeason(); } else renderClock();
}
function renderClock() {
  const now = new Intl.DateTimeFormat(state.lang === 'zh' ? 'zh-CN' : 'en-CA', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const el = $('#clock');
  el.textContent = state.live ? now : `${hhmm(state.minutes)} · ${S().months[state.day.m]} ${state.day.d}`;
  el.title = state.live ? t('clockTitle') : t('simTime');
  el.classList.toggle('sim', !state.live);
}

function setYear(y, animate) {
  state.year = y;
  state.timeline = y < 2026;
  B.uniforms.uYear.value = y;
  B.uniforms.uTimeline.value = state.timeline ? 1 : 0;
  const yi = Math.round(y);
  $('#yearVal').textContent = String(yi);
  if (!animate) $('#yearRange').value = String(yi);
  const opened = data.info.filter((inf) => inf.year === yi && inf.en);
  const names = [...new Set(opened.map((inf) => infoName(inf)))];
  $('#yearList').textContent = state.timeline || yi === 2026 ? (names.length ? `${t('openedIn', { y: yi })} ${names.join(' · ')}` : t('nothingNew')) : '';
  needsRender = true;
}
let playStart = 0;
function togglePlay() {
  state.playing = !state.playing;
  const btn = $('#playBtn');
  btn.textContent = state.playing ? t('pause') : t('play');
  btn.setAttribute('aria-pressed', String(state.playing));
  if (state.playing) {
    if (state.year >= 2026) setYear(1962);
    playStart = performance.now() - ((state.year - 1962) / 64) * 16000;
  }
}

// ---------------------------------------------------------------- tour of the newest buildings
function startTour() {
  const ids = data.info.map((inf, i) => [inf, i]).filter(([inf]) => inf.isNew).sort((a, b) => a[0].year - b[0].year).map(([, i]) => i);
  state.tour = { ids, k: 0 };
  document.body.classList.add('touring');
  showTourStop();
}
function showTourStop() {
  const tr = state.tour;
  if (!tr) return;
  const i = tr.ids[tr.k];
  select({ kind: 'campus', info: i });
  const v = viewFor(data.info[i]);
  v.yaw = -0.62 + tr.k * 0.55;
  v.pitch = 0.52;
  controls.flyTo(v);
  $('#tourStep').textContent = t('tourOf', { i: tr.k + 1, n: tr.ids.length });
  $('#tourPrev').disabled = tr.k === 0;
  $('#tourNext').disabled = tr.k === tr.ids.length - 1;
  if (narrow()) document.body.classList.remove('dir-open');
}
function stopTour(reset) {
  if (!state.tour) return;
  state.tour = null;
  document.body.classList.remove('touring');
  if (reset) select(null);
}

// ---------------------------------------------------------------- weather (Open-Meteo, no key needed)
async function fetchWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,is_day&timezone=America%2FToronto`;
    const r = await fetch(url);
    const j = await r.json();
    const c = j.current;
    state.weather = { temp: c.temperature_2m, code: c.weather_code, cloud: (c.cloud_cover ?? 30) / 100, wind: c.wind_speed_10m };
  } catch {
    state.weather = null;
  }
  renderWeather();
  updateSun();
  setTimeout(fetchWeather, 15 * 60e3);
}
function renderWeather() {
  const el = $('#weather');
  const w = state.weather;
  el.title = t('weatherTitle');
  if (!w) { el.textContent = t('weatherNA'); return; }
  const icon = w.code === 0 || w.code === 1 ? '☀' : w.code <= 3 ? '⛅' : w.code <= 48 ? '🌫' : w.code <= 67 || (w.code >= 80 && w.code <= 82) ? '🌧' : w.code <= 86 ? '❄' : '⛈';
  el.innerHTML = `<span class="wi" aria-hidden="true">${icon}</span>${Math.round(w.temp)}°C <span class="wd">${esc(S().wmo[w.code] || '')}</span>`;
}

// ---------------------------------------------------------------- interface wiring
function setupUI() {
  $('#langBtn').addEventListener('click', () => { state.lang = state.lang === 'en' ? 'zh' : 'en'; applyLang(); });
  $('#search').addEventListener('input', renderDirectory);
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = $('.dir-item'); if (first) first.click(); }
    if (e.key === 'Escape') { e.target.value = ''; renderDirectory(); e.target.blur(); }
  });
  $('#dirToggle').addEventListener('click', () => {
    // phones start with the list folded away; larger screens start with it open
    document.body.classList.toggle(narrow() ? 'dir-open' : 'dir-closed');
    needsRender = true;
  });
  $('#search').addEventListener('focus', () => document.body.classList.add('dir-open'));
  canvas.addEventListener('pointerdown', () => { if (narrow()) document.body.classList.remove('dir-open'); });
  // panels sit above the dock, whatever height it wraps to
  new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', `${$('#dock').offsetHeight}px`)).observe($('#dock'));
  $('#tourBtn').addEventListener('click', startTour);
  $('#tourPrev').addEventListener('click', () => { state.tour.k--; showTourStop(); });
  $('#tourNext').addEventListener('click', () => { state.tour.k++; showTourStop(); });
  $('#tourEnd').addEventListener('click', () => stopTour(true));
  $$('#modes button').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; applyMode(); }));
  $$('#layers input').forEach((inp) => inp.addEventListener('change', () => {
    state.layers[inp.dataset.layer] = inp.checked;
    applyLayers();
  }));
  $('#zoomIn').addEventListener('click', () => controls.zoomBy(-0.7));
  $('#zoomOut').addEventListener('click', () => controls.zoomBy(0.7));
  $('#northBtn').addEventListener('click', () => controls.flyTo({ yaw: 0 }, 0.8));
  $('#tiltBtn').addEventListener('click', () => controls.flyTo({ pitch: controls.pitch > 1.3 ? 0.66 : 1.55 }, 0.8));
  $('#homeBtn').addEventListener('click', () => { stopTour(false); controls.flyTo(homeView()); });
  $('#timeRange').addEventListener('input', (e) => { state.live = false; state.minutes = +e.target.value; updateSun(); });
  $('#dateInput').addEventListener('change', (e) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.target.value);
    if (!m) return;
    state.live = false;
    state.day = { y: +m[1], m: +m[2] - 1, d: +m[3] };
    updateSun();
    updateSeason();
  });
  $('#liveBtn').addEventListener('click', () => { state.live = true; tick(); });
  $('#yearRange').addEventListener('input', (e) => { if (state.playing) togglePlay(); setYear(+e.target.value); });
  $('#playBtn').addEventListener('click', togglePlay);
  $('#todayBtn').addEventListener('click', () => { if (state.playing) togglePlay(); setYear(2026); });
  $('#aboutBtn').addEventListener('click', () => $('#about').showModal());
  $('#aboutClose').addEventListener('click', () => $('#about').close());
  $('#about').addEventListener('click', (e) => { if (e.target.id === 'about') $('#about').close(); });
  $$('.dock-tabs button').forEach((b) => b.addEventListener('click', () => {
    const open = document.body.dataset.dock === b.dataset.tab;
    document.body.dataset.dock = open ? '' : b.dataset.tab;
  }));
  addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    if (e.key === 'Escape') {
      if (state.walk.pick) { state.walk.pick = false; renderWalkbar(); } else if (state.tour) stopTour(true); else select(null);
    }
  });
  $('#hint').textContent = touch ? t('hintTouch') : t('hint');
  setTimeout(() => $('#hint').classList.add('fade'), 9000);
  applyMode();
  setYear(2026);
  renderDirectory();
}
function applyLayers() {
  const L = state.layers;
  trees.group.visible = L.trees;
  $('#labels').hidden = !L.labels;
  B.uniforms.uHideCtx.value = L.context ? 0 : 1;
  sky.sun.castShadow = L.shadows;
  needsRender = true;
}

function applyLang() {
  const s = STR[state.lang];
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  document.title = s.pageTitle;
  canvas.setAttribute('aria-label', s.canvasLabel);
  $$('[data-i18n]').forEach((el) => { el.textContent = s[el.dataset.i18n] ?? STR.en[el.dataset.i18n]; });
  $$('[data-i18n-title]').forEach((el) => { el.title = s[el.dataset.i18nTitle]; el.setAttribute('aria-label', s[el.dataset.i18nTitle]); });
  $$('[data-i18n-ph]').forEach((el) => { el.placeholder = s[el.dataset.i18nPh]; });
  const lb = $('#langBtn');
  lb.textContent = s.langBtn;
  lb.lang = state.lang === 'zh' ? 'en' : 'zh-CN';
  lb.title = s.langLabel;
  lb.setAttribute('aria-label', s.langLabel);
  $('#aboutText').innerHTML = s.aboutBody.map((p) => `<p>${p}</p>`).join('');
  $('#credits').textContent = s.credits;
  if (!data) return;
  $('#sources').innerHTML = data.sources.map(([name, url]) => `<li><a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a></li>`).join('')
    + `<li>OpenStreetMap: ${esc(data.osm.slice(0, 10))}</li>`;
  $('#hint').textContent = touch ? s.hintTouch : s.hint;
  $('#playBtn').textContent = state.playing ? s.pause : s.play;
  renderWalkbar();
  if (walk.route) $('#pinEndTime').textContent = `🚶 ${fmtDur(walk.route.time)}`;
  labels.setLang(state.lang);
  renderDirectory();
  renderCard();
  renderLegend();
  renderWeather();
  renderClock();
  setYear(state.year);
  updateSun();
  if (state.tour) $('#tourStep').textContent = t('tourOf', { i: state.tour.k + 1, n: state.tour.ids.length });
  needsRender = true;
}

// ---------------------------------------------------------------- frame loop
let W = innerWidth, H = innerHeight;
function onResize() {
  W = innerWidth; H = innerHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  needsRender = true;
}
let last = performance.now();
const kinds = { building: true, area: true, road: true, water: true, poi: true };
// panels the labels should not slide under
const BLOCKERS = ['.brand', '.top-right', '#dir', '#card', '#dock', '.mapctl', '#legend', '#tourBar'];
function blockers() {
  const out = [];
  for (const sel of BLOCKERS) {
    const el = $(sel);
    if (!el || el.hidden || !el.offsetParent) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) out.push([r.left, r.top, r.right, r.bottom]);
  }
  return out;
}
// Smooth motion matters more than pixel density: if rendering cannot keep up while the view is
// moving, step the resolution down (never back up in the same session, to avoid see-sawing).
const perf = { n: 0, sum: 0, prev: 0, ratio: 0 };
function adaptResolution(now, moving) {
  if (!moving) { perf.prev = 0; return; }
  if (perf.prev) {
    const ms = now - perf.prev;
    if (ms < 250) { perf.sum += ms; perf.n++; }
  }
  perf.prev = now;
  if (perf.n < 40) return;
  const avg = perf.sum / perf.n;
  perf.n = 0; perf.sum = 0;
  const pr = renderer.getPixelRatio();
  if (avg > 26 && pr > 0.76) {
    renderer.setPixelRatio(Math.max(0.75, pr - 0.25));
    renderer.setSize(W, H, false);
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let moved = controls.update(dt);
  if (state.playing) {
    const y = 1962 + ((now - playStart) / 16000) * 64;
    if (y >= 2026) { setYear(2026); togglePlay(); } else setYear(y, true);
    $('#yearRange').value = String(Math.round(state.year));
    moved = true;
  }
  if (moved || needsRender) {
    needsRender = false;
    kinds.poi = state.layers.pois;
    sky.follow(camera, controls.target, controls.dist);
    trees.updateLOD(camera.position);
    scene.fog.near = controls.dist * 1.6 + 2500;
    scene.fog.far = controls.dist * 5 + 9000;
    if (state.layers.labels) labels.update(camera, controls.dist, W, H, kinds, blockers());
    $('#compass').style.transform = `rotate(${-controls.yaw}rad)`;
    // keep the route a readable width at any zoom
    if (walk.route && Math.abs(Math.log(routeWidthFor(controls.dist) / routeWidth)) > 0.3) drawRoute();
    if (walk.iso) iso.setWidth(controls.dist);
    placePins();
    // the button names the view it switches to
    const tiltTo = controls.pitch > 1.3 ? '3D' : '2D';
    if (tiltBtn.textContent !== tiltTo) tiltBtn.textContent = tiltTo;
    renderer.render(scene, camera);
    if (window.twin) window.twin.frames++;
  }
  adaptResolution(now, moved);
}

main().catch((err) => {
  console.error(err);
  loadEl.classList.add('error');
  $('#loadMsg').textContent = t('loadError', { m: err.message });
});
