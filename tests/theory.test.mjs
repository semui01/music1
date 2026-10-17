import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../js/theory.js';

test('staff positions map to the right notes', () => {
  const name = (p, clef) => {
    const { step, octave } = T.pitchAtPos(p, clef);
    return T.STEP_NAMES[step] + octave;
  };
  // Treble lines E G B D F, spaces F A C E.
  assert.deepEqual([0, 2, 4, 6, 8].map((p) => name(p, 'treble')), ['E4', 'G4', 'B4', 'D5', 'F5']);
  assert.deepEqual([1, 3, 5, 7].map((p) => name(p, 'treble')), ['F4', 'A4', 'C5', 'E5']);
  assert.equal(name(-2, 'treble'), 'C4'); // middle C on the first ledger line below
  // Bass lines G B D F A, spaces A C E G.
  assert.deepEqual([0, 2, 4, 6, 8].map((p) => name(p, 'bass')), ['G2', 'B2', 'D3', 'F3', 'A3']);
  assert.deepEqual([1, 3, 5, 7].map((p) => name(p, 'bass')), ['A2', 'C3', 'E3', 'G3']);
  assert.equal(name(10, 'bass'), 'C4'); // middle C on the first ledger line above
});

test('midi numbers', () => {
  assert.equal(T.midiOf(0, 4), 60);
  assert.equal(T.midiOf(5, 4), 69);
  assert.equal(T.midiOf(3, 4, 1), 66);
  assert.equal(T.midiOf(6, 3, -1), 58);
});

test('key signatures', () => {
  assert.deepEqual(T.keySignatureNames(1), ['F♯']);
  assert.deepEqual(T.keySignatureNames(3), ['F♯', 'C♯', 'G♯']);
  assert.deepEqual(T.keySignatureNames(-2), ['B♭', 'E♭']);
  assert.equal(T.keyAlter(3, 1), 1); // F in G major
  assert.equal(T.keyAlter(3, 0), 0);
  assert.equal(T.keyAlter(6, -1), -1); // B in F major
  assert.equal(T.keyAlter(2, -1), 0); // E in F major
  for (const k of T.KEYS) {
    const scale = T.scaleNotes(k.fifths, 'major', 4);
    const name = T.STEP_NAMES[scale[0].step] + T.alterSymbol(scale[0].alter);
    assert.equal(name, k.major, `tonic of ${k.major}`);
    const minor = T.scaleNotes(k.fifths, 'minor', 4);
    assert.equal(T.STEP_NAMES[minor[0].step] + T.alterSymbol(minor[0].alter), k.minor);
  }
  // Major scale = W W H W W W H.
  const g = T.scaleNotes(1, 'major', 4).map((n) => T.midiOf(n.step, n.octave, n.alter));
  assert.deepEqual(g.slice(1).map((m, i) => m - g[i]), [2, 2, 1, 2, 2, 2, 1]);
});

test('time signatures', () => {
  assert.equal(T.measureTicks('4/4'), 192);
  assert.equal(T.measureTicks('3/4'), 144);
  assert.equal(T.measureTicks('6/8'), 144);
  assert.equal(T.measureTicks('2/2'), 192);
  assert.equal(T.isCompound('6/8'), true);
  assert.equal(T.isCompound('3/8'), false);
  assert.equal(T.beatTicks('6/8'), 72);
  assert.equal(T.beatTicks('2/2'), 96);
  assert.equal(T.countTicks('6/8'), 24);
  assert.equal(T.countLabel(0, '4/4'), '1');
  assert.equal(T.countLabel(24, '4/4'), '+');
  assert.equal(T.countLabel(60, '4/4'), 'e');
  assert.equal(T.countLabel(132, '4/4'), 'a');
  assert.equal(T.countLabel(72, '6/8'), '4');
});

test('durations and rest splitting', () => {
  assert.equal(T.durationTicks('q', 1), 72);
  assert.equal(T.durationTicks('16', 1), 18);
  const parts = T.splitIntoDurations(144);
  assert.equal(parts.reduce((a, p) => a + p.ticks, 0), 144);
  assert.deepEqual(parts[0], { dur: 'h', dots: 1, ticks: 144 });
  assert.equal(T.splitIntoDurations(60).reduce((a, p) => a + p.ticks, 0), 60);
});

test('formatting beat counts', () => {
  assert.equal(T.formatCount(1), '1');
  assert.equal(T.formatCount(1.5), '1½');
  assert.equal(T.formatCount(0.25), '¼');
  assert.equal(T.formatCount(0.375), '⅜');
  assert.equal(T.formatCount(0.1875), '3/16');
  assert.equal(T.formatCount(6), '6');
  assert.equal(T.formatCount(0.75), '¾');
});

test('tempo terms', () => {
  assert.equal(T.tempoTerm(50).name, 'Largo');
  assert.equal(T.tempoTerm(96).name, 'Andante');
  assert.equal(T.tempoTerm(130).name, 'Allegro');
  assert.equal(T.tempoTerm(200).name, 'Presto');
  assert.ok(Math.abs(T.secondsPerTick(60, '4/4') * 48 - 1) < 1e-9);
  assert.ok(Math.abs(T.secondsPerTick(60, '6/8') * 72 - 1) < 1e-9);
});

test('spelling piano keys for a key signature', () => {
  const spell = (midi, f) => {
    const s = T.spellMidi(midi, f);
    return T.STEP_NAMES[s.step] + T.alterSymbol(s.alter) + s.octave;
  };
  assert.equal(spell(61, 0), 'C♯4');
  assert.equal(spell(61, -3), 'D♭4');
  assert.equal(spell(66, 1), 'F♯4');
  assert.equal(spell(65, 1), 'F4'); // white key in G major stays F (natural)
  assert.equal(spell(65, 6), 'E♯4'); // ...but is E♯ in F♯ major
  assert.equal(spell(71, -6), 'C♭5');
  assert.equal(spell(70, -1), 'B♭4');
});

test('describing staff positions', () => {
  assert.equal(T.describePos(0), 'line 1');
  assert.equal(T.describePos(3), 'space 2');
  assert.equal(T.describePos(8), 'line 5');
  assert.equal(T.describePos(-2), 'ledger line 1 below the staff');
  assert.equal(T.describePos(-3), 'the space below ledger line 1');
  assert.equal(T.describePos(-1), 'the space just below the staff');
  assert.equal(T.describePos(12), 'ledger line 2 above the staff');
  assert.equal(T.describePos(11), 'the space above ledger line 1');
});
