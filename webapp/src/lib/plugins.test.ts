// @vitest-environment node
import { describe, expect, it } from "vitest";
import { movePlugin, orderedPlugins } from "./plugins";
import { PLUGIN_META, type PluginId } from "./types";

const ALL = PLUGIN_META.map((p) => p.id);

describe("orderedPlugins", () => {
  it("falls back to the built-in order when nothing is stored", () => {
    expect(orderedPlugins(undefined).map((p) => p.id)).toEqual(ALL);
    expect(orderedPlugins([]).map((p) => p.id)).toEqual(ALL);
  });

  it("honours a complete stored order", () => {
    const order = [...ALL].reverse();
    expect(orderedPlugins(order).map((p) => p.id)).toEqual(order);
  });

  it("appends plugins the stored order never knew about", () => {
    // Exactly what happens to anyone who reordered before a new plugin
    // shipped — without this the new tab would simply never appear.
    const stale: PluginId[] = ["notes", "todo"];
    const result = orderedPlugins(stale).map((p) => p.id);
    expect(result.slice(0, 2)).toEqual(["notes", "todo"]);
    expect([...result].sort()).toEqual([...ALL].sort());
  });

  it("drops ids that are no longer plugins", () => {
    const result = orderedPlugins(["notes", "ghost" as PluginId, "todo"]).map((p) => p.id);
    expect(result).not.toContain("ghost");
    expect(result).toHaveLength(ALL.length);
  });

  it("survives a duplicated id without repeating the row", () => {
    const result = orderedPlugins(["notes", "notes", "todo"]).map((p) => p.id);
    expect(result.filter((id) => id === "notes")).toHaveLength(1);
    expect(result).toHaveLength(ALL.length);
  });
});

describe("movePlugin", () => {
  /* Insertion is "just before the target", matching reorderFolder — and the
     result is always the COMPLETE list, because orderedPlugins fills in
     anything the stored order omitted. */
  it("drops the row just before its target when moving down", () => {
    const order: PluginId[] = ["todo", "timer", "notes", "mindmap", "dashboard", "library"];
    expect(movePlugin(order, "todo", "notes")).toEqual(
      ["timer", "todo", "notes", "mindmap", "dashboard", "library", "habits"],
    );
  });

  it("drops the row just before its target when moving up", () => {
    const order: PluginId[] = ["todo", "timer", "notes", "mindmap", "dashboard", "library"];
    expect(movePlugin(order, "library", "timer")).toEqual(
      ["todo", "library", "timer", "notes", "mindmap", "dashboard", "habits"],
    );
  });

  it("is a no-op when dropped on itself", () => {
    const order: PluginId[] = ["todo", "timer", "notes"];
    expect(movePlugin(order, "timer", "timer")).toEqual(orderedPlugins(order).map((p) => p.id));
  });

  it("always returns every plugin, so a partial stored order self-repairs", () => {
    const result = movePlugin(["notes"] as PluginId[], "todo", "notes");
    expect([...result].sort()).toEqual([...ALL].sort());
  });

  it("returns a complete order even when starting from nothing", () => {
    const result = movePlugin(undefined, "library", "todo");
    expect(result[0]).toBe("library");
    expect([...result].sort()).toEqual([...ALL].sort());
  });
});
