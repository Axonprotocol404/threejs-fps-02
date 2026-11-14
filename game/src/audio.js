// DUSTLINE Sector 7 — all sound is synthesised with WebAudio: no audio files,
// no network, nothing to license. A small helper builds noise bursts and tones.
let ctx = null;
let master = null;

export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return true;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    return true;
  } catch {
    return false;
  }
}

function noiseBuffer(seconds) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function burst({ duration = 0.12, freq = 1200, q = 0.8, gain = 0.5, type = 'bandpass', slideTo = null }) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(duration + 0.05);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t);
  if (slideTo !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + duration);
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + duration + 0.05);
}

function tone({ freq = 440, to = null, duration = 0.1, gain = 0.25, type = 'sine' }) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

// One-shot effects. `dist` (metres) attenuates distant shots so gunfire carries
// across the map the way it should: near is loud, far is a dull crack.
export const sfx = {
  shot(weapon, dist = 0) {
    if (!ctx) return;
    const att = Math.max(0.12, 1 - dist / 90);
    if (weapon === 'breacher') burst({ duration: 0.22, freq: 900, slideTo: 120, gain: 0.7 * att });
    else if (weapon === 'longbow') burst({ duration: 0.3, freq: 2400, slideTo: 200, gain: 0.6 * att });
    else burst({ duration: 0.1, freq: 1600, slideTo: 300, gain: 0.45 * att });
    tone({ freq: 160, to: 55, duration: 0.09, gain: 0.3 * att, type: 'triangle' });
  },
  dryFire() { tone({ freq: 1400, duration: 0.03, gain: 0.12, type: 'square' }); },
  reload() {
    tone({ freq: 900, duration: 0.04, gain: 0.15, type: 'square' });
    setTimeout(() => tone({ freq: 600, duration: 0.04, gain: 0.15, type: 'square' }), 180);
  },
  hit() { tone({ freq: 1900, duration: 0.05, gain: 0.2, type: 'square' }); },
  kill() {
    tone({ freq: 1900, duration: 0.05, gain: 0.2, type: 'square' });
    setTimeout(() => tone({ freq: 2400, duration: 0.07, gain: 0.2, type: 'square' }), 70);
  },
  hurt() { tone({ freq: 220, to: 90, duration: 0.18, gain: 0.3, type: 'sawtooth' }); },
  explosion() {
    burst({ duration: 0.9, freq: 500, slideTo: 60, gain: 0.9, type: 'lowpass' });
    tone({ freq: 70, to: 30, duration: 0.8, gain: 0.5, type: 'sine' });
  },
  plantBeep() { tone({ freq: 1200, duration: 0.08, gain: 0.2, type: 'square' }); },
  defuseBeep() { tone({ freq: 800, duration: 0.08, gain: 0.2, type: 'square' }); },
  buy() { tone({ freq: 700, duration: 0.06, gain: 0.18, type: 'square' }); },
  denied() { tone({ freq: 220, duration: 0.12, gain: 0.2, type: 'square' }); },
  roundWin() {
    [523, 659, 784].forEach((f, i) => setTimeout(() => tone({ freq: f, duration: 0.16, gain: 0.22 }), i * 110));
  },
  roundLose() {
    [392, 330, 262].forEach((f, i) => setTimeout(() => tone({ freq: f, duration: 0.18, gain: 0.2 }), i * 120));
  },
  grenadePin() { tone({ freq: 1500, duration: 0.03, gain: 0.12, type: 'square' }); },
  bounce() { tone({ freq: 300, to: 180, duration: 0.05, gain: 0.1, type: 'triangle' }); },
};
