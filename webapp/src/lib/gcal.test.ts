// @vitest-environment node
/* Two-way Google Calendar sync, planned as pure data so the decisions are
   testable without a network: what to create, update or delete in Google, and
   what to pull back into the vault. */
import { describe, expect, it } from "vitest";
import {
  bodyTimeMs,
  eventToTaskFields,
  forPatch,
  localTimeZone,
  googleSource,
  planCalendarSync,
  taskToEventBody,
  type GoogleEvent,
  type GoogleEventBody,
} from "./gcal";
import type { GoogleAccount, Task } from "./types";

const MIN = 60_000;
const DAY0 = new Date(2026, 6, 20, 0, 0, 0, 0).getTime(); // Mon 20 Jul 2026, local
const at = (hour: number, min = 0): number => DAY0 + hour * 3_600_000 + min * MIN;
const iso = (ms: number): string => new Date(ms).toISOString();

const account: GoogleAccount = { id: "acc1", email: "me@gmail.com", calendarId: "primary", enabled: true };

function task(patch: Partial<Task> & Pick<Task, "id">): Task {
  return { title: patch.id, status: "pending", priority: 2, tags: [], createdAt: 0, loggedMin: 0, ...patch };
}

function plan(tasks: Task[], events: GoogleEvent[], now = at(12)) {
  return planCalendarSync({
    tasks,
    events,
    account,
    now,
    windowStart: DAY0 - 30 * 86_400_000,
    windowEnd: DAY0 + 180 * 86_400_000,
  });
}

/** An event this app wrote, tagged with the task it mirrors. */
function ourEvent(taskId: string, patch: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: `ev-${taskId}`,
    status: "confirmed",
    summary: taskId,
    start: { dateTime: iso(at(9)) },
    end: { dateTime: iso(at(10)) },
    updated: iso(at(8)),
    extendedProperties: { private: { letsgoTaskId: taskId } },
    ...patch,
  };
}

describe("taskToEventBody", () => {
  it("maps a scheduled task onto a timed event carrying its task id", () => {
    const t = task({ id: "t1", title: "Write spec", description: "the API doc", scheduledAt: at(9), estimateMin: 90 });
    const body = taskToEventBody(t, [t]);
    expect(body.summary).toBe("Write spec");
    expect(body.description).toContain("the API doc");
    expect(bodyTimeMs(body.start)).toBe(at(9));
    expect(bodyTimeMs(body.end)).toBe(at(10, 30));
    expect(body.extendedProperties.private.letsgoTaskId).toBe("t1");
  });

  it("falls back to the default estimate so an event is never zero-length", () => {
    const t = task({ id: "t1", scheduledAt: at(9) });
    const body = taskToEventBody(t, [t]);
    expect(bodyTimeMs(body.end)).toBe(at(10)); // 60m default
  });

  it("names the parent chain of a nested task so the nesting survives in Google", () => {
    const root = task({ id: "root", title: "Website refresh" });
    const mid = task({ id: "mid", title: "Hero section", parentId: "root" });
    const leaf = task({ id: "leaf", title: "Pick a photo", parentId: "mid", scheduledAt: at(9), estimateMin: 30 });
    const body = taskToEventBody(leaf, [root, mid, leaf]);
    expect(body.description).toContain("Website refresh › Hero section");
  });

  it("turns a routine into a recurring event", () => {
    const t = task({ id: "t1", scheduledAt: at(9), estimateMin: 30, repeat: { interval: 2, unit: "weekly" } });
    expect(taskToEventBody(t, [t]).recurrence).toEqual(["RRULE:FREQ=WEEKLY;INTERVAL=2"]);
  });

  it("always carries a time zone — Google rejects a recurring event without one", () => {
    // Regression: routines failed to sync with "Missing time zone definition
    // for start time", because a bare UTC instant cannot anchor an RRULE.
    const routine = task({ id: "t1", scheduledAt: at(9), estimateMin: 30, repeat: { interval: 1, unit: "daily" } });
    const body = taskToEventBody(routine, [routine]);
    expect(body.start.timeZone).toBe(localTimeZone());
    expect(body.start.timeZone).toBeTruthy();
    expect(body.end.timeZone).toBe(body.start.timeZone);

    // One-off events carry it too, so a task that later gains a repeat rule
    // does not suddenly start failing.
    const oneOff = task({ id: "t2", scheduledAt: at(9), estimateMin: 30 });
    expect(taskToEventBody(oneOff, [oneOff]).start.timeZone).toBeTruthy();
  });
});

describe("eventToTaskFields", () => {
  it("reads a timed event into task fields", () => {
    const fields = eventToTaskFields(ourEvent("x", { summary: "Standup", start: { dateTime: iso(at(11)) }, end: { dateTime: iso(at(11, 30)) } }))!;
    expect(fields.title).toBe("Standup");
    expect(fields.scheduledAt).toBe(at(11));
    expect(fields.estimateMin).toBe(30);
  });

  it("reads an all-day event as a deadline, never as a timed block", () => {
    const fields = eventToTaskFields({ id: "e", summary: "Passport expires", start: { date: "2026-07-20" }, end: { date: "2026-07-21" } })!;
    expect(fields.scheduledAt).toBeUndefined();
    expect(fields.deadline).toBeGreaterThanOrEqual(DAY0);
    expect(fields.deadline).toBeLessThan(DAY0 + 86_400_000);
  });

  it("rejects a cancelled or untitled event", () => {
    expect(eventToTaskFields({ id: "e", status: "cancelled", summary: "gone", start: { dateTime: iso(at(9)) }, end: { dateTime: iso(at(10)) } })).toBeNull();
    expect(eventToTaskFields({ id: "e", start: { dateTime: iso(at(9)) }, end: { dateTime: iso(at(10)) } })).toBeNull();
  });

  it("reads a recurring event's rule back into a repeat", () => {
    const fields = eventToTaskFields(ourEvent("x", { recurrence: ["RRULE:FREQ=DAILY;INTERVAL=3"] }))!;
    expect(fields.repeat).toEqual({ interval: 3, unit: "daily" });
  });
});

describe("planCalendarSync — pushing out", () => {
  it("creates an event for a scheduled task that has never synced", () => {
    const t = task({ id: "t1", title: "Write spec", scheduledAt: at(9), estimateMin: 60 });
    const p = plan([t], []);
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0].task.id).toBe("t1");
    expect(p.updates).toHaveLength(0);
  });

  it("never pushes an unscheduled task", () => {
    expect(plan([task({ id: "t1" })], []).creates).toHaveLength(0);
  });

  it("pushes leaves, not their parents — a parent's window is its children", () => {
    const root = task({ id: "root", title: "Tree", scheduledAt: at(9), estimateMin: 120 });
    const leaf = task({ id: "leaf", title: "Leaf", parentId: "root", scheduledAt: at(9), estimateMin: 30 });
    const p = plan([root, leaf], []);
    expect(p.creates.map((c) => c.task.id)).toEqual(["leaf"]);
  });

  it("updates an event whose task changed locally", () => {
    const t = task({
      id: "t1", title: "Renamed", scheduledAt: at(9), estimateMin: 60,
      googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev-t1", updated: iso(at(8)) },
    });
    const p = plan([t], [ourEvent("t1")]); // remote still says summary "t1"
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0].eventId).toBe("ev-t1");
    expect(p.updates[0].body.summary).toBe("Renamed");
  });

  it("leaves an already-matching event completely alone", () => {
    const t = task({
      id: "t1", title: "t1", scheduledAt: at(9), estimateMin: 60,
      googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev-t1", updated: iso(at(8)) },
    });
    const p = plan([t], [ourEvent("t1")]);
    expect(p.creates).toHaveLength(0);
    expect(p.updates).toHaveLength(0);
    expect(p.localImports).toHaveLength(0);
    expect(p.deletes).toHaveLength(0);
  });

  it("deletes the event of a task that no longer exists locally", () => {
    const p = plan([], [ourEvent("gone")]);
    expect(p.deletes).toEqual(["ev-gone"]);
  });

  it("does not touch another account's events", () => {
    const other: GoogleAccount = { ...account, id: "acc2" };
    const t = task({
      id: "t1", title: "t1", scheduledAt: at(9), estimateMin: 60,
      googleEvent: { accountId: "acc2", calendarId: "primary", eventId: "ev-t1", updated: iso(at(8)) },
    });
    // Syncing acc1 sees a task linked to acc2: it is acc2's mirror, not ours.
    const p = planCalendarSync({ tasks: [t], events: [], account, now: at(12), windowStart: DAY0 - 86_400_000, windowEnd: DAY0 + 86_400_000 });
    expect(p.creates).toHaveLength(0);
    expect(p.updates).toHaveLength(0);
    expect(p.localDeletes).toHaveLength(0);
    void other;
  });
});

describe("planCalendarSync — pulling in", () => {
  it("imports a foreign event as a new task", () => {
    const ev: GoogleEvent = {
      id: "ev-x", status: "confirmed", summary: "Dentist",
      start: { dateTime: iso(at(15)) }, end: { dateTime: iso(at(16)) }, updated: iso(at(8)),
    };
    const p = plan([], [ev]);
    expect(p.localImports).toHaveLength(1);
    const t = p.localImports[0];
    expect(t.title).toBe("Dentist");
    expect(t.scheduledAt).toBe(at(15));
    expect(t.estimateMin).toBe(60);
    expect(t.source).toBe(googleSource(account));
    expect(t.googleEvent).toMatchObject({ accountId: "acc1", calendarId: "primary", eventId: "ev-x" });
  });

  it("applies a remote edit made in Google since the last sync", () => {
    const t = task({
      id: "t1", title: "Old name", scheduledAt: at(9), estimateMin: 60,
      googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev-t1", updated: iso(at(8)) },
    });
    // The event moved to 14:00 and was renamed, and Google says it changed AFTER
    // our last sync stamp — so Google wins.
    const remote = ourEvent("t1", {
      summary: "New name", start: { dateTime: iso(at(14)) }, end: { dateTime: iso(at(15)) }, updated: iso(at(11)),
    });
    const p = plan([t], [remote]);
    expect(p.updates).toHaveLength(0);
    expect(p.localImports).toHaveLength(0);          // the task already exists here
    expect(p.localPatches).toHaveLength(1);
    expect(p.localPatches[0].id).toBe("t1");
    expect(p.localPatches[0].fields).toMatchObject({ title: "New name", scheduledAt: at(14) });
  });

  it("a LOCKED task wins over a remote edit and is pushed back instead", () => {
    const t = task({
      id: "t1", title: "Locked slot", scheduledAt: at(9), estimateMin: 60, locked: true,
      googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev-t1", updated: iso(at(8)) },
    });
    const remote = ourEvent("t1", { summary: "Moved in Google", start: { dateTime: iso(at(14)) }, end: { dateTime: iso(at(15)) }, updated: iso(at(11)) });
    const p = plan([t], [remote]);
    expect(p.localImports).toHaveLength(0);       // never moved by a pull
    expect(p.localPatches).toHaveLength(0);
    expect(p.updates).toHaveLength(1);            // and the calendar is corrected
    expect(bodyTimeMs(p.updates[0].body.start)).toBe(at(9));
  });

  it("a pull touches ONLY the fields Google owns, never the local-only ones", () => {
    const t = task({
      id: "t1", title: "Old", scheduledAt: at(9), estimateMin: 60, priority: 0, tags: ["deep"], loggedMin: 25,
      googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev-t1", updated: iso(at(8)) },
    });
    const remote = ourEvent("t1", { summary: "New", start: { dateTime: iso(at(14)) }, end: { dateTime: iso(at(15)) }, updated: iso(at(11)) });
    const { fields } = plan([t], [remote]).localPatches[0];

    expect(fields.title).toBe("New");
    expect(fields.scheduledAt).toBe(at(14));
    // Absent from the patch entirely, so whatever these are when it lands wins.
    // A whole-task write here is what used to revert concurrent edits.
    for (const key of ["priority", "tags", "loggedMin", "status", "locked", "parentId"]) {
      expect(fields).not.toHaveProperty(key);
    }
  });

  it("deletes a local task whose event was cancelled in Google", () => {
    const t = task({
      id: "t1", scheduledAt: at(9), estimateMin: 60,
      googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev-t1", updated: iso(at(8)) },
    });
    const p = plan([t], [ourEvent("t1", { status: "cancelled", updated: iso(at(11)) })]);
    expect(p.localDeletes).toEqual(["t1"]);
  });

  it("deletes a local task whose event vanished from the listed window", () => {
    const t = task({
      id: "t1", scheduledAt: at(9), estimateMin: 60,
      googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev-t1", updated: iso(at(8)) },
    });
    expect(plan([t], []).localDeletes).toEqual(["t1"]);
  });

  it("NEVER deletes a linked task scheduled outside the listed window", () => {
    const t = task({
      id: "t1", scheduledAt: at(9) + 400 * 86_400_000, estimateMin: 60,
      googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev-t1", updated: iso(at(8)) },
    });
    const p = plan([t], []);
    expect(p.localDeletes).toEqual([]);
    expect(p.creates).toHaveLength(0); // and it is not re-created either
  });

  it("skips a pulled all-day event's timeline slot but keeps it as a deadline", () => {
    const ev: GoogleEvent = { id: "ev-a", status: "confirmed", summary: "Renew passport", start: { date: "2026-07-22" }, end: { date: "2026-07-23" }, updated: iso(at(8)) };
    const t = plan([], [ev]).localImports[0];
    expect(t.scheduledAt).toBeUndefined();
    expect(t.deadline).toBeDefined();
  });

  it("does not re-push a pulled all-day task as a timed event", () => {
    const t = task({
      id: "t1", title: "Renew passport", deadline: at(30),
      googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev-a", updated: iso(at(8)) },
    });
    const ev: GoogleEvent = { id: "ev-a", status: "confirmed", summary: "Renew passport", start: { date: "2026-07-22" }, end: { date: "2026-07-23" }, updated: iso(at(8)) };
    const p = plan([t], [ev]);
    expect(p.creates).toHaveLength(0);
    expect(p.updates).toHaveLength(0);
    expect(p.localDeletes).toHaveLength(0);
  });
});

/* ————— Regression: “‘Happy birthday!’ could not be updated in Google
   Calendar: Invalid start time.”

   Every sync reported the same handful of events, one banner each, forever.
   Two causes, both here: Google's own contact-birthday events are read-only
   and answer any write with that 400, and an all-day event mirrored as a task
   that still carried a `scheduledAt` was rewritten as a TIMED event on every
   pass — which Google rejects, because `events.patch` merges `start` key by
   key and the stored `date` survived alongside the new `dateTime`. ————— */
describe("all-day events never fight the calendar", () => {
  const birthday = (patch: Partial<GoogleEvent> = {}): GoogleEvent => ({
    id: "ev-bday",
    status: "confirmed",
    summary: "Happy birthday!",
    start: { date: "2026-07-20" },
    end: { date: "2026-07-21" },
    updated: iso(at(8)),
    recurrence: ["RRULE:FREQ=YEARLY"],
    eventType: "birthday",
    extendedProperties: { private: { letsgoTaskId: "t1" } },
    ...patch,
  });

  it("never writes to an event Google owns, however stale the mirror looks", () => {
    // The mirror even has a bogus timed slot — the old bug's fingerprint.
    const t = task({
      id: "t1",
      title: "Happy birthday!",
      scheduledAt: at(9),
      googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev-bday", updated: iso(at(8)) },
    });
    const p = plan([t], [birthday()]);
    expect(p.updates).toHaveLength(0);
    expect(p.deletes).toHaveLength(0);
    // It still pulls: the event is readable, just not writable.
    expect(p.localPatches).toHaveLength(1);
    expect(p.localPatches[0].fields.allDay).toBe(true);
    expect(p.localPatches[0].fields.scheduledAt).toBeUndefined();
  });

  it("clears the stale slot when a mirrored event becomes all-day in Google", () => {
    const t = task({
      id: "t1",
      title: "Anniversary",
      scheduledAt: at(9),
      estimateMin: 60,
      googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev-bday", updated: iso(at(8)) },
    });
    const remote = birthday({ eventType: "default", summary: "Anniversary", updated: iso(at(11)) });
    const p = plan([t], [remote]);
    expect(p.updates).toHaveLength(0);
    const fields = p.localPatches[0].fields;
    expect(fields.allDay).toBe(true);
    expect(fields.scheduledAt).toBeUndefined();
    expect(fields.deadline).toBeGreaterThan(DAY0);
  });

  it("writes an all-day task back as a date event, with the end day exclusive", () => {
    const t = task({ id: "t1", title: "Diwali", allDay: true, emoji: "🪔", deadline: at(23, 59) });
    const body = taskToEventBody(t, [t]);
    expect(body.start.date).toBe("2026-07-20");
    expect(body.end.date).toBe("2026-07-21");
    // The key it does NOT use is stated as null, which is what tells a PATCH to
    // clear it — leaving both set is the 400 the whole bug came from.
    expect(body.start.dateTime).toBeNull();
    expect(body.end.dateTime).toBeNull();
  });

  it("states the unused key as null on a timed event too", () => {
    const t = task({ id: "t1", scheduledAt: at(9), estimateMin: 30 });
    const body = taskToEventBody(t, [t]);
    expect(body.start.date).toBeNull();
    expect(body.start.dateTime).toBeTruthy();
  });

  it("leaves an all-day mirror alone once both sides agree", () => {
    const t = task({
      id: "t1",
      title: "Happy birthday!",
      allDay: true,
      emoji: "🎂",
      deadline: DAY0 + 86_400_000 - 60_000,
      repeat: { interval: 1, unit: "yearly" },
      googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev-bday", updated: iso(at(8)) },
    });
    const remote = birthday({ eventType: "default", recurrence: ["RRULE:FREQ=YEARLY;INTERVAL=1"] });
    expect(plan([t], [remote]).updates).toHaveLength(0);
  });

  it("pushes a local all-day event that has only a deadline", () => {
    const t = task({ id: "t1", title: "Diwali", allDay: true, emoji: "🪔", deadline: at(23, 59) });
    const p = plan([t], []);
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0].body.start.date).toBe("2026-07-20");
  });

  it("imports an all-day event as an event, glyph and all", () => {
    const p = plan([], [birthday({ extendedProperties: undefined })]);
    expect(p.localImports).toHaveLength(1);
    expect(p.localImports[0].allDay).toBe(true);
    expect(p.localImports[0].emoji).toBe("🎂");
    expect(p.localImports[0].scheduledAt).toBeUndefined();
  });
});

describe("reminder lead time", () => {
  it("defaults to leaving Google's own default alone", () => {
    const t = task({ id: "t1", scheduledAt: at(9) });
    expect(taskToEventBody(t, [t]).reminders).toEqual({ useDefault: true });
  });

  it("states the account-wide lead time as a popup override", () => {
    const t = task({ id: "t1", scheduledAt: at(9) });
    expect(taskToEventBody(t, [t], { reminder: 5 }).reminders)
      .toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 5 }] });
  });

  it("lets a task override the account default, zero included", () => {
    const t = task({ id: "t1", scheduledAt: at(9), reminderMinutes: 0 });
    expect(taskToEventBody(t, [t], { reminder: 30 }).reminders)
      .toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 0 }] });
  });

  it("silences an event with no reminder at all", () => {
    const t = task({ id: "t1", scheduledAt: at(9), reminderMinutes: "none" });
    expect(taskToEventBody(t, [t]).reminders).toEqual({ useDefault: false, overrides: [] });
  });

  it("pushes a changed lead time, and only a changed one", () => {
    const link = { accountId: "acc1", calendarId: "primary", eventId: "ev-t1", updated: iso(at(8)) };
    const t = task({ id: "t1", scheduledAt: at(9), estimateMin: 60, googleEvent: link });
    const remote = ourEvent("t1", { reminders: { useDefault: false, overrides: [{ method: "popup" as const, minutes: 30 }] } });

    expect(planCalendarSync({ tasks: [t], events: [remote], account, now: at(12), reminder: 30, windowStart: DAY0 - 86_400_000, windowEnd: DAY0 + 86_400_000 }).updates).toHaveLength(0);
    const changed = planCalendarSync({ tasks: [t], events: [remote], account, now: at(12), reminder: 5, windowStart: DAY0 - 86_400_000, windowEnd: DAY0 + 86_400_000 }).updates;
    expect(changed).toHaveLength(1);
    expect(changed[0].body.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 5 }] });
  });
});

describe("forPatch", () => {
  const base = (reminders: unknown): GoogleEventBody => ({
    summary: "t",
    start: { dateTime: iso(at(9)), date: null },
    end: { dateTime: iso(at(10)), date: null },
    extendedProperties: { private: {} },
    reminders: reminders as never,
  });

  it("clears stale overrides when the body wants Google's default", () => {
    expect(forPatch(base({ useDefault: true })).reminders).toEqual({ useDefault: true, overrides: [] });
  });

  it("leaves an explicit-override body untouched", () => {
    const body = base({ useDefault: false, overrides: [{ method: "popup", minutes: 5 }] });
    expect(forPatch(body)).toBe(body);
  });

  it("leaves a silenced body untouched", () => {
    const body = base({ useDefault: false, overrides: [] });
    expect(forPatch(body)).toBe(body);
  });

  it("leaves a body with no reminders untouched", () => {
    const body = base(undefined);
    expect(forPatch(body)).toBe(body);
  });
});
