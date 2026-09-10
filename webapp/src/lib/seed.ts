import type { AppState, Task } from "./types";
import { addDays, at, startOfDay } from "./dates";
import { defaultWebdavUrl } from "./native/platform";
import { occurrenceDateKey } from "./occurrence";

let n = 0;
const id = () => `seed-${++n}`;

function task(t: Partial<Task> & Pick<Task, "title" | "status" | "priority">): Task {
  return { id: id(), tags: [], createdAt: Date.now(), loggedMin: 0, ...t };
}

/** Demo content for a fresh vault, laid out around "today". */
export function seedState(): AppState {
  n = 0;
  const today = startOfDay(Date.now());
  const now = Date.now();

  const dsa = task({
    title: "DSA practice — graphs",
    description: "Dijkstra + topo sort. Redo the two problems from [[Graphs note]].",
    status: "in_progress",
    priority: 1,
    tags: ["study"],
    scheduledAt: at(today, 9),
    deadline: at(addDays(today, 1), 18),
    estimateMin: 90,
    loggedMin: 24,
  });

  const website = task({ title: "Website refresh", status: "pending", priority: 2 });

  const tasks: Task[] = [
    task({
      title: "Draft Q3 roadmap outline",
      status: "pending",
      priority: 0,
      tags: ["planning", "work"],
      deadline: at(addDays(today, 2), 14),
      scheduledAt: at(addDays(today, 3), 14),
      estimateMin: 90,
    }),
    website,
    task({ title: "Audit current pages", status: "done", priority: 2, parentId: website.id, completedAt: at(today, 8) }),
    task({ title: "New hero section", status: "pending", priority: 2, parentId: website.id, estimateMin: 40, scheduledAt: at(addDays(today, 1), 15) }),
    task({ title: "Ship CSS cleanup", status: "pending", priority: 3, parentId: website.id }),
    task({
      title: "Reply to onboarding emails",
      status: "pending",
      priority: 3,
      description: "Follow the checklist in [[Meeting log]].",
    }),
    dsa,
    task({ title: "Review BFS/DFS", status: "done", priority: 1, parentId: dsa.id, completedAt: at(today, 9, 40) }),
    task({ title: "Solve shortest-path set", status: "pending", priority: 1, parentId: dsa.id, estimateMin: 40 }),
    task({
      title: "Review PR #482",
      status: "in_progress",
      priority: 0,
      tags: ["work"],
      deadline: at(today, 16, 30),
      scheduledAt: at(today, 14),
      estimateMin: 60,
    }),
    task({
      title: "Ship v0.10 changelog",
      status: "done",
      priority: 1,
      tags: ["release"],
      completedAt: at(addDays(today, -1), 17),
      loggedMin: 48,
    }),
    task({ title: "Morning standup", status: "done", priority: 2, completedAt: at(today, 9, 15), loggedMin: 15 }),
    task({ title: "Optional: refactor logging", status: "skipped", priority: 3 }),
    task({ title: "Write blog draft", status: "pending", priority: 2, estimateMin: 60 }),
    task({ title: "Grocery run", status: "pending", priority: 3 }),
    task({ title: "Design review", status: "pending", priority: 1, scheduledAt: at(addDays(today, 1), 8), estimateMin: 90 }),
    task({ title: "Deep work: API", status: "pending", priority: 1, tags: ["work"], scheduledAt: at(addDays(today, 2), 10), estimateMin: 120 }),
    task({ title: "1:1 sync", status: "pending", priority: 2, scheduledAt: at(addDays(today, 6), 11), estimateMin: 30 }),
  ];

  const folders = [
    { id: "f-work", name: "Work" },
    { id: "f-personal", name: "Personal" },
    { id: "f-reading", name: "Reading" },
  ];

  const graphsNote = [
    "# Graphs note",
    "",
    "Prep for [[DSA practice — graphs]].",
    "",
    "## Traversals",
    "- **BFS** — queue, level order",
    "- **DFS** — stack / recursion",
    "",
    "## Shortest path",
    "1. Dijkstra `O(E log V)`",
    "2. Bellman-Ford (neg edges)",
    "",
    "> Redo topo-sort by hand.",
  ].join("\n");

  const notes = [
    { id: "n-roadmap", folderId: "f-work", title: "Roadmap Q3", body: "# Roadmap Q3\n\n- Launch window\n- Hiring plan", updatedAt: addDays(now, -2) },
    { id: "n-graphs", folderId: "f-work", title: "Graphs note", body: graphsNote, updatedAt: now - 120_000 },
    { id: "n-meeting", folderId: "f-work", title: "Meeting log", body: "# Meeting log\n\n> Keep replies under 5 sentences.", updatedAt: addDays(now, -1) },
  ];

  const mind = [
    { id: "m-root", label: "Q3 launch", x: 300, y: 250 },
    { id: "m-research", label: "Research", x: 110, y: 120, parentId: "m-root", status: "pending" as const },
    { id: "m-draft", label: "Roadmap draft", x: 95, y: 245, parentId: "m-root", status: "in_progress" as const },
    { id: "m-deck", label: "Kickoff deck", x: 110, y: 370, parentId: "m-root", status: "done" as const },
    { id: "m-mkt", label: "Marketing", x: 510, y: 140, parentId: "m-root" },
    { id: "m-landing", label: "Landing page", x: 700, y: 80, parentId: "m-mkt", status: "pending" as const },
    { id: "m-ads", label: "Ad set (cut)", x: 720, y: 200, parentId: "m-mkt", status: "skipped" as const },
    { id: "m-eng", label: "Engineering", x: 545, y: 330, parentId: "m-root", status: "in_progress" as const },
    { id: "m-api", label: "API cutover", x: 750, y: 390, parentId: "m-eng", status: "pending" as const },
  ];

  const session = (label: string, dayOffset: number, minutes: number, taskId?: string, kind: "focus" | "pause" = "focus") => ({
    id: id(), label, startedAt: at(addDays(today, dayOffset), 10), minutes, taskId, kind,
  });

  const sessions = [
    session("Deep work: API", -5, 140),
    session("Website refresh", -4, 190),
    session("Draft Q3 roadmap", -3, 105),
    session("DSA practice", -2, 230),
    session("Ship v0.10 changelog", -1, 48),
    session("Review PR #482", 0, 52, tasks.find((t) => t.title === "Review PR #482")!.id),
    session("Review PR #482", 0, 18, tasks.find((t) => t.title === "Review PR #482")!.id, "pause"),
    session("Morning standup", 0, 15),
  ];

  return {
    tasks,
    blocks: [{ id: id(), title: "Lunch", start: at(today, 12), durationMin: 60 }],
    folders,
    notes,
    mind,
    mindTitle: "Q3 planning map",
    sessions,
    // Real ISBNs, so the demo covers actually resolve from Open Library
    // rather than showing three fallback tints on first run.
    books: [
      {
        id: id(), title: "The Pragmatic Programmer", authors: ["Andrew Hunt", "David Thomas"],
        isbn13: "9780201616224", publisher: "Addison-Wesley", publishedYear: 1999, pageCount: 352,
        status: "read", rating: 5, finishedAt: addDays(today, -40), shelf: "Desk",
        tags: ["craft"], addedAt: addDays(today, -60), source: "manual",
      },
      {
        id: id(), title: "Thinking, Fast and Slow", authors: ["Daniel Kahneman"],
        isbn13: "9780374533557", publisher: "Farrar, Straus and Giroux", publishedYear: 2013, pageCount: 499,
        status: "reading", startedAt: addDays(today, -9), shelf: "Bedside",
        tags: ["psychology"], addedAt: addDays(today, -30), source: "manual",
      },
      {
        id: id(), title: "The Left Hand of Darkness", authors: ["Ursula K. Le Guin"],
        isbn13: "9780441478125", publisher: "Ace Books", publishedYear: 1987, pageCount: 304,
        status: "unread", shelf: "Living room",
        tags: ["fiction"], addedAt: addDays(today, -5), source: "manual",
      },
    ],
    // A few days of history so streaks and the dashboard card demo themselves.
    habits: [
      {
        id: id(), name: "Wake up by 6", emoji: "\u{1F305}", createdAt: addDays(today, -14),
        log: Object.fromEntries([-1, -2, -3].map((d) => [occurrenceDateKey(addDays(today, d)), 1])),
      },
      {
        id: id(), name: "Drink water", emoji: "\u{1F4A7}", timesPerDay: 8, createdAt: addDays(today, -14),
        log: { [occurrenceDateKey(addDays(today, -1))]: 8, [occurrenceDateKey(today)]: 3 },
      },
      {
        id: id(), name: "Swim", emoji: "\u{1F3CA}", days: [1, 3, 5], createdAt: addDays(today, -14),
        log: {},
      },
    ],
    timer: {
      mode: "pomodoro",
      taskId: dsa.id,
      runningSince: now - 8 * 60_000,
      baseSec: 0,
      targetSec: 25 * 60,
      pomodorosDone: 2,
    },
    quickTimers: [],
    settings: {
      theme: "system",
      accent: "violet",
      clockFace: "matrix" as const,
      noteTemplate: "blank" as const,
      density: "cozy",
      statusColors: true,
      reduceMotion: false,
      notifications: true,
      sounds: true,
      alertSound: "chime",
      weekStart: 0 as const,
      hourFormat: "24" as const,
      workHours: { enabled: true, startMin: 6 * 60, endMin: 21 * 60 },
      breakMin: 5,
      sync: { enabled: false, url: defaultWebdavUrl(), username: "", password: "" },
      plugins: { todo: true, timer: true, notes: true, mindmap: true, dashboard: true, library: true, habits: true },
      sidebarCollapsed: false,
      landingView: "todo",
      todoDefaultView: "last",
      scheduleReminders: true,
      autoPauseMin: 10,
      statusNudge: { enabled: true, everyMin: 25 },
    },
  };
}
