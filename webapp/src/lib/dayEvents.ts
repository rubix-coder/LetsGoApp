/* All-day events — birthdays, anniversaries, holidays, bills.

   An event is an ordinary task that declines the parts of a task assuming a
   clock. It keeps its tags, notes, sub-tasks, search and markdown round-trip;
   it just answers "which DAY is this?" instead of "when does it start?". So
   the dated views (Calendar, Schedule, Gantt) never draw it as a scheduled
   block — they hang it off the date as a notch (components/DayNotch.tsx).

   Repeats need nothing new: an event reuses `task.repeat`, anchored the same
   way every other routine is, and occurrences stay computed on read. The one
   addition "repeats yearly" required was the `yearly` unit itself
   (lib/types.ts, mdTasks.repeatOccursOn). */

import { startOfDay } from "./dates";
import { repeatOccursOn } from "./mdTasks";
import type { Repeat, Task } from "./types";

/** Drawn when an event carries no emoji of its own — a hand-edited vault or
    an import can produce one, and an empty notch would be invisible. */
export const FALLBACK_EVENT_EMOJI = "📌";

/** One-tap starting points in the editor. Picking a kind fills in the emoji
    and, for the dated-anniversary kinds, pre-selects the routine you almost
    always want — which is the whole reason `yearly` exists. */
export interface EventKind {
  id: string;
  label: string;
  emoji: string;
  defaultRepeat?: Repeat;
}

export const EVENT_KINDS: readonly EventKind[] = [
  { id: "birthday", label: "Birthday", emoji: "🎂", defaultRepeat: { interval: 1, unit: "yearly" } },
  { id: "anniversary", label: "Anniversary", emoji: "💍", defaultRepeat: { interval: 1, unit: "yearly" } },
  { id: "holiday", label: "Holiday", emoji: "🎏", defaultRepeat: { interval: 1, unit: "yearly" } },
  { id: "celebration", label: "Celebration", emoji: "🎉" },
  { id: "bill", label: "Bill", emoji: "💳", defaultRepeat: { interval: 1, unit: "monthly" } },
  { id: "appointment", label: "Appointment", emoji: "🩺" },
  { id: "trip", label: "Trip", emoji: "✈️" },
  { id: "other", label: "Other", emoji: "📌" },
];

/** The emoji grid in the editor. Curated rather than a full emoji search: the
    glyph IS the event's identity at a glance, so a small legible set beats
    thousands of near-identical faces. */
export const EVENT_EMOJIS: readonly string[] = [
  "🎂", "🎁", "💍", "❤️", "🎉", "🎊",
  "🎏", "🕯️", "🪔", "🎄", "🎃", "🧧",
  "🩺", "💊", "💳", "🏦", "✈️", "🏖️",
  "🎓", "📚", "🏆", "⚽", "🎸", "📌",
];

/** An event landing on one particular day. */
export interface DayEvent {
  task: Task;
  emoji: string;
  title: string;
  /** "yearly", "every 6 months", … — undefined for a one-off. */
  repeatLabel?: string;
  /** True on the series' own anchor day, false on a repeat of it. */
  isAnchor: boolean;
}

/** Which day an event sits on: its schedule, else its deadline. The same
    anchor rule every other routine in the app already uses. */
export function eventAnchorOf(task: Task): number | undefined {
  return task.scheduledAt ?? task.deadline;
}

/** The event's glyph, never blank. */
export function eventEmojiOf(task: Task): string {
  return task.emoji?.trim() || FALLBACK_EVENT_EMOJI;
}

const UNIT_NOUN: Record<Repeat["unit"], string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

/** Human phrasing for the notch's tail and the editor's summary. */
export function repeatLabel(repeat: Repeat | undefined): string | undefined {
  if (!repeat) return undefined;
  if (repeat.interval === 1) return repeat.unit;
  return `every ${repeat.interval} ${UNIT_NOUN[repeat.unit]}s`;
}

/** Everything a screen reader needs, since the collapsed notch shows only an
    emoji and its label must not depend on hovering. */
export function eventAriaLabel(event: DayEvent): string {
  const base = `${event.title}, all-day event`;
  return event.repeatLabel ? `${base}, repeats ${event.repeatLabel}` : base;
}

/** Every all-day event with an occurrence on the local day starting at
    `dayStart`, in task order (stable, so notches don't reshuffle on rerender). */
export function eventsOnDay(tasks: readonly Task[], dayStart: number): DayEvent[] {
  const found: DayEvent[] = [];
  for (const task of tasks) {
    if (!task.allDay) continue;
    const anchor = eventAnchorOf(task);
    if (anchor === undefined) continue;
    if (!repeatOccursOn(anchor, task.repeat, dayStart)) continue;
    found.push({
      task,
      emoji: eventEmojiOf(task),
      title: task.title,
      repeatLabel: repeatLabel(task.repeat),
      isAnchor: startOfDay(anchor) === dayStart,
    });
  }
  return found;
}

/** True when this task should be drawn as an event rather than a timed task —
    the single check every view uses to keep an event out of the hour grid. */
export function isAllDayEvent(task: Task): boolean {
  return !!task.allDay;
}
