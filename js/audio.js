// Piano sound: Salamander Grand Piano samples (every minor third, pitch-shifted in
// between), with a small synthesised piano as a fallback while samples load or if
// they cannot be fetched. Plus a metronome click.

const SAMPLE_NAMES = [
  'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4',
  'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6',
];
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function sampleMidi(name) {
  const m = /^([A-G])(s?)(\d)$/.exec(name);
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] ? 1 : 0);
}

export class Piano {
  constructor() {
    this.ctx = null;
    this.samples = []; // { midi, buffer }
    this.status = 'idle'; // idle | loading | ready | synth
    this.onStatus = () => {};
    this.voices = new Set();
  }

  /** Create the audio graph (suspended until a user gesture) and start fetching samples. */
  init() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);
    // A touch of room reverb so single notes don't sound dry.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(1.8);
    const wet = ctx.createGain();
    wet.gain.value = 0.16;
    this.reverb.connect(wet).connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.bus.connect(this.reverb);
    this.load();
    return ctx;
  }

  makeImpulse(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }

  async load() {
    this.setStatus('loading');
    const base = new URL('../assets/piano/', import.meta.url);
    let loaded = 0;
    const results = await Promise.allSettled(
      SAMPLE_NAMES.map(async (name) => {
        const res = await fetch(new URL(`${name}.mp3`, base));
        if (!res.ok) throw new Error(`${name}: ${res.status}`);
        const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.samples.push({ midi: sampleMidi(name), buffer });
        this.samples.sort((a, b) => a.midi - b.midi);
        loaded++;
        this.onStatus(this.status, loaded / SAMPLE_NAMES.length);
      }),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    this.setStatus(ok >= SAMPLE_NAMES.length / 2 ? 'ready' : 'synth');
  }

  setStatus(s) {
    this.status = s;
    this.onStatus(s, 1);
  }

  /** Must be called from a user gesture at least once (browser autoplay rules). */
  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  nearestSample(midi) {
    let best = null;
    for (const s of this.samples) if (!best || Math.abs(s.midi - midi) < Math.abs(best.midi - midi)) best = s;
    return best && Math.abs(best.midi - midi) <= 4 ? best : null;
  }

  /**
   * Play a note. `when` is AudioContext time, `dur` the held length in seconds.
   * Returns a handle with stop(at) so playback can cut notes short.
   */
  play(midi, when = this.now, dur = 1, velocity = 0.75) {
    if (!this.ctx) return null;
    const sample = this.nearestSample(midi);
    const voice = sample ? this.playSample(sample, midi, when, dur, velocity) : this.playSynth(midi, when, dur, velocity);
    this.voices.add(voice);
    voice.ended = when + dur + 1.2;
    return voice;
  }

  playSample(sample, midi, when, dur, velocity) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.value = Math.pow(2, (midi - sample.midi) / 12);
    const g = ctx.createGain();
    const peak = 0.35 + 0.65 * velocity;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.004);
    // Key released: the damper stops the string quickly but not instantly.
    g.gain.setTargetAtTime(0, when + dur, 0.09);
    src.connect(g).connect(this.bus);
    src.start(when);
    src.stop(when + dur + 1.2);
    return this.handle(src, g);
  }

  playSynth(midi, when, dur, velocity) {
    const ctx = this.ctx;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    if (!this.wave) {
      const n = 12;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) imag[k] = (k === 1 ? 1 : 0.6 / Math.pow(k, 1.4)) * (k % 2 ? 1 : 0.7);
      this.wave = ctx.createPeriodicWave(real, imag);
    }
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.wave);
    osc.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.setPeriodicWave(this.wave);
    osc2.frequency.value = freq * 1.0016;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(freq * 10, 14000), when);
    filter.frequency.setTargetAtTime(Math.max(freq * 2, 400), when + 0.01, 0.35);
    const g = ctx.createGain();
    const peak = (0.18 + 0.25 * velocity) * (midi < 48 ? 1.2 : 1);
    const decay = 0.5 + Math.max(0, (84 - midi) / 40);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.005);
    g.gain.setTargetAtTime(peak * 0.25, when + 0.01, decay);
    g.gain.setTargetAtTime(0, when + dur, 0.08);
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(g).connect(this.bus);
    osc.start(when);
    osc2.start(when);
    osc.stop(when + dur + 1);
    osc2.stop(when + dur + 1);
    return this.handle(osc, g, osc2);
  }

  handle(src, gain, src2) {
    const voice = {
      stop: (at = this.now) => {
        try {
          gain.gain.cancelScheduledValues(at);
          gain.gain.setTargetAtTime(0, at, 0.03);
          src.stop(at + 0.2);
          if (src2) src2.stop(at + 0.2);
        } catch {
          /* already stopped */
        }
      },
    };
    src.onended = () => this.voices.delete(voice);
    return voice;
  }

  /** Silence everything that is sounding or scheduled. */
  stopAll() {
    const t = this.now;
    for (const v of this.voices) v.stop(t);
    this.voices.clear();
  }

  /** Metronome tick. level: 2 = downbeat, 1 = beat, 0 = subdivision. */
  click(when, level = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = level === 2 ? 1760 : level === 1 ? 1320 : 1100;
    const g = ctx.createGain();
    const peak = level === 2 ? 0.5 : level === 1 ? 0.32 : 0.16;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, when + 0.06);
    osc.connect(g).connect(this.master);
    osc.start(when);
    osc.stop(when + 0.08);
    const voice = this.handle(osc, g);
    this.voices.add(voice);
  }
}
