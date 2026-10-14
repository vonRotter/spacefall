// Tiny WebAudio synth for sound effects; nothing is loaded from disk.

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.32;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp);
  comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.32;
}
export const isMuted = () => muted;
export const audioRunning = () => !!ctx && ctx.state === 'running';

function ready() {
  return ctx && ctx.state === 'running' && !muted;
}

function env(gain, t0, attack, decay, peak) {
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

function tone(type, f0, f1, dur, vol = 0.3, delay = 0) {
  if (!ready()) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, 0.005, dur, vol);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur, vol, f0, f1, q = 1, type = 'lowpass', delay = 0) {
  if (!ready()) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.Q.value = q;
  filt.frequency.setValueAtTime(f0, t);
  filt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = ctx.createGain();
  env(g, t, 0.004, dur, vol);
  src.connect(filt).connect(g).connect(master);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

export const sfx = {
  shoot() { tone('square', 880, 220, 0.12, 0.12); noise(0.1, 0.15, 4000, 800, 1, 'bandpass'); },
  dash() { noise(0.18, 0.25, 600, 3000, 2, 'bandpass'); },
  stick() { tone('triangle', 180, 90, 0.08, 0.2); noise(0.05, 0.2, 3000, 1000, 1); },
  pickup() { tone('sine', 660, 990, 0.09, 0.2); tone('sine', 990, 1320, 0.1, 0.16, 0.06); },
  catch() { tone('sine', 520, 1560, 0.15, 0.25); },
  explode(big = false) {
    noise(big ? 0.9 : 0.5, big ? 0.7 : 0.45, big ? 2400 : 1800, 60, 0.7);
    tone('sine', big ? 140 : 180, 35, big ? 0.7 : 0.4, 0.4);
  },
  hit() { tone('square', 300, 120, 0.08, 0.15); noise(0.07, 0.2, 2000, 400, 1); },
  stomp() { tone('square', 220, 70, 0.15, 0.25); },
  shield() { tone('sine', 300, 1200, 0.25, 0.2); },
  shieldBreak() { noise(0.3, 0.3, 6000, 500, 3, 'bandpass'); tone('triangle', 900, 200, 0.25, 0.15); },
  crate() { tone('triangle', 440, 440, 0.08, 0.2); tone('triangle', 660, 660, 0.08, 0.2, 0.08); tone('triangle', 880, 880, 0.14, 0.2, 0.16); },
  rift() { tone('sawtooth', 60, 180, 0.6, 0.08); tone('sine', 400, 90, 0.6, 0.08); },
  spit() { tone('sawtooth', 300, 120, 0.15, 0.1); noise(0.12, 0.15, 1200, 300, 4, 'bandpass'); },
  charge() { tone('sawtooth', 90, 260, 0.45, 0.14); },
  ui() { tone('square', 660, 660, 0.04, 0.08); },
  uiConfirm() { tone('square', 660, 990, 0.08, 0.1); },
  join() { tone('sine', 440, 880, 0.12, 0.2); tone('sine', 880, 1320, 0.12, 0.15, 0.1); },
  round() { [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.18, 0.18, i * 0.11)); },
  gameOver() { [392, 330, 262, 196].forEach((f, i) => tone('triangle', f, f * 0.98, 0.3, 0.2, i * 0.22)); },
  wave() { tone('sawtooth', 110, 110, 0.5, 0.08); tone('sawtooth', 165, 165, 0.5, 0.06, 0.25); },
};
