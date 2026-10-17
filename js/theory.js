// Music theory helpers: pitches, clefs, keys, time signatures, durations.
// Everything here is pure data / pure functions so it can be unit tested in Node.

/** Ticks per quarter note. 48 divides evenly into every duration we support (incl. dotted 16ths). */
export const TPQ = 48;

export const DURATIONS = {
  w: { ticks: 192, name: 'whole', plural: 'whole notes', head: 'whole', flags: 0 },
  h: { ticks: 96, name: 'half', plural: 'half notes', head: 'half', flags: 0 },
  q: { ticks: 48, name: 'quarter', plural: 'quarter notes', head: 'black', flags: 0 },
  8: { ticks: 24, name: 'eighth', plural: 'eighth notes', head: 'black', flags: 1 },
  16: { ticks: 12, name: 'sixteenth', plural: 'sixteenth notes', head: 'black', flags: 2 },
};
export const DURATION_ORDER = ['w', 'h', 'q', '8', '16'];

export function durationTicks(dur, dots = 0) {
  const base = DURATIONS[dur].ticks;
  return dots ? base * 1.5 : base;
}

export function eventTicks(ev) {
  return durationTicks(ev.dur, ev.dots);
}

/** Break a span of ticks into the fewest standard rests (largest first). */
export function splitIntoDurations(ticks) {
  const out = [];
  let left = ticks;
  const options = [];
  for (const dur of DURATION_ORDER) {
    options.push({ dur, dots: 1, ticks: durationTicks(dur, 1) });
    options.push({ dur, dots: 0, ticks: durationTicks(dur, 0) });
  }
  options.sort((a, b) => b.ticks - a.ticks);
  while (left > 0) {
    const opt = options.find((o) => o.ticks <= left);
    if (!opt) break;
    out.push({ dur: opt.dur, dots: opt.dots, ticks: opt.ticks });
    left -= opt.ticks;
  }
  return out;
}

// ---------------------------------------------------------------- pitch

export const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
export const ACC_ALTER = { sharp: 1, flat: -1, natural: 0 };
export const ACC_SYMBOL = { sharp: '♯', flat: '♭', natural: '♮' };

export function mod(n, m) {
  return ((n % m) + m) % m;
}

export function diatonic(step, octave) {
  return octave * 7 + step;
}

export function fromDiatonic(d) {
  return { step: mod(d, 7), octave: Math.floor(d / 7) };
}

export function midiOf(step, octave, alter = 0) {
  return 12 * (octave + 1) + STEP_SEMITONES[step] + alter;
}

export function alterSymbol(alter) {
  if (alter > 0) return '♯';
  if (alter < 0) return '♭';
  return '';
}

/** "F♯4"-style label. */
export function pitchLabel(step, octave, alter = 0, withOctave = true) {
  return STEP_NAMES[step] + alterSymbol(alter) + (withOctave ? octave : '');
}

// ---------------------------------------------------------------- clefs

// Staff position p: 0 = bottom line, 1 = first space, 2 = second line, ... 8 = top line.
// Negative / >8 positions are ledger-line territory.
export const MIN_POS = -6;
export const MAX_POS = 14;

export const CLEFS = {
  treble: {
    id: 'treble',
    name: 'Treble clef',
    alias: 'G clef',
    bottom: diatonic(2, 4), // E4
    glyph: '',
    glyphPos: 2, // curls around the G line
    sharpPos: [8, 5, 9, 6, 3, 7, 4],
    flatPos: [4, 7, 3, 6, 2, 5, 1],
    lines: 'E G B D F',
    linesMnemonic: 'Every Good Boy Does Fine',
    spaces: 'F A C E',
    spacesMnemonic: 'FACE — spells “face”',
    home: diatonic(6, 4), // B4, middle line
  },
  bass: {
    id: 'bass',
    name: 'Bass clef',
    alias: 'F clef',
    bottom: diatonic(4, 2), // G2
    glyph: '',
    glyphPos: 6, // its two dots surround the F line
    sharpPos: [6, 3, 7, 4, 1, 5, 2],
    flatPos: [2, 5, 1, 4, 0, 3, -1],
    lines: 'G B D F A',
    linesMnemonic: 'Good Boys Do Fine Always',
    spaces: 'A C E G',
    spacesMnemonic: 'All Cows Eat Grass',
    home: diatonic(1, 3), // D3, middle line
  },
};

export function posOf(step, octave, clef) {
  return diatonic(step, octave) - CLEFS[clef].bottom;
}

export function pitchAtPos(p, clef) {
  return fromDiatonic(p + CLEFS[clef].bottom);
}

export function isLine(p) {
  return mod(p, 2) === 0;
}

/** Where a staff position is, as a phrase that reads well after "on": "line 2", "the space just below the staff". */
export function describePos(p) {
  if (p >= 0 && p <= 8) {
    return isLine(p) ? `line ${p / 2 + 1}` : `space ${(p + 1) / 2}`;
  }
  if (p === -1) return 'the space just below the staff';
  if (p === 9) return 'the space just above the staff';
  if (p < 0) {
    const n = Math.floor(-p / 2);
    return isLine(p) ? `ledger line ${n} below the staff` : `the space below ledger line ${n}`;
  }
  const n = Math.floor((p - 8) / 2);
  return isLine(p) ? `ledger line ${n} above the staff` : `the space above ledger line ${n}`;
}

// ---------------------------------------------------------------- keys

const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

const MAJOR_NAMES = {
  '-7': 'C♭', '-6': 'G♭', '-5': 'D♭', '-4': 'A♭', '-3': 'E♭', '-2': 'B♭', '-1': 'F',
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F♯', 7: 'C♯',
};
const MINOR_NAMES = {
  '-7': 'A♭', '-6': 'E♭', '-5': 'B♭', '-4': 'F', '-3': 'C', '-2': 'G', '-1': 'D',
  0: 'A', 1: 'E', 2: 'B', 3: 'F♯', 4: 'C♯', 5: 'G♯', 6: 'D♯', 7: 'A♯',
};

export const KEYS = [];
for (let f = -7; f <= 7; f++) KEYS.push({ fifths: f, major: MAJOR_NAMES[f], minor: MINOR_NAMES[f] });

/** Alteration (-1, 0, +1) the key signature applies to a step. */
export function keyAlter(step, fifths) {
  if (fifths > 0 && SHARP_ORDER.indexOf(step) < fifths) return 1;
  if (fifths < 0 && FLAT_ORDER.indexOf(step) < -fifths) return -1;
  return 0;
}

/** Steps carrying an accidental in the key signature, in written order. */
export function keySignatureSteps(fifths) {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths);
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths);
  return [];
}

export function keySignatureNames(fifths) {
  const sym = fifths > 0 ? '♯' : '♭';
  return keySignatureSteps(fifths).map((s) => STEP_NAMES[s] + sym);
}

export function keyLabel(fifths) {
  const n = Math.abs(fifths);
  if (n === 0) return 'no sharps or flats';
  return `${n} ${fifths > 0 ? 'sharp' : 'flat'}${n > 1 ? 's' : ''}`;
}

/** Tonic step of the major (or relative minor) key. */
export function tonicStep(fifths, mode = 'major') {
  const major = mod(4 * fifths, 7);
  return mode === 'minor' ? mod(major - 2, 7) : major;
}

/** Eight notes of the scale (tonic to tonic) as {step, octave, alter}. */
export function scaleNotes(fifths, mode, startOctave) {
  const tonic = tonicStep(fifths, mode);
  const out = [];
  for (let i = 0; i <= 7; i++) {
    const { step, octave } = fromDiatonic(diatonic(tonic, startOctave) + i);
    out.push({ step, octave, alter: keyAlter(step, fifths) });
  }
  return out;
}

// ---------------------------------------------------------------- time signatures

export const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '2/2', '3/8', '6/8', '9/8', '12/8'];

export function parseTime(ts) {
  const [beats, unit] = ts.split('/').map(Number);
  return { beats, unit };
}

export function measureTicks(ts) {
  const { beats, unit } = parseTime(ts);
  return beats * ((TPQ * 4) / unit);
}

export function isCompound(ts) {
  const { beats, unit } = parseTime(ts);
  return unit === 8 && beats % 3 === 0 && beats > 3;
}

/** Ticks of one *counted* unit — what the bottom number names (eighth in 6/8, quarter in 3/4). */
export function countTicks(ts) {
  return (TPQ * 4) / parseTime(ts).unit;
}

/** Ticks of the beat the tempo (and metronome) follows: dotted quarter in compound time. */
export function beatTicks(ts) {
  return isCompound(ts) ? 3 * countTicks(ts) : countTicks(ts);
}

/** Eighths and sixteenths are beamed together inside groups of this length. */
export function beamGroupTicks(ts) {
  if (ts === '3/8') return measureTicks(ts);
  return beatTicks(ts);
}

export function unitName(unit) {
  return { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: 'sixteenth' }[unit];
}

/** How many counted units (bottom-number notes) a duration lasts in this time signature. */
export function countsFor(ticks, ts) {
  return ticks / countTicks(ts);
}

const FRACTIONS = { 2: '½', 4: { 1: '¼', 3: '¾' }, 8: { 1: '⅛', 3: '⅜', 5: '⅝', 7: '⅞' } };

/** 1.5 → "1½", 0.375 → "⅜", 0.1875 → "3/16". */
export function formatCount(n) {
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  let fracStr = '';
  if (frac > 1e-9) {
    const sixteenths = Math.round(frac * 16);
    let num = sixteenths;
    let den = 16;
    while (num % 2 === 0 && den > 1) {
      num /= 2;
      den /= 2;
    }
    const f = FRACTIONS[den];
    fracStr = den === 2 ? f : f && f[num] ? f[num] : `${num}/${den}`;
    if (whole && fracStr.includes('/')) return `${whole} ${fracStr}`;
  }
  if (!whole) return fracStr || '0';
  return `${whole}${fracStr}`;
}

/** Counting syllable for an offset inside a measure: "1", "e", "+", "a". */
export function countLabel(offset, ts) {
  const unit = countTicks(ts);
  const beatIndex = Math.floor(offset / unit);
  const within = offset - beatIndex * unit;
  if (within === 0) return String(beatIndex + 1);
  const f = within / unit;
  if (f === 0.5) return '+';
  if (f === 0.25) return 'e';
  if (f === 0.75) return 'a';
  return '';
}

// ---------------------------------------------------------------- tempo

export const TEMPO_TERMS = [
  { name: 'Largo', min: 40, max: 59, meaning: 'very slow and broad' },
  { name: 'Adagio', min: 60, max: 75, meaning: 'slow and relaxed' },
  { name: 'Andante', min: 76, max: 107, meaning: 'at a walking pace' },
  { name: 'Moderato', min: 108, max: 119, meaning: 'at a moderate speed' },
  { name: 'Allegro', min: 120, max: 155, meaning: 'fast and bright' },
  { name: 'Vivace', min: 156, max: 175, meaning: 'lively and quick' },
  { name: 'Presto', min: 176, max: 208, meaning: 'very fast' },
];
export const MIN_TEMPO = 40;
export const MAX_TEMPO = 208;

export function tempoTerm(bpm) {
  return TEMPO_TERMS.find((t) => bpm >= t.min && bpm <= t.max) || (bpm < 40 ? TEMPO_TERMS[0] : TEMPO_TERMS[TEMPO_TERMS.length - 1]);
}

export function secondsPerTick(bpm, ts) {
  return 60 / (bpm * beatTicks(ts));
}

// ---------------------------------------------------------------- spelling helpers

/**
 * Spell a MIDI number for a key: prefer the key's own scale note, then a plain
 * white-key name, then sharps in sharp keys (and C) and flats in flat keys.
 */
export function spellMidi(midi, fifths) {
  const octaveBase = Math.floor(midi / 12) - 1;
  const pc = mod(midi, 12);
  const candidates = [];
  for (let step = 0; step < 7; step++) {
    for (const alter of [0, 1, -1]) {
      if (mod(STEP_SEMITONES[step] + alter, 12) === pc) {
        // B♯ / C♭ wrap the octave number.
        let octave = octaveBase;
        if (STEP_SEMITONES[step] + alter >= 12) octave -= 1;
        if (STEP_SEMITONES[step] + alter < 0) octave += 1;
        candidates.push({ step, octave, alter });
      }
    }
  }
  const inKey = candidates.find((c) => keyAlter(c.step, fifths) === c.alter);
  if (inKey) return inKey;
  const pref = fifths < 0 ? -1 : 1;
  return candidates.find((c) => c.alter === 0) || candidates.find((c) => c.alter === pref) || candidates[0];
}
