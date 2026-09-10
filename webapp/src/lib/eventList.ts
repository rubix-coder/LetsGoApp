/* The Events lens — every all-day event in one list instead of one date.

   The Calendar answers "what is on THIS day?". Events answers the question a
   month grid is bad at: "what recurring days do I keep, and which one is
   next?". Birthdays and anniversaries are the whole reason: they are invisible
   for 364 days and then late.

   Nothing new is stored. An event is still `task.allDay` anchored at
   `scheduledAt ?? deadline` with an ordinary `task.repeat` (lib/dayEvents.ts);
   this module only expands those anchors over a date window, buckets them by
   kind, and answers "when is the next one?".

   `eventKind` (lib/types.ts) is the one field added for the sections. It is
   optional and written going forward by the editor and the quick-add; events
   saved before it existed fall back to their emoji, which is what identified a
   kind up to now. */

import { addDays, startOfDay } from "./dates";
import {
  EVENT_KINDS,
  eventAnchorOf,
  eventEmojiOf,
  repeatLabel,
  type DayEvent,
  type EventKind,
} from "./dayEvents";
import type { Task } from "./types";

const DAY = 86_400_000;

/** The bucket an event with no recognisable kind falls into. Always last in
    the section order, so a tidy vault never opens on "Other". */
export const OTHER_KIND_ID = "other";

/** How far ahead `nextOccurrenceOf` will look for a monthly/yearly stride
    before giving up. 200 strides covers 200 years of a yearly birthday and
    ~16 years of a monthly bill — far past any list worth rendering, and it
    stops a 29-Feb anchor with no matching day from spinning forever. */
const MAX_STRIDES = 200;

/** An event landing on one particular day, carrying that day. `DayEvent`
    itself is day-less — the calendar always knew which cell it was drawing. */
export interface EventOccurrence {
  /** Local midnight of the day this occurrence falls on. */
  day: number;
  event: DayEvent;
}

/** One collapsible section of the list. */
export interface EventSection {
  kind: EventKind;
  occurrences: EventOccurrence[];
}

/** How wide a window the list shows. "all" is not a date window at all — it
    lists every event once at its next occurrence, which is the master list. */
export type EventScope = "week" | "month" | "year" | "all";

export const EVENT_SCOPES: readonly { id: EventScope; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "all", label: "All" },
];

/** Inclusive local-midnight day range, or null for "all". */
export interface DayRange {
  from: number;
  to: number;
}

/** Local midnight of the first day of `t`'s week, honouring the week-start
    setting (0 = Sunday). */
export function weekStartOf(t: number, weekStart: number): number {
  const day = startOfDay(t);
  return addDays(day, -((new Date(day).getDay() - weekStart + 7) % 7));
}

/** Local midnight of the 1st of `t`'s month. */
export function monthStartOf(t: number): number {
  const d = new Date(t);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local midnight of 1 January of `t`'s year. */
export function yearStartOf(t: number): number {
  const d = new Date(t);
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The day window a scope covers around `cursor` — null for "all", which has
    no window. Both ends are local midnights and the range is inclusive. */
export function scopeRange(scope: EventScope, cursor: number, weekStart: number): DayRange | null {
  if (scope === "all") return null;
  if (scope === "week") {
    const from = weekStartOf(cursor, weekStart);
    return { from, to: addDays(from, 6) };
  }
  if (scope === "month") {
    const from = monthStartOf(cursor);
    const next = new Date(from);
    next.setMonth(next.getMonth() + 1);
    return { from, to: addDays(next.getTime(), -1) };
  }
  const from = yearStartOf(cursor);
  const next = new Date(from);
  next.setFullYear(next.getFullYear() + 1);
  return { from, to: addDays(next.getTime(), -1) };
}

/** Move the cursor `n` whole scopes forward (negative = back). "all" has no
    window to step through, so it stays put. */
export function shiftScope(scope: EventScope, cursor: number, n: number, weekStart: number): number {
  if (scope === "all") return cursor;
  if (scope === "week") return addDays(weekStartOf(cursor, weekStart), 7 * n);
  const d = new Date(scope === "month" ? monthStartOf(cursor) : yearStartOf(cursor));
  if (scope === "month") d.setMonth(d.getMonth() + n);
  else d.setFullYear(d.getFullYear() + n);
  return d.getTime();
}

/** The window's name for the toolbar: "Sep 1 – 7, 2026" / "September 2026" /
    "2026" / "All events". */
export function scopeLabel(scope: EventScope, cursor: number, weekStart: number): string {
  const range = scopeRange(scope, cursor, weekStart);
  if (!range) return "All events";
  if (scope === "year") return String(new Date(range.from).getFullYear());
  if (scope === "month") return new Date(range.from).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const a = new Date(range.from);
  const b = new Date(range.to);
  const monthA = a.toLocaleDateString("en-US", { month: "short" });
  const monthB = b.toLocaleDateString("en-US", { month: "short" });
  const tail = `${b.getDate()}, ${b.getFullYear()}`;
  return monthA === monthB
    ? `${monthA} ${a.getDate()} – ${tail}`
    : `${monthA} ${a.getDate()} – ${monthB} ${tail}`;
}

/** The kind id an event belongs to: its own recorded kind, else the kind whose
    emoji it carries, else "other". The emoji fallback is what makes every
    event saved before `eventKind` existed land in the right section. */
export function eventKindOf(task: Pick<Task, "eventKind" | "emoji">): string {
  if (task.eventKind && EVENT_KINDS.some((k) => k.id === task.eventKind)) return task.eventKind;
  const emoji = task.emoji?.trim();
  return EVENT_KINDS.find((k) => k.emoji === emoji)?.id ?? OTHER_KIND_ID;
}

/** The kind record for an id, never undefined — an unknown id reads as Other
    so a hand-edited vault cannot blank out a section header. */
export function eventKindById(id: string): EventKind {
  return EVENT_KINDS.find((k) => k.id === id) ?? EVENT_KINDS[EVENT_KINDS.length - 1];
}

/** Every task the Events list is about: all-day, and anchored to some day. An
    all-day task with neither a schedule nor a deadline has no day to sit on,
    so no view can place it. */
export function eventTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => t.allDay && eventAnchorOf(t) !== undefined);
}

function occurrenceOf(task: Task, day: number, anchorDay: number): EventOccurrence {
  return {
    day,
    event: {
      task,
      emoji: eventEmojiOf(task),
      title: task.title,
      repeatLabel: repeatLabel(task.repeat),
      isAnchor: day === anchorDay,
    },
  };
}

/** The first day on or after `fromDay` that this event occurs, or undefined
    when it never will again (a one-off already past, or a stride that runs off
    the lookahead). Stride arithmetic rather than a day-by-day walk: a yearly
    birthday is otherwise 365 wasted `repeatOccursOn` calls per row. */
export function nextOccurrenceOf(task: Task, fromDay: number): number | undefined {
  const anchor = eventAnchorOf(task);
  if (anchor === undefined) return undefined;
  const anchorDay = startOfDay(anchor);
  const from = startOfDay(fromDay);
  if (from <= anchorDay) return anchorDay;
  const repeat = task.repeat;
  if (!repeat) return undefined;

  if (repeat.unit === "daily" || repeat.unit === "weekly") {
    const stride = (repeat.unit === "weekly" ? 7 : 1) * repeat.interval;
    const elapsed = Math.round((from - anchorDay) / DAY);
    const steps = Math.ceil(elapsed / stride);
    return addDays(anchorDay, steps * stride);
  }

  // Monthly and yearly walk the calendar in months — a year is a 12-month
  // stride — and each candidate is measured from the anchor rather than from
  // the previous candidate. Stepping a cursor would drift: a 29 Feb anchor
  // pushed one year lands on 1 March, and every later stride would inherit
  // that slip. A month too short for the anchor's day-of-month has no
  // occurrence at all, exactly as repeatOccursOn already rules.
  const months = repeat.unit === "yearly" ? repeat.interval * 12 : repeat.interval;
  const dayOfMonth = new Date(anchorDay).getDate();
  for (let stride = 1; stride <= MAX_STRIDES; stride++) {
    const candidate = new Date(anchorDay);
    candidate.setDate(1); // Land the month move on a day every month has.
    candidate.setMonth(candidate.getMonth() + months * stride);
    const daysInMonth = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
    if (dayOfMonth > daysInMonth) continue;
    candidate.setDate(dayOfMonth);
    const day = candidate.getTime();
    if (day >= from) return day;
  }
  return undefined;
}

/* Both expansions below rely on Array.prototype.sort being stable (ES2019):
   rows are built in task order, so equal days keep it and the list never
   reshuffles between renders. */

/** Every occurrence of every event inside an inclusive day range, earliest
    first. */
export function occurrencesInRange(tasks: readonly Task[], range: DayRange): EventOccurrence[] {
  const found: EventOccurrence[] = [];
  for (const task of eventTasks(tasks)) {
    const anchorDay = startOfDay(eventAnchorOf(task)!);
    let day = nextOccurrenceOf(task, range.from);
    // A one-off that already passed answers undefined and contributes
    // nothing; a repeat walks forward from its first hit inside the window.
    while (day !== undefined && day <= range.to) {
      found.push(occurrenceOf(task, day, anchorDay));
      const after = nextOccurrenceOf(task, addDays(day, 1));
      if (after === undefined || after <= day) break;
      day = after;
    }
  }
  return found.sort((a, b) => a.day - b.day);
}

/** One row per event at its next occurrence — the "All" scope. An event with
    no occurrence left keeps its anchor day and sorts to the end, most recent
    first, so a finished one-off is archived rather than lost. */
export function upcomingOccurrences(tasks: readonly Task[], today: number): EventOccurrence[] {
  const from = startOfDay(today);
  const rows = eventTasks(tasks).map((task) => {
    const anchorDay = startOfDay(eventAnchorOf(task)!);
    const next = nextOccurrenceOf(task, from);
    return { occurrence: occurrenceOf(task, next ?? anchorDay, anchorDay), past: next === undefined };
  });
  return rows
    .sort((a, b) =>
      Number(a.past) - Number(b.past)
      || (a.past ? b.occurrence.day - a.occurrence.day : a.occurrence.day - b.occurrence.day))
    .map((row) => row.occurrence);
}

/** Bucket occurrences into sections in EVENT_KINDS order. Empty kinds are
    dropped — an accordion of empty headers is noise, not structure. */
export function groupByKind(occurrences: readonly EventOccurrence[]): EventSection[] {
  const byKind = new Map<string, EventOccurrence[]>();
  for (const occurrence of occurrences) {
    const id = eventKindOf(occurrence.event.task);
    const bucket = byKind.get(id);
    if (bucket) bucket.push(occurrence);
    else byKind.set(id, [occurrence]);
  }
  return EVENT_KINDS
    .filter((kind) => byKind.has(kind.id))
    .map((kind) => ({ kind, occurrences: byKind.get(kind.id)! }));
}

/** Whole days from today to `day` — negative in the past. Drives the "in 6
    days" tail, which is the number the list is actually read for. */
export function daysUntil(day: number, today: number): number {
  return Math.round((startOfDay(day) - startOfDay(today)) / DAY);
}

/** "Today" / "Tomorrow" / "in 6 days" / "3 days ago". */
export function relativeDayLabel(day: number, today: number): string {
  const delta = daysUntil(day, today);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  return delta > 0 ? `in ${delta} days` : `${-delta} days ago`;
}

/** The three numbers the glance band shows: how many occurrences fall in the
    next 7 days, the rest of this month, and the rest of this year — each
    counted from today forward, never backwards over days already spent. */
export interface EventGlance {
  week: number;
  month: number;
  year: number;
}

export function glanceCounts(tasks: readonly Task[], today: number): EventGlance {
  const from = startOfDay(today);
  const monthEnd = scopeRange("month", from, 0)!.to;
  const yearEnd = scopeRange("year", from, 0)!.to;
  const inYear = occurrencesInRange(tasks, { from, to: yearEnd });
  const weekEnd = addDays(from, 6);
  return {
    week: inYear.filter((o) => o.day <= weekEnd).length,
    month: inYear.filter((o) => o.day <= monthEnd).length,
    year: inYear.length,
  };
}
