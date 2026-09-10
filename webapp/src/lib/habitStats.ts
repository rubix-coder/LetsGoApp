/* Long-range habit arithmetic: the numbers a year of ticking is actually for.

   `habits.ts` answers "is it done today, and what's the run?" — the questions a
   checklist asks. This answers the ones a RECORD asks: what does a year look
   like, which weekday keeps breaking the chain, is this month better than the
   last twelve, and how much of it has there ever been. Everything here is pure
   and derived on read: the vault stores nothing but `log[YYYY-MM-DD] = ticks`,
   so a stat can never drift out of sync with the ticks it summarises.

   Every walk steps days at NOON, like habits.ts, so a DST transition can't skip
   or double a day — an off-by-one here would silently corrupt a streak that
   took a year to build. */

import { occurrenceDateKey } from "./occurrence";
import { currentStreak, habitStartMs, habitTarget, isDueOn, isDoneOn, ticksOn } from "./habits";
import type { Habit } from "./types";

/** Noon of the same calendar day — the DST-safe stepping stone. */
export function noonOf(ms: number): Date {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** Noon `offset` days from `ms`, walking the calendar rather than adding ms. */
export function dayOffset(ms: number, offset: number): number {
  const d = noonOf(ms);
  d.setDate(d.getDate() + offset);
  return d.getTime();
}

/* ————— the heatmap ————— */

/** How full one day was, as the 0-4 step of the sequential ramp.

    Level 0 is "nothing recorded" and is drawn as the empty track, not as a
    ramp step — the ramp only ever colours days that have something in them,
    which is what keeps a sparse year legible instead of a wall of faint
    lavender. 4 is the whole target met. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export function heatLevel(ticks: number, target: number): HeatLevel {
  if (ticks <= 0) return 0;
  const frac = ticks / Math.max(1, target);
  if (frac >= 1) return 4;
  if (frac >= 0.66) return 3;
  if (frac >= 0.33) return 2;
  return 1;
}

export interface HeatCell {
  dayMs: number;
  key: string;
  /** False for a day the habit's weekday schedule excludes, or before it
      existed, or in the future — all drawn as absent rather than as a miss. */
  due: boolean;
  inRange: boolean;
  ticks: number;
  level: HeatLevel;
}

/** Calendar grid of the `weeks` weeks ending with the week containing `endMs`,
    as columns of 7 days starting on `weekStart` — the shape a contribution
    graph is drawn in, so a column is a week and a row is a weekday. */
export function heatmapWeeks(habit: Habit, endMs: number, weeks: number, weekStart: 0 | 1 | 6 = 1): HeatCell[][] {
  const target = habitTarget(habit);
  const today = noonOf(endMs);
  const created = noonOf(habitStartMs(habit));
  // Wind back to the first day of this week, then back `weeks - 1` more weeks.
  const intoWeek = (today.getDay() - weekStart + 7) % 7;
  const firstDay = dayOffset(today.getTime(), -intoWeek - (weeks - 1) * 7);

  const columns: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const column: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const dayMs = dayOffset(firstDay, w * 7 + d);
      const future = dayMs > today.getTime();
      const before = dayMs < created.getTime();
      const ticks = ticksOn(habit, dayMs);
      column.push({
        dayMs,
        key: occurrenceDateKey(dayMs),
        due: !future && !before && isDueOn(habit, dayMs),
        inRange: !future && !before,
        ticks,
        level: heatLevel(ticks, target),
      });
    }
    columns.push(column);
  }
  return columns;
}

/* ————— rollups ————— */

export interface PeriodStat {
  /** "Aug", "2026" — already formatted for the axis. */
  label: string;
  /** Local ms inside the period, for keys and tooltips. */
  atMs: number;
  due: number;
  done: number;
  ticks: number;
  /** done/due, or null when nothing was due — never 0, which would read as a
      total failure rather than as "this habit did not apply". */
  rate: number | null;
}

function emptyPeriod(label: string, atMs: number): PeriodStat {
  return { label, atMs, due: 0, done: 0, ticks: 0, rate: null };
}

function sealed(p: PeriodStat): PeriodStat {
  return { ...p, rate: p.due === 0 ? null : p.done / p.due };
}

/** Completion per calendar month, oldest first, for the `months` months ending
    with the one containing `endMs`. */
export function monthlyStats(habit: Habit, endMs: number, months: number): PeriodStat[] {
  const target = habitTarget(habit);
  const created = noonOf(habitStartMs(habit));
  const today = noonOf(endMs);
  const out: PeriodStat[] = [];

  for (let m = months - 1; m >= 0; m--) {
    const cursor = new Date(today);
    cursor.setDate(1);
    cursor.setMonth(cursor.getMonth() - m);
    cursor.setHours(12, 0, 0, 0);
    const label = cursor.toLocaleDateString(undefined, { month: "short" });
    const period = emptyPeriod(label, cursor.getTime());
    const month = cursor.getMonth();

    for (let d = new Date(cursor); d.getMonth() === month; d.setDate(d.getDate() + 1)) {
      const dayMs = d.getTime();
      if (dayMs > today.getTime() || dayMs < created.getTime()) continue;
      period.ticks += ticksOn(habit, dayMs);
      if (!isDueOn(habit, dayMs)) continue;
      period.due++;
      if (ticksOn(habit, dayMs) >= target) period.done++;
    }
    out.push(sealed(period));
  }
  return out;
}

/** Completion per calendar year, oldest first, across the habit's whole life. */
export function yearlyStats(habit: Habit, endMs: number): PeriodStat[] {
  const target = habitTarget(habit);
  const created = noonOf(habitStartMs(habit));
  const today = noonOf(endMs);
  const out: PeriodStat[] = [];

  for (let y = created.getFullYear(); y <= today.getFullYear(); y++) {
    const start = new Date(y, 0, 1, 12, 0, 0, 0);
    const period = emptyPeriod(String(y), start.getTime());
    for (const d = new Date(start); d.getFullYear() === y; d.setDate(d.getDate() + 1)) {
      const dayMs = d.getTime();
      if (dayMs > today.getTime() || dayMs < created.getTime()) continue;
      period.ticks += ticksOn(habit, dayMs);
      if (!isDueOn(habit, dayMs)) continue;
      period.due++;
      if (ticksOn(habit, dayMs) >= target) period.done++;
    }
    out.push(sealed(period));
  }
  return out;
}

/** Completion per weekday (index 0 = Sunday) across the habit's whole life —
    the "you always miss Wednesdays" view, which is the one insight a plain
    streak count can never surface. */
export function weekdayStats(habit: Habit, endMs: number): PeriodStat[] {
  const NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const target = habitTarget(habit);
  const created = noonOf(habitStartMs(habit));
  const today = noonOf(endMs);
  const out = NAMES.map((n, i) => emptyPeriod(n, i));

  for (let dayMs = created.getTime(); dayMs <= today.getTime(); dayMs = dayOffset(dayMs, 1)) {
    const dow = new Date(dayMs).getDay();
    out[dow].ticks += ticksOn(habit, dayMs);
    if (!isDueOn(habit, dayMs)) continue;
    out[dow].due++;
    if (ticksOn(habit, dayMs) >= target) out[dow].done++;
  }
  return out.map(sealed);
}

/* ————— records ————— */

export interface StreakRecord {
  length: number;
  /** Local ms of the run's first and last due day; null when there is no run. */
  fromMs: number | null;
  toMs: number | null;
}

/** The longest run of consecutive done due-days the habit has ever had.

    Non-due days are transparent — they neither extend a run nor break it —
    which is the same rule `currentStreak` uses, so "longest" and "current" are
    always measured the same way and a current run can legitimately BE the
    record. */
export function longestStreak(habit: Habit, endMs: number): StreakRecord {
  const target = habitTarget(habit);
  const created = noonOf(habitStartMs(habit));
  const today = noonOf(endMs);

  let best: StreakRecord = { length: 0, fromMs: null, toMs: null };
  let run = 0;
  let runFrom: number | null = null;

  for (let dayMs = created.getTime(); dayMs <= today.getTime(); dayMs = dayOffset(dayMs, 1)) {
    if (!isDueOn(habit, dayMs)) continue;
    if (ticksOn(habit, dayMs) >= target) {
      run++;
      runFrom ??= dayMs;
      if (run > best.length) best = { length: run, fromMs: runFrom, toMs: dayMs };
    } else {
      run = 0;
      runFrom = null;
    }
  }
  return best;
}

export interface LifetimeStats {
  /** Every tick ever recorded — the "12,480 glasses of water" number. */
  totalTicks: number;
  /** Days the target was fully met. */
  doneDays: number;
  /** Days it was due at all. */
  dueDays: number;
  /** Days with at least one tick, met or not — effort, not just success. */
  activeDays: number;
  rate: number | null;
  firstDayMs: number;
  /** Calendar days since the record begins (lib/habits.ts `habitStartMs`),
      inclusive — so an imported ledger reports its real age, not one day. */
  ageDays: number;
}

export function lifetimeStats(habit: Habit, endMs: number): LifetimeStats {
  const target = habitTarget(habit);
  const created = noonOf(habitStartMs(habit));
  const today = noonOf(endMs);
  const out: LifetimeStats = {
    totalTicks: 0, doneDays: 0, dueDays: 0, activeDays: 0,
    rate: null, firstDayMs: created.getTime(), ageDays: 0,
  };

  for (let dayMs = created.getTime(); dayMs <= today.getTime(); dayMs = dayOffset(dayMs, 1)) {
    out.ageDays++;
    const ticks = ticksOn(habit, dayMs);
    out.totalTicks += ticks;
    if (ticks > 0) out.activeDays++;
    if (!isDueOn(habit, dayMs)) continue;
    out.dueDays++;
    if (ticks >= target) out.doneDays++;
  }
  out.rate = out.dueDays === 0 ? null : out.doneDays / out.dueDays;
  return out;
}

/* ————— trend ————— */

export interface TrendPoint {
  atMs: number;
  /** Share of due days met inside the trailing window ending here, or null
      while nothing was due in it. */
  rate: number | null;
}

/** A trailing-window completion rate sampled every `stepDays`, so a year reads
    as a curve rather than 365 spikes. The window smooths the day-to-day noise
    that makes a raw daily plot unreadable and unmotivating. */
export function rollingTrend(habit: Habit, endMs: number, spanDays: number, windowDays = 30, stepDays = 1): TrendPoint[] {
  const target = habitTarget(habit);
  const created = noonOf(habitStartMs(habit));
  const today = noonOf(endMs);
  const points: TrendPoint[] = [];

  for (let back = spanDays - 1; back >= 0; back -= stepDays) {
    const at = dayOffset(today.getTime(), -back);
    if (at < created.getTime()) continue;
    let due = 0;
    let done = 0;
    for (let i = 0; i < windowDays; i++) {
      const dayMs = dayOffset(at, -i);
      if (dayMs < created.getTime()) break;
      if (!isDueOn(habit, dayMs)) continue;
      due++;
      if (ticksOn(habit, dayMs) >= target) done++;
    }
    points.push({ atMs: at, rate: due === 0 ? null : done / due });
  }
  return points;
}

/* ————— across every habit ————— */

export interface DayRollup {
  dayMs: number;
  due: number;
  done: number;
  rate: number | null;
}

/** Every habit's combined completion per day, for the overview heatmap — one
    grid answering "how was that day overall" rather than one grid per habit. */
export function combinedDays(habits: readonly Habit[], endMs: number, days: number): DayRollup[] {
  const today = noonOf(endMs);
  const live = habits.filter((h) => !h.archivedAt);
  const out: DayRollup[] = [];

  for (let back = days - 1; back >= 0; back--) {
    const dayMs = dayOffset(today.getTime(), -back);
    let due = 0;
    let done = 0;
    for (const h of live) {
      if (dayMs < noonOf(habitStartMs(h)).getTime() || dayMs > today.getTime()) continue;
      if (!isDueOn(h, dayMs)) continue;
      due++;
      if (isDoneOn(h, dayMs)) done++;
    }
    out.push({ dayMs, due, done, rate: due === 0 ? null : done / due });
  }
  return out;
}

/** A "perfect day" is one where every habit that was due got done — and at
    least one was due, so an empty Sunday is not a hollow win. */
export function perfectDays(habits: readonly Habit[], endMs: number, days: number): number {
  return combinedDays(habits, endMs, days).filter((d) => d.due > 0 && d.done === d.due).length;
}

export interface CombinedCell extends DayRollup {
  /** False for the alignment padding before the window / after today. */
  inRange: boolean;
}

/** `combinedDays` reshaped into contribution-graph columns — a column is a
    week from `weekStart`, a row is a weekday. The leading days needed to make
    the first column start on `weekStart` are emitted as out-of-range blanks so
    every column has exactly seven rows. */
export function combinedWeeks(
  habits: readonly Habit[],
  endMs: number,
  days: number,
  weekStart: 0 | 1 | 6 = 1,
): CombinedCell[][] {
  const today = noonOf(endMs).getTime();
  const rollups = combinedDays(habits, endMs, days);
  const byKey = new Map(rollups.map((r) => [occurrenceDateKey(r.dayMs), r]));
  const first = rollups[0]?.dayMs ?? today;
  const intoWeek = (new Date(first).getDay() - weekStart + 7) % 7;
  const gridStart = dayOffset(first, -intoWeek);
  const weeks = Math.ceil((intoWeek + days) / 7);

  const columns: CombinedCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const column: CombinedCell[] = [];
    for (let d = 0; d < 7; d++) {
      const dayMs = dayOffset(gridStart, w * 7 + d);
      const hit = byKey.get(occurrenceDateKey(dayMs));
      column.push(
        hit
          ? { ...hit, inRange: true }
          : { dayMs, due: 0, done: 0, rate: null, inRange: false },
      );
    }
    columns.push(column);
  }
  return columns;
}

export interface HabitScore {
  /** 0-100. */
  score: number;
  band: "Building" | "Steady" | "Strong" | "Locked in";
}

const SCORE_WINDOW_DAYS = 84;

/** A single "how are the habits going" number, blended from three things a
    streak count alone misses: recent adherence (how much of what was due got
    done), the best live streak, and how many days lately were perfect. */
export function overallHabitScore(habits: readonly Habit[], endMs: number): HabitScore {
  const live = habits.filter((h) => !h.archivedAt);
  const days = combinedDays(live, endMs, SCORE_WINDOW_DAYS);
  const due = days.reduce((n, d) => n + d.due, 0);
  const done = days.reduce((n, d) => n + d.done, 0);

  const adherence = due === 0 ? 0 : done / due;
  const bestStreak = live.reduce((m, h) => Math.max(m, currentStreak(h, endMs)), 0);
  const streakFactor = Math.min(1, bestStreak / 30);
  const perfect = days.filter((d) => d.due > 0 && d.done === d.due).length;
  const perfectFactor = Math.min(1, perfect / (SCORE_WINDOW_DAYS / 2));

  const raw = 0.6 * adherence + 0.25 * streakFactor + 0.15 * perfectFactor;
  const score = Math.max(0, Math.min(100, Math.round(raw * 100)));
  const band =
    score >= 90 ? "Locked in" : score >= 70 ? "Strong" : score >= 40 ? "Steady" : "Building";
  return { score, band };
}
