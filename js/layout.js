// Engraving: turns measures into positioned glyphs, stems, beams and rows.
// Pure geometry (no DOM) so it can be tested in Node. All lengths are in px,
// derived from S = the distance between two staff lines ("staff space").
//
// Horizontal spacing is (mostly) proportional to time: a half note takes about
// twice the room of a quarter note, so the look of the staff matches the rhythm.

import {
  CLEFS,
  DURATIONS,
  STEP_NAMES,
  alterSymbol,
  beamGroupTicks,
  countLabel,
  countTicks,
  keySignatureSteps,
  MAX_POS,
  measureTicks,
  parseTime,
  posOf,
} from './theory.js';

export const GLYPH = {
  noteheadWhole: '',
  noteheadHalf: '',
  noteheadBlack: '',
  sharp: '',
  flat: '',
  natural: '',
  dot: '',
  flag8Up: '',
  flag8Down: '',
  flag16Up: '',
  flag16Down: '',
  rest: { w: '', h: '', q: '', 8: '', 16: '' },
  timeDigit: (d) => String.fromCharCode(0xe080 + d),
  noteUp: { w: '', h: '', q: '', 8: '', 16: '' },
};

// Glyph advance widths in staff spaces (Bravura metrics: 250 font units per space).
const W = {
  head: { whole: 1.688, half: 1.18, black: 1.18 },
  sharp: 0.996,
  flat: 0.904,
  natural: 0.672,
  rest: { w: 1.13, h: 1.13, q: 1.08, 8: 1.0, 16: 1.28 },
  digit: [1.88, 1.336, 1.784, 1.684, 1.88, 1.612, 1.736, 1.764, 1.744, 1.736],
  clef: { treble: 2.684, bass: 2.736 },
};
const STEM_T = 0.12;
const STEM_LEN = 3.5;

const HEAD_GLYPH = { whole: GLYPH.noteheadWhole, half: GLYPH.noteheadHalf, black: GLYPH.noteheadBlack };

/** y of staff position p, measured from the top staff line. */
export function yOf(p, S) {
  return ((8 - p) * S) / 2;
}

/** Nearest staff position for a y offset from the top staff line. */
export function posAtY(y, S) {
  return Math.round(8 - (2 * y) / S);
}

function timeDigits(n) {
  return String(n).split('').map(Number);
}

function digitsWidth(n, S) {
  return timeDigits(n).reduce((a, d) => a + W.digit[d] * S, 0);
}

function headWidth(dur, S) {
  return W.head[DURATIONS[dur].head] * S;
}

function accInfo(acc) {
  return { glyph: GLYPH[acc], w: W[acc] };
}

// ---------------------------------------------------------------- per-event geometry

/**
 * Vertical geometry of one event, with x measured from the event's own origin (0).
 * Stems/beams are finalised later (beams need the whole group).
 */
function eventShape(item, clef, S) {
  const ev = item.ev;
  const shape = { item, notes: [], leftExt: 0, rightExt: 0, minY: 0, maxY: 0 };
  if (ev.rest) {
    const p = ev.dur === 'w' ? 6 : 4;
    const w = W.rest[ev.dur] * S;
    shape.rest = { glyph: GLYPH.rest[ev.dur], y: yOf(p, S), w };
    shape.width = w;
    shape.dots = ev.dots ? [{ x: w + 0.3 * S, y: yOf(5, S) }] : [];
    shape.rightExt = ev.dots ? 0.8 * S : 0;
    shape.minY = yOf(6, S) - 1.5 * S;
    shape.maxY = yOf(2, S) + 1.5 * S;
    return shape;
  }
  const hw = headWidth(ev.dur, S);
  const headKind = DURATIONS[ev.dur].head;
  const notes = ev.notes
    .map((n, i) => ({
      i,
      step: n.step,
      octave: n.octave,
      acc: n.acc,
      alter: item.alters[i],
      midi: item.midis[i],
      p: posOf(n.step, n.octave, clef),
    }))
    .sort((a, b) => a.p - b.p);
  const minP = notes[0].p;
  const maxP = notes[notes.length - 1].p;
  shape.minP = minP;
  shape.maxP = maxP;
  shape.hw = hw;
  shape.headGlyph = HEAD_GLYPH[headKind];
  shape.hasStem = ev.dur !== 'w';
  shape.flags = DURATIONS[ev.dur].flags;
  // Stem direction: away from the note furthest from the middle line.
  shape.up = maxP - 4 < 4 - minP;
  shape.notes = notes;
  return shape;
}

/** Place noteheads (seconds go to the other side of the stem), accidentals, dots, ledgers. */
function finishShape(shape, S) {
  if (shape.rest) return shape;
  const { notes, hw, up } = shape;
  const t = STEM_T * S;
  // Noteheads: in a chord, a note a step away from its neighbour flips across the stem.
  const order = up ? notes : [...notes].reverse();
  let prev = null;
  for (const n of order) {
    let x = 0;
    if (prev && Math.abs(n.p - prev.p) === 1 && prev.x === 0 && shape.hasStem) {
      x = up ? hw - t : -(hw - t);
    } else if (prev && Math.abs(n.p - prev.p) === 1 && prev.x === 0) {
      x = hw * 0.95; // whole-note seconds just sit side by side
    }
    n.x = x;
    n.y = yOf(n.p, S);
    prev = n;
  }
  const minHeadX = Math.min(...notes.map((n) => n.x));
  const maxHeadX = Math.max(...notes.map((n) => n.x)) + hw;

  // Accidentals: stack into columns so they never collide vertically.
  const cols = [];
  const withAcc = [...notes].filter((n) => n.acc).sort((a, b) => b.p - a.p);
  for (const n of withAcc) {
    let c = 0;
    while (cols[c] && cols[c].some((q) => Math.abs(q.p - n.p) < 6)) c++;
    (cols[c] ||= []).push(n);
    const { glyph, w } = accInfo(n.acc);
    n.accGlyph = glyph;
    n.accX = minHeadX - 0.22 * S - w * S - c * 1.1 * S;
  }
  shape.leftExt = withAcc.length ? -Math.min(...withAcc.map((n) => n.accX)) : -minHeadX;

  // Augmentation dots sit in a space, to the right of the heads.
  shape.dots = [];
  if (shape.item.ev.dots) {
    const used = new Set();
    for (const n of notes) {
      const dp = n.p % 2 === 0 ? n.p + 1 : n.p;
      if (used.has(dp)) continue;
      used.add(dp);
      shape.dots.push({ x: maxHeadX + 0.3 * S, y: yOf(dp, S) });
    }
  }
  shape.rightExt = (shape.dots.length ? 0.75 * S : 0) + (maxHeadX - hw);

  // Ledger lines, spanning every head in the column.
  shape.ledgers = [];
  const lx1 = minHeadX - 0.35 * S;
  const lx2 = maxHeadX + 0.35 * S;
  for (let q = -2; q >= shape.minP; q -= 2) shape.ledgers.push({ x1: lx1, x2: lx2, y: yOf(q, S) });
  for (let q = 10; q <= shape.maxP; q += 2) shape.ledgers.push({ x1: lx1, x2: lx2, y: yOf(q, S) });
  return shape;
}

/** Default (un-beamed) stem, extended to the middle line for notes far off the staff. */
function plainStem(shape, S) {
  if (!shape.hasStem) return;
  const t = STEM_T * S;
  const top = yOf(shape.maxP, S);
  const bottom = yOf(shape.minP, S);
  const mid = yOf(4, S);
  const len = (shape.flags === 2 ? STEM_LEN + 0.25 : STEM_LEN) * S;
  if (shape.up) {
    const x = shape.hw - t / 2;
    shape.stem = { x, y1: bottom - 0.17 * S, y2: Math.min(top - len, mid) };
  } else {
    const x = t / 2;
    shape.stem = { x, y1: top + 0.17 * S, y2: Math.max(bottom + len, mid) };
  }
  if (shape.flags) {
    const glyph = shape.up
      ? shape.flags === 1 ? GLYPH.flag8Up : GLYPH.flag16Up
      : shape.flags === 1 ? GLYPH.flag8Down : GLYPH.flag16Down;
    shape.flag = { glyph, x: shape.stem.x - t / 2, y: shape.stem.y2 };
  }
}

// ---------------------------------------------------------------- beams

function findBeamGroups(measure, time) {
  const G = beamGroupTicks(time);
  const groups = [];
  let cur = [];
  const flush = () => {
    if (cur.length >= 2) groups.push(cur);
    cur = [];
  };
  for (const item of measure.items) {
    const beamable = !item.ev.rest && DURATIONS[item.ev.dur].flags > 0;
    const g0 = Math.floor(item.start / G);
    const g1 = Math.floor((item.start + item.ticks - 1) / G);
    if (!beamable || g0 !== g1) {
      flush();
      continue;
    }
    if (cur.length && Math.floor(cur[0].start / G) !== g0) flush();
    cur.push(item);
  }
  flush();
  return groups;
}

/** Compute beam lines for a group whose shapes already have absolute x (shape.ax). */
function beamGroup(shapes, S) {
  const t = STEM_T * S;
  const minP = Math.min(...shapes.map((s) => s.minP));
  const maxP = Math.max(...shapes.map((s) => s.maxP));
  const up = maxP - 4 < 4 - minP;
  const has16 = shapes.some((s) => s.flags >= 2);
  const minLen = (has16 ? 3.25 : 3.0) * S;
  const pts = shapes.map((s) => {
    s.up = up;
    finishShape(s, S); // heads may flip side with the new direction
    const x = s.ax + (up ? s.hw - t / 2 : t / 2);
    const near = up ? yOf(s.maxP, S) : yOf(s.minP, S);
    const far = up ? yOf(s.minP, S) : yOf(s.maxP, S);
    return { s, x, near, far };
  });
  const first = pts[0];
  const last = pts[pts.length - 1];
  const ideal = (p) => (up ? p.near - STEM_LEN * S : p.near + STEM_LEN * S);
  let dy = ideal(last) - ideal(first);
  dy = Math.max(-S, Math.min(S, dy));
  const dx = last.x - first.x || 1;
  const slope = dy / dx;
  let b = ideal(first);
  for (const p of pts) {
    const need = up ? p.near - minLen - slope * (p.x - first.x) : p.near + minLen - slope * (p.x - first.x);
    b = up ? Math.min(b, need) : Math.max(b, need);
  }
  // Keep beams of notes far from the staff reaching the middle line.
  const mid = yOf(4, S);
  if (up && b > mid && b + dy > mid) b = mid - Math.max(0, dy);
  if (!up && b < mid && b + dy < mid) b = mid - Math.min(0, dy);
  const lineY = (x) => b + slope * (x - first.x);
  for (const p of pts) {
    const y2 = lineY(p.x);
    p.s.stem = { x: p.x - p.s.ax, y1: up ? p.far - 0.17 * S : p.far + 0.17 * S, y2 };
    p.s.beamed = true;
    p.s.flag = null;
  }
  const th = 0.5 * S;
  const dir = up ? 1 : -1; // beams thicken toward the noteheads
  const seg = (x1, x2, level) => {
    const off = level * 0.75 * S * dir;
    const y1 = lineY(x1) + off;
    const y2 = lineY(x2) + off;
    return [
      [x1, y1],
      [x2, y2],
      [x2, y2 + th * dir],
      [x1, y1 + th * dir],
    ];
  };
  const polys = [seg(first.x - t / 2, last.x + t / 2, 0)];
  // Secondary (sixteenth) beams.
  let i = 0;
  while (i < pts.length) {
    if (pts[i].s.flags < 2) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < pts.length && pts[j + 1].s.flags >= 2) j++;
    if (j > i) {
      polys.push(seg(pts[i].x - t / 2, pts[j].x + t / 2, 1));
    } else {
      const stub = 1.1 * S;
      const left = i === pts.length - 1 || (i > 0 && pts[i - 1].s.item.ticks > pts[i].s.item.ticks);
      polys.push(left ? seg(pts[i].x - stub, pts[i].x + t / 2, 1) : seg(pts[i].x - t / 2, pts[i].x + stub, 1));
    }
    i = j + 1;
  }
  const ys = polys.flat().map((q) => q[1]);
  return { polys, minY: Math.min(...ys), maxY: Math.max(...ys) };
}

// ---------------------------------------------------------------- measures & systems

function headerLayout(clef, fifths, time, withTime, S) {
  const clefX = 0.6 * S;
  let x = clefX + W.clef[clef] * S + 0.9 * S;
  const c = CLEFS[clef];
  const keyAccs = keySignatureSteps(fifths).map((_, i) => {
    const sharp = fifths > 0;
    const acc = { x, p: sharp ? c.sharpPos[i] : c.flatPos[i], glyph: sharp ? GLYPH.sharp : GLYPH.flat };
    x += (sharp ? 1.05 : 0.95) * S;
    return acc;
  });
  if (keyAccs.length) x += 0.5 * S;
  let timeSig = null;
  if (withTime) {
    const { beats, unit } = parseTime(time);
    const wTop = digitsWidth(beats, S);
    const wBot = digitsWidth(unit, S);
    const w = Math.max(wTop, wBot);
    const glyphs = [];
    const row = (n, x0, p) => {
      let gx = x0;
      for (const d of timeDigits(n)) {
        glyphs.push({ x: gx, p, glyph: GLYPH.timeDigit(d) });
        gx += W.digit[d] * S;
      }
    };
    row(beats, x + (w - wTop) / 2, 6);
    row(unit, x + (w - wBot) / 2, 2);
    timeSig = { glyphs, x, w };
    x += w + 0.6 * S;
  }
  return { clefX, clefGlyph: c.glyph, clefY: yOf(c.glyphPos, S), keyAccs, timeSig, width: x + 0.4 * S };
}

const QW = 4.2; // staff spaces per quarter note (proportional part of spacing)

/** Build the horizontal skeleton (segments with natural widths) for a measure. */
function measureSkeleton(m, clef, S) {
  const shapes = m.items.map((item) => finishShape(eventShape(item, clef, S), S));
  const pieces = [];
  m.items.forEach((item, i) => pieces.push({ kind: 'event', tick0: item.start, ticks: item.ticks, shape: shapes[i], item }));
  m.pads.forEach((pad) => pieces.push({ kind: 'pad', tick0: pad.start, ticks: pad.ticks, pad }));
  pieces.sort((a, b) => a.tick0 - b.tick0);
  if (m.fill < m.length) pieces.push({ kind: 'open', tick0: m.fill, ticks: m.length - m.fill });

  const leftExtOf = (pc) => (pc && pc.kind === 'event' ? pc.shape.leftExt : 0);
  const prop = (ticks) => (ticks / 48) * QW * S;
  pieces.forEach((pc, i) => {
    let need;
    if (pc.kind === 'event') {
      const sh = pc.shape;
      const body = sh.rest ? sh.width : sh.hw;
      const flagRoom = !sh.rest && sh.flags && sh.up ? 0.55 * S : 0;
      need = body + sh.rightExt + flagRoom + 0.8 * S + leftExtOf(pieces[i + 1]);
    } else if (pc.kind === 'pad') {
      need = W.rest[pc.pad.dur] * S + (pc.pad.dots ? 0.8 * S : 0) + 0.8 * S + leftExtOf(pieces[i + 1]);
    } else {
      need = (m.items.length ? 3.4 : 6) * S;
    }
    pc.natural = Math.max(need, prop(pc.ticks));
  });
  const leftInner = Math.max(1.3 * S, leftExtOf(pieces[0]) + 0.6 * S);
  const rightInner = 0.5 * S;
  const flex = pieces.reduce((a, pc) => a + pc.natural, 0);
  return { pieces, leftInner, rightInner, flex, width: leftInner + flex + rightInner };
}

function emptyMeasure(index, start, length) {
  return { index, start, length, fill: 0, items: [], pads: [], overfull: false, extra: true };
}

/**
 * Lay out the whole score.
 * @returns {{systems, measures, events: Map, insert, width, height, S}}
 */
export function layoutScore(opts) {
  const { measures: content, clef, fifths, time, S, width } = opts;
  const minMeasures = opts.minMeasures ?? 4;
  const avail = Math.max(width - 0.6 * S, 10 * S);
  const header0 = headerLayout(clef, fifths, time, true, S);
  const headerN = headerLayout(clef, fifths, time, false, S);

  const list = content.map((m) => ({ m, sk: measureSkeleton(m, clef, S) }));
  const M = measureTicks(time);
  const addEmpty = () => {
    const last = list[list.length - 1].m;
    const m = emptyMeasure(last.index + 1, last.start + last.length, M);
    list.push({ m, sk: measureSkeleton(m, clef, S) });
  };
  while (list.length < minMeasures) addEmpty();

  // Greedy line breaking.
  const rows = [];
  let row = null;
  const startRow = () => {
    row = { header: rows.length ? headerN : header0, entries: [], used: 0 };
    row.used = row.header.width;
    rows.push(row);
  };
  const place = (entry) => {
    if (!row || (row.entries.length && row.used + entry.sk.width > avail)) startRow();
    row.entries.push(entry);
    row.used += entry.sk.width;
  };
  list.forEach(place);
  // Fill the last line with blank measures: the staff is the empty "baseplate".
  const emptyW = measureSkeleton(emptyMeasure(0, 0, M), clef, S).width;
  while (row.used + emptyW <= avail) {
    addEmpty();
    const e = list[list.length - 1];
    row.entries.push(e);
    row.used += e.sk.width;
  }

  const systems = [];
  const eventsById = new Map();
  const allMeasures = [];
  let y = 0;
  const lastContent = content[content.length - 1];
  let insert = null;

  rows.forEach((r, si) => {
    const sys = { index: si, header: r.header, measures: [], beams: [], events: [], x1: 0 };
    // Justify: spread the leftover space over the flexible part of each measure.
    const flexSum = r.entries.reduce((a, e) => a + e.sk.flex, 0);
    const extra = Math.max(0, avail - r.used);
    const factor = flexSum ? (flexSum + extra) / flexSum : 1;
    let x = r.header.width;
    let minY = -1.6 * S; // treble clef pokes above the staff
    let maxY = 4 * S + 1.8 * S;
    let maxChord = 1;

    for (const { m, sk } of r.entries) {
      const ml = {
        index: m.index,
        number: m.index + 1,
        start: m.start,
        length: m.length,
        fill: m.fill,
        overfull: m.overfull,
        hasContent: m.items.length > 0,
        extra: !!m.extra,
        system: si,
        x,
        segs: [],
        countMarks: [],
        pads: [],
      };
      let cx = x + sk.leftInner;
      ml.contentX = cx;
      for (const pc of sk.pieces) {
        const w = pc.natural * factor;
        const seg = { kind: pc.kind, tick0: pc.tick0, tick1: pc.tick0 + pc.ticks, x0: cx, x1: cx + w };
        ml.segs.push(seg);
        if (pc.kind === 'event') {
          const sh = pc.shape;
          sh.ax = cx;
          seg.shape = sh;
          seg.idx = pc.item.idx;
        } else if (pc.kind === 'pad') {
          seg.pad = pc.pad;
        }
        cx += w;
      }
      ml.width = cx + sk.rightInner - x;
      ml.barX = x + ml.width;
      x = ml.barX;

      // Stems & beams.
      const segByItem = new Map(ml.segs.filter((s) => s.shape).map((s) => [s.shape.item, s]));
      for (const s of ml.segs) if (s.shape && !s.shape.rest) plainStem(s.shape, S);
      for (const group of findBeamGroups(m, time)) {
        const shapes = group.map((it) => segByItem.get(it).shape);
        const beam = beamGroup(shapes, S);
        sys.beams.push(beam.polys);
        minY = Math.min(minY, beam.minY - 0.3 * S);
        maxY = Math.max(maxY, beam.maxY + 0.3 * S);
      }

      // Final event records.
      for (const s of ml.segs) {
        if (s.kind === 'open') {
          // Faint beat numbers show what the rest of the measure still needs.
          const unit = countTicks(time);
          for (let t = Math.ceil(s.tick0 / unit) * unit; t < s.tick1; t += unit) {
            const x0 = s.x0 + ((t - s.tick0) / (s.tick1 - s.tick0)) * (s.x1 - s.x0);
            ml.countMarks.push({ x: x0, tick: t, label: countLabel(t, time), open: true });
          }
          continue;
        }
        if (s.kind === 'pad') {
          ml.pads.push({
            x: s.x0,
            seg: s,
            glyph: GLYPH.rest[s.pad.dur],
            y: yOf(s.pad.dur === 'w' ? 6 : 4, S),
            dot: s.pad.dots ? { x: s.x0 + W.rest[s.pad.dur] * S + 0.3 * S, y: yOf(5, S) } : null,
            dur: s.pad.dur,
          });
          ml.countMarks.push({ x: s.x0, tick: s.tick0, label: countLabel(s.tick0, time), pad: true });
          continue;
        }
        const sh = s.shape;
        const ev = sh.item.ev;
        const rec = {
          idx: sh.item.idx,
          id: ev.id,
          dur: ev.dur,
          dots: ev.dots,
          rest: !!ev.rest,
          tick: m.start + sh.item.start,
          start: sh.item.start,
          ticks: sh.item.ticks,
          measure: m.index,
          system: si,
          x: s.x0,
          seg: s,
        };
        if (ev.rest) {
          rec.restGlyph = sh.rest.glyph;
          rec.restY = sh.rest.y;
          rec.restW = sh.rest.w;
          rec.dots = sh.dots.map((d) => ({ x: s.x0 + d.x, y: d.y }));
          rec.dotted = !!ev.dots;
        } else {
          rec.headGlyph = sh.headGlyph;
          rec.hw = sh.hw;
          rec.up = sh.up;
          rec.notes = sh.notes.map((n) => ({
            i: n.i,
            p: n.p,
            step: n.step,
            octave: n.octave,
            alter: n.alter,
            midi: n.midi,
            acc: n.acc,
            x: s.x0 + n.x,
            y: n.y,
            accGlyph: n.accGlyph,
            accX: n.accGlyph ? s.x0 + n.accX : null,
            name: STEP_NAMES[n.step] + alterSymbol(n.alter),
          }));
          rec.ledgers = sh.ledgers.map((l) => ({ x1: s.x0 + l.x1, x2: s.x0 + l.x2, y: l.y }));
          rec.stem = sh.stem ? { x: s.x0 + sh.stem.x, y1: sh.stem.y1, y2: sh.stem.y2 } : null;
          rec.flag = sh.flag ? { glyph: sh.flag.glyph, x: s.x0 + sh.flag.x, y: sh.flag.y } : null;
          rec.dots = sh.dots.map((d) => ({ x: s.x0 + d.x, y: d.y }));
          rec.dotted = !!ev.dots;
          maxChord = Math.max(maxChord, rec.notes.length);
          for (const n of rec.notes) {
            minY = Math.min(minY, n.y - 0.9 * S - (n.acc === 'flat' ? 1.2 * S : 0));
            maxY = Math.max(maxY, n.y + 0.9 * S);
          }
          if (rec.stem) {
            minY = Math.min(minY, rec.stem.y2 - (rec.flag ? 0.3 * S : 0));
            maxY = Math.max(maxY, rec.stem.y2 + (rec.flag && !rec.up ? 0.3 * S : 0));
          }
        }
        ml.countMarks.push({ x: s.x0, tick: s.tick0, label: countLabel(s.tick0, time), idx: rec.idx });
        sys.events.push(rec);
        eventsById.set(rec.idx, rec);
      }
      if (m === lastContent) {
        const open = ml.segs.find((s) => s.kind === 'open');
        insert = {
          measure: m.index,
          system: si,
          tick: m.fill,
          x: open ? open.x0 : ml.barX - 2 * S,
          remaining: m.length - m.fill,
        };
      }
      sys.measures.push(ml);
      allMeasures.push(ml);
    }

    // Vertical bands for this system.
    const numberY = Math.min(-0.9 * S, minY - 0.2 * S);
    // Always leave room (and a click target) for the highest ledger-line notes.
    const above = Math.max(-numberY + 1.0 * S, ((MAX_POS - 8) / 2) * S + 1.3 * S);
    sys.top = y;
    sys.staffY = y + above;
    sys.numberY = numberY;
    let below = Math.max(maxY, 4 * S + 2.2 * S);
    sys.rows = {};
    if (opts.showNames) {
      sys.rows.names = below + 0.9 * S;
      below += 1.25 * S * maxChord + 0.5 * S;
    }
    if (opts.showBlocks) {
      sys.rows.blocks = below + 0.3 * S;
      below += 1.9 * S;
    }
    if (opts.showCount) {
      sys.rows.count = below + 1.0 * S;
      below += 1.6 * S;
    }
    sys.maxChord = maxChord;
    sys.bottom = sys.staffY + below + 0.6 * S;
    sys.x1 = x;
    sys.hitTop = sys.top;
    sys.hitBottom = sys.staffY + Math.max(maxY, 4 * S + 3.5 * S);
    y = sys.bottom + 0.8 * S;
    systems.push(sys);
  });

  return {
    S,
    systems,
    measures: allMeasures,
    events: eventsById,
    insert,
    width: Math.max(width, ...systems.map((s) => s.x1 + 0.5 * S)),
    height: y,
  };
}

/** x of an absolute tick inside the laid-out score (for the playhead). */
export function locateTick(layout, tick) {
  for (const m of layout.measures) {
    if (tick < m.start || tick >= m.start + m.length) continue;
    const rel = tick - m.start;
    for (const s of m.segs) {
      if (rel >= s.tick0 && rel < s.tick1) {
        const f = (rel - s.tick0) / (s.tick1 - s.tick0);
        return { system: m.system, x: s.x0 + f * (s.x1 - s.x0), measure: m.index };
      }
    }
    return { system: m.system, x: m.contentX, measure: m.index };
  }
  return null;
}
