# Note Blocks 🎵🧱

**Build music one note at a time.** Note Blocks is an interactive music-learning app that
treats a piece of music the way you'd treat a pile of building blocks: every note is a
block with a length, and you snap them onto a blank staff until each measure is full.

Click any **line or space** on the staff and a note appears there — and you hear it on a
real grand piano.

## What you can do

- **Place notes by clicking the staff.** A see-through "ghost" note shows exactly where
  your click will land and which note it is (e.g. `G4`). The line or space under the
  pointer lights up, so you always know whether you're *on a line* or *in a space*.
- **Pick note blocks:** whole, half, quarter, eighth and sixteenth notes, plus **dots**
  (×1.5 length), **rests** (blocks of silence) and **chords** (stack notes on top of each
  other).
- **Accidentals:** sharp ♯, flat ♭ and natural ♮. They last until the bar line, just like
  in printed music.
- **Time signatures:** 2/4, 3/4, 4/4, 5/4, 2/2, 3/8, 6/8, 9/8 and 12/8. Notes regroup into
  measures automatically, and eighth/sixteenth notes are beamed by beat.
- **Key signatures:** all 15 major keys (with their relative minors). Notes follow the
  key: in G major every F you place sounds as F♯.
- **Tempo:** 40–208 BPM with the Italian tempo word (Largo → Presto).
- **Treble and bass clef.**
- **Playback** with a moving playhead, **loop** (keep building while it plays) and a
  **metronome**.
- **Learning aids** under the staff: letter names, *beat blocks* (each note drawn as a
  brick whose length matches its duration, with empty sockets showing what's left in the
  measure) and **counting** (`1 e + a`). Notes can be coloured by pitch or by length.
- **Piano keyboard** that lights up during playback; pressing a key adds that note to the
  staff (white keys line up one-to-one with the staff's lines and spaces).
- **Learn panel** that explains whatever you just did, plus cards for the current time
  signature, key (play its major/minor scale), clef mnemonics and tempo.
- **Building quests**: a short checklist of things to try.
- **Examples** (Twinkle Twinkle, Ode to Joy, Minuet in G, Row Row Row Your Boat, a chord
  progression, …), **undo/redo**, **share links**, light/dark theme, and your music is
  saved in the browser automatically.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `A`–`G` | Add that note (nearest octave) |
| `1`–`5` | Whole, half, quarter, eighth, sixteenth |
| `.` / `R` / `S` | Dot, rest, chord stacking |
| `#` `-` `=` `K` | Sharp, flat, natural, follow key |
| `↑` `↓` (Shift) | Move the selected note by a step (an octave) |
| `←` `→` | Select previous / next note |
| `Backspace` | Delete selected (or last) note |
| `Space` | Play / stop |
| `L` / `M` | Loop / metronome |
| `Ctrl`+`Z`, `Ctrl`+`Shift`+`Z` | Undo / redo |

## Running it

It's a static site with no build step and no dependencies — plain HTML, CSS and
JavaScript modules.

```bash
npm start        # serves the app at http://localhost:8080
npm test         # runs the unit tests (Node's built-in test runner)
```

Any static file server works too (`python3 -m http.server`, GitHub Pages, Netlify…).
Opening `index.html` directly from disk won't work, because browsers block JavaScript
modules and audio loading on `file://` URLs.

## How it's built

| File | What it does |
| --- | --- |
| `js/theory.js` | Pitches, clefs, keys, time signatures, durations, tempo terms |
| `js/score.js` | The score model: events poured into measures, accidental rules, the text format used by examples and share links |
| `js/layout.js` | Engraving: proportional spacing, stems, beams, ledger lines, line wrapping |
| `js/render.js` | Draws the layout as SVG (plus the ghost note / playhead overlay) |
| `js/audio.js` | Sampled grand piano (Web Audio), synth fallback, metronome click |
| `js/player.js` | Look-ahead playback scheduler (live tempo and score changes) |
| `js/learn.js` | The explanations shown in the Learn panel |
| `js/examples.js` | Example pieces |
| `js/main.js` | UI wiring: input, selection, undo, persistence |

The score is stored as a flat list of *blocks* (`{ dur, dots, rest, notes }`); measures
are recomputed from the time signature every time, so changing the time signature just
regroups the same blocks. Notes store their staff position plus an optional written
accidental, so changing the key re-colours the music the way a real key signature would.

## Credits

- Piano: [Salamander Grand Piano V3](https://archive.org/details/SalamanderGrandPianoV3)
  by Alexander Holm, CC BY 3.0 (MP3s via the Tone.js audio repository). See
  `assets/piano/CREDITS.md`.
- Music symbols: a subset of [Bravura](https://github.com/steinbergmedia/bravura) by
  Steinberg, SIL Open Font License 1.1, renamed *NoteBlocks Music* as the license
  requires. See `assets/fonts/CREDITS.md`.
- Example melodies are traditional or in the public domain.
