// Runs inside the viewer during the promo recording (injected by tools/promo/record.mjs).
// window.__promo.frame(t) puts the twin into the state for second t — camera, time of day, selection,
// language, overlays — and renders exactly one frame on the page's virtual clock. Every frame is
// derived from t alone, so any moment can be rendered on its own.
(() => {
  const tw = window.twin;
  const { controls, data, T, camera, select, setYear, state } = tw;
  const DATUM = 100;
  const $ = (s) => document.querySelector(s);
  const V3 = camera.position.constructor;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  const fade = (t, a, b, f = 0.45) => smooth(a, a + f, t) * (1 - smooth(b - f, b, t));
  const idx = (code) => data.info.findIndex((i) => i.code === code);

  // ---------------------------------------------------------------- overlay
  const root = document.createElement('div');
  root.id = 'promo';
  root.innerHTML = `
    <div class="pv-vignette"></div>
    <div class="pv-title" id="pvTitle"><div class="pv-kicker">University of Toronto Scarborough</div><h1>UTSC Digital Twin</h1>
      <p>多伦多大学士嘉堡校区 · 数字孪生</p><div class="pv-rule"></div></div>
    <div class="pv-cap" id="pvCap"><b id="pvCapEn"></b><span id="pvCapZh"></span></div>
    <div class="pv-lower" id="pvLower"><span class="pv-code" id="pvCode"></span><div><b id="pvName"></b><span id="pvZh"></span><em id="pvNote"></em></div></div>
    <div class="pv-year" id="pvYear"><b id="pvYearNum"></b><span>Campus timeline · 校园时间轴</span></div>
    <div class="pv-clock" id="pvClock"></div>
    <svg class="pv-cursor" id="pvCursor" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.6 14.8 L11.6 21.5 L14.6 20.2 L11.7 13.6 L18 13.6 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>
    <div class="pv-ripple" id="pvRipple"></div>
    <div class="pv-end" id="pvEnd"><h1>UTSC Digital Twin</h1><p>多伦多大学士嘉堡校区 · 数字孪生</p>
      <div class="pv-url">felixjiashengfu.github.io/utsc-digital-twin</div>
      <div class="pv-tags">English · 中文 · Free in your browser · 浏览器即开即用</div></div>
    <div class="pv-black" id="pvBlack"></div>`;
  document.body.appendChild(root);
  const E = (id) => root.querySelector('#' + id);
  function show(id, a, rise = 0) {
    const e = E(id);
    e.style.display = a > 0.002 ? '' : 'none';
    e.style.opacity = String(a);
    if (rise) e.style.translate = `0 ${((1 - a) * rise).toFixed(1)}px`;
  }
  function caption(en, zh, a, right = false) {
    E('pvCapEn').textContent = en;
    E('pvCapZh').textContent = zh;
    E('pvCap').classList.toggle('right', right);
    show('pvCap', a, 18);
  }
  const UI = ['top', 'dir', 'dock', 'ctl', 'walk', 'card', 'pins', 'labels', 'legend'];
  let lastUI = null; // null, so the first call always applies
  function ui(list) {
    const key = list.join(',');
    if (key === lastUI) return;
    lastUI = key;
    for (const k of UI) document.body.classList.toggle('pv-no-' + k, !list.includes(k));
  }

  // ---------------------------------------------------------------- state setters (only act on change)
  let curMin = -1, curSel = undefined, curLang = 'en', curIso = false, curYear = 2026, routeVisible = true;
  function minutes(m) {
    m = Math.round(m);
    if (m === curMin) return;
    curMin = m;
    const r = $('#timeRange');
    r.value = String(m);
    r.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function sel(code) {
    if (code === curSel) return;
    curSel = code;
    select(code ? { kind: 'campus', info: idx(code) } : null);
  }
  function lang(l) { if (l !== curLang) { curLang = l; $('#langBtn').click(); } }
  function iso(on) { if (on !== curIso) { curIso = on; $('#wbIso').click(); } }
  function year(y) { if (Math.abs(y - curYear) > 1e-3) { curYear = y; setYear(y); } }
  function route(on) {
    routeVisible = on;
    tw.scene.traverse((o) => { if (o.renderOrder >= 46 && o.renderOrder <= 48) o.visible = on; });
  }
  function cam(c) {
    controls.anim = null;
    controls.zoomPending = 0;
    controls.panVel.set(0, 0); controls.rotVel.set(0, 0); controls.rotPending.set(0, 0);
    controls.target.set(c.x, T.height(c.x, c.y) - DATUM + (c.h || 0), -c.y);
    controls.dist = c.d; controls.yaw = c.yaw; controls.pitch = c.pitch;
    controls.apply();
    controls.dirty = true;
    controls.settled = true;
  }
  const mix = (A, B, u) => ({
    x: lerp(A.x, B.x, u), y: lerp(A.y, B.y, u), h: lerp(A.h || 0, B.h || 0, u),
    d: Math.exp(lerp(Math.log(A.d), Math.log(B.d), u)), yaw: lerp(A.yaw, B.yaw, u), pitch: lerp(A.pitch, B.pitch, u),
  });
  function screen(x, y, h) {
    const p = new V3(x, h - DATUM, -y).project(camera);
    return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight];
  }
  function centre(sel2) { const r = $(sel2).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
  // a pointer gliding between waypoints [[t, [x, y]], ...] with clicks at given times
  function pointer(t, path, clicks) {
    if (t < path[0][0] - 0.3 || t > path[path.length - 1][0] + 0.6) { show('pvCursor', 0); show('pvRipple', 0); return; }
    let p = path[0][1];
    for (let k = 1; k < path.length; k++) {
      const [ta, a] = path[k - 1], [tb, b] = path[k];
      if (t >= ta && t <= tb) { const u = ease((t - ta) / (tb - ta)); p = [lerp(a[0], b[0], u), lerp(a[1], b[1], u)]; }
      if (t > tb) p = b;
    }
    const cur = E('pvCursor');
    cur.style.transform = `translate(${p[0] - 6}px, ${p[1] - 4}px)`;
    show('pvCursor', fade(t, path[0][0] - 0.3, path[path.length - 1][0] + 0.6, 0.3));
    const click = clicks.find((c) => t >= c && t < c + 0.5);
    if (click !== undefined) {
      const u = (t - click) / 0.5, r = E('pvRipple');
      r.style.transform = `translate(${p[0]}px, ${p[1]}px) scale(${1 + u * 3.5})`;
      show('pvRipple', 1 - u);
    } else show('pvRipple', 0);
  }

  const NEW = [
    { code: 'N', yaw: -2.35, en: 'Harmony Commons', zh: '和谐苑学生宿舍', note: '2023 · 746 beds · 746 个床位', color: '#e3b11a' },
    { code: 'IA', yaw: -0.55, en: 'Sam Ibrahim Building', zh: '萨姆·易卜拉欣楼', note: '2024 · 20 classrooms · 20 间智慧教室', color: '#3d6fd6' },
    { code: 'IH', yaw: 0.55, en: 'Indigenous House', zh: '原住民之家', note: 'May 2026 · 2026 年 5 月启用', color: '#ef8a2b' },
    { code: 'AM', yaw: -2.0, en: 'Garron Health Sciences Complex', zh: '加伦健康科学综合楼（SAMIH）', note: 'Fall 2026 · 32 m · 2026 年秋启用', color: '#dc4458' },
  ];
  // creek path for the valley glide (local metres)
  const CREEK = [[-330, -655], [-170, -640], [-10, -600], [150, -480]];
  function creekAt(u) {
    const n = CREEK.length - 1, f = clamp(u, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), s = f - i;
    const p0 = CREEK[Math.max(0, i - 1)], p1 = CREEK[i], p2 = CREEK[i + 1], p3 = CREEK[Math.min(n, i + 2)];
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s * s + (-a + 3 * b - 3 * c + d) * s * s * s);
    return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
  }

  function frame(t) {
    let capA = 0;
    show('pvTitle', 0); show('pvLower', 0); show('pvYear', 0); show('pvClock', 0); show('pvEnd', 0); show('pvCap', 0);
    let black = 0;
    if (t < 10) {
      // ---- opening: a high slow orbit, then the long descent onto the campus core
      ui(t < 6.2 ? [] : ['labels']);
      lang('en'); iso(false); sel(null); year(2026); minutes(16 * 60 + 40); route(false);
      const u = t / 10, p = smooth(0.3, 1, u), q = smooth(0.42, 1, u);
      cam({ x: lerp(-80, -40, q), y: lerp(40, -150, q), d: Math.exp(lerp(Math.log(3400), Math.log(560), p)), yaw: lerp(-1.2, -0.2, u), pitch: lerp(0.8, 0.5, smooth(0.35, 1, u)) });
      show('pvTitle', fade(t, 0.7, 4.7, 0.7), 24);
      black = 1 - smooth(0, 0.9, t);
      capA = fade(t, 5.6, 9.7);
      caption('Every building, as of October 2026', '2026 年 10 月 · 校园全部建筑', capA);
    } else if (t < 15) {
      // ---- glide down the Highland Creek ravine
      ui([]); sel(null); minutes(16 * 60 + 40); route(false);
      const u = (t - 10) / 5, [x, y] = creekAt(u), [xa, ya] = creekAt(u - 0.02), [xb, yb] = creekAt(u + 0.02);
      const heading = Math.atan2(xb - xa, yb - ya);
      cam({ x, y, h: 4, d: lerp(430, 380, u), yaw: heading + 0.55, pitch: lerp(0.3, 0.36, u) });
      caption('Real terrain from 2 m lidar', '2 米激光雷达真实地形 · 高地溪河谷', fade(t, 10.5, 14.7));
    } else if (t < 25) {
      // ---- what is new: four 2.5 s orbits, one per bar
      const k = Math.min(3, Math.floor((t - 15) / 2.5)), b = NEW[k], inf = data.info[idx(b.code)], u = (t - 15 - k * 2.5) / 2.5;
      ui([]); minutes(14 * 60 + 30); sel(b.code); route(false);
      const h = inf.top - inf.ground;
      cam({ x: inf.lp[0], y: inf.lp[1], h: h * 0.35, d: clamp(Math.sqrt(inf.area) * 3.0 + h * 3.6, 170, 520), yaw: b.yaw + u * 0.42, pitch: 0.42 });
      E('pvCode').textContent = b.code;
      E('pvCode').style.setProperty('--c', b.color);
      E('pvName').textContent = b.en;
      E('pvZh').textContent = b.zh;
      E('pvNote').textContent = b.note;
      show('pvLower', fade(t, 15 + k * 2.5 + 0.15, 15 + (k + 1) * 2.5, 0.3), 14);
      caption('New since 2023', '2023 年以来的新建筑', fade(t, 15.3, 24.8));
    } else if (t < 30) {
      // ---- one afternoon into night in five seconds
      ui([]); sel(null); route(false);
      const u = (t - 25) / 5;
      const m = 13 * 60 + (21 * 60 + 25 - 13 * 60) * (0.55 * u + 0.45 * ease(u));
      minutes(m);
      cam({ x: -30, y: -120, d: lerp(900, 790, u), yaw: lerp(-0.52, -0.34, u), pitch: 0.52 });
      E('pvClock').textContent = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
      show('pvClock', fade(t, 25.2, 29.85, 0.3));
      caption('Real sunlight, any hour', '真实日照 · 任意时刻', fade(t, 25.4, 29.7));
    } else if (t < 35) {
      // ---- six decades: buildings rise in the year they opened
      ui(['labels']); sel(null); minutes(13 * 60 + 30); route(false);
      const u = (t - 30) / 5, y = 1962 + 64 * smooth(0.06, 0.92, u);
      year(y);
      cam({ x: -180, y: 140, d: lerp(1780, 1640, u), yaw: lerp(-0.62, -0.46, u), pitch: 0.68 });
      E('pvYearNum').textContent = String(Math.min(2026, Math.round(y)));
      show('pvYear', fade(t, 30.15, 34.85, 0.3));
      caption('Six decades of growth', '六十年校园生长 · 1964 → 2026', fade(t, 30.4, 34.7));
    } else if (t < 45) {
      // ---- click anywhere: the walk there, then the walk-time map
      year(2026); minutes(14 * 60); route(true);
      // the walk-time map reads best from higher up, without labels or the card
      ui(t < 40.5 ? ['top', 'walk', 'card', 'pins', 'labels', 'ctl'] : ['top', 'walk', 'pins', 'ctl']);
      const u1 = smooth(35, 40.4, t), u2 = smooth(40.5, 44.6, t);
      const A = { x: -110, y: 70, d: 840, yaw: -0.4, pitch: 0.62 }, B = { x: -110, y: 70, d: 780, yaw: -0.3, pitch: 0.62 }, C = { x: -40, y: 10, d: 2000, yaw: 0.12, pitch: 1.05 };
      cam(t < 40.5 ? mix(A, B, u1) : mix(B, C, u2));
      const ic = data.info[idx('IC')];
      const icPt = screen(ic.lp[0], ic.lp[1], (ic.ground + ic.top) / 2);
      sel(t >= 36.4 && t < 40.5 ? 'IC' : null);
      iso(t >= 40.5);
      pointer(t, [[35.3, [1420, 820]], [36.25, icPt], [37.6, icPt], [40.2, centre('#wbIso')], [41.2, centre('#wbIso')]], [36.4, 40.5]);
      caption(t < 40.6 ? 'Click anywhere: see the walk' : 'Walk-time map from the bus loop',
        t < 40.6 ? '点哪里，就知道走过去要多久' : '从公交总站出发的步行等时图', t < 40.6 ? fade(t, 36.7, 40.4) : fade(t, 41.0, 44.7));
    } else if (t < 50) {
      // ---- English / 中文
      iso(false); minutes(15 * 60); route(true);
      ui(['top', 'dir', 'walk', 'card', 'pins', 'labels', 'ctl']);
      sel('AC');
      const u = (t - 45) / 5;
      cam({ x: -60, y: -90, d: 700, yaw: lerp(-0.18, 0.06, u), pitch: 0.55 });
      lang(t >= 46.9 ? 'zh' : 'en');
      pointer(t, [[45.3, [1150, 700]], [46.7, centre('#langBtn')], [47.8, centre('#langBtn')]], [46.9]);
      caption('English / 中文 in one click', '中英双语，一键切换', fade(t, 47.1, 49.8), true);
    } else {
      // ---- finale: back out to the whole campus at golden hour
      ui([]); lang('en'); sel(null); iso(false); route(false); minutes(17 * 60 + 25);
      const u = smooth(50, 58.5, t);
      cam(mix({ x: -60, y: -90, d: 620, yaw: 0.25, pitch: 0.48 }, { x: -80, y: 40, d: 3100, yaw: -0.6, pitch: 0.74 }, u));
      show('pvEnd', fade(t, 52.4, 61, 0.9), 26);
      black = smooth(58.6, 60, t);
    }
    if (t < 35 || t >= 50) pointer(t, [[999, [0, 0]]], []);
    E('pvBlack').style.opacity = String(black);
    // two 1/60 s steps per frame keep the viewer's own frame-time logic in its normal range
    window.__step(1000 / 60);
    window.__step(1000 / 60);
    return routeVisible;
  }
  window.__promo = { frame };
})();
