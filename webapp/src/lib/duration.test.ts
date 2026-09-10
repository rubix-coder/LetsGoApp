import { describe, expect, it } from "vitest";
import { fmtDuration, parseDurationToSeconds } from "./duration";

describe("parseDurationToSeconds", () => {
  it("reads the short unit suffixes", () => {
    expect(parseDurationToSeconds("10s")).toBe(10);
    expect(parseDurationToSeconds("10m")).toBe(600);
    expect(parseDurationToSeconds("1h")).toBe(3600);
  });

  it("reads long spellings, any case, with or without a space", () => {
    expect(parseDurationToSeconds("45 SEC")).toBe(45);
    expect(parseDurationToSeconds("2 Minutes")).toBe(120);
    expect(parseDurationToSeconds("3 hours")).toBe(10_800);
    expect(parseDurationToSeconds("1 hr")).toBe(3600);
  });

  it("sums compound durations", () => {
    expect(parseDurationToSeconds("1h30m")).toBe(5400);
    expect(parseDurationToSeconds("1h 30m 15s")).toBe(5415);
  });

  it("treats a bare number as minutes, matching the old number field", () => {
    expect(parseDurationToSeconds("25")).toBe(1500);
    expect(parseDurationToSeconds(" 5 ")).toBe(300);
  });

  it("accepts fractional amounts", () => {
    expect(parseDurationToSeconds("1.5h")).toBe(5400);
    expect(parseDurationToSeconds("0.5m")).toBe(30);
  });

  it("returns null for anything it cannot read", () => {
    expect(parseDurationToSeconds("")).toBeNull();
    expect(parseDurationToSeconds("   ")).toBeNull();
    expect(parseDurationToSeconds("soon")).toBeNull();
    expect(parseDurationToSeconds("10x")).toBeNull();
    expect(parseDurationToSeconds("m10")).toBeNull();
    expect(parseDurationToSeconds("10m banana")).toBeNull();
    expect(parseDurationToSeconds("1h 30")).toBeNull(); // unit of the 30 is a guess
  });

  it("rejects zero, negative and beyond-a-day durations", () => {
    expect(parseDurationToSeconds("0m")).toBeNull();
    expect(parseDurationToSeconds("-5m")).toBeNull();
    expect(parseDurationToSeconds("25h")).toBeNull();
    expect(parseDurationToSeconds("24h")).toBe(86_400);
  });

  it("rounds to whole seconds", () => {
    expect(parseDurationToSeconds("0.4s")).toBe(null); // rounds to 0 → rejected
    expect(parseDurationToSeconds("1.6s")).toBe(2);
  });
});

describe("fmtDuration", () => {
  it("labels sub-minute durations in seconds", () => {
    expect(fmtDuration(10)).toBe("10s");
    expect(fmtDuration(59)).toBe("59s");
  });

  it("labels whole minutes and hours like fmtMin", () => {
    expect(fmtDuration(600)).toBe("10m");
    expect(fmtDuration(5400)).toBe("1h 30m");
  });

  it("keeps the seconds remainder when there is one", () => {
    expect(fmtDuration(90)).toBe("1m 30s");
    expect(fmtDuration(5415)).toBe("1h 30m 15s");
  });
});
