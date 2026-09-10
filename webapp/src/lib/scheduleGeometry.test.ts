import { describe, expect, it } from "vitest";
import { HOUR_H_MAX, HOUR_H_MIN, carrySegmentMs, visibleCardMinutes, zoomHourH } from "./scheduleGeometry";

describe("visibleCardMinutes", () => {
  it("leaves a card that fits inside the day untouched", () => {
    expect(visibleCardMinutes(9 * 60, 90)).toBe(90);
  });

  it("clamps an overnight card at the day's bottom edge", () => {
    // Sleep 22:45 + 480 min must stop at 24:00 (75 min visible), not
    // overflow the grid into the space below the last hour row.
    expect(visibleCardMinutes(22 * 60 + 45, 480)).toBe(75);
  });

  it("clamps a card that starts exactly at the last minute", () => {
    expect(visibleCardMinutes(24 * 60 - 1, 60)).toBe(1);
  });

  it("never returns negative minutes for a start past midnight", () => {
    expect(visibleCardMinutes(24 * 60 + 10, 60)).toBe(0);
  });

  it("clips the portion before the day for a card starting negative", () => {
    // A card whose start belongs to the previous day shows only the
    // in-day remainder.
    expect(visibleCardMinutes(-30, 90)).toBe(60);
  });
});

describe("carrySegmentMs", () => {
  const DAY = 24 * 3_600_000;
  const day = 1_754_800_000_000; // arbitrary day-start epoch

  it("returns the next-day segment of an overnight card", () => {
    // 22:45 yesterday + 480 min → today 00:00-06:45.
    const start = day - DAY + (22 * 60 + 45) * 60_000;
    expect(carrySegmentMs(start, 480, day)).toEqual({
      start: day,
      end: day + (6 * 60 + 45) * 60_000,
    });
  });

  it("returns null when the card ends at or before midnight", () => {
    const start = day - DAY + 22 * 3_600_000;
    expect(carrySegmentMs(start, 120, day)).toBeNull();
  });

  it("returns null for a card that starts on the day itself", () => {
    expect(carrySegmentMs(day + 3_600_000, 480, day)).toBeNull();
  });

  it("clamps a multi-day duration to this day's column", () => {
    const start = day - DAY + 23 * 3_600_000;
    expect(carrySegmentMs(start, 3 * 24 * 60, day)).toEqual({
      start: day,
      end: day + DAY,
    });
  });
});

describe("zoomHourH", () => {
  it("steps the hour height up", () => {
    expect(zoomHourH(54, 1)).toBe(72);
  });

  it("steps the hour height down", () => {
    expect(zoomHourH(72, -1)).toBe(54);
  });

  it("clamps at the maximum", () => {
    expect(zoomHourH(HOUR_H_MAX, 1)).toBe(HOUR_H_MAX);
    expect(zoomHourH(HOUR_H_MAX - 6, 1)).toBe(HOUR_H_MAX);
  });

  it("clamps at the minimum", () => {
    expect(zoomHourH(HOUR_H_MIN, -1)).toBe(HOUR_H_MIN);
    expect(zoomHourH(HOUR_H_MIN + 6, -1)).toBe(HOUR_H_MIN);
  });
});
