import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { nav, useMobile } from "../lib/router";
import { useEditor } from "../App";
import { STATUS_VAR, type MindNode, type TaskStatus } from "../lib/types";
import { Corners, Seg, StatusSq } from "../components/ui";
import { IFocus, IMinus, INoteLines, IPlus, ITodo, IX } from "../components/Icons";
import { MobileHeader } from "../shell/AppShell";
import { renderMd } from "../lib/md";
import { buildNotesGraph, buildOutlineGraph, buildTaskGraph, buildWebGraph, type GraphNode } from "../lib/notesGraph";
import { GraphCanvas } from "./mindmap/GraphCanvas";
import { useStickyView } from "../lib/viewMemory";

type Lens = "notes" | "tasks" | "web" | "outline" | "freeform";
const LENSES: { id: Lens; label: string }[] = [
  { id: "notes", label: "Notes" },
  { id: "tasks", label: "Tasks" },
  { id: "web", label: "Web" },
  { id: "outline", label: "Outline" },
  { id: "freeform", label: "Freeform" },
];
const LENS_IDS: readonly Lens[] = LENSES.map((l) => l.id);
const DENSITIES = ["compact", "cozy"] as const;

export function MindmapScreen() {
  const { state } = useStore();
  const mobile = useMobile();
  // Sticky per device — the lens is which graph you came here to read, and
  // rebuilding it from the Notes lens on every visit undid that choice.
  const [lens, setLens] = useStickyView("lg:mindmapLens", LENS_IDS, "notes");
  const [outlineNoteId, setOutlineNoteId] = useState<string>(() => state.notes[0]?.id ?? "");

  const lensSeg = (
    <Seg
      small
      ariaLabel="Mindmap lens"
      items={LENSES}
      active={lens}
      onSelect={(id) => setLens(id as Lens)}
    />
  );

  const body = lens === "freeform"
    ? <Freeform />
    : <GraphLens lens={lens} outlineNoteId={outlineNoteId} setOutlineNoteId={setOutlineNoteId} />;

  if (mobile) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <MobileHeader title="Mindmap" />
        {/* All five lenses (desktop parity) in their own scrollable strip —
            packed beside the header title they overflowed a 390px screen. */}
        <div style={{ display: "flex", padding: "0 16px 10px", overflowX: "auto" }}>
          {lensSeg}
        </div>
        {body}
      </div>
    );
  }
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: "1px solid var(--color-divider)" }}>
        <h3 style={{ fontSize: 22 }}>Mindmap</h3>
        {lensSeg}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-text-2)" }}>
          {lens === "freeform" ? "Build your own · drag nodes, click to rename" : "Built from your notes · double-click a node to open it"}
        </span>
      </div>
      {body}
    </div>
  );
}

/* ————— derived-graph lenses ————— */

function GraphLens({ lens, outlineNoteId, setOutlineNoteId }: { lens: Lens; outlineNoteId: string; setOutlineNoteId: (id: string) => void }) {
  const { state, dispatch } = useStore();
  const { openTask } = useEditor();
  const mobile = useMobile();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Set<string>>(new Set());
  const [onlyOpen, setOnlyOpen] = useState(false);
  // Layout density — the "re-render" control: Compact packs the same graph
  // into much less canvas; Cozy is the airier original. Persisted.
  const [densityChoice, setDensityChoice] = useStickyView("lg:graphDensity", DENSITIES, "compact");
  const compact = densityChoice === "compact";
  const toggleDensity = () => setDensityChoice(compact ? "cozy" : "compact");
  const searchRef = useRef<HTMLInputElement>(null);

  const graph = useMemo(() => {
    const density = compact ? 0.72 : 1;
    if (lens === "tasks") return buildTaskGraph(state.tasks, Date.now(), density);
    if (lens === "web") return buildWebGraph(state.notes, density);
    if (lens === "outline") return buildOutlineGraph(state.notes.find((n) => n.id === outlineNoteId), density);
    return buildNotesGraph(state.folders, state.notes, state.tasks, Date.now(), density);
  }, [lens, state.folders, state.notes, state.tasks, outlineNoteId, compact]);

  // Reset transient selection when the lens changes.
  useEffect(() => { setSelectedId(null); setFocusId(null); }, [lens]);

  // "/" focuses search from anywhere on the canvas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "Escape") { setFocusId(null); setSelectedId(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const folderOf = (n: GraphNode): string | undefined =>
    n.kind === "folder" ? n.id.slice("folder:".length) : n.noteId ? state.notes.find((x) => x.id === n.noteId)?.folderId : undefined;

  const q = search.trim().toLowerCase();
  const dimmed = useMemo(() => {
    const set = new Set<string>();
    for (const n of graph.nodes) {
      const okSearch = !q || n.label.toLowerCase().includes(q);
      let okFilter = true;
      if (lens === "notes") {
        if (folders.size) { const f = folderOf(n); okFilter = okFilter && !!f && folders.has(f); }
        if (onlyOpen) okFilter = okFilter && (n.badge ?? 0) > 0;
      }
      if (!(okSearch && okFilter)) set.add(n.id);
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, q, folders, onlyOpen, lens]);

  function onReparent(fromId: string, toId: string) {
    const noteId = fromId.slice("note:".length);
    const note = state.notes.find((n) => n.id === noteId);
    if (!note) return;
    // Guard against cycles: refuse to drop a note into its own subtree.
    const descendants = new Set<string>([noteId]);
    let grew = true;
    while (grew) { grew = false; for (const n of state.notes) if (n.parentId && descendants.has(n.parentId) && !descendants.has(n.id)) { descendants.add(n.id); grew = true; } }
    if (toId.startsWith("folder:")) {
      dispatch({ type: "upsertNote", note: { ...note, parentId: undefined, folderId: toId.slice("folder:".length) } });
    } else {
      const parentId = toId.slice("note:".length);
      if (descendants.has(parentId)) return;
      const parent = state.notes.find((n) => n.id === parentId);
      if (parent) dispatch({ type: "upsertNote", note: { ...note, parentId, folderId: parent.folderId } });
    }
  }

  function onOpen(node: GraphNode) {
    if (node.noteId) nav(`/notes/${node.noteId}`);
    else if (node.taskId) openTask(node.taskId);
  }

  const selected = selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Mobile: one scrollable strip instead of wrapping — the wrapped chips
          stacked three rows tall on a phone and ate the canvas. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: "1px solid var(--color-divider)", flexWrap: mobile ? undefined : "wrap", overflowX: mobile ? "auto" : undefined }}>
        <span style={{ position: "relative", display: "inline-flex", alignItems: "center", flex: "none" }}>
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes…  ( / )"
            aria-label="Search nodes"
            className="input"
            style={{ width: mobile ? 150 : 210, height: 30, fontSize: 13, paddingRight: 22 }}
          />
          {search && <button onClick={() => setSearch("")} aria-label="Clear search" style={{ position: "absolute", right: 4, border: "none", background: "none", cursor: "pointer", color: "var(--color-text-3)", display: "flex" }}><IX size={13} /></button>}
        </span>

        {lens === "outline" && (
          <select className="input" style={{ height: 30, fontSize: 13, maxWidth: 220 }} value={outlineNoteId} onChange={(e) => setOutlineNoteId(e.target.value)} aria-label="Outline of note">
            {state.notes.map((n) => <option key={n.id} value={n.id}>{n.title || "Untitled"}</option>)}
          </select>
        )}

        <button
          className={`chip${compact ? " on" : ""}`}
          onClick={toggleDensity}
          title="Re-render the graph tighter or airier"
          aria-pressed={compact}
        >
          {compact ? "Compact" : "Cozy"}
        </button>

        {lens === "notes" && (
          <>
            {state.folders.map((f) => (
              <button
                key={f.id}
                className={`chip${folders.has(f.id) ? " on" : ""}`}
                onClick={() => setFolders((s) => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; })}
              >
                {f.name}
              </button>
            ))}
            <button className={`chip${onlyOpen ? " on" : ""}`} onClick={() => setOnlyOpen((v) => !v)}>Has open tasks</button>
          </>
        )}

        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          {focusId && <button className="chip on" onClick={() => setFocusId(null)}>Clear focus</button>}
          {graph.stats.map((s) => (
            <span key={s.label} style={{ fontSize: 11, color: "var(--color-text-2)" }}>
              <strong style={{ color: "var(--color-text)", fontFamily: "var(--font-heading)" }}>{s.value}</strong> {s.label}
            </span>
          ))}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {graph.nodes.length === 0 ? (
          <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--color-text-2)", fontSize: 13 }}>
            {lens === "web" ? "No linked notes yet — connect notes with [[wikilinks]] to see the web." : "Nothing to map here yet."}
          </div>
        ) : (
          <GraphCanvas
            graph={graph}
            selectedId={selectedId}
            focusId={focusId}
            dimmed={dimmed}
            onSelect={setSelectedId}
            onOpen={onOpen}
            onReparent={lens === "notes" ? onReparent : undefined}
          />
        )}
        {selected && <NodePanel node={selected} mobile={mobile} onClose={() => setSelectedId(null)} onFocus={() => setFocusId(selected.id)} onOpen={() => onOpen(selected)} />}
      </div>
    </div>
  );
}

/* ————— selection side panel + quick actions ————— */

function NodePanel({ node, mobile, onClose, onFocus, onOpen }: { node: GraphNode; mobile?: boolean; onClose: () => void; onFocus: () => void; onOpen: () => void }) {
  const { state, dispatch } = useStore();
  const note = node.noteId ? state.notes.find((n) => n.id === node.noteId) : undefined;
  const linkedTasks = note ? state.tasks.filter((t) => (t.description ?? "").includes(`[[${note.title}]]`)) : [];
  const backlinks = note ? state.notes.filter((n) => n.id !== note.id && n.body.includes(`[[${note.title}]]`)) : [];

  function addSubpage() {
    if (!note) return;
    const id = `n-${Date.now()}`;
    dispatch({ type: "upsertNote", note: { id, folderId: note.folderId, parentId: note.id, title: "Untitled", body: "# Untitled\n\n", updatedAt: Date.now() } });
    nav(`/notes/${id}`);
  }
  function newTaskFromNote() {
    if (!note) return;
    dispatch({ type: "upsertTask", task: { id: `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, title: `Task for ${note.title}`, status: "pending", priority: 2, tags: [], createdAt: Date.now(), loggedMin: 0, description: `From [[${note.title}]]` } });
  }

  return (
    // Mobile: a bottom sheet — the fixed 288px side panel squeezed the canvas
    // to a ~100px sliver on a phone and shoved the graph out of view.
    <div style={mobile
      ? { position: "fixed", left: 0, right: 0, bottom: 0, maxHeight: "58dvh", zIndex: 45, borderTop: "1px solid var(--color-divider)", boxShadow: "var(--shadow-md)", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--color-bg)" }
      : { width: 288, flex: "none", borderLeft: "1px solid var(--color-divider)", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--color-bg)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--color-divider)" }}>
        <span style={{ flex: 1, fontSize: 15, fontWeight: 600, fontFamily: "var(--font-heading)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.label}</span>
        <button className="btn btn-icon btn-ghost" style={{ width: 26, height: 26 }} onClick={onClose} aria-label="Close panel"><IX size={14} /></button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {node.badge !== undefined && <span className="tag tag-neutral">{node.badge} open</span>}
          {node.ring !== undefined && <span className="tag tag-neutral">{Math.round(node.ring * 100)}% done</span>}
          {node.flags.map((f) => <span key={f} className="tag tag-neutral">{f}</span>)}
        </div>

        {note && note.body.trim() && (
          <div className="notepreview" style={{ maxHeight: 150, overflow: "hidden" }} dangerouslySetInnerHTML={{ __html: renderMd(note.body.slice(0, 400)) }} />
        )}

        {linkedTasks.length > 0 && (
          <div>
            <div className="cap" style={{ marginBottom: 6 }}>Linked tasks</div>
            {linkedTasks.slice(0, 6).map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 0" }}>
                <StatusSq status={t.status} size={7} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: t.status === "done" ? "line-through" : undefined }}>{t.title}</span>
              </div>
            ))}
          </div>
        )}

        {backlinks.length > 0 && (
          <div>
            <div className="cap" style={{ marginBottom: 6 }}>Linked from</div>
            {backlinks.slice(0, 6).map((n) => (
              <button key={n.id} onClick={() => nav(`/notes/${n.id}`)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", cursor: "pointer", fontSize: 12, color: "var(--accent-strong)", padding: "3px 0" }}>{n.title}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12, borderTop: "1px solid var(--color-divider)" }}>
        <button className="btn btn-primary btn-block" onClick={onOpen}>{note ? "Open in Notes" : "Open task"}</button>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-secondary" style={{ flex: 1, fontSize: 12 }} onClick={onFocus}><IFocus size={13} /> Focus</button>
          {note && <button className="btn btn-secondary" style={{ flex: 1, fontSize: 12 }} onClick={addSubpage}><INoteLines size={13} /> Subpage</button>}
        </div>
        {note && <button className="btn btn-secondary btn-block" style={{ fontSize: 12 }} onClick={newTaskFromNote}><ITodo size={13} /> New linked task</button>}
      </div>
    </div>
  );
}

/* ————— freeform: the original build-your-own board ————— */

const LEGEND: TaskStatus[] = ["pending", "in_progress", "done"];
const LEGEND_LABEL: Record<string, string> = { pending: "Pending", in_progress: "Active", done: "Done" };

function Freeform() {
  const { state, dispatch } = useStore();
  const mobile = useMobile();
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(mobile ? 0.7 : 1);
  const [editing, setEditing] = useState<string | null>(null);
  const gesture = useRef<{ mode: "pan" | "node"; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  const root = state.mind.find((m) => !m.parentId);

  function addNode() {
    const id = `m-${Date.now()}`;
    const angle = Math.random() * Math.PI * 2;
    dispatch({ type: "addMindNode", node: { id, label: "New node", parentId: root?.id, x: (root?.x ?? 300) + Math.cos(angle) * 190, y: (root?.y ?? 250) + Math.sin(angle) * 150 } });
    setEditing(id);
  }

  /* Re-render the freeform board: a tidy radial tree around the root, each
     subtree granted an angular sector proportional to its leaf count. Node
     data is untouched — only x/y move. */
  function tidy() {
    if (!root) return;
    const kidsOf = (id?: string) => state.mind.filter((m) => (m.parentId ?? undefined) === id);
    const weight = (id: string): number => {
      const kids = kidsOf(id);
      return kids.length === 0 ? 1 : kids.reduce((s, k) => s + weight(k.id), 0);
    };
    const place = (id: string, a0: number, a1: number, depth: number) => {
      const kids = kidsOf(id);
      const total = kids.reduce((s, k) => s + weight(k.id), 0) || 1;
      let a = a0;
      for (const k of kids) {
        const span = ((a1 - a0) * weight(k.id)) / total;
        const mid = a + span / 2;
        const r = 210 + (depth - 1) * 190;
        dispatch({ type: "moveMindNode", id: k.id, x: root.x + Math.cos(mid) * r, y: root.y + Math.sin(mid) * r * 0.8 });
        place(k.id, a, a + span, depth + 1);
        a += span;
      }
    };
    place(root.id, -Math.PI / 2, Math.PI * 1.5, 1);
  }

  function onPointerDown(e: React.PointerEvent, node?: MindNode) {
    // Panning must not swallow clicks/typing on controls inside the canvas
    // (the rename input): capturing retargets pointerup away from them.
    if (!node && (e.target as HTMLElement).closest("button, input, select, textarea")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = node
      ? { mode: "node", id: node.id, sx: e.clientX, sy: e.clientY, ox: node.x, oy: node.y, moved: false }
      : { mode: "pan", sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y, moved: false };
    if (node) e.stopPropagation();
  }
  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
    if (g.mode === "pan") setPan({ x: g.ox + dx, y: g.oy + dy });
    else dispatch({ type: "moveMindNode", id: g.id!, x: g.ox + dx / zoom, y: g.oy + dy / zoom });
  }
  function onPointerUp(_e: React.PointerEvent, node?: MindNode) {
    const g = gesture.current;
    gesture.current = null;
    if (g && !g.moved && g.mode === "node" && node) setEditing(node.id);
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: "1px solid var(--color-divider)" }}>
        <span className="tag tag-neutral">{state.mind.length} nodes</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button className="btn btn-icon btn-secondary" style={{ width: 30, height: 30 }} onClick={() => setZoom(Math.max(0.4, +(zoom - 0.1).toFixed(2)))} aria-label="Zoom out"><IMinus size={15} strokeWidth={1.6} /></button>
          <span style={{ fontSize: 12, color: "var(--color-text-2)", width: 38, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
          <button className="btn btn-icon btn-secondary" style={{ width: 30, height: 30 }} onClick={() => setZoom(Math.min(2, +(zoom + 0.1).toFixed(2)))} aria-label="Zoom in"><IPlus size={15} strokeWidth={1.6} /></button>
          <button className="btn btn-secondary" onClick={tidy} title="Re-arrange nodes into a tidy radial tree">Tidy</button>
          <button className="btn btn-primary" onClick={addNode}><IPlus size={15} strokeWidth={1.6} /> Node</button>
        </div>
      </div>
      <div
        className="dotbg"
        style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", touchAction: "none", cursor: "grab" }}
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerUp(e)}
      >
        <div style={{ position: "absolute", inset: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
          {/* Stroke divides by zoom so links keep a constant on-screen weight
              — a fixed width scaled down by the canvas transform turned into
              invisible hairlines at phone zoom levels. */}
          <svg style={{ position: "absolute", left: 0, top: 0, width: 2000, height: 2000, overflow: "visible", pointerEvents: "none" }} fill="none" stroke="color-mix(in srgb, var(--color-accent) 55%, transparent)" strokeWidth={1.5 / zoom}>
            {state.mind.filter((m) => m.parentId).map((m) => {
              const p = state.mind.find((x) => x.id === m.parentId);
              return p ? <line key={m.id} x1={p.x} y1={p.y} x2={m.x} y2={m.y} /> : null;
            })}
          </svg>
          {state.mind.map((m) => {
            const isRoot = !m.parentId;
            return (
              <div
                key={m.id}
                className="blueprint"
                onPointerDown={(e) => onPointerDown(e, m)}
                onPointerUp={(e) => onPointerUp(e, m)}
                style={{
                  position: "absolute", left: m.x, top: m.y, transform: "translate(-50%, -50%)",
                  background: isRoot ? "var(--color-accent)" : "var(--color-card)",
                  color: isRoot ? "var(--on-accent)" : "var(--color-text)",
                  padding: isRoot ? "12px 18px" : "8px 12px",
                  fontFamily: isRoot ? "var(--font-heading)" : "var(--font-body)",
                  fontWeight: isRoot ? 600 : 400, fontSize: isRoot ? 17 : 13,
                  borderLeft: !isRoot && m.status ? `3px solid ${STATUS_VAR[m.status]}` : undefined,
                  cursor: "move", whiteSpace: "nowrap", userSelect: "none",
                }}
              >
                <Corners />
                {editing === m.id ? (
                  <input
                    autoFocus
                    defaultValue={m.label}
                    aria-label="Node label"
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => { dispatch({ type: "renameMindNode", id: m.id, label: e.target.value.trim() || m.label }); setEditing(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{ border: "none", background: "none", font: "inherit", color: "inherit", width: Math.max(70, m.label.length * 8) }}
                  />
                ) : m.label}
              </div>
            );
          })}
        </div>
        {!mobile && (
          <div style={{ position: "absolute", right: 16, bottom: 14, display: "flex", gap: 14, background: "var(--color-bg)", border: "1px solid var(--color-divider)", borderRadius: 999, padding: "7px 12px", fontSize: 11 }}>
            {LEGEND.map((s) => (
              <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><StatusSq status={s} />{LEGEND_LABEL[s]}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
