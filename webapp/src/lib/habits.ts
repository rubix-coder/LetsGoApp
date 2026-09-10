/* Pure habit arithmetic: due-ness, ticks, streaks and consistency windows.
   All day math walks calendar days at noon so DST transitions can't skip or
   double a day, and keys through occurrenceDateKey — the same local
   "YYYY-MM-DD" convention routines use. */

import { occurrenceDateKey } from "./occurrence";
import type { Habit } from "./types";

export function habitTarget(h: Habit): number {
  return Math.max(1, h.timesPerDay ?? 1);
}

/** When this habit's record actually begins.

    NOT simply `createdAt`: a habit imported from a markdown ledger
    (lib/habitsMd.ts) is created today but carries years of log behind it, and
    every walk that started at `createdAt` would report a habit with no history
    at all — silently throwing away the very record the import existed to
    bring in. The log is the evidence; `createdAt` is only where this device
    first heard about it. */
export function habitStartMs(h: Habit): number {
  const first = Object.keys(h.log).sort()[0];
  if (!first) return h.createdAt;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(first);
  if (!m) return h.createdAt;
  const logged = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0).getTime();
  return Math.min(h.createdAt, logged);
}

export function isDueOn(h: Habit, dayMs: number): boolean {
  if (!h.days || h.days.length === 0) return true;
  return h.days.includes(new Date(dayMs).getDay());
}

export function ticksOn(h: Habit, dayMs: number): number {
  return h.log[occurrenceDateKey(dayMs)] ?? 0;
}

/** `target` overrides the habit's own `timesPerDay` for this day — the caller
    passes `habitTargetOn` (lib/habitLink.ts) when linked tasks set the day's
    target instead. Omitted, the stored target stands, which is what every
    history walk in lib/habitStats.ts wants: a past day judged by today's task
    list would rewrite streaks that were honestly kept. */
export function isDoneOn(h: Habit, dayMs: number, target: number = habitTarget(h)): boolean {
  return ticksOn(h, dayMs) >= target;
}

/** A new habit with `delta` applied to the day's tally, floored at zero.
    Zero-tick days are removed rather than stored — the log stays a record of
    things done, and absent-vs-zero never diverge. */
export function tickHabit(h: Habit, dayKey: string, delta: number): Habit {
  const next = Math.max(0, (h.log[dayKey] ?? 0) + delta);
  const log = { ...h.log };
  if (next === 0) delete log[dayKey];
  else log[dayKey] = next;
  return { ...h, log };
}

/** Noon of the same calendar day — the DST-safe stepping stone. */
function noonOf(ms: number): Date {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** Consecutive done due-days ending at `todayMs`. Today extends the run when
    done but does not break it while merely unfinished — the streak shouldn't
    read zero at breakfast. Non-due days pass through silently. */
export function currentStreak(h: Habit, todayMs: number): number {
  const today = noonOf(todayMs);
  const created = noonOf(habitStartMs(h));
  let streak = 0;
  if (isDueOn(h, today.getTime()) && isDoneOn(h, today.getTime())) streak++;
  for (let i = 1; ; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (d.getTime() < created.getTime() - 86_400_000 / 2) break;
    if (!isDueOn(h, d.getTime())) continue;
    if (!isDoneOn(h, d.getTime())) break;
    streak++;
  }
  return streak;
}

/** Due/done counts over the `windowDays` calendar days ending at `todayMs`,
    clipped to the habit's lifetime and weekday schedule. */
export function completionStats(h: Habit, windowDays: number, todayMs: number): { due: number; done: number } {
  const today = noonOf(todayMs);
  const created = noonOf(habitStartMs(h));
  let due = 0;
  let done = 0;
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (d.getTime() < created.getTime() - 86_400_000 / 2) break;
    if (!isDueOn(h, d.getTime())) continue;
    due++;
    if (isDoneOn(h, d.getTime())) done++;
  }
  return { due, done };
}

/** Habits that belong on today's checklist, in creation order. */
export function dueToday(habits: readonly Habit[], todayMs: number): Habit[] {
  return habits.filter((h) => !h.archivedAt && isDueOn(h, todayMs));
}

/** The emoji grid in the habit editor. Curated rather than a full emoji search,
    for the same reason the event picker is (lib/dayEvents.ts): the glyph IS the
    habit's identity in a dense list, and a small legible set beats thousands of
    near-identical faces. Grouped loosely by what people actually track —
    body, mind, craft, home, restraint. Any other emoji can still be typed
    into the field beside it. */
export const HABIT_EMOJIS: readonly string[] = [
  "\u{1F31E}", "\u{1F634}", "\u{1F4A7}", "\u{1F957}", "\u{1F34E}", "\u{1F48A}",
  "\u{1F3C3}", "\u{1F6B6}", "\u{1F3CB}\uFE0F", "\u{1F9D8}", "\u{1F6B4}", "\u{1F3CA}",
  "\u{1F9B7}", "\u{1F4D6}", "\u{270D}\uFE0F", "\u{1F4DD}", "\u{1F9E0}", "\u{1F5E3}\uFE0F",
  "\u{1F3B8}", "\u{1F3A8}", "\u{1F4BB}", "\u{1F4F7}", "\u{1F9F9}", "\u{1F373}",
  "\u{1F331}", "\u{1F4B0}", "\u{1F4DE}", "\u{1F64F}", "\u{1F6AD}", "\u{1F4F5}",
];

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One line describing when a habit is due, for the collapsed "Schedule"
    section of the editor — the point of collapsing a section is that its
    header still tells you what is inside, so you know whether to open it.

    Weekdays and weekends are named rather than listed: "Mon, Tue, Wed, Thu,
    Fri" is the same information spelled at three times the width, in the one
    place there is no width to spare. */
export function habitScheduleSummary(everyDay: boolean, days: readonly number[], times: number): string {
  const per = times > 1 ? ` \u00b7 ${times}\u00d7 a day` : "";
  const set = [...new Set(days)].sort((a, b) => a - b);
  const when =
    everyDay || set.length === 7 ? "Every day" :
    set.length === 0 ? "No days picked" :
    set.join() === "1,2,3,4,5" ? "Weekdays" :
    set.join() === "0,6" ? "Weekends" :
    // Monday-first, which is how a week of habits reads, so Sunday lands last.
    set.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY_SHORT[d]).join(", ");
  return when + per;
}
