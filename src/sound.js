// Tiny synthesized sound effects (no audio files needed).
let ctx = null;
const audio = () => {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

function tone(freq, dur, { type = 'sine', gain = 0.15, delay = 0, slide = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export const playPlace = () => tone(180, 0.12, { type: 'triangle', gain: 0.25, slide: 0.5 });
export const playTurn = () => {
  tone(660, 0.12, { gain: 0.08 });
  tone(880, 0.16, { gain: 0.08, delay: 0.09 });
};
export const playEnd = (won) => {
  const notes = won ? [523, 659, 784, 1047] : [440, 392, 330];
  notes.forEach((f, i) => tone(f, 0.25, { gain: 0.1, delay: i * 0.13 }));
};
