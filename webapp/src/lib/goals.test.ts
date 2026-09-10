// @vitest-environment node
import { describe, expect, it } from "vitest";
import { goalProgress, hasGoalTag } from "./goals";
import type { Note, Task } from "./types";

const note = (p: Partial<Note> & Pick<Note, "id" | "title">): Note => ({
  folderId: "f", body: "", updatedAt: 0, ...p,
});

const task = (p: Partial<Task> & Pick<Task, "id">): Task => ({
  title: p.id, status: "pending", priority: 2, tags: [], createdAt: 0, loggedMin: 0, ...p,
});

describe("hasGoalTag", () => {
  it("matches case-insensitively and ignores surrounding space", () => {
    expect(hasGoalTag(note({ id: "n", title: "T", tags: ["GOAL"] }))).toBe(true);
    expect(hasGoalTag(note({ id: "n", title: "T", tags: ["goal"] }))).toBe(true);
    expect(hasGoalTag(note({ id: "n", title: "T", tags: [" Goal "] }))).toBe(true);
    expect(hasGoalTag(note({ id: "n", title: "T", tags: ["goals"] }))).toBe(false);
    expect(hasGoalTag(note({ id: "n", title: "T" }))).toBe(false);
  });
});

describe("goalProgress", () => {
  it("is empty when nothing is tagged", () => {
    expect(goalProgress({ notes: [note({ id: "n", title: "DSA" })], tasks: [] })).toEqual([]);
  });

  it("counts linked leaf tasks across the page subtree", () => {
    const notes = [
      note({ id: "root", title: "DSA", tags: ["GOAL"] }),
      note({ id: "kid", title: "Graphs", parentId: "root" }),
    ];
    const tasks = [
      task({ id: "1", source: "DSA", status: "done" }),
      task({ id: "2", source: "DSA", status: "pending" }),
      task({ id: "3", source: "Graphs", status: "done" }),
      task({ id: "4", source: "Unrelated", status: "done" }),
    ];
    const [g] = goalProgress({ notes, tasks });
    expect(g.basis).toBe("tasks");
    expect({ done: g.done, total: g.total }).toEqual({ done: 2, total: 3 });
    expect(g.ratio).toBeCloseTo(2 / 3);
    expect(g.pageCount).toBe(2);
  });

  it("ignores parent tasks so a branching plan is not weighted differently", () => {
    const notes = [note({ id: "root", title: "DSA", tags: ["GOAL"] })];
    const tasks = [
      task({ id: "p", source: "DSA", status: "done" }),
      task({ id: "c1", source: "DSA", status: "done", parentId: "p" }),
      task({ id: "c2", source: "DSA", status: "pending", parentId: "p" }),
    ];
    const [g] = goalProgress({ notes, tasks });
    expect({ done: g.done, total: g.total }).toEqual({ done: 1, total: 2 });
  });

  it("drops skipped tasks from the denominator", () => {
    const notes = [note({ id: "root", title: "DSA", tags: ["GOAL"] })];
    const tasks = [
      task({ id: "1", source: "DSA", status: "done" }),
      task({ id: "2", source: "DSA", status: "skipped" }),
    ];
    const [g] = goalProgress({ notes, tasks });
    expect({ done: g.done, total: g.total }).toEqual({ done: 1, total: 1 });
    expect(g.ratio).toBe(1);
  });

  it("falls back to note checkboxes when no tasks are linked", () => {
    const notes = [
      note({ id: "root", title: "Reading", tags: ["GOAL"], body: "# Reading\n\n- [x] Chapter 1\n- [ ] Chapter 2\n" }),
      note({ id: "kid", title: "Part 2", parentId: "root", body: "- [x] Chapter 3\n" }),
    ];
    const [g] = goalProgress({ notes, tasks: [] });
    expect(g.basis).toBe("checkboxes");
    expect({ done: g.done, total: g.total }).toEqual({ done: 2, total: 3 });
  });

  it("prefers linked tasks over checkboxes so a sent bullet is not counted twice", () => {
    const notes = [note({ id: "root", title: "DSA", tags: ["GOAL"], body: "- [ ] Dijkstra\n- [ ] Topo sort\n" })];
    const tasks = [task({ id: "1", source: "DSA", status: "done" })];
    const [g] = goalProgress({ notes, tasks });
    expect(g.basis).toBe("tasks");
    expect({ done: g.done, total: g.total }).toEqual({ done: 1, total: 1 });
  });

  // "take the top most parent" — a nested page that also carries GOAL is part
  // of the outer goal, not a rival headline beside it.
  it("reports only the outermost tagged page in a branch", () => {
    const notes = [
      note({ id: "root", title: "DSA", tags: ["GOAL"] }),
      note({ id: "kid", title: "Graphs", parentId: "root", tags: ["GOAL"] }),
      note({ id: "other", title: "Fitness", tags: ["GOAL"] }),
    ];
    const ids = goalProgress({ notes, tasks: [] }).map((g) => g.note.id);
    expect(ids).toEqual(["root", "other"]);
  });

  it("a goal with nothing to measure reports zero rather than dividing by zero", () => {
    const [g] = goalProgress({ notes: [note({ id: "root", title: "New", tags: ["GOAL"] })], tasks: [] });
    expect({ done: g.done, total: g.total, ratio: g.ratio }).toEqual({ done: 0, total: 0, ratio: 0 });
  });

  it("survives a parentId cycle instead of hanging", () => {
    const notes = [
      note({ id: "a", title: "A", parentId: "b", tags: ["GOAL"] }),
      note({ id: "b", title: "B", parentId: "a" }),
    ];
    expect(() => goalProgress({ notes, tasks: [] })).not.toThrow();
  });
});
