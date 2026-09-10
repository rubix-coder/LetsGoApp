// @vitest-environment node
/* Side-by-side placement for a day column in the Schedule view.

   The rule the layout has to honour: a card is only ever narrowed by the cards
   it ACTUALLY overlaps. A busy evening must not shrink the morning. */
import { describe, expect, it } from "vitest";
import { assignLanes } from "./dayLanes";

const H = 3_600_000;
const at = (hour: number, min = 0): number => hour * H + min * 60_000;
const ev = (id: string, from: number, to: number) => ({ id, start: from, end: to });

/** id -> "lane/lanes", the shape the renderer turns into left/width. */
const layout = (items: ReturnType<typeof ev>[]): Record<string, string> =>
  Object.fromEntries(assignLanes(items).map((e) => [e.id, `${e.lane}/${e.lanes}`]));

describe("assignLanes", () => {
  it("gives a lone card the full width", () => {
    expect(layout([ev("a", at(9), at(10))])).toEqual({ a: "0/1" });
  });

  it("splits two cards that genuinely overlap", () => {
    expect(layout([ev("a", at(9), at(10, 30)), ev("b", at(10), at(11))])).toEqual({ a: "0/2", b: "1/2" });
  });

  it("does NOT narrow a card because something ELSE in the day overlaps", () => {
    // The reported bug: one overlapping pair at 21:00 halved every card in the
    // column, all day long, leaving the morning cards cut in half beside acres
    // of empty space.
    expect(layout([
      ev("morning", at(7), at(8)),
      ev("midday", at(11), at(12)),
      ev("evening-a", at(21), at(22)),
      ev("evening-b", at(21, 30), at(22, 30)),
    ])).toEqual({
      morning: "0/1",         // untouched by the evening
      midday: "0/1",
      "evening-a": "0/2",     // these two really do collide
      "evening-b": "1/2",
    });
  });

  it("keeps back-to-back cards full width — touching is not overlapping", () => {
    expect(layout([ev("a", at(9), at(10)), ev("b", at(10), at(11))])).toEqual({ a: "0/1", b: "0/1" });
  });

  it("sizes each overlap cluster independently", () => {
    expect(layout([
      ev("solo", at(6), at(7)),
      ev("pair-a", at(9), at(10, 30)),
      ev("pair-b", at(10), at(11)),
      ev("trio-a", at(14), at(17)),
      ev("trio-b", at(14, 30), at(15, 30)),
      ev("trio-c", at(15), at(16)),
    ])).toEqual({
      solo: "0/1",
      "pair-a": "0/2", "pair-b": "1/2",
      "trio-a": "0/3", "trio-b": "1/3", "trio-c": "2/3",
    });
  });

  it("chains a cluster transitively through a long card", () => {
    // b does not touch a, but both collide with the long span, so all three
    // share one cluster and none may claim the full width.
    const out = layout([ev("long", at(9), at(13)), ev("a", at(9, 30), at(10)), ev("b", at(12), at(12, 30))]);
    expect(out).toEqual({ long: "0/2", a: "1/2", b: "1/2" });
  });

  it("reuses a lane once it has been vacated", () => {
    expect(layout([
      ev("long", at(9), at(13)),
      ev("first", at(9, 30), at(10, 30)),
      ev("second", at(11), at(12)),
    ])).toEqual({ long: "0/2", first: "1/2", second: "1/2" });
  });

  it("returns cards in start order, and survives an empty day", () => {
    expect(assignLanes([])).toEqual([]);
    expect(assignLanes([ev("late", at(15), at(16)), ev("early", at(8), at(9))]).map((e) => e.id))
      .toEqual(["early", "late"]);
  });

  it("carries the caller's own fields through untouched", () => {
    const [only] = assignLanes([{ id: "a", start: at(9), end: at(10), title: "Standup", ghost: true }]);
    expect(only.title).toBe("Standup");
    expect(only.ghost).toBe(true);
  });
});
