// @vitest-environment node
import { describe, expect, it } from "vitest";
import { branchMatches, childIndex, countMatching, isLeaf, latestCompleted } from "./taskTree";
import { newTask } from "./store";
import type { Task } from "./types";

/* A parent "Website" with two branches:
   - Design (parent) → Hero (in_progress), Copy (done)
   - Ship (done, leaf)                                          */
function tree(): Task[] {
  const web = newTask({ title: "Website" });
  const design = newTask({ title: "Design", parentId: web.id });
  const hero = newTask({ title: "Hero", parentId: design.id, status: "in_progress" });
  const copy = newTask({ title: "Copy", parentId: design.id, status: "done", completedAt: 200 });
  const ship = newTask({ title: "Ship", parentId: web.id, status: "done", completedAt: 500 });
  return [web, design, hero, copy, ship];
}

describe("task-tree split helpers (Kanban)", () => {
  const t = tree();
  const idx = childIndex(t);
  const [web, design, hero] = t;

  it("treats only childless tasks as leaves", () => {
    expect(isLeaf(idx, web.id)).toBe(false);
    expect(isLeaf(idx, design.id)).toBe(false);
    expect(isLeaf(idx, hero.id)).toBe(true); // Hero
  });

  it("splits a parent into exactly the columns its leaves fall in", () => {
    expect(branchMatches(idx, web, "in_progress")).toBe(true); // Hero
    expect(branchMatches(idx, web, "done")).toBe(true); // Copy, Ship
    expect(branchMatches(idx, web, "pending")).toBe(false);
    expect(branchMatches(idx, web, "skipped")).toBe(false);
    // A sub-branch is only in the columns of its own leaves.
    expect(branchMatches(idx, design, "done")).toBe(true); // Copy
    expect(branchMatches(idx, design, "in_progress")).toBe(true); // Hero
  });

  it("counts the matching leaves per status", () => {
    expect(countMatching(idx, web, "done")).toBe(2); // Copy + Ship
    expect(countMatching(idx, web, "in_progress")).toBe(1); // Hero
    expect(countMatching(idx, design, "done")).toBe(1); // Copy only
  });

  it("orders Done split cards by their most recent completion", () => {
    expect(latestCompleted(idx, web)).toBe(500); // Ship, the newest done leaf
    expect(latestCompleted(idx, design)).toBe(200); // Copy
  });

  it("folds a paused leaf into the In-progress column", () => {
    const p = newTask({ title: "P" });
    const a = newTask({ title: "A", parentId: p.id, status: "paused" });
    const b = newTask({ title: "B", parentId: p.id, status: "done", completedAt: 1 });
    const i = childIndex([p, a, b]);
    expect(branchMatches(i, p, "in_progress")).toBe(true);
    expect(countMatching(i, p, "in_progress")).toBe(1);
    expect(branchMatches(i, p, "pending")).toBe(false);
  });
});
