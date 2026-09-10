// @vitest-environment node
/* "I wake at 5, opened the app at 9, and the 7:00 task is still sitting in the
   past." The day-start prompt asks what time today really begins and re-packs
   the day's remaining UNLOCKED tasks from there, in their planned order,
   honouring estimates, the break, work hours and locked appointments. */
import { describe, expect, it } from "vitest";
import { planDayStart, planDayStartOutcome } from "./estimate";
import { dayStartAnswered, reducer, shouldAskDayStart } from "./store";
import type { AppState, Task } from "./types";

const MIN = 60_000;
const DAY0 = new Date(2026, 6, 20, 0, 0, 0, 0).getTime(); // Mon 20 Jul 2026, local
const at = (hour: number, min = 0): number => DAY0 + hour * 3_600_000 + min * MIN;

function task(patch: Partial<Task> & Pick<Task, "id">): Task {
  return { title: patch.id, status: "pending", priority: 2, tags: [], createdAt: 0, loggedMin: 0, ...patch };
}

describe("planDayStart", () => {
  it("re-packs the day's tasks from the chosen time, in their planned order", () => {
    const tasks = [
      task({ id: "b", scheduledAt: at(8), estimateMin: 60 }),
      task({ id: "a", scheduledAt: at(7), estimateMin: 30 }),
    ];
    const plan = planDayStart(tasks, at(9), 5)!;
    const by = (id: string) => plan.tasks.find((t) => t.id === id)!.scheduledAt;
    expect(by("a")).toBe(at(9));           // earliest planned goes first
    expect(by("b")).toBe(at(9, 35));       // 30m + 5m break
    expect(plan.movedCount).toBe(2);
  });

  it("leaves locked tasks exactly where they are and routes around them", () => {
    const tasks = [
      task({ id: "a", scheduledAt: at(7), estimateMin: 90 }),
      task({ id: "standup", title: "Standup", scheduledAt: at(10), estimateMin: 60, locked: true }),
      task({ id: "b", scheduledAt: at(13), estimateMin: 30 }),
    ];
    const plan = planDayStart(tasks, at(9), 5)!;
    const by = (id: string) => plan.tasks.find((t) => t.id === id)!.scheduledAt;
    expect(by("standup")).toBe(at(10));    // immovable
    // "a" is 90m: 9:00–10:30 would swallow the lock, so it waits it out.
    expect(by("a")).toBe(at(11, 5));
    expect(by("b")).toBe(at(12, 40));      // 11:05 + 90m + 5m
    expect(plan.blockedBy?.id).toBe("standup");
  });

  it("never schedules a task within the break of a locked one, on either side", () => {
    const tasks = [
      task({ id: "a", scheduledAt: at(7), estimateMin: 50 }),
      task({ id: "lock", scheduledAt: at(10), estimateMin: 30, locked: true }),
    ];
    const plan = planDayStart(tasks, at(9), 5)!;
    // 9:00 + 50m ends 9:50 — only 10 minutes before the lock, which is fine
    // (>= the 5m break), so it stays.
    expect(plan.tasks.find((t) => t.id === "a")!.scheduledAt).toBe(at(9));

    const tight = planDayStart(
      [task({ id: "a", scheduledAt: at(7), estimateMin: 58 }), tasks[1]],
      at(9),
      5,
    )!;
    // 9:00 + 58m ends 9:58 — 2 minutes before the lock, closer than the break.
    expect(tight.tasks.find((t) => t.id === "a")!.scheduledAt).toBe(at(10, 35));
  });

  it("skips done, skipped and routine tasks, and tasks on other days", () => {
    const tasks = [
      task({ id: "done", status: "done", scheduledAt: at(7), estimateMin: 30 }),
      task({ id: "skipped", status: "skipped", scheduledAt: at(7, 30), estimateMin: 30 }),
      task({ id: "routine", scheduledAt: at(8), estimateMin: 30, repeat: { interval: 1, unit: "daily" } }),
      task({ id: "tomorrow", scheduledAt: at(30), estimateMin: 30 }),
      task({ id: "move", scheduledAt: at(8, 30), estimateMin: 30 }),
    ];
    const plan = planDayStart(tasks, at(9), 5)!;
    const by = (id: string) => plan.tasks.find((t) => t.id === id)!.scheduledAt;
    expect(by("done")).toBe(at(7));
    expect(by("skipped")).toBe(at(7, 30));
    expect(by("routine")).toBe(at(8));
    expect(by("tomorrow")).toBe(at(30));
    expect(by("move")).toBe(at(9));
    expect(plan.movedCount).toBe(1);
  });

  it("packs leaves and rolls their parent's window up to match", () => {
    const tasks = [
      task({ id: "root", scheduledAt: at(7), estimateMin: 120 }),
      task({ id: "k1", parentId: "root", scheduledAt: at(7), estimateMin: 30 }),
      task({ id: "k2", parentId: "root", scheduledAt: at(7, 35), estimateMin: 45 }),
    ];
    const plan = planDayStart(tasks, at(9), 5)!;
    const root = plan.tasks.find((t) => t.id === "root")!;
    expect(plan.tasks.find((t) => t.id === "k1")!.scheduledAt).toBe(at(9));
    expect(plan.tasks.find((t) => t.id === "k2")!.scheduledAt).toBe(at(9, 35));
    expect(root.scheduledAt).toBe(at(9));
    expect(root.estimateMin).toBe(80); // 9:00 → 10:20
  });

  it("confines the re-pack to the work-hours window", () => {
    const tasks = [
      task({ id: "a", scheduledAt: at(7), estimateMin: 60 }),
      task({ id: "b", scheduledAt: at(8), estimateMin: 60 }),
    ];
    const plan = planDayStart(tasks, at(9), 5, { startMin: 9 * 60, endMin: 10 * 60 + 30 })!;
    expect(plan.tasks.find((t) => t.id === "a")!.scheduledAt).toBe(at(9));
    // b would run 10:05–11:05, past the 10:30 close, so it rolls to tomorrow.
    expect(plan.tasks.find((t) => t.id === "b")!.scheduledAt).toBe(at(9) + 24 * 3_600_000);
  });

  it("returns null when the day holds nothing to move", () => {
    expect(planDayStart([], at(9), 5)).toBeNull();
    expect(planDayStart([task({ id: "a", scheduledAt: at(9), estimateMin: 30 })], at(9), 5)).toBeNull();
  });
});

/* ————— the reducer action + the once-a-day gate ————— */

function base(patch: Partial<AppState> = {}): AppState {
  return {
    tasks: [], blocks: [], folders: [], notes: [], mind: [], mindTitle: "", sessions: [], books: [], habits: [],
    timer: { mode: "pomodoro", baseSec: 0, targetSec: 1500, pomodorosDone: 0 },
    quickTimers: [],
    settings: {
      theme: "light", accent: "violet", density: "cozy", statusColors: true, reduceMotion: false,
      notifications: false, sounds: false, weekStart: 0, hourFormat: "24",
      workHours: { enabled: false, startMin: 360, endMin: 1260 },
      sync: { enabled: false, url: "", username: "", password: "" },
      plugins: { todo: true, timer: true, notes: true, mindmap: true, dashboard: true, library: true, habits: true },
      sidebarCollapsed: false, landingView: "todo", todoDefaultView: "last", scheduleReminders: true,
    },
    ...patch,
  };
}

describe("dayStart action", () => {
  it("moves the day's unlocked tasks and records the day as answered", () => {
    const state = base({ tasks: [task({ id: "a", scheduledAt: at(7), estimateMin: 30 })] });
    const next = reducer(state, { type: "dayStart", from: at(9) });
    expect(next.tasks[0].scheduledAt).toBe(at(9));
    expect(next.settings.lastDayStartDay).toBe("2026-07-20");
    expect(next.notice?.text).toContain("9");
  });

  it("records the day even when nothing needed moving, so it asks only once", () => {
    const state = base({ tasks: [task({ id: "a", scheduledAt: at(9), estimateMin: 30 })] });
    const next = reducer(state, { type: "dayStart", from: at(9) });
    expect(next.settings.lastDayStartDay).toBe("2026-07-20");
    expect(next.tasks[0].scheduledAt).toBe(at(9));
    // Confirmed out loud: a silent dismissal is what made the dialog read as
    // broken on a day where nothing was eligible to move.
    expect(next.notice?.text).toContain("already fits");
  });

  it("accepts the answer on a day of locked appointments, and says why nothing moved", () => {
    const state = base({ tasks: [task({ id: "a", scheduledAt: at(7), estimateMin: 30, locked: true })] });
    const next = reducer(state, { type: "dayStart", from: at(10) });
    expect(next.settings.lastDayStartDay).toBe("2026-07-20");
    expect(next.tasks[0].scheduledAt).toBe(at(7));   // the lock still holds
    expect(next.notice?.text).toContain("locked");
  });

  it("keeps a locked task put and says which one got in the way", () => {
    const state = base({
      tasks: [
        task({ id: "a", scheduledAt: at(7), estimateMin: 90 }),
        task({ id: "lock", title: "Standup", scheduledAt: at(10), estimateMin: 60, locked: true }),
      ],
    });
    const next = reducer(state, { type: "dayStart", from: at(9) });
    expect(next.tasks.find((t) => t.id === "lock")!.scheduledAt).toBe(at(10));
    expect(next.tasks.find((t) => t.id === "a")!.scheduledAt).toBe(at(11, 5));
    expect(next.notice?.text).toContain("Standup");
  });

  it("skipDayStart records the day without touching a single task", () => {
    const state = base({ tasks: [task({ id: "a", scheduledAt: at(7), estimateMin: 30 })] });
    const next = reducer(state, { type: "skipDayStart", day: at(9) });
    expect(next.tasks[0].scheduledAt).toBe(at(7));
    expect(next.settings.lastDayStartDay).toBe("2026-07-20");
  });
});

describe("googleSyncApplied", () => {
  const google = { clientId: "cid", autoSync: true, accounts: [{ id: "acc1", email: "me@gmail.com", calendarId: "primary", enabled: true }] };
  const withGoogle = (tasks: Task[]) => base({ tasks, settings: { ...base().settings, google } });

  it("patches linked tasks, adds imports and stamps the account's sync time", () => {
    const existing = task({ id: "a", title: "Before", scheduledAt: at(9), estimateMin: 30 });
    const state = withGoogle([existing]);
    const next = reducer(state, {
      type: "googleSyncApplied",
      accountId: "acc1",
      at: at(12),
      patches: [{ id: "a", fields: { title: "After" } }],
      imports: [task({ id: "pulled", title: "Dentist", scheduledAt: at(15) })],
      deletes: [],
    });
    expect(next.tasks.find((t) => t.id === "a")!.title).toBe("After");
    expect(next.tasks.find((t) => t.id === "pulled")!.title).toBe("Dentist");
    expect(next.settings.google!.accounts[0].lastSyncAt).toBe(at(12));
  });

  it("a patch leaves every field it does not name alone", () => {
    // The revert bug: a sync that started before an edit landed afterwards and
    // wrote its whole stale snapshot back. Patches carry only what changed, so
    // an edit made mid-flight survives.
    const edited = task({ id: "a", title: "Renamed while syncing", scheduledAt: at(16), estimateMin: 45, priority: 0 });
    const next = reducer(withGoogle([edited]), {
      type: "googleSyncApplied",
      accountId: "acc1",
      at: at(12),
      patches: [{ id: "a", fields: { googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev1" } } }],
      imports: [],
      deletes: [],
    });
    const after = next.tasks[0];
    expect(after.title).toBe("Renamed while syncing");
    expect(after.scheduledAt).toBe(at(16));
    expect(after.estimateMin).toBe(45);
    expect(after.priority).toBe(0);
    expect(after.googleEvent!.eventId).toBe("ev1");
  });

  it("ignores a patch for a task that no longer exists", () => {
    const next = reducer(withGoogle([task({ id: "keep" })]), {
      type: "googleSyncApplied",
      accountId: "acc1",
      at: at(12),
      patches: [{ id: "deleted-meanwhile", fields: { title: "ghost" } }],
      imports: [],
      deletes: [],
    });
    expect(next.tasks.map((t) => t.id)).toEqual(["keep"]);
  });

  it("removes a task whose event was deleted, along with its subtasks", () => {
    const parent = task({ id: "p", scheduledAt: at(9) });
    const child = task({ id: "c", parentId: "p", scheduledAt: at(9) });
    const other = task({ id: "keep" });
    const next = reducer(withGoogle([parent, child, other]), {
      type: "googleSyncApplied", accountId: "acc1", at: at(12), patches: [], imports: [], deletes: ["p"],
    });
    expect(next.tasks.map((t) => t.id)).toEqual(["keep"]);
  });

  it("never lets a pull move a locked task's times", () => {
    const locked = task({ id: "L", title: "Standup", scheduledAt: at(10), estimateMin: 60, locked: true });
    const next = reducer(withGoogle([locked]), {
      type: "googleSyncApplied",
      accountId: "acc1",
      at: at(12),
      // A rogue patch trying to move the appointment to 14:00.
      patches: [{ id: "L", fields: { title: "Renamed", scheduledAt: at(14) } }],
      imports: [],
      deletes: [],
    });
    const after = next.tasks[0];
    expect(after.scheduledAt).toBe(at(10)); // time held
    expect(after.title).toBe("Renamed");    // non-scheduling fields still apply
  });

  it("a delete wins over a patch or import naming the same task", () => {
    const t = task({ id: "a", scheduledAt: at(9) });
    const next = reducer(withGoogle([t]), {
      type: "googleSyncApplied",
      accountId: "acc1",
      at: at(12),
      patches: [{ id: "a", fields: { title: "zombie" } }],
      imports: [t],
      deletes: ["a"],
    });
    expect(next.tasks).toEqual([]);
  });
});

describe("shouldAskDayStart", () => {
  const withDay = (day?: string, on = true) =>
    base({ settings: { ...base().settings, lastDayStartDay: day, dayStartPrompt: on } });

  it("asks on the first open of a new day", () => {
    expect(shouldAskDayStart(withDay("2026-07-19"), at(9))).toBe(true);
  });

  it("stays quiet once the day has been answered", () => {
    expect(shouldAskDayStart(withDay("2026-07-20"), at(9))).toBe(false);
  });

  it("asks on a vault that has never answered", () => {
    expect(shouldAskDayStart(withDay(undefined), at(9))).toBe(true);
  });

  it("stays quiet when the prompt is switched off", () => {
    expect(shouldAskDayStart(withDay("2026-07-19", false), at(9))).toBe(false);
  });

  it("dayStartAnswered reports the day key it stores", () => {
    expect(dayStartAnswered(at(9))).toBe("2026-07-20");
  });
});

/* ————— Regression: "when does today start" did nothing on a day of
   appointments. `planDayStart` returns null whenever no task is eligible to
   move, and the prompt disabled its confirm button on exactly that — so a day
   whose tasks are ALL locked (precisely a day you might be starting late) had
   no way to answer the question at all. The reason is now reported instead of
   collapsing into one null. ————— */
describe("planDayStartOutcome", () => {
  it("reports a real re-pack", () => {
    const tasks = [task({ id: "a", scheduledAt: at(7), estimateMin: 60 })];
    const out = planDayStartOutcome(tasks, at(9), 0);
    expect(out.kind).toBe("repacked");
    if (out.kind === "repacked") expect(out.plan.movedCount).toBe(1);
  });

  it("says a day of locked appointments is pinned, not empty", () => {
    const tasks = [
      task({ id: "a", scheduledAt: at(7), estimateMin: 60, locked: true }),
      task({ id: "b", scheduledAt: at(11), estimateMin: 30, locked: true }),
    ];
    const out = planDayStartOutcome(tasks, at(9), 0);
    expect(out.kind).toBe("pinned");
    if (out.kind === "pinned") expect(out.locked.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("counts routines as pinned too — their time is a recurrence anchor", () => {
    const tasks = [task({ id: "a", scheduledAt: at(7), estimateMin: 60, repeat: { interval: 1, unit: "daily" } })];
    const out = planDayStartOutcome(tasks, at(9), 0);
    expect(out.kind).toBe("pinned");
    if (out.kind === "pinned") expect(out.routines.map((x) => x.id)).toEqual(["a"]);
  });

  it("separates an empty day from a plan that already fits", () => {
    expect(planDayStartOutcome([], at(9), 0).kind).toBe("empty");
    const fits = [task({ id: "a", scheduledAt: at(9), estimateMin: 60 })];
    expect(planDayStartOutcome(fits, at(9), 0).kind).toBe("alreadyFits");
  });
});
