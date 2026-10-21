// Original soundtrack for the promo, synthesised from scratch (no samples, no third-party audio):
// 96 BPM in D major, 24 bars = 60 s, so every scene change in the video can land on a bar line.
//   bars 1–2 pads · 3–4 + arpeggio · 5–6 + bass, hats, riser · 7–14 full groove with melody
//   15–18 breakdown, riser · 19–22 finale · 23–24 outro bells and fade
// Usage: deno run -A tools/promo/music.mjs [out.wav]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[2] || join(ROOT, 'promo', 'music.wav');
const SR = 48000, BPM = 96, BEAT = 60 / BPM, BAR = BEAT * 4, BARS = 24;
const LEN = Math.round(BAR * BARS * SR);
const L = new Float32Array(LEN), R = new Float32Array(LEN);
const revL = new Float32Array(LEN), revR = new Float32Array(LEN); // reverb send
const dlyIn = new Float32Array(LEN);                              // ping-pong delay send
const side = new Float32Array(LEN).fill(1);                       // kick ducking for pads and bass

const hz = (m) => 440 * 2 ** ((m - 69) / 12);
let seed = 7;
const noise = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2147483648 - 1; };
const at = (bar, beat = 0) => (bar - 1) * BAR + beat * BEAT;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function addStereo(i, v, pan, send = 0) {
  if (i < 0 || i >= LEN) return;
  const l = Math.cos((pan + 1) * Math.PI / 4), r = Math.sin((pan + 1) * Math.PI / 4);
  L[i] += v * l; R[i] += v * r;
  if (send) { revL[i] += v * l * send; revR[i] += v * r * send; }
}
// RBJ biquad
function biquad(type, f, q) {
  const w = (2 * Math.PI * f) / SR, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  const c = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const fn = (x) => { const y = c[0] * x + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
  fn.set = (nf) => {
    const w2 = (2 * Math.PI * nf) / SR, cs2 = Math.cos(w2), al2 = Math.sin(w2) / (2 * q);
    const A0 = 1 + al2;
    if (type === 'bp') { c[0] = al2 / A0; c[1] = 0; c[2] = -al2 / A0; } else if (type === 'lp') { c[0] = (1 - cs2) / 2 / A0; c[1] = (1 - cs2) / A0; c[2] = c[0]; }
    c[3] = (-2 * cs2) / A0; c[4] = (1 - al2) / A0;
  };
  return fn;
}

// ---------------------------------------------------------------- harmony: D – A – Bm – G
const CHORDS = [
  { pad: [54, 57, 62, 66], root: 38, arp: [66, 69, 74, 78] }, // D
  { pad: [52, 57, 61, 64], root: 33, arp: [64, 69, 73, 76] }, // A
  { pad: [54, 59, 62, 66], root: 35, arp: [66, 71, 74, 78] }, // Bm
  { pad: [55, 59, 62, 67], root: 31, arp: [67, 71, 74, 79] }, // G
];
const chordOf = (bar) => (bar >= 23 ? CHORDS[0] : CHORDS[(bar - 1) % 4]);

// ---------------------------------------------------------------- drums first (they drive the ducking)
function kick(t, vel = 1) {
  const i0 = Math.round(t * SR), n = Math.round(0.65 * SR);
  let ph = 0;
  for (let k = 0; k < n; k++) {
    const s = k / SR, f = 46 + 110 * Math.exp(-s * 28);
    ph += (2 * Math.PI * f) / SR;
    const v = Math.sin(ph) * Math.exp(-s * 9) * 0.9 + (k < 120 ? noise() * 0.25 * (1 - k / 120) : 0);
    addStereo(i0 + k, v * vel, 0);
  }
  for (let k = 0; k < 0.32 * SR; k++) { const i = i0 + k; if (i < LEN) side[i] = Math.min(side[i], 0.35 + 0.65 * smooth(0, 0.3, k / SR)); }
}
function clap(t, vel = 1) {
  const i0 = Math.round(t * SR), bp = biquad('bp', 1700, 0.9), n = Math.round(0.3 * SR);
  for (let k = 0; k < n; k++) {
    const s = k / SR;
    const env = (s < 0.012 ? 1 : s < 0.022 ? 0.6 : 1) * Math.exp(-s * 14);
    addStereo(i0 + k, bp(noise()) * env * 0.55 * vel, 0.05, 0.25);
  }
}
function hat(t, vel = 1, open = false) {
  const i0 = Math.round(t * SR), hp = biquad('hp', 7500, 0.7), n = Math.round((open ? 0.32 : 0.06) * SR);
  for (let k = 0; k < n; k++) addStereo(i0 + k, hp(noise()) * Math.exp(-(k / SR) * (open ? 9 : 55)) * 0.16 * vel, 0.3);
}
function crash(t) {
  const i0 = Math.round(t * SR), hp = biquad('hp', 4000, 0.6), n = Math.round(3.8 * SR);
  for (let k = 0; k < n; k++) addStereo(i0 + k, hp(noise()) * Math.exp(-(k / SR) * 1.6) * 0.14, -0.2, 0.3);
  // a low swell under the impact
  for (let k = 0; k < 2.2 * SR; k++) addStereo(i0 + k, Math.sin((2 * Math.PI * 41 * k) / SR) * Math.exp(-(k / SR) * 3) * 0.35 * Math.min(1, k / 96), 0);
}
function riser(t0, t1) {
  const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR), bp = biquad('bp', 300, 2.2);
  for (let i = i0; i < i1 && i < LEN; i++) {
    const x = (i - i0) / (i1 - i0);
    bp.set(300 + 7000 * x * x);
    const v = bp(noise()) * (0.05 + 0.5 * x * x) * 0.6 + Math.sin((2 * Math.PI * (200 + 600 * x * x) * (i - i0)) / SR) * 0.03 * x;
    addStereo(i, v, Math.sin(x * 9) * 0.4, 0.35);
  }
}

for (let bar = 1; bar <= BARS; bar++) {
  const main = (bar >= 7 && bar <= 14) || (bar >= 19 && bar <= 22);
  const lite = bar >= 15 && bar <= 18;
  for (let b = 0; b < 4; b++) {
    if (main) kick(at(bar, b), b === 0 ? 1 : 0.85);
    if (main && (b === 1 || b === 3)) clap(at(bar, b), 0.9);
    if (lite && b === 3) clap(at(bar, b), 0.35);
    if (main || (bar >= 5 && bar <= 6) || lite) {
      hat(at(bar, b + 0.5), main ? 1 : 0.6);
      if (bar >= 5 && !main) { hat(at(bar, b + 0.25), 0.35); hat(at(bar, b + 0.75), 0.35); }
    }
  }
  if (main && bar % 2 === 0) hat(at(bar, 3.5), 0.8, true);
  if (bar === 7 || bar === 19) crash(at(bar));
}
riser(at(6), at(7));
riser(at(18), at(19));
// a small fill into the drop
for (let k = 0; k < 4; k++) clap(at(6, 3 + k * 0.25), 0.25 + k * 0.18);

// ---------------------------------------------------------------- pads (sidechained), shimmer and bass
for (let bar = 1; bar <= BARS; bar++) {
  const ch = chordOf(bar), t0 = at(bar), dur = bar === BARS ? BAR : BAR + 0.6;
  const level = bar <= 2 ? 0.05 + 0.05 * (bar - 1) : bar >= 15 && bar <= 18 ? 0.085 : 0.075;
  ch.pad.forEach((m, vi) => {
    for (const det of [-0.08, 0.07]) {
      const f = hz(m) * 2 ** (det / 12), pan = (vi / 3 - 0.5) * 0.9 + det * 2, i0 = Math.round(t0 * SR), n = Math.round(dur * SR);
      let lp = 0;
      for (let k = 0; k < n; k++) {
        const s = k / SR, i = i0 + k;
        if (i >= LEN) break;
        const ph = 2 * Math.PI * f * s;
        // a few harmonics of a soft saw, then a gentle low-pass that opens over the intro
        let v = 0;
        for (let hN = 1; hN <= 6; hN++) v += Math.sin(ph * hN + vi) / hN;
        const cutoff = bar <= 4 ? 600 + 900 * ((bar - 1) * BAR + s) / (4 * BAR) : 1500;
        const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
        lp += a * (v - lp);
        const env = smooth(0, 0.7, s) * (1 - smooth(dur - 0.7, dur, s));
        addStereo(i, lp * env * level * (bar <= 6 || bar >= 23 ? 1 : side[i]), pan, 0.45);
      }
    }
  });
  // bass from bar 5
  if (bar >= 5 && bar <= 22) {
    const f = hz(ch.root + 12), i0 = Math.round(t0 * SR);
    const pulses = bar >= 15 && bar <= 18 ? [[0, 4]] : [[0, 1.5], [1.5, 1], [2.5, 1.5]];
    for (const [b0, len] of pulses) {
      const n = Math.round(len * BEAT * SR), s0 = Math.round(b0 * BEAT * SR);
      for (let k = 0; k < n; k++) {
        const s = k / SR, i = i0 + s0 + k;
        if (i >= LEN) break;
        const v = Math.sin(2 * Math.PI * f * s) + 0.3 * Math.sin(4 * Math.PI * f * s) + 0.12 * Math.sin(6 * Math.PI * f * s);
        const env = smooth(0, 0.01, s) * (1 - smooth(len * BEAT - 0.06, len * BEAT, s));
        addStereo(i, Math.tanh(v * 1.2) * env * 0.2 * side[i], 0);
      }
    }
  }
}

// ---------------------------------------------------------------- arpeggio (into the ping-pong delay)
const ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 1, 3, 2];
for (let bar = 3; bar <= 22; bar++) {
  const ch = chordOf(bar);
  for (let st = 0; st < 16; st++) {
    const t = at(bar, st / 4), f = hz(ch.arp[ARP[st]] + (st >= 8 && bar % 2 === 0 ? 12 : 0)), i0 = Math.round(t * SR);
    const vel = (bar <= 4 ? 0.35 + 0.15 * (bar - 3) + 0.02 * st / 16 : bar >= 15 && bar <= 18 ? 0.55 : 0.5) * (st % 4 === 0 ? 1 : 0.75);
    const n = Math.round(0.55 * SR);
    for (let k = 0; k < n; k++) {
      const s = k / SR, i = i0 + k;
      if (i >= LEN) break;
      const v = (Math.sin(2 * Math.PI * f * s) + 0.35 * Math.sin(4 * Math.PI * f * s) * Math.exp(-s * 30)) * Math.exp(-s * 11) * smooth(0, 0.003, s);
      addStereo(i, v * 0.09 * vel, st % 2 ? 0.35 : -0.35, 0.2);
      dlyIn[i] += v * 0.05 * vel;
    }
  }
}

// ---------------------------------------------------------------- melody: a soft FM bell
const PHRASE_1 = [[81, 1], [78, 0.5], [81, 0.5], [83, 1], [81, 1], [76, 1.5], [73, 0.5], [76, 1], [81, 1],
  [78, 1], [74, 0.5], [78, 0.5], [83, 1], [81, 1], [79, 1], [83, 1], [81, 1.5], [0, 0.5]];
const PHRASE_2 = [[81, 0.5], [83, 0.5], [81, 0.5], [78, 0.5], [76, 1], [74, 1], [73, 1], [76, 0.5], [81, 0.5], [76, 1], [73, 1],
  [74, 1], [78, 1], [83, 1], [81, 1], [79, 1.5], [78, 0.5], [76, 1], [74, 1]];
function bell(t, m, len, vel = 1, pan = 0.1) {
  const f = hz(m), i0 = Math.round(t * SR), n = Math.round((len * BEAT + 2.6) * SR);
  for (let k = 0; k < n; k++) {
    const s = k / SR, i = i0 + k;
    if (i >= LEN) break;
    const idx = 1.6 * Math.exp(-s * 6);
    const v = Math.sin(2 * Math.PI * f * s + idx * Math.sin(2 * Math.PI * f * 2 * s)) * Math.exp(-s * 2.2) * smooth(0, 0.004, s);
    addStereo(i, v * 0.12 * vel, pan, 0.4);
  }
}
function play(phrase, bar, vel) {
  let beat = 0;
  for (const [m, len] of phrase) { if (m) bell(at(bar, beat), m, len, vel); beat += len; }
}
play(PHRASE_1, 7, 0.9);
play(PHRASE_2, 11, 0.9);
play(PHRASE_1, 19, 1);
play(PHRASE_2, 21, 1);
// outro: a slow descending arpeggio on D
[[86, 0], [81, 1], [78, 2], [74, 3], [69, 4.5], [74, 6]].forEach(([m, b]) => bell(at(23, b), m, 2, 0.8, b % 2 ? -0.3 : 0.3));

// ---------------------------------------------------------------- effects and master
// ping-pong delay, 3/16 note
{
  const d = Math.round(BEAT * 0.75 * SR);
  const bufL = new Float32Array(LEN), bufR = new Float32Array(LEN);
  for (let i = 0; i < LEN; i++) {
    const inL = dlyIn[i] + (i >= d ? bufR[i - d] * 0.42 : 0);
    const inR = i >= d ? bufL[i - d] * 0.9 : 0;
    bufL[i] = inL; bufR[i] = inR;
    if (i >= d) { L[i] += bufL[i - d] * 0.8; R[i] += bufR[i - d] * 0.8; revL[i] += bufL[i - d] * 0.15; revR[i] += bufR[i - d] * 0.15; }
  }
}
// Freeverb-style reverb on the send
function freeverb(input, spread) {
  const scale = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((c) => ({ buf: new Float32Array(Math.round((c + spread) * scale)), i: 0, f: 0 }));
  const aps = [556, 441, 341, 225].map((c) => ({ buf: new Float32Array(Math.round((c + spread) * scale)), i: 0 }));
  const out = new Float32Array(LEN), room = 0.86, damp = 0.25;
  for (let n = 0; n < LEN; n++) {
    const x = input[n] * 0.015;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.f = o * (1 - damp) + c.f * damp;
      c.buf[c.i] = x + c.f * room;
      c.i = (c.i + 1) % c.buf.length;
      y += o;
    }
    for (const a of aps) {
      const o = a.buf[a.i];
      a.buf[a.i] = y + o * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      y = o - y;
    }
    out[n] = y;
  }
  return out;
}
const wetL = freeverb(revL, 0), wetR = freeverb(revR, 23);
let peak = 0;
for (let i = 0; i < LEN; i++) {
  L[i] += wetL[i] * 2.2; R[i] += wetR[i] * 2.2;
  const s = i / SR, fade = smooth(0, 0.4, s) * (1 - smooth(BAR * BARS - 3.2, BAR * BARS - 0.05, s));
  L[i] = Math.tanh(L[i] * 1.1) * fade; R[i] = Math.tanh(R[i] * 1.1) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
// normalise to -1 dBFS and write a 16-bit WAV
const gain = 0.89 / peak;
const pcm = Buffer.alloc(44 + LEN * 4);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + LEN * 4, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(LEN * 4, 40);
for (let i = 0; i < LEN; i++) {
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), 44 + i * 4);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), 46 + i * 4);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, pcm);
console.log(`${OUT}: ${(LEN / SR).toFixed(1)} s, ${BPM} BPM, peak before normalising ${peak.toFixed(2)}`);
