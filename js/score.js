// The score model: a flat list of events (notes, chords, rests) that is poured
// into measures according to the time signature — like stacking blocks into boxes.

import {
  ACC_ALTER,
  CLEFS,
  DURATIONS,
  KEYS,
  MAX_TEMPO,
  MIN_TEMPO,
  STEP_NAMES,
  TIME_SIGNATURES,
  eventTicks,
  keyAlter,
  measureTicks,
  midiOf,
  splitIntoDurations,
} from './theory.js';

let nextId = 1;

/**
 * An event is one "block": a note, a chord (several notes sharing a duration) or a rest.
 * Each note stores where it sits on the staff (step + octave) and an optional *written*
 * accidental. Without one, the note follows the key signature (and earlier accidentals
 * in the same measure), exactly like printed music.
 */
export function makeEvent({ dur = 'q', dots = 0, rest = false, notes = [] } = {}) {
  return { id: nextId++, dur, dots, rest, notes: rest ? [] : notes.map((n) => ({ ...n })) };
}

export function cloneEvents(events) {
  return events.map((e) => ({ ...e, notes: e.notes.map((n) => ({ ...n })) }));
}

export function defaultScore() {
  return { clef: 'treble', fifths: 0, time: '4/4', tempo: 96, events: [] };
}

function noteKey(n) {
  return `${n.step}:${n.octave}`;
}

/**
 * Pour events into measures. Returns the list of measures; the last one is always
 * the "open" measure (not yet full, possibly empty) where the next block goes.
 *
 * When an event does not fit in what is left of a measure (this only happens after
 * changing the time signature or a duration), the gap is shown as filler rests and
 * the event moves on to the next measure. Nothing in the score itself is changed,
 * so switching back restores the original grouping.
 */
export function buildMeasures(events, time, fifths) {
  const M = measureTicks(time);
  const measures = [];
  const open = (start) => {
    const m = { index: measures.length, start, length: M, fill: 0, items: [], pads: [], overfull: false };
    measures.push(m);
    return m;
  };
  let m = open(0);
  events.forEach((ev, idx) => {
    const t = eventTicks(ev);
    if (m.fill > 0 && m.fill + t > M) {
      let at = m.fill;
      for (const r of splitIntoDurations(M - m.fill)) {
        m.pads.push({ ...r, start: at });
        at += r.ticks;
      }
      m.fill = M;
      m = open(m.start + m.length);
    }
    m.items.push({ ev, idx, start: m.fill, ticks: t });
    m.fill += t;
    if (m.fill > M) {
      m.overfull = true;
      m.length = m.fill;
    }
    if (m.fill >= M) m = open(m.start + m.length);
  });
  for (const meas of measures) resolveMeasure(meas, fifths);
  return measures;
}

/** Work out the sounding alteration of every note, carrying accidentals to the barline. */
function resolveMeasure(m, fifths) {
  const carry = new Map();
  for (const item of m.items) {
    item.alters = item.ev.notes.map((n) => {
      if (n.acc) {
        const a = ACC_ALTER[n.acc];
        carry.set(noteKey(n), a);
        return a;
      }
      return carry.has(noteKey(n)) ? carry.get(noteKey(n)) : keyAlter(n.step, fifths);
    });
    item.midis = item.ev.notes.map((n, i) => midiOf(n.step, n.octave, item.alters[i]));
  }
}

/**
 * The alteration a new note at (step, octave) would get if written without an accidental
 * before item `beforeItem` of measure `m` (or at its end).
 */
export function impliedAlter(m, beforeItem, step, octave, fifths) {
  let alter = keyAlter(step, fifths);
  const key = `${step}:${octave}`;
  const items = m ? m.items.slice(0, beforeItem ?? m.items.length) : [];
  for (const item of items) {
    item.ev.notes.forEach((n) => {
      if (n.acc && noteKey(n) === key) alter = ACC_ALTER[n.acc];
    });
  }
  return alter;
}

/** Total ticks to play: up to the end of the last measure that holds any block. */
export function playableLength(measures) {
  let end = 0;
  for (const m of measures) if (m.items.length) end = m.start + m.length;
  return end;
}

/** Flatten measures into a playback timeline. */
export function buildTimeline(measures) {
  const notes = [];
  for (const m of measures) {
    for (const item of m.items) {
      notes.push({
        tick: m.start + item.start,
        ticks: item.ticks,
        midis: item.ev.rest ? [] : item.midis,
        idx: item.idx,
        measure: m.index,
      });
    }
  }
  return { notes, length: playableLength(measures) };
}

// ---------------------------------------------------------------- text format
// A tiny, readable notation used for examples and share links:
//   C4/q   F#4/8.   Bb3/h   En5/16   C4,E4,G4/w   r/q   (| bar lines are optional)

const ACC_TO_CHAR = { sharp: '#', flat: 'b', natural: 'n' };
const CHAR_TO_ACC = { '#': 'sharp', b: 'flat', n: 'natural' };
const PITCH_RE = /^([A-G])([#bn]?)(\d)$/;

export function noteToText(n) {
  return STEP_NAMES[n.step] + (n.acc ? ACC_TO_CHAR[n.acc] : '') + n.octave;
}

export function eventToText(ev) {
  const head = ev.rest ? 'r' : ev.notes.map(noteToText).join(',');
  return `${head}/${ev.dur}${ev.dots ? '.' : ''}`;
}

export function parseEvent(token) {
  const slash = token.lastIndexOf('/');
  if (slash < 1) throw new Error(`Bad block "${token}"`);
  const head = token.slice(0, slash);
  let dur = token.slice(slash + 1);
  let dots = 0;
  if (dur.endsWith('.')) {
    dots = 1;
    dur = dur.slice(0, -1);
  }
  if (!DURATIONS[dur]) throw new Error(`Unknown duration in "${token}"`);
  if (head === 'r') return makeEvent({ dur, dots, rest: true });
  const notes = head.split(',').map((p) => {
    const m = PITCH_RE.exec(p);
    if (!m) throw new Error(`Bad pitch "${p}"`);
    return { step: STEP_NAMES.indexOf(m[1]), octave: Number(m[3]), acc: CHAR_TO_ACC[m[2]] || null };
  });
  return makeEvent({ dur, dots, notes });
}

export function eventsToText(events) {
  return events.map(eventToText).join(' ');
}

export function parseEvents(text) {
  return text
    .split(/\s+/)
    .filter((t) => t && t !== '|')
    .map(parseEvent);
}

/** Encode a whole score into a URL-hash friendly string. */
export function encodeScore(score) {
  const p = new URLSearchParams();
  p.set('clef', score.clef);
  p.set('key', String(score.fifths));
  p.set('time', score.time);
  p.set('tempo', String(score.tempo));
  p.set('notes', eventsToText(score.events));
  return p.toString();
}

/** Decode (and validate) a score; throws on malformed input. */
export function decodeScore(str) {
  const p = new URLSearchParams(str);
  const s = defaultScore();
  if (p.has('clef')) {
    if (!CLEFS[p.get('clef')]) throw new Error('Unknown clef');
    s.clef = p.get('clef');
  }
  if (p.has('key')) {
    const f = Number(p.get('key'));
    if (!KEYS.some((k) => k.fifths === f)) throw new Error('Unknown key');
    s.fifths = f;
  }
  if (p.has('time')) {
    if (!TIME_SIGNATURES.includes(p.get('time'))) throw new Error('Unknown time signature');
    s.time = p.get('time');
  }
  if (p.has('tempo')) {
    const t = Math.round(Number(p.get('tempo')));
    if (!Number.isFinite(t)) throw new Error('Bad tempo');
    s.tempo = Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, t));
  }
  s.events = parseEvents(p.get('notes') || '');
  return s;
}
