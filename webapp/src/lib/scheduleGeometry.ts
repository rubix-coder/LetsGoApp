/** Geometry helpers for the Schedule day grid. */

const DAY_MIN = 24 * 60;

/** Minutes of a card actually visible inside its day column.
    A card is positioned by its start offset and sized by its duration; a
    duration that crosses midnight (overnight sleep, a long block near the
    bottom) must render clipped at 24:00 instead of overflowing the grid —
    the remainder belongs to the next day's column, not to empty space
    below this one. Starts outside the day clip from the other side. */
export function visibleCardMinutes(startMin: number, durMin: number): number {
  const start = Math.max(0, startMin);
  const end = Math.min(DAY_MIN, startMin + durMin);
  return Math.max(0, end - start);
}

/** The portion of a card that spills past midnight into the day starting at
    `dayStartMs`, or null if nothing spills. The visible clip at 24:00
    (visibleCardMinutes) removes the overflow from yesterday's column; this
    is the other half of the contract — the same minutes reappearing at the
    top of today's. Clamped to one day for multi-day durations. */
export function carrySegmentMs(
  startMs: number,
  durMin: number,
  dayStartMs: number,
): { start: number; end: number } | null {
  const end = startMs + durMin * 60_000;
  if (startMs >= dayStartMs || end <= dayStartMs) return null;
  return { start: dayStartMs, end: Math.min(end, dayStartMs + DAY_MIN * 60_000) };
}

/** Zoom bounds for the hour-row height. The default (54/60px) packs a full
    schedule too tight to read; the max keeps a work morning on one screen. */
export const HOUR_H_MIN = 42;
export const HOUR_H_MAX = 126;
export const HOUR_H_STEP = 18;

/** One zoom step on the hour-row height, clamped to the bounds. */
export function zoomHourH(current: number, dir: 1 | -1): number {
  return Math.min(HOUR_H_MAX, Math.max(HOUR_H_MIN, current + dir * HOUR_H_STEP));
}
