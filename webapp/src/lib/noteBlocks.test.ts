// @vitest-environment node
import { describe, expect, it } from "vitest";
import { autoformat, blockToMarkdown, emptyTable, parseBlocks, parseTable, serializeBlocks, serializeTable, type Block } from "./noteBlocks";

describe("note block engine", () => {
  it("parses each markdown shape into the right block type", () => {
    const blocks = parseBlocks(
      "# Title\n\npara\n\n## Sub\n- bullet\n- [ ] todo\n- [x] done\n1. one\n> quote\n> [!warn] heads up\n---",
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "h1", "p", "h2", "ul", "todo", "todo-done", "ol", "quote", "callout", "divider",
    ]);
    expect(blocks.find((b) => b.type === "callout")).toMatchObject({ text: "heads up", meta: "warn" });
    expect(blocks.find((b) => b.type === "h1")!.text).toBe("Title");
  });

  it("captures a fenced code block, language and body, as one block", () => {
    const blocks = parseBlocks("```ts\nconst x = 1;\nconst y = 2;\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "code", meta: "ts", text: "const x = 1;\nconst y = 2;" });
  });

  it("round-trips markdown through parse ∘ serialize", () => {
    const md = "# Roadmap\n\nShip it.\n\n- a\n- b\n\n- [ ] task\n\n> [!tip] note";
    expect(serializeBlocks(parseBlocks(md))).toBe(md);
  });

  it("keeps list items tight but separates prose with a blank line", () => {
    const out = serializeBlocks([
      { type: "ul", text: "a" }, { type: "ul", text: "b" }, { type: "p", text: "after" },
    ] as Block[]);
    expect(out).toBe("- a\n- b\n\nafter");
  });

  it("serializes a to-do checkbox state and keeps it Todo-sync compatible", () => {
    expect(blockToMarkdown({ type: "todo", text: "x" })).toBe("- [ ] x");
    expect(blockToMarkdown({ type: "todo-done", text: "x" })).toBe("- [x] x");
  });

  it("parses an EMPTY to-do as a to-do (planner-template scaffold)", () => {
    // Trailing whitespace is stripped before matching, so an empty box is
    // "- [ ]"; it must still be a to-do, not a bullet with literal "[ ]" text.
    expect(parseBlocks("- [ ] ").map((b) => ({ type: b.type, text: b.text }))).toEqual([{ type: "todo", text: "" }]);
    expect(parseBlocks("- [ ]").map((b) => b.type)).toEqual(["todo"]);
    expect(parseBlocks("- [x] ").map((b) => b.type)).toEqual(["todo-done"]);
  });

  it("parses and round-trips an indented (nested) list", () => {
    const md = "- a\n  - b\n  - c\n- d";
    const blocks = parseBlocks(md);
    expect(blocks.map((b) => b.indent ?? 0)).toEqual([0, 1, 1, 0]);
    expect(serializeBlocks(blocks)).toBe(md);
  });

  it("keeps deep multi-level nesting as bullets, not flat paragraphs", () => {
    // Mirrors a real outline note: pre-fix these indented lines parsed as <p>
    // showing a literal "- ", collapsing every level to the left margin.
    const md = "- DSA Level 1\n  - Introduction\n    - RAM\n  - Linked Lists\n    - Singly Linked Lists\n      - Traversal";
    const blocks = parseBlocks(md);
    expect(blocks.every((b) => b.type === "ul")).toBe(true); // all bullets, no paragraphs
    expect(blocks.map((b) => b.indent ?? 0)).toEqual([0, 1, 2, 1, 2, 3]);
    expect(serializeBlocks(blocks)).toBe(md);
  });

  it("autoformats leading tokens into block types", () => {
    expect(autoformat("## Heading")).toMatchObject({ type: "h2", text: "Heading" });
    expect(autoformat("[] buy milk")).toMatchObject({ type: "todo", text: "buy milk" });
    expect(autoformat("- item")).toMatchObject({ type: "ul", text: "item" });
    expect(autoformat("3. third")).toMatchObject({ type: "ol", text: "third", meta: "3" });
    expect(autoformat("> quoted")).toMatchObject({ type: "quote", text: "quoted" });
    expect(autoformat("plain text")).toBeNull();
  });
});

describe("GFM tables", () => {
  const md = "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";

  it("captures a header + separator + body as one table block", () => {
    const blocks = parseBlocks(`intro\n\n${md}\n\nafter`);
    expect(blocks.map((b) => b.type)).toEqual(["p", "table", "p"]);
    expect(blocks[1].text).toBe(md);
  });

  it("does not treat a lone pipe line (no separator) as a table", () => {
    expect(parseBlocks("| just | text |").every((b) => b.type === "p")).toBe(true);
  });

  it("round-trips a table through parse ∘ serialize (block engine)", () => {
    expect(serializeBlocks(parseBlocks(md))).toBe(md);
    expect(blockToMarkdown({ type: "table", text: md })).toBe(md);
  });

  it("reads the grid (header row first, separator dropped)", () => {
    expect(parseTable(md).rows).toEqual([["A", "B"], ["1", "2"], ["3", "4"]]);
  });

  it("round-trips the grid and preserves internal spaces", () => {
    const grid = { rows: [["Col A", "Col B"], ["a b", "c"]] };
    expect(parseTable(serializeTable(grid)).rows).toEqual(grid.rows);
  });

  it("builds a blank rows×cols table (row 0 is the header)", () => {
    const t = parseTable(emptyTable(3, 2));
    expect(t.rows).toHaveLength(3);
    expect(t.rows.every((r) => r.length === 2 && r.every((c) => c === ""))).toBe(true);
  });
});
