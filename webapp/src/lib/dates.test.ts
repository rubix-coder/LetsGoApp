// @vitest-environment node
import { describe, expect, it } from "vitest";
import { addDays, fmtClock, fmtClockMin, fmtDateTime, fmtHour, fmtMin, fmtTime, parseClockText, setHourFormat, startOfDay, streakDays } from "./dates";

describe("streakDays", () => {
  const today = startOfDay(Date.now());

  it("counts consecutive completion days ending today", () => {
    expect(streakDays([today, addDays(today, -1), addDays(today, -2)])).toBe(3);
  });

  it("still counts a streak that ended yesterday", () => {
    expect(streakDays([addDays(today, -1), addDays(today, -2)])).toBe(2);
  });

  it("breaks on a gap", () => {
    expect(streakDays([today, addDays(today, -2)])).toBe(1);
    expect(streakDays([])).toBe(0);
  });
});

describe("duration formatting", () => {
  it("formats minutes like the mocks", () => {
    expect(fmtMin(48)).toBe("48m");
    expect(fmtMin(90)).toBe("1h 30m");
    expect(fmtMin(120)).toBe("2h 00m");
  });

  it("formats the timer clock", () => {
    expect(fmtClock(1002)).toBe("16:42");
    expect(fmtClock(5)).toBe("0:05");
  });
});

describe("hour format (Settings clock style)", () => {
  const fourPm = new Date(2026, 6, 21, 16, 5).getTime();

  it("defaults to 24-hour", () => {
    expect(fmtTime(fourPm)).toBe("16:05");
    expect(fmtDateTime(fourPm)).toContain("16:05");
    expect(fmtHour(14)).toBe("14:00");
  });

  it("switches to 12-hour and back", () => {
    setHourFormat("12");
    expect(fmtTime(fourPm)).toBe("4:05 PM");
    expect(fmtHour(14)).toBe("2 PM");
    setHourFormat("24");
    expect(fmtTime(fourPm)).toBe("16:05");
  });
});

describe("clock text fields (typed times)", () => {
  it("formats minutes-of-day per clock style", () => {
    expect(fmtClockMin(14 * 60 + 30)).toBe("14:30");
    setHourFormat("12");
    expect(fmtClockMin(14 * 60 + 30)).toBe("2:30 PM");
    expect(fmtClockMin(0)).toBe("12:00 AM");
    setHourFormat("24");
    expect(fmtClockMin(0)).toBe("00:00");
  });

  it("parses 24h, 12h and bare-hour text", () => {
    expect(parseClockText("14:30")).toBe(14 * 60 + 30);
    expect(parseClockText("9:5")).toBe(9 * 60 + 5);
    expect(parseClockText("2:30 pm")).toBe(14 * 60 + 30);
    expect(parseClockText("12am")).toBe(0);
    expect(parseClockText("12 PM")).toBe(12 * 60);
    expect(parseClockText("7")).toBe(7 * 60);
  });

  it("rejects unreadable times", () => {
    expect(parseClockText("24:00")).toBeNull();
    expect(parseClockText("13 pm")).toBeNull();
    expect(parseClockText("7:75")).toBeNull();
    expect(parseClockText("soon")).toBeNull();
  });
});
