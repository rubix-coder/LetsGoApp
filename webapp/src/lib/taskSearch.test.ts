import { describe, expect, it } from "vitest";
import { searchTaskTree, taskMatches } from "./taskSearch";
import type { Task } from "./types";

let n = 0;
function task(t: Partial<Task> & Pick<Task, "title">): Task {
  return { id: t.id ?? `t${++n}`, status: "pending", priority: 2, tags: [], createdAt: 0, loggedMin: 0, ...t } as Task;
}

const parent = task({ id: "p", title: "Parivartan curriculum" });
const child = task({ id: "c", title: "Dynamic programming sprint", parentId: "p", tags: ["dsa"] });
const grandchild = task({ id: "g", title: "Knapsack variants", parentId: "c" });
const loner = task({ id: "l", title: "Renew passport", tags: ["errand", "gov"] });
const all = [parent, child, grandchild, loner];
const roots = [parent, loner];

describe("taskMatches", () => {
  it("matches title case-insensitively", () => {
    expect(taskMatches(child, "dynamic")).toBe(true);
    expect(taskMatches(child, "DYNAMIC PRO")).toBe(true);
    expect(taskMatches(child, "swimming")).toBe(false);
  });

  it("matches tags with or without the # the placeholder advertises", () => {
    expect(taskMatches(loner, "#errand")).toBe(true);
    expect(taskMatches(loner, "errand")).toBe(true);
    expect(taskMatches(loner, "#err")).toBe(true); // partial tag still counts
  });

  it("a #query never matches titles", () => {
    expect(taskMatches(task({ title: "#hash in title" }), "#hash")).toBe(false);
  });
});

describe("searchTaskTree", () => {
  it("keeps a root when only a nested subtask matches — the imported-schedule case", () => {
    const { roots: found } = searchTaskTree(roots, all, "knapsack");
    expect(found.map((t) => t.id)).toEqual(["p"]);
  });

  it("returns the whole matched subtree in ids so tree views can render children", () => {
    const { ids } = searchTaskTree(roots, all, "knapsack");
    expect(ids).toEqual(new Set(["p", "c", "g"]));
  });

  it("matches roots directly too", () => {
    const { roots: found } = searchTaskTree(roots, all, "passport");
    expect(found.map((t) => t.id)).toEqual(["l"]);
  });

  it("drops everything on a miss", () => {
    expect(searchTaskTree(roots, all, "zzz").roots).toEqual([]);
  });

  it("empty query keeps every root and claims no ids", () => {
    const { roots: found, ids } = searchTaskTree(roots, all, "  ");
    expect(found).toEqual(roots);
    expect(ids).toBeNull();
  });
});
