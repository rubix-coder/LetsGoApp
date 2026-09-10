// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deriveParentStatus, importMarkdown, newTask, reducer } from "./store";
import { packSubtree, reflowFrom, rootAncestorId, snapIntoWindow, type WorkWindow } from "./estimate";
import { occurrenceDateKey } from "./occurrence";
import { startOfDay } from "./dates";
import type { AppState, Task } from "./types";

function base(patch: Partial<AppState> = {}): AppState {
  return {
    tasks: [],
    blocks: [],
    folders: [],
    notes: [],
    mind: [],
    mindTitle: "map",
    sessions: [],
    books: [],
    habits: [],
    timer: { mode: "pomodoro", baseSec: 0, targetSec: 1500, pomodorosDone: 0 },
    quickTimers: [],
    settings: {
      theme: "light", accent: "violet", density: "cozy", statusColors: true, reduceMotion: false, notifications: false, sounds: false, weekStart: 0, hourFormat: "24",
      workHours: { enabled: false, startMin: 360, endMin: 1260 },
      sync: { enabled: false, url: "/webdav", username: "", password: "" },
      plugins: { todo: true, timer: true, notes: true, mindmap: true, dashboard: true, library: true, habits: true },
      sidebarCollapsed: false, landingView: "todo", todoDefaultView: "last", scheduleReminders: true,
    },
    ...patch,
  };
}

describe("markdown import sync (desktop parity)", () => {
  const md = "- [ ] Website refresh\n    - [x] Audit pages\n    - [ ] New hero\n- [block]lunch [1200:1300][1D]\n";

  it("creates nested tasks and time blocks from bullets", () => {
    const s = importMarkdown(base(), md, "plan.md");
    const parent = s.tasks.find((t) => t.title === "Website refresh")!;
    const child = s.tasks.find((t) => t.title === "Audit pages")!;
    expect(child.parentId).toBe(parent.id);
    expect(child.status).toBe("done");
    expect(s.tasks.every((t) => t.source === "plan.md")).toBe(true);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0]).toMatchObject({ title: "lunch", durationMin: 60, source: "plan.md" });
  });

  it("re-import updates by (source, title) and DELETES vanished lines", () => {
    const s1 = importMarkdown(base(), md, "plan.md");
    const heroId = s1.tasks.find((t) => t.title === "New hero")!.id;
    const s2 = importMarkdown(s1, "- [ ] Website refresh\n    - [x] New hero\n", "plan.md");
    expect(s2.tasks.find((t) => t.id === heroId)?.status).toBe("done"); // updated, same task
    expect(s2.tasks.find((t) => t.title === "Audit pages")).toBeUndefined(); // line left the file
    expect(s2.blocks).toHaveLength(0); // block line left too
    expect(s2.tasks.filter((t) => t.title === "New hero")).toHaveLength(1); // no duplicate
  });

  it("sending from a note seeds backlinks on NEW tasks only", () => {
    const s1 = importMarkdown(base(), "- [ ] prep slides\n", "Graphs note", true);
    expect(s1.tasks[0].description).toBe("From [[Graphs note]]");
    // Re-send after the user edited the task's description: it must survive.
    const edited = { ...s1, tasks: s1.tasks.map((t) => ({ ...t, description: "my own words" })) };
    const s2 = importMarkdown(edited, "- [ ] prep slides\n", "Graphs note", true);
    expect(s2.tasks[0].description).toBe("my own words");
  });

  it("source-less imports never delete", () => {
    const s1 = importMarkdown(base(), "- keep me\n");
    const s2 = importMarkdown(s1, "- another\n");
    expect(s2.tasks.map((t) => t.title).sort()).toEqual(["another", "keep me"]);
  });
});

describe("derived parent status (desktop 0.29)", () => {
  const mk = (patch: Partial<Task>) => newTask({ title: "t", ...patch });

  it("in_progress only if a child is; all-pending stays pending; all-done is done", () => {
    const parent = mk({ title: "P" });
    const a = mk({ title: "a", parentId: parent.id, status: "done", completedAt: 5 });
    const b = mk({ title: "b", parentId: parent.id, status: "skipped" });
    // A done + a skipped child, but none in progress — nobody is actively working it.
    expect(deriveParentStatus([parent, a, b]).find((t) => t.id === parent.id)?.status).toBe("pending");
    // Freshly imported subtree, every child pending → parent stays pending, not in_progress.
    const c = mk({ title: "c", parentId: parent.id });
    const d = mk({ title: "d", parentId: parent.id });
    expect(deriveParentStatus([parent, c, d]).find((t) => t.id === parent.id)?.status).toBe("pending");
    // One child actually in progress → parent is in_progress.
    expect(deriveParentStatus([parent, { ...c, status: "in_progress" }, d]).find((t) => t.id === parent.id)?.status).toBe("in_progress");
    // Every child done → parent done, carrying the latest completion time.
    const allDone = deriveParentStatus([parent, { ...a }, { ...b, status: "done", completedAt: 9 }]);
    expect(allDone.find((t) => t.id === parent.id)).toMatchObject({ status: "done", completedAt: 9 });
  });

  it("setStatus on a parent is a no-op — parents derive", () => {
    const parent = mk({ title: "P" });
    const child = mk({ title: "c", parentId: parent.id });
    const s = reducer(base({ tasks: deriveParentStatus([parent, child]) }), { type: "setStatus", id: parent.id, status: "done" });
    expect(s.tasks.find((t) => t.id === parent.id)?.status).not.toBe("done");
  });
});

describe("estimate-driven packing (desktop 0.50)", () => {
  it("packs a subtree back-to-back and derives the parent window", () => {
    const root = newTask({ title: "root", scheduledAt: 1_000_000, estimateMin: 999 });
    const a = newTask({ title: "a", parentId: root.id, estimateMin: 30 });
    const b = newTask({ title: "b", parentId: root.id, estimateMin: 45 });
    const packed = packSubtree([root, a, b], root.id, root.scheduledAt!);
    expect(packed.get(a.id)).toEqual({ start: 1_000_000, end: 1_000_000 + 30 * 60_000 });
    expect(packed.get(b.id)!.start).toBe(packed.get(a.id)!.end);
    expect(packed.get(root.id)).toEqual({ start: 1_000_000, end: 1_000_000 + 75 * 60_000 });
    expect(rootAncestorId([root, a, b], b.id)).toBe(root.id);
  });

  it("editing an estimate re-packs live through the reducer", () => {
    const root = newTask({ title: "root", scheduledAt: 1_000_000 });
    const a = newTask({ title: "a", parentId: root.id, estimateMin: 30 });
    const b = newTask({ title: "b", parentId: root.id, estimateMin: 45 });
    const s = reducer(base({ tasks: [root, a, b] }), { type: "upsertTask", task: { ...a, estimateMin: 60 } });
    const packedB = s.tasks.find((t) => t.id === b.id)!;
    // Through the reducer the settings break applies (default 5 min), so b
    // starts 60 + 5 after the anchor rather than flush against a.
    expect(packedB.scheduledAt).toBe(1_000_000 + 65 * 60_000);
    expect(s.tasks.find((t) => t.id === root.id)!.estimateMin).toBe(110); // 60 + 5 break + 45
  });

  it("honors the configured break, including 0 for edge-to-edge packing", () => {
    const build = (breakMin?: number) => {
      const root = newTask({ title: "root", scheduledAt: 1_000_000 });
      const a = newTask({ title: "a", parentId: root.id, estimateMin: 30 });
      const b = newTask({ title: "b", parentId: root.id, estimateMin: 45 });
      const settings = { ...base().settings, breakMin };
      const s = reducer(base({ tasks: [root, a, b], settings }), { type: "upsertTask", task: { ...a, estimateMin: 60 } });
      return s.tasks.find((t) => t.id === b.id)!.scheduledAt;
    };
    expect(build(0)).toBe(1_000_000 + 60 * 60_000);   // flush against a
    expect(build(15)).toBe(1_000_000 + 75 * 60_000);  // 60 + 15
    expect(build(undefined)).toBe(1_000_000 + 65 * 60_000); // older vaults adopt the 5-minute default
  });

  it("dragging a parent shifts the whole subtree by the delta", () => {
    const root = newTask({ title: "root", scheduledAt: 1_000_000 });
    const a = newTask({ title: "a", parentId: root.id, scheduledAt: 1_000_000, estimateMin: 30 });
    const s = reducer(base({ tasks: [root, a] }), { type: "scheduleTask", id: root.id, at: 2_000_000 });
    expect(s.tasks.find((t) => t.id === a.id)!.scheduledAt).toBe(2_000_000);
  });
});

describe("work-hours window (6:00–21:00 auto-scheduling)", () => {
  const win: WorkWindow = { startMin: 6 * 60, endMin: 21 * 60 };
  const on = { workHours: { enabled: true, startMin: 6 * 60, endMin: 21 * 60 } };
  const day = (d: number, h: number, m = 0) => new Date(2026, 6, d, h, m, 0, 0).getTime();

  it("lifts a pre-opening start up to the opening time", () => {
    expect(snapIntoWindow(day(20, 5, 0), 60, win)).toBe(day(20, 6, 0));
  });

  it("rolls a block that would cross closing to the next day's opening", () => {
    expect(snapIntoWindow(day(20, 20, 30), 60, win)).toBe(day(21, 6, 0));
  });

  it("rolls a start already past closing to the next day", () => {
    expect(snapIntoWindow(day(20, 22, 0), 30, win)).toBe(day(21, 6, 0));
  });

  it("places a task longer than the window as-is rather than looping", () => {
    const start = day(20, 6, 0);
    expect(snapIntoWindow(start, 20 * 60, win)).toBe(start); // 20h > 15h window
  });

  it("packs a subtree inside the window, overflowing leaves to the next day", () => {
    const root = newTask({ title: "root", scheduledAt: day(20, 20, 0) });
    const a = newTask({ title: "a", parentId: root.id, estimateMin: 60 });
    const b = newTask({ title: "b", parentId: root.id, estimateMin: 30 });
    const packed = packSubtree([root, a, b], root.id, root.scheduledAt!, win);
    expect(packed.get(a.id)!.start).toBe(day(20, 20, 0)); // 20:00–21:00 fits
    expect(packed.get(b.id)!.start).toBe(day(21, 6, 0)); // rolls to next morning
    expect(packed.get(root.id)!.start).toBe(day(20, 20, 0)); // parent spans both days
  });

  it("re-packs through the reducer honoring the settings window", () => {
    const root = newTask({ title: "root", scheduledAt: day(20, 20, 0) });
    const a = newTask({ title: "a", parentId: root.id, estimateMin: 60 });
    const b = newTask({ title: "b", parentId: root.id, estimateMin: 60 });
    // The estimate must actually change: same-value writes are metadata-only
    // edits now and deliberately skip the re-pack (manual placements survive).
    const s = reducer(base({ tasks: [root, a, b], settings: { ...base().settings, ...on } }),
      { type: "upsertTask", task: { ...a, estimateMin: 45 } });
    expect(s.tasks.find((t) => t.id === b.id)!.scheduledAt).toBe(day(21, 6, 0));
  });
});

describe("divide & conquer reflow (drag a subtask, move the rest)", () => {
  const win: WorkWindow = { startMin: 6 * 60, endMin: 21 * 60 };
  const on = { workHours: { enabled: true, startMin: 6 * 60, endMin: 21 * 60 } };
  const day = (d: number, h: number, m = 0) => new Date(2026, 6, d, h, m, 0, 0).getTime();

  // Four 1-hour subtasks; the first is already done. Grab the third and drop it
  // on tomorrow morning: it and the fourth move; the done and earlier ones stay.
  function tree() {
    const root = newTask({ title: "root", scheduledAt: day(20, 6) });
    const a = newTask({ title: "a", parentId: root.id, scheduledAt: day(20, 6), estimateMin: 60, status: "done" });
    const b = newTask({ title: "b", parentId: root.id, scheduledAt: day(20, 7), estimateMin: 60 });
    const c = newTask({ title: "c", parentId: root.id, scheduledAt: day(20, 8), estimateMin: 60 });
    const d = newTask({ title: "d", parentId: root.id, scheduledAt: day(20, 9), estimateMin: 60 });
    return { root, a, b, c, d };
  }

  it("moves the dragged leaf and everything after it, keeping earlier/done put", () => {
    const { root, a, b, c, d } = tree();
    const out = reflowFrom([root, a, b, c, d], c.id, day(21, 6), win)!;
    const at = (id: string) => out.find((t) => t.id === id)!.scheduledAt;
    expect(at(a.id)).toBe(day(20, 6)); // done — fixed
    expect(at(b.id)).toBe(day(20, 7)); // before the drag — unchanged
    expect(at(c.id)).toBe(day(21, 6)); // dragged — lands on the drop
    expect(at(d.id)).toBe(day(21, 7)); // follows within the window
  });

  it("returns null for a root (roots keep the whole-tree shift path)", () => {
    const { root, a, b, c, d } = tree();
    expect(reflowFrom([root, a, b, c, d], root.id, day(21, 6), win)).toBeNull();
  });

  it("reflows through the reducer when a subtask is dragged", () => {
    const { root, a, b, c, d } = tree();
    const s = reducer(base({ tasks: [root, a, b, c, d], settings: { ...base().settings, ...on } }),
      { type: "scheduleTask", id: c.id, at: day(21, 6) });
    // c keeps its literal drop time; d follows a 60-minute c plus the 5-minute
    // settings break.
    expect(s.tasks.find((t) => t.id === d.id)!.scheduledAt).toBe(day(21, 7, 5));
    expect(s.tasks.find((t) => t.id === b.id)!.scheduledAt).toBe(day(20, 7));
  });
});

describe("timer follows status (desktop 1.6)", () => {
  it("moving a task to in_progress auto-starts its timer", () => {
    const t = newTask({ title: "focus me" });
    const s = reducer(base({ tasks: [t] }), { type: "setStatus", id: t.id, status: "in_progress" });
    expect(s.timer.taskId).toBe(t.id);
    expect(s.timer.runningSince).toBeDefined();
  });

  it("moving it back to pending banks the running session", () => {
    const t = newTask({ title: "focus me", status: "in_progress" });
    const running = base({
      tasks: [t],
      timer: { mode: "pomodoro", taskId: t.id, runningSince: Date.now() - 5 * 60_000, baseSec: 0, targetSec: 1500, pomodorosDone: 0 },
    });
    const s = reducer(running, { type: "setStatus", id: t.id, status: "pending" });
    expect(s.timer.runningSince).toBeUndefined();
    expect(s.sessions).toHaveLength(1);
  });
});

describe("drag-to-schedule packs a fresh subtree", () => {
  const t = (id: string, parentId?: string, patch: Partial<Task> = {}): Task =>
    ({ id, title: id, status: "pending", priority: 2, tags: [], createdAt: 1, loggedMin: 0, parentId, ...patch });
  const anchor = new Date(2026, 7, 1, 9, 0).getTime(); // Aug 1, 09:00 local

  it("packs every level of an unscheduled tree from the drop time", () => {
    // August-shaped tree: root > section > subsection > leaves, estimates set
    // by bulk edit BEFORE any scheduling — the reported no-populate case.
    const state = base({
      tasks: [
        t("root"),
        t("arrays", "root"),
        t("kadane", "arrays"),
        t("max-sub", "kadane", { estimateMin: 55 }),
        t("max-circ", "kadane", { estimateMin: 55 }),
        t("two-ptr", "arrays", { estimateMin: 55 }),
      ],
    });
    const next = reducer(state, { type: "scheduleTask", id: "root", at: anchor });
    const by = Object.fromEntries(next.tasks.map((x) => [x.id, x]));
    // Leaves run 55 min apiece with the 5-minute settings break between each,
    // so consecutive starts are 60 min apart. The break sits BETWEEN leaves
    // only — never before the first or after the last.
    expect(by["max-sub"].scheduledAt).toBe(anchor);
    expect(by["max-circ"].scheduledAt).toBe(anchor + 60 * 60_000);
    expect(by["two-ptr"].scheduledAt).toBe(anchor + 120 * 60_000);
    expect(by["root"].scheduledAt).toBe(anchor);
    expect(by["kadane"].scheduledAt).toBe(anchor);
    expect(by["arrays"].estimateMin).toBe(175); // 55 + 5 + 55 + 5 + 55
  });

  it("packs when only the root had a time (the lone stuck card) ", () => {
    const state = base({
      tasks: [
        t("root", undefined, { scheduledAt: anchor - 86_400_000 }),
        t("leaf-a", "root", { estimateMin: 55 }),
        t("leaf-b", "root", { estimateMin: 55 }),
      ],
    });
    const next = reducer(state, { type: "scheduleTask", id: "root", at: anchor });
    const by = Object.fromEntries(next.tasks.map((x) => [x.id, x]));
    expect(by["leaf-a"].scheduledAt).toBe(anchor);
    expect(by["leaf-b"].scheduledAt).toBe(anchor + 60 * 60_000); // 55 + 5 break
  });

  it("keeps the whole-tree shift for trees that already have times", () => {
    const state = base({
      tasks: [
        t("root", undefined, { scheduledAt: anchor }),
        t("leaf-a", "root", { estimateMin: 55, scheduledAt: anchor }),
        t("leaf-b", "root", { estimateMin: 55, scheduledAt: anchor + 55 * 60_000 }),
      ],
    });
    const day = 86_400_000;
    const next = reducer(state, { type: "scheduleTask", id: "root", at: anchor + day });
    const by = Object.fromEntries(next.tasks.map((x) => [x.id, x]));
    expect(by["leaf-a"].scheduledAt).toBe(anchor + day);
    expect(by["leaf-b"].scheduledAt).toBe(anchor + 55 * 60_000 + day);
  });
});

/* ————— the extended markdown format: notes as the source of truth ————— */

describe("extended markdown import", () => {
  const find = (s: AppState, title: string) => s.tasks.find((t) => t.title === title)!;

  it("renaming a stamped line no longer destroys the task", () => {
    // The headline property. Identity used to be (source, title), so editing a
    // task's text deleted it and created a new one — silently discarding its
    // logged time, its Google Calendar link and its dependency edges.
    let s = importMarkdown(base(), "- [ ] Draft spec @id(a1b2)\n", "plan.md");
    const original = find(s, "Draft spec");
    s = {
      ...s,
      tasks: s.tasks.map((t) => (t.id === original.id
        ? { ...t, loggedMin: 30, googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev1" } }
        : t)),
    };

    s = importMarkdown(s, "- [ ] Draft the spec !P0 @id(a1b2)\n", "plan.md");
    expect(s.tasks).toHaveLength(1);
    const after = s.tasks[0];
    expect(after.id).toBe(original.id);          // same task, not a replacement
    expect(after.title).toBe("Draft the spec");  // renamed
    expect(after.priority).toBe(0);              // and the stated field applied
    expect(after.loggedMin).toBe(30);            // history intact
    expect(after.googleEvent?.eventId).toBe("ev1");
  });

  it("writes only the fields the line states, leaving the rest alone", () => {
    let s = importMarkdown(base(), "- [ ] Ship it @id(aaaa)\n", "plan.md");
    s = {
      ...s,
      tasks: s.tasks.map((t) => ({ ...t, estimateMin: 45, comment: "waiting on Priya", tags: ["mine"] })),
    };
    // The line mentions priority and nothing else.
    s = importMarkdown(s, "- [ ] Ship it !P1 @id(aaaa)\n", "plan.md");
    const t = s.tasks[0];
    expect(t.priority).toBe(1);
    expect(t.estimateMin).toBe(45);
    expect(t.comment).toBe("waiting on Priya");
    expect(t.tags).toEqual(["mine"]);
  });

  it("reads every field off one line", () => {
    const s = importMarkdown(
      base(),
      "- [/] Ship it !P0 #work #deep ~90m @start(2026-08-04 09:00) @due(2026-08-06) @lock @id(bbbb) // ask Priya\n"
      + "    > Needs the schema frozen.\n",
      "plan.md",
    );
    expect(s.tasks[0]).toMatchObject({
      title: "Ship it", status: "in_progress", priority: 0, tags: ["work", "deep"],
      estimateMin: 90, locked: true, comment: "ask Priya", description: "Needs the schema frozen.",
      mdKey: "bbbb",
    });
    expect(s.tasks[0].scheduledAt).toBe(new Date(2026, 7, 4, 9, 0).getTime());
    expect(s.tasks[0].deadline).toBe(new Date(2026, 7, 6).getTime());
  });

  it("moves a LOCKED task's times when the markdown states them", () => {
    // restoreLockedTimes guards drags and re-packs, but the file is authoritative:
    // stating a time in the note is an explicit instruction, not an auto-schedule.
    const when = new Date(2026, 7, 4, 14, 0).getTime();
    const s = importMarkdown(base(), `- [ ] Standup @lock @start(2026-08-04 14:00) @id(cccc)\n`, "plan.md");
    expect(s.tasks[0].locked).toBe(true);
    expect(s.tasks[0].scheduledAt).toBe(when);
  });

  it("un-ticking a box now un-completes the task", () => {
    let s = importMarkdown(base(), "- [x] Ship it @id(dddd)\n", "plan.md");
    expect(s.tasks[0].status).toBe("done");
    expect(s.tasks[0].completedAt).toBeDefined();
    s = importMarkdown(s, "- [ ] Ship it @id(dddd)\n", "plan.md");
    expect(s.tasks[0].status).toBe("pending");
    expect(s.tasks[0].completedAt).toBeUndefined();
  });

  it("a bare bullet with no box still states nothing about status", () => {
    let s = importMarkdown(base(), "- [x] Ship it @id(eeee)\n", "plan.md");
    s = importMarkdown(s, "- Ship it @id(eeee)\n", "plan.md");
    expect(s.tasks[0].status).toBe("done");
  });

  it("ticking a routine marks TODAY, never the template", () => {
    let s = importMarkdown(base(), "- [ ] Stretch @every(1d) @start(2026-08-04 07:00) @id(ffff)\n", "plan.md");
    s = importMarkdown(s, "- [x] Stretch @every(1d) @start(2026-08-04 07:00) @id(ffff)\n", "plan.md");
    const t = s.tasks[0];
    expect(t.status).toBe("pending");                                   // template untouched
    expect(t.occurrenceStatus?.[occurrenceDateKey(Date.now())]).toBe("done");
  });

  it("anchors a repeat that states no start time", () => {
    const s = importMarkdown(base(), "- [ ] Stretch @every(1d) @id(gggg)\n", "plan.md");
    expect(s.tasks[0].scheduledAt).toBe(startOfDay(Date.now()));
  });

  it("resolves @after by task text and refuses a cycle", () => {
    const s = importMarkdown(
      base(),
      "- [ ] Draft the schema @id(h1h1)\n- [ ] Wire the writer @after(Draft the schema) @id(h2h2)\n",
      "plan.md",
    );
    const draft = find(s, "Draft the schema");
    const wire = find(s, "Wire the writer");
    expect(wire.dependsOn).toEqual([draft.id]);

    // Now ask for the reverse edge too — it would close a loop, so it is dropped.
    const cyclic = importMarkdown(
      s,
      "- [ ] Draft the schema @after(Wire the writer) @id(h1h1)\n- [ ] Wire the writer @after(Draft the schema) @id(h2h2)\n",
      "plan.md",
    );
    expect(find(cyclic, "Draft the schema").dependsOn ?? []).toEqual([]);
  });

  it("matches an @after reference by prefix", () => {
    const s = importMarkdown(base(), "- [ ] Draft the schema @id(i1i1)\n- [ ] Wire it @after(Draft) @id(i2i2)\n", "plan.md");
    expect(find(s, "Wire it").dependsOn).toEqual([find(s, "Draft the schema").id]);
  });

  it("treats a duplicated @id as a separate task rather than one clobbering the other", () => {
    const s = importMarkdown(base(), "- [ ] First @id(j1j1)\n- [ ] Second @id(j1j1)\n", "plan.md");
    expect(s.tasks).toHaveLength(2);
    expect(new Set(s.tasks.map((t) => t.mdKey)).size).toBe(2);
  });

  it("stamps a key on every task, even lines that state none", () => {
    const s = importMarkdown(base(), "- [ ] Unstamped\n", "plan.md");
    expect(s.tasks[0].mdKey).toMatch(/^[a-z0-9]{4}$/);
  });

  it("still deletes a line that left the file, stamped or not", () => {
    let s = importMarkdown(base(), "- [ ] Keep @id(k1k1)\n- [ ] Drop @id(k2k2)\n- [ ] Legacy\n", "plan.md");
    expect(s.tasks).toHaveLength(3);
    s = importMarkdown(s, "- [ ] Keep @id(k1k1)\n", "plan.md");
    expect(s.tasks.map((t) => t.title)).toEqual(["Keep"]);
  });

  it("keeps a renamed line alive through the delete sweep", () => {
    let s = importMarkdown(base(), "- [ ] Old name @id(l1l1)\n", "plan.md");
    const id = s.tasks[0].id;
    s = importMarkdown(s, "- [ ] Brand new name @id(l1l1)\n", "plan.md");
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0].id).toBe(id);
  });

  it("matches a task from another note by key without stealing its source", () => {
    let s = importMarkdown(base(), "- [ ] Shared @id(m1m1)\n", "one.md");
    s = importMarkdown(s, "- [ ] Shared !P0 @id(m1m1)\n", "two.md");
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0].source).toBe("one.md");   // still owned by the note that made it
    expect(s.tasks[0].priority).toBe(0);
  });

  it("leaves a plain legacy note importing exactly as before", () => {
    const s = importMarkdown(base(), "- [ ] Website refresh\n    - [x] Audit pages\n", "plan.md");
    const parent = find(s, "Website refresh");
    expect(find(s, "Audit pages").parentId).toBe(parent.id);
    expect(find(s, "Audit pages").status).toBe("done");
  });
});

describe("markdown write-back (app → note)", () => {
  const note = (body: string) => ({ id: "n1", folderId: "f1", title: "Plan", body, updatedAt: 0 });
  const withNote = (body: string) => base({ notes: [note(body)] });

  it("stamps @id onto every task line when the note is sent", () => {
    const s = importMarkdown(withNote("# Plan\n- [ ] Draft spec\n- [ ] Ship it\n"), "# Plan\n- [ ] Draft spec\n- [ ] Ship it\n", "Plan", true, "n1");
    const body = s.notes[0].body;
    expect(body).toMatch(/- \[ \] Draft spec @id\([a-z0-9]{4}\)/);
    expect(body).toMatch(/- \[ \] Ship it @id\([a-z0-9]{4}\)/);
    expect(body).toContain("# Plan");   // untouched lines stay untouched
  });

  it("is idempotent — sending twice changes nothing the second time", () => {
    const text = "- [ ] Draft spec\n";
    const once = importMarkdown(withNote(text), text, "Plan", true, "n1");
    const twice = importMarkdown(once, once.notes[0].body, "Plan", true, "n1");
    expect(twice.notes[0].body).toBe(once.notes[0].body);
  });

  it("never touches a [block] line", () => {
    const text = "- [block]lunch [1200:1300][1D]\n- [ ] Real task\n";
    const s = importMarkdown(withNote(text), text, "Plan", true, "n1");
    expect(s.notes[0].body).toContain("- [block]lunch [1200:1300][1D]");
  });

  it("reflects an edit made anywhere else back into the note", () => {
    // The app → note direction, exercised through a plain upsertTask — the same
    // path the board, the list and the task editor all use.
    let s = importMarkdown(withNote("- [ ] Draft spec\n"), "- [ ] Draft spec\n", "Plan", true, "n1");
    const task = s.tasks[0];
    s = reducer(s, { type: "upsertTask", task: { ...task, title: "Draft the spec", priority: 0, estimateMin: 90 } });

    const body = s.notes[0].body;
    expect(body).toContain("Draft the spec");
    expect(body).toContain("!P0");
    expect(body).toContain("~90m");
    expect(body).toContain(`@id(${task.mdKey})`);
  });

  it("reflects a status change back as the right checkbox glyph", () => {
    let s = importMarkdown(withNote("- [ ] Ship it\n"), "- [ ] Ship it\n", "Plan", true, "n1");
    const id = s.tasks[0].id;
    s = reducer(s, { type: "setStatus", id, status: "in_progress" });
    expect(s.notes[0].body).toContain("- [/] Ship it");
    s = reducer(s, { type: "setStatus", id, status: "done" });
    expect(s.notes[0].body).toContain("- [x] Ship it");
  });

  it("finds the line by key even after the note has been renamed", () => {
    // `source` is the note TITLE and changes whenever the H1 is edited, so the
    // write-back searches bodies by key instead of trusting it.
    let s = importMarkdown(withNote("- [ ] Ship it\n"), "- [ ] Ship it\n", "Plan", true, "n1");
    s = { ...s, notes: [{ ...s.notes[0], title: "Renamed plan" }] };
    const task = s.tasks[0];
    s = reducer(s, { type: "upsertTask", task: { ...task, priority: 0 } });
    expect(s.notes[0].body).toContain("!P0");
  });

  it("leaves notes alone when the action changed no task", () => {
    const s = importMarkdown(withNote("- [ ] Ship it\n"), "- [ ] Ship it\n", "Plan", true, "n1");
    const before = s.notes;
    const after = reducer(s, { type: "setSettings", patch: { hourFormat: "12" } });
    expect(after.notes).toBe(before);      // same reference: React sees no change
  });

  it("leaves an unstamped line alone rather than guessing", () => {
    const s = base({ notes: [note("- [ ] Never sent anywhere\n")], tasks: [] });
    const after = reducer(s, { type: "upsertTask", task: newTask({ title: "Unrelated" }) });
    expect(after.notes[0].body).toBe("- [ ] Never sent anywhere\n");
  });
});
