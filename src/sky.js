// Sun position for the campus, sky dome, lights and shadows.
import * as THREE from 'three';

const RAD = Math.PI / 180;

// Solar altitude and azimuth (radians; azimuth clockwise from north) — NOAA low-precision formulae,
// good to a fraction of a degree, which is plenty for shadows.
export function sunPosition(date, lat, lon) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
  const ha = (gmst * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { alt, az: (az + 2 * Math.PI) % (2 * Math.PI) };
}

// sunrise / sunset for the day of `date` (local), found by bisection on the altitude curve
export function sunTimes(date, lat, lon, dayStart) {
  const altAt = (ms) => sunPosition(new Date(ms), lat, lon).alt - -0.833 * RAD;
  const noon = dayStart + 13 * 3600e3;
  const find = (a, b) => {
    const fa = altAt(a);
    if (Math.sign(fa) === Math.sign(altAt(b))) return null;
    for (let i = 0; i < 30; i++) {
      const m = (a + b) / 2;
      if (Math.sign(altAt(m)) === Math.sign(fa)) a = m; else b = m;
    }
    return (a + b) / 2;
  };
  return { rise: find(dayStart, noon), set: find(noon, dayStart + 24 * 3600e3) };
}

const lerpC = (a, b, t) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));
const C = (h) => new THREE.Color(h);
const SKY = {
  night: { top: C('#060b18'), hor: C('#14203a'), gnd: C('#0b111d') },
  twilight: { top: C('#1d2c55'), hor: C('#c77d5a'), gnd: C('#1e2433') },
  golden: { top: C('#4f7fc0'), hor: C('#f2c48d'), gnd: C('#b9b9b4') },
  day: { top: C('#3d78c9'), hor: C('#c4dbef'), gnd: C('#cfd6dc') },
};

export class SkySystem {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.uniforms = {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uHorizon, uGround, uSunDir, uSunColor;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.5)) : mix(uHorizon, uGround, pow(min(1.0, -h * 3.0), 0.6));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.18 + pow(s, 4.0) * 0.06) * step(-0.02, h);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(quality.shadow, quality.shadow);
    sh.bias = -0.00025;
    sh.normalBias = 0.5;
    sh.camera.near = 1;
    sh.camera.far = 5000;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x8a8470, 1);
    scene.add(this.hemi);
    this.night = 0;
    this.sunDir = new THREE.Vector3();
    this.horizon = new THREE.Color();
  }

  // weather: {cloud: 0..1} or null
  update(alt, az, weather) {
    const cloud = weather ? weather.cloud : 0.2;
    const dir = this.sunDir.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
    const deg = alt / RAD;
    // sky colours: night → twilight → golden hour → day
    let s;
    if (deg < -8) s = SKY.night;
    else if (deg < -1) { const t = (deg + 8) / 7; s = { top: lerpC(SKY.night.top, SKY.twilight.top, t), hor: lerpC(SKY.night.hor, SKY.twilight.hor, t), gnd: lerpC(SKY.night.gnd, SKY.twilight.gnd, t) }; }
    else if (deg < 8) { const t = (deg + 1) / 9; s = { top: lerpC(SKY.twilight.top, SKY.golden.top, t), hor: lerpC(SKY.twilight.hor, SKY.golden.hor, t), gnd: lerpC(SKY.twilight.gnd, SKY.golden.gnd, t) }; }
    else { const t = (deg - 8) / 22; s = { top: lerpC(SKY.golden.top, SKY.day.top, t), hor: lerpC(SKY.golden.hor, SKY.day.hor, t), gnd: lerpC(SKY.golden.gnd, SKY.day.gnd, t) }; }
    const grey = new THREE.Color('#9aa3ad').multiplyScalar(Math.max(0.12, Math.min(1, (deg + 8) / 30)));
    const overcast = Math.max(0, cloud - 0.35) / 0.65;
    this.uniforms.uTop.value.copy(s.top).lerp(grey, overcast * 0.75);
    this.uniforms.uHorizon.value.copy(s.hor).lerp(grey, overcast * 0.6);
    this.uniforms.uGround.value.copy(s.gnd);
    this.uniforms.uSunDir.value.copy(dir);
    const warm = Math.max(0, Math.min(1, (deg - 1) / 25));
    const sunCol = lerpC(C('#ff9a52'), C('#fff4e2'), warm);
    this.uniforms.uSunColor.value.copy(sunCol).multiplyScalar((deg > -1 ? 1 : 0) * (1 - overcast * 0.85));
    this.horizon.copy(this.uniforms.uHorizon.value);

    // lights
    const day = Math.max(0, Math.min(1, (deg + 2) / 10));
    this.night = 1 - Math.max(0, Math.min(1, (deg + 7) / 11));
    const moon = dir.y < 0;
    this.sun.color.copy(moon ? C('#9fb4ff') : sunCol);
    this.sun.intensity = moon ? 0.9 : (0.4 + 2.9 * day) * (1 - overcast * 0.7);
    // the moon stands in for the sun at night: opposite side of the sky, fixed height
    this.lightDir = moon ? new THREE.Vector3(-dir.x, 0.55, -dir.z).normalize() : dir.clone().setY(Math.max(dir.y, 0.03)).normalize();
    // nights stay readable: a cool moonlit fill, so the model is still legible around the lit windows
    this.hemi.color.copy(lerpC(C('#6c82b8'), C('#d6e6ff'), day));
    this.hemi.groundColor.copy(lerpC(C('#2a2c38'), C('#8f8a77'), day));
    this.hemi.intensity = 0.95 + 0.3 * day + overcast * 0.35 * day;
    this.renderer.toneMappingExposure = 0.95 + 0.35 * this.night;
    if (this.scene.fog) this.scene.fog.color.copy(this.horizon);
  }

  // keep the dome around the camera and the shadow frustum around what is on screen
  follow(camera, target, dist) {
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(camera.far * 0.95);
    const ext = Math.min(2600, Math.max(140, dist * 0.95));
    const c = this.sun.shadow.camera;
    if (Math.abs(c.right - ext) > ext * 0.02) {
      c.left = -ext; c.right = ext; c.top = ext; c.bottom = -ext;
      c.updateProjectionMatrix();
    }
    // snap the shadow camera to its texel grid so shadows do not crawl while panning
    const texel = (2 * ext) / this.sun.shadow.mapSize.x;
    const L = this.lightDir || new THREE.Vector3(0, 1, 0);
    const up = Math.abs(L.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3().crossVectors(up, L).normalize();
    const yAxis = new THREE.Vector3().crossVectors(L, xAxis);
    const px = Math.round(target.dot(xAxis) / texel) * texel - target.dot(xAxis);
    const py = Math.round(target.dot(yAxis) / texel) * texel - target.dot(yAxis);
    const t = target.clone().addScaledVector(xAxis, px).addScaledVector(yAxis, py);
    this.sun.target.position.copy(t);
    this.sun.position.copy(t).addScaledVector(L, 2200);
    c.far = 4600;
    this.sun.target.updateMatrixWorld();
  }
}
