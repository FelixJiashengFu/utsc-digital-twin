// Screen-space labels over the 3D view. Each label has a zoom range and a priority; every frame the
// visible ones are placed greedily from the highest priority down, skipping any that would overlap.
import * as THREE from 'three';

export class LabelLayer {
  constructor(root) {
    this.root = root;
    this.items = [];
    this.v = new THREE.Vector3();
    this.compact = false;
  }

  add(item) {
    const el = document.createElement(item.onClick ? 'button' : 'div');
    el.className = `lbl lbl-${item.kind}`;
    if (item.onClick) {
      el.type = 'button';
      el.addEventListener('click', (e) => { e.stopPropagation(); item.onClick(); });
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    this.root.appendChild(el);
    Object.assign(item, { el, on: false, w: 0, h: 0, tx: '' });
    this.items.push(item);
    return item;
  }

  setLang(lang) {
    for (const it of this.items) {
      it.el.innerHTML = it.html(lang);
      it.w = 0;
    }
  }

  hide(it) {
    if (it.on) { it.on = false; it.el.classList.remove('on'); }
  }

  update(camera, dist, W, H, kinds, blockers = []) {
    const compact = dist > 1150;
    if (compact !== this.compact) {
      this.compact = compact;
      this.root.classList.toggle('compact', compact);
      for (const it of this.items) it.w = 0;
    }
    const cand = [];
    for (const it of this.items) {
      // a label is judged by the zoom level and by its own distance, so the far horizon stays clean
      const d = Math.max(dist, it.pos.distanceTo(camera.position) * 0.75);
      let ok = kinds[it.kind] !== false && dist >= (it.minD || 0) && d <= it.maxD && (!it.visible || it.visible());
      if (ok) {
        const p = this.v.copy(it.pos).project(camera);
        if (p.z > 1 || p.x < -1.15 || p.x > 1.15 || p.y < -1.15 || p.y > 1.15) ok = false;
        else { it.sx = ((p.x + 1) / 2) * W; it.sy = ((1 - p.y) / 2) * H; }
      }
      if (ok) cand.push(it); else this.hide(it);
    }
    cand.sort((a, b) => b.pri - a.pri);
    for (const it of cand) if (!it.w) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; }
    const placed = blockers.slice();
    for (const it of cand) {
      const x = Math.round(it.sx - it.w / 2);
      const y = Math.round(it.anchor === 'center' ? it.sy - it.h / 2 : it.sy - it.h - 4);
      const pad = it.kind === 'building' ? 4 : 2;
      const r = [x - pad, y - pad, x + it.w + pad, y + it.h + pad];
      if (r[2] < 0 || r[0] > W || r[3] < 0 || r[1] > H || placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) {
        this.hide(it);
        continue;
      }
      placed.push(r);
      const tx = `translate3d(${x}px,${y}px,0)`;
      if (tx !== it.tx) { it.el.style.transform = tx; it.tx = tx; }
      if (!it.on) { it.on = true; it.el.classList.add('on'); }
    }
  }
}
