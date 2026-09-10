/* The habit charts: a heat grid, a column chart, a bar chart and a trend line.

   All hand-rolled inline SVG — no chart library. The vault is a localStorage
   app that has to stay small and load instantly, and these four forms are a few
   hundred lines between them; a charting dependency would cost more than the
   whole Habits plugin.

   Every chart here plots ONE series, which is what makes the colour job easy
   and correct: magnitude, so a sequential ramp (--heat-*, one hue, light→dark,
   validated in theme.css) and never a categorical palette. One series also
   means no legend box — the heading above each chart already names what is
   plotted — except the heat grid, where the ramp itself needs a scale key.

   Fixed marks, applied the same way everywhere: columns and bars cap at 24px
   with a 4px rounded data-end and a square baseline, lines are 2px with a ~10%
   area wash, gridlines are hairline and recessive, and text always wears a text
   token rather than the series colour. Values are labelled SELECTIVELY — the
   extremes and the endpoint — with everything else carried by the axis and the
   hover tooltip. No animation anywhere: Thermal and E-ink are motionless by
   design, and a chart that reflows on hover is harder to read, not easier. */

import { useId, useState } from "react";
import type { HeatCell } from "../../lib/habitStats";
import type { PeriodStat, TrendPoint } from "../../lib/habitStats";

const WEEKDAY_INITIAL = ["S", "M", "T", "W", "T", "F", "S"];

/** The one tooltip every chart shares — positioned by the caller in chart
    pixels, drawn as HTML over the SVG so it never inherits SVG text metrics. */
function Tip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div
      role="tooltip"
      style={{
        position: "absolute", left: x, top: y, transform: "translate(-50%, -100%)",
        pointerEvents: "none", zIndex: 5, whiteSpace: "nowrap",
        background: "var(--color-bg)", color: "var(--color-text)",
        border: "1px solid var(--color-divider)", borderRadius: "var(--radius-sm, 6px)",
        boxShadow: "var(--shadow-md)", padding: "5px 8px", fontSize: 11.5, lineHeight: 1.35,
      }}
    >
      {children}
    </div>
  );
}

const pct = (r: number | null): string => (r === null ? "—" : `${Math.round(r * 100)}%`);

/** A column/bar path: square where it meets the baseline, `r`-rounded at the
    data end. Drawn as a path rather than a <rect rx> because rx rounds all four
    corners, which detaches the mark from its baseline. */
function barPath(x: number, y: number, w: number, h: number, r = 4, horizontal = false): string {
  const radius = Math.max(0, Math.min(r, horizontal ? w : h, w / 2, h / 2));
  if (horizontal) {
    // Grows left→right; rounded on the right edge.
    return `M${x},${y} H${x + w - radius} A${radius},${radius} 0 0 1 ${x + w},${y + radius}`
      + ` V${y + h - radius} A${radius},${radius} 0 0 1 ${x + w - radius},${y + h} H${x} Z`;
  }
  // Grows bottom→top; rounded on the top edge.
  return `M${x},${y + h} V${y + radius} A${radius},${radius} 0 0 1 ${x + radius},${y}`
    + ` H${x + w - radius} A${radius},${radius} 0 0 1 ${x + w},${y + radius} V${y + h} Z`;
}

/* ————— heat grid ————— */

/** The contribution grid: a column per week, a row per weekday, coloured by how
    much of the day's target was met. The single most legible way to see a year
    of a habit at once — and the reason the ramp's light end had to clear a
    contrast floor, since a barely-started day must still read as *something*. */
export function HeatGrid({ weeks, title, cell, gap }: {
  weeks: HeatCell[][];
  title: string;
  cell?: number;
  gap?: number;
}) {
  const [hover, setHover] = useState<{ c: HeatCell; x: number; y: number } | null>(null);
  // Size the cell to the span so a year FITS rather than clipping mid-cell at
  // the container edge — a half-drawn column reads as a rendering fault, not
  // as an invitation to scroll. It still scrolls on a narrow phone.
  const span = weeks.length;
  const cellPx = cell ?? (span > 30 ? 8 : span > 16 ? 11 : 14);
  const gapPx = gap ?? (span > 30 ? 2 : span > 16 ? 3 : 4);
  const labelW = 18;
  const width = labelW + span * (cellPx + gapPx);
  const height = 7 * (cellPx + gapPx);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ overflowX: "auto", paddingBottom: 2 }}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}. ${weeks.flat().filter((c) => c.level === 4).length} days completed.`}
          style={{ display: "block" }}
        >
          {WEEKDAY_INITIAL.map((l, i) =>
            i % 2 === 1 ? (
              <text key={i} x={0} y={i * (cellPx + gapPx) + cellPx - 1} fontSize={8.5} fill="var(--color-text-3)" fontFamily="var(--font-mono)">
                {l}
              </text>
            ) : null,
          )}
          {weeks.map((column, w) =>
            column.map((c, d) => {
              // Out of range is drawn as nothing at all, so the grid does not
              // claim a miss on a day the habit did not yet exist for.
              if (!c.inRange) return null;
              const fill = c.level === 0 ? "var(--heat-0)" : `var(--heat-${c.level})`;
              return (
                <rect
                  key={c.key}
                  x={labelW + w * (cellPx + gapPx)}
                  y={d * (cellPx + gapPx)}
                  width={cellPx}
                  height={cellPx}
                  rx={Math.min(2.5, cellPx / 3)}
                  fill={fill}
                  opacity={c.due || c.ticks > 0 ? 1 : 0.4}
                  onPointerEnter={(e) => setHover({ c, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
                  onPointerLeave={() => setHover(null)}
                  style={{ cursor: "default" }}
                />
              );
            }),
          )}
        </svg>
      </div>
      {hover && (
        <Tip x={hover.x + 8} y={hover.y}>
          <strong>{new Date(hover.c.dayMs).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</strong>
          <br />
          {!hover.c.due && hover.c.ticks === 0 ? "not due" : `${hover.c.ticks} logged`}
        </Tip>
      )}
      <HeatLegend />
    </div>
  );
}

/** The ramp's scale key. A sequential chart needs one — the reader has to know
    which end is "more" — and it is the one legend a single-series chart keeps. */
function HeatLegend() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 10.5, color: "var(--color-text-3)" }}>
      <span>Less</span>
      {[0, 1, 2, 3, 4].map((l) => (
        <span key={l} aria-hidden style={{ width: 10, height: 10, borderRadius: 2.5, background: `var(--heat-${l})`, display: "inline-block" }} />
      ))}
      <span>More</span>
    </div>
  );
}

/* ————— columns over time ————— */

/** Completion rate per period. Columns because the periods are a time sequence
    the reader scans left to right; a single hue because there is one series and
    the bar's height already carries the magnitude. */
export function PeriodColumns({ data, title, height = 130 }: { data: PeriodStat[]; title: string; height?: number }) {
  const [hover, setHover] = useState<{ p: PeriodStat; x: number; y: number } | null>(null);
  const gridId = useId();
  if (data.length === 0) return null;

  const padTop = 16;
  const padBottom = 18;
  const plot = height - padTop - padBottom;
  const slot = 34;
  const barW = Math.min(24, slot - 10);
  const width = data.length * slot;
  // The one column worth direct-labelling is the best one; everything else is
  // carried by the axis and the tooltip.
  const bestIdx = data.reduce((b, p, i) => ((p.rate ?? -1) > (data[b].rate ?? -1) ? i : b), 0);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ overflowX: "auto" }}>
        <svg width={width} height={height} role="img" aria-label={title} style={{ display: "block" }}>
          {/* Hairline, solid, recessive — never dashed. */}
          {[0, 0.5, 1].map((f) => (
            <line
              key={`${gridId}-${f}`}
              x1={0} x2={width}
              y1={padTop + plot * (1 - f)} y2={padTop + plot * (1 - f)}
              stroke="var(--color-divider-soft)" strokeWidth={1}
            />
          ))}
          {data.map((p, i) => {
            const r = p.rate ?? 0;
            const h = Math.max(r > 0 ? 2 : 0, plot * r);
            const x = i * slot + (slot - barW) / 2;
            const y = padTop + plot - h;
            return (
              <g key={p.atMs}>
                {h > 0 && (
                  <path
                    d={barPath(x, y, barW, h)}
                    fill={p.rate === null ? "var(--heat-0)" : "var(--heat-3)"}
                    onPointerEnter={(e) => setHover({ p, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
                    onPointerLeave={() => setHover(null)}
                  />
                )}
                {/* An invisible full-height hit target: a 2%-tall column is
                    almost impossible to hover, and a chart you cannot query is
                    the one people call useless. */}
                <rect
                  x={i * slot} y={padTop} width={slot} height={plot} fill="transparent"
                  onPointerEnter={(e) => setHover({ p, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
                  onPointerLeave={() => setHover(null)}
                />
                {i === bestIdx && p.rate !== null && (
                  <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize={9.5} fontFamily="var(--font-mono)" fill="var(--color-text-2)">
                    {pct(p.rate)}
                  </text>
                )}
                <text x={i * slot + slot / 2} y={height - 5} textAnchor="middle" fontSize={9.5} fontFamily="var(--font-mono)" fill="var(--color-text-3)">
                  {p.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {hover && (
        <Tip x={hover.x + 8} y={hover.y}>
          <strong>{hover.p.label}</strong> · {pct(hover.p.rate)}
          <br />
          {hover.p.done}/{hover.p.due} days{hover.p.ticks !== hover.p.done ? ` · ${hover.p.ticks} ticks` : ""}
        </Tip>
      )}
    </div>
  );
}

/* ————— weekday bars ————— */

/** Which day of the week the chain actually breaks on.

    Every bar is the SAME colour on purpose. Shading each bar by its own value
    would double-encode length as hue and burn the only free channel on
    information the bar already shows — the weakest day is found by looking for
    the shortest bar, which is what a bar chart is for. */
export function WeekdayBars({ data, title }: { data: PeriodStat[]; title: string }) {
  const [hover, setHover] = useState<{ p: PeriodStat; x: number; y: number } | null>(null);
  const rowH = 20;
  const barH = Math.min(24, rowH - 8);
  const labelW = 30;
  const valueW = 34;
  const width = 260;
  const plotW = width - labelW - valueW;
  const worst = data.reduce<PeriodStat | null>((w, p) => (p.rate !== null && (w === null || p.rate < (w.rate ?? 1)) ? p : w), null);

  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={data.length * rowH} role="img" aria-label={title} style={{ display: "block" }}>
        {data.map((p, i) => {
          const r = p.rate ?? 0;
          const w = Math.max(r > 0 ? 2 : 0, plotW * r);
          const y = i * rowH + (rowH - barH) / 2;
          return (
            <g key={p.label}>
              <text x={0} y={i * rowH + rowH / 2 + 3.5} fontSize={10} fontFamily="var(--font-mono)" fill="var(--color-text-3)">
                {p.label}
              </text>
              <rect x={labelW} y={y} width={plotW} height={barH} rx={3} fill="var(--heat-0)" />
              {w > 0 && <path d={barPath(labelW, y, w, barH, 4, true)} fill="var(--heat-3)" />}
              <rect
                x={0} y={i * rowH} width={width} height={rowH} fill="transparent"
                onPointerEnter={(e) => setHover({ p, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
                onPointerLeave={() => setHover(null)}
              />
              <text
                x={width} y={i * rowH + rowH / 2 + 3.5} textAnchor="end" fontSize={10} fontFamily="var(--font-mono)"
                fill={worst && p.label === worst.label ? "var(--color-text)" : "var(--color-text-3)"}
                fontWeight={worst && p.label === worst.label ? 600 : 400}
              >
                {pct(p.rate)}
              </text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <Tip x={hover.x + 8} y={hover.y}>
          <strong>{hover.p.label}</strong> · {hover.p.done}/{hover.p.due} kept
        </Tip>
      )}
    </div>
  );
}

/* ————— trend ————— */

/** A trailing-window completion rate. One series, so a 2px line with a ~10%
    wash beneath it and no legend; the crosshair carries every value that is not
    the endpoint. */
export function TrendLine({ points, title, windowDays, height = 96 }: {
  points: TrendPoint[];
  title: string;
  windowDays: number;
  height?: number;
}) {
  const [hover, setHover] = useState<{ p: TrendPoint; x: number; y: number } | null>(null);
  const usable = points.filter((p) => p.rate !== null);
  if (usable.length < 2) return null;

  const width = 100;                       // viewBox units; the SVG scales to fit
  const padTop = 8;
  const plot = height - padTop - 4;
  const xAt = (i: number) => (i / (usable.length - 1)) * width;
  const yAt = (r: number) => padTop + plot * (1 - r);

  const line = usable.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(2)},${yAt(p.rate!).toFixed(2)}`).join(" ");
  const area = `${line} L${width},${padTop + plot} L0,${padTop + plot} Z`;
  const last = usable[usable.length - 1];

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        role="img"
        aria-label={`${title}. Currently ${pct(last.rate)}.`}
        style={{ display: "block", overflow: "visible" }}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - box.left) / box.width) * (usable.length - 1));
          const p = usable[Math.max(0, Math.min(usable.length - 1, i))];
          if (p) setHover({ p, x: e.clientX - box.left, y: e.clientY - box.top });
        }}
        onPointerLeave={() => setHover(null)}
      >
        <line x1={0} x2={width} y1={yAt(1)} y2={yAt(1)} stroke="var(--color-divider-soft)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={area} fill="var(--heat-3)" opacity={0.1} />
        <path d={line} fill="none" stroke="var(--heat-3)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* The endpoint value rides outside the SVG so it never inherits the
          non-uniform preserveAspectRatio scaling and come out stretched. */}
      <div style={{ position: "absolute", right: 0, top: 0, fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--color-text-2)" }}>
        {pct(last.rate)} · {windowDays}d
      </div>
      {hover && (
        <Tip x={hover.x} y={hover.y}>
          <strong>{pct(hover.p.rate)}</strong> · {new Date(hover.p.atMs).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
        </Tip>
      )}
    </div>
  );
}

/* ————— stat tiles ————— */

/** A headline number is not a chart. Four of them in a row is a KPI strip, and
    it beats any plot for "current streak / record / lifetime total". */
export function StatTile({ value, label, hint, emphasis }: {
  value: string;
  label: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div style={{ flex: "1 1 96px", minWidth: 88 }}>
      <div
        style={{
          fontSize: emphasis ? 26 : 20, fontWeight: 600, lineHeight: 1.1,
          fontFamily: "var(--font-mono)",
          color: emphasis ? "var(--accent-strong)" : "var(--color-text)",
        }}
      >
        {value}
      </div>
      <div className="cap" style={{ marginTop: 3 }}>{label}</div>
      {hint && <div style={{ fontSize: 10.5, color: "var(--color-text-3)", marginTop: 1 }}>{hint}</div>}
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>{children}</div>;
}
