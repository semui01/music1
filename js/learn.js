// Friendly explanations shown in the Learn panel. Everything returns small HTML
// snippets built only from our own data (no user text), so innerHTML is safe.

import {
  CLEFS,
  DURATIONS,
  KEYS,
  STEP_NAMES,
  alterSymbol,
  countsFor,
  describePos,
  formatCount,
  isCompound,
  keyLabel,
  keySignatureNames,
  parseTime,
  pitchLabel,
  scaleNotes,
  tempoTerm,
  unitName,
} from './theory.js';

const TIME_FEEL = {
  '2/4': 'Two beats per measure — like a march: <em>LEFT-right, LEFT-right</em>.',
  '3/4': 'Three beats per measure — the waltz: <em>ONE-two-three, ONE-two-three</em>.',
  '4/4': 'Four beats per measure — the most common time signature of all (also called <em>common time</em>). Most pop, rock and hymns use it.',
  '5/4': 'Five beats per measure — uneven and adventurous. Musicians usually feel it as 3 + 2 or 2 + 3.',
  '2/2': 'Two beats per measure, but the <strong>half note</strong> gets the beat. It’s called <em>cut time</em>: it looks like 4/4 but feels twice as quick.',
  '3/8': 'Three eighth-note beats per measure — a light, quick triple feel, often felt as one big beat.',
  '6/8': 'Six eighth notes per measure, felt as <strong>two big beats</strong> of three: <em>ONE-and-a TWO-and-a</em>. Think jigs and lullabies.',
  '9/8': 'Nine eighth notes, felt as <strong>three big beats</strong> of three — a rolling, dancing feel.',
  '12/8': 'Twelve eighth notes, felt as <strong>four big beats</strong> of three — the swaying shuffle of slow blues.',
};

export function beatWord(time, n = 2) {
  return isCompound(time) ? (n === 1 ? 'count' : 'counts') : n === 1 ? 'beat' : 'beats';
}

/** "1 beat", "½ beat", "3 counts" … for a number of ticks in this time signature. */
export function lengthLabel(ticks, time) {
  const n = countsFor(ticks, time);
  return `${formatCount(n)} ${beatWord(time, n <= 1 ? 1 : 2)}`;
}

export function noteName(dur, dots, rest) {
  return `${dots ? 'dotted ' : ''}${DURATIONS[dur].name} ${rest ? 'rest' : 'note'}`;
}

export function timeCard(time) {
  const { beats, unit } = parseTime(time);
  const counts = isCompound(time)
    ? Array.from({ length: beats }, (_, i) => (i % 3 === 0 ? `<b>${i + 1}</b>` : i + 1)).join(' ')
    : Array.from({ length: beats }, (_, i) => (i === 0 ? `<b>${i + 1}</b>` : i + 1)).join(' ');
  return `
    <h3><span class="ts-badge"><span>${beats}</span><span>${unit}</span></span> Time signature</h3>
    <p><strong>Top number ${beats}:</strong> ${beats} ${unitName(unit)} notes fill one measure.<br>
    <strong>Bottom number ${unit}:</strong> the ${unitName(unit)} note is what we count.</p>
    <p>${TIME_FEEL[time]}</p>
    <p class="count-line">Count: ${counts}</p>`;
}

export function keyCard(fifths, clef) {
  const k = KEYS.find((x) => x.fifths === fifths);
  const accs = keySignatureNames(fifths);
  const oct = clef === 'bass' ? 3 : 4;
  const scale = scaleNotes(fifths, 'major', oct).map((n) => STEP_NAMES[n.step] + alterSymbol(n.alter));
  const minor = scaleNotes(fifths, 'minor', oct).map((n) => STEP_NAMES[n.step] + alterSymbol(n.alter));
  const rule = accs.length
    ? `Every ${accs.map((a) => a[0]).join(', ')} you place sounds as <strong>${accs.join(', ')}</strong> — the key signature saves writing them each time.`
    : 'No sharps or flats: every note is a white key on the piano.';
  return `
    <h3>Key: ${k.major} major <span class="muted">/ ${k.minor} minor</span></h3>
    <p><strong>${keyLabel(fifths)}.</strong> ${rule}</p>
    <p class="scale">${scale.map((n) => `<span>${n}</span>`).join('')}</p>
    <div class="card-actions">
      <button class="btn small" data-scale="major">▶ ${k.major} major scale</button>
      <button class="btn small" data-scale="minor">▶ ${k.minor} minor scale</button>
    </div>
    <p class="muted small">${k.minor} minor shares this key signature (it’s the <em>relative minor</em>): ${minor.join(' ')}.</p>`;
}

export function tempoCard(bpm, time) {
  const t = tempoTerm(bpm);
  const secs = (60 / bpm).toFixed(2);
  const beatNote = isCompound(time) ? 'dotted quarter' : unitName(parseTime(time).unit);
  return `
    <h3>Tempo: <em>${t.name}</em></h3>
    <p><strong>${bpm} beats per minute</strong> — ${t.meaning}. Each beat (${beatNote} note) lasts ${secs} s.</p>
    <p class="muted small">Tempo words are Italian: Largo · Adagio · Andante · Moderato · Allegro · Vivace · Presto, from slowest to fastest.</p>`;
}

export function staffCard(clef) {
  const c = CLEFS[clef];
  return `
    <h3>${c.name} <span class="muted">(${c.alias})</span></h3>
    <p><strong>Lines</strong> bottom→top: <span class="letters">${c.lines}</span><br><span class="muted small">“${c.linesMnemonic}”</span></p>
    <p><strong>Spaces</strong> bottom→top: <span class="letters">${c.spaces}</span><br><span class="muted small">“${c.spacesMnemonic}”</span></p>
    <p class="muted small">${clef === 'treble'
      ? 'The treble clef curls around the 2nd line, marking it as G. It is used for higher notes — the right hand on the piano.'
      : 'The two dots of the bass clef surround the 4th line, marking it as F. It is used for lower notes — the left hand on the piano.'}</p>`;
}

export function durationTip(dur, dots, rest, time) {
  const ticks = DURATIONS[dur].ticks * (dots ? 1.5 : 1);
  const what = noteName(dur, dots, rest);
  let extra = '';
  if (dots) extra = ' A dot adds half the note’s value again.';
  else if (rest) extra = ' A rest is a block of silence — it still takes up time in the measure.';
  else if (dur === '8' || dur === '16') extra = ' Neighbouring short notes in the same beat are joined by a <em>beam</em> instead of flags.';
  return `A <strong>${what}</strong> lasts <strong>${lengthLabel(ticks, time)}</strong> in ${time}.${extra}`;
}

export function accidentalTip(acc) {
  if (!acc) return 'Notes now follow the <strong>key signature</strong> again.';
  return {
    sharp: 'A <strong>sharp ♯</strong> raises a note by a half step — the very next key to the right on the piano.',
    flat: 'A <strong>flat ♭</strong> lowers a note by a half step — the very next key to the left on the piano.',
    natural: 'A <strong>natural ♮</strong> cancels a sharp or flat (even one from the key signature).',
  }[acc] + ' It lasts until the next bar line.';
}

/** Tip after a note has been placed. */
export function placedTip(info) {
  const { step, octave, alter, p, clef, fifths, written, keyApplied, carried, dur, dots, measureNo, left, time, chord } = info;
  const name = pitchLabel(step, octave, alter);
  const where = describePos(p);
  let s = `<strong>${name}</strong> on ${where}`;
  s += chord ? ' — stacked into a chord.' : ` — a ${noteName(dur, dots, false)} (${lengthLabel(DURATIONS[dur].ticks * (dots ? 1.5 : 1), time)}).`;
  if (step === 0 && octave === 4) s += ' This is <strong>middle C</strong>, right in the middle of the piano.';
  if (!written && keyApplied) {
    const k = KEYS.find((x) => x.fifths === fifths);
    s += ` It sounds as ${STEP_NAMES[step]}${alterSymbol(alter)} because of the key signature (${k.major} major).`;
  } else if (!written && carried) {
    s += ' It keeps the accidental written earlier in this measure.';
  }
  if (!chord) s += left > 0 ? ` Measure ${measureNo} has ${lengthLabel(left, time)} left.` : ` Measure ${measureNo} is full!`;
  if (clef === 'bass' && step === 0 && octave === 4) s += ' (In the bass clef it sits on a ledger line above the staff.)';
  return s;
}

export function noFitTip(dur, dots, remaining, measureTicksTotal, time, measureNo) {
  const ticks = DURATIONS[dur].ticks * (dots ? 1.5 : 1);
  const what = noteName(dur, dots, false).replace(' note', '');
  if (ticks > measureTicksTotal) {
    return `A ${what} (${lengthLabel(ticks, time)}) is longer than a whole measure of ${time}. Pick a shorter block!`;
  }
  return `That ${what} needs ${lengthLabel(ticks, time)}, but measure ${measureNo} only has ${lengthLabel(remaining, time)} left. Try a shorter note or a rest to finish the measure.`;
}

export const WELCOME =
  'Pick a <strong>note block</strong> above, then <strong>click a line or space</strong> on the staff to place it — you’ll hear it on the piano. Fill each measure with exactly the right number of beats, then press <strong>Play</strong>.';

export const QUESTS = [
  { id: 'first', text: 'Place your first note on the staff' },
  { id: 'full', text: 'Fill a whole measure with beats' },
  { id: 'long', text: 'Use a half or whole note' },
  { id: 'short', text: 'Join eighth notes with a beam' },
  { id: 'rest', text: 'Add a rest (a block of silence)' },
  { id: 'acc', text: 'Write a sharp ♯ or flat ♭' },
  { id: 'chord', text: 'Stack notes into a chord' },
  { id: 'key', text: 'Change the key signature' },
  { id: 'time', text: 'Try a different time signature' },
  { id: 'play', text: 'Play back your music' },
];
