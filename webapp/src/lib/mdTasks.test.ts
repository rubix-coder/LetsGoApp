// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseMarkdownTasks, parseTimeBlock, repeatOccursInRange, repeatOccursOn, stripMarkdownLinkSyntax, tasksToMarkdown } from "./mdTasks";
import { addDays, at, startOfDay } from "./dates";
import { occurrenceDateKey } from "./occurrence";
import type { AppState } from "./types";

/* Ported from src-tauri/src/todo/markdown_task_parser.rs tests. */
describe("markdown task parser (desktop parity)", () => {
  it("parses checkbox and plain bullets and nests by indent", () => {
    const md = [
      "# Today",
      "- [ ] solve two leetcode mediums",
      "- [x] morning standup",
      "* [X] review PR #3",
      "+ [ ] read CRDT paper",
      "  - [ ] indented subtask",
      "plain text line",
      "- not a checkbox",
      "- [z] not a valid marker",
    ].join("\n");
    const tasks = parseMarkdownTasks(md);
    expect(tasks).toHaveLength(7);
    expect(tasks[0]).toMatchObject({ title: "solve two leetcode mediums", alreadyCompleted: false, parentIndex: undefined });
    expect(tasks[1].alreadyCompleted).toBe(true);
    expect(tasks[2].alreadyCompleted).toBe(true);
    expect(tasks[4]).toMatchObject({ title: "indented subtask", parentIndex: 3 });
    expect(tasks[5]).toMatchObject({ title: "not a checkbox", alreadyCompleted: false });
    expect(tasks[6].title).toBe("[z] not a valid marker");
  });

  it("nests grandchildren and returns to the ancestor on dedent", () => {
    const tasks = parseMarkdownTasks("- Project\n    - Milestone\n        - Detail\n    - Second milestone\n");
    expect(tasks.map((t) => t.parentIndex)).toEqual([undefined, 0, 1, 0]);
  });

  it("strips [label](url) link syntax but keeps literal parens", () => {
    expect(stripMarkdownLinkSyntax("[How to focus](https://youtu.be/x)")).toBe("How to focus");
    expect(stripMarkdownLinkSyntax("C7: M1 (Revise)")).toBe("C7: M1 (Revise)");
  });
});

/* Ported from src-tauri/src/todo/time_block_parser.rs tests. */
describe("[block] time-block parser (desktop parity)", () => {
  it("parses the full shape with recurrence", () => {
    expect(parseTimeBlock("[block]lunch [1200:1300][1D]")).toEqual({
      label: "lunch", startMinuteOfDay: 720, endMinuteOfDay: 780, repeat: { interval: 1, unit: "daily" },
    });
    expect(parseTimeBlock("[BLOCK]gym [0630:0745][2w]")?.repeat).toEqual({ interval: 2, unit: "weekly" });
    expect(parseTimeBlock("[block]rent review [0900:0930][3M]")?.repeat).toEqual({ interval: 3, unit: "monthly" });
    // Y joined D/W/M when all-day events introduced the yearly unit — one
    // Repeat type serves tasks and blocks alike, so the token set follows it.
    expect(parseTimeBlock("[block]diwali prep [0900:1200][1Y]")?.repeat).toEqual({ interval: 1, unit: "yearly" });
  });

  it("a block without a repeat part is a one-off", () => {
    expect(parseTimeBlock("[block]dentist [1415:1500]")?.repeat).toBeUndefined();
  });

  it("rejects near-misses so plain titles stay tasks", () => {
    for (const bad of [
      "solve two leetcode mediums", "[z] not a valid marker", "[block] [1200:1300]",
      "[block]lunch [12:13]", "[block]lunch [2500:1300]", "[block]lunch [1300:1200]",
      "[block]lunch [1200:1300][1X]", "[block]lunch [1200:1300][0D]", "[block]lunch [1200:1300][1D] extra",
    ]) {
      expect(parseTimeBlock(bad)).toBeUndefined();
    }
  });
});

describe("recurrence expansion", () => {
  const day0 = startOfDay(Date.now());
  it("daily / weekly intervals land on the right days", () => {
    expect(repeatOccursOn(at(day0, 12), { interval: 2, unit: "daily" }, addDays(day0, 4))).toBe(true);
    expect(repeatOccursOn(at(day0, 12), { interval: 2, unit: "daily" }, addDays(day0, 3))).toBe(false);
    expect(repeatOccursOn(at(day0, 12), { interval: 1, unit: "weekly" }, addDays(day0, 7))).toBe(true);
    expect(repeatOccursOn(at(day0, 12), { interval: 1, unit: "weekly" }, addDays(day0, 8))).toBe(false);
  });
  it("without a rule only the anchor day matches, never before it", () => {
    expect(repeatOccursOn(at(day0, 12), undefined, day0)).toBe(true);
    expect(repeatOccursOn(at(day0, 12), undefined, addDays(day0, 1))).toBe(false);
    expect(repeatOccursOn(at(day0, 12), { interval: 1, unit: "daily" }, addDays(day0, -1))).toBe(false);
  });
  it("repeatOccursInRange finds an occurrence in a bounded window", () => {
    const anchor = at(day0, 12);
    // Yearly anchored today: no occurrence in the next 30 days…
    expect(repeatOccursInRange(anchor, { interval: 1, unit: "yearly" }, addDays(day0, 1), addDays(day0, 30))).toBe(false);
    // …but there is one ~a year out.
    expect(repeatOccursInRange(anchor, { interval: 1, unit: "yearly" }, addDays(day0, 300), addDays(day0, 400))).toBe(true);
    // Weekly always lands within any week-wide range.
    expect(repeatOccursInRange(anchor, { interval: 1, unit: "weekly" }, addDays(day0, 100), addDays(day0, 107))).toBe(true);
    // Inverted range is empty.
    expect(repeatOccursInRange(anchor, undefined, addDays(day0, 5), addDays(day0, 1))).toBe(false);
  });
});

describe("extended format — parsing", () => {
  it("reads all four checkbox glyphs", () => {
    const tasks = parseMarkdownTasks("- [ ] a\n- [/] b\n- [x] c\n- [-] d\n");
    expect(tasks.map((t) => t.status)).toEqual(["pending", "in_progress", "done", "skipped"]);
    expect(tasks.map((t) => t.title)).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves a bullet with no box stating nothing about status", () => {
    const [task] = parseMarkdownTasks("- just a bullet\n");
    expect(task.status).toBeUndefined();
    expect(task.alreadyCompleted).toBe(false);
  });

  it("still treats an unknown glyph as literal title text", () => {
    const [task] = parseMarkdownTasks("- [z] not a valid marker\n");
    expect(task.title).toBe("[z] not a valid marker");
    expect(task.status).toBeUndefined();
  });

  it("strips the token tail off the title and reads the fields", () => {
    const [task] = parseMarkdownTasks("- [ ] Ship it !P0 #work ~90m @id(a7x2)\n");
    expect(task.title).toBe("Ship it");
    expect(task.meta).toMatchObject({ priority: 0, tags: ["work"], estimateMin: 90, id: "a7x2" });
  });

  it("keeps the title identical whether or not fields are stated", () => {
    // The property that makes metadata edits safe: the matching key is the same.
    const plain = parseMarkdownTasks("- [ ] Ship it\n")[0].title;
    const rich = parseMarkdownTasks("- [ ] Ship it !P0 ~90m @lock\n")[0].title;
    expect(rich).toBe(plain);
  });

  it("takes > lines under a task as its description", () => {
    const [task] = parseMarkdownTasks("- [ ] Ship it\n    > First line.\n    > Second line.\n");
    expect(task.description).toBe("First line.\nSecond line.");
  });

  it("attaches > lines the editor has dedented to column 0", () => {
    // noteBlocks re-emits an un-indented quote at column 0, so attribution has
    // to be by adjacency or every reformatted description would be orphaned.
    const [task] = parseMarkdownTasks("- [ ] Ship it\n> Dedented but still mine.\n");
    expect(task.description).toBe("Dedented but still mine.");
  });

  it("sees through the blank line the editor injects before a quote", () => {
    const [task] = parseMarkdownTasks("- [ ] Ship it\n\n> Still mine.\n");
    expect(task.description).toBe("Still mine.");
  });

  it("does not let a description reattach across intervening prose", () => {
    const tasks = parseMarkdownTasks("- [ ] Ship it\nSome unrelated prose.\n> Not a description.\n");
    expect(tasks[0].description).toBeUndefined();
  });

  it("gives each task its own description", () => {
    const tasks = parseMarkdownTasks("- [ ] A\n    > mine\n- [ ] B\n    > yours\n");
    expect(tasks[0].description).toBe("mine");
    expect(tasks[1].description).toBe("yours");
  });

  it("lets a time block carry tokens, which the old parser refused", () => {
    // Previously any trailing text invalidated the whole block line.
    const [entry] = parseMarkdownTasks("- [block]lunch [1200:1300][1D] #food\n");
    expect(parseTimeBlock(entry.title)).toMatchObject({ label: "lunch", startMinuteOfDay: 720 });
    expect(entry.meta.tags).toEqual(["food"]);
  });

  it("keeps nesting working with tails on every line", () => {
    const tasks = parseMarkdownTasks("- [ ] Root !P0\n    - [x] Child ~30m\n        - [/] Grandchild @lock\n");
    expect(tasks.map((t) => t.parentIndex)).toEqual([undefined, 0, 1]);
    expect(tasks.map((t) => t.title)).toEqual(["Root", "Child", "Grandchild"]);
  });
});

describe("markdown export", () => {
  it("round-trips nesting and checkboxes", () => {
    const state = {
      tasks: [
        { id: "a", title: "Parent", status: "in_progress", priority: 1, tags: [], createdAt: 1, loggedMin: 0 },
        { id: "b", title: "Child done", status: "done", priority: 1, tags: [], createdAt: 2, loggedMin: 0, parentId: "a" },
      ],
      blocks: [{ id: "bl", title: "lunch", start: at(startOfDay(Date.now()), 12), durationMin: 60, repeat: { interval: 1, unit: "daily" as const } }],
    } as unknown as AppState;
    const md = tasksToMarkdown(state);
    // `in_progress` now has a box of its own. It used to collapse to `[ ]` and
    // be silently lost on re-import; that was the point of extending the glyphs.
    expect(md).toContain("- [/] Parent");
    expect(md).toContain("    - [x] Child done");
    expect(md).toContain("- [block]lunch [1200:1300][1D]");
    const reparsed = parseMarkdownTasks(md);
    expect(reparsed.find((t) => t.title === "Child done")?.parentIndex)
      .toBe(reparsed.findIndex((t) => t.title === "Parent"));
    expect(reparsed.find((t) => t.title === "Parent")?.status).toBe("in_progress");
    expect(reparsed.find((t) => t.title === "Child done")?.status).toBe("done");
  });

  it("carries every editor field through a full round trip", () => {
    const day = startOfDay(Date.now());
    const state = {
      tasks: [
        {
          id: "a", mdKey: "a1b2", title: "Ship the pipeline", status: "pending", priority: 0,
          tags: ["work", "deep"], estimateMin: 90, scheduledAt: at(day, 9), deadline: at(addDays(day, 2), 17),
          locked: true, comment: "ask Priya", description: "Needs the schema frozen.\nSee [[Export notes]].",
          createdAt: 1, loggedMin: 0,
        },
        {
          id: "b", mdKey: "b3k4", title: "Draft the schema", status: "done", priority: 2,
          tags: [], createdAt: 2, loggedMin: 0, parentId: "a",
        },
      ],
      blocks: [],
    } as unknown as AppState;

    const [root, child] = parseMarkdownTasks(tasksToMarkdown(state));
    expect(root.title).toBe("Ship the pipeline");
    expect(root.meta).toMatchObject({
      id: "a1b2", priority: 0, tags: ["work", "deep"], estimateMin: 90,
      scheduledAt: at(day, 9), deadline: at(addDays(day, 2), 17), locked: true, comment: "ask Priya",
    });
    expect(root.description).toBe("Needs the schema frozen.\nSee [[Export notes]].");
    expect(child.meta.id).toBe("b3k4");
    expect(child.parentIndex).toBe(0);
  });

  it("mints a key for a task that has never been stamped", () => {
    const state = {
      tasks: [{ id: "a", title: "Unstamped", status: "pending", priority: 2, tags: [], createdAt: 1, loggedMin: 0 }],
      blocks: [],
    } as unknown as AppState;
    expect(parseMarkdownTasks(tasksToMarkdown(state))[0].meta.id).toMatch(/^[a-z0-9]{4}$/);
  });

  it("names dependencies by task text, never by key", () => {
    const state = {
      tasks: [
        { id: "a", mdKey: "aaaa", title: "Draft the schema", status: "done", priority: 2, tags: [], createdAt: 1, loggedMin: 0 },
        { id: "b", mdKey: "bbbb", title: "Wire the writer", status: "pending", priority: 2, tags: [], createdAt: 2, loggedMin: 0, dependsOn: ["a"] },
      ],
      blocks: [],
    } as unknown as AppState;
    const md = tasksToMarkdown(state);
    expect(md).toContain("@after(Draft the schema)");
    expect(parseMarkdownTasks(md)[1].meta.after).toEqual(["Draft the schema"]);
  });

  it("exports a routine's box from today's occurrence, not the template", () => {
    const day = startOfDay(Date.now());
    const key = new Date(day).toISOString().slice(0, 10).replace(/-/g, "-");
    void key;
    const state = {
      tasks: [{
        id: "a", mdKey: "cccc", title: "Stretch", status: "pending", priority: 2, tags: [],
        createdAt: 1, loggedMin: 0, scheduledAt: at(day, 7), repeat: { interval: 1, unit: "daily" as const },
        occurrenceStatus: { [occurrenceDateKey(Date.now())]: "done" as const },
      }],
      blocks: [],
    } as unknown as AppState;
    // The template says pending; today is done, and that is what the note shows.
    expect(tasksToMarkdown(state)).toContain("- [x] Stretch");
  });
});
