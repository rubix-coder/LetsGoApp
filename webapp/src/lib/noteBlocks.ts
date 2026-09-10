/* Block engine for the Notes editor. Parses a markdown note body into a flat
   list of Notion-style blocks and serializes them back. Markdown stays the
   source of truth (note.body), so .md export and Send-to-Todo are unchanged —
   the blocks are only a structured *view* over the same string, round-tripping
   through parseBlocks ∘ serializeBlocks. */

export type BlockType =
  | "p" | "h1" | "h2" | "h3"
  | "ul" | "ol"
  | "todo" | "todo-done"
  | "quote" | "callout"
  | "code" | "divider" | "table";

export interface Block {
  type: BlockType;
  /** Content WITHOUT the markdown prefix ("Hello" for "# Hello"). For a code
      block this is the (possibly multi-line) body; for a divider it is "". */
  text: string;
  /** Type-specific: callout kind (info|warn|tip|success), the ordered-list
      number, or a code language. */
  meta?: string;
  /** Nesting level for list items (0 = top). Each level is two leading spaces
      of markdown indentation; undefined/0 = flush left. */
  indent?: number;
}

export const MAX_INDENT = 6;

const FENCE_OPEN = /^```(\w*)\s*$/;
const FENCE_CLOSE = /^```\s*$/;
const CALLOUT = /^\[!(\w+)\]\s?(.*)$/;
const HEADINGS = ["h1", "h2", "h3"] as const;
/** A GFM table row (any `|...|` line) and the `|---|---|` separator under the
    header. A table is a row line immediately followed by a separator line. */
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/;

const LISTY = new Set<BlockType>(["ul", "ol", "todo", "todo-done"]);
export function isListy(type: BlockType): boolean {
  return LISTY.has(type);
}

/** Which list "family" a block belongs to — bullets, numbers, and to-dos are
    distinct families. Only same-family items pack tight on serialize; mixing
    them (or prose) forces a blank line so the markdown re-parses identically. */
function listFamily(type: BlockType): string | null {
  if (type === "ul") return "ul";
  if (type === "ol") return "ol";
  if (type === "todo" || type === "todo-done") return "todo";
  return null;
}

function lineToBlock(line: string): Block {
  const t = line.replace(/\s+$/, "");
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(t.trim())) return { type: "divider", text: "" };
  let m: RegExpExecArray | null;
  if ((m = /^(#{1,3})\s+(.*)$/.exec(t))) return { type: HEADINGS[m[1].length - 1], text: m[2] };
  if ((m = /^>\s?(.*)$/.exec(t))) {
    const c = CALLOUT.exec(m[1]);
    if (c) return { type: "callout", text: c[2], meta: c[1].toLowerCase() };
    return { type: "quote", text: m[1] };
  }
  // List items may be indented: two leading spaces (or a tab) per nesting level.
  const lead = /^(\s*)/.exec(t)![1];
  const indent = Math.min(MAX_INDENT, Math.floor(lead.replace(/\t/g, "  ").length / 2)) || undefined;
  const body = t.slice(lead.length);
  // `\s*` (not `\s+`) after the box so an EMPTY to-do still parses as a to-do:
  // its markdown is "- [ ] " and lineToBlock has already stripped the trailing
  // space, leaving "- [ ]" with nothing after the box.
  if ((m = /^[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(body))) return { type: m[1] === " " ? "todo" : "todo-done", text: m[2], indent };
  if ((m = /^[-*+]\s+(.*)$/.exec(body))) return { type: "ul", text: m[1], indent };
  if ((m = /^(\d+)\.\s+(.*)$/.exec(body))) return { type: "ol", text: m[2], meta: m[1], indent };
  return { type: "p", text: t };
}

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const fence = FENCE_OPEN.exec(lines[i].trim());
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i].trim())) body.push(lines[i++]);
      blocks.push({ type: "code", text: body.join("\n"), meta: fence[1] || undefined });
      continue;
    }
    // GFM table: a pipe row immediately followed by a |---|---| separator.
    // Header, separator and every following pipe row become one block; the
    // block's text stays the raw markdown so it round-trips untouched.
    if (TABLE_ROW.test(lines[i]) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const buf = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]) && !TABLE_SEP.test(lines[i])) buf.push(lines[i++]);
      i--; // step back so the for-loop's i++ lands on the next unread line
      blocks.push({ type: "table", text: buf.join("\n") });
      continue;
    }
    if (lines[i].trim() === "") continue;
    blocks.push(lineToBlock(lines[i]));
  }
  return blocks;
}

export function blockToMarkdown(b: Block): string {
  const pad = isListy(b.type) ? "  ".repeat(b.indent ?? 0) : "";
  switch (b.type) {
    case "h1": return `# ${b.text}`;
    case "h2": return `## ${b.text}`;
    case "h3": return `### ${b.text}`;
    case "todo": return `${pad}- [ ] ${b.text}`;
    case "todo-done": return `${pad}- [x] ${b.text}`;
    case "ul": return `${pad}- ${b.text}`;
    case "ol": return `${pad}${b.meta || "1"}. ${b.text}`;
    case "quote": return `> ${b.text}`;
    case "callout": return `> [!${b.meta || "info"}] ${b.text}`;
    case "code": return "```" + (b.meta || "") + "\n" + b.text + "\n```";
    case "divider": return "---";
    case "table": return b.text; // already full GFM markdown (rows + separator)
    default: return b.text;
  }
}

/** Blocks → markdown. Adjacent list items stay tight (single newline); every
    other boundary gets a blank line so the output is clean, re-parseable
    markdown that a human (or the desktop app) can still read. */
export function serializeBlocks(blocks: Block[]): string {
  let out = "";
  blocks.forEach((b, i) => {
    out += blockToMarkdown(b);
    if (i < blocks.length - 1) {
      const fam = listFamily(b.type);
      out += fam && fam === listFamily(blocks[i + 1].type) ? "\n" : "\n\n";
    }
  });
  return out;
}

/* ————— tables (GFM) ————— */

/** A table's cells as a grid; row 0 is the header. The markdown separator row
    (|---|---|) is implied — parseTable drops it and serializeTable re-adds it.
    Cells never hold a raw pipe or newline (the editor strips them to spaces), so
    splitting a row on "|" is safe. */
export interface TableData { rows: string[][] }

/** Split one `| a | b |` line into cell strings, removing the outer pipes and
    the single padding space serializeTable adds on each side — internal and
    user-typed spaces survive, so live cell editing keeps its whitespace. */
function stripTableRow(line: string): string[] {
  return line.trim()
    .replace(/^\|/, "").replace(/\|$/, "")
    .split("|")
    .map((c) => c.replace(/^ /, "").replace(/ $/, ""));
}

export function parseTable(text: string): TableData {
  const rows = text.split("\n")
    .filter((l) => TABLE_ROW.test(l) && !TABLE_SEP.test(l))
    .map(stripTableRow);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const norm = rows.map((r) => { const c = r.slice(0, cols); while (c.length < cols) c.push(""); return c; });
  return { rows: norm.length ? norm : [Array(cols).fill("")] };
}

export function serializeTable(t: TableData): string {
  const cols = Math.max(1, t.rows[0]?.length ?? 1);
  const cell = (s: string) => (s ?? "").replace(/[|\n]/g, " ");
  const row = (cells: string[]) => `| ${Array.from({ length: cols }, (_, i) => cell(cells[i] ?? "")).join(" | ")} |`;
  const sep = `| ${Array(cols).fill("---").join(" | ")} |`;
  return [row(t.rows[0] ?? []), sep, ...t.rows.slice(1).map(row)].join("\n");
}

/** A blank `rows`×`cols` table (row 0 = header) as GFM markdown. */
export function emptyTable(rows: number, cols: number): string {
  const r = Math.max(1, Math.round(rows));
  const c = Math.max(1, Math.round(cols));
  return serializeTable({ rows: Array.from({ length: r }, () => Array(c).fill("")) });
}

/** The "/" palette. `keywords` are extra search terms so the obvious word finds
    the block even when it is not in the label — "/warning" reaching the warn
    callout, "/grid" reaching the table. */
export interface SlashItem {
  type: BlockType;
  label: string;
  hint: string;
  meta?: string;
  keywords?: string[];
}

export const SLASH_ITEMS: SlashItem[] = [
  { type: "p", label: "Text", hint: "Plain paragraph", keywords: ["paragraph", "plain", "body"] },
  { type: "code", meta: "draw", label: "Drawing", hint: "Sketch with a pen, finger or mouse", keywords: ["draw", "sketch", "canvas", "pen", "stylus", "doodle"] },
  { type: "h1", label: "Heading 1", hint: "Big section title", keywords: ["title", "h1"] },
  { type: "h2", label: "Heading 2", hint: "Medium heading", keywords: ["subtitle", "h2"] },
  { type: "h3", label: "Heading 3", hint: "Small heading", keywords: ["h3"] },
  { type: "todo", label: "To-do", hint: "Checkbox item", keywords: ["task", "checkbox", "check"] },
  { type: "ul", label: "Bulleted list", hint: "Simple bullet", keywords: ["bullet", "list", "unordered"] },
  { type: "ol", label: "Numbered list", hint: "1. 2. 3.", keywords: ["number", "ordered", "list"] },
  { type: "quote", label: "Quote", hint: "Set a line apart", keywords: ["blockquote", "cite"] },
  { type: "table", label: "Table", hint: "3×3 grid — add rows and columns after", keywords: ["grid", "rows", "columns", "spreadsheet"] },
  { type: "callout", label: "Callout — info", hint: "Blue info box", meta: "info", keywords: ["note", "aside", "box"] },
  { type: "callout", label: "Callout — warning", hint: "Flag a risk", meta: "warn", keywords: ["warn", "danger", "caution", "important"] },
  { type: "callout", label: "Callout — tip", hint: "A helpful aside", meta: "tip", keywords: ["hint", "advice", "idea"] },
  { type: "callout", label: "Callout — success", hint: "Something went right", meta: "success", keywords: ["done", "ok", "check", "positive"] },
  { type: "code", label: "Code", hint: "Monospace block", keywords: ["snippet", "pre", "monospace"] },
  { type: "divider", label: "Divider", hint: "Horizontal rule", keywords: ["hr", "rule", "separator", "line"] },
];

/** Default size for a table inserted straight from the slash menu. */
export const SLASH_TABLE_SIZE = { rows: 3, cols: 3 };

/** Markdown autoformat: the leading token the user just typed → a block type,
    with that token stripped from the text. Powers Notion-style muscle memory
    ("# " → heading, "- " → bullet, "[] " → to-do). Null when nothing matches. */
export function autoformat(text: string): { type: BlockType; text: string; meta?: string } | null {
  let m: RegExpExecArray | null;
  if ((m = /^(#{1,3})\s(.*)$/.exec(text))) return { type: HEADINGS[m[1].length - 1], text: m[2] };
  if ((m = /^\[[ ]?\]\s(.*)$/.exec(text))) return { type: "todo", text: m[1] };
  if ((m = /^[-*+]\s\[[ xX]\]\s(.*)$/.exec(text))) return { type: "todo", text: m[1] };
  if ((m = /^[-*+]\s(.*)$/.exec(text))) return { type: "ul", text: m[1] };
  if ((m = /^(\d+)\.\s(.*)$/.exec(text))) return { type: "ol", text: m[2], meta: m[1] };
  if ((m = /^>\s(.*)$/.exec(text))) return { type: "quote", text: m[1] };
  if (/^(-{3,}|\*{3,})$/.test(text)) return { type: "divider", text: "" };
  return null;
}
