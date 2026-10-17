// Playback with a look-ahead scheduler (timers wake up often, the Web Audio clock
// does the precise timing). Score edits and tempo changes apply while playing,
// so with Loop on you can keep building and hear each change on the next pass.

import { secondsPerTick } from './theory.js';

const LOOKAHEAD = 0.15; // seconds of audio scheduled ahead of time
const INTERVAL = 25; // ms between scheduler runs

export class Player {
  constructor(piano, { onFrame = () => {}, onEnd = () => {} } = {}) {
    this.piano = piano;
    this.onFrame = onFrame;
    this.onEnd = onEnd;
    this.timeline = { notes: [], clicks: [], length: 0 };
    this.loop = false;
    this.metronome = false;
    this.playing = false;
    this.spt = secondsPerTick(96, '4/4');
  }

  setTempo(bpm, time) {
    const spt = secondsPerTick(bpm, time);
    if (this.playing) {
      // Re-anchor at the point scheduled so far, so nothing jumps.
      this.anchorTime = this.timeAt(this.scheduled);
      this.anchorTick = this.scheduled;
    }
    this.spt = spt;
  }

  setTimeline(timeline) {
    if (this.playing && this.timeline.length) {
      const pos = this.scoreTick(this.scheduled);
      this.offset = this.scheduled - Math.min(pos, timeline.length);
    }
    this.timeline = timeline;
    if (this.playing && !timeline.length) this.stop();
  }

  timeAt(vt) {
    return this.anchorTime + (vt - this.anchorTick) * this.spt;
  }

  tickAt(t) {
    return this.anchorTick + (t - this.anchorTime) / this.spt;
  }

  /** Map a virtual (ever-increasing) tick to a position in the score. */
  scoreTick(vt) {
    const rel = vt - this.offset;
    const L = this.timeline.length;
    if (!L) return 0;
    return this.loop ? ((rel % L) + L) % L : rel;
  }

  play(fromTick = 0) {
    if (!this.timeline.length) return false;
    this.piano.resume();
    this.playing = true;
    this.anchorTime = this.piano.now + 0.08;
    this.anchorTick = 0;
    this.offset = -fromTick;
    this.scheduled = 0;
    this.timer = setInterval(() => this.schedule(), INTERVAL);
    this.schedule();
    const frame = () => {
      if (!this.playing) return;
      const ctx = this.piano.ctx;
      const heard = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
      const vt = Math.max(0, this.tickAt(heard));
      const tick = this.scoreTick(vt);
      if (!this.loop && tick >= this.timeline.length) {
        this.stop(false); // let the last notes ring out
        this.onEnd();
        return;
      }
      this.onFrame(tick);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
    return true;
  }

  schedule() {
    const until = this.tickAt(this.piano.now + LOOKAHEAD);
    const L = this.timeline.length;
    while (this.scheduled < until && L) {
      const rel = this.scheduled - this.offset;
      const pass = Math.floor(rel / L);
      if (!this.loop && pass > 0) break;
      const passStart = pass * L + this.offset;
      const from = this.scheduled - passStart;
      const to = Math.min(until - passStart, L);
      for (const n of this.timeline.notes) {
        if (n.tick >= from && n.tick < to) {
          const when = this.timeAt(passStart + n.tick);
          const dur = Math.max(0.08, n.ticks * this.spt - 0.02);
          for (const midi of n.midis) this.piano.play(midi, when, dur, 0.7);
        }
      }
      if (this.metronome) {
        for (const c of this.timeline.clicks) {
          if (c.tick >= from && c.tick < to) this.piano.click(this.timeAt(passStart + c.tick), c.level);
        }
      }
      this.scheduled = passStart + to;
    }
  }

  stop(silence = true) {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    if (silence) this.piano.stopAll();
  }
}
