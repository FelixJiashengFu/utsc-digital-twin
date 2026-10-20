// Turn the raw inputs in data/raw/ into the dataset the viewer loads:
//   data/campus.json   buildings, landscape, roads, water, trees, labels (local metres)
//   data/terrain.bin   4 m height grid: Int16 row deltas of centimetres above 80 m, gzip-compressed
// Usage: deno run -A tools/process.mjs        (or: node tools/process.mjs)
//
// Coordinates are projected to a local tangent plane centred on the study area
// (x = metres east, y = metres north). Lines and rings are stored as integer decimetres,
// the first vertex absolute and the rest as deltas.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { fromArrayBuffer } from 'geotiff';
import { BUILDINGS, CATEGORIES, PLACE_ZH, SOURCES } from './curated.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');
const OUT = join(ROOT, 'data');
mkdirSync(OUT, { recursive: true });
const load = (name) => JSON.parse(readFileSync(join(RAW, `${name}.json`), 'utf8'));

// ---------------------------------------------------------------- projection
const S = 43.7725, W = -79.2010, N = 43.7975, E = -79.1720;
const LAT0 = (S + N) / 2, LON0 = (W + E) / 2;
const PHI = (LAT0 * Math.PI) / 180;
const M_LAT = 111132.954 - 559.822 * Math.cos(2 * PHI) + 1.175 * Math.cos(4 * PHI);
const M_LON = 111412.84 * Math.cos(PHI) - 93.5 * Math.cos(3 * PHI);
const proj = (p) => [(p.lon - LON0) * M_LON, (p.lat - LAT0) * M_LAT];
const unproj = (x, y) => [LON0 + x / M_LON, LAT0 + y / M_LAT];

// ---------------------------------------------------------------- terrain
const tifBuf = readFileSync(join(RAW, 'dtm_3857.tif'));
const tif = await fromArrayBuffer(tifBuf.buffer.slice(tifBuf.byteOffset, tifBuf.byteOffset + tifBuf.byteLength));
const img = await tif.getImage();
const [dem] = await img.readRasters();
const [DOX, DOY] = img.getOrigin();
const [DRX, DRY] = img.getResolution();
const DW = img.getWidth(), DH = img.getHeight();
const RM = 20037508.342789244;
function demAt(lon, lat) {
  const mx = (lon * RM) / 180;
  const my = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * RM) / Math.PI;
  const fx = (mx - DOX) / DRX - 0.5, fy = (my - DOY) / DRY - 0.5;
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  const g = (a, b) => dem[Math.min(DH - 1, Math.max(0, b)) * DW + Math.min(DW - 1, Math.max(0, a))];
  return (g(i, j) * (1 - tx) + g(i + 1, j) * tx) * (1 - ty) + (g(i, j + 1) * (1 - tx) + g(i + 1, j + 1) * tx) * ty;
}

const DX = 4, BASE = 80;
const X0 = Math.ceil((W - LON0) * M_LON), Y0 = Math.ceil((S - LAT0) * M_LAT);
const NX = Math.floor(((E - LON0) * M_LON - X0) / DX) + 1;
const NY = Math.floor(((N - LAT0) * M_LAT - Y0) / DX) + 1;
const X1 = X0 + (NX - 1) * DX, Y1 = Y0 + (NY - 1) * DX;
const grid = new Float32Array(NX * NY);
for (let j = 0; j < NY; j++) {
  for (let i = 0; i < NX; i++) {
    let s = 0;
    for (const ox of [-1.3, 0, 1.3]) for (const oy of [-1.3, 0, 1.3]) s += demAt(...unproj(X0 + i * DX + ox, Y0 + j * DX + oy));
    grid[j * NX + i] = s / 9;
  }
}
// Height on the 4 m grid, interpolated on the same two triangles per cell the viewer's mesh uses
// (diagonal from (i, j) to (i+1, j+1)), so buildings and trees sit exactly on the rendered ground.
function H(x, y) {
  let fx = (x - X0) / DX, fy = (y - Y0) / DX;
  fx = Math.min(NX - 1.000001, Math.max(0, fx));
  fy = Math.min(NY - 1.000001, Math.max(0, fy));
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  const h00 = grid[j * NX + i], h10 = grid[j * NX + i + 1], h01 = grid[(j + 1) * NX + i], h11 = grid[(j + 1) * NX + i + 1];
  return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h01 - h00) * v + (h11 - h01) * u;
}
{
  const cm = new Int16Array(NX * NY);
  let lo = 1e9, hi = -1e9;
  for (let j = 0; j < NY; j++) {
    let prev = 0;
    for (let i = 0; i < NX; i++) {
      const v = Math.round((grid[j * NX + i] - BASE) * 100);
      lo = Math.min(lo, v); hi = Math.max(hi, v);
      cm[j * NX + i] = i === 0 ? v : v - prev;
      prev = v;
    }
  }
  const bin = gzipSync(Buffer.from(cm.buffer), { level: 9 });
  writeFileSync(join(OUT, 'terrain.bin'), bin);
  console.log(`terrain ${NX}×${NY} @ ${DX} m, ${(BASE + lo / 100).toFixed(1)}–${(BASE + hi / 100).toFixed(1)} m, ${(bin.length / 1024).toFixed(0)} KB`);
}
const inBox = ([x, y], m = 0) => x >= X0 + m && x <= X1 - m && y >= Y0 + m && y <= Y1 - m;

// ---------------------------------------------------------------- geometry helpers
const close = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
function signedArea(r) {
  let s = 0;
  for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return s / 2;
}
function centroid(r) {
  const a = signedArea(r);
  if (Math.abs(a) < 1e-9) return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
  let cx = 0, cy = 0;
  for (let i = 0; i < r.length - 1; i++) {
    const f = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    cx += (r[i][0] + r[i + 1][0]) * f;
    cy += (r[i][1] + r[i + 1][1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}
function inside([x, y], r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i], pts[a], pts[b]);
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplifyRing(r, tol) {
  if (r.length <= 5) return r;
  let far = 1, fd = -1;
  for (let i = 1; i < r.length - 1; i++) {
    const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const s = dp(r.slice(0, far + 1), tol).concat(dp(r.slice(far), tol).slice(1));
  return s.length >= 4 ? s : r;
}
function assemble(ways) {
  const pool = ways.filter((w) => w.length >= 2).map((w) => w.slice());
  const rings = [];
  while (pool.length) {
    let cur = pool.shift();
    let grew = true;
    while (!close(cur[0], cur[cur.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        if (close(w[0], cur[cur.length - 1])) cur = cur.concat(w.slice(1));
        else if (close(w[w.length - 1], cur[cur.length - 1])) cur = cur.concat(w.slice().reverse().slice(1));
        else if (close(w[w.length - 1], cur[0])) cur = w.slice(0, -1).concat(cur);
        else if (close(w[0], cur[0])) cur = w.slice().reverse().slice(0, -1).concat(cur);
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (close(cur[0], cur[cur.length - 1]) && cur.length >= 4) rings.push(cur);
  }
  return rings;
}
const geomOf = (g) => (g || []).filter(Boolean).map(proj);
function polygonsOf(e) {
  if (e.type === 'way') {
    const g = geomOf(e.geometry);
    return g.length >= 4 && close(g[0], g[g.length - 1]) ? [[g, []]] : [];
  }
  const outers = [], inners = [];
  for (const m of e.members || []) {
    if (m.type !== 'way' || !m.geometry) continue;
    (m.role === 'inner' ? inners : outers).push(geomOf(m.geometry));
  }
  const res = assemble(outers).map((o) => [o, []]);
  for (const h of assemble(inners)) {
    const host = res.find(([o]) => inside(h[0], o));
    if (host) host[1].push(h);
  }
  return res;
}
function clipRing(ring, xmin, ymin, xmax, ymax) {
  let pts = ring.slice(0, -1);
  for (let edge = 0; edge < 4; edge++) {
    if (!pts.length) return [];
    const ins = (p) => [p[0] >= xmin, p[1] >= ymin, p[0] <= xmax, p[1] <= ymax][edge];
    const cut = (p, q) => {
      if (edge === 0 || edge === 2) {
        const xv = edge === 0 ? xmin : xmax, t = (xv - p[0]) / (q[0] - p[0]);
        return [xv, p[1] + t * (q[1] - p[1])];
      }
      const yv = edge === 1 ? ymin : ymax, t = (yv - p[1]) / (q[1] - p[1]);
      return [p[0] + t * (q[0] - p[0]), yv];
    };
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
      if (ins(cur)) {
        if (!ins(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (ins(prev)) out.push(cut(prev, cur));
    }
    pts = out;
  }
  return pts.length >= 3 ? pts.concat([pts[0]]) : [];
}
function clipLine(line, xmin, ymin, xmax, ymax) {
  const pieces = [];
  let cur = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, y0] = line[i], [x1, y1] = line[i + 1];
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, x0 - xmin], [dx, xmax - x0], [-dy, y0 - ymin], [dy, ymax - y0]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } } else {
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
      }
    }
    if (!ok || t0 > t1) { if (cur.length >= 2) pieces.push(cur); cur = []; continue; }
    const a = [x0 + t0 * dx, y0 + t0 * dy], b = [x0 + t1 * dx, y0 + t1 * dy];
    if (!cur.length) cur = [a];
    else if (!close(cur[cur.length - 1], a)) { if (cur.length >= 2) pieces.push(cur); cur = [a]; }
    cur.push(b);
    if (t1 < 1) { pieces.push(cur); cur = []; }
  }
  if (cur.length >= 2) pieces.push(cur);
  return pieces;
}
// first vertex absolute, then deltas, all in decimetres; rings drop the closing vertex
function enc(pts) {
  const out = [];
  let px = 0, py = 0;
  for (const [x, y] of pts) {
    const ix = Math.round(x * 10), iy = Math.round(y * 10);
    if (out.length && ix === px && iy === py) continue;
    out.push(ix - px, iy - py);
    px = ix; py = iy;
  }
  return out;
}
const encRing = (r) => enc(r.slice(0, -1));
function obb(r) {
  const pts = r.slice(0, -1);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const ang = Math.atan2(y2 - y1, x2 - x1), c = Math.cos(ang), s = Math.sin(ang);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, y] of pts) {
      const u = (x - cx) * c + (y - cy) * s, v = -(x - cx) * s + (y - cy) * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best[0]) best = [area, ang, u0, u1, v0, v1];
  }
  let [, ang, u0, u1, v0, v1] = best;
  const c = Math.cos(ang), s = Math.sin(ang), um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  const ox = cx + um * c - vm * s, oy = cy + um * s + vm * c;
  let hl = (u1 - u0) / 2, hw = (v1 - v0) / 2;
  if (hw > hl) { ang += Math.PI / 2; [hl, hw] = [hw, hl]; }
  return [ox, oy, ang, hl, hw];
}
// pole of inaccessibility (coarse grid search + refinement): where a label sits inside a footprint
function labelPoint(outer, holes) {
  const rings = [outer, ...holes];
  const distEdge = (p) => {
    let d = 1e9;
    for (const r of rings) for (let i = 0; i < r.length - 1; i++) d = Math.min(d, segDist(p, r[i], r[i + 1]));
    return d;
  };
  const ok = (p) => inside(p, outer) && !holes.some((h) => inside(p, h));
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  let best = centroid(outer), bd = ok(best) ? distEdge(best) : -1;
  let step = Math.max(x1 - x0, y1 - y0) / 16;
  let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, span = Math.max(x1 - x0, y1 - y0) / 2;
  for (let it = 0; it < 4; it++) {
    for (let x = cx - span; x <= cx + span; x += step) {
      for (let y = cy - span; y <= cy + span; y += step) {
        const p = [x, y];
        if (!ok(p)) continue;
        const d = distEdge(p);
        if (d > bd) { bd = d; best = p; }
      }
    }
    [cx, cy] = best; span = step * 2; step /= 4;
  }
  return best;
}
function num(v) {
  if (v == null) return null;
  const m = String(v).trim().toLowerCase().replace(',', '.').match(/^(-?\d+(?:\.\d+)?)\s*(m|ft|')?/);
  if (!m) return null;
  return parseFloat(m[1]) * (m[2] === 'ft' || m[2] === "'" ? 0.3048 : 1);
}
function h32(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
const NAMED = {
  red: '#9a4b3d', beige: '#d6c6a6', grey: '#a3a5a6', gray: '#a3a5a6', white: '#e8e6e0', brown: '#7a5a44',
  black: '#3a3a3a', yellow: '#d6bf62', green: '#517a4c', blue: '#4f7fb2', silver: '#c0c0c0', tan: '#d2b48c',
};
function colour(v) {
  if (!v) return null;
  v = String(v).split(/[;,]/)[0].trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + [...v.slice(1)].map((c) => c + c).join('');
  return NAMED[v] || null;
}

// ---------------------------------------------------------------- campus boundary
const campusRel = load('campus').elements[0];
const campusRings = polygonsOf(campusRel).map(([o]) => o);
const inCampus = (p) => campusRings.some((r) => inside(p, r));
const boundary = [];
for (const r of campusRings) for (const piece of clipLine(r, X0, Y0, X1, Y1)) boundary.push(enc(dp(piece, 0.5)));

// ---------------------------------------------------------------- buildings
const palette = [], palIdx = new Map();
const pal = (c) => {
  if (!palIdx.has(c)) { palIdx.set(c, palette.length); palette.push(c); }
  return palIdx.get(c);
};
const HOUSE = new Set(['house', 'detached', 'semidetached_house', 'semi', 'bungalow', 'cabin', 'farm']);
const SMALL = new Set(['garage', 'garages', 'shed', 'roof', 'kiosk', 'carport', 'hut', 'greenhouse', 'service', 'transformer_tower']);
const RESID = new Set(['apartments', 'residential', 'dormitory', 'terrace', 'townhouse']);
const ROOF = { flat: 0, gabled: 1, hipped: 2, 'half-hipped': 2, mansard: 2, pyramidal: 3, dome: 4, onion: 4, round: 1, skillion: 0 };
const BRICK = ['#9b5b47', '#a8735a', '#8c6a55', '#b38b6d', '#7f5646', '#c2a183', '#98705c', '#b9a58f', '#d0c4b2'];
const SIDING = ['#c8c2b4', '#d8d2c4', '#b7b0a2', '#cfc6b0', '#a9a69c', '#e0dcd2'];
const CONCRETE = ['#bdb8b0', '#a9a49c', '#c9c4ba', '#9d9890', '#b4afa6'];
const ROOFS = ['#4f4b48', '#5b544e', '#3f3d3c', '#6b5b4f', '#4a4f55', '#5e5650', '#704c3f'];
const CTX = ['house', 'apartments', 'retail', 'industrial', 'school', 'religious', 'civic', 'small', 'other'];
const CTX_ZH = { house: '住宅', apartments: '公寓', retail: '商业', industrial: '工业', school: '学校', religious: '宗教', civic: '公共建筑', small: '附属建筑', other: '建筑' };
function ctxClass(t) {
  const b = t.building || t['building:part'] || 'yes';
  if (HOUSE.has(b) || b === 'terrace' || b === 'townhouse') return 'house';
  if (b === 'apartments' || b === 'residential' || b === 'dormitory') return 'apartments';
  if (['retail', 'commercial', 'supermarket', 'office', 'hotel'].includes(b) || t.shop) return 'retail';
  if (['industrial', 'warehouse', 'manufacture'].includes(b)) return 'industrial';
  if (['school', 'college', 'university', 'kindergarten'].includes(b) || ['school', 'college', 'kindergarten'].includes(t.amenity)) return 'school';
  if (['church', 'chapel', 'mosque', 'temple', 'synagogue', 'religious'].includes(b) || t.amenity === 'place_of_worship') return 'religious';
  if (['civic', 'public', 'government', 'fire_station', 'hospital'].includes(b)) return 'civic';
  if (SMALL.has(b)) return 'small';
  return 'other';
}

const rawB = load('buildings').elements;
const wayIds = new Set(rawB.filter((e) => e.type === 'way' && e.tags && e.tags.building).map((e) => e.id));
const records = [];
for (const e of rawB) {
  const t = e.tags || {};
  const isPart = 'building:part' in t && !('building' in t);
  if (!isPart && !('building' in t)) continue;
  if (t.building === 'no' || t['building:part'] === 'no') continue;
  const key = (e.type === 'way' ? 'w' : 'r') + e.id;
  // a relation whose outer members are all buildings in their own right only groups them (the Andrews Building)
  if (e.type === 'relation' && (e.members || []).filter((m) => m.role !== 'inner').every((m) => m.type === 'way' && wayIds.has(m.ref))) continue;
  // parts with no height information cannot add anything over their parent outline
  if (isPart && !['height', 'building:levels', 'min_height', 'building:min_level', 'roof:shape'].some((k) => k in t)) continue;
  for (let [outer, holes] of polygonsOf(e)) {
    if (signedArea(outer) < 0) outer = outer.slice().reverse();
    outer = simplifyRing(outer, 0.15);
    holes = holes.map((h) => simplifyRing(signedArea(h) > 0 ? h.slice().reverse() : h, 0.15));
    const area = Math.abs(signedArea(outer)) - holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
    if (area < 4) continue;
    if (!outer.every((p) => inBox(p, 2))) continue;
    records.push({ e, t, key, isPart, outer, holes, area, c: centroid(outer) });
  }
}
const outlines = records.filter((r) => !r.isPart), parts = records.filter((r) => r.isPart);
for (const p of parts) {
  let best = null;
  for (const o of outlines) if (inside(p.c, o.outer) && (!best || o.area < best.area)) best = o;
  p.parent = best;
  if (best) best.partArea = (best.partArea || 0) + p.area;
}

function groundStats(outer, holes) {
  const hs = outer.slice(0, -1).map(([x, y]) => H(x, y));
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const step = Math.max(2, Math.min(x1 - x0, y1 - y0) / 6);
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) {
    if (inside([x, y], outer) && !holes.some((h) => inside([x, y], h))) hs.push(H(x, y));
  }
  hs.sort((a, b) => a - b);
  return { min: hs[0], med: hs[Math.floor(hs.length / 2)], max: hs[hs.length - 1] };
}

const info = [];
const infoOf = new Map();
const out = [];
let campusCount = 0;
for (const r of [...outlines, ...parts]) {
  const t = r.t;
  const host = r.isPart ? r.parent : r;
  const hostKey = host ? host.key : r.key;
  const cur = BUILDINGS[hostKey];
  const btype = t.building || t['building:part'] || 'yes';
  const campus = !!cur || inCampus((host || r).c) || /university of toronto/i.test(t.operator || '');
  const g = groundStats(r.outer, r.holes);

  // ----- heights
  let height = null, hsrc = 'est';
  const levels = (r.isPart ? num(t['building:levels']) : (cur && cur.levels) || num(t['building:levels'])) || null;
  const residential = RESID.has(btype) || HOUSE.has(btype) || (cur && cur.cat === 'res');
  const floorH = residential ? 3.1 : campus ? 4.0 : 3.5;
  if (!r.isPart && cur && cur.height) { height = cur.height; hsrc = cur.hs || 'official'; }
  else if (num(t.height)) { height = num(t.height); hsrc = 'osm'; }
  else if (levels) { height = levels * floorH + (campus ? 1.2 : 0.4); hsrc = r.isPart || !(cur && cur.levels) ? 'osm' : cur.hs || 'est'; }
  else if (HOUSE.has(btype) || btype === 'terrace') height = 6.2;
  else if (SMALL.has(btype) || t.amenity === 'shelter') height = 3;
  else if (campus) height = r.area < 100 ? 3.5 : r.area < 700 ? 6 : 10;
  else if (btype === 'apartments') height = 15;
  else height = 7;
  const minH = num(t.min_height) ?? (num(t['building:min_level']) != null ? num(t['building:min_level']) * floorH : 0);

  // ----- roof
  const name = t.name || '';
  let shape = (cur && !r.isPart && cur.roof) || t['roof:shape'] || null;
  if (!shape && (HOUSE.has(btype) || (btype === 'terrace' && !campus))) shape = 'gabled';
  if (/\bdome\b/i.test(name)) shape = 'dome';
  let roof = ROOF[shape] || 0;
  const [ox, oy, ang, hl, hw] = obb(r.outer);
  let rh = 0;
  if (roof) {
    rh = num(t['roof:height']) ?? (roof === 4 ? Math.min(hw, 10) : roof === 3 ? Math.min(hw * 0.8, 5) : Math.min(hw * 0.65, 4));
    if (roof === 4) height = rh + 0.3;
    rh = Math.min(rh, height - minH - 0.3);
    if (rh < 0.5) { roof = 0; rh = 0; }
  }

  // ----- placement on the terrain: the wall starts below the lowest ground point and the roof is
  // measured from the median ground level, so buildings on slopes expose more storeys downhill
  const ground = g.med;
  const zb = g.min - 0.6 + minH;
  const zt = ground + height;
  const zw = zt - rh;

  // ----- colours
  const seed = h32(r.key);
  let fc = (cur && !r.isPart && cur.color) || colour(t['building:colour']);
  if (!fc) {
    if (campus) fc = CONCRETE[seed % CONCRETE.length];
    else if (HOUSE.has(btype) || btype === 'terrace') fc = (seed >> 3) % 3 ? BRICK[seed % BRICK.length] : SIDING[seed % SIDING.length];
    else fc = CONCRETE[seed % CONCRETE.length];
  }
  let rc = (cur && !r.isPart && cur.roofColor) || colour(t['roof:colour']);
  if (!rc) rc = roof ? ROOFS[(seed >> 5) % ROOFS.length] : null;

  // ----- info
  let ii = -1;
  if (campus) {
    if (!infoOf.has(hostKey)) {
      const base = host || r;
      const ht = base.t;
      const c = BUILDINGS[hostKey] || {};
      const lp = labelPoint(base.outer, base.holes);
      const rec = {
        id: hostKey,
        code: c.code || '',
        en: c.en || ht.name || '',
        zh: c.zh || ht['name:zh'] || '',
        cat: c.cat || (CATEGORIES[ht.amenity] ? ht.amenity : 'ops'),
        year: c.year || null,
        when: c.when || null,
        arch: c.arch || '',
        desc: c.desc || null,
        status: c.status || null,
        isNew: !!c.isNew,
        group: c.group ? BUILDINGS[c.group] && { en: BUILDINGS[c.group].en, zh: BUILDINGS[c.group].zh } : null,
        facade: c.facade || (HOUSE.has(btype) ? 'house' : SMALL.has(btype) ? 'shed' : 'punched'),
        addr: [ht['addr:housenumber'], ht['addr:street']].filter(Boolean).join(' '),
        wikidata: ht.wikidata || '',
        wikipedia: ht.wikipedia || '',
        osmType: (base.e.type === 'way' ? 'way' : 'relation'), osmId: base.e.id,
        levels: (c.levels || num(ht['building:levels'])) || null,
        height: Math.round(height * 10) / 10, hs: hsrc,
        area: Math.round(base.area),
        ground: Math.round(ground * 10) / 10,
        lp: [Math.round(lp[0] * 10) / 10, Math.round(lp[1] * 10) / 10],
        top: Math.round(zt * 10) / 10,
      };
      if (!rec.en) rec.en = ht['building'] === 'roof' || ht.amenity === 'shelter' ? 'Shelter' : '';
      infoOf.set(hostKey, info.length);
      info.push(rec);
      campusCount++;
    }
    ii = infoOf.get(hostKey);
  }

  const b = {
    o: encRing(r.outer),
    z: [Math.round(zb * 10), Math.round(zw * 10), Math.round(zt * 10)],
    c: pal(fc),
  };
  if (r.holes.length) b.h = r.holes.map(encRing);
  if (roof) { b.r = roof; b.x = [Math.round(ox * 10), Math.round(oy * 10), Math.round(ang * 1000), Math.round(hl * 10), Math.round(hw * 10)]; }
  if (rc) b.rc = pal(rc);
  if (ii >= 0) b.i = ii;
  else {
    b.k = CTX.indexOf(ctxClass(t));
    if (name) b.n = name;
  }
  if (levels) b.l = Math.round(levels);
  if (r.isPart) b.p = 1;
  if (!r.isPart && r.partArea && r.partArea >= 0.5 * r.area) b.skip = 1; // drawn by its parts
  out.push(b);
}
// overall height of a campus building = tallest piece
for (const b of out) if (b.i != null) info[b.i].top = Math.max(info[b.i].top, b.z[2] / 10);

// ---------------------------------------------------------------- landscape
const land = load('landscape').elements;
const areas = {};
const AREA_ORDER = ['residential', 'commercial', 'industrial', 'institutional', 'park', 'grass', 'meadow', 'garden', 'farm',
  'scrub', 'wood', 'wetland', 'sports', 'pitch', 'track', 'playground', 'plaza', 'parking', 'construction', 'water', 'pool'];
function areaKind(t) {
  if (t.building) return null;
  if (t.amenity === 'parking') return ['underground', 'multi-storey', 'rooftop'].includes(t.parking) ? null : 'parking';
  if (t.natural === 'water' || ['reservoir', 'basin'].includes(t.landuse)) return 'water';
  if (t.leisure === 'swimming_pool') return 'pool';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'wood';
  if (t.natural === 'scrub') return 'scrub';
  if (t.natural === 'wetland') return 'wetland';
  if (t.natural === 'grassland' || t.landuse === 'meadow') return 'meadow';
  if (t.leisure === 'pitch') return 'pitch';
  if (t.leisure === 'track') return 'track';
  if (t.leisure === 'playground') return 'playground';
  if (t.leisure === 'sports_centre' || t.leisure === 'stadium') return 'sports';
  if (['allotments', 'farmland', 'orchard'].includes(t.landuse)) return 'farm';
  if (t.leisure === 'garden') return 'garden';
  if (t.leisure === 'park' || t.landuse === 'recreation_ground' || t.landuse === 'village_green') return 'park';
  if (t.landuse === 'grass' || t.man_made === 'reservoir_covered') return 'grass';
  if (t.landuse === 'construction') return 'construction';
  if (t.landuse === 'residential') return 'residential';
  if (['retail', 'commercial'].includes(t.landuse)) return 'commercial';
  if (['industrial', 'garages', 'railway'].includes(t.landuse)) return 'industrial';
  if (['religious', 'cemetery', 'education'].includes(t.landuse)) return 'institutional';
  if ((t.highway === 'pedestrian' || t.highway === 'footway') && t.area === 'yes') return 'plaza';
  if (['outdoor_seating', 'bleachers', 'firepit'].includes(t.leisure)) return 'plaza';
  return null;
}
const labels = [];
const pushLabel = (kind, name, x, y, size) => labels.push({ t: kind, en: name, zh: PLACE_ZH[name] || '', x: Math.round(x), y: Math.round(y), s: Math.round(size) });
const seenAreaLabel = new Set();
const polysByKind = {};
for (const e of land) {
  const t = e.tags || {};
  const kind = areaKind(t);
  if (!kind) continue;
  for (const [outer, holes] of polygonsOf(e)) {
    const o = clipRing(outer, X0, Y0, X1, Y1);
    if (!o.length) continue;
    const so = simplifyRing(o, 0.3);
    const hs = holes.map((h) => clipRing(h, X0, Y0, X1, Y1)).filter((h) => h.length).map((h) => simplifyRing(h, 0.3));
    (areas[kind] ||= []).push([encRing(so), ...hs.map(encRing)]);
    (polysByKind[kind] ||= []).push([so, hs, t]);
    const a = Math.abs(signedArea(so));
    const name = t.name;
    if (name && a > 600 && !seenAreaLabel.has(name) && !/^Parking Lot/.test(name)) {
      seenAreaLabel.add(name);
      const lp = labelPoint(so, hs);
      pushLabel(kind === 'water' ? 'water' : kind === 'parking' ? 'parking' : 'area', name, lp[0], lp[1], Math.sqrt(a));
    }
  }
}
for (const k of Object.keys(areas)) if (!AREA_ORDER.includes(k)) console.warn('unordered area kind', k);

// ----- roads and paths
const ROAD = {
  motorway: ['motorway', 11], motorway_link: ['link', 6.5], trunk: ['primary', 13], trunk_link: ['link', 6.5],
  primary: ['primary', 14], primary_link: ['link', 6.5], secondary: ['secondary', 13], secondary_link: ['link', 6.5],
  tertiary: ['tertiary', 10], tertiary_link: ['link', 6], residential: ['street', 8], unclassified: ['street', 7.5],
  living_street: ['street', 6], service: ['service', 5.5], track: ['track', 3], pedestrian: ['path', 4],
  footway: ['path', 2.2], path: ['trail', 1.8], cycleway: ['path', 2.6], steps: ['steps', 2.2], bridleway: ['trail', 2],
};
const ROAD_CLASSES = ['motorway', 'link', 'primary', 'secondary', 'tertiary', 'street', 'service', 'track', 'path', 'trail', 'steps'];
const roads = [];
const roadNames = new Map();
const roadPieces = []; // kept for the tree mask
for (const e of land) {
  const t = e.tags || {};
  const hw = t.highway;
  if (!hw || !ROAD[hw] || t.area === 'yes') continue;
  if (t.indoor === 'yes' || t.tunnel === 'yes' || t.tunnel === 'building_passage' || (num(t.layer) || 0) < 0) continue;
  let [cls, width] = ROAD[hw];
  if (hw === 'service') width = t.service === 'parking_aisle' ? 5 : t.service === 'driveway' ? 3.2 : 5.5;
  if (hw === 'path' && /paved|asphalt|concrete/.test(t.surface || '')) cls = 'path';
  const lanes = num(t.lanes);
  if (lanes && ['primary', 'secondary', 'tertiary', 'motorway'].includes(cls)) width = Math.max(width, lanes * 3.3 + 1);
  const g = geomOf(e.geometry);
  for (const piece of clipLine(g, X0 + 0.5, Y0 + 0.5, X1 - 0.5, Y1 - 0.5)) {
    const pts = dp(piece, 0.25);
    roads.push([ROAD_CLASSES.indexOf(cls), Math.round(width * 10), t.bridge && t.bridge !== 'no' ? 1 : 0, ...enc(pts)]);
    roadPieces.push([pts, width]);
    const name = t.name;
    if (name && ['motorway', 'primary', 'secondary', 'tertiary', 'street', 'service'].includes(cls)) {
      let L = 0;
      for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      const prev = roadNames.get(name);
      if (!prev || L > prev.L) roadNames.set(name, { L, pts, cls });
    }
  }
}
const ROAD_ZH = {};
for (const [name, { L, pts, cls }] of roadNames) {
  if (L < (cls === 'service' ? 60 : 120)) continue;
  // label at the middle of the named road's longest piece
  let acc = 0, half = L / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (acc + d >= half) {
      const f = (half - acc) / d;
      const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
      const ang = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      labels.push({ t: 'road', en: name, zh: ROAD_ZH[name] || '', x: Math.round(x), y: Math.round(y), s: Math.round(L), a: Math.round(ang * 100) / 100, c: cls });
      break;
    }
    acc += d;
  }
}

// ----- waterways
const water = [];
const WATER_W = { river: 9, stream: 3.5, canal: 6, drain: 1.6, ditch: 1.4 };
for (const e of land) {
  const t = e.tags || {};
  if (!t.waterway || !WATER_W[t.waterway] || t.tunnel) continue;
  const g = geomOf(e.geometry);
  for (const piece of clipLine(g, X0, Y0, X1, Y1)) water.push([Math.round(WATER_W[t.waterway] * 10), ...enc(dp(piece, 0.4))]);
  if (t.name && t.waterway === 'river' && !seenAreaLabel.has(t.name)) {
    const inner = g.filter((p) => inBox(p, 60));
    if (inner.length) {
      seenAreaLabel.add(t.name);
      const p = inner[Math.floor(inner.length / 2)];
      pushLabel('water', t.name, p[0], p[1], 400);
    }
  }
}

// ---------------------------------------------------------------- trees
// occupancy mask at 1 m: buildings, roads, water and hard surfaces where no tree can stand
const MW = Math.ceil(X1 - X0) + 1, MH = Math.ceil(Y1 - Y0) + 1;
const mask = new Uint8Array(MW * MH);
function fillPoly(ring, val = 1) {
  let y0 = 1e9, y1 = -1e9;
  for (const [, y] of ring) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  for (let y = Math.max(Y0, Math.floor(y0)); y <= Math.min(Y1, Math.ceil(y1)); y++) {
    const xs = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const [xa, ya] = ring[i], [xb, yb] = ring[i + 1];
      if ((ya <= y + 0.5) !== (yb <= y + 0.5)) xs.push(xa + ((y + 0.5 - ya) * (xb - xa)) / (yb - ya));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(X0, Math.ceil(xs[k])); x <= Math.min(X1, Math.floor(xs[k + 1])); x++) mask[(y - Y0) * MW + (x - X0)] = val;
    }
  }
}
function strokeLine(pts, width) {
  const r = width / 2 + 1.2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L));
    for (let s = 0; s <= n; s++) {
      const cx = ax + ((bx - ax) * s) / n, cy = ay + ((by - ay) * s) / n;
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        if (x < X0 || x > X1 || y < Y0 || y > Y1 || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        mask[(y - Y0) * MW + (x - X0)] = 1;
      }
    }
  }
}
for (const r of records) fillPoly(r.outer.map(([x, y], i) => [x, y]));
for (const [pts, w] of roadPieces) strokeLine(pts, w);
for (const k of ['water', 'pool', 'parking', 'pitch', 'track', 'plaza', 'construction']) for (const [o] of polysByKind[k] || []) fillPoly(o);
const free = (x, y) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1 && !mask[(Math.round(y) - Y0) * MW + (Math.round(x) - X0)];

let rngState = 20261020;
const rnd = () => { rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0; return rngState / 4294967296; };
const trees = [];
// kind: 0 broadleaf, 1 conifer, 2 shrub; heights in decimetres
// stored as deltas from the previous tree (decimetres) to keep the file small
let tpx = 0, tpy = 0;
const addTree = (x, y, h, k) => {
  const ix = Math.round(x * 10), iy = Math.round(y * 10);
  trees.push(ix - tpx, iy - tpy, Math.round(h * 10), k);
  tpx = ix; tpy = iy;
};
const nodes = load('nodes').elements;
let mapped = 0;
for (const nd of nodes) {
  const t = nd.tags || {};
  if (t.natural !== 'tree') continue;
  const [x, y] = proj(nd);
  if (!inBox([x, y], 1)) continue;
  const conifer = t.leaf_type === 'needleleaved' || /pinus|picea|abies|thuja|tsuga|larix/i.test(t.genus || t.species || '');
  addTree(x, y, num(t.height) || 7 + rnd() * 6, conifer ? 1 : 0);
  mapped++;
}
for (const e of land) {
  const t = e.tags || {};
  if (t.natural !== 'tree_row') continue;
  const g = geomOf(e.geometry);
  for (let i = 0; i < g.length - 1; i++) {
    const L = Math.hypot(g[i + 1][0] - g[i][0], g[i + 1][1] - g[i][1]);
    for (let s = 0; s < L; s += 7) {
      const x = g[i][0] + ((g[i + 1][0] - g[i][0]) * s) / L, y = g[i][1] + ((g[i + 1][1] - g[i][1]) * s) / L;
      if (inBox([x, y], 1)) addTree(x, y, 8 + rnd() * 5, 0);
    }
  }
}
// woodland: jittered grid inside OSM wood / forest / scrub / wetland polygons
let woodN = 0;
for (const [kind, spacing] of [['wood', 7.5], ['scrub', 6], ['wetland', 10]]) {
  for (const [o, hs] of polysByKind[kind] || []) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of o) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (let gx = x0; gx < x1; gx += spacing) for (let gy = y0; gy < y1; gy += spacing) {
      const x = gx + rnd() * spacing, y = gy + rnd() * spacing;
      if (!inside([x, y], o) || hs.some((h) => inside([x, y], h)) || !free(x, y)) continue;
      if (kind === 'wood') {
        const conifer = rnd() < 0.16;
        addTree(x, y, conifer ? 11 + rnd() * 9 : 12 + rnd() * 12, conifer ? 1 : 0);
      } else if (kind === 'scrub') {
        if (rnd() < 0.3) addTree(x, y, 6 + rnd() * 5, 0); else addTree(x, y, 1.8 + rnd() * 2.2, 2);
      } else addTree(x, y, 2 + rnd() * 3, 2);
      woodN++;
    }
  }
}

// ---------------------------------------------------------------- points of interest
const POI = {
  bus_station: 'bus', cafe: 'food', fast_food: 'food', restaurant: 'food', food_court: 'food', ice_cream: 'food', bar: 'food',
  library: 'library', bicycle_rental: 'bike', charging_station: 'ev', atm: 'atm', pharmacy: 'pharmacy', theatre: 'theatre',
  police: 'safety', student_union: 'student',
};
const pois = [];
for (const nd of nodes) {
  const t = nd.tags || {};
  let type = POI[t.amenity] || (t.tourism === 'gallery' ? 'gallery' : t.tourism === 'artwork' ? 'art' : t.tourism === 'information' && t.information === 'office' ? 'info' : null);
  if (!type && t.highway === 'bus_stop') type = 'stop';
  if (!type) continue;
  const [x, y] = proj(nd);
  if (!inBox([x, y], 5)) continue;
  if (type === 'stop' && !inCampus([x, y]) && !campusRings.some((r) => r.some((p, i) => i < r.length - 1 && segDist([x, y], p, r[i + 1]) < 60))) continue;
  pois.push({ t: type, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, n: t.name || '', h: Math.round(H(x, y) * 10) / 10 });
}

// ---------------------------------------------------------------- write
const osmBase = load('buildings').osm3s?.timestamp_osm_base || '';
const data = {
  v: 1,
  generated: new Date().toISOString().slice(0, 10),
  osm: osmBase,
  origin: [LAT0, LON0],
  bounds: [X0, Y0, X1, Y1],
  terrain: { nx: NX, ny: NY, dx: DX, x0: X0, y0: Y0, base: BASE, unit: 0.01, file: 'terrain.bin' },
  categories: CATEGORIES,
  ctx: CTX.map((k) => ({ en: k, zh: CTX_ZH[k] })),
  roadClasses: ROAD_CLASSES,
  palette,
  info,
  buildings: out,
  areas: Object.fromEntries(AREA_ORDER.filter((k) => areas[k]).map((k) => [k, areas[k]])),
  roads,
  water,
  trees,
  labels,
  pois,
  boundary,
  sources: SOURCES,
};
const json = JSON.stringify(data);
writeFileSync(join(OUT, 'campus.json'), json);
console.log(`buildings ${out.length} (${campusCount} campus records, ${parts.length} parts), roads ${roads.length}, water ${water.length}`);
console.log(`areas ${Object.entries(areas).map(([k, v]) => `${k}:${v.length}`).join(' ')}`);
console.log(`trees ${trees.length / 4} (${mapped} mapped, ${woodN} woodland), labels ${labels.length}, pois ${pois.length}`);
console.log(`campus.json ${(json.length / 1024).toFixed(0)} KB, gzip ${(gzipSync(json).length / 1024).toFixed(0)} KB`);
