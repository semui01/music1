// Ready-made pieces (traditional / public-domain melodies) written in the score text format.

export const EXAMPLES = [
  {
    id: 'twinkle',
    title: 'Twinkle, Twinkle, Little Star',
    note: 'Quarter and half notes in C major.',
    clef: 'treble', fifths: 0, time: '4/4', tempo: 100,
    notes: `C4/q C4/q G4/q G4/q | A4/q A4/q G4/h | F4/q F4/q E4/q E4/q | D4/q D4/q C4/h |
            G4/q G4/q F4/q F4/q | E4/q E4/q D4/h | G4/q G4/q F4/q F4/q | E4/q E4/q D4/h |
            C4/q C4/q G4/q G4/q | A4/q A4/q G4/h | F4/q F4/q E4/q E4/q | D4/q D4/q C4/h`,
  },
  {
    id: 'mary',
    title: 'Mary Had a Little Lamb',
    note: 'Just three notes to start, ending on a whole note.',
    clef: 'treble', fifths: 0, time: '4/4', tempo: 108,
    notes: `E4/q D4/q C4/q D4/q | E4/q E4/q E4/h | D4/q D4/q D4/h | E4/q G4/q G4/h |
            E4/q D4/q C4/q D4/q | E4/q E4/q E4/q E4/q | D4/q D4/q E4/q D4/q | C4/w`,
  },
  {
    id: 'buns',
    title: 'Hot Cross Buns (bass clef)',
    note: 'Low notes in the bass clef, with beamed eighths.',
    clef: 'bass', fifths: 0, time: '4/4', tempo: 96,
    notes: `E3/q D3/q C3/h | E3/q D3/q C3/h | C3/8 C3/8 C3/8 C3/8 D3/8 D3/8 D3/8 D3/8 | E3/q D3/q C3/h`,
  },
  {
    id: 'ode',
    title: 'Ode to Joy — Beethoven',
    note: 'A dotted quarter followed by an eighth note.',
    clef: 'treble', fifths: 0, time: '4/4', tempo: 112,
    notes: `E4/q E4/q F4/q G4/q | G4/q F4/q E4/q D4/q | C4/q C4/q D4/q E4/q | E4/q. D4/8 D4/h |
            E4/q E4/q F4/q G4/q | G4/q F4/q E4/q D4/q | C4/q C4/q D4/q E4/q | D4/q. C4/8 C4/h`,
  },
  {
    id: 'jacques',
    title: 'Frère Jacques (F major)',
    note: 'The key signature turns every B into B♭.',
    clef: 'treble', fifths: -1, time: '4/4', tempo: 112,
    notes: `F4/q G4/q A4/q F4/q | F4/q G4/q A4/q F4/q | A4/q B4/q C5/h | A4/q B4/q C5/h |
            C5/8 D5/8 C5/8 B4/8 A4/q F4/q | C5/8 D5/8 C5/8 B4/8 A4/q F4/q | F4/q C4/q F4/h | F4/q C4/q F4/h`,
  },
  {
    id: 'minuet',
    title: 'Minuet in G — Petzold',
    note: 'A waltz-like 3/4 in G major: every F is F♯.',
    clef: 'treble', fifths: 1, time: '3/4', tempo: 120,
    notes: `D5/q G4/8 A4/8 B4/8 C5/8 | D5/q G4/q G4/q | E5/q C5/8 D5/8 E5/8 F5/8 | G5/q G4/q G4/q |
            C5/q D5/8 C5/8 B4/8 A4/8 | B4/q C5/8 B4/8 A4/8 G4/8 | F4/q G4/8 A4/8 B4/8 G4/8 | A4/h. |
            D5/q G4/8 A4/8 B4/8 C5/8 | D5/q G4/q G4/q | E5/q C5/8 D5/8 E5/8 F5/8 | G5/q G4/q G4/q |
            C5/q D5/8 C5/8 B4/8 A4/8 | B4/q C5/8 B4/8 A4/8 G4/8 | A4/q B4/8 A4/8 G4/8 F4/8 | G4/h.`,
  },
  {
    id: 'row',
    title: 'Row, Row, Row Your Boat',
    note: '6/8 time: two big beats, each split into three.',
    clef: 'treble', fifths: 0, time: '6/8', tempo: 60,
    notes: `C4/q. C4/q. | C4/q D4/8 E4/q. | E4/q D4/8 E4/q F4/8 | G4/h. |
            C5/8 C5/8 C5/8 G4/8 G4/8 G4/8 | E4/8 E4/8 E4/8 C4/8 C4/8 C4/8 | G4/q F4/8 E4/q D4/8 | C4/h.`,
  },
  {
    id: 'gallop',
    title: 'Galloping rhythm',
    note: 'Sixteenth notes, a dotted eighth and a rest in 2/4.',
    clef: 'treble', fifths: 0, time: '2/4', tempo: 92,
    notes: `C5/8 G4/16 G4/16 C5/8 G4/16 G4/16 | E5/16 D5/16 C5/16 D5/16 E5/8 E5/8 |
            D5/8. C5/16 B4/8 G4/8 | C5/q r/q`,
  },
  {
    id: 'chords',
    title: 'Chord blocks: I – IV – V – I',
    note: 'Notes stacked on top of each other sound together.',
    clef: 'treble', fifths: 0, time: '4/4', tempo: 80,
    notes: `C4,E4,G4/h C4,E4,G4/h | C4,F4,A4/h C4,F4,A4/h | B3,D4,G4/h B3,D4,F4,G4/h | C4,E4,G4,C5/w`,
  },
];
