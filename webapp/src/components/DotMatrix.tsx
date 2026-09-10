// Dot-matrix time display — the timer deck's signature. Every glyph is a
// 5×7 LED grid (colon 2 wide); unlit dots render faintly so the whole panel
// reads as one piece of hardware, not floating digits. Purely static SVG:
// the "animation" is the numbers themselves ticking, so reduced-motion
// needs no special casing.

interface Glyph { w: number; rows: number[] } // row bitmasks, MSB = leftmost column

const FONT: Record<string, Glyph> = {
  "0": { w: 5, rows: [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110] },
  "1": { w: 5, rows: [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110] },
  "2": { w: 5, rows: [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111] },
  "3": { w: 5, rows: [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110] },
  "4": { w: 5, rows: [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010] },
  "5": { w: 5, rows: [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110] },
  "6": { w: 5, rows: [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110] },
  "7": { w: 5, rows: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000] },
  "8": { w: 5, rows: [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110] },
  "9": { w: 5, rows: [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100] },
  ":": { w: 2, rows: [0b00, 0b11, 0b11, 0b00, 0b11, 0b11, 0b00] },
  "+": { w: 5, rows: [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000] },
  " ": { w: 2, rows: [0, 0, 0, 0, 0, 0, 0] },
};

const ROWS = 7;
const GAP_COLS = 1; // blank column between glyphs

/** Grid columns `text` occupies — for sizing a display to a target width. */
export function dotMatrixCols(text: string): number {
  const glyphs = [...text].map((ch) => FONT[ch] ?? FONT[" "]);
  return glyphs.reduce((sum, g) => sum + g.w, 0) + Math.max(0, glyphs.length - 1) * GAP_COLS;
}

export function DotMatrix({ text, cell = 5, color = "var(--color-accent)", label }: {
  text: string;
  /** Pixels per LED cell (dot + its spacing). */
  cell?: number;
  color?: string;
  /** Accessible reading of the display, e.g. "25 minutes left". */
  label?: string;
}) {
  const glyphs = [...text].map((ch) => FONT[ch] ?? FONT[" "]);
  const cols = dotMatrixCols(text);
  const r = cell * 0.34;
  const dots: React.ReactNode[] = [];
  let colOffset = 0;
  glyphs.forEach((g, gi) => {
    for (let row = 0; row < ROWS; row++) {
      for (let c = 0; c < g.w; c++) {
        const lit = (g.rows[row] >> (g.w - 1 - c)) & 1;
        dots.push(
          <circle
            key={`${gi}-${row}-${c}`}
            cx={(colOffset + c + 0.5) * cell}
            cy={(row + 0.5) * cell}
            r={r}
            fill={lit ? color : `color-mix(in srgb, ${color} 12%, transparent)`}
          />,
        );
      }
    }
    colOffset += g.w + GAP_COLS;
  });
  return (
    <svg
      width={cols * cell}
      height={ROWS * cell}
      viewBox={`0 0 ${cols * cell} ${ROWS * cell}`}
      role="img"
      aria-label={label ?? text}
    >
      {dots}
    </svg>
  );
}
