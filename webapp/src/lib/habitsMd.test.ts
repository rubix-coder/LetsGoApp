// @vitest-environment node
import { describe, expect, it } from "vitest";
import { habitsToMarkdown, mergeImportedHabits, parseHabitsMarkdown } from "./habitsMd";
import type { Habit } from "./types";

const wake: Habit = {
  id: "h1", name: "Wake up by 6", emoji: "🌅", createdAt: 1000,
  log: { "2026-08-07": 1, "2026-08-06": 1 },
};
const water: Habit = {
  id: "h2", name: "Drink water", emoji: "💧", timesPerDay: 8, createdAt: 1000,
  log: { "2026-08-07": 5 },
};
const swim: Habit = {
  id: "h3", name: "Swim", days: [1, 3, 5], createdAt: 1000, log: {},
};

describe("habitsToMarkdown", () => {
  it("writes a section per habit with schedule, target and ledger", () => {
    const md = habitsToMarkdown([wake, water, swim]);
    expect(md).toContain("## 🌅 Wake up by 6");
    expect(md).toContain("## 💧 Drink water");
    expect(md).toContain("- times: 8");
    expect(md).toContain("- days: mon wed fri");
    expect(md).toContain("- 2026-08-07: 5");
    // Daily habits say so rather than omitting the line ambiguously.
    expect(md).toContain("- days: daily");
  });
});

describe("round trip", () => {
  it("parse(serialize(x)) preserves names, schedules, targets and logs", () => {
    const back = parseHabitsMarkdown(habitsToMarkdown([wake, water, swim]));
    expect(back.map((h) => h.name)).toEqual(["Wake up by 6", "Drink water", "Swim"]);
    const [w, d, s] = back;
    expect(w.emoji).toBe("🌅");
    expect(w.log).toEqual(wake.log);
    expect(d.timesPerDay).toBe(8);
    expect(d.log).toEqual(water.log);
    expect(s.days).toEqual([1, 3, 5]);
    expect(s.timesPerDay).toBeUndefined();
  });

  it("parses hand-written markdown without the niceties", () => {
    const back = parseHabitsMarkdown("# Habits\n\n## Meditate\n- 2026-08-01: 1\n");
    expect(back).toHaveLength(1);
    expect(back[0].name).toBe("Meditate");
    expect(back[0].emoji).toBeUndefined();
    expect(back[0].log).toEqual({ "2026-08-01": 1 });
  });
});

describe("mergeImportedHabits", () => {
  it("matches by name, merges ledgers day-wise by max, keeps identity", () => {
    const imported: Habit = { ...wake, id: "fresh", log: { "2026-08-07": 1, "2026-08-05": 1 } };
    const merged = mergeImportedHabits([wake, water], [imported]);
    expect(merged).toHaveLength(2);
    const w = merged.find((h) => h.name === "Wake up by 6")!;
    expect(w.id).toBe("h1"); // existing identity survives the re-import
    expect(w.log).toEqual({ "2026-08-07": 1, "2026-08-06": 1, "2026-08-05": 1 });
  });

  it("appends habits it has never seen", () => {
    const merged = mergeImportedHabits([wake], [swim]);
    expect(merged.map((h) => h.name)).toEqual(["Wake up by 6", "Swim"]);
  });

  it("import updates schedule and target", () => {
    const retargeted: Habit = { ...water, id: "fresh", timesPerDay: 10 };
    const merged = mergeImportedHabits([water], [retargeted]);
    expect(merged[0].timesPerDay).toBe(10);
  });
});
