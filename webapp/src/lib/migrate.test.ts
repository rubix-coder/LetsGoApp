// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hydrateState } from "./migrate";
import { seedState } from "./seed";
import type { AppState } from "./types";

/** A state as an older build would have persisted it: fields that did not
    exist yet are simply absent, so the cast is the honest shape of the input. */
function oldVault(patch: Partial<AppState> = {}): AppState {
  const state: Record<string, unknown> = { ...seedState(), ...patch };
  delete state.books;
  delete state.quickTimers;
  return state as unknown as AppState;
}

describe("hydrateState", () => {
  it("fills a books array that predates the Library plugin", () => {
    expect(hydrateState(oldVault()).books).toEqual([]);
  });

  it("still fills quickTimers — the case this replaced", () => {
    expect(hydrateState(oldVault()).quickTimers).toEqual([]);
  });

  it("never clobbers books that are already there", () => {
    const seed = seedState();
    expect(hydrateState(seed).books).toBe(seed.books);
  });

  it("moves a Todo landing sub-route onto the setting that now owns it", () => {
    const state = oldVault();
    state.settings = { ...state.settings, landingView: "todo/board/gantt" };
    delete (state.settings as unknown as Record<string, unknown>).todoDefaultView;
    const out = hydrateState(state).settings;
    expect(out.todoDefaultView).toBe("todo/board/gantt");
    expect(out.landingView).toBe("todo");
  });

  it("leaves a Todo view the user has already picked alone", () => {
    const state = oldVault();
    state.settings = { ...state.settings, landingView: "todo/board/gantt", todoDefaultView: "todo/calendar" };
    const out = hydrateState(state).settings;
    expect(out.todoDefaultView).toBe("todo/calendar");
    expect(out.landingView).toBe("todo");
  });

  it("leaves a landing view on any other plugin untouched", () => {
    const state = oldVault();
    state.settings = { ...state.settings, landingView: "notes" };
    const out = hydrateState(state).settings;
    expect(out.landingView).toBe("notes");
    expect(out.todoDefaultView).toBe("last");
  });

  it("adds a newly-introduced plugin id that an older vault cannot know about", () => {
    const state = oldVault();
    state.settings = {
      ...state.settings,
      // An older build's plugins object: every id it knew, and nothing more.
      plugins: { todo: true, timer: true, notes: true, mindmap: true, dashboard: true } as AppState["settings"]["plugins"],
    };
    expect(hydrateState(state).settings.plugins.library).toBe(true);
  });

  it("respects a plugin the user deliberately switched off", () => {
    const state = oldVault();
    state.settings = { ...state.settings, plugins: { ...state.settings.plugins, mindmap: false } };
    const next = hydrateState(state);
    expect(next.settings.plugins.mindmap).toBe(false);
    expect(next.settings.plugins.library).toBe(true);
  });

  it("fills settings scalars added since the vault was written", () => {
    const state = oldVault();
    const settings = { ...state.settings } as Partial<AppState["settings"]>;
    delete settings.hourFormat;
    state.settings = settings as AppState["settings"];
    expect(hydrateState(state).settings.hourFormat).toBe(seedState().settings.hourFormat);
  });

  it("leaves user settings alone where they are set", () => {
    const state = oldVault();
    state.settings = { ...state.settings, theme: "light", weekStart: 1 };
    const next = hydrateState(state);
    expect(next.settings.theme).toBe("light");
    expect(next.settings.weekStart).toBe(1);
  });

  it("is a no-op on an already-current state", () => {
    const seed = seedState();
    expect(hydrateState(seed)).toEqual(seed);
  });

  /* Tasks used to carry a single `habitId`. The set of habits a task can
     feed is now a list, and an older vault's single id has to survive the
     upgrade — losing it would silently break every streak the user had wired
     up to a task. */
  it("carries a legacy single habitId into the habitIds list", () => {
    const legacy = oldVault({
      tasks: [{ id: "t", title: "Meditate", status: "pending", priority: 2, tags: [], createdAt: 0, loggedMin: 0, habitId: "h1" }],
    } as unknown as Partial<AppState>);
    const [task] = hydrateState(legacy).tasks;
    expect(task.habitIds).toEqual(["h1"]);
    expect("habitId" in task).toBe(false);
  });

  it("leaves a task that was never linked without an empty list to carry", () => {
    const plain = oldVault({
      tasks: [{ id: "t", title: "Shop", status: "pending", priority: 2, tags: [], createdAt: 0, loggedMin: 0 }],
    } as unknown as Partial<AppState>);
    expect(hydrateState(plain).tasks[0].habitIds).toBeUndefined();
  });

  it("prefers an already-migrated list over the legacy field", () => {
    const both = oldVault({
      tasks: [{ id: "t", title: "x", status: "pending", priority: 2, tags: [], createdAt: 0, loggedMin: 0, habitId: "old", habitIds: ["a", "b"] }],
    } as unknown as Partial<AppState>);
    expect(hydrateState(both).tasks[0].habitIds).toEqual(["a", "b"]);
  });

  it("does not touch the other collections", () => {
    const seed = seedState();
    const next = hydrateState(seed);
    expect(next.tasks).toBe(seed.tasks);
    expect(next.notes).toBe(seed.notes);
    expect(next.sessions).toBe(seed.sessions);
  });
});
