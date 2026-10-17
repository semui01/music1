// Note Blocks — app controller: state, input (pointer, keyboard, piano), playback,
// undo/redo, persistence and the Learn panel.

import * as T from './theory.js';
import {
  buildMeasures,
  buildTimeline,
  decodeScore,
  defaultScore,
  encodeScore,
  eventsToText,
  impliedAlter,
  makeEvent,
  parseEvents,
} from './score.js';
import { GLYPH, layoutScore, locateTick, posAtY } from './layout.js';
import { renderOverlay, renderScore } from './render.js';
import { Piano } from './audio.js';
import { Player } from './player.js';
import * as Learn from './learn.js';
import { EXAMPLES } from './examples.js';

const STORE_KEY = 'noteblocks:v1';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ACC_NAME = { 1: 'sharp', '-1': 'flat', 0: 'natural' };
const ACC_W = { sharp: 0.996, flat: 0.904, natural: 0.672 };

// ---------------------------------------------------------------- state

const state = {
  score: defaultScore(),
  tool: { dur: 'q', dots: 0, rest: false, acc: null, stack: false },
  view: { names: true, blocks: true, count: true, colors: 'pitch', zoom: 1, theme: null },
  quests: {},
  questsOpen: true,
  pianoAdds: true,
  loop: false,
  metronome: false,
  selection: null, // { idx, note }
};

let measures = [];
let layout = null;
let overlay = null;
let hover = null;
let press = null;
let playhead = null;
let pendingFlash = null;
let playingIdx = new Set();
let lastPlayheadSystem = -1;
const undoStack = [];
const redoStack = [];

const piano = new Piano();
const player = new Player(piano, { onFrame, onEnd });

const el = {};

// ---------------------------------------------------------------- helpers

function snapshot() {
  const s = state.score;
  return JSON.stringify({ clef: s.clef, fifths: s.fifths, time: s.time, events: eventsToText(s.events) });
}

function restore(json) {
  const s = JSON.parse(json);
  Object.assign(state.score, { clef: s.clef, fifths: s.fifths, time: s.time, events: parseEvents(s.events) });
}

/** Apply a change to the score as one undoable step. */
function commit(fn) {
  undoStack.push(snapshot());
  if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
  fn();
  refresh();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  state.selection = null;
  afterHistoryJump();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  state.selection = null;
  afterHistoryJump();
}

function afterHistoryJump() {
  refresh();
  syncSettingsUI();
  buildPiano();
  updateCards();
}

function itemOf(idx) {
  for (const m of measures) {
    const k = m.items.findIndex((it) => it.idx === idx);
    if (k >= 0) return { m, item: m.items[k], k };
  }
  return null;
}

function timeNow() {
  return piano.now;
}

function spt() {
  return T.secondsPerTick(state.score.tempo, state.score.time);
}

// ---------------------------------------------------------------- refresh & render

function refresh() {
  const s = state.score;
  measures = buildMeasures(s.events, s.time, s.fifths);
  if (state.selection) {
    const ev = s.events[state.selection.idx];
    if (!ev) state.selection = null;
    else if (!ev.rest && state.selection.note >= ev.notes.length) state.selection.note = 0;
  }
  relayout();
  updatePlayerTimeline();
  syncPalette();
  updateStatus();
  updateUndoButtons();
  save();
}

function staffSpace() {
  const w = el.scroller.clientWidth || 800;
  const base = w < 480 ? 11.5 : w < 760 ? 13.5 : 16;
  return clamp(base * state.view.zoom, 8, 30);
}

function relayout() {
  const s = state.score;
  const S = staffSpace();
  layout = layoutScore({
    measures,
    clef: s.clef,
    fifths: s.fifths,
    time: s.time,
    S,
    width: el.scroller.clientWidth - 2,
    showNames: state.view.names,
    showBlocks: state.view.blocks,
    showCount: state.view.count,
  });
  el.svg.style.setProperty('--S', `${S}px`);
  el.svg.classList.remove('color-pitch', 'color-length', 'color-off');
  el.svg.classList.add(`color-${state.view.colors}`);
  overlay = renderScore(el.svg, layout, {
    selection: state.selection,
    insertMeasure: layout.insert ? layout.insert.measure : -1,
    countTicks: T.countTicks(s.time),
  });
  if (pendingFlash !== null) {
    const g = el.svg.querySelector(`.ev[data-idx="${pendingFlash}"]`);
    if (g) g.classList.add('flash');
    pendingFlash = null;
  }
  for (const idx of playingIdx) markPlaying(idx, true);
  if (hover && hover.hit) hover = buildHover(hitAgain(hover.hit));
  drawOverlay();
}

function hitAgain(hit) {
  // After a re-layout the old hit's positions are stale; recompute from the stored point.
  return hit.pt ? hitTest(hit.pt.x, hit.pt.y) : null;
}

function drawOverlay() {
  if (!overlay || !layout) return;
  const o = {};
  if (hover) {
    o.band = hover.band;
    o.ghost = hover.ghost;
    o.column = hover.column;
  }
  if (playhead) o.playhead = playhead;
  renderOverlay(overlay, layout, o);
}

// ---------------------------------------------------------------- hit testing

function pointerPos(e) {
  const r = el.svg.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function hitTest(x, y) {
  if (!layout) return null;
  const S = layout.S;
  const si = layout.systems.findIndex((s) => y >= s.hitTop && y < s.hitBottom);
  if (si < 0) return null;
  const sys = layout.systems[si];
  const p = clamp(posAtY(y - sys.staffY, S), T.MIN_POS, T.MAX_POS);
  const ins = layout.insert;
  let m = sys.measures.find((mm) => x >= mm.x && x < mm.barX);
  if (!m) m = x < sys.measures[0].x ? sys.measures[0] : sys.measures[sys.measures.length - 1];
  const base = { si, p, pt: { x, y } };
  const before = m.index < ins.measure || (m.index === ins.measure && x < ins.x - 0.5 * S);
  if (before) {
    const evSegs = m.segs.filter((s) => s.kind === 'event');
    if (evSegs.length) {
      let seg = evSegs[0];
      for (const s of evSegs) if (x >= s.x0 - 0.7 * S) seg = s;
      const ev = layout.events.get(seg.idx);
      if (ev.rest) return { ...base, kind: 'rest', idx: ev.idx, ev };
      const hitN = ev.notes.find((n) => n.p === p);
      if (hitN) return { ...base, kind: 'note', idx: ev.idx, note: hitN.i, ev };
      return { ...base, kind: 'column', idx: ev.idx, ev };
    }
  }
  return { ...base, kind: 'append' };
}

function ghostFor({ system, x, p, dur, dots, rest, acc, ok, label }) {
  const S = layout.S;
  const head = T.DURATIONS[dur].head;
  return {
    system,
    x,
    p,
    dur,
    rest,
    ok,
    label,
    dotted: !!dots,
    headGlyph: head === 'whole' ? GLYPH.noteheadWhole : head === 'half' ? GLYPH.noteheadHalf : GLYPH.noteheadBlack,
    hw: (head === 'whole' ? 1.688 : 1.18) * S,
    accGlyph: acc ? GLYPH[acc] : null,
    accW: acc ? ACC_W[acc] : 0,
    stem: dur !== 'w',
    flags: T.DURATIONS[dur].flags,
  };
}

function columnOf(ev) {
  const S = layout.S;
  return { system: ev.system, x0: ev.seg.x0 - 0.7 * S, x1: ev.seg.x1 - 0.7 * S };
}

/** Turn a hit into what the overlay shows and what a click would do. */
function buildHover(hit) {
  if (!hit) return null;
  const { clef, fifths, time } = state.score;
  const tool = state.tool;
  const pitch = T.pitchAtPos(hit.p, clef);
  const out = { hit, band: { system: hit.si, p: hit.p } };
  if (hit.kind === 'append') {
    const ins = layout.insert;
    const ticks = T.durationTicks(tool.dur, tool.dots);
    const ok = ticks <= ins.remaining;
    const alter = tool.acc ? T.ACC_ALTER[tool.acc] : impliedAlter(measures[ins.measure], null, pitch.step, pitch.octave, fifths);
    let label = tool.rest ? 'rest' : T.pitchLabel(pitch.step, pitch.octave, alter);
    if (!ok) label = `only ${Learn.lengthLabel(ins.remaining, time)} left`;
    out.ghost = ghostFor({ system: ins.system, x: ins.x, p: hit.p, dur: tool.dur, dots: tool.dots, rest: tool.rest, acc: tool.rest ? null : tool.acc, ok, label });
    if (tool.rest) out.band = null;
    out.action = { type: 'append', ok, p: hit.p };
  } else if (hit.kind === 'rest') {
    const ev = hit.ev;
    const io = itemOf(ev.idx);
    const alter = tool.acc ? T.ACC_ALTER[tool.acc] : impliedAlter(io.m, io.k, pitch.step, pitch.octave, fifths);
    out.ghost = ghostFor({ system: ev.system, x: ev.x, p: hit.p, dur: ev.dur, dots: ev.dots, acc: tool.acc, ok: true, label: `${T.pitchLabel(pitch.step, pitch.octave, alter)} instead of the rest` });
    out.action = { type: 'fillRest', idx: ev.idx, p: hit.p };
  } else if (hit.kind === 'column') {
    const ev = hit.ev;
    if (tool.stack) {
      const io = itemOf(ev.idx);
      const alter = tool.acc ? T.ACC_ALTER[tool.acc] : impliedAlter(io.m, io.k, pitch.step, pitch.octave, fifths);
      out.ghost = ghostFor({ system: ev.system, x: ev.x, p: hit.p, dur: ev.dur, dots: 0, acc: tool.acc, ok: true, label: `+ ${T.pitchLabel(pitch.step, pitch.octave, alter)}` });
      out.ghost.stem = false;
      out.action = { type: 'chord', idx: ev.idx, p: hit.p };
    } else {
      out.column = columnOf(ev);
      out.action = { type: 'select', idx: ev.idx };
    }
  } else if (hit.kind === 'note') {
    out.column = columnOf(hit.ev);
    out.action = { type: 'select', idx: hit.idx, note: hit.note };
  }
  return out;
}

// ---------------------------------------------------------------- pointer input on the staff

function setCursor(hit) {
  el.svg.classList.toggle('cur-grab', !!hit && (hit.kind === 'note' || (hit.kind === 'column' && !state.tool.stack)));
  el.svg.classList.toggle('cur-drag', !!press && press.type === 'drag');
}

function onPointerMove(e) {
  const pt = pointerPos(e);
  if (press && press.type === 'drag') {
    dragTo(pt);
    return;
  }
  if (press && press.type !== 'place') return;
  const hit = hitTest(pt.x, pt.y);
  const prevP = hover && hover.action ? hover.action.p : null;
  hover = buildHover(hit);
  if (press && hover && hover.action && hover.action.p !== undefined && hover.action.p !== prevP) {
    previewPitch(hover); // dragging a new note up/down lets you hear before you let go
  }
  setCursor(hit);
  drawOverlay();
  updateHoverStatus(hit);
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  piano.resume();
  el.svg.focus({ preventScroll: true });
  const pt = pointerPos(e);
  const hit = hitTest(pt.x, pt.y);
  if (!hit) {
    if (state.selection) deselect();
    return;
  }
  hover = buildHover(hit);
  drawOverlay();
  const act = hover.action;
  if (act.type === 'select') {
    const ev = state.score.events[act.idx];
    let note = act.note;
    if (note === undefined) {
      // Pick the note in the chord nearest to the pointer.
      const notes = hit.ev.notes;
      note = notes.reduce((best, n) => (Math.abs(n.p - hit.p) < Math.abs(best.p - hit.p) ? n : best), notes[0]).i;
    }
    select(act.idx, note);
    const io = itemOf(act.idx);
    if (io && !ev.rest) playMidis([io.item.midis[note]], 0.6);
    press = { type: 'drag', idx: act.idx, note, si: hit.si, curP: T.posOf(ev.notes[note].step, ev.notes[note].octave, state.score.clef), moved: false };
  } else {
    press = { type: 'place' };
  }
  try {
    el.svg.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  setCursor(hit);
}

function onPointerUp(e) {
  if (!press) return;
  const pr = press;
  press = null;
  try {
    el.svg.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  if (pr.type === 'place') {
    const pt = pointerPos(e);
    hover = buildHover(hitTest(pt.x, pt.y));
    if (hover && hover.action) runAction(hover.action);
  } else if (pr.type === 'drag' && pr.moved) {
    const ev = state.score.events[pr.idx];
    const io = itemOf(pr.idx);
    if (ev && io) setTip(`Moved to <strong>${T.pitchLabel(ev.notes[pr.note].step, ev.notes[pr.note].octave, io.item.alters[pr.note])}</strong>. Tip: ↑ and ↓ keys move a selected note one line or space at a time.`);
  }
  const pt = pointerPos(e);
  hover = buildHover(hitTest(pt.x, pt.y));
  setCursor(hover && hover.hit);
  drawOverlay();
}

function onPointerCancel() {
  press = null;
  hover = null;
  drawOverlay();
}

function dragTo(pt) {
  const pr = press;
  const sys = layout.systems[layout.events.get(pr.idx)?.system ?? pr.si];
  const p = clamp(posAtY(pt.y - sys.staffY, layout.S), T.MIN_POS, T.MAX_POS);
  if (p === pr.curP) return;
  const ev = state.score.events[pr.idx];
  const clef = state.score.clef;
  if (ev.notes.some((n, i) => i !== pr.note && T.posOf(n.step, n.octave, clef) === p)) return;
  if (!pr.moved) {
    undoStack.push(snapshot());
    redoStack.length = 0;
    pr.moved = true;
  }
  const pitch = T.pitchAtPos(p, clef);
  const n = ev.notes[pr.note];
  n.step = pitch.step;
  n.octave = pitch.octave;
  n.acc = null;
  pr.curP = p;
  hover = { band: { system: sys.index, p } };
  refresh();
  const io = itemOf(pr.idx);
  if (io) playMidis([io.item.midis[pr.note]], 0.45);
}

function runAction(act) {
  if (act.type === 'append') {
    if (!act.ok) return showNoFit();
    if (state.tool.rest) placeRest();
    else placeNote(T.pitchAtPos(act.p, state.score.clef), state.tool.acc);
  } else if (act.type === 'fillRest') {
    fillRest(act.idx, act.p);
  } else if (act.type === 'chord') {
    addToChord(act.idx, act.p);
  }
}

// ---------------------------------------------------------------- editing

function insertInfo() {
  return layout.insert;
}

function placeNote(pitch, acc, { quiet = false } = {}) {
  const { tool } = state;
  const ins = insertInfo();
  const ticks = T.durationTicks(tool.dur, tool.dots);
  if (ticks > ins.remaining) {
    showNoFit();
    return false;
  }
  const ev = makeEvent({ dur: tool.dur, dots: tool.dots, notes: [{ step: pitch.step, octave: pitch.octave, acc: acc || null }] });
  state.selection = null;
  pendingFlash = state.score.events.length;
  commit(() => state.score.events.push(ev));
  const idx = state.score.events.length - 1;
  afterPlace(idx, { written: !!acc, quiet });
  return true;
}

function placeRest() {
  const { tool } = state;
  const ins = insertInfo();
  if (T.durationTicks(tool.dur, tool.dots) > ins.remaining) return showNoFit();
  state.selection = null;
  pendingFlash = state.score.events.length;
  commit(() => state.score.events.push(makeEvent({ dur: tool.dur, dots: tool.dots, rest: true })));
  quest('rest');
  const io = itemOf(state.score.events.length - 1);
  const left = io.m.length - io.m.fill;
  setTip(`${Learn.durationTip(tool.dur, tool.dots, true, state.score.time)} ${left > 0 ? `Measure ${io.m.index + 1} has ${Learn.lengthLabel(left, state.score.time)} left.` : `Measure ${io.m.index + 1} is full!`}`);
  if (left <= 0) quest('full');
}

function afterPlace(idx, { written, chord = false, quiet = false }) {
  const io = itemOf(idx);
  if (!io) return;
  const { m, item } = io;
  const ev = item.ev;
  const ni = chord ? ev.notes.length - 1 : 0;
  const n = ev.notes[ni];
  const { clef, fifths, time } = state.score;
  if (!quiet) playMidis(chord ? item.midis : [item.midis[ni]], noteSeconds(item.ticks));
  const alter = item.alters[ni];
  const keyA = T.keyAlter(n.step, fifths);
  quest('first');
  if (!chord && (ev.dur === 'h' || ev.dur === 'w')) quest('long');
  if (n.acc === 'sharp' || n.acc === 'flat') quest('acc');
  if (chord) quest('chord');
  const rec = layout.events.get(idx);
  if (rec && !rec.rest && T.DURATIONS[ev.dur].flags && rec.stem && !rec.flag) quest('short');
  const left = m.length - m.fill;
  if (!chord && left <= 0) quest('full');
  setTip(
    Learn.placedTip({
      step: n.step,
      octave: n.octave,
      alter,
      p: T.posOf(n.step, n.octave, clef),
      clef,
      fifths,
      written,
      keyApplied: !n.acc && keyA !== 0 && alter === keyA,
      carried: !n.acc && alter !== keyA,
      dur: ev.dur,
      dots: ev.dots,
      measureNo: m.index + 1,
      left,
      time,
      chord,
    }),
  );
}

function fillRest(idx, p) {
  const pitch = T.pitchAtPos(p, state.score.clef);
  pendingFlash = idx;
  commit(() => {
    const ev = state.score.events[idx];
    ev.rest = false;
    ev.notes = [{ step: pitch.step, octave: pitch.octave, acc: state.tool.acc || null }];
  });
  afterPlace(idx, { written: !!state.tool.acc });
}

function addToChord(idx, p) {
  const { clef } = state.score;
  const ev = state.score.events[idx];
  if (ev.notes.some((n) => T.posOf(n.step, n.octave, clef) === p)) return;
  if (ev.notes.length >= 6) return setTip('That chord already has six notes — that’s plenty of blocks for one stack!', { warn: true });
  const pitch = T.pitchAtPos(p, clef);
  pendingFlash = idx;
  commit(() => ev.notes.push({ step: pitch.step, octave: pitch.octave, acc: state.tool.acc || null }));
  afterPlace(idx, { written: !!state.tool.acc, chord: true });
}

function showNoFit() {
  const { tool } = state;
  const ins = insertInfo();
  const M = T.measureTicks(state.score.time);
  setTip(Learn.noFitTip(tool.dur, tool.dots, ins.remaining, M, state.score.time, ins.measure + 1), { warn: true });
  el.svg.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 220 });
  return false;
}

function select(idx, note = 0) {
  state.selection = { idx, note };
  relayout();
  updateStatus();
  syncPalette();
}

function deselect() {
  if (!state.selection) return;
  state.selection = null;
  relayout();
  updateStatus();
  syncPalette();
}

function deleteSelection() {
  const events = state.score.events;
  if (!events.length) return;
  const sel = state.selection;
  if (sel && events[sel.idx]) {
    const ev = events[sel.idx];
    commit(() => {
      if (!ev.rest && ev.notes.length > 1) ev.notes.splice(sel.note, 1);
      else events.splice(sel.idx, 1);
    });
    if (state.score.events[sel.idx] === ev) state.selection = { idx: sel.idx, note: 0 };
    else state.selection = null;
    relayout();
    updateStatus();
    syncPalette();
  } else {
    commit(() => events.pop());
  }
}

function moveSelection(delta) {
  const sel = state.selection;
  if (!sel) return;
  const ev = state.score.events[sel.idx];
  if (!ev || ev.rest) return;
  const { clef } = state.score;
  const n = ev.notes[sel.note];
  const d = T.diatonic(n.step, n.octave) + delta;
  const p = d - T.CLEFS[clef].bottom;
  if (p < T.MIN_POS - 2 || p > T.MAX_POS + 2) return;
  if (ev.notes.some((o, i) => i !== sel.note && T.diatonic(o.step, o.octave) === d)) return;
  commit(() => {
    const pt = T.fromDiatonic(d);
    n.step = pt.step;
    n.octave = pt.octave;
    n.acc = null;
  });
  const io = itemOf(sel.idx);
  if (io) playMidis([io.item.midis[sel.note]], 0.5);
}

function selectStep(dir) {
  const n = state.score.events.length;
  if (!n) return;
  let idx = state.selection ? state.selection.idx + dir : dir > 0 ? 0 : n - 1;
  idx = clamp(idx, 0, n - 1);
  select(idx, 0);
  const io = itemOf(idx);
  if (io && !io.item.ev.rest) playMidis(io.item.midis, 0.5);
  scrollEventIntoView(idx);
}

function scrollEventIntoView(idx) {
  const rec = layout.events.get(idx);
  if (!rec) return;
  const sys = layout.systems[rec.system];
  const sc = el.scroller;
  if (sys.top < sc.scrollTop || sys.bottom > sc.scrollTop + sc.clientHeight) sc.scrollTo({ top: sys.top - 6, behavior: 'smooth' });
}

/** Add a note from a letter key (A–G), choosing the octave nearest the previous note. */
function addLetter(step) {
  const { clef, events } = state.score;
  const c = T.CLEFS[clef];
  let prev = c.home;
  for (let i = events.length - 1; i >= 0; i--) {
    if (!events[i].rest) {
      const top = events[i].notes.reduce((a, n) => Math.max(a, T.diatonic(n.step, n.octave)), -Infinity);
      prev = top;
      break;
    }
  }
  let best = null;
  for (let k = -2; k <= 2; k++) {
    const d = (Math.floor(prev / 7) + k) * 7 + step;
    if (best === null || Math.abs(d - prev) < Math.abs(best - prev) || (Math.abs(d - prev) === Math.abs(best - prev) && d > best)) best = d;
  }
  while (best - c.bottom < T.MIN_POS) best += 7;
  while (best - c.bottom > T.MAX_POS) best -= 7;
  placeNote(T.fromDiatonic(best), state.tool.acc);
}

// ---------------------------------------------------------------- palette

function buildPalette() {
  el.durations.innerHTML = T.DURATION_ORDER.map((dur) => {
    const d = T.DURATIONS[dur];
    return `<button class="brick-btn d-${dur}" role="radio" data-dur="${dur}" aria-checked="false">
      <svg class="bglyph" viewBox="0 0 28 44" aria-hidden="true">${dur === 'w' || dur === 'h' ? `<line class="rline" x1="0" x2="20" y1="${dur === 'w' ? 16 : 24}" y2="${dur === 'w' ? 16 : 24}"/>` : ''}<text x="3" y="33">${GLYPH.noteUp[dur]}</text><text class="bdot" x="${dur === 'w' ? 21 : 15}" y="33"></text></svg>
      <span class="nm">${d.name[0].toUpperCase() + d.name.slice(1)}</span>
      <span class="beats"></span>
    </button>`;
  }).join('');
}

/** What the palette shows: the selected block while editing, otherwise the tool. */
function shownTool() {
  const sel = state.selection;
  const ev = sel && state.score.events[sel.idx];
  if (!ev) return { ...state.tool, editing: false };
  return {
    dur: ev.dur,
    dots: ev.dots,
    rest: ev.rest,
    acc: ev.rest ? null : ev.notes[sel.note].acc,
    stack: state.tool.stack,
    editing: true,
  };
}

function syncPalette() {
  const tool = shownTool();
  const time = state.score.time;
  el.palette.classList.toggle('editing', tool.editing);
  el.palette.classList.toggle('rest-mode', tool.rest);
  el.paletteHint.textContent = tool.editing ? 'editing the selected block — pick a length to change it' : 'pick one, then click the staff';
  for (const b of $$('.brick-btn', el.durations)) {
    const dur = b.dataset.dur;
    b.setAttribute('aria-checked', String(dur === tool.dur));
    const ticks = T.durationTicks(dur, tool.dots);
    $('.beats', b).textContent = Learn.lengthLabel(ticks, time);
    $('.bdot', b).textContent = tool.dots ? GLYPH.dot : '';
    const name = Learn.noteName(dur, tool.dots, tool.rest);
    b.setAttribute('aria-label', `${name}, ${Learn.lengthLabel(ticks, time)}`);
    b.title = `${name[0].toUpperCase() + name.slice(1)} — ${Learn.lengthLabel(ticks, time)} (key ${T.DURATION_ORDER.indexOf(dur) + 1})`;
    // Rest glyphs on the bricks while placing rests.
    const g = $('.bglyph text', b);
    g.textContent = tool.rest ? GLYPH.rest[dur] : GLYPH.noteUp[dur];
    g.setAttribute('y', tool.rest ? { w: 16, h: 24 }[dur] ?? 24 : dur === 'w' ? 26 : 33);
  }
  $('#dot').setAttribute('aria-pressed', String(!!tool.dots));
  $('#rest').setAttribute('aria-pressed', String(tool.rest));
  $('#stack').setAttribute('aria-pressed', String(tool.stack));
  for (const b of $$('#accidentals .chip')) b.setAttribute('aria-checked', String((b.dataset.acc || null) === tool.acc));
  updatePaletteFit();
}

function updatePaletteFit() {
  if (!layout) return;
  const rem = layout.insert.remaining;
  for (const b of $$('.brick-btn', el.durations)) {
    const ticks = T.durationTicks(b.dataset.dur, state.tool.dots);
    const nofit = !state.selection && ticks > rem;
    b.classList.toggle('nofit', nofit);
  }
}

function setDuration(dur) {
  state.tool.dur = dur;
  const sel = state.selection;
  if (sel && state.score.events[sel.idx]) {
    const ev = state.score.events[sel.idx];
    if (ev.dur !== dur) {
      commit(() => (ev.dur = dur));
      reflowTip();
    }
  } else {
    setTip(Learn.durationTip(dur, state.tool.dots, state.tool.rest, state.score.time));
  }
  syncPalette();
  saveSoon();
  refreshHover();
}

function toggleDot() {
  const sel = state.selection;
  if (sel && state.score.events[sel.idx]) {
    const ev = state.score.events[sel.idx];
    state.tool.dots = ev.dots ? 0 : 1;
    commit(() => (ev.dots = state.tool.dots));
    reflowTip();
  } else {
    state.tool.dots = state.tool.dots ? 0 : 1;
    setTip(state.tool.dots ? Learn.durationTip(state.tool.dur, 1, state.tool.rest, state.score.time) : 'Dots off — blocks are back to their plain length.');
  }
  syncPalette();
  saveSoon();
  refreshHover();
}

function reflowTip() {
  const padded = measures.some((m) => m.pads.length);
  const over = measures.some((m) => m.overfull);
  if (over) setTip('One block is now longer than a whole measure — it’s shown in red. Pick a shorter length for it.', { warn: true });
  else if (padded) setTip('Changing that length pushed a note into the next measure, so grey filler rests now pad the gap. Adjust a neighbouring note to tidy it up — or Undo.', { warn: true });
  else setTip('Length changed. The notes after it moved along to make room.');
}

function toggleRest() {
  const sel = state.selection;
  if (sel && state.score.events[sel.idx]) {
    const ev = state.score.events[sel.idx];
    const home = T.fromDiatonic(T.CLEFS[state.score.clef].home);
    commit(() => {
      ev.rest = !ev.rest;
      ev.notes = ev.rest ? [] : [{ step: home.step, octave: home.octave, acc: null }];
    });
    state.selection = { idx: sel.idx, note: 0 };
    if (ev.rest) quest('rest');
    setTip(ev.rest ? 'That note is now a rest — the same length, but silent.' : 'The rest is now a note on the middle line. Drag it up or down to the pitch you want.');
    relayout();
    updateStatus();
    syncPalette();
    return;
  }
  state.tool.rest = !state.tool.rest;
  setTip(state.tool.rest ? Learn.durationTip(state.tool.dur, state.tool.dots, true, state.score.time) : 'Back to placing notes.');
  syncPalette();
  saveSoon();
  refreshHover();
}

function toggleStack() {
  state.tool.stack = !state.tool.stack;
  setTip(
    state.tool.stack
      ? 'Chord mode: click <strong>above or below an existing note</strong> to stack another note on it. Stacked notes sound together — that’s a <em>chord</em>.'
      : 'Chord mode off — clicks add new notes one after another again.',
  );
  syncPalette();
  saveSoon();
  refreshHover();
}

function setAcc(acc) {
  const sel = state.selection;
  if (sel && state.score.events[sel.idx] && !state.score.events[sel.idx].rest) {
    const n = state.score.events[sel.idx].notes[sel.note];
    const next = n.acc === acc ? null : acc;
    commit(() => (n.acc = next));
    if (next === 'sharp' || next === 'flat') quest('acc');
    const io = itemOf(sel.idx);
    if (io) playMidis([io.item.midis[sel.note]], 0.5);
  }
  state.tool.acc = acc;
  setTip(Learn.accidentalTip(acc));
  syncPalette();
  saveSoon();
  refreshHover();
}

function refreshHover() {
  if (hover && hover.hit) hover = buildHover(hitAgain(hover.hit));
  drawOverlay();
}

// ---------------------------------------------------------------- settings

function buildSettings() {
  el.key.innerHTML = [...T.KEYS]
    .sort((a, b) => Math.abs(a.fifths) - Math.abs(b.fifths) || b.fifths - a.fifths)
    .map((k) => `<option value="${k.fifths}">${k.major} major / ${k.minor} minor — ${T.keyLabel(k.fifths)}</option>`)
    .join('');
  el.time.innerHTML = T.TIME_SIGNATURES.map((t) => {
    const { beats, unit } = T.parseTime(t);
    return `<option value="${t}">${t} — ${beats} ${T.unitName(unit)} beats${T.isCompound(t) ? ' (in groups of 3)' : ''}</option>`;
  }).join('');
  el.examples.innerHTML =
    '<option value="">Examples…</option>' + EXAMPLES.map((x) => `<option value="${x.id}">${x.title}</option>`).join('');
}

function syncSettingsUI() {
  const s = state.score;
  for (const b of $$('#clef button')) b.setAttribute('aria-checked', String(b.dataset.clef === s.clef));
  el.key.value = String(s.fifths);
  el.time.value = s.time;
  el.tempo.value = String(s.tempo);
  updateTempoOut();
  syncPalette();
  syncView();
}

function updateTempoOut() {
  const s = state.score;
  const t = T.tempoTerm(s.tempo);
  const beatGlyph = T.isCompound(s.time) ? `${GLYPH.noteUp.q}${GLYPH.dot}` : GLYPH.noteUp[{ 2: 'h', 4: 'q', 8: '8' }[T.parseTime(s.time).unit]];
  el.tempoOut.innerHTML = `<span class="mg">${beatGlyph}</span> = ${s.tempo} · <span class="term">${t.name}</span>`;
}

function setClef(clef) {
  if (clef === state.score.clef) return;
  commit(() => (state.score.clef = clef));
  syncSettingsUI();
  buildPiano();
  updateCards();
  setTip(
    `Switched to the <strong>${T.CLEFS[clef].name}</strong>. The clef doesn’t change how notes sound — the same notes just sit in different places on the staff. Lines: <strong>${T.CLEFS[clef].lines}</strong>.`,
  );
}

function setKey(fifths) {
  if (fifths === state.score.fifths) return;
  commit(() => (state.score.fifths = fifths));
  quest('key');
  updateCards();
  syncSettingsUI();
  const k = T.KEYS.find((x) => x.fifths === fifths);
  const names = T.keySignatureNames(fifths);
  setTip(
    names.length
      ? `<strong>${k.major} major</strong> has ${T.keyLabel(fifths)}: ${names.join(', ')}. They appear at the start of every line, and every matching note follows them — listen to your music now!`
      : '<strong>C major</strong> has no sharps or flats — only white keys.',
  );
}

function setTime(time) {
  if (time === state.score.time) return;
  commit(() => (state.score.time = time));
  quest('time');
  player.setTempo(state.score.tempo, time);
  updateCards();
  syncSettingsUI();
  const { beats, unit } = T.parseTime(time);
  const regroup = state.score.events.length ? ' Your notes have been regrouped into the new measures.' : '';
  setTip(`<strong>${time}</strong>: ${beats} ${T.unitName(unit)}-note beats in every measure.${regroup}`);
}

function setTempo(bpm) {
  state.score.tempo = clamp(Math.round(bpm), T.MIN_TEMPO, T.MAX_TEMPO);
  el.tempo.value = String(state.score.tempo);
  player.setTempo(state.score.tempo, state.score.time);
  updateTempoOut();
  el.cardTempo.innerHTML = Learn.tempoCard(state.score.tempo, state.score.time);
  saveSoon();
}

// ---------------------------------------------------------------- view

function syncView() {
  const v = state.view;
  $('#v-names').setAttribute('aria-pressed', String(v.names));
  $('#v-blocks').setAttribute('aria-pressed', String(v.blocks));
  $('#v-count').setAttribute('aria-pressed', String(v.count));
  el.colors.value = v.colors;
  el.piano.classList.toggle('color-pitch', v.colors === 'pitch');
  $('#loop').setAttribute('aria-pressed', String(state.loop));
  $('#metronome').setAttribute('aria-pressed', String(state.metronome));
  el.pianoAdds.checked = state.pianoAdds;
}

function toggleView(key) {
  state.view[key] = !state.view[key];
  syncView();
  relayout();
  saveSoon();
}

/** Only set the theme once the user has picked one; otherwise follow the system (or host page). */
function applyTheme() {
  if (state.view.theme) document.documentElement.setAttribute('data-theme', state.view.theme);
}

function toggleTheme() {
  const attr = document.documentElement.getAttribute('data-theme');
  const dark = attr ? attr === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  state.view.theme = dark ? 'light' : 'dark';
  applyTheme();
  saveSoon();
}

// ---------------------------------------------------------------- sound helpers

function noteSeconds(ticks) {
  return clamp(ticks * spt(), 0.3, 1.6);
}

function playMidis(midis, seconds = 0.8) {
  piano.resume();
  const t = timeNow() + 0.01;
  for (const m of midis) piano.play(m, t, seconds, 0.72);
  flashKeys(midis, seconds);
}

function previewPitch(h) {
  if (!h || !h.ghost || h.ghost.rest || !h.ghost.ok) return;
  const { clef, fifths } = state.score;
  const pitch = T.pitchAtPos(h.ghost.p, clef);
  const tool = state.tool;
  let alter;
  if (tool.acc) alter = T.ACC_ALTER[tool.acc];
  else {
    const io = h.action.idx !== undefined ? itemOf(h.action.idx) : null;
    alter = io ? impliedAlter(io.m, io.k, pitch.step, pitch.octave, fifths) : impliedAlter(measures[layout.insert.measure], null, pitch.step, pitch.octave, fifths);
  }
  playMidis([T.midiOf(pitch.step, pitch.octave, alter)], 0.35);
}

function playScale(mode) {
  piano.resume();
  const { fifths, clef } = state.score;
  const tonic = T.tonicStep(fifths, mode);
  const oct = clef === 'bass' ? (tonic <= 2 ? 3 : 2) : tonic >= 5 ? 3 : 4;
  const up = T.scaleNotes(fifths, mode, oct);
  const seq = [...up, ...up.slice(0, -1).reverse()];
  const step = 0.3;
  const t0 = timeNow() + 0.05;
  seq.forEach((n, i) => {
    const midi = T.midiOf(n.step, n.octave, n.alter);
    piano.play(midi, t0 + i * step, step * 0.95, 0.7);
    setTimeout(() => flashKeys([midi], step * 0.9), (0.05 + i * step) * 1000);
  });
  const k = T.KEYS.find((x) => x.fifths === fifths);
  setTip(`The <strong>${mode === 'major' ? `${k.major} major` : `${k.minor} minor`}</strong> scale: ${up.map((n) => T.STEP_NAMES[n.step] + T.alterSymbol(n.alter)).join(' ')}. ${mode === 'major' ? 'Major scales sound bright and happy.' : 'Minor scales sound darker or sadder.'}`);
}

// ---------------------------------------------------------------- playback

function updatePlayerTimeline() {
  const tl = buildTimeline(measures);
  const unit = T.countTicks(state.score.time);
  const big = T.beatTicks(state.score.time);
  tl.clicks = [];
  for (const m of measures) {
    if (m.start >= tl.length) break;
    for (let t = 0; t < m.length; t += unit) tl.clicks.push({ tick: m.start + t, level: t === 0 ? 2 : t % big === 0 ? 1 : 0 });
  }
  player.loop = state.loop;
  player.metronome = state.metronome;
  player.setTimeline(tl);
}

function togglePlay() {
  if (player.playing) return stopPlayback();
  if (!state.score.events.length) {
    setTip('Nothing to play yet — click the staff to add some note blocks first!', { warn: true });
    return;
  }
  piano.resume();
  updatePlayerTimeline();
  player.setTempo(state.score.tempo, state.score.time);
  const from = 0;
  if (player.play(from)) {
    el.play.classList.add('is-playing');
    $('.lbl', el.play).textContent = 'Stop';
    quest('play');
  }
}

function stopPlayback() {
  player.stop();
  onEnd();
}

function markPlaying(idx, on) {
  for (const g of el.svg.querySelectorAll(`[data-idx="${idx}"]`)) g.classList.toggle('playing', on);
}

function onFrame(tick) {
  const loc = locateTick(layout, tick);
  playhead = loc ? { system: loc.system, x: loc.x } : null;
  drawOverlay();
  // Highlight sounding notes.
  const now = new Set();
  const midis = [];
  for (const n of player.timeline.notes) {
    if (tick >= n.tick && tick < n.tick + n.ticks) {
      now.add(n.idx);
      midis.push(...n.midis);
    }
  }
  for (const idx of playingIdx) if (!now.has(idx)) markPlaying(idx, false);
  for (const idx of now) if (!playingIdx.has(idx)) markPlaying(idx, true);
  playingIdx = now;
  setActiveKeys(midis);
  if (loc && loc.system !== lastPlayheadSystem) {
    lastPlayheadSystem = loc.system;
    const sys = layout.systems[loc.system];
    const sc = el.scroller;
    if (sys.top < sc.scrollTop || sys.bottom > sc.scrollTop + sc.clientHeight) sc.scrollTo({ top: sys.top - 6, behavior: 'smooth' });
  }
  if (loc) {
    const sc = el.scroller;
    if (loc.x < sc.scrollLeft || loc.x > sc.scrollLeft + sc.clientWidth - 20) sc.scrollLeft = loc.x - 40;
  }
}

function onEnd() {
  el.play.classList.remove('is-playing');
  $('.lbl', el.play).textContent = 'Play';
  for (const idx of playingIdx) markPlaying(idx, false);
  playingIdx = new Set();
  playhead = null;
  lastPlayheadSystem = -1;
  setActiveKeys([]);
  drawOverlay();
}

function toggleLoop() {
  state.loop = !state.loop;
  player.loop = state.loop;
  syncView();
  saveSoon();
  if (state.loop) setTip('Loop is on: playback repeats forever. Keep adding blocks while it plays — you’ll hear them on the next time around.');
}

function toggleMetronome() {
  state.metronome = !state.metronome;
  player.metronome = state.metronome;
  syncView();
  saveSoon();
  if (state.metronome) {
    const c = T.isCompound(state.score.time);
    setTip(`Metronome on: a click on every beat, with a louder click on beat 1${c ? ' and accents on each big beat' : ''}. It helps you feel the pulse of ${state.score.time}.`);
  }
}

// ---------------------------------------------------------------- piano keyboard

let activeKeys = new Set();
const keyTimers = new Map();

function buildPiano() {
  const c = T.CLEFS[state.score.clef];
  const lo = c.bottom + T.MIN_POS;
  const hi = c.bottom + T.MAX_POS;
  const n = hi - lo + 1;
  let html = '';
  let blacks = '';
  for (let d = lo, i = 0; d <= hi; d++, i++) {
    const { step, octave } = T.fromDiatonic(d);
    const midi = T.midiOf(step, octave, 0);
    const mc = step === 0 && octave === 4;
    html += `<div class="wkey pc-${step}${step === 0 ? ' c' : ''}${mc ? ' middle-c' : ''}" data-midi="${midi}" data-d="${d}" title="${T.STEP_NAMES[step]}${octave}${mc ? ' (middle C)' : ''}"><span class="kname">${T.STEP_NAMES[step]}${step === 0 ? octave : ''}</span><span class="strip"></span></div>`;
    if ([0, 1, 3, 4, 5].includes(step) && d < hi) {
      blacks += `<div class="bkey" data-midi="${midi + 1}" style="left:${(((i + 1) / n) * 100).toFixed(4)}%"></div>`;
    }
  }
  el.piano.style.setProperty('--n', n);
  el.piano.innerHTML = html + blacks;
  activeKeys = new Set();
}

function keyEls(midi) {
  return el.piano.querySelectorAll(`[data-midi="${midi}"]`);
}

function setActiveKeys(midis) {
  const next = new Set(midis);
  for (const m of activeKeys) if (!next.has(m) && !keyTimers.has(m)) keyEls(m).forEach((k) => k.classList.remove('active'));
  for (const m of next) keyEls(m).forEach((k) => k.classList.add('active'));
  activeKeys = next;
}

function flashKeys(midis, seconds) {
  for (const m of midis) {
    keyEls(m).forEach((k) => k.classList.add('active'));
    clearTimeout(keyTimers.get(m));
    keyTimers.set(
      m,
      setTimeout(() => {
        keyTimers.delete(m);
        if (!activeKeys.has(m)) keyEls(m).forEach((k) => k.classList.remove('active'));
      }, Math.max(150, seconds * 1000)),
    );
  }
}

function pianoSpelling(midi) {
  const { fifths } = state.score;
  const sp = T.spellMidi(midi, fifths);
  const implied = impliedAlter(measures[layout.insert.measure], null, sp.step, sp.octave, fifths);
  return { pitch: { step: sp.step, octave: sp.octave }, acc: sp.alter === implied ? null : ACC_NAME[sp.alter], alter: sp.alter };
}

function onPianoDown(e) {
  const key = e.target.closest('[data-midi]');
  if (!key) return;
  e.preventDefault();
  piano.resume();
  const midi = Number(key.dataset.midi);
  const voice = piano.play(midi, timeNow() + 0.005, 4, 0.75);
  key.classList.add('active');
  const up = () => {
    voice?.stop(timeNow());
    if (!activeKeys.has(midi)) key.classList.remove('active');
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  const sp = pianoSpelling(midi);
  if (state.pianoAdds) {
    const wasRest = state.tool.rest;
    state.tool.rest = false;
    placeNote(sp.pitch, sp.acc, { quiet: true });
    state.tool.rest = wasRest;
    if (sp.acc === 'sharp' || sp.acc === 'flat') quest('acc');
  } else {
    setTip(`That key is <strong>${T.pitchLabel(sp.pitch.step, sp.pitch.octave, sp.alter)}</strong>. ${key.classList.contains('bkey') ? 'Black keys are the sharps and flats.' : ''}`);
  }
}

function onPianoHover(e) {
  if (press) return;
  const key = e.target.closest('[data-midi]');
  if (!key || !layout) return;
  const sp = pianoSpelling(Number(key.dataset.midi));
  const p = T.posOf(sp.pitch.step, sp.pitch.octave, state.score.clef);
  const ins = layout.insert;
  const tool = state.tool;
  const ok = T.durationTicks(tool.dur, tool.dots) <= ins.remaining;
  hover = {
    band: { system: ins.system, p },
    ghost: state.pianoAdds
      ? ghostFor({ system: ins.system, x: ins.x, p, dur: tool.dur, dots: tool.dots, rest: false, acc: sp.acc, ok, label: T.pitchLabel(sp.pitch.step, sp.pitch.octave, sp.alter) })
      : null,
  };
  drawOverlay();
  updateHoverStatus({ kind: 'piano', p, si: ins.system, label: T.pitchLabel(sp.pitch.step, sp.pitch.octave, sp.alter) });
}

// ---------------------------------------------------------------- status bar, tips, cards

function updateStatus() {
  if (!layout) return;
  const { time } = state.score;
  const ins = layout.insert;
  const m = measures[ins.measure];
  const unit = T.countTicks(time);
  const cells = Math.round(m.length / unit);
  const filled = Math.floor(m.fill / unit);
  let meter = '';
  for (let i = 0; i < cells; i++) meter += `<i class="${i < filled ? 'on' : ''}"></i>`;
  const tool = state.tool;
  const next = Learn.noteName(tool.dur, tool.dots, tool.rest);
  el.stInsert.innerHTML = `<span class="pill">Measure ${ins.measure + 1} <span class="meter" aria-hidden="true">${meter}</span> ${Learn.lengthLabel(m.fill, time)} of ${Learn.lengthLabel(m.length, time)}</span> <span>Next block: <strong>${next}</strong></span>`;
  const sel = state.selection;
  if (sel && state.score.events[sel.idx]) {
    const io = itemOf(sel.idx);
    const ev = io.item.ev;
    const what = ev.rest
      ? Learn.noteName(ev.dur, ev.dots, true)
      : `${T.pitchLabel(ev.notes[sel.note].step, ev.notes[sel.note].octave, io.item.alters[sel.note])} ${Learn.noteName(ev.dur, ev.dots, false)}${ev.notes.length > 1 ? ` (in a ${ev.notes.length}-note chord)` : ''}`;
    el.stSel.innerHTML = `<span class="pill sel">Selected: <strong>${what}</strong> · measure ${io.m.index + 1}, beat ${T.countLabel(io.item.start, time)}</span>
      <span class="sel-actions">
        ${ev.rest ? '' : '<button class="btn icon small" data-sel="up" aria-label="Move up" title="Move up (↑)">▲</button><button class="btn icon small" data-sel="down" aria-label="Move down" title="Move down (↓)">▼</button>'}
        <button class="btn small" data-sel="delete" title="Delete (Backspace)">Delete</button>
        <button class="btn small" data-sel="done" title="Deselect (Esc)">Done</button>
      </span>`;
  } else {
    el.stSel.innerHTML = '';
  }
}

function updateHoverStatus(hit) {
  if (!hit || !layout) {
    el.stHover.textContent = '';
    return;
  }
  const { clef } = state.score;
  const pos = T.describePos(hit.p);
  const where = pos[0].toUpperCase() + pos.slice(1);
  if (hit.kind === 'piano') {
    el.stHover.innerHTML = `<span class="pill">${where} · <strong>${hit.label}</strong></span>`;
    return;
  }
  const pitch = T.pitchAtPos(hit.p, clef);
  const label = hover && hover.ghost && !hover.ghost.rest && hover.ghost.ok ? hover.ghost.label.replace(/^\+ /, '').replace(/ instead of the rest$/, '') : T.pitchLabel(pitch.step, pitch.octave);
  el.stHover.innerHTML = `<span class="pill">${where} · <strong>${label}</strong></span>`;
}

function setTip(html, { warn = false } = {}) {
  el.tip.classList.toggle('warn', warn);
  el.tip.innerHTML = `<div class="tip-title">${warn ? 'Hmm…' : 'Tip'}</div><div>${html}</div>`;
  if (warn) {
    el.tip.classList.remove('bump');
    void el.tip.offsetWidth;
    el.tip.classList.add('bump');
  }
}

function updateCards() {
  const s = state.score;
  el.cardTime.innerHTML = Learn.timeCard(s.time);
  el.cardKey.innerHTML = Learn.keyCard(s.fifths, s.clef);
  el.cardStaff.innerHTML = Learn.staffCard(s.clef);
  el.cardTempo.innerHTML = Learn.tempoCard(s.tempo, s.time);
}

function quest(id) {
  if (state.quests[id]) return;
  state.quests[id] = true;
  renderQuests();
  saveSoon();
  const done = Learn.QUESTS.filter((q) => state.quests[q.id]).length;
  if (done === Learn.QUESTS.length) toast('All building quests complete — you’re a music builder!');
  else toast(`Quest complete: ${Learn.QUESTS.find((q) => q.id === id).text}`);
}

function renderQuests() {
  const done = Learn.QUESTS.filter((q) => state.quests[q.id]).length;
  el.quests.classList.toggle('collapsed', !state.questsOpen);
  el.quests.innerHTML = `<h3>Building quests <span class="progress">${done}/${Learn.QUESTS.length}</span>
      <button class="toggle-q" aria-expanded="${state.questsOpen}">${state.questsOpen ? 'Hide' : 'Show'}</button></h3>
    <ul>${Learn.QUESTS.map((q) => `<li class="${state.quests[q.id] ? 'done' : ''}">${q.text}</li>`).join('')}</ul>`;
}

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2400);
}

function updateUndoButtons() {
  el.undo.disabled = !undoStack.length;
  el.redo.disabled = !redoStack.length;
}

// ---------------------------------------------------------------- persistence & sharing

let saveTimer;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

const save = saveSoon;

function saveNow() {
  const s = state.score;
  const data = {
    score: { clef: s.clef, fifths: s.fifths, time: s.time, tempo: s.tempo, notes: eventsToText(s.events) },
    tool: state.tool,
    view: state.view,
    quests: state.quests,
    questsOpen: state.questsOpen,
    pianoAdds: state.pianoAdds,
    loop: state.loop,
    metronome: state.metronome,
  };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable (private mode / sandbox): the app still works */
  }
}

function loadSaved() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  } catch {
    data = null;
  }
  if (data) {
    try {
      const sc = data.score;
      state.score = decodeScore(new URLSearchParams({ clef: sc.clef, key: sc.fifths, time: sc.time, tempo: sc.tempo, notes: sc.notes }).toString());
    } catch {
      state.score = defaultScore();
    }
    Object.assign(state.tool, data.tool || {});
    Object.assign(state.view, data.view || {});
    state.quests = data.quests || {};
    state.questsOpen = data.questsOpen ?? true;
    state.pianoAdds = data.pianoAdds ?? true;
    state.loop = !!data.loop;
    state.metronome = !!data.metronome;
    if (!T.DURATIONS[state.tool.dur]) state.tool.dur = 'q';
  }
  const hash = location.hash.slice(1);
  if (hash) {
    try {
      state.score = decodeScore(hash);
      return 'shared';
    } catch {
      return 'badlink';
    }
  }
  return data ? 'saved' : 'new';
}

async function share() {
  const url = `${location.href.split('#')[0]}#${encodeScore(state.score)}`;
  try {
    history.replaceState(null, '', url);
  } catch {
    /* sandboxed frames may refuse */
  }
  let ok = false;
  try {
    await navigator.clipboard.writeText(url);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
  }
  toast(ok ? 'Link copied! Anyone who opens it sees (and hears) your music.' : 'Copy the link from the address bar to share your music.');
}

function loadExample(id) {
  const ex = EXAMPLES.find((x) => x.id === id);
  if (!ex) return;
  stopPlayback();
  commit(() => {
    Object.assign(state.score, { clef: ex.clef, fifths: ex.fifths, time: ex.time, tempo: ex.tempo, events: parseEvents(ex.notes) });
  });
  state.selection = null;
  player.setTempo(ex.tempo, ex.time);
  syncSettingsUI();
  buildPiano();
  updateCards();
  el.scroller.scrollTo({ top: 0 });
  setTip(`Loaded <strong>${ex.title}</strong>. ${ex.note} Press <strong>Play</strong> to hear it — or <strong>Undo</strong> to get your own music back.`);
}

function clearAll() {
  if (!state.score.events.length) return;
  stopPlayback();
  state.selection = null;
  commit(() => (state.score.events = []));
  toast('Cleared. Undo brings your notes back.');
  setTip(Learn.WELCOME);
}

// ---------------------------------------------------------------- keyboard

function onKeyDown(e) {
  const t = e.target;
  const tag = t && t.tagName;
  if (el.helpDialog.open) return;
  if (e.key === 'Escape' && player.playing) {
    stopPlayback();
    return;
  }
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (mod && (k === 'z' || k === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && (k === 'y' || k === 'Y')) {
    e.preventDefault();
    redo();
    return;
  }
  if (mod || e.altKey) return;
  if (tag === 'BUTTON' && (k === ' ' || k === 'Enter')) return;
  const lower = k.length === 1 ? k.toLowerCase() : k;
  if ('abcdefg'.includes(lower) && lower.length === 1) {
    e.preventDefault();
    piano.resume();
    addLetter('cdefgab'.indexOf(lower));
    return;
  }
  switch (lower) {
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
      setDuration(T.DURATION_ORDER[Number(lower) - 1]);
      break;
    case '.':
      toggleDot();
      break;
    case 'r':
      toggleRest();
      break;
    case 's':
      toggleStack();
      break;
    case '#':
    case '+':
      setAcc(state.tool.acc === 'sharp' && !state.selection ? null : 'sharp');
      break;
    case '-':
    case '_':
      setAcc(state.tool.acc === 'flat' && !state.selection ? null : 'flat');
      break;
    case '=':
      setAcc(state.tool.acc === 'natural' && !state.selection ? null : 'natural');
      break;
    case 'k':
      setAcc(null);
      break;
    case 'l':
      toggleLoop();
      break;
    case 'm':
      toggleMetronome();
      break;
    case '?':
      el.helpDialog.showModal();
      break;
    case ' ':
      e.preventDefault();
      togglePlay();
      break;
    case 'Backspace':
    case 'Delete':
      e.preventDefault();
      deleteSelection();
      break;
    case 'ArrowUp':
    case 'ArrowDown':
      if (state.selection) {
        e.preventDefault();
        moveSelection((lower === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 7 : 1));
      }
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
      if (t === el.svg || t === document.body || !t) {
        e.preventDefault();
        selectStep(lower === 'ArrowLeft' ? -1 : 1);
      }
      break;
    case 'Escape':
      if (player.playing) stopPlayback();
      else deselect();
      break;
    default:
      return;
  }
}

// ---------------------------------------------------------------- wiring

function wire() {
  el.svg.addEventListener('pointermove', onPointerMove);
  el.svg.addEventListener('pointerdown', onPointerDown);
  el.svg.addEventListener('pointerup', onPointerUp);
  el.svg.addEventListener('pointercancel', onPointerCancel);
  el.svg.addEventListener('pointerleave', () => {
    if (press) return;
    hover = null;
    setCursor(null);
    drawOverlay();
    updateHoverStatus(null);
  });

  el.durations.addEventListener('click', (e) => {
    const b = e.target.closest('.brick-btn');
    if (b) setDuration(b.dataset.dur);
  });
  $('#dot').addEventListener('click', toggleDot);
  $('#rest').addEventListener('click', toggleRest);
  $('#stack').addEventListener('click', toggleStack);
  $('#accidentals').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) setAcc(b.dataset.acc || null);
  });

  $('#clef').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setClef(b.dataset.clef);
  });
  el.key.addEventListener('change', () => setKey(Number(el.key.value)));
  el.time.addEventListener('change', () => setTime(el.time.value));
  el.tempo.addEventListener('input', () => setTempo(Number(el.tempo.value)));
  $('#tempo-down').addEventListener('click', () => setTempo(state.score.tempo - 4));
  $('#tempo-up').addEventListener('click', () => setTempo(state.score.tempo + 4));

  el.play.addEventListener('click', togglePlay);
  $('#loop').addEventListener('click', toggleLoop);
  $('#metronome').addEventListener('click', toggleMetronome);
  el.undo.addEventListener('click', undo);
  el.redo.addEventListener('click', redo);
  el.examples.addEventListener('change', () => {
    const id = el.examples.value;
    el.examples.value = '';
    loadExample(id);
  });
  $('#share').addEventListener('click', share);
  $('#clear').addEventListener('click', clearAll);
  $('#theme').addEventListener('click', toggleTheme);
  $('#help').addEventListener('click', () => el.helpDialog.showModal());

  $('#v-names').addEventListener('click', () => toggleView('names'));
  $('#v-blocks').addEventListener('click', () => toggleView('blocks'));
  $('#v-count').addEventListener('click', () => toggleView('count'));
  el.colors.addEventListener('change', () => {
    state.view.colors = el.colors.value;
    syncView();
    relayout();
    saveSoon();
  });
  $('#zoom-in').addEventListener('click', () => {
    state.view.zoom = clamp(state.view.zoom * 1.15, 0.6, 2.2);
    relayout();
    saveSoon();
  });
  $('#zoom-out').addEventListener('click', () => {
    state.view.zoom = clamp(state.view.zoom / 1.15, 0.6, 2.2);
    relayout();
    saveSoon();
  });

  el.status.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sel]');
    if (!b) return;
    const a = b.dataset.sel;
    if (a === 'up') moveSelection(1);
    else if (a === 'down') moveSelection(-1);
    else if (a === 'delete') deleteSelection();
    else deselect();
  });

  el.piano.addEventListener('pointerdown', onPianoDown);
  el.piano.addEventListener('pointerover', onPianoHover);
  el.piano.addEventListener('pointerleave', () => {
    if (press) return;
    hover = null;
    drawOverlay();
    updateHoverStatus(null);
  });
  el.pianoAdds.addEventListener('change', () => {
    state.pianoAdds = el.pianoAdds.checked;
    saveSoon();
  });

  el.cardKey.addEventListener('click', (e) => {
    const b = e.target.closest('[data-scale]');
    if (b) playScale(b.dataset.scale);
  });
  el.quests.addEventListener('click', (e) => {
    if (!e.target.closest('.toggle-q')) return;
    state.questsOpen = !state.questsOpen;
    renderQuests();
    saveSoon();
  });

  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointerdown', () => piano.resume(), { once: true, capture: true });

  let lastW = el.scroller.clientWidth;
  new ResizeObserver(() => {
    const w = el.scroller.clientWidth;
    if (Math.abs(w - lastW) < 2) return;
    lastW = w;
    requestAnimationFrame(relayout);
  }).observe(el.scroller);

  piano.onStatus = (s, progress) => {
    el.audioStatus.textContent =
      s === 'loading' ? `Loading grand piano… ${Math.round(progress * 100)}%` : s === 'ready' ? 'Grand piano ready' : s === 'synth' ? 'Using a synthesised piano' : '';
  };
}

async function init() {
  Object.assign(el, {
    svg: $('#score'),
    scroller: $('#score-scroll'),
    durations: $('#durations'),
    palette: $('.palette'),
    paletteHint: $('.palette .hint'),
    key: $('#key'),
    time: $('#time'),
    tempo: $('#tempo'),
    tempoOut: $('#tempo-out'),
    examples: $('#examples'),
    play: $('#play'),
    undo: $('#undo'),
    redo: $('#redo'),
    colors: $('#v-colors'),
    status: $('#status'),
    piano: $('#piano'),
    pianoAdds: $('#piano-adds'),
    audioStatus: $('#audio-status'),
    tip: $('#tip'),
    quests: $('#quests'),
    cardTime: $('#card-time'),
    cardKey: $('#card-key'),
    cardStaff: $('#card-staff'),
    cardTempo: $('#card-tempo'),
    helpDialog: $('#help-dialog'),
    toast: $('#toast'),
  });
  el.status.innerHTML = '<span id="st-insert"></span><span id="st-hover"></span><span id="st-sel"></span>';
  el.stInsert = $('#st-insert');
  el.stHover = $('#st-hover');
  el.stSel = $('#st-sel');

  const origin = loadSaved();
  applyTheme();
  // Inside a frame the address bar shows the host page, so a share link would not work.
  if (window.self !== window.top) $('#share').hidden = true;
  buildSettings();
  buildPalette();
  buildPiano();
  syncSettingsUI();
  updateCards();
  renderQuests();
  wire();

  // Wait for the music font so the first drawing has real glyphs.
  try {
    await Promise.race([document.fonts.load('40px "NoteBlocks Music"', ''), new Promise((r) => setTimeout(r, 2500))]);
  } catch {
    /* draw anyway */
  }
  player.setTempo(state.score.tempo, state.score.time);
  refresh();

  if (origin === 'shared') setTip('Someone shared this music with you! Press <strong>Play</strong> to hear it, then change anything you like.');
  else if (origin === 'badlink') setTip('That share link looks damaged, so it couldn’t be opened. Here’s your own music instead.', { warn: true });
  else if (state.score.events.length) setTip('Welcome back! Your music was saved in this browser. Keep building, or pick an example to explore.');
  else setTip(Learn.WELCOME);

  piano.init();
  window.noteBlocks = { state, get layout() { return layout; }, get measures() { return measures; }, piano, player };
}

init();
