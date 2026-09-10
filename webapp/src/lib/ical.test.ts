// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseIcal } from "./ical";
import { importIcal, newTask } from "./store";
import type { AppState } from "./types";

const SAMPLE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VTODO",
  "UID:1@x",
  "SUMMARY:Write report",
  "DESCRIPTION:First line\\nSecond\\, part",
  "DUE:20260722T170000Z",
  "PRIORITY:1",
  "STATUS:NEEDS-ACTION",
  "CATEGORIES:work,writing",
  "RRULE:FREQ=WEEKLY;INTERVAL=2",
  "END:VTODO",
  "BEGIN:VEVENT",
  "UID:2@x",
  "SUMMARY:Standup",
  "DTSTART:20260721T090000Z",
  "DTEND:20260721T091500Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcal", () => {
  it("maps a VTODO (title, due, priority, tags, recurrence, escaped text)", () => {
    const [todo] = parseIcal(SAMPLE);
    expect(todo.title).toBe("Write report");
    expect(todo.description).toBe("First line\nSecond, part");
    expect(todo.deadline).toBe(Date.UTC(2026, 6, 22, 17, 0, 0));
    expect(todo.priority).toBe(0); // RFC 1 (highest) → P0
    expect(todo.tags).toEqual(["work", "writing"]);
    expect(todo.status).toBe("pending");
    expect(todo.repeat).toEqual({ interval: 2, unit: "weekly" });
  });

  it("maps a VEVENT's start/end to scheduledAt + estimate", () => {
    const ev = parseIcal(SAMPLE)[1];
    expect(ev.title).toBe("Standup");
    expect(ev.scheduledAt).toBe(Date.UTC(2026, 6, 21, 9, 0, 0));
    expect(ev.estimateMin).toBe(15);
    expect(ev.priority).toBe(2); // absent → default P2
  });

  it("unfolds continuation lines", () => {
    const ics = ["BEGIN:VTODO", "SUMMARY:Long ", " title", "END:VTODO"].join("\n");
    expect(parseIcal(ics)[0].title).toBe("Long title");
  });

  it("reads an all-day VALUE=DATE event as local midnight with no estimate", () => {
    const ics = [
      "BEGIN:VEVENT",
      "SUMMARY:Holiday",
      "DTSTART;VALUE=DATE:20260725",
      "DTEND;VALUE=DATE:20260726",
      "END:VEVENT",
    ].join("\n");
    const [ev] = parseIcal(ics);
    expect(ev.scheduledAt).toBe(new Date(2026, 6, 25).getTime());
    expect(ev.estimateMin).toBeUndefined();
  });

  it("marks a COMPLETED todo done with its completion time", () => {
    const ics = [
      "BEGIN:VTODO", "SUMMARY:Done thing", "STATUS:COMPLETED",
      "COMPLETED:20260720T120000Z", "END:VTODO",
    ].join("\n");
    const [t] = parseIcal(ics);
    expect(t.status).toBe("done");
    expect(t.completedAt).toBe(Date.UTC(2026, 6, 20, 12, 0, 0));
  });

  it("maps priority bands and skips components without a summary", () => {
    const ics = [
      "BEGIN:VTODO", "SUMMARY:A", "PRIORITY:3", "END:VTODO",
      "BEGIN:VTODO", "SUMMARY:B", "PRIORITY:5", "END:VTODO",
      "BEGIN:VTODO", "SUMMARY:C", "PRIORITY:9", "END:VTODO",
      "BEGIN:VTODO", "DESCRIPTION:no summary", "END:VTODO",
    ].join("\n");
    expect(parseIcal(ics).map((t) => t.priority)).toEqual([1, 2, 3]); // 3→P1, 5→P2, 9→P3
  });

  it("reads a DURATION into estimate minutes", () => {
    const ics = [
      "BEGIN:VEVENT", "SUMMARY:Deep work",
      "DTSTART:20260721T090000Z", "DURATION:PT1H30M", "END:VEVENT",
    ].join("\n");
    expect(parseIcal(ics)[0].estimateMin).toBe(90);
  });
});

function base(tasks: AppState["tasks"] = []): AppState {
  return {
    tasks, blocks: [], folders: [], notes: [], mind: [], mindTitle: "", sessions: [], books: [], habits: [],
    timer: { mode: "pomodoro", baseSec: 0, targetSec: 1500, pomodorosDone: 0 },
    quickTimers: [],
    settings: {
      theme: "light", accent: "violet", density: "cozy", statusColors: true, reduceMotion: false, notifications: false, sounds: false, weekStart: 0, hourFormat: "24",
      workHours: { enabled: false, startMin: 360, endMin: 1260 },
      sync: { enabled: false, url: "/webdav", username: "", password: "" },
      plugins: { todo: true, timer: true, notes: true, mindmap: true, dashboard: true, library: true, habits: true },
      sidebarCollapsed: false, landingView: "todo", todoDefaultView: "last", scheduleReminders: true,
    },
  };
}

describe("importIcal reducer", () => {
  it("creates tasks with mapped fields carried into state", () => {
    const s = importIcal(base(), SAMPLE, "cal.ics");
    expect(s.tasks).toHaveLength(2);
    const report = s.tasks.find((t) => t.title === "Write report")!;
    expect(report.source).toBe("cal.ics");
    expect(report.deadline).toBe(Date.UTC(2026, 6, 22, 17, 0, 0));
    expect(report.tags).toEqual(["work", "writing"]);
    expect(report.priority).toBe(0);
  });

  it("re-import updates kept entries in place and deletes ones dropped from the file", () => {
    const first = importIcal(base(), SAMPLE, "cal.ics");
    const reportId = first.tasks.find((t) => t.title === "Write report")!.id;

    const second = importIcal(
      first,
      ["BEGIN:VCALENDAR",
       "BEGIN:VTODO", "SUMMARY:Write report", "PRIORITY:9", "END:VTODO",
       "END:VCALENDAR"].join("\r\n"),
      "cal.ics",
    );
    expect(second.tasks.map((t) => t.title)).toEqual(["Write report"]); // Standup deleted
    expect(second.tasks[0].id).toBe(reportId); // kept, not recreated
    expect(second.tasks[0].priority).toBe(3); // fields rewritten from the calendar
  });

  it("leaves other sources and hand-made tasks untouched", () => {
    const mine = newTask({ title: "Mine" });
    const s = importIcal(base([mine]), SAMPLE, "cal.ics");
    expect(s.tasks.find((t) => t.id === mine.id)).toBeTruthy();
    expect(s.tasks).toHaveLength(3);
  });
});
