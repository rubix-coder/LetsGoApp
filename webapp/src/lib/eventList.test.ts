// @vitest-environment node
import { describe, expect, it } from "vitest";
import { addDays, startOfDay } from "./dates";
import {
  OTHER_KIND_ID,
  daysUntil,
  eventKindById,
  eventKindOf,
  eventTasks,
  glanceCounts,
  groupByKind,
  monthStartOf,
  nextOccurrenceOf,
  occurrencesInRange,
  relativeDayLabel,
  scopeLabel,
  scopeRange,
  shiftScope,
  upcomingOccurrences,
  weekStartOf,
  yearStartOf,
} from "./eventList";
import { repeatOccursOn } from "./mdTasks";
import type { Task } from "./types";

/** Wed 5 Aug 2026, local. */
const day = startOfDay(new Date(2026, 7, 5).getTime());

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Priya's birthday",
    status: "pending",
    priority: 1,
    tags: [],
    createdAt: day,
    loggedMin: 0,
    allDay: true,
    emoji: "🎂",
    scheduledAt: day,
    repeat: { interval: 1, unit: "yearly" },
    ...over,
  };
}

describe("eventTasks", () => {
  it("keeps only all-day tasks that have a day to sit on", () => {
    const kept = task();
    const timed = task({ id: "t2", allDay: false });
    const dayless = task({ id: "t3", scheduledAt: undefined, deadline: undefined });
    expect(eventTasks([kept, timed, dayless]).map((t) => t.id)).toEqual(["t1"]);
  });

  it("accepts a deadline as the anchor when there is no schedule", () => {
    const byDeadline = task({ scheduledAt: undefined, deadline: day });
    expect(eventTasks([byDeadline])).toHaveLength(1);
  });
});

describe("eventKindOf", () => {
  it("uses the recorded kind", () => {
    expect(eventKindOf({ eventKind: "bill", emoji: "🎂" })).toBe("bill");
  });

  it("falls back to the emoji for events saved before eventKind existed", () => {
    expect(eventKindOf({ emoji: "🎂" })).toBe("birthday");
    expect(eventKindOf({ emoji: "💳" })).toBe("bill");
  });

  it("reads an unknown emoji or kind as Other", () => {
    expect(eventKindOf({ emoji: "🦄" })).toBe(OTHER_KIND_ID);
    expect(eventKindOf({ eventKind: "made-up", emoji: "🦄" })).toBe(OTHER_KIND_ID);
    expect(eventKindOf({})).toBe(OTHER_KIND_ID);
  });

  it("resolves an unknown id to the Other kind record", () => {
    expect(eventKindById("made-up").id).toBe(OTHER_KIND_ID);
    expect(eventKindById("birthday").label).toBe("Birthday");
  });
});

describe("scope windows", () => {
  it("spans the week from the configured week start", () => {
    const sunday = scopeRange("week", day, 0)!;
    expect(sunday.from).toBe(startOfDay(new Date(2026, 7, 2).getTime()));
    expect(sunday.to).toBe(startOfDay(new Date(2026, 7, 8).getTime()));
    const monday = scopeRange("week", day, 1)!;
    expect(monday.from).toBe(startOfDay(new Date(2026, 7, 3).getTime()));
  });

  it("spans whole months and years", () => {
    const month = scopeRange("month", day, 0)!;
    expect(month.from).toBe(monthStartOf(day));
    expect(month.to).toBe(startOfDay(new Date(2026, 7, 31).getTime()));
    const year = scopeRange("year", day, 0)!;
    expect(year.from).toBe(yearStartOf(day));
    expect(year.to).toBe(startOfDay(new Date(2026, 11, 31).getTime()));
  });

  it("has no window for All", () => {
    expect(scopeRange("all", day, 0)).toBeNull();
  });

  it("steps whole scopes and leaves All alone", () => {
    expect(shiftScope("week", day, 1, 0)).toBe(addDays(weekStartOf(day, 0), 7));
    expect(shiftScope("month", day, -1, 0)).toBe(startOfDay(new Date(2026, 6, 1).getTime()));
    expect(shiftScope("year", day, 2, 0)).toBe(startOfDay(new Date(2028, 0, 1).getTime()));
    expect(shiftScope("all", day, 3, 0)).toBe(day);
  });

  it("names the window", () => {
    expect(scopeLabel("month", day, 0)).toBe("August 2026");
    expect(scopeLabel("year", day, 0)).toBe("2026");
    expect(scopeLabel("week", day, 0)).toBe("Aug 2 – 8, 2026");
    expect(scopeLabel("all", day, 0)).toBe("All events");
    // A week straddling a month boundary names both months.
    const straddle = startOfDay(new Date(2026, 7, 31).getTime());
    expect(scopeLabel("week", straddle, 0)).toBe("Aug 30 – Sep 5, 2026");
  });
});

describe("nextOccurrenceOf", () => {
  it("returns the anchor itself when the search starts on or before it", () => {
    expect(nextOccurrenceOf(task(), day)).toBe(day);
    expect(nextOccurrenceOf(task(), addDays(day, -30))).toBe(day);
  });

  it("gives a past one-off no next day", () => {
    expect(nextOccurrenceOf(task({ repeat: undefined }), addDays(day, 1))).toBeUndefined();
  });

  it("strides daily and weekly repeats", () => {
    const daily = task({ repeat: { interval: 3, unit: "daily" } });
    expect(nextOccurrenceOf(daily, addDays(day, 1))).toBe(addDays(day, 3));
    expect(nextOccurrenceOf(daily, addDays(day, 3))).toBe(addDays(day, 3));
    const weekly = task({ repeat: { interval: 2, unit: "weekly" } });
    expect(nextOccurrenceOf(weekly, addDays(day, 1))).toBe(addDays(day, 14));
  });

  it("strides monthly and yearly repeats over the calendar", () => {
    const monthly = task({ repeat: { interval: 1, unit: "monthly" }, emoji: "💳" });
    expect(nextOccurrenceOf(monthly, addDays(day, 1))).toBe(startOfDay(new Date(2026, 8, 5).getTime()));
    const yearly = task({ repeat: { interval: 1, unit: "yearly" } });
    expect(nextOccurrenceOf(yearly, addDays(day, 1))).toBe(startOfDay(new Date(2027, 7, 5).getTime()));
  });

  it("skips months a 31st anchor has no day for", () => {
    const anchor = startOfDay(new Date(2026, 0, 31).getTime());
    const monthly = task({ scheduledAt: anchor, repeat: { interval: 1, unit: "monthly" } });
    // February 2026 has no 31st — the next occurrence is March.
    expect(nextOccurrenceOf(monthly, addDays(anchor, 1))).toBe(startOfDay(new Date(2026, 2, 31).getTime()));
  });

  it("finds the leap day a 29 Feb birthday next falls on", () => {
    const anchor = startOfDay(new Date(2024, 1, 29).getTime());
    const yearly = task({ scheduledAt: anchor, repeat: { interval: 1, unit: "yearly" } });
    expect(nextOccurrenceOf(yearly, startOfDay(new Date(2025, 0, 1).getTime())))
      .toBe(startOfDay(new Date(2028, 1, 29).getTime()));
  });
});

describe("nextOccurrenceOf agrees with repeatOccursOn", () => {
  // The Events list strides; the Calendar tests each day. If the two ever
  // disagree an event shows up in one view and not the other, so pin them
  // together over a year of days for every repeat unit.
  const units = ["daily", "weekly", "monthly", "yearly"] as const;
  for (const unit of units) {
    for (const interval of [1, 2]) {
      it(`matches for every ${interval} ${unit}`, () => {
        const anchor = startOfDay(new Date(2026, 0, 31).getTime());
        const routine = task({ scheduledAt: anchor, repeat: { interval, unit } });
        const strided: number[] = [];
        let cursor = nextOccurrenceOf(routine, anchor);
        while (cursor !== undefined && cursor <= addDays(anchor, 365)) {
          strided.push(cursor);
          cursor = nextOccurrenceOf(routine, addDays(cursor, 1));
        }
        const walked = [...Array(366)]
          .map((_, i) => addDays(anchor, i))
          .filter((d) => repeatOccursOn(anchor, { interval, unit }, d));
        expect(strided).toEqual(walked);
      });
    }
  }
});

describe("occurrencesInRange", () => {
  it("expands a yearly event onto its one day in the window", () => {
    const found = occurrencesInRange([task()], scopeRange("month", day, 0)!);
    expect(found).toHaveLength(1);
    expect(found[0].day).toBe(day);
    expect(found[0].event.isAnchor).toBe(true);
    expect(found[0].event.repeatLabel).toBe("yearly");
  });

  it("repeats a monthly event across a year", () => {
    const bill = task({ emoji: "💳", repeat: { interval: 1, unit: "monthly" } });
    const found = occurrencesInRange([bill], scopeRange("year", day, 0)!);
    // Anchored 5 Aug: Aug through Dec.
    expect(found.map((o) => new Date(o.day).getMonth())).toEqual([7, 8, 9, 10, 11]);
    expect(found[0].event.isAnchor).toBe(true);
    expect(found[1].event.isAnchor).toBe(false);
  });

  it("leaves out an event whose window it misses", () => {
    const found = occurrencesInRange([task({ repeat: undefined })], scopeRange("month", addDays(day, 60), 0)!);
    expect(found).toEqual([]);
  });

  it("orders by day, keeping task order within a day", () => {
    const a = task({ id: "a", title: "A" });
    const b = task({ id: "b", title: "B" });
    const later = task({ id: "c", title: "C", scheduledAt: addDays(day, 2), repeat: undefined });
    const found = occurrencesInRange([a, later, b], scopeRange("month", day, 0)!);
    expect(found.map((o) => o.event.title)).toEqual(["A", "B", "C"]);
  });
});

describe("upcomingOccurrences", () => {
  it("lists each event once at its next day, soonest first", () => {
    const soon = task({ id: "a", title: "Soon", scheduledAt: addDays(day, 2), repeat: undefined });
    const later = task({ id: "b", title: "Later", scheduledAt: addDays(day, 9), repeat: undefined });
    const rows = upcomingOccurrences([later, soon], day);
    expect(rows.map((o) => o.event.title)).toEqual(["Soon", "Later"]);
  });

  it("keeps a finished one-off last, at its own day", () => {
    const done = task({ id: "a", title: "Done", scheduledAt: addDays(day, -5), repeat: undefined });
    const ahead = task({ id: "b", title: "Ahead", scheduledAt: addDays(day, 5), repeat: undefined });
    const rows = upcomingOccurrences([done, ahead], day);
    expect(rows.map((o) => o.event.title)).toEqual(["Ahead", "Done"]);
    expect(rows[1].day).toBe(addDays(day, -5));
  });

  it("rolls a yearly event forward to next year once its day has passed", () => {
    const rows = upcomingOccurrences([task()], addDays(day, 1));
    expect(rows[0].day).toBe(startOfDay(new Date(2027, 7, 5).getTime()));
  });
});

describe("groupByKind", () => {
  it("sections in EVENT_KINDS order and drops empty kinds", () => {
    const birthday = task({ id: "a", emoji: "🎂" });
    const bill = task({ id: "b", emoji: "💳", eventKind: "bill" });
    const odd = task({ id: "c", emoji: "🦄" });
    const sections = groupByKind(occurrencesInRange([bill, odd, birthday], scopeRange("month", day, 0)!));
    expect(sections.map((s) => s.kind.id)).toEqual(["birthday", "bill", "other"]);
    expect(sections[0].occurrences).toHaveLength(1);
  });
});

describe("glanceCounts", () => {
  it("counts forward from today into the week, month and year", () => {
    const thisWeek = task({ id: "a", scheduledAt: addDays(day, 3), repeat: undefined });
    const thisMonth = task({ id: "b", scheduledAt: addDays(day, 20), repeat: undefined });
    const thisYear = task({ id: "c", scheduledAt: startOfDay(new Date(2026, 10, 2).getTime()), repeat: undefined });
    const spent = task({ id: "d", scheduledAt: addDays(day, -2), repeat: undefined });
    expect(glanceCounts([thisWeek, thisMonth, thisYear, spent], day)).toEqual({ week: 1, month: 2, year: 3 });
  });
});

describe("day labels", () => {
  it("counts whole days either side of today", () => {
    expect(daysUntil(addDays(day, 6), day)).toBe(6);
    expect(daysUntil(addDays(day, -2), day)).toBe(-2);
  });

  it("names the near days and counts the rest", () => {
    expect(relativeDayLabel(day, day)).toBe("Today");
    expect(relativeDayLabel(addDays(day, 1), day)).toBe("Tomorrow");
    expect(relativeDayLabel(addDays(day, -1), day)).toBe("Yesterday");
    expect(relativeDayLabel(addDays(day, 6), day)).toBe("in 6 days");
    expect(relativeDayLabel(addDays(day, -3), day)).toBe("3 days ago");
  });
});
