// Map-style camera controls for the twin.
//
// Zoom is the part that has to feel smooth: every wheel notch, pinch step or button press is added
// to a pending log-distance that drains with frame-rate independent exponential easing, and each
// frame's slice of zoom is applied as a scaling about the 3D point under the cursor, so that point
// stays exactly where it is on screen. Panning grabs the ground under the pointer and keeps it
// there; rotation and panning carry on with inertia when released. When the view comes to rest the
// orbit pivot is moved onto the surface along the line of sight, which does not move the camera.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (dt, tau) => 1 - Math.exp(-dt / tau);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class TwinControls {
  constructor(camera, dom, { cast, groundY, bounds }) {
    this.camera = camera;
    this.dom = dom;
    this.cast = cast;       // (origin, dir) => {point: Vector3} | null — scene hit along a ray
    this.groundY = groundY; // (x, z) => world height of the terrain
    this.bounds = bounds;   // {minX, maxX, minZ, maxZ}
    this.target = new THREE.Vector3();
    this.dist = 2000;
    this.yaw = 0;           // heading of the view, radians clockwise from north
    this.pitch = 0.8;       // elevation of the camera above the horizon at the target
    this.minDist = 22;
    this.maxDist = 5600;
    this.minPitch = 0.09;
    this.maxPitch = 1.5533; // 89°
    this.zoomTau = 0.11;
    this.enabled = true;

    this.zoomPending = 0;
    this.zoomAnchor = new THREE.Vector3();
    this.rotPending = new THREE.Vector2();
    this.panVel = new THREE.Vector2();
    this.rotVel = new THREE.Vector2();
    this.samples = [];
    this.pointers = new Map();
    this.mode = null;
    this.grab = new THREE.Vector3();
    this.anim = null;
    this.dirty = true;
    this.lastInput = 0;
    this.settled = true;
    this.listeners = { start: [], change: [], tap: [] };

    this._ray = new THREE.Raycaster();
    this._v = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._bind();
    this.apply();
  }

  on(ev, fn) { this.listeners[ev].push(fn); }
  emit(ev, ...a) { for (const fn of this.listeners[ev]) fn(...a); }

  // ------------------------------------------------------------ geometry helpers
  forward(out = this._fwd) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
  ndc(cx, cy) {
    const r = this.dom.getBoundingClientRect();
    return new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  }
  rayAt(cx, cy) {
    this._ray.setFromCamera(this.ndc(cx, cy), this.camera);
    return this._ray.ray;
  }
  // first surface hit under a screen point, else the horizontal plane through the target
  surfaceAt(cx, cy) {
    const ray = this.rayAt(cx, cy);
    const hit = this.cast(ray.origin, ray.direction);
    if (hit) return hit.point.clone();
    return this.planeHit(ray, this.target.y);
  }
  planeHit(ray, y) {
    const dy = ray.direction.y;
    if (Math.abs(dy) < 1e-4) return null;
    const t = (y - ray.origin.y) / dy;
    if (t <= 0) return null;
    // a ray grazing the horizon would throw the point absurdly far away
    const maxT = Math.max(this.dist * 6, 400);
    return ray.origin.clone().addScaledVector(ray.direction, Math.min(t, maxT));
  }

  // ------------------------------------------------------------ events
  _bind() {
    const d = this.dom;
    d.style.touchAction = 'none';
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('pointerdown', (e) => this._down(e));
    d.addEventListener('pointermove', (e) => this._move(e));
    d.addEventListener('pointerup', (e) => this._up(e));
    d.addEventListener('pointercancel', (e) => this._up(e));
    d.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    d.addEventListener('dblclick', (e) => {
      if (!this.enabled) return;
      this.zoomAround(e.clientX, e.clientY, e.shiftKey ? 0.85 : -0.85);
    });
    window.addEventListener('keydown', (e) => this._key(e));
  }

  _touchStart() {
    this.anim = null;
    this.panVel.set(0, 0);
    this.rotVel.set(0, 0);
    this.lastInput = performance.now();
    this.settled = false;
    this.emit('start');
  }

  _down(e) {
    if (!this.enabled) return;
    this.dom.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), button: e.button });
    this._touchStart();
    this.samples = [];
    if (this.pointers.size === 1) {
      const rotate = e.button === 2 || e.button === 1 || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey;
      if (rotate) this.mode = 'rotate';
      else this._startPan(e.clientX, e.clientY);
    } else if (this.pointers.size === 2) {
      this._startPinch();
    }
  }

  _startPan(cx, cy) {
    const p = this.surfaceAt(cx, cy);
    if (!p) { this.mode = null; return; }
    this.mode = 'pan';
    this.grab.copy(p);
  }

  _startPinch() {
    const [a, b] = [...this.pointers.values()];
    this.mode = 'pinch';
    this.pinch = {
      d: Math.hypot(a.x - b.x, a.y - b.y),
      ang: Math.atan2(b.y - a.y, b.x - a.x),
      mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
    };
    const p = this.surfaceAt(this.pinch.mx, this.pinch.my);
    this.grab.copy(p || this.target);
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.enabled) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    this.lastInput = performance.now();
    if (this.mode === 'pan') {
      const before = this.target.clone();
      this._panTo(e.clientX, e.clientY);
      this._sample(this.target.x - before.x, this.target.z - before.z, 0, 0);
    } else if (this.mode === 'rotate') {
      const k = 0.0055;
      this.yaw = wrapAngle(this.yaw + dx * k);
      this.pitch = clamp(this.pitch + dy * 0.0045, this.minPitch, this.maxPitch);
      this._sample(0, 0, dx * k, dy * 0.0045);
      this.dirty = true;
    } else if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const P = this.pinch;
      // two fingers moving up or down together tilt the view
      const vy = my - P.my, spread = Math.abs(d - P.d);
      if (Math.abs(vy) > 1.5 * spread && Math.abs(vy) > 0.5 && Math.abs(Math.cos(ang)) > 0.5) {
        this.pitch = clamp(this.pitch + vy * 0.004, this.minPitch, this.maxPitch);
      } else {
        // pinch: scale about the grabbed point, twist: turn around the target
        if (d > 0 && P.d > 0) this._scaleAbout(this.grab, P.d / d);
        this.yaw = wrapAngle(this.yaw - (ang - P.ang));
        this.apply();
        this._panTo(mx, my);
      }
      this.pinch = { d, ang, mx, my };
      this.dirty = true;
    }
  }

  _panTo(cx, cy) {
    this.apply();
    const hit = this.planeHit(this.rayAt(cx, cy), this.grab.y);
    if (!hit) return;
    this.target.x += this.grab.x - hit.x;
    this.target.z += this.grab.z - hit.z;
    this._clampTarget();
    this.dirty = true;
  }

  _sample(px, pz, ry, rp) {
    const t = performance.now();
    this.samples.push({ t, px, pz, ry, rp });
    while (this.samples.length && t - this.samples[0].t > 110) this.samples.shift();
  }

  _up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    try { this.dom.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    const now = performance.now();
    const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
    if (this.pointers.size === 0) {
      // fling: average velocity over the last ~100 ms, but only if the pointer was still moving
      const s = this.samples, last = s[s.length - 1];
      if (last && now - last.t < 60 && s.length > 1) {
        const span = Math.max(16, now - s[0].t) / 1000;
        let px = 0, pz = 0, ry = 0, rp = 0;
        for (const q of s) { px += q.px; pz += q.pz; ry += q.ry; rp += q.rp; }
        if (this.mode === 'pan') {
          this.panVel.set(px / span, pz / span);
          const vmax = this.dist * 2.5;
          if (this.panVel.length() > vmax) this.panVel.setLength(vmax);
        } else if (this.mode === 'rotate') this.rotVel.set(ry / span, rp / span);
      }
      if (moved < 6 && now - p.t0 < 500 && e.button !== 2) this.emit('tap', e.clientX, e.clientY, e);
      this.mode = null;
      this.samples = [];
    } else if (this.pointers.size === 1) {
      const [q] = this.pointers.values();
      this._startPan(q.x, q.y);
    }
  }

  _wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 33;
    else if (e.deltaMode === 2) dy *= 400;
    // trackpad pinches arrive as ctrl+wheel with small deltas
    const k = e.ctrlKey ? 0.011 : 0.0026;
    this.zoomAround(e.clientX, e.clientY, clamp(dy * k, -1.2, 1.2));
  }

  // queue a zoom of `amount` (natural-log units of distance; negative = in) about a screen point
  zoomAround(cx, cy, amount) {
    const fresh = performance.now() - this.lastInput > 200 || Math.abs(this.zoomPending) < 0.02;
    this.anim = null;
    this.panVel.set(0, 0);
    this.lastInput = performance.now();
    this.settled = false;
    this.emit('start');
    if (fresh || Math.sign(amount) !== Math.sign(this.zoomPending)) {
      const p = cx == null ? this.target.clone() : this.surfaceAt(cx, cy);
      this.zoomAnchor.copy(p || this.target);
    }
    this.zoomPending = clamp(this.zoomPending + amount, -3, 3);
  }
  zoomBy(amount) { this.zoomAround(null, null, amount); }

  _scaleAbout(anchor, f) {
    const nd = clamp(this.dist * f, this.minDist, this.maxDist);
    const k = nd / this.dist;
    this.target.sub(anchor).multiplyScalar(k).add(anchor);
    this.dist = nd;
    this._clampTarget();
    return k;
  }

  _key(e) {
    if (!this.enabled || e.target.closest('input, textarea, select, [contenteditable]')) return;
    const step = this.dist * 0.25;
    const f = this.forward();
    const fx = f.x, fz = f.z, fl = Math.hypot(fx, fz) || 1;
    let used = true;
    switch (e.key) {
      case 'ArrowUp': if (e.shiftKey) this.rotPending.y -= 0.12; else this.panVel.set((fx / fl) * step * 3, (fz / fl) * step * 3); break;
      case 'ArrowDown': if (e.shiftKey) this.rotPending.y += 0.12; else this.panVel.set((-fx / fl) * step * 3, (-fz / fl) * step * 3); break;
      case 'ArrowLeft': if (e.shiftKey) this.rotPending.x -= 0.2; else this.panVel.set((fz / fl) * step * 3, (-fx / fl) * step * 3); break;
      case 'ArrowRight': if (e.shiftKey) this.rotPending.x += 0.2; else this.panVel.set((-fz / fl) * step * 3, (fx / fl) * step * 3); break;
      case '+': case '=': this.zoomBy(-0.45); break;
      case '-': case '_': this.zoomBy(0.45); break;
      case 'q': case 'Q': this.rotPending.x -= 0.25; break;
      case 'e': case 'E': this.rotPending.x += 0.25; break;
      default: used = false;
    }
    if (used) {
      e.preventDefault();
      this.anim = null;
      this.lastInput = performance.now();
      this.settled = false;
      this.emit('start');
    }
  }

  // ------------------------------------------------------------ animation
  // fly to a view; long trips rise and come back down so the move stays readable
  flyTo({ target, dist, yaw, pitch }, duration) {
    const from = { target: this.target.clone(), dist: this.dist, yaw: this.yaw, pitch: this.pitch };
    const to = {
      target: target ? target.clone() : from.target.clone(),
      dist: clamp(dist ?? from.dist, this.minDist, this.maxDist),
      yaw: yaw ?? from.yaw,
      pitch: clamp(pitch ?? from.pitch, this.minPitch, this.maxPitch),
    };
    const travel = from.target.distanceTo(to.target);
    const hop = Math.log(1 + travel / Math.max(from.dist, to.dist)) * 0.9;
    const dur = duration ?? clamp(0.9 + 0.45 * hop + 0.25 * Math.abs(Math.log(to.dist / from.dist)), 0.9, 2.6);
    this.anim = { t: 0, dur, from, to, hop, dyaw: wrapAngle(to.yaw - from.yaw) };
    this.zoomPending = 0;
    this.panVel.set(0, 0);
    this.rotVel.set(0, 0);
    this.settled = false;
  }
  rotateBy(dyaw, dpitch) {
    this.rotPending.x += dyaw;
    this.rotPending.y += dpitch;
    this.anim = null;
    this.settled = false;
    this.lastInput = performance.now();
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    dt = Math.min(dt, 0.1);
    let moving = this.dirty;
    this.dirty = false;
    if (this.anim) {
      const a = this.anim;
      a.t = Math.min(1, a.t + dt / a.dur);
      const s = a.t < 0.5 ? 4 * a.t * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 3) / 2;
      this.target.lerpVectors(a.from.target, a.to.target, s);
      const ld = Math.log(a.from.dist) + (Math.log(a.to.dist) - Math.log(a.from.dist)) * s + a.hop * Math.sin(Math.PI * s);
      this.dist = clamp(Math.exp(ld), this.minDist, this.maxDist * 1.3);
      this.yaw = wrapAngle(a.from.yaw + a.dyaw * s);
      this.pitch = a.from.pitch + (a.to.pitch - a.from.pitch) * s;
      if (a.t >= 1) this.anim = null;
      moving = true;
    } else {
      if (Math.abs(this.zoomPending) > 1e-4) {
        const step = this.zoomPending * ease(dt, this.zoomTau);
        this.zoomPending -= step;
        const k = this._scaleAbout(this.zoomAnchor, Math.exp(step));
        // stop draining once the zoom limit is reached, or when what is left is imperceptible
        if ((Math.abs(k - 1) < 1e-7 && Math.abs(step) > 1e-6) || Math.abs(this.zoomPending) < 1e-4) this.zoomPending = 0;
        moving = true;
      }
      if (this.mode !== 'pan' && this.mode !== 'pinch' && this.panVel.lengthSq() > 0.01) {
        this.target.x += this.panVel.x * dt;
        this.target.z += this.panVel.y * dt;
        this.panVel.multiplyScalar(Math.exp(-dt / 0.33));
        if (this.panVel.lengthSq() < 0.04) this.panVel.set(0, 0);
        this._clampTarget();
        moving = true;
      }
      if (this.mode !== 'rotate' && this.rotVel.lengthSq() > 1e-6) {
        this.yaw = wrapAngle(this.yaw + this.rotVel.x * dt);
        this.pitch = clamp(this.pitch + this.rotVel.y * dt, this.minPitch, this.maxPitch);
        this.rotVel.multiplyScalar(Math.exp(-dt / 0.25));
        if (this.rotVel.lengthSq() < 1e-6) this.rotVel.set(0, 0);
        moving = true;
      }
      if (this.rotPending.lengthSq() > 1e-7) {
        const f = ease(dt, 0.12);
        const sx = this.rotPending.x * f, sy = this.rotPending.y * f;
        this.rotPending.x -= sx; this.rotPending.y -= sy;
        this.yaw = wrapAngle(this.yaw + sx);
        this.pitch = clamp(this.pitch + sy, this.minPitch, this.maxPitch);
        if (this.rotPending.lengthSq() < 1e-7) this.rotPending.set(0, 0);
        moving = true;
      }
    }
    if (moving) {
      this.apply();
      this.emit('change');
      return true;
    }
    // at rest: put the pivot back on the surface along the line of sight (the view does not change)
    if (!this.settled && !this.mode && performance.now() - this.lastInput > 220) {
      this.settled = true;
      const hit = this.cast(this.camera.position, this.forward(new THREE.Vector3()));
      if (hit) {
        const d = this.camera.position.distanceTo(hit.point);
        if (d >= this.minDist && d <= this.maxDist) { this.target.copy(hit.point); this.dist = d; }
      }
    }
    return false;
  }

  _clampTarget() {
    const b = this.bounds;
    this.target.x = clamp(this.target.x, b.minX, b.maxX);
    this.target.z = clamp(this.target.z, b.minZ, b.maxZ);
  }

  apply() {
    // far away, keep looking down a little so the model never turns into a sliver on the horizon
    const minP = this.minPitch + (0.62 - this.minPitch) * smoothstep(2400, 5600, this.dist);
    this.pitch = clamp(this.pitch, minP, this.maxPitch);
    // never let the camera dip under the ground in front of a slope
    const f = this.forward();
    let cam = this._v.copy(this.target).addScaledVector(f, -this.dist);
    const g = this.groundY(cam.x, cam.z) + 2.2;
    if (cam.y < g) {
      this.pitch = clamp(Math.asin(clamp((g - this.target.y) / this.dist, -1, 1)), this.pitch, this.maxPitch);
      this.forward(f);
      cam = this._v.copy(this.target).addScaledVector(f, -this.dist);
    }
    const c = this.camera;
    c.position.copy(cam);
    c.quaternion.setFromEuler(new THREE.Euler(-this.pitch, -this.yaw, 0, 'YXZ'));
    const near = clamp(this.dist * 0.008, 0.3, 40);
    const far = this.dist * 6 + 9000;
    if (Math.abs(c.near - near) > near * 0.05 || Math.abs(c.far - far) > far * 0.05) {
      c.near = near;
      c.far = far;
      c.updateProjectionMatrix();
    }
    c.updateMatrixWorld();
  }
}
