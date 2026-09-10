// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildNotesGraph, buildOutlineGraph, buildTaskGraph, buildWebGraph } from "./notesGraph";
import { newTask } from "./store";
import type { Note, NoteFolder } from "./types";

const folders: NoteFolder[] = [{ id: "f1", name: "Work" }];
const NOW = 1_000_000_000_000;
const notes: Note[] = [
  { id: "nA", folderId: "f1", title: "Alpha", body: "See [[Beta]]", updatedAt: NOW },
  { id: "nB", folderId: "f1", title: "Beta", body: "", parentId: "nA", updatedAt: NOW },
  { id: "nC", folderId: "f1", title: "Gamma", body: "no links here", updatedAt: NOW - 40 * 86_400_000 },
];
const tasks = [
  newTask({ title: "t1", status: "pending", description: "From [[Alpha]]" }),
  newTask({ title: "t2", status: "done", description: "From [[Alpha]]" }),
];

describe("notes graph lens", () => {
  const g = buildNotesGraph(folders, notes, tasks, NOW);
  const byId = (id: string) => g.nodes.find((n) => n.id === id)!;

  it("builds the folder → note → subpage hierarchy with child edges", () => {
    expect(byId("folder:f1")).toBeTruthy();
    expect(byId("note:nA").kind).toBe("note");
    expect(g.edges).toContainEqual(expect.objectContaining({ from: "folder:f1", to: "note:nA", kind: "child" }));
    expect(g.edges).toContainEqual(expect.objectContaining({ from: "note:nA", to: "note:nB", kind: "child" }));
    // depth places subpage further right than its parent, parent right of folder.
    expect(byId("note:nB").x).toBeGreaterThan(byId("note:nA").x);
    expect(byId("note:nA").x).toBeGreaterThan(byId("folder:f1").x);
  });

  it("rolls open-task counts up to the parent and folder, and rings completion", () => {
    expect(byId("note:nA").badge).toBe(1); // one open task links to Alpha
    expect(byId("folder:f1").badge).toBe(1); // rolled up
    expect(byId("note:nA").ring).toBeCloseTo(0.5); // 1 of 2 linked tasks done
  });

  it("adds a dashed wikilink edge and flags orphans and staleness", () => {
    expect(g.edges).toContainEqual(expect.objectContaining({ from: "note:nA", to: "note:nB", kind: "link" }));
    expect(byId("note:nC").flags).toContain("orphan"); // no links, no subpages, no parent
    expect(byId("note:nC").flags).toContain("stale"); // updated 40 days ago
    expect(g.stats.find((s) => s.label === "links")!.value).toBe(1);
  });
});

describe("task graph lens", () => {
  const root = newTask({ title: "Ship", status: "in_progress" });
  const c1 = newTask({ title: "a", status: "done", parentId: root.id });
  const c2 = newTask({ title: "b", status: "pending", parentId: root.id });
  const g = buildTaskGraph([root, c1, c2]);

  it("lays out the task tree with a completion ring on the parent", () => {
    const r = g.nodes.find((n) => n.id === `task:${root.id}`)!;
    expect(r.badge).toBe(2); // two subtasks
    expect(r.ring).toBeCloseTo(0.5); // one of two done
    expect(g.edges).toContainEqual(expect.objectContaining({ from: `task:${root.id}`, to: `task:${c1.id}`, kind: "child" }));
    expect(g.stats.find((s) => s.label === "tasks")!.value).toBe(3);
  });
});

describe("web + outline lenses", () => {
  it("web keeps only linked notes and one edge per pair", () => {
    const web = buildWebGraph([
      { id: "x", folderId: "f1", title: "X", body: "[[Y]]", updatedAt: NOW },
      { id: "y", folderId: "f1", title: "Y", body: "[[X]]", updatedAt: NOW },
      { id: "z", folderId: "f1", title: "Z", body: "alone", updatedAt: NOW },
    ]);
    expect(web.nodes.map((n) => n.id).sort()).toEqual(["note:x", "note:y"]);
    expect(web.edges).toHaveLength(1);
  });

  it("outline turns a note's headings and bullets into a rooted topic tree", () => {
    const note: Note = { id: "n1", folderId: "f1", title: "Plan", body: "# Goals\n- ship\n- test\n# Risks", updatedAt: NOW };
    const g = buildOutlineGraph(note);
    expect(g.nodes[0]).toMatchObject({ id: "topic:n1", label: "Plan" });
    expect(g.nodes.some((n) => n.label === "Goals")).toBe(true);
    expect(g.nodes.some((n) => n.label === "ship")).toBe(true);
    // bullets nest under the preceding heading.
    const goals = g.nodes.find((n) => n.label === "Goals")!;
    const ship = g.nodes.find((n) => n.label === "ship")!;
    expect(g.edges).toContainEqual(expect.objectContaining({ from: goals.id, to: ship.id }));
  });
});
