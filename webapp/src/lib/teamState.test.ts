// @vitest-environment node
import { describe, expect, it } from "vitest";
import { teamStateFrom } from "./store";
import { seedState } from "./seed";

describe("teamStateFrom", () => {
  it("treats a brand-new project's empty doc as a clean, valid workspace", () => {
    const s = teamStateFrom({});
    expect(s.tasks).toEqual([]);
    expect(s.notes).toEqual([]);
    expect(s.blocks).toEqual([]);
    // Settings still come from the seed so the shell has a valid config.
    expect(s.settings.plugins.todo).toBe(true);
  });

  it("handles a null/garbage doc the same as an empty one", () => {
    expect(teamStateFrom(null).tasks).toEqual([]);
    expect(teamStateFrom("nope").tasks).toEqual([]);
  });

  it("keeps a real document's content", () => {
    const doc = { ...seedState(), tasks: [{ id: "t1", title: "Ship", status: "pending", priority: 2, tags: [], createdAt: 1, loggedMin: 0 }] };
    const s = teamStateFrom(doc);
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0].title).toBe("Ship");
  });

  it("backfills settings fields added since the doc was written", () => {
    const doc = { ...seedState(), tasks: [], settings: { theme: "dark" } };
    const s = teamStateFrom(doc);
    expect(s.settings.theme).toBe("dark");
    // A field the stored doc never had is filled from the seed defaults.
    expect(s.settings.plugins).toBeDefined();
  });
});
