// @vitest-environment node
import { describe, expect, it } from "vitest";
import { addDays, at, startOfDay } from "./dates";
import {
  EVENT_KINDS,
  FALLBACK_EVENT_EMOJI,
  eventAriaLabel,
  eventAnchorOf,
  eventsOnDay,
  repeatLabel,
} from "./dayEvents";
import type { Task } from "./types";

const day = startOfDay(new Date(2026, 7, 3).getTime()); // Mon Aug 3 2026, local

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
    ...over,
  };
}

describe("eventsOnDay", () => {
  it("finds an event on its own anchor day", () => {
    const found = eventsOnDay([task()], day);
    expect(found).toHaveLength(1);
    expect(found[0].emoji).toBe("🎂");
    expect(found[0].title).toBe("Priya's birthday");
    expect(found[0].isAnchor).toBe(true);
  });

  it("ignores ordinary tasks — only allDay ones are events", () => {
    expect(eventsOnDay([task({ allDay: false })], day)).toHaveLength(0);
    expect(eventsOnDay([task({ allDay: undefined })], day)).toHaveLength(0);
  });

  it("ignores an event with neither a schedule nor a deadline", () => {
    expect(eventsOnDay([task({ scheduledAt: undefined })], day)).toHaveLength(0);
  });

  it("anchors on the deadline when the event was never scheduled", () => {
    const found = eventsOnDay([task({ scheduledAt: undefined, deadline: at(day, 17) })], day);
    expect(found).toHaveLength(1);
    expect(found[0].isAnchor).toBe(true);
  });

  it("ignores the clock: an event anchored at 14:00 still lands on that whole day", () => {
    expect(eventsOnDay([task({ scheduledAt: at(day, 14, 30) })], day)).toHaveLength(1);
  });

  it("does not land on a day the event has no occurrence on", () => {
    expect(eventsOnDay([task()], addDays(day, 1))).toHaveLength(0);
  });

  it("repeats yearly onto the same date in later years", () => {
    const birthday = task({ repeat: { interval: 1, unit: "yearly" } });
    const nextYear = startOfDay(new Date(2027, 7, 3).getTime());
    const found = eventsOnDay([birthday], nextYear);
    expect(found).toHaveLength(1);
    // A repeat is not the anchor — the notch says "repeats", the editor opens
    // the one underlying task.
    expect(found[0].isAnchor).toBe(false);
    expect(found[0].repeatLabel).toBe("yearly");
  });

  it("a yearly repeat does not fire on the wrong date or a wrong month", () => {
    const birthday = task({ repeat: { interval: 1, unit: "yearly" } });
    expect(eventsOnDay([birthday], startOfDay(new Date(2027, 7, 4).getTime()))).toHaveLength(0);
    expect(eventsOnDay([birthday], startOfDay(new Date(2027, 8, 3).getTime()))).toHaveLength(0);
  });

  it("honours a multi-year interval", () => {
    const olympics = task({ repeat: { interval: 4, unit: "yearly" } });
    expect(eventsOnDay([olympics], startOfDay(new Date(2030, 7, 3).getTime()))).toHaveLength(1);
    expect(eventsOnDay([olympics], startOfDay(new Date(2028, 7, 3).getTime()))).toHaveLength(0);
  });

  it("still supports monthly events, for recurring bills", () => {
    const bill = task({ emoji: "💳", title: "Card bill", repeat: { interval: 1, unit: "monthly" } });
    expect(eventsOnDay([bill], startOfDay(new Date(2026, 8, 3).getTime()))).toHaveLength(1);
  });

  it("never fires before the anchor", () => {
    const birthday = task({ repeat: { interval: 1, unit: "yearly" } });
    expect(eventsOnDay([birthday], startOfDay(new Date(2025, 7, 3).getTime()))).toHaveLength(0);
  });

  it("falls back to a default glyph rather than rendering an empty notch", () => {
    expect(eventsOnDay([task({ emoji: undefined })], day)[0].emoji).toBe(FALLBACK_EVENT_EMOJI);
    expect(eventsOnDay([task({ emoji: "   " })], day)[0].emoji).toBe(FALLBACK_EVENT_EMOJI);
  });

  it("returns every event landing on the same day, in task order", () => {
    const found = eventsOnDay(
      [task({ id: "a", title: "Birthday" }), task({ id: "b", title: "Bill", emoji: "💳" })],
      day,
    );
    expect(found.map((e) => e.title)).toEqual(["Birthday", "Bill"]);
  });
});

describe("eventAnchorOf", () => {
  it("prefers the schedule, falls back to the deadline", () => {
    expect(eventAnchorOf(task({ scheduledAt: 5, deadline: 9 }))).toBe(5);
    expect(eventAnchorOf(task({ scheduledAt: undefined, deadline: 9 }))).toBe(9);
    expect(eventAnchorOf(task({ scheduledAt: undefined, deadline: undefined }))).toBeUndefined();
  });
});

describe("repeatLabel", () => {
  it("is undefined for a one-off event", () => {
    expect(repeatLabel(undefined)).toBeUndefined();
  });

  it("uses the bare unit at interval 1", () => {
    expect(repeatLabel({ interval: 1, unit: "yearly" })).toBe("yearly");
    expect(repeatLabel({ interval: 1, unit: "monthly" })).toBe("monthly");
  });

  it("spells out a wider interval", () => {
    expect(repeatLabel({ interval: 6, unit: "monthly" })).toBe("every 6 months");
    expect(repeatLabel({ interval: 2, unit: "yearly" })).toBe("every 2 years");
  });
});

describe("eventAriaLabel", () => {
  it("says everything the collapsed emoji cannot", () => {
    const [oneOff] = eventsOnDay([task()], day);
    expect(eventAriaLabel(oneOff)).toBe("Priya's birthday, all-day event");

    const [routine] = eventsOnDay(
      [task({ repeat: { interval: 1, unit: "yearly" } })],
      startOfDay(new Date(2027, 7, 3).getTime()),
    );
    expect(eventAriaLabel(routine)).toBe("Priya's birthday, all-day event, repeats yearly");
  });
});

describe("EVENT_KINDS", () => {
  it("offers a birthday preset that defaults to repeating yearly", () => {
    const birthday = EVENT_KINDS.find((k) => k.id === "birthday");
    expect(birthday?.emoji).toBe("🎂");
    expect(birthday?.defaultRepeat).toEqual({ interval: 1, unit: "yearly" });
  });

  it("every preset's emoji is offered in the picker", () => {
    for (const kind of EVENT_KINDS) expect(kind.emoji.length).toBeGreaterThan(0);
  });
});
