// Scene construction: lidar terrain, painted ground, roads and water draped on it,
// extruded buildings with procedural facades, and instanced trees.
// World axes: x = metres east, y = metres above DATUM, z = metres south (−north).
import * as THREE from 'three';

export const DATUM = 100;

export function decodeLine(a, from = 0) {
  const pts = [];
  let x = 0, y = 0;
  for (let i = from; i < a.length; i += 2) {
    x += a[i]; y += a[i + 1];
    pts.push([x / 10, y / 10]);
  }
  return pts;
}

const hash = (n) => {
  let h = (n | 0) * 374761393;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------- terrain
export class Terrain {
  constructor(spec, heights, bounds) {
    Object.assign(this, spec);
    this.h = heights;
    this.bounds = bounds;
    let lo = Infinity, hi = -Infinity;
    for (const v of heights) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    this.min = lo; this.max = hi;
  }
  // elevation (m) at local x (east), y (north); same triangle split as the mesh and the build tools
  height(x, y) {
    const { nx, ny, dx, x0, y0, h } = this;
    let fx = (x - x0) / dx, fy = (y - y0) / dx;
    fx = Math.min(nx - 1.000001, Math.max(0, fx));
    fy = Math.min(ny - 1.000001, Math.max(0, fy));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const k = j * nx + i;
    const h00 = h[k], h10 = h[k + 1], h01 = h[k + nx], h11 = h[k + nx + 1];
    return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h01 - h00) * v + (h11 - h01) * u;
  }
  worldY(x, z) { return this.height(x, -z) - DATUM; }
  normal(x, y, out) {
    const e = this.dx;
    const hx = (this.height(x + e, y) - this.height(x - e, y)) / (2 * e);
    const hy = (this.height(x, y + e) - this.height(x, y - e)) / (2 * e);
    return out.set(-hx, 1, hy).normalize();
  }
}

export function buildTerrainMeshes(T, material, sideMaterial) {
  const group = new THREE.Group();
  const [X0, Y0, X1, Y1] = T.bounds;
  const CH = 48;
  const cellsX = T.nx - 1, cellsY = T.ny - 1;
  const nrm = new THREE.Vector3();
  for (let cj = 0; cj < cellsY; cj += CH) {
    for (let ci = 0; ci < cellsX; ci += CH) {
      const w = Math.min(CH, cellsX - ci), hh = Math.min(CH, cellsY - cj);
      const nv = (w + 1) * (hh + 1);
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
      let k = 0;
      for (let j = 0; j <= hh; j++) {
        for (let i = 0; i <= w; i++, k++) {
          const gi = ci + i, gj = cj + j;
          const x = T.x0 + gi * T.dx, y = T.y0 + gj * T.dx;
          const e = T.h[gj * T.nx + gi];
          pos[k * 3] = x; pos[k * 3 + 1] = e - DATUM; pos[k * 3 + 2] = -y;
          const il = Math.max(0, gi - 1), ir = Math.min(T.nx - 1, gi + 1), jd = Math.max(0, gj - 1), ju = Math.min(T.ny - 1, gj + 1);
          const hx = (T.h[gj * T.nx + ir] - T.h[gj * T.nx + il]) / ((ir - il) * T.dx);
          const hy = (T.h[ju * T.nx + gi] - T.h[jd * T.nx + gi]) / ((ju - jd) * T.dx);
          nrm.set(-hx, 1, hy).normalize();
          nor[k * 3] = nrm.x; nor[k * 3 + 1] = nrm.y; nor[k * 3 + 2] = nrm.z;
          uv[k * 2] = (x - X0) / (X1 - X0); uv[k * 2 + 1] = (y - Y0) / (Y1 - Y0);
        }
      }
      const idx = new Uint32Array(w * hh * 6);
      let q = 0;
      for (let j = 0; j < hh; j++) {
        for (let i = 0; i < w; i++) {
          const a = j * (w + 1) + i, b = a + 1, c = a + w + 2, d = a + w + 1;
          idx[q++] = a; idx[q++] = b; idx[q++] = c;
          idx[q++] = a; idx[q++] = c; idx[q++] = d;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, material);
      m.receiveShadow = true;
      m.castShadow = true;
      group.add(m);
    }
  }
  // the cut faces of the block, so the model reads as a slice of ground
  const bottom = 58 - DATUM;
  const side = (pts) => {
    const n = pts.length;
    const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), idx = [];
    let L = 0;
    pts.forEach(([x, y], i) => {
      if (i) L += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
      const top = T.height(x, y) - DATUM;
      pos.set([x, top, -y, x, bottom, -y], i * 6);
      uv.set([L / 40, (top - bottom) / 40, L / 40, 0], i * 4);
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const edge = (fx, fy, n) => Array.from({ length: n }, (_, i) => [fx(i), fy(i)]);
  const xs = (j) => edge((i) => T.x0 + i * T.dx, () => T.y0 + j * T.dx, T.nx);
  const ys = (i) => edge(() => T.x0 + i * T.dx, (j) => T.y0 + j * T.dx, T.ny);
  // walk each edge so the face points outward (counter-clockwise seen from outside)
  for (const pts of [xs(0), ys(T.nx - 1), xs(T.ny - 1).reverse(), ys(0).reverse()]) {
    const m = new THREE.Mesh(side(pts), sideMaterial);
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

// ---------------------------------------------------------------- ground painting
const GROUND = {
  base: '#b7bea0', residential: '#c2c4ae', commercial: '#c6c2b8', industrial: '#bfb9ae', institutional: '#c3c3b2',
  park: '#a3bf7f', grass: '#9cbe76', meadow: '#b3c287', garden: '#8fbb6d', farm: '#c2b47f', scrub: '#8ea567',
  wood: '#6a8048', wetland: '#86a586', sports: '#b2c592', pitch: '#6eac4c', track: '#b4614f', playground: '#d4c094',
  plaza: '#d8d1c3', parking: '#9a9da0', construction: '#c8b08a', water: '#5b8db4', pool: '#6cc0de',
};
// seasonal tint for living surfaces, by day of year
function seasonGround(kind, doy) {
  const base = new THREE.Color(GROUND[kind]);
  const living = ['park', 'grass', 'meadow', 'garden', 'scrub', 'wood', 'wetland', 'sports', 'base', 'residential', 'farm'];
  if (!living.includes(kind)) return base;
  const fall = new THREE.Color(kind === 'wood' ? '#7d6f42' : kind === 'farm' ? '#b9a06c' : '#aeb070');
  const winter = new THREE.Color(kind === 'wood' ? '#a9a99b' : '#e3e7e6');
  const spring = new THREE.Color(kind === 'wood' ? '#6f8f45' : '#a6c97a');
  if (doy >= 349 || doy < 74) return base.lerp(winter, kind === 'base' || kind === 'residential' ? 0.65 : 0.8); // snow cover
  if (doy < 135) return base.lerp(spring, 0.5);
  if (doy >= 265) return base.lerp(fall, Math.min(1, (doy - 265) / 60) * 0.6);
  return base;
}

export function paintGround(data, scale, doy) {
  const [X0, Y0, X1, Y1] = data.bounds;
  const W = Math.round((X1 - X0) * scale), H = Math.round((Y1 - Y0) * scale);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const css = (c) => '#' + c.getHexString();
  g.fillStyle = css(seasonGround('base', doy));
  g.fillRect(0, 0, W, H);
  const path = (rings) => {
    g.beginPath();
    for (const r of rings) {
      const pts = decodeLine(r);
      pts.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, (x - X0) * scale, (Y1 - y) * scale));
      g.closePath();
    }
  };
  for (const [kind, polys] of Object.entries(data.areas)) {
    g.fillStyle = css(seasonGround(kind, doy));
    for (const p of polys) { path(p); g.fill('evenodd'); }
    if (kind === 'pitch' || kind === 'track' || kind === 'parking') {
      g.strokeStyle = kind === 'parking' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.75)';
      g.lineWidth = Math.max(1, scale * (kind === 'parking' ? 0.25 : 0.18));
      for (const p of polys) { path(p.slice(0, 1)); g.stroke(); }
    }
  }
  // subtle mottling so large lawns and forest floor do not look like flat paint
  const img = g.getImageData(0, 0, W, H), d = img.data;
  let s = 1;
  for (let i = 0; i < d.length; i += 4) {
    s = (s * 16807) % 2147483647;
    const n = ((s & 255) - 128) * 0.035;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// ---------------------------------------------------------------- ribbons (roads, paths, streams)
export const ROAD_STYLE = {
  motorway: { color: '#5d6166', lift: 0.30, order: 1 },
  link: { color: '#666a6f', lift: 0.31, order: 2 },
  primary: { color: '#63676c', lift: 0.32, order: 3 },
  secondary: { color: '#686c71', lift: 0.33, order: 4 },
  tertiary: { color: '#6d7176', lift: 0.34, order: 5 },
  street: { color: '#74787c', lift: 0.35, order: 6 },
  service: { color: '#808386', lift: 0.36, order: 7 },
  track: { color: '#a69a83', lift: 0.37, order: 8 },
  trail: { color: '#b9a888', lift: 0.38, order: 9 },
  path: { color: '#d9d2c4', lift: 0.40, order: 10 },
  steps: { color: '#c9c0b0', lift: 0.41, order: 11 },
};

function ribbonGeometry(lines, T) {
  // lines: [{pts, width, lift, bridge}]
  const pos = [], nor = [], idx = [];
  const n = new THREE.Vector3();
  for (const { pts: raw, width, lift, bridge } of lines) {
    // resample so the ribbon follows the terrain between vertices
    const pts = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
      const [ax, ay] = raw[i - 1], [bx, by] = raw[i];
      const L = Math.hypot(bx - ax, by - ay), m = Math.max(1, Math.ceil(L / 2.5));
      for (let s = 1; s <= m; s++) pts.push([ax + ((bx - ax) * s) / m, ay + ((by - ay) * s) / m]);
    }
    if (pts.length < 2) continue;
    const hw = width / 2;
    let total = 0;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push((total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])));
    const hA = T.height(...pts[0]), hB = T.height(...pts[pts.length - 1]);
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      // miter: scale the offset by 1/cos(half the turn), capped
      let mx = -ty, my = tx, scale = 1;
      if (i > 0 && i < pts.length - 1) {
        const d1x = p[0] - a[0], d1y = p[1] - a[1], l1 = Math.hypot(d1x, d1y) || 1;
        const nx1 = -d1y / l1, ny1 = d1x / l1;
        const dotv = mx * nx1 + my * ny1;
        scale = 1 / Math.max(0.4, Math.abs(dotv));
      }
      for (const side of [-1, 1]) {
        const x = p[0] + mx * hw * side * scale, y = p[1] + my * hw * side * scale;
        const h = bridge ? hA + (hB - hA) * (cum[i] / (total || 1)) + 0.6 : T.height(x, y);
        pos.push(x, h + lift - DATUM, -y);
        if (bridge) nor.push(0, 1, 0);
        else { T.normal(x, y, n); nor.push(n.x, n.y, n.z); }
      }
      if (i < pts.length - 1) {
        const k = base + i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

export function buildRoads(data, T) {
  const group = new THREE.Group();
  const byClass = {};
  for (const r of data.roads) {
    const cls = data.roadClasses[r[0]];
    (byClass[cls] ||= []).push({ pts: decodeLine(r, 3), width: r[1] / 10, lift: ROAD_STYLE[cls].lift, bridge: !!r[2] });
  }
  for (const [cls, lines] of Object.entries(byClass)) {
    const st = ROAD_STYLE[cls];
    const mat = new THREE.MeshStandardMaterial({
      color: st.color, roughness: 0.92, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 - st.order, depthWrite: false,
    });
    const m = new THREE.Mesh(ribbonGeometry(lines, T), mat);
    m.renderOrder = 2 + st.order;
    m.receiveShadow = true;
    m.userData.cls = cls;
    group.add(m);
  }
  return group;
}

export function buildWater(data, T) {
  const lines = data.water.map((w) => ({ pts: decodeLine(w, 1), width: w[0] / 10, lift: 0.22, bridge: false }));
  const mat = new THREE.MeshStandardMaterial({
    color: '#4a83ad', roughness: 0.18, metalness: 0.05,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false,
  });
  const m = new THREE.Mesh(ribbonGeometry(lines, T), mat);
  m.renderOrder = 2;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- buildings
export const FACADE = { punched: 0, brutalist: 1, curtain: 2, residential: 3, townhouse: 4, house: 4, parking: 5, copper: 6, timber: 7, stone: 8, shed: 9 };
const FLOOR_H = [3.8, 4.0, 4.0, 3.1, 2.9, 3.9, 4.2, 4.2, 3.4, 3.0];

const BUILDING_GLSL_COMMON = /* glsl */ `
attribute float aBid;
attribute vec4 aWall;
attribute vec2 aGrow;
uniform float uYear;
uniform float uTimeline;
uniform float uHideCtx;
varying float vBid;
varying vec4 vWall;
`;
const BUILDING_GLSL_GROW = /* glsl */ `
vec3 transformed = vec3(position);
float grow = 1.0;
if (uTimeline > 0.5 && aGrow.y > 0.5) grow = clamp((uYear - aGrow.y) * 1.25 + 1.0, 0.0, 1.0);
if (uHideCtx > 0.5 && aGrow.y < -0.5) grow = 0.0;
transformed.y = aGrow.x + (transformed.y - aGrow.x) * grow;
vBid = aBid;
vWall = aWall;
`;

function makeBuildingMaterial() {
  const uniforms = {
    uYear: { value: 2026 }, uTimeline: { value: 0 }, uHideCtx: { value: 0 }, uHover: { value: -1 }, uSel: { value: -1 },
    uNight: { value: 0 }, uSelColor: { value: new THREE.Color('#2f7bff') }, uDim: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + BUILDING_GLSL_COMMON)
      .replace('#include <begin_vertex>', BUILDING_GLSL_GROW);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
uniform float uHover;
uniform float uSel;
uniform float uNight;
uniform float uDim;
uniform vec3 uSelColor;
varying float vBid;
varying vec4 vWall;
float winLit;
float winMask;
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float facadeWindows(vec4 w, float bid, out float lit) {
  lit = 0.0;
  float style = w.z;
  if (style < -0.5 || style > 8.5 || w.y < 0.7) return 0.0;
  float lh = max(w.w, 2.4);
  float bay = 3.2, x0 = 0.2, x1 = 0.8, y0 = 0.32, y1 = 0.82;
  if (style > 0.5 && style < 1.5) { bay = 7.0; x0 = 0.03; x1 = 0.97; y0 = 0.50; y1 = 0.80; }
  else if (style > 1.5 && style < 2.5) { bay = 1.7; x0 = 0.07; x1 = 0.93; y0 = 0.08; y1 = 0.93; }
  else if (style > 2.5 && style < 3.5) { bay = 3.0; x0 = 0.26; x1 = 0.74; y0 = 0.34; y1 = 0.80; }
  else if (style > 3.5 && style < 4.5) { bay = 4.4; x0 = 0.32; x1 = 0.68; y0 = 0.34; y1 = 0.78; }
  else if (style > 4.5 && style < 5.5) { bay = 9.0; x0 = 0.0; x1 = 1.0; y0 = 0.40; y1 = 0.86; }
  else if (style > 5.5 && style < 6.5) { bay = 2.6; x0 = 0.36; x1 = 0.64; y0 = 0.08; y1 = 0.92; }
  else if (style > 6.5 && style < 7.5) { bay = 5.5; x0 = 0.18; x1 = 0.82; y0 = 0.30; y1 = 0.76; }
  else if (style > 7.5) { bay = 3.8; x0 = 0.34; x1 = 0.66; y0 = 0.30; y1 = 0.76; }
  vec2 q = vec2(w.x / bay, w.y / lh);
  vec2 f = fract(q);
  vec2 fw = max(fwidth(q), vec2(1e-4));
  float m = smoothstep(x0 - fw.x, x0 + fw.x, f.x) * (1.0 - smoothstep(x1 - fw.x, x1 + fw.x, f.x))
          * smoothstep(y0 - fw.y, y0 + fw.y, f.y) * (1.0 - smoothstep(y1 - fw.y, y1 + fw.y, f.y));
  // windows smaller than a pixel would shimmer: fade them into an average tone instead
  float coverage = (x1 - x0) * (y1 - y0);
  float fade = smoothstep(0.55, 0.25, max(fw.x, fw.y));
  m = mix(coverage * 0.8, m, fade);
  float r = hash13(vec3(floor(q.x), floor(q.y), bid));
  lit = style > 4.5 && style < 5.5 ? 0.6 : step(0.42, r) * (0.65 + 0.35 * fract(r * 7.13));
  return m;
}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
winMask = facadeWindows(vWall, vBid, winLit);
vec3 glass = (vWall.z > 4.5 && vWall.z < 5.5) ? vec3(0.035, 0.037, 0.04) : vec3(0.11, 0.15, 0.19);
diffuseColor.rgb = mix(diffuseColor.rgb, glass, winMask * 0.88);
if (abs(vBid - uSel) < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, uSelColor, 0.22);
else if (abs(vBid - uHover) < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, uSelColor, 0.12);
`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.22, winMask);')
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance += winMask * winLit * uNight * vec3(1.0, 0.72, 0.38) * 1.6;
if (abs(vBid - uSel) < 0.5) totalEmissiveRadiance += uSelColor * 0.05;`);
  };
  mat.customProgramCacheKey = () => 'twin-building-v1';
  mat.userData.uniforms = uniforms;
  // the shadow pass must apply the same timeline growth
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + BUILDING_GLSL_COMMON)
      .replace('#include <begin_vertex>', BUILDING_GLSL_GROW);
  };
  depth.customProgramCacheKey = () => 'twin-building-depth-v1';
  return { mat, depth, uniforms };
}

export function buildBuildings(data, T) {
  const { mat, depth, uniforms } = makeBuildingMaterial();
  const TILE = 420;
  const tiles = new Map();
  const recs = [];
  const col = new THREE.Color();
  const v2 = (p) => new THREE.Vector2(p[0], p[1]);
  data.buildings.forEach((b, bi) => {
    const outer = decodeLine(b.o), holes = (b.h || []).map((h) => decodeLine(h));
    const zb = b.z[0] / 10 - DATUM, zw = b.z[1] / 10 - DATUM, zt = b.z[2] / 10 - DATUM;
    const info = b.i != null ? data.info[b.i] : null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const key = b.i != null ? 100000 + b.i : bi; // all pieces of one campus building share a key
    const rec = { bi, key, outer, holes, bbox: [x0, y0, x1, y1], zb, zw, zt, year: info && info.year ? info.year : 0, info: b.i ?? -1, ctx: b.i == null, skip: !!b.skip };
    recs.push(rec);
    if (b.skip) return;
    const style = info ? FACADE[info.facade] ?? 0 : b.r ? 4 : b.k === 7 ? 9 : b.k === 0 ? 4 : b.k === 1 ? 3 : 0;
    const levels = b.l || 0;
    const floorH = levels ? Math.max(2.6, Math.min(6, (zt - zb - 0.6) / levels)) : FLOOR_H[style];
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const tileKey = Math.floor(cx / TILE) + ',' + Math.floor(cy / TILE);
    let acc = tiles.get(tileKey);
    if (!acc) tiles.set(tileKey, (acc = { pos: [], nor: [], colReal: [], wall: [], grow: [], bid: [], idx: [] }));
    const facade = new THREE.Color(data.palette[b.c]);
    const roofCol = b.rc != null ? new THREE.Color(data.palette[b.rc]) : facade.clone().multiplyScalar(0.78);
    const push = (x, y, z, nx, ny, nz, c, wu, wv, st) => {
      acc.pos.push(x, y, z); acc.nor.push(nx, ny, nz); acc.colReal.push(c.r, c.g, c.b);
      acc.wall.push(wu, wv, st, floorH); acc.grow.push(zb, rec.ctx ? -1 : rec.year); acc.bid.push(key);
      return acc.pos.length / 3 - 1;
    };
    // walls
    const baseV = zb + 0.6;
    for (const ring of [outer, ...holes]) {
      let u = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length];
        const dx = c[0] - a[0], dy = c[1] - a[1], len = Math.hypot(dx, dy);
        if (len < 0.05) continue;
        const nx = dy / len, nz = dx / len;
        const i0 = push(a[0], zb, -a[1], nx, 0, nz, facade, u, zb - baseV, style);
        const i1 = push(c[0], zb, -c[1], nx, 0, nz, facade, u + len, zb - baseV, style);
        const i2 = push(c[0], zw, -c[1], nx, 0, nz, facade, u + len, zw - baseV, style);
        const i3 = push(a[0], zw, -a[1], nx, 0, nz, facade, u, zw - baseV, style);
        acc.idx.push(i0, i1, i2, i0, i2, i3);
        u += len;
      }
    }
    // roof
    const roofAt = (pts3, nrm) => pts3.map(([x, y, z]) => push(x, z, -y, nrm.x, nrm.y, nrm.z, roofCol, 0, 0, -1));
    const tri = (p, q, r) => {
      // p, q, r: [x, yNorth, z]; flat normal, wound counter-clockwise from outside
      const A = new THREE.Vector3(p[0], p[2], -p[1]), B = new THREE.Vector3(q[0], q[2], -q[1]), C = new THREE.Vector3(r[0], r[2], -r[1]);
      const nrm = B.clone().sub(A).cross(C.clone().sub(A)).normalize();
      if (nrm.y < 0) { nrm.negate(); acc.idx.push(...roofAt([p, r, q], nrm)); } else acc.idx.push(...roofAt([p, q, r], nrm));
    };
    if (!b.r) {
      const contour = outer.map(v2), hs = holes.map((h) => h.map(v2));
      let faces;
      try { faces = THREE.ShapeUtils.triangulateShape(contour, hs); } catch { faces = []; }
      const all = outer.concat(...holes);
      for (const [a, c, d] of faces) tri([...all[a], zt], [...all[c], zt], [...all[d], zt]);
    } else {
      const [ox, oy, ang1000, hl10, hw10] = b.x;
      const ang = ang1000 / 1000, hl = hl10 / 10, hw = hw10 / 10, ca = Math.cos(ang), sa = Math.sin(ang);
      const P = (u, v, z) => [ox / 10 + u * ca - v * sa, oy / 10 + u * sa + v * ca, z];
      // flat cap at the eaves under the pitched roof, so irregular footprints stay closed
      const contour = outer.map(v2), hs = holes.map((h) => h.map(v2));
      let faces;
      try { faces = THREE.ShapeUtils.triangulateShape(contour, hs); } catch { faces = []; }
      const all = outer.concat(...holes);
      for (const [a, c, d] of faces) tri([...all[a], zw], [...all[c], zw], [...all[d], zw]);
      if (b.r === 1) {
        const e1 = P(-hl, -hw, zw), e2 = P(hl, -hw, zw), e3 = P(hl, hw, zw), e4 = P(-hl, hw, zw), r1 = P(-hl, 0, zt), r2 = P(hl, 0, zt);
        tri(e1, e2, r2); tri(e1, r2, r1); tri(e3, e4, r1); tri(e3, r1, r2); tri(e2, e3, r2); tri(e4, e1, r1);
      } else if (b.r === 2 || b.r === 3) {
        const rl = b.r === 2 ? Math.max(0, hl - hw) : 0;
        const e1 = P(-hl, -hw, zw), e2 = P(hl, -hw, zw), e3 = P(hl, hw, zw), e4 = P(-hl, hw, zw), r1 = P(-rl, 0, zt), r2 = P(rl, 0, zt);
        tri(e1, e2, r2); tri(e1, r2, r1); tri(e3, e4, r1); tri(e3, r1, r2); tri(e2, e3, r2); tri(e4, e1, r1);
      } else {
        const SEG = 12, RINGS = 5, rh = zt - zw;
        const pt = (s, k) => {
          const th = (s / SEG) * Math.PI * 2, ph = (k / RINGS) * Math.PI / 2;
          return P(hl * Math.cos(ph) * Math.cos(th), hw * Math.cos(ph) * Math.sin(th), zw + rh * Math.sin(ph));
        };
        for (let k = 0; k < RINGS; k++) for (let s = 0; s < SEG; s++) {
          const a = pt(s, k), c = pt(s + 1, k), d = pt(s + 1, k + 1), e = pt(s, k + 1);
          tri(a, c, d);
          if (k < RINGS - 1) tri(a, d, e);
        }
      }
    }
  });
  const group = new THREE.Group();
  const meshes = [];
  for (const acc of tiles.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nor, 3));
    const real = new Float32Array(acc.colReal);
    g.setAttribute('color', new THREE.BufferAttribute(real.slice(), 3));
    g.setAttribute('aWall', new THREE.Float32BufferAttribute(acc.wall, 4));
    g.setAttribute('aGrow', new THREE.Float32BufferAttribute(acc.grow, 2));
    g.setAttribute('aBid', new THREE.Float32BufferAttribute(acc.bid, 1));
    g.setIndex(acc.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(acc.idx, 1) : new THREE.Uint16BufferAttribute(acc.idx, 1));
    g.computeBoundingSphere();
    g.userData.real = real;
    g.userData.bid = new Float32Array(acc.bid);
    g.userData.isRoof = new Uint8Array(acc.wall.filter((_, i) => i % 4 === 2).map((s) => (s < -0.5 ? 1 : 0)));
    const m = new THREE.Mesh(g, mat);
    m.customDepthMaterial = depth;
    m.castShadow = true;
    m.receiveShadow = true;
    m.renderOrder = 20;
    group.add(m);
    meshes.push(m);
  }
  // colour views: recolour every vertex from a per-building colour
  function recolor(fn) {
    const c = new THREE.Color();
    for (const m of meshes) {
      const g = m.geometry, arr = g.attributes.color.array, { real, bid, isRoof } = g.userData;
      if (!fn) arr.set(real);
      else for (let v = 0; v < bid.length; v++) {
        fn(bid[v], c);
        const k = isRoof[v] ? 0.82 : 1;
        arr[v * 3] = c.r * k; arr[v * 3 + 1] = c.g * k; arr[v * 3 + 2] = c.b * k;
      }
      g.attributes.color.needsUpdate = true;
    }
  }
  // spatial index for picking
  const CELL = 30;
  const grid = new Map();
  recs.forEach((r, i) => {
    const [x0, y0, x1, y1] = r.bbox;
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
      for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
        const k = gx + ',' + gy;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  });
  const pip = (x, y, r) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  let maxTop = -Infinity;
  for (const r of recs) maxTop = Math.max(maxTop, r.zt);
  // index of the building whose volume contains world point (x, y, z), honouring the timeline
  function at(x, wy, z) {
    const yN = -z;
    const cell = grid.get(Math.floor(x / CELL) + ',' + Math.floor(yN / CELL));
    if (!cell) return -1;
    for (const i of cell) {
      const r = recs[i];
      if (r.skip || (r.ctx && uniforms.uHideCtx.value > 0.5)) continue;
      const [x0, y0, x1, y1] = r.bbox;
      if (x < x0 || x > x1 || yN < y0 || yN > y1) continue;
      let top = r.zt;
      if (uniforms.uTimeline.value > 0.5 && r.year) {
        const grow = Math.min(1, Math.max(0, (uniforms.uYear.value - r.year) * 1.25 + 1));
        top = r.zb + (r.zt - r.zb) * grow;
      }
      if (wy < r.zb || wy > top) continue;
      if (!pip(x, yN, r.outer) || r.holes.some((h) => pip(x, yN, h))) continue;
      return i;
    }
    return -1;
  }
  return { group, meshes, material: mat, uniforms, recs, recolor, at, maxTop };
}

// ---------------------------------------------------------------- trees
// unit icosphere; each level of detail splits every triangle in four
function icosphere(detail) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((p) => { const l = Math.hypot(...p); return p.map((c) => c / l); });
  let f = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  for (let d = 0; d < detail; d++) {
    const mid = new Map(), nf = [];
    const m = (a, b) => {
      const k = a < b ? a + ',' + b : b + ',' + a;
      if (!mid.has(k)) {
        const p = v[a].map((c, i) => (c + v[b][i]) / 2), l = Math.hypot(...p);
        mid.set(k, v.push(p.map((c) => c / l)) - 1);
      }
      return mid.get(k);
    };
    for (let i = 0; i < f.length; i += 3) {
      const [a, b, c] = [f[i], f[i + 1], f[i + 2]], ab = m(a, b), bc = m(b, c), ca = m(c, a);
      nf.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    f = nf;
  }
  const pos = new Float32Array(v.flat());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(pos.slice(), 3));
  g.setIndex(f);
  return g;
}

export function treeColor(kind, doy, r, out) {
  if (kind === 1) return out.setHSL(0.36 + r * 0.04, 0.32 + r * 0.1, 0.17 + r * 0.06);
  const green = () => out.setHSL(0.25 + r * 0.06, 0.42 + r * 0.15, 0.24 + r * 0.08);
  if (doy >= 335 || doy < 95) return out.setHSL(0.07, 0.12 + r * 0.06, 0.32 + r * 0.06); // bare branches
  if (doy < 140) return out.setHSL(0.24 + r * 0.04, 0.5, 0.36 + r * 0.08);              // fresh spring leaves
  if (doy < 258) return green();
  // autumn: each tree turns on its own schedule, peaking in mid to late October
  const turn = 262 + r * 40, gone = 318 + r * 14;
  if (doy < turn) return green();
  if (doy > gone) return out.setHSL(0.07, 0.25, 0.3);
  const pal = [[0.01, 0.72, 0.42], [0.05, 0.85, 0.45], [0.09, 0.85, 0.48], [0.12, 0.8, 0.5], [0.08, 0.55, 0.33], [0.17, 0.6, 0.42]];
  const p = pal[Math.floor(hash(Math.floor(r * 1e6)) * pal.length)];
  const k = Math.min(1, (doy - turn) / 16);
  green();
  const hsl = {};
  out.getHSL(hsl);
  return out.setHSL(hsl.h + (p[0] - hsl.h) * k, hsl.s + (p[1] - hsl.s) * k, hsl.l + (p[2] - hsl.l) * k);
}

export function buildTrees(data, T, keepFraction) {
  const crownLo = icosphere(0), crownHi = icosphere(1);
  const cone = new THREE.ConeGeometry(1, 1, 7, 1, true);
  cone.translate(0, 0.5, 0);
  const trunk = new THREE.CylinderGeometry(0.6, 1, 1, 5, 1, true);
  trunk.translate(0, 0.5, 0);
  const crownMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: false });
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5b4636', roughness: 1 });
  const TILE = 400;
  const tiles = new Map();
  const tr = data.trees;
  let x = 0, y = 0, n = 0;
  for (let i = 0; i < tr.length; i += 4) {
    x += tr[i]; y += tr[i + 1];
    const id = i / 4;
    if (hash(id * 7 + 3) > keepFraction && tr[i + 3] !== 2) continue;
    if (tr[i + 3] === 2 && hash(id * 7 + 3) > keepFraction * 0.6) continue;
    const px = x / 10, py = y / 10;
    const key = Math.floor(px / TILE) + ',' + Math.floor(py / TILE);
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push([px, py, tr[i + 2] / 10, tr[i + 3], id]);
    n++;
  }
  const group = new THREE.Group();
  const crowns = [];
  const lod = []; // per tile: centre and the low / high detail crowns
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const list of tiles.values()) {
    const broad = list.filter((t) => t[3] !== 1), conif = list.filter((t) => t[3] === 1);
    const mk = (geo, mat, arr, place) => {
      if (!arr.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, arr.length);
      arr.forEach((t, k) => { place(t); im.setMatrixAt(k, m4); });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.userData.trees = arr;
      group.add(im);
      return im;
    };
    const g0 = (t) => T.height(t[0], t[1]) - DATUM - 0.3;
    const placeCrown = (t) => {
      const [tx, ty, h, kind, id] = t;
      const r = kind === 2 ? h * 0.62 : h * (0.25 + hash(id) * 0.08);
      const cy = kind === 2 ? h * 0.48 : h * 0.62;
      q.setFromAxisAngle(up, hash(id + 11) * 6.283);
      m4.compose(p.set(tx, g0(t) + cy, -ty), q, s.set(r * (0.9 + hash(id + 5) * 0.25), kind === 2 ? h * 0.5 : h * 0.4, r));
    };
    const cb = mk(crownLo, crownMat, broad, placeCrown);
    const cbHi = mk(crownHi, crownMat, broad, placeCrown);
    if (cbHi) cbHi.visible = false;
    const cc = mk(cone, crownMat, conif, (t) => {
      const [tx, ty, h, , id] = t;
      q.setFromAxisAngle(up, hash(id + 11) * 6.283);
      m4.compose(p.set(tx, g0(t) + h * 0.16, -ty), q, s.set(h * 0.2, h * 0.86, h * 0.2));
    });
    mk(trunk, trunkMat, list.filter((t) => t[3] !== 2), (t) => {
      const [tx, ty, h, kind] = t;
      const w = Math.max(0.12, h * 0.022);
      m4.compose(p.set(tx, g0(t), -ty), q.identity(), s.set(w, kind === 1 ? h * 0.3 : h * 0.5, w));
    });
    for (const im of [cb, cbHi, cc]) if (im) crowns.push(im);
    if (cb) {
      const cx = list.reduce((a, t) => a + t[0], 0) / list.length, cy = list.reduce((a, t) => a + t[1], 0) / list.length;
      lod.push({ c: new THREE.Vector3(cx, T.height(cx, cy) - DATUM, -cy), lo: cb, hi: cbHi });
    }
  }
  const c = new THREE.Color();
  function setSeason(doy) {
    for (const im of crowns) {
      im.userData.trees.forEach((t, k) => im.setColorAt(k, treeColor(t[3], doy, hash(t[4] * 13 + 1), c)));
      im.instanceColor.needsUpdate = true;
    }
  }
  // smoother crowns only where they are big on screen
  function updateLOD(cam) {
    for (const t of lod) {
      const near = t.c.distanceTo(cam) < 560;
      t.hi.visible = near;
      t.lo.visible = !near;
    }
  }
  return { group, setSeason, updateLOD, count: n };
}

// ---------------------------------------------------------------- selection outline
// crisp edges around the selected building: solid where visible, faint where something hides them
export function buildOutline(recs, T, color = '#8cc8ff') {
  const pos = [];
  for (const r of recs) {
    if (r.skip) continue;
    for (const ring of [r.outer, ...r.holes]) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n], z = ring[(i + n - 1) % n];
        const ga = T.height(a[0], a[1]) - DATUM + 0.15, gb = T.height(b[0], b[1]) - DATUM + 0.15;
        const top = r.zw + 0.05;
        pos.push(a[0], ga, -a[1], b[0], gb, -b[1]);
        pos.push(a[0], top, -a[1], b[0], top, -b[1]);
        // vertical edges only at real corners, not along curves
        const d1 = Math.atan2(a[1] - z[1], a[0] - z[0]), d2 = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (Math.abs(Math.atan2(Math.sin(d2 - d1), Math.cos(d2 - d1))) > 0.35) pos.push(a[0], ga, -a[1], a[0], top, -a[1]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const group = new THREE.Group();
  const front = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
  const behind = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.28, depthTest: false }));
  front.renderOrder = 40;
  behind.renderOrder = 41;
  group.add(front, behind);
  return group;
}

// ---------------------------------------------------------------- street lights (night only)
// Lamps are generic: one every ~40 m along streets and on campus walkways. They only show at night.
export function buildStreetLights(data, T) {
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 64;
  const g = sprite.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,236,200,0.9)');
  grad.addColorStop(0.45, 'rgba(255,190,110,0.25)');
  grad.addColorStop(1, 'rgba(255,170,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(sprite);
  const campus = (data.boundary[0] ? decodeLine(data.boundary[0]) : []);
  const inCampus = (x, y) => {
    let c = false;
    for (let i = 0, j = campus.length - 1; i < campus.length; j = i++) {
      const [xi, yi] = campus[i], [xj, yj] = campus[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const road = [], walk = [];
  const ROADS = new Set(['motorway', 'link', 'primary', 'secondary', 'tertiary', 'street']);
  let k = 0;
  for (const r of data.roads) {
    const cls = data.roadClasses[r[0]];
    const isRoad = ROADS.has(cls);
    if (!isRoad && cls !== 'path') continue;
    const pts = decodeLine(r, 3), w = r[1] / 10;
    const spacing = isRoad ? 42 : 30;
    let carry = spacing * 0.5;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 1e-3) continue;
      const nx = -(by - ay) / L, ny = (bx - ax) / L;
      let s = carry;
      for (; s < L; s += spacing) {
        const side = (k++ & 1) ? 1 : -1;
        const off = isRoad ? w / 2 + 1.2 : 0;
        const x = ax + ((bx - ax) * s) / L + nx * off * side, y = ay + ((by - ay) * s) / L + ny * off * side;
        if (!isRoad && !inCampus(x, y)) continue;
        (isRoad ? road : walk).push(x, T.height(x, y) - DATUM + (isRoad ? 8 : 4), -y);
      }
      carry = s - L;
    }
  }
  const group = new THREE.Group();
  const mats = [];
  for (const [arr, size] of [[road, 16], [walk, 9]]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({ map: tex, color: '#ffd9a0', size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 30;
    group.add(pts);
    mats.push(mat);
  }
  group.visible = false;
  function setNight(f) {
    group.visible = f > 0.05;
    for (const m of mats) m.opacity = Math.min(1, f * 1.1);
  }
  return { group, setNight, count: (road.length + walk.length) / 3 };
}
