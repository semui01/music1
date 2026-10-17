import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMeasures, buildTimeline, decodeScore, encodeScore, eventsToText, impliedAlter, parseEvents } from '../js/score.js';
import { layoutScore, locateTick } from '../js/layout.js';
import { EXAMPLES } from '../js/examples.js';

const ev = (text) => parseEvents(text);

test('events pour into measures', () => {
  const m = buildMeasures(ev('C4/q D4/q E4/q F4/q G4/h'), '4/4', 0);
  assert.equal(m.length, 2);
  assert.equal(m[0].fill, 192);
  assert.equal(m[1].fill, 96);
  assert.equal(m[1].start, 192);
});

test('an exactly full last measure opens a fresh one', () => {
  const m = buildMeasures(ev('C4/w'), '4/4', 0);
  assert.equal(m.length, 2);
  assert.equal(m[1].fill, 0);
});

test('a block that does not fit moves on and leaves filler rests', () => {
  // In 3/4 a half note leaves 1 beat; the next half note needs 2, so it starts measure 2.
  const m = buildMeasures(ev('C4/h D4/h E4/h'), '3/4', 0);
  assert.equal(m[0].items.length, 1);
  assert.equal(m[0].pads.reduce((a, p) => a + p.ticks, 0), 48);
  assert.equal(m[1].items[0].ev.notes[0].step, 1);
  assert.equal(m[2].items[0].ev.notes[0].step, 2);
});

test('regrouping after a time signature change keeps every note', () => {
  const events = ev('C4/q D4/q E4/q F4/q G4/q A4/q');
  const m = buildMeasures(events, '3/4', 0);
  assert.equal(m[0].items.length, 3);
  assert.equal(m[1].items.length, 3);
  assert.equal(m[0].pads.length, 0);
  const m2 = buildMeasures(ev('C4/q D4/h E4/h'), '3/4', 0);
  assert.equal(m2[0].pads.length, 0);
  assert.equal(m2[1].items[0].ev.notes[0].step, 2); // E starts measure 2
  assert.equal(m2[1].pads.reduce((a, p) => a + p.ticks, 0), 0);
  const m3 = buildMeasures(ev('C4/h D4/h'), '3/4', 0);
  assert.equal(m3[0].pads.reduce((a, p) => a + p.ticks, 0), 48); // one beat of filler
  assert.equal(m3[1].items.length, 1);
});

test('a block longer than a measure is flagged', () => {
  const m = buildMeasures(ev('C4/w'), '2/4', 0);
  assert.equal(m[0].overfull, true);
  assert.equal(m[0].length, 192);
});

test('key signature and accidentals resolve per measure', () => {
  // G major: F is F♯; a natural lasts to the bar line; next measure resets.
  const m = buildMeasures(ev('F4/q Fn4/q F4/q F5/q F4/q'), '4/4', 1);
  assert.deepEqual(m[0].items.map((i) => i.alters[0]), [1, 0, 0, 1]);
  assert.deepEqual(m[1].items.map((i) => i.alters[0]), [1]);
  assert.equal(m[0].items[0].midis[0], 66);
  assert.equal(impliedAlter(m[0], 2, 3, 4, 1), 0);
  assert.equal(impliedAlter(m[0], 1, 3, 4, 1), 1);
  assert.equal(impliedAlter(m[1], null, 3, 4, 1), 1);
});

test('text format round-trips', () => {
  const text = 'C4/q F#4/8. Bb3/16 En5/h r/q C4,E4,G4/w';
  assert.equal(eventsToText(ev(text)), text);
  assert.throws(() => parseEvents('H4/q'));
  assert.throws(() => parseEvents('C4/x'));
});

test('share links round-trip and are validated', () => {
  const s = { clef: 'bass', fifths: -3, time: '6/8', tempo: 72, events: ev('C3/q. D3/8 E3/8 F3/8') };
  const back = decodeScore(encodeScore(s));
  assert.equal(back.clef, 'bass');
  assert.equal(back.fifths, -3);
  assert.equal(back.time, '6/8');
  assert.equal(back.tempo, 72);
  assert.equal(eventsToText(back.events), eventsToText(s.events));
  assert.throws(() => decodeScore('clef=alto'));
  assert.throws(() => decodeScore('time=7/3'));
  assert.equal(decodeScore('tempo=999').tempo, 208);
});

test('timeline covers whole measures', () => {
  const m = buildMeasures(ev('C4/q D4/q E4/q'), '4/4', 0);
  const tl = buildTimeline(m);
  assert.equal(tl.length, 192);
  assert.deepEqual(tl.notes.map((n) => n.tick), [0, 48, 96]);
  assert.deepEqual(tl.notes.map((n) => n.midis[0]), [60, 62, 64]);
});

test('every example fits its measures exactly', () => {
  for (const x of EXAMPLES) {
    const m = buildMeasures(parseEvents(x.notes), x.time, x.fifths);
    for (const meas of m.slice(0, -1)) {
      assert.equal(meas.fill, meas.length, `${x.title}: measure ${meas.index + 1} fill`);
      assert.equal(meas.pads.length, 0, `${x.title}: measure ${meas.index + 1} pads`);
      assert.equal(meas.overfull, false);
    }
    assert.equal(m[m.length - 1].fill, 0, `${x.title}: ends on a bar line`);
  }
});

test('layout produces systems, beams and a playhead mapping', () => {
  const x = EXAMPLES.find((e) => e.id === 'minuet');
  const measures = buildMeasures(parseEvents(x.notes), x.time, x.fifths);
  const L = layoutScore({ measures, clef: x.clef, fifths: x.fifths, time: x.time, S: 14, width: 900, showNames: true, showBlocks: true, showCount: true });
  assert.ok(L.systems.length >= 3);
  assert.ok(L.systems.some((s) => s.beams.length > 0));
  assert.equal(L.events.size, parseEvents(x.notes).length);
  // Each system fits the width; systems stack downwards.
  for (let i = 1; i < L.systems.length; i++) assert.ok(L.systems[i].top >= L.systems[i - 1].bottom);
  for (const s of L.systems) assert.ok(s.x1 <= 900 + 1, `system ${s.index} width ${s.x1}`);
  // Notes in a measure are laid out left to right.
  for (const m of L.measures) {
    const xs = m.segs.map((s) => s.x0);
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b));
  }
  const loc = locateTick(L, 144);
  assert.equal(loc.measure, 1);
  // Beamed notes have no flags and share a stem direction inside a group.
  const beamed = [...L.events.values()].filter((e) => !e.rest && e.dur === '8');
  assert.ok(beamed.every((e) => e.flag === null));
  assert.ok(L.insert && L.insert.measure === measures.length - 1);
});

test('empty score still shows a blank staff to build on', () => {
  const measures = buildMeasures([], '4/4', 0);
  const L = layoutScore({ measures, clef: 'treble', fifths: 0, time: '4/4', S: 16, width: 1000 });
  assert.ok(L.measures.length >= 4);
  assert.equal(L.insert.measure, 0);
  assert.equal(L.insert.remaining, 192);
});
