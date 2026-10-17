// Draws a layout (from layout.js) as SVG markup. Colours come from CSS classes so
// themes and colour modes are pure CSS.

import { GLYPH, yOf } from './layout.js';

const f = (n) => Math.round(n * 100) / 100;

function text(x, y, glyph, cls = '') {
  return `<text class="g ${cls}" x="${f(x)}" y="${f(y)}">${glyph}</text>`;
}

function rect(x, y, w, h, cls = '', extra = '') {
  return `<rect class="${cls}" x="${f(x)}" y="${f(y)}" width="${f(Math.max(0, w))}" height="${f(Math.max(0, h))}" ${extra}/>`;
}

function line(x1, y1, x2, y2, cls, sw) {
  return `<line class="${cls}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke-width="${f(sw)}"/>`;
}

function headerMarkup(sys, S) {
  const h = sys.header;
  let out = text(h.clefX, h.clefY, h.clefGlyph, 'clef');
  for (const a of h.keyAccs) out += text(a.x, yOf(a.p, S), a.glyph, 'keyacc');
  if (h.timeSig) {
    for (const d of h.timeSig.glyphs) out += text(d.x, yOf(d.p, S), d.glyph, 'timesig');
  }
  return out;
}

function eventMarkup(ev, S, opts) {
  const sel = opts.selection && opts.selection.idx === ev.idx;
  const cls = ['ev', `d-${ev.dur}`, ev.rest ? 'rest' : 'note', sel ? 'selected' : ''].join(' ');
  let out = `<g class="${cls}" data-idx="${ev.idx}">`;
  if (sel) {
    const top = ev.rest ? -0.6 * S : Math.min(-0.6 * S, ...ev.notes.map((n) => n.y - 1.0 * S), ev.stem ? ev.stem.y2 - 0.3 * S : 0);
    const bot = ev.rest ? 4.6 * S : Math.max(4.6 * S, ...ev.notes.map((n) => n.y + 1.0 * S), ev.stem ? ev.stem.y2 + 0.3 * S : 0);
    const x0 = ev.rest ? ev.x - 0.5 * S : Math.min(ev.x, ...ev.notes.map((n) => n.accX ?? n.x)) - 0.5 * S;
    const x1 = ev.rest ? ev.x + ev.restW + 0.5 * S : Math.max(...ev.notes.map((n) => n.x + ev.hw)) + 0.5 * S + (ev.flag && ev.up ? 0.8 * S : 0);
    out += rect(x0, top, x1 - x0, bot - top, 'sel-box', `rx="${f(0.5 * S)}"`);
  }
  if (ev.rest) {
    out += text(ev.x, ev.restY, ev.restGlyph, 'restglyph');
  } else {
    for (const l of ev.ledgers) out += line(l.x1, l.y, l.x2, l.y, 'ledger', 0.16 * S);
    if (ev.stem) out += line(ev.stem.x, ev.stem.y1, ev.stem.x, ev.stem.y2, 'stem', 0.12 * S);
    if (ev.flag) out += text(ev.flag.x, ev.flag.y, ev.flag.glyph, 'flag');
    for (const n of ev.notes) {
      const nsel = sel && opts.selection.note === n.i ? ' note-selected' : '';
      out += text(n.x, n.y, ev.headGlyph, `head pc-${n.step}${nsel}`);
      if (n.accGlyph) out += text(n.accX, n.y, n.accGlyph, 'acc');
    }
  }
  for (const d of ev.dots) out += text(d.x, d.y, GLYPH.dot, 'dot');
  out += '</g>';
  return out;
}

function beamMarkup(polys) {
  return polys
    .map((poly) => `<path class="beam" d="M${poly.map((p) => `${f(p[0])} ${f(p[1])}`).join(' L')} Z"/>`)
    .join('');
}

function studs(x0, x1, y, S, count) {
  let out = '';
  const w = x1 - x0;
  const n = Math.max(1, Math.min(count, Math.floor(w / (0.9 * S))));
  const sw = Math.min(0.55 * S, (w / n) * 0.55);
  for (let i = 0; i < n; i++) {
    const cx = x0 + (w * (i + 0.5)) / n;
    out += rect(cx - sw / 2, y - 0.24 * S, sw, 0.3 * S, 'stud', `rx="${f(0.08 * S)}"`);
  }
  return out;
}

function rowsMarkup(sys, S, opts) {
  let out = '';
  const rows = sys.rows;
  if (rows.names !== undefined) {
    for (const ev of sys.events) {
      if (ev.rest) continue;
      const cx = ev.notes[0].x + ev.hw / 2;
      const ns = [...ev.notes].sort((a, b) => b.p - a.p);
      ns.forEach((n, k) => {
        out += `<text class="name pc-${n.step}" data-idx="${ev.idx}" x="${f(cx)}" y="${f(rows.names + k * 1.25 * S)}">${n.name}</text>`;
      });
    }
  }
  if (rows.blocks !== undefined) {
    const y = rows.blocks;
    const h = 1.15 * S;
    for (const m of sys.measures) {
      for (const s of m.segs) {
        const x0 = s.x0 - 0.35 * S;
        const x1 = s.x1 - 0.5 * S;
        if (s.kind === 'event') {
          const ev = sys.events.find((e) => e.idx === s.idx);
          const eighths = Math.max(1, Math.round((s.tick1 - s.tick0) / 24));
          out += `<g class="brick d-${ev.dur}${ev.rest ? ' rest' : ''}" data-idx="${ev.idx}">`;
          out += studs(x0, x1, y, S, eighths);
          out += rect(x0, y, x1 - x0, h, 'brick-body', `rx="${f(0.22 * S)}"`);
          out += '</g>';
        } else if (s.kind === 'pad') {
          out += rect(x0, y, x1 - x0, h, 'brick-pad', `rx="${f(0.22 * S)}"`);
        } else {
          // Empty sockets, one per counted beat, waiting for blocks.
          const unit = opts.countTicks;
          let t = s.tick0;
          while (t < s.tick1) {
            const next = Math.min(s.tick1, (Math.floor(t / unit) + 1) * unit);
            const a = s.x0 + ((t - s.tick0) / (s.tick1 - s.tick0)) * (s.x1 - s.x0);
            const b = s.x0 + ((next - s.tick0) / (s.tick1 - s.tick0)) * (s.x1 - s.x0);
            out += rect(a - 0.35 * S, y, b - a - 0.15 * S, h, 'socket', `rx="${f(0.22 * S)}"`);
            t = next;
          }
        }
      }
    }
  }
  if (rows.count !== undefined) {
    for (const m of sys.measures) {
      for (const c of m.countMarks) {
        let cx = c.x + 0.59 * S;
        if (c.idx !== undefined) {
          const ev = sys.events.find((e) => e.idx === c.idx);
          cx = ev.rest ? ev.x + ev.restW / 2 : ev.notes[0].x + ev.hw / 2;
        }
        const cls = `count${c.open ? ' open' : ''}${c.pad ? ' pad' : ''}${/^\d+$/.test(c.label) ? ' beat' : ''}`;
        if (c.label) out += `<text class="${cls}" x="${f(cx)}" y="${f(rows.count)}">${c.label}</text>`;
      }
    }
  }
  return out;
}

/** Render the static score. The overlay group (ghost note, playhead) is kept separately. */
export function renderScore(svg, layout, opts) {
  const { S } = layout;
  let out = `<g class="score-root" font-size="${f(4 * S)}">`;
  layout.systems.forEach((sys, si) => {
    out += `<g class="system" data-system="${si}" transform="translate(0 ${f(sys.staffY)})">`;
    const x0 = 0.3 * S;
    // Measure backgrounds (also used for the "too long" warning).
    for (const m of sys.measures) {
      const cls = `measure-bg${m.overfull ? ' overfull' : ''}${m.index === opts.insertMeasure ? ' current' : ''}`;
      out += rect(m.x, -0.5 * S, m.width, 5 * S, cls);
    }
    let d = '';
    for (let i = 0; i < 5; i++) d += `M${f(x0)} ${f(i * S)} H${f(sys.x1)} `;
    out += `<path class="staff" d="${d}" stroke-width="${f(0.13 * S)}"/>`;
    out += headerMarkup(sys, S);
    sys.measures.forEach((m, mi) => {
      const isLast = si === layout.systems.length - 1 && mi === sys.measures.length - 1;
      if (isLast) {
        out += rect(m.barX - 0.9 * S, 0, 0.16 * S, 4 * S, 'bar');
        out += rect(m.barX - 0.5 * S, 0, 0.5 * S, 4 * S, 'bar');
      } else {
        out += rect(m.barX - 0.08 * S, 0, 0.16 * S, 4 * S, 'bar');
      }
      out += `<text class="mnum${m.index === opts.insertMeasure ? ' current' : ''}" x="${f(m.x + (mi === 0 ? 0.2 * S : 0.35 * S))}" y="${f(sys.numberY)}">${m.number}</text>`;
      for (const p of m.pads) {
        out += `<g class="pad">${text(p.x, p.y, p.glyph, 'restglyph')}${p.dot ? text(p.dot.x, p.dot.y, GLYPH.dot, 'dot') : ''}</g>`;
      }
    });
    for (const ev of sys.events) out += eventMarkup(ev, S, opts);
    for (const polys of sys.beams) out += beamMarkup(polys);
    out += rowsMarkup(sys, S, opts);
    out += '</g>';
  });
  out += '</g><g class="overlay"></g>';
  svg.setAttribute('width', f(layout.width));
  svg.setAttribute('height', f(layout.height));
  svg.setAttribute('viewBox', `0 0 ${f(layout.width)} ${f(layout.height)}`);
  svg.innerHTML = out;
  return svg.querySelector('.overlay');
}

/**
 * Overlay: the hovered line/space, the ghost note that shows what a click will add,
 * and the playhead. Cheap to redraw on every pointer move.
 */
export function renderOverlay(overlay, layout, o) {
  const { S } = layout;
  let out = '';
  if (o.band) {
    const sys = layout.systems[o.band.system];
    const y0 = sys.staffY;
    const p = o.band.p;
    const x0 = sys.header.width - 0.3 * S;
    if (p >= 0 && p <= 8) {
      if (p % 2 === 0) {
        out += line(x0, y0 + yOf(p, S), sys.x1, y0 + yOf(p, S), 'band-line', 0.32 * S);
      } else {
        out += rect(x0, y0 + yOf(p + 1, S), sys.x1 - x0, S, 'band-space');
      }
    }
  }
  if (o.column) {
    const sys = layout.systems[o.column.system];
    out += rect(o.column.x0, sys.staffY - 2 * S, o.column.x1 - o.column.x0, 8 * S, 'col-hover', `rx="${f(0.4 * S)}"`);
  }
  const g = o.ghost;
  if (g) {
    const sys = layout.systems[g.system];
    const y0 = sys.staffY;
    const cls = `ghost${g.ok ? '' : ' nofit'}`;
    out += `<g class="${cls}" font-size="${f(4 * S)}" transform="translate(0 ${f(y0)})">`;
    if (g.rest) {
      out += text(g.x, yOf(g.dur === 'w' ? 6 : 4, S), GLYPH.rest[g.dur], 'restglyph');
    } else {
      const y = yOf(g.p, S);
      const lx1 = g.x - 0.35 * S;
      const lx2 = g.x + g.hw + 0.35 * S;
      for (let q = -2; q >= g.p; q -= 2) out += line(lx1, yOf(q, S), lx2, yOf(q, S), 'ledger', 0.16 * S);
      for (let q = 10; q <= g.p; q += 2) out += line(lx1, yOf(q, S), lx2, yOf(q, S), 'ledger', 0.16 * S);
      out += text(g.x, y, g.headGlyph, 'head');
      if (g.accGlyph) out += text(g.x - 0.22 * S - g.accW * S, y, g.accGlyph, 'acc');
      if (g.stem) {
        const up = g.p < 4;
        const sx = up ? g.x + g.hw - 0.06 * S : g.x + 0.06 * S;
        const y2 = up ? Math.min(y - 3.5 * S, yOf(4, S)) : Math.max(y + 3.5 * S, yOf(4, S));
        out += line(sx, y, sx, y2, 'stem', 0.12 * S);
        if (g.flags) {
          const glyph = up ? (g.flags === 1 ? GLYPH.flag8Up : GLYPH.flag16Up) : g.flags === 1 ? GLYPH.flag8Down : GLYPH.flag16Down;
          out += text(sx - 0.06 * S, y2, glyph, 'flag');
        }
      }
      if (g.dotted) out += text(g.x + g.hw + 0.3 * S, yOf(g.p % 2 === 0 ? g.p + 1 : g.p, S), GLYPH.dot, 'dot');
    }
    out += '</g>';
    if (g.label) {
      const ly = y0 + (g.rest ? yOf(8, S) : yOf(g.p, S)) - 1.6 * S;
      const lx = g.x + 1.6 * S;
      const w = g.label.length * 0.62 * S + 1.2 * S;
      out += `<g class="ghost-label${g.ok ? '' : ' nofit'}">`;
      out += rect(lx, ly - 0.95 * S, w, 1.5 * S, 'pill', `rx="${f(0.75 * S)}"`);
      out += `<text x="${f(lx + w / 2)}" y="${f(ly + 0.1 * S)}">${g.label}</text></g>`;
    }
  }
  if (o.playhead) {
    const sys = layout.systems[o.playhead.system];
    out += line(o.playhead.x, sys.staffY - 1.5 * S, o.playhead.x, sys.staffY + 5.5 * S, 'playhead', 0.22 * S);
  }
  overlay.innerHTML = out;
}
