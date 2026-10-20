// Walking times: shortest routes on the OpenStreetMap pedestrian network, timed with Tobler's hiking
// function on the lidar terrain, so the climb out of the Highland Creek ravine costs more than the
// walk down. One Dijkstra run from the start gives the time to every point, so hovering and clicking
// anywhere is instant; only moving the start reruns it.
import * as THREE from 'three';
import { DATUM } from './world.js';

export const STEPS = 1, INDOOR = 2, BRIDGE = 4, TUNNEL = 8, ROAD = 16;
const OFF_PATH = 1.2; // the stretch between a clicked spot and the nearest path is slower than a path

// seconds to walk `len` metres while climbing `dz` metres (negative = downhill)
export function walkSeconds(len, dz, flags = 0) {
  if (len < 1e-6) return 0;
  if (flags & INDOOR) return len / 1.3;
  const s = Math.max(-0.7, Math.min(0.7, dz / Math.max(len, 2)));
  let t = len / ((6 * Math.exp(-3.5 * Math.abs(s + 0.05))) / 3.6); // Tobler: 5 km/h on the flat, fastest on a gentle descent
  if (flags & STEPS) t *= 1.5;
  if (flags & ROAD) t *= 1.08; // prefer a footway or sidewalk when one runs alongside
  return t;
}

class Heap {
  constructor(n) { this.k = new Float64Array(n * 2 + 8); this.v = new Int32Array(n * 2 + 8); this.n = 0; }
  push(key, val) {
    if (this.n >= this.k.length) { const k = new Float64Array(this.k.length * 2), v = new Int32Array(this.v.length * 2); k.set(this.k); v.set(this.v); this.k = k; this.v = v; }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p;
    }
    this.k[i] = key; this.v[i] = val;
  }
  pop() {
    const top = this.v[0], key = this.k[--this.n], val = this.v[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= key) break;
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
    }
    this.k[i] = key; this.v[i] = val;
    return top;
  }
}

export class WalkNet {
  constructor(data, T) {
    this.T = T;
    const n = data.walk.nodes, N = n.length / 3;
    this.N = N;
    const nx = (this.nx = new Float64Array(N)), ny = (this.ny = new Float64Array(N)), nz = (this.nz = new Float64Array(N));
    const ix = new Int32Array(N), iy = new Int32Array(N), iz = new Int32Array(N);
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < N; i++) {
      x += n[i * 3]; y += n[i * 3 + 1]; z += n[i * 3 + 2];
      ix[i] = x; iy[i] = y; iz[i] = z;
      nx[i] = x / 10; ny[i] = y / 10; nz[i] = z / 10;
    }
    this.edges = data.walk.edges.map((arr) => {
      const a = arr[0], b = arr[1], flags = arr[2];
      const xs = [nx[a]], ys = [ny[a]], zs = [nz[a]];
      let px = ix[a], py = iy[a], pz = iz[a];
      for (let k = 3; k < arr.length; k += 3) {
        px += arr[k]; py += arr[k + 1]; pz += arr[k + 2];
        xs.push(px / 10); ys.push(py / 10); zs.push(pz / 10);
      }
      xs.push(nx[b]); ys.push(ny[b]); zs.push(nz[b]);
      const m = xs.length;
      const len = new Float64Array(m), tf = new Float64Array(m), tr = new Float64Array(m);
      for (let i = 1; i < m; i++) {
        const L = Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
        len[i] = len[i - 1] + L;
        tf[i] = tf[i - 1] + walkSeconds(L, zs[i] - zs[i - 1], flags);
      }
      for (let i = m - 2; i >= 0; i--) tr[i] = tr[i + 1] + walkSeconds(len[i + 1] - len[i], zs[i] - zs[i + 1], flags);
      return { a, b, flags, xs, ys, zs, len, tf, tr, m, L: len[m - 1], TF: tf[m - 1], TB: tr[0] };
    });
    // adjacency: for each node, the edges leaving it and in which direction
    const deg = new Int32Array(N + 1);
    for (const e of this.edges) { deg[e.a]++; deg[e.b]++; }
    this.off = new Int32Array(N + 1);
    for (let i = 0; i < N; i++) this.off[i + 1] = this.off[i] + deg[i];
    this.adj = new Int32Array(this.off[N]);
    const fill = this.off.slice();
    this.edges.forEach((e, k) => { this.adj[fill[e.a]++] = k * 2; this.adj[fill[e.b]++] = k * 2 + 1; });
    // segment grid for snapping a point to the nearest path
    this.CELL = 30;
    this.grid = new Map();
    this.edges.forEach((e, k) => {
      for (let i = 0; i < e.m - 1; i++) {
        const x0 = Math.min(e.xs[i], e.xs[i + 1]), x1 = Math.max(e.xs[i], e.xs[i + 1]);
        const y0 = Math.min(e.ys[i], e.ys[i + 1]), y1 = Math.max(e.ys[i], e.ys[i + 1]);
        for (let gx = Math.floor(x0 / this.CELL); gx <= Math.floor(x1 / this.CELL); gx++) {
          for (let gy = Math.floor(y0 / this.CELL); gy <= Math.floor(y1 / this.CELL); gy++) {
            const key = gx * 100003 + gy;
            let list = this.grid.get(key);
            if (!list) this.grid.set(key, (list = []));
            list.push(k, i);
          }
        }
      }
    });
  }

  // nearest point on the network to (x, y): {e, i, t, x, y, z, d}
  snap(x, y, maxR = 600) {
    let best = null;
    const C = this.CELL, cx = Math.floor(x / C), cy = Math.floor(y / C);
    for (let r = 0; r * C <= maxR + C; r++) {
      for (let gx = cx - r; gx <= cx + r; gx++) {
        for (let gy = cy - r; gy <= cy + r; gy++) {
          if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== r) continue;
          const list = this.grid.get(gx * 100003 + gy);
          if (!list) continue;
          for (let q = 0; q < list.length; q += 2) {
            const e = this.edges[list[q]], i = list[q + 1];
            const ax = e.xs[i], ay = e.ys[i], dx = e.xs[i + 1] - ax, dy = e.ys[i + 1] - ay;
            const L2 = dx * dx + dy * dy;
            const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
            const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(x - px, y - py);
            if (!best || d < best.d) best = { e: list[q], i, t, x: px, y: py, z: e.zs[i] + (e.zs[i + 1] - e.zs[i]) * t, d };
          }
        }
      }
      // anything in a later ring is at least (r * C) away
      if (best && best.d <= r * C) break;
    }
    return best;
  }

  // network point closest to a building's footprint, plus the footprint point it faces
  snapFootprint(outer) {
    let best = null;
    for (let k = 0; k < outer.length; k++) {
      const [ax, ay] = outer[k], [bx, by] = outer[(k + 1) % outer.length];
      const L = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(L / 3));
      for (let s = 0; s <= steps; s++) {
        const x = ax + ((bx - ax) * s) / steps, y = ay + ((by - ay) * s) / steps;
        const p = this.snap(x, y, best ? best.d : 400);
        if (p && (!best || p.d < best.d)) best = { ...p, fx: x, fy: y };
      }
    }
    return best;
  }

  // times along an edge between a snapped position and its ends
  _fromA(p) { const e = this.edges[p.e]; return e.tf[p.i] + p.t * (e.tf[p.i + 1] - e.tf[p.i]); }
  _fromB(p) { const e = this.edges[p.e]; return e.tr[p.i + 1] + (1 - p.t) * (e.tr[p.i] - e.tr[p.i + 1]); }
  _toA(p) { const e = this.edges[p.e]; return e.tr[0] - e.tr[p.i] + p.t * (e.tr[p.i] - e.tr[p.i + 1]); }
  _toB(p) { const e = this.edges[p.e]; return e.tf[e.m - 1] - e.tf[p.i + 1] + (1 - p.t) * (e.tf[p.i + 1] - e.tf[p.i]); }
  _dA(p) { const e = this.edges[p.e]; return e.len[p.i] + p.t * (e.len[p.i + 1] - e.len[p.i]); }

  // shortest-time tree from a snapped start; `extra` is the off-path walk to reach it
  tree(start, extra = 0) {
    const N = this.N;
    const time = new Float64Array(N).fill(Infinity), dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1); // edge*2+dir used to arrive; -2 = straight from the start
    const e0 = this.edges[start.e], dA = this._dA(start);
    const heap = new Heap(N);
    const seed = (node, t, d) => {
      if (t < time[node]) { time[node] = t; dist[node] = d; prev[node] = -2; heap.push(t, node); }
    };
    seed(e0.a, extra + this._toA(start), dA);
    seed(e0.b, extra + this._toB(start), e0.L - dA);
    const done = new Uint8Array(N);
    while (heap.n) {
      const u = heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      for (let q = this.off[u]; q < this.off[u + 1]; q++) {
        const code = this.adj[q], e = this.edges[code >> 1], back = code & 1;
        const v = back ? e.a : e.b, t = time[u] + (back ? e.TB : e.TF);
        if (t < time[v]) { time[v] = t; dist[v] = dist[u] + e.L; prev[v] = code; heap.push(t, v); }
      }
    }
    return { start, extra, time, dist, prev };
  }

  // fastest way from the tree's start to a snapped point: {time, dist, via}
  query(tr, p) {
    const e = this.edges[p.e];
    let best = { time: Infinity, dist: Infinity, via: null };
    const tA = tr.time[e.a] + this._fromA(p), tB = tr.time[e.b] + this._fromB(p);
    if (tA < best.time) best = { time: tA, dist: tr.dist[e.a] + this._dA(p), via: 'a' };
    if (tB < best.time) best = { time: tB, dist: tr.dist[e.b] + e.L - this._dA(p), via: 'b' };
    if (tr.start.e === p.e) {
      // both on the same edge: walking straight along it may beat leaving it
      const s = tr.start, forward = s.i + s.t <= p.i + p.t;
      const t = tr.extra + (forward ? this._fromA(p) - this._fromA(s) : this._fromB(p) - this._fromB(s));
      if (t < best.time) best = { time: t, dist: Math.abs(this._dA(p) - this._dA(s)), via: 'direct' };
    }
    return best;
  }

  // the route itself as a polyline [[x, y, z], ...], with climb, descent and what it passes through
  path(tr, p, q = this.query(tr, p)) {
    const E = this.edges, s = tr.start;
    const pt = (e, i) => [e.xs[i], e.ys[i], e.zs[i]];
    const along = (e, from, to) => { // vertices strictly between two fractional positions
      const out = [];
      if (from < to) for (let i = Math.floor(from) + 1; i <= Math.ceil(to) - 1; i++) out.push(pt(e, i));
      else for (let i = Math.ceil(from) - 1; i >= Math.floor(to) + 1; i--) out.push(pt(e, i));
      return out;
    };
    const posPt = (r) => [r.x, r.y, r.z];
    let flags = 0;
    let pts;
    if (q.via === 'direct') {
      flags |= E[p.e].flags;
      pts = [posPt(s), ...along(E[p.e], s.i + s.t, p.i + p.t), posPt(p)];
    } else {
      const ep = E[p.e];
      const tail = q.via === 'a' ? [pt(ep, 0), ...along(ep, 0, p.i + p.t), posPt(p)] : [pt(ep, ep.m - 1), ...along(ep, ep.m - 1, p.i + p.t), posPt(p)];
      flags |= ep.flags;
      const chain = [];
      let v = q.via === 'a' ? ep.a : ep.b;
      while (tr.prev[v] >= 0) {
        const code = tr.prev[v], e = E[code >> 1], back = code & 1;
        flags |= e.flags;
        const verts = [];
        for (let i = 0; i < e.m; i++) verts.push(pt(e, i));
        if (back) verts.reverse();
        chain.unshift(verts.slice(0, -1));
        v = back ? e.b : e.a; // step back to where this edge was entered
      }
      const es = E[s.e];
      flags |= es.flags;
      // v is now an end of the start's edge; on a loop edge, take the quicker way round
      const headToA = es.a !== es.b ? v === es.a : this._toA(s) <= this._toB(s);
      const head = headToA ? [posPt(s), ...along(es, s.i + s.t, 0)] : [posPt(s), ...along(es, s.i + s.t, es.m - 1)];
      pts = [...head, ...chain.flat(), ...tail];
    }
    let up = 0, down = 0;
    for (let i = 1; i < pts.length; i++) {
      const dz = pts[i][2] - pts[i - 1][2];
      if (dz > 0) up += dz; else down -= dz;
    }
    return { pts, up, down, flags, time: q.time, dist: q.dist };
  }

  // arrival time at every vertex of every edge (for the walking-time map)
  vertexTimes(tr, e, k) {
    const s = tr.start;
    let t = Math.min(tr.time[e.a] + e.tf[k], tr.time[e.b] + e.tr[k]);
    if (this.edges[s.e] === e) {
      const ts = this._fromA(s);
      t = Math.min(t, tr.extra + Math.abs(e.tf[k] - ts));
    }
    return t;
  }
}

// ---------------------------------------------------------------- drawing
// a flat ribbon along a polyline of [x, y, z] (local metres, z = elevation), kept just above the ground
export function ribbon(pts, width, T, lift = 0.7) {
  const dense = [];
  for (let i = 0; i < pts.length; i++) {
    if (i) {
      const [ax, ay, az] = pts[i - 1], [bx, by, bz] = pts[i];
      const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 3));
      for (let s = 1; s < n; s++) dense.push([ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n, az + ((bz - az) * s) / n]);
    }
    dense.push(pts[i]);
  }
  const pos = [], idx = [];
  const hw = width / 2;
  for (let i = 0; i < dense.length; i++) {
    const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const [x, y, z] = dense[i];
    // never below the terrain, but bridges keep their interpolated deck height
    const h = Math.max(z, T.height(x, y)) + lift - DATUM;
    pos.push(x + ty * hw, h, -(y - tx * hw), x - ty * hw, h, -(y + tx * hw));
    if (i < dense.length - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export const ISO_RAMP = ['#1a9850', '#91cf60', '#d9ef8b', '#fee08b', '#fc8d59', '#d73027', '#7b2a6e'];
export function isoColor(sec, out) {
  const t = Math.min(1, sec / (25 * 60)) * (ISO_RAMP.length - 1);
  const i = Math.min(ISO_RAMP.length - 2, Math.floor(t));
  return out.set(ISO_RAMP[i]).lerp(new THREE.Color(ISO_RAMP[i + 1]), t - i);
}

// every path as a ribbon whose colour is the walking time from the start
export function buildIsoMesh(net, T) {
  const pos = [], idx = [], refs = [];
  let base = 0;
  net.edges.forEach((e, k) => {
    const pts = [];
    for (let i = 0; i < e.m; i++) pts.push([e.xs[i], e.ys[i], e.zs[i]]);
    const g = ribbon(pts, 3.2, T, 0.5);
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (const j of g.index.array) idx.push(base + j);
    // map each ribbon vertex pair back to the nearest original vertex for colouring
    const n = p.length / 6;
    for (let v = 0; v < n; v++) {
      const f = n > 1 ? (v / (n - 1)) * (e.m - 1) : 0;
      refs.push(k, Math.round(f), k, Math.round(f));
    }
    base += p.length / 3;
    g.dispose();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
  geo.setIndex(base > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -20 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 18;
  mesh.visible = false;
  const c = new THREE.Color();
  function color(tr) {
    const arr = geo.attributes.color.array;
    for (let v = 0; v < refs.length / 2; v++) {
      const e = net.edges[refs[v * 2]];
      isoColor(net.vertexTimes(tr, e, refs[v * 2 + 1]), c);
      arr[v * 3] = c.r; arr[v * 3 + 1] = c.g; arr[v * 3 + 2] = c.b;
    }
    geo.attributes.color.needsUpdate = true;
  }
  return { mesh, color };
}
