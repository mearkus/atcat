// Stratum audio: synthesized sound effects and generative ambient music,
// built entirely with the Web Audio API (no audio files).
//
// Browsers only allow audio after a user gesture, so the engine starts on the
// first click/tap/keypress (see `unlockOnGesture`).

const STORE_KEY = 'stratum:audio';
const DEFAULTS = { music: 0.5, sfx: 0.8, muted: false };

// ---------- music material ----------
// Original progression in D major, two bars per chord (MIDI note numbers).
const PROGRESSION = [
  [50, 57, 61, 64, 66], // Dmaj9
  [47, 54, 57, 61, 62], // Bm9
  [43, 50, 54, 57, 61], // Gmaj7(#11)
  [45, 52, 55, 59, 62], // A7sus(9)
];
const BPM = 76;
const EIGHTH = 60 / BPM / 2;
const STEPS_PER_CHORD = 16;
// How busy the music is in each mood.
const MOODS = {
  menu: { arp: 0.22, bass: false, bell: 0.08 },
  game: { arp: 0.42, bass: true, bell: 0.12 },
  end: { arp: 0.3, bass: false, bell: 0.25 },
};

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function mulberry(seed) {
  return () => {
    let t = (seed = (seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class AudioEngine {
  constructor() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    } catch {
      /* ignore */
    }
    this.settings = { ...DEFAULTS, ...saved };
    this.ctx = null;
    this.mood = 'menu';
    this.rand = mulberry(20261108);
    this.listeners = new Set();
  }

  // ---------- setup ----------
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) this._build(new AC());
    if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume();
  }

  _build(ctx) {
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);

    // Shared reverb built from a decaying noise impulse.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.8, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    this.reverb.connect(wet).connect(this.master);
    // Music and sfx feed the reverb through their own sends so the bus volumes apply.
    this.musicVerb = ctx.createGain();
    this.musicVerb.connect(this.reverb);
    this.sfxVerb = ctx.createGain();
    this.sfxVerb.connect(this.reverb);

    this.noise = this._noiseBuffer();
    this._applyVolumes(true);

    // Music scheduler with lookahead.
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.2;
    this.timer = setInterval(() => this._schedule(), 100);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend();
      else {
        ctx.resume();
        this.nextTime = Math.max(this.nextTime, ctx.currentTime + 0.1);
      }
    });
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _noiseBuffer() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---------- settings ----------
  get musicOn() {
    return !this.settings.muted && this.settings.music > 0;
  }

  set(changes) {
    Object.assign(this.settings, changes);
    localStorage.setItem(STORE_KEY, JSON.stringify(this.settings));
    this._applyVolumes();
    this.listeners.forEach((fn) => fn(this.settings));
  }

  toggleMute() {
    this.set({ muted: !this.settings.muted });
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  _applyVolumes(immediate = false) {
    if (!this.ctx) return;
    const { music, sfx, muted } = this.settings;
    const t = this.ctx.currentTime;
    const set = (param, v) => (immediate ? (param.value = v) : param.setTargetAtTime(v, t, 0.08));
    set(this.master.gain, muted ? 0 : 1);
    // Squared for a more natural-feeling slider.
    set(this.musicBus.gain, music * music * 1.1);
    set(this.musicVerb.gain, music * music * 0.7);
    set(this.sfxBus.gain, sfx * sfx);
    set(this.sfxVerb.gain, sfx * sfx * 0.25);
  }

  setMood(mood) {
    if (MOODS[mood]) this.mood = mood;
  }

  // ---------- music ----------
  _schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // If we fell far behind (tab was throttled), skip ahead instead of bursting.
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.35) {
      if (this.musicOn) this._musicStep(this.step, this.nextTime);
      this.nextTime += EIGHTH;
      this.step++;
    }
  }

  _musicStep(step, t) {
    const mood = MOODS[this.mood];
    const chord = PROGRESSION[Math.floor(step / STEPS_PER_CHORD) % PROGRESSION.length];
    const pos = step % STEPS_PER_CHORD;
    const r = this.rand;

    if (pos === 0) this._pad(chord, t, STEPS_PER_CHORD * EIGHTH);
    if (mood.bass && (pos === 0 || pos === 8 || (pos === 14 && r() < 0.3))) {
      this._bass(midiHz(chord[0] - (chord[0] > 46 ? 12 : 0)), t, pos === 14 ? EIGHTH * 1.5 : EIGHTH * 6);
    }
    // Sparse plucked notes drawn from the chord, an octave or two up.
    const density = pos % 2 === 0 ? mood.arp : mood.arp * 0.5;
    if (r() < density) {
      const tones = chord.slice(1);
      const note = tones[Math.floor(r() * tones.length)] + (r() < 0.35 ? 24 : 12);
      this._pluck(midiHz(note), t, (r() - 0.5) * 1.2, 0.05 + r() * 0.03);
    }
    if (pos === 12 && r() < mood.bell) {
      this._bell(midiHz(chord[2] + 24 + (r() < 0.5 ? 7 : 12)), t, (r() - 0.5) * 1.4, 0.035);
    }
  }

  _voice(dest, verbAmt, pan = 0) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) {
      p.pan.value = pan;
      g.connect(p);
      p.connect(dest === 'music' ? this.musicBus : this.sfxBus);
    } else g.connect(dest === 'music' ? this.musicBus : this.sfxBus);
    if (verbAmt > 0) {
      const send = ctx.createGain();
      send.gain.value = verbAmt;
      g.connect(send).connect(dest === 'music' ? this.musicVerb : this.sfxVerb);
    }
    return g;
  }

  _pad(chord, t, dur) {
    const ctx = this.ctx;
    const out = this._voice('music', 0.8);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1100, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(600, t + dur + 1.5);
    lp.Q.value = 0.5;
    lp.connect(out);
    const peak = 0.055;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(peak, t + 1.8);
    out.gain.setValueAtTime(peak, t + dur - 0.2);
    out.gain.linearRampToValueAtTime(0, t + dur + 1.8);
    for (const m of chord.slice(1)) {
      for (const detune of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(m);
        o.detune.value = detune;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 2);
      }
    }
  }

  _bass(freq, t, dur) {
    const ctx = this.ctx;
    const out = this._voice('music', 0.1);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.22, t + 0.04);
    out.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _pluck(freq, t, pan, gain, dest = 'music') {
    const ctx = this.ctx;
    const out = this._voice(dest, 0.9, pan);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(gain, t + 0.008);
    out.gain.exponentialRampToValueAtTime(0.0008, t + 1.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(freq * 6, t);
    lp.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.4);
    lp.connect(out);
    for (const [type, mul, g] of [
      ['triangle', 1, 1],
      ['sine', 2, 0.3],
    ]) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = type;
      o.frequency.value = freq * mul;
      og.gain.value = g;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + 1.5);
    }
  }

  _bell(freq, t, pan, gain, dest = 'music', decay = 2.2) {
    const ctx = this.ctx;
    const out = this._voice(dest, 1, pan);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(gain, t + 0.005);
    out.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    // Inharmonic partials give a bell/glass timbre.
    for (const [mul, g] of [
      [1, 1],
      [2.76, 0.35],
      [5.4, 0.15],
    ]) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.frequency.value = freq * mul;
      og.gain.value = g;
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  // ---------- sound-effect primitives ----------
  _ready() {
    return this.ctx && this.ctx.state === 'running' && !this.settings.muted && this.settings.sfx > 0;
  }

  _tone(freq, dur, { type = 'sine', gain = 0.15, delay = 0, slide = 0, pan = 0, verb = 0.2 } = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const out = this._voice('sfx', verb, pan);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(gain, t + 0.005);
    out.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noise(dur, { type = 'lowpass', from = 1200, to = from, q = 0.7, gain = 0.2, delay = 0, verb = 0.1 } = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const out = this._voice('sfx', verb);
    out.gain.setValueAtTime(gain, t);
    out.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ---------- public sound effects ----------
  /** A card lands. level = stack height it landed on (0-2). */
  place({ level = 0, mine = true, bury = false, gem = false } = {}) {
    if (!this._ready()) return;
    const v = mine ? 1 : 0.7;
    const f = 120 + level * 28;
    this._tone(f, 0.18, { gain: 0.5 * v, slide: 0.55, verb: 0.15 });
    this._noise(0.07, { from: 1600, to: 300, gain: 0.3 * v });
    this._noise(0.015, { type: 'highpass', from: 3500, gain: 0.08 * v });
    if (bury) {
      // A crunch as cards get covered.
      this._noise(0.28, { type: 'bandpass', from: 900, to: 180, q: 1.2, gain: 0.22 * v, delay: 0.02 });
      this._tone(90, 0.3, { gain: 0.18 * v, slide: 0.6, delay: 0.03 });
    }
    if (gem) {
      const t = this.ctx.currentTime;
      this._bell(1760, t + 0.08, 0.3, 0.05 * v, 'sfx', 1.1);
      this._bell(2637, t + 0.16, -0.3, 0.04 * v, 'sfx', 1.0);
    }
  }

  select() {
    if (!this._ready()) return;
    this._tone(1250, 0.06, { gain: 0.07, verb: 0.05 });
  }

  rotate() {
    if (!this._ready()) return;
    this._noise(0.1, { type: 'bandpass', from: 1800, to: 5200, q: 2, gain: 0.12 });
  }

  invalid() {
    if (!this._ready()) return;
    this._tone(150, 0.16, { type: 'square', gain: 0.04, verb: 0 });
    this._tone(158, 0.16, { type: 'square', gain: 0.04, verb: 0 });
  }

  click() {
    if (!this._ready()) return;
    this._tone(720, 0.035, { type: 'triangle', gain: 0.05, verb: 0 });
  }

  turn() {
    if (!this._ready()) return;
    this._tone(660, 0.18, { gain: 0.07, verb: 0.5 });
    this._tone(990, 0.26, { gain: 0.07, delay: 0.1, verb: 0.5 });
  }

  step() {
    if (!this._ready()) return;
    this._tone(784, 0.2, { gain: 0.06, verb: 0.5 });
    this._tone(1175, 0.3, { gain: 0.06, delay: 0.09, verb: 0.5 });
  }

  end(won) {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    const notes = won ? [74, 78, 81, 86, 90] : [69, 66, 62];
    notes.forEach((m, i) => this._bell(midiHz(m), t + i * 0.14, (i - 2) * 0.25, 0.07, 'sfx', won ? 2 : 1.6));
    if (won) this._bell(midiHz(98), t + notes.length * 0.14 + 0.1, 0, 0.04, 'sfx', 2.5);
  }
}

export const audio = new AudioEngine();

/** Start audio on the first user gesture (browser autoplay policy). */
export function unlockOnGesture() {
  const go = () => audio.unlock();
  for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, go, { capture: true });
}
