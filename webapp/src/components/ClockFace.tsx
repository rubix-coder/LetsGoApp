// Swappable timer readouts. Every face renders the same MM:SS text the
// dot-matrix does, so callers stay identical — the chosen face comes from
// Settings → Appearance (`settings.clockFace`). All faces are static SVG/CSS:
// the "animation" is the numbers ticking, so reduced-motion needs no casing.

import type { ReactNode } from "react";
import { useStore } from "../lib/store";
import type { ClockFace } from "../lib/types";
import { DotMatrix, dotMatrixCols } from "./DotMatrix";

/** Faint "off" ink shared by the hardware faces, matching the dot-matrix's
    unlit dots so an idle glyph still reads as part of the display. */
const off = (color: string) => `color-mix(in srgb, ${color} 12%, transparent)`;

export const CLOCK_FACES: { id: ClockFace; label: string }[] = [
  { id: "matrix", label: "Dot matrix" },
  { id: "segment", label: "Seven-segment" },
  { id: "flip", label: "Flip clock" },
  { id: "minimal", label: "Minimal" },
  { id: "analog", label: "Analog" },
];

interface FaceProps {
  text: string;
  /** Target width in px for the readout faces; diameter for the analog dial. */
  size: number;
  color: string;
  /** Accessible reading of the display, e.g. "25:00 left". */
  label?: string;
}

// ————— Seven-segment —————
// Lit segments per digit, labelled a–g (a = top, b/c = right, d = bottom,
// e/f = left, g = middle) — the classic calculator/alarm-clock layout.
const SEGMENTS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg",
  "5": "acdfg", "6": "acdefg", "7": "abc", "8": "abcdefg", "9": "abcdfg",
};
const segUnit = (ch: string) => (ch === ":" ? 0.5 : ch === "+" ? 0.9 : ch === " " ? 0.5 : 1);

function SevenSegment({ text, size, color, label }: FaceProps) {
  const chars = [...text];
  const gap = 0.28;
  const units = chars.reduce((s, c) => s + segUnit(c), 0) + Math.max(0, chars.length - 1) * gap;
  const dw = size / units;
  const dh = dw * 1.9;
  const sw = dw * 0.16;
  const inset = sw * 0.9;
  const nodes: ReactNode[] = [];
  let x = 0;
  chars.forEach((ch, ci) => {
    const w = dw * segUnit(ch);
    if (ch === ":") {
      const cx = x + w / 2, r = sw * 0.7;
      nodes.push(<circle key={`${ci}a`} cx={cx} cy={dh * 0.34} r={r} fill={color} />);
      nodes.push(<circle key={`${ci}b`} cx={cx} cy={dh * 0.68} r={r} fill={color} />);
    } else if (ch === "+") {
      const cx = x + w / 2, arm = dw * 0.42;
      nodes.push(<line key={`${ci}h`} x1={cx - arm} y1={dh / 2} x2={cx + arm} y2={dh / 2} stroke={color} strokeWidth={sw} strokeLinecap="round" />);
      nodes.push(<line key={`${ci}v`} x1={cx} y1={dh / 2 - arm} x2={cx} y2={dh / 2 + arm} stroke={color} strokeWidth={sw} strokeLinecap="round" />);
    } else if (ch !== " ") {
      const on = SEGMENTS[ch] ?? "";
      const seg: Record<string, [number, number, number, number]> = {
        a: [x + inset, 0, x + dw - inset, 0],
        b: [x + dw, inset, x + dw, dh / 2 - inset],
        c: [x + dw, dh / 2 + inset, x + dw, dh - inset],
        d: [x + inset, dh, x + dw - inset, dh],
        e: [x, dh / 2 + inset, x, dh - inset],
        f: [x, inset, x, dh / 2 - inset],
        g: [x + inset, dh / 2, x + dw - inset, dh / 2],
      };
      for (const k of "abcdefg") {
        const [x1, y1, x2, y2] = seg[k];
        nodes.push(<line key={`${ci}${k}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={on.includes(k) ? color : off(color)} strokeWidth={sw} strokeLinecap="round" />);
      }
    }
    x += w;
    if (ci < chars.length - 1) x += dw * gap;
  });
  return (
    <svg width={size} height={dh} viewBox={`0 0 ${size} ${dh}`} role="img" aria-label={label ?? text}>
      {nodes}
    </svg>
  );
}

// ————— Flip clock (split-flap) —————
const flipUnit = (ch: string) => (ch === ":" ? 0.42 : ch === "+" ? 0.6 : ch === " " ? 0.5 : 1);

function FlipClock({ text, size, color, label }: FaceProps) {
  const chars = [...text];
  const gap = 0.14;
  const units = chars.reduce((s, c) => s + flipUnit(c), 0) + Math.max(0, chars.length - 1) * gap;
  const cw = size / units;
  const ch = cw * 1.4;
  return (
    <div role="img" aria-label={label ?? text} style={{ display: "inline-flex", alignItems: "center", gap: cw * gap }}>
      {chars.map((c, ci) => {
        if (c === ":") {
          const dot = { width: cw * 0.16, height: cw * 0.16, borderRadius: "50%", background: color } as const;
          return (
            <span key={ci} style={{ display: "inline-flex", flexDirection: "column", gap: ch * 0.22, width: cw * flipUnit(c), alignItems: "center" }}>
              <span style={dot} /><span style={dot} />
            </span>
          );
        }
        if (c === " ") return <span key={ci} style={{ width: cw * flipUnit(c) }} />;
        if (c === "+") return <span key={ci} style={{ width: cw * flipUnit(c), textAlign: "center", color, fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: ch * 0.6 }}>+</span>;
        return (
          <span
            key={ci}
            style={{
              position: "relative", width: cw, height: ch, borderRadius: Math.min(7, cw * 0.16),
              background: "var(--color-card)", border: "1px solid var(--color-divider)",
              display: "grid", placeItems: "center", color, fontFamily: "var(--font-mono)",
              fontWeight: 700, fontSize: ch * 0.62, fontVariantNumeric: "tabular-nums", overflow: "hidden",
            }}
          >
            {c}
            {/* The split-flap seam across the card's midline. */}
            <span aria-hidden style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: "var(--color-bg)", boxShadow: "0 1px 0 color-mix(in srgb, var(--color-divider) 60%, transparent)" }} />
          </span>
        );
      })}
    </div>
  );
}

// ————— Minimal —————
function Minimal({ text, size, color, label }: FaceProps) {
  const fontSize = size / Math.max(1, text.length * 0.62);
  return (
    <span
      role="img"
      aria-label={label ?? text}
      style={{
        fontFamily: "var(--font-mono)", fontWeight: 700, color, fontSize,
        fontVariantNumeric: "tabular-nums", letterSpacing: fontSize * 0.02,
        lineHeight: 1, display: "inline-block", whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

// ————— Analog —————
// Hands read straight off the MM:SS text: seconds sweep, minutes track the
// leading group, and the hour hand advances once minutes roll past 60.
function Analog({ text, size, color, label }: FaceProps) {
  const [minPart, secPart] = text.replace("+", "").split(":");
  const mins = Number(minPart) || 0;
  const secs = Number(secPart) || 0;
  const R = size / 2;
  const secA = (secs / 60) * 360;
  const minA = ((mins % 60) / 60) * 360 + (secs / 60) * 6;
  const hrA = ((Math.floor(mins / 60) % 12) / 12) * 360 + ((mins % 60) / 60) * 30;
  const hand = (angle: number, len: number, w: number, col: string, key: string) => {
    const rad = (angle * Math.PI) / 180;
    return <line key={key} x1={R} y1={R} x2={R + len * Math.sin(rad)} y2={R - len * Math.cos(rad)} stroke={col} strokeWidth={w} strokeLinecap="round" />;
  };
  const ticks = Array.from({ length: 12 }, (_, k) => {
    const rad = (k * 30 * Math.PI) / 180;
    return <line key={`t${k}`} x1={R + R * 0.82 * Math.sin(rad)} y1={R - R * 0.82 * Math.cos(rad)} x2={R + R * 0.92 * Math.sin(rad)} y2={R - R * 0.92 * Math.cos(rad)} stroke={off(color)} strokeWidth={Math.max(1, R * 0.03)} strokeLinecap="round" />;
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? text}>
      <circle cx={R} cy={R} r={R - 1} fill="var(--color-card)" stroke="var(--color-divider)" strokeWidth={1} />
      {ticks}
      {hand(hrA, R * 0.48, R * 0.07, "var(--color-text)", "hr")}
      {hand(minA, R * 0.7, R * 0.05, "var(--color-text)", "min")}
      {hand(secA, R * 0.8, R * 0.022, color, "sec")}
      <circle cx={R} cy={R} r={R * 0.06} fill={color} />
    </svg>
  );
}

function Matrix({ text, size, color, label }: FaceProps) {
  const cell = size / Math.max(1, dotMatrixCols(text));
  return <DotMatrix text={text} cell={cell} color={color} label={label} />;
}

/** Render the timer readout in the face chosen under Settings → Appearance.
    Pass `face` to force a specific one (used by the settings previews). */
export function ClockDisplay({ face, ...props }: FaceProps & { face?: ClockFace }) {
  const { state } = useStore();
  switch (face ?? state.settings.clockFace ?? "matrix") {
    case "segment": return <SevenSegment {...props} />;
    case "flip": return <FlipClock {...props} />;
    case "minimal": return <Minimal {...props} />;
    case "analog": return <Analog {...props} />;
    default: return <Matrix {...props} />;
  }
}
