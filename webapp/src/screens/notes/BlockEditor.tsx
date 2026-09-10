import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  autoformat, emptyTable, isListy, MAX_INDENT, parseBlocks, parseTable, serializeBlocks, serializeTable,
  SLASH_ITEMS, SLASH_TABLE_SIZE, type Block, type BlockType,
} from "../../lib/noteBlocks";
import { renderInline } from "../../lib/md";
import { nextMetaHint, splitMetaTail, type MetaField, type MetaHint } from "../../lib/taskMeta";
import { ILink } from "../../components/Icons";
import { DrawPad } from "./DrawPad";

/* Notion-style block editor over a markdown string. A blurred block renders its
   markdown; the focused block is a raw-markdown textarea — the Obsidian "live
   preview" model, no contentEditable.

   The block ARRAY is local state, not re-derived from the body each render: an
   empty paragraph has no markdown representation, so deriving from the body
   would make a freshly-created empty block vanish on the round-trip and orphan
   the caret. `body` seeds the array and re-syncs it only on an external change
   (a different note, a sync pull); every edit serializes back out via onChange. */

const CALLOUT_ICON: Record<string, string> = { info: "ℹ", warn: "▲", tip: "✦", success: "✓", danger: "⛔" };

const PLACEHOLDER: Partial<Record<BlockType, string>> = {
  p: "Write, or press “/” for commands",
  h1: "Heading 1", h2: "Heading 2", h3: "Heading 3",
  ul: "List item — Tab to nest", ol: "List item — Tab to nest",
  todo: "To-do", "todo-done": "To-do",
  quote: "Quote", callout: "Callout", code: "Code",
};

/** The always-visible formatting bar: block-type buttons on the left, inline
    marks in the middle, a help toggle on the right. */
const BAR_BLOCKS: { label: string; type: BlockType; meta?: string; title: string }[] = [
  { label: "T", type: "p", title: "Text" },
  { label: "H1", type: "h1", title: "Heading 1" },
  { label: "H2", type: "h2", title: "Heading 2" },
  { label: "H3", type: "h3", title: "Heading 3" },
  { label: "•", type: "ul", title: "Bulleted list" },
  { label: "1.", type: "ol", title: "Numbered list" },
  { label: "☑", type: "todo", title: "To-do" },
  { label: "❝", type: "quote", title: "Quote" },
  { label: "!", type: "callout", meta: "info", title: "Callout" },
  { label: "</>", type: "code", title: "Code block" },
  { label: "―", type: "divider", title: "Divider" },
];

const seed = (body: string): Block[] => {
  const b = parseBlocks(body);
  return b.length ? b : [{ type: "p", text: "" }];
};

export function BlockEditor({ body, onChange, onOpenLink, barExtra }: {
  body: string;
  onChange: (body: string) => void;
  onOpenLink: (name: string) => void;
  /** Rendered at the right end of the formatting bar (page tags live here —
      sharing the bar's row saves a whole chrome row above the editor). */
  barExtra?: React.ReactNode;
}) {
  const [blocks, setBlocks] = useState<Block[]>(() => seed(body));
  const [active, setActive] = useState<number | null>(null);
  const [slash, setSlash] = useState<{ index: number; query: string; sel: number } | null>(null);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [tableMenu, setTableMenu] = useState(false);
  const [tableSize, setTableSize] = useState({ rows: 3, cols: 3 });
  /** Fields declined with "-" on the line being edited. Transient by design:
      nothing is recorded in the markdown, so a field added later simply joins
      the sequence without any migration. */
  const [skippedFields, setSkippedFields] = useState<MetaField[]>([]);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | null>(null);
  const lastEmitted = useRef(body);
  // Block index the insert-table picker was opened over — clicking into the
  // picker blurs the active block, so remember where to drop the table.
  const tableAnchor = useRef<number | null>(null);

  // Re-seed only when the body changes underneath us (note switch / sync pull),
  // never from our own edits (which we recorded in lastEmitted).
  useEffect(() => {
    if (body !== lastEmitted.current) { setBlocks(seed(body)); lastEmitted.current = body; setActive(null); }
  }, [body]);

  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const filteredSlash = (q: string) => {
    const nq = norm(q);
    if (!nq) return SLASH_ITEMS;
    // Match the label first, then the keywords, so "/warning" finds the warn
    // callout and "/grid" finds the table.
    return SLASH_ITEMS.filter(
      (it) => norm(it.label).includes(nq) || (it.keywords ?? []).some((k) => norm(k).includes(nq)),
    );
  };

  function autosize(ta: HTMLTextAreaElement) {
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }

  useLayoutEffect(() => { if (active !== null) taRef.current?.focus(); else setSel(null); }, [active]);
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (active === null || !ta) return;
    autosize(ta);
    if (caretRef.current !== null) {
      const c = Math.min(caretRef.current, ta.value.length);
      ta.setSelectionRange(c, c);
      caretRef.current = null;
    }
  });

  // A skip applies to the line it was made on, nothing else.
  useEffect(() => { setSkippedFields([]); }, [active]);

  /* Guided entry: on a to-do line that ends with a space, the next unstated
     field is shown as dim ghost text — Tab accepts it, "-" skips to the one
     after. Requiring the trailing space is what keeps Tab-to-nest working: a
     Tab pressed straight after the last word still nests the item, and the
     ghost only appears once you have opened a gap for metadata, so "ghost
     visible" and "Tab will insert" are always the same condition. */
  const activeBlock = active !== null ? blocks[active] : undefined;
  const ghostHint: MetaHint | undefined =
    activeBlock && (activeBlock.type === "todo" || activeBlock.type === "todo-done") && /[ \t]$/.test(activeBlock.text)
      ? nextMetaHint(activeBlock.text, skippedFields, Date.now())
      : undefined;

  function acceptHint(i: number, hint: MetaHint) {
    const text = blocks[i].text + hint.insert;
    caretRef.current = text.length - hint.caretFromEnd;
    setType(i, { text });
  }

  function emit(next: Block[]) {
    const rows = next.length ? next : [{ type: "p" as BlockType, text: "" }];
    const md = serializeBlocks(rows);
    lastEmitted.current = md;
    setBlocks(rows);
    onChange(md);
  }

  const setType = (i: number, patch: Partial<Block>) => emit(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  /** Focus a block; on an empty block open the slash menu so the block palette
      is right there (discoverability). */
  function activate(i: number) {
    caretRef.current = blocks[i].text.length;
    setActive(i);
    if (blocks[i].text === "" && blocks[i].type !== "divider" && blocks[i].type !== "code") {
      setSlash({ index: i, query: "", sel: 0 });
    }
  }

  function onInput(value: string) {
    const ta = taRef.current;
    if (ta) autosize(ta);
    if (active === null) return;

    if (value === "/" || (value.startsWith("/") && !value.includes(" "))) {
      setSlash({ index: active, query: value.slice(1), sel: 0 });
    } else if (slash) {
      setSlash(null);
    }

    if (!value.startsWith("/")) {
      const af = autoformat(value);
      if (af) { caretRef.current = 0; setSlash(null); setType(active, { type: af.type, text: af.text, meta: af.meta }); return; }
    }
    setType(active, { text: value });
  }

  function wrapSelection(open: string, close = open) {
    if (active === null) return;
    const { start: s, end: e } = sel ?? { start: 0, end: 0 };
    const text = blocks[active].text;
    const chosen = text.slice(s, e);
    const already = chosen.startsWith(open) && chosen.endsWith(close) && chosen.length >= open.length + close.length;
    const wrapped = already ? chosen.slice(open.length, -close.length) : `${open}${chosen}${close}`;
    caretRef.current = e + (wrapped.length - chosen.length);
    setType(active, { text: text.slice(0, s) + wrapped + text.slice(e) });
  }

  /** Toolbar block-type button: convert the active block (or append one when
      nothing is focused). Divider drops a rule plus a fresh paragraph. */
  function convertActive(type: BlockType, meta?: string) {
    if (type === "divider") {
      const at = active ?? blocks.length - 1;
      const next = [...blocks];
      next.splice(at + 1, 0, { type: "divider", text: "" }, { type: "p", text: "" });
      setActive(at + 2); caretRef.current = 0; emit(next);
      return;
    }
    if (active === null) {
      const next: Block[] = [...blocks, { type, text: "", meta }];
      setActive(next.length - 1); caretRef.current = 0; emit(next);
      return;
    }
    const cur = blocks[active];
    caretRef.current = cur.text.length;
    setType(active, { type, meta, indent: isListy(type) ? cur.indent : undefined });
  }

  function applySlash(item: (typeof SLASH_ITEMS)[number]) {
    if (slash === null) return;
    const i = slash.index;
    setSlash(null);
    // Blocks with no editable text line of their own replace the current block
    // and hand the caret to a fresh paragraph underneath, so typing continues.
    if (item.type === "divider" || item.type === "table") {
      const next = [...blocks];
      next[i] = item.type === "divider"
        ? { type: "divider", text: "" }
        : { type: "table", text: emptyTable(SLASH_TABLE_SIZE.rows, SLASH_TABLE_SIZE.cols) };
      next.splice(i + 1, 0, { type: "p", text: "" });
      setActive(i + 1); caretRef.current = 0; emit(next);
      return;
    }
    caretRef.current = 0; setActive(i);
    setType(i, { type: item.type, text: "", meta: item.meta });
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget;
    const { selectionStart: s, selectionEnd: en, value } = ta;
    const cur = blocks[i];

    if (slash && slash.index === i) {
      const items = filteredSlash(slash.query);
      if (e.key === "ArrowDown") { e.preventDefault(); setSlash({ ...slash, sel: Math.min(slash.sel + 1, items.length - 1) }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlash({ ...slash, sel: Math.max(slash.sel - 1, 0) }); return; }
      if (e.key === "Enter") { e.preventDefault(); if (items[slash.sel]) applySlash(items[slash.sel]); return; }
      if (e.key === "Escape") { e.preventDefault(); setSlash(null); return; }
    }

    // Guided entry wins over nesting ONLY while a ghost is showing, which
    // requires a trailing space — so `- [ ] Subtask` + Tab still nests.
    if (ghostHint && active === i) {
      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); acceptHint(i, ghostHint); return; }
      if (e.key === "-") { e.preventDefault(); setSkippedFields([...skippedFields, ghostHint.field]); return; }
    }

    // Tab nests / un-nests a list item (Notion muscle memory), never leaves it.
    if (e.key === "Tab" && isListy(cur.type)) {
      e.preventDefault();
      const nextIndent = Math.max(0, Math.min(MAX_INDENT, (cur.indent ?? 0) + (e.shiftKey ? -1 : 1)));
      caretRef.current = s;
      setType(i, { indent: nextIndent || undefined });
      return;
    }

    if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "i")) {
      e.preventDefault(); wrapSelection(e.key === "b" ? "**" : "*"); return;
    }

    if (e.key === "Enter" && !e.shiftKey && cur.type !== "code") {
      e.preventDefault();
      if (isListy(cur.type) && value.trim() === "") {
        // Empty list item: outdent once, then fall back to a paragraph.
        if ((cur.indent ?? 0) > 0) { setType(i, { indent: (cur.indent ?? 0) - 1 || undefined }); return; }
        setType(i, { type: "p", meta: undefined }); return;
      }
      const before = value.slice(0, s), after = value.slice(en);
      const newType: BlockType = cur.type === "h1" || cur.type === "h2" || cur.type === "h3" || cur.type === "quote" || cur.type === "callout" ? "p" : cur.type;
      const meta = newType === "ol" ? String(Number(cur.meta || "1") + 1) : undefined;
      const next = [...blocks];
      next[i] = { ...cur, text: before };
      next.splice(i + 1, 0, { type: newType, text: after, meta, indent: isListy(newType) ? cur.indent : undefined });
      setActive(i + 1); caretRef.current = 0; emit(next);
      return;
    }

    if (e.key === "Backspace" && s === 0 && en === 0) {
      if (cur.type !== "p" && cur.type !== "code") { e.preventDefault(); setType(i, { type: "p", meta: undefined, indent: undefined }); return; }
      if (i === 0) return;
      e.preventDefault();
      const prev = blocks[i - 1];
      if (prev.type === "divider" || prev.type === "code") {
        setActive(i - 1); caretRef.current = prev.text.length; emit(blocks.filter((_, j) => j !== i - 1));
        return;
      }
      const next = [...blocks];
      next[i - 1] = { ...prev, text: prev.text + value };
      next.splice(i, 1);
      setActive(i - 1); caretRef.current = prev.text.length; emit(next);
      return;
    }

    if (e.key === "ArrowUp" && s === 0 && i > 0) { e.preventDefault(); caretRef.current = blocks[i - 1].text.length; setActive(i - 1); }
    if (e.key === "ArrowDown" && s === value.length && i < blocks.length - 1) { e.preventDefault(); caretRef.current = 0; setActive(i + 1); }
  }

  function onRowClick(i: number, e: React.MouseEvent) {
    const link = (e.target as HTMLElement).closest(".wikilink");
    if (link) { e.stopPropagation(); onOpenLink(link.getAttribute("data-link")!); return; }
    if ((e.target as HTMLElement).closest("a[href]")) return;
    if ((e.target as HTMLElement).closest(".blk-check")) return;
    if (blocks[i]?.type === "table") return; // tables manage their own cell focus
    if (active !== i) activate(i);
  }

  function moveBlock(from: number, to: number) {
    if (from === to || from === to - 1) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(from < to ? to - 1 : to, 0, moved);
    setActive(null); emit(next);
  }

  function addBlockAfter(i: number) {
    const next = [...blocks];
    next.splice(i + 1, 0, { type: "p", text: "" });
    emit(next); activate(i + 1);
  }

  function removeBlock(i: number) {
    setActive(null);
    emit(blocks.filter((_, j) => j !== i));
  }

  /** Insert a fresh rows×cols table (plus a trailing paragraph to keep typing)
      after the block the picker was opened over. */
  function insertTable(rows: number, cols: number) {
    const at = tableAnchor.current ?? blocks.length - 1;
    const next = [...blocks];
    next.splice(at + 1, 0, { type: "table", text: emptyTable(rows, cols) }, { type: "p", text: "" });
    setActive(at + 2); caretRef.current = 0; emit(next); setTableMenu(false);
  }

  const docEmpty = blocks.length === 1 && blocks[0].type === "p" && blocks[0].text === "";

  /* Word-style adjustable margin: drag the notebook rule to choose where
     content starts. Persisted so the choice sticks across notes/sessions. */
  const MARGIN_MAX = 480;
  const [marginPx, setMarginPx] = useState(() => {
    const v = Number(localStorage.getItem("lg:noteMargin"));
    return Number.isFinite(v) ? Math.min(MARGIN_MAX, Math.max(0, v)) : 0;
  });
  const [marginDragging, setMarginDragging] = useState(false);
  /* Word wrap for code blocks + the raw Markdown view; the toggle lives in
     the formatting bar (beside Link) and persists across sessions. */
  const [wrap, setWrap] = useState(() => localStorage.getItem("lg:noteWrap") !== "0");
  const saveMargin = (v: number) => localStorage.setItem("lg:noteMargin", String(v));
  function onMarginPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX, start = marginPx;
    setMarginDragging(true);
    let last = start;
    const onMove = (ev: PointerEvent) => {
      last = Math.min(MARGIN_MAX, Math.max(0, start + ev.clientX - startX));
      setMarginPx(last);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setMarginDragging(false);
      saveMargin(last);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  function onMarginKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = Math.min(MARGIN_MAX, Math.max(0, marginPx + (e.key === "ArrowRight" ? 16 : -16)));
    setMarginPx(next);
    saveMargin(next);
  }

  return (
    <div className="blk-editor">
      <div className="blk-bar">
        {BAR_BLOCKS.map((it) => (
          <button
            key={it.type + it.label}
            className="blk-bar-btn"
            title={it.title}
            aria-label={it.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => convertActive(it.type, it.meta)}
          >
            {it.label}
          </button>
        ))}
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button
            className="blk-bar-btn"
            title="Insert table"
            aria-label="Insert table"
            aria-expanded={tableMenu}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { tableAnchor.current = active; setTableMenu((v) => !v); }}
          >
            ▦
          </button>
          {tableMenu && (
            <div className="blk-tmenu">
              <div className="blk-tmenu-row">
                <label>Rows
                  <input
                    type="number" min={1} max={20} value={tableSize.rows}
                    onChange={(e) => setTableSize((s) => ({ ...s, rows: Math.max(1, Math.min(20, Number(e.target.value) || 1)) }))}
                  />
                </label>
                <label>Columns
                  <input
                    type="number" min={1} max={10} value={tableSize.cols}
                    onChange={(e) => setTableSize((s) => ({ ...s, cols: Math.max(1, Math.min(10, Number(e.target.value) || 1)) }))}
                  />
                </label>
              </div>
              <button className="btn btn-primary" style={{ height: 30, fontSize: 12 }} onClick={() => insertTable(tableSize.rows, tableSize.cols)}>
                Insert {tableSize.rows}×{tableSize.cols} table
              </button>
            </div>
          )}
        </span>
        <span className="blk-bar-sep" />
        <button className="blk-bar-btn" title="Bold (Ctrl/Cmd+B)" aria-label="Bold" style={{ fontWeight: 700 }} onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection("**")}>B</button>
        <button className="blk-bar-btn" title="Italic (Ctrl/Cmd+I)" aria-label="Italic" style={{ fontStyle: "italic" }} onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection("*")}>i</button>
        <button className="blk-bar-btn" title="Strikethrough" aria-label="Strikethrough" style={{ textDecoration: "line-through" }} onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection("~~")}>S</button>
        <button className="blk-bar-btn" title="Inline code" aria-label="Inline code" style={{ fontFamily: "var(--font-mono)" }} onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection("`")}>{"</>"}</button>
        <button className="blk-bar-btn" title="Link to a note or task" aria-label="Link" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection("[[", "]]")}><ILink size={13} /></button>
        <button
          className={`blk-bar-btn blk-bar-help${wrap ? " on" : ""}`}
          title={wrap ? "Word wrap: on" : "Word wrap: off"}
          aria-label="Toggle word wrap"
          aria-pressed={wrap}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setWrap((w) => { localStorage.setItem("lg:noteWrap", w ? "0" : "1"); return !w; })}
        >
          ↩
        </button>
        {barExtra && (
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
            {barExtra}
          </span>
        )}
        <button
          className={`blk-bar-btn blk-bar-help${showHelp ? " on" : ""}`}
          title="Formatting help"
          aria-label="Formatting help"
          aria-expanded={showHelp}
          style={{ marginLeft: barExtra ? undefined : "auto" }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShowHelp((h) => !h)}
        >
          ?
        </button>
      </div>

      {showHelp && (
        <div className="blk-help">
          <div className="blk-help-col">
            <strong>Blocks</strong>
            <span><kbd>/</kbd> open the block menu</span>
            <span><kbd>#</kbd> <kbd>##</kbd> <kbd>###</kbd> then space → heading</span>
            <span><kbd>-</kbd> space → bullet · <kbd>1.</kbd> space → numbered</span>
            <span><kbd>[]</kbd> space → to-do · <kbd>&gt;</kbd> space → quote</span>
            <span><kbd>---</kbd> → divider</span>
          </div>
          <div className="blk-help-col">
            <strong>Editing</strong>
            <span><kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> nest a list item</span>
            <span><kbd>Ctrl/Cmd</kbd>+<kbd>B</kbd> bold · <kbd>Ctrl/Cmd</kbd>+<kbd>I</kbd> italic</span>
            <span>Select text for the inline format bar</span>
            <span><kbd>⋮⋮</kbd> drag to reorder · <kbd>+</kbd> add a block</span>
            <span><kbd>[[</kbd> link a note or task</span>
          </div>
        </div>
      )}

      {docEmpty && !showHelp && (
        <p className="blk-hint">Type to start, press <kbd>/</kbd> for blocks, or use the bar above.</p>
      )}

      <div className={`blocks${wrap ? "" : " nowrap"}`} style={{ "--note-indent": `${marginPx}px` } as React.CSSProperties} onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}>
        <button
          type="button"
          className={`blk-margin${marginDragging ? " dragging" : ""}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Note margin — drag or use arrow keys to move where content starts"
          title="Drag to set the note margin"
          onPointerDown={onMarginPointerDown}
          onKeyDown={onMarginKeyDown}
        />
        {blocks.map((b, i) => {
          const isActive = active === i && b.type !== "divider";
          const pad = isListy(b.type) ? (b.indent ?? 0) * 22 : 0;
          return (
            <div
              key={i}
              className={`blk-row${overIndex === i ? " blk-drop" : ""}${dragIndex === i ? " blk-dragging" : ""}`}
              onDragOver={(e) => { if (dragIndex !== null) { e.preventDefault(); setOverIndex(i); } }}
              onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) moveBlock(dragIndex, i); setDragIndex(null); setOverIndex(null); }}
            >
              <span className="blk-lineno" aria-hidden>{i + 1}</span>
              <div className="blk-gutter">
                <button className="blk-handle" aria-label="Add block below" tabIndex={-1} onClick={() => addBlockAfter(i)}>+</button>
                <button
                  className="blk-handle blk-grip"
                  aria-label="Drag to reorder"
                  tabIndex={-1}
                  draggable
                  onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
                >
                  ⋮⋮
                </button>
              </div>

              <div className="blk-body" style={pad ? { paddingLeft: pad } : undefined} onClick={(e) => onRowClick(i, e)}>
                {/* A ```draw fence is a sketch, never source to edit as text —
                    so it renders as the canvas whether or not it is focused,
                    exactly like a table. */}
                {b.type === "code" && b.meta === "draw" ? (
                  <DrawPad data={b.text} onChange={(json) => setType(i, { text: json })} />
                ) : b.type === "table" ? (
                  <TableBlock md={b.text} onChange={(md) => setType(i, { text: md })} onRemove={() => removeBlock(i)} />
                ) : isActive ? (
                  <>
                    <textarea
                      ref={taRef}
                      className={`blk-input blk-${b.type}`}
                      value={b.text}
                      rows={1}
                      placeholder={PLACEHOLDER[b.type] ?? "…"}
                      onChange={(e) => onInput(e.target.value)}
                      onKeyDown={(e) => onKeyDown(i, e)}
                      onSelect={(e) => {
                        const t = e.currentTarget;
                        setSel(t.selectionStart !== t.selectionEnd ? { start: t.selectionStart, end: t.selectionEnd } : null);
                      }}
                      onBlur={() => { if (!slash) setActive(null); }}
                    />
                    {/* Ghost suggestion. A mirror of the textarea's own text in
                        transparent ink puts the hint exactly where typing would
                        continue, wrapping included; it shares the textarea's
                        classes so the typography cannot drift apart. */}
                    {ghostHint && active === i && (
                      <div className={`blk-input blk-${b.type} blk-ghost`} aria-hidden="true">
                        {b.text}
                        <span className="blk-ghost-hint">{ghostHint.ghost}</span>
                        <span className="blk-ghost-key">↹</span>
                      </div>
                    )}
                    {sel && !slash && (
                      <div className="blk-toolbar" onMouseDown={(e) => e.preventDefault()}>
                        <button onClick={() => wrapSelection("**")} aria-label="Bold" style={{ fontWeight: 700 }}>B</button>
                        <button onClick={() => wrapSelection("*")} aria-label="Italic" style={{ fontStyle: "italic" }}>i</button>
                        <button onClick={() => wrapSelection("~~")} aria-label="Strikethrough" style={{ textDecoration: "line-through" }}>S</button>
                        <button onClick={() => wrapSelection("`")} aria-label="Code" style={{ fontFamily: "var(--font-mono)" }}>{"</>"}</button>
                        <button onClick={() => wrapSelection("[[", "]]")} aria-label="Link to a note or task"><ILink size={13} /></button>
                      </div>
                    )}
                    {slash && slash.index === i && (
                      <div className="blk-slash">
                        {filteredSlash(slash.query).map((it, k) => (
                          <button
                            key={it.type + it.label}
                            className={`blk-slash-item${k === slash.sel ? " sel" : ""}`}
                            onMouseDown={(e) => { e.preventDefault(); applySlash(it); }}
                            onMouseEnter={() => setSlash({ ...slash, sel: k })}
                          >
                            <span className="blk-slash-label">{it.label}</span>
                            <span className="blk-slash-hint">{it.hint}</span>
                          </button>
                        ))}
                        {filteredSlash(slash.query).length === 0 && <div className="blk-slash-empty">No block matches “{slash.query}”.</div>}
                      </div>
                    )}
                  </>
                ) : (
                  <BlockView block={b} onToggleTodo={() => setType(i, { type: b.type === "todo" ? "todo-done" : "todo" })} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The rendered (blurred) form of a block — markdown turned to HTML for inline
    text, with interactive checkboxes for to-dos. */
function BlockView({ block, onToggleTodo }: { block: Block; onToggleTodo: () => void }) {
  const b = block;
  const inline = <span dangerouslySetInnerHTML={{ __html: renderInline(b.text) || "<span class='blk-empty'>Empty</span>" }} />;

  /* A task line's field tokens are shown dimmed, apart from the title, so a note
     stays readable once every line carries `@id(...)` and a handful of fields.
     Only the unfocused view splits them — the focused block is a raw textarea
     showing the markdown as typed, which is the live-preview model this editor
     already follows elsewhere. */
  const taskInline = () => {
    const { text, tail } = splitMetaTail(b.text);
    if (!tail) return inline;
    return (
      <>
        <span dangerouslySetInnerHTML={{ __html: renderInline(text) || "<span class='blk-empty'>Empty</span>" }} />
        <span className="blk-meta">{tail}</span>
      </>
    );
  };

  switch (b.type) {
    case "divider":
      return <hr className="blk-hr" />;
    case "code":
      return <pre className="blk-codeview"><code>{b.text || " "}</code></pre>;
    case "h1": return <h1 className="blk-h1">{inline}</h1>;
    case "h2": return <h2 className="blk-h2">{inline}</h2>;
    case "h3": return <h3 className="blk-h3">{inline}</h3>;
    case "quote": return <blockquote className="blk-quote">{inline}</blockquote>;
    case "callout":
      return (
        <div className={`callout callout-${b.meta || "info"}`}>
          <span className="callout-ic">{CALLOUT_ICON[b.meta || "info"] ?? "ℹ"}</span>
          <div>{inline}</div>
        </div>
      );
    case "ul":
      return <div className="blk-li"><span className="blk-bullet">•</span><div>{inline}</div></div>;
    case "ol":
      return <div className="blk-li"><span className="blk-num">{b.meta || "1"}.</span><div>{inline}</div></div>;
    case "todo":
    case "todo-done": {
      const done = b.type === "todo-done";
      return (
        <div className="blk-li">
          <button
            className="blk-check"
            role="checkbox"
            aria-checked={done}
            aria-label={done ? "Mark not done" : "Mark done"}
            onClick={(e) => { e.stopPropagation(); onToggleTodo(); }}
            data-done={done ? "1" : undefined}
          >
            {done ? "✓" : ""}
          </button>
          <div className={done ? "blk-todo-done" : undefined}>{taskInline()}</div>
        </div>
      );
    }
    default:
      return <p className="blk-p">{inline}</p>;
  }
}

/** Interactive table grid. Cells are inputs bound to the block's markdown;
    focusing a cell reveals a toolbar for inserting/deleting the focused row or
    column, or deleting the whole table. The grid round-trips through
    parseTable ∘ serializeTable, so the note body stays plain GFM markdown. */
function TableBlock({ md, onChange, onRemove }: { md: string; onChange: (md: string) => void; onRemove: () => void }) {
  const { rows } = parseTable(md);
  const cols = rows[0]?.length ?? 1;
  const [focus, setFocus] = useState<{ r: number; c: number } | null>(null);

  const commit = (next: string[][]) => onChange(serializeTable({ rows: next }));
  const setCell = (r: number, c: number, v: string) =>
    commit(rows.map((row, ri) => row.map((cell, ci) => (ri === r && ci === c ? v : cell))));
  const insertRow = (at: number) => commit([...rows.slice(0, at), Array(cols).fill(""), ...rows.slice(at)]);
  const deleteRow = (at: number) => { if (rows.length > 1) commit(rows.filter((_, i) => i !== at)); };
  const insertCol = (at: number) => commit(rows.map((row) => [...row.slice(0, at), "", ...row.slice(at)]));
  const deleteCol = (at: number) => { if (cols > 1) commit(rows.map((row) => row.filter((_, i) => i !== at))); };

  const cellInput = (r: number, c: number) => (
    <input
      className="blk-tcell"
      value={rows[r][c] ?? ""}
      placeholder={r === 0 ? "Header" : ""}
      aria-label={`Row ${r + 1}, column ${c + 1}`}
      onFocus={() => setFocus({ r, c })}
      onChange={(e) => setCell(r, c, e.target.value.replace(/[|\n]/g, " "))}
    />
  );

  return (
    <div
      className="blk-tablewrap"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocus(null); }}
    >
      <table className="blk-table">
        <thead>
          <tr>{rows[0].map((_, c) => <th key={c}>{cellInput(0, c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(1).map((row, ri) => (
            <tr key={ri + 1}>{row.map((_, c) => <td key={c}>{cellInput(ri + 1, c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {focus && (
        <div className="blk-tbar" onMouseDown={(e) => e.preventDefault()}>
          <button onClick={() => insertRow(focus.r)} title="Insert row above">↑ Row</button>
          <button onClick={() => insertRow(focus.r + 1)} title="Insert row below">↓ Row</button>
          <button onClick={() => deleteRow(focus.r)} disabled={rows.length <= 1} title="Delete row">✕ Row</button>
          <span className="blk-tbar-sep" />
          <button onClick={() => insertCol(focus.c)} title="Insert column left">← Col</button>
          <button onClick={() => insertCol(focus.c + 1)} title="Insert column right">→ Col</button>
          <button onClick={() => deleteCol(focus.c)} disabled={cols <= 1} title="Delete column">✕ Col</button>
          <span className="blk-tbar-sep" />
          <button className="blk-tbar-danger" onClick={onRemove} title="Delete table">Delete</button>
        </div>
      )}
    </div>
  );
}
