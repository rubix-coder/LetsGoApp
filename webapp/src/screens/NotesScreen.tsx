import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { nav, useMobile, useNow, useRoute } from "../lib/router";
import { useStickyView } from "../lib/viewMemory";

const EDITOR_MODES = ["editor", "markdown"] as const;
import { useEditor } from "../App";
import type { Note, NoteTemplate } from "../lib/types";
import { Seg } from "../components/ui";
import { IBack, IChevronD, IChevronL, IChevronR, IDownload, IFile, IFolder, ILayout, ILink, IPlus, ITodo, ITrash } from "../components/Icons";
import { MobileHeader } from "../shell/AppShell";
import { wordCount } from "../lib/md";
import { saveTextFile } from "../lib/download";
import { GOAL_TAG, hasGoalTag } from "../lib/goals";
import { parseMarkdownTasks } from "../lib/mdTasks";
import { applyTemplateToNote, availableTemplates, buildNoteTemplate, isNoteEmpty } from "../lib/noteTemplates";
import { nextMetaHint, type MetaField, type MetaHint } from "../lib/taskMeta";
import { BlockEditor } from "./notes/BlockEditor";

/** localStorage key holding the last page opened, so switching tabs returns
    to it instead of resetting to the first notebook. */
const LAST_NOTE_KEY = "lg:lastNote";

function agoLabel(t: number, now: number): string {
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function NotesScreen() {
  const { state } = useStore();
  const route = useRoute();
  const mobile = useMobile();
  const noteId = route[1];

  /* Where you were. The tab bar navigates to a bare "/notes", so leaving for
     Todo and coming back used to land on whatever page happened to be first —
     the notebook you were actually working in was lost every single time. The
     last page opened is remembered instead, and only falls back to the first
     one when there is nothing to remember (or it has since been deleted).
     Mobile is deliberately excluded: there a bare "/notes" is the LIST, and
     re-opening a page behind the user's back would trap the back button. */
  useEffect(() => {
    if (noteId) localStorage.setItem(LAST_NOTE_KEY, noteId);
  }, [noteId]);

  const remembered = !mobile && !noteId ? localStorage.getItem(LAST_NOTE_KEY) ?? undefined : undefined;
  const note =
    state.notes.find((n) => n.id === noteId)
    ?? state.notes.find((n) => n.id === remembered)
    ?? (mobile ? undefined : state.notes.find((n) => !n.parentId) ?? state.notes[0]);

  const { addNote } = useNoteActions();

  /* The workspace pane (notebooks + pages) collapses to a slim rail so the
     editor gets the full width; the choice sticks across sessions. */
  const [paneHidden, setPaneHidden] = useState(() => localStorage.getItem("lg:notesPane") === "hidden");
  const togglePane = () => {
    setPaneHidden(!paneHidden);
    localStorage.setItem("lg:notesPane", paneHidden ? "" : "hidden");
  };

  if (mobile) {
    if (!note) return <NoteList onAdd={(template) => addNote(undefined, undefined, template)} />;
    return <NoteEditor note={note} mobile onBack={() => nav("/notes")} />;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      {paneHidden ? (
        <div style={{ width: 36, flex: "none", borderRight: "1px solid var(--color-divider)", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 10 }}>
          <button className="btn btn-icon btn-secondary" style={{ width: 26, height: 26 }} onClick={togglePane} aria-label="Show the notes list" aria-expanded={false} title="Show the notes list">
            <IChevronR size={14} strokeWidth={1.8} />
          </button>
        </div>
      ) : (
      <div style={{ width: 244, flex: "none", borderRight: "1px solid var(--color-divider)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: "1px solid var(--color-divider)" }}>
          <h3 style={{ fontSize: 20, flex: 1 }}>Notes</h3>
          {/* New pages land in the notebook you are working in, not folders[0]. */}
          <NewNoteButton onAdd={(template) => addNote(note?.folderId, undefined, template)} />
          <button className="btn btn-icon btn-ghost" style={{ width: 26, height: 26 }} onClick={togglePane} aria-label="Hide the notes list" aria-expanded title="Hide the notes list — full-width editor">
            <IChevronL size={14} strokeWidth={1.8} />
          </button>
        </div>
        <Tree activeId={note?.id} onSelect={(id) => nav(`/notes/${id}`)} />
      </div>
      )}
      {note ? (
        <NoteEditor key={note.id} note={note} />
      ) : (
        <p style={{ padding: 24, fontSize: 13, color: "var(--color-text-2)" }}>No notes yet — create the first one.</p>
      )}
    </div>
  );
}

/** Shared note create/subpage helpers so the sidebar and editor stay in sync. */
function useNoteActions() {
  const { state, dispatch } = useStore();
  /** `template` picks this note's layout; the Settings choice is only the
      default, so every page can start from whichever scaffold suits it. */
  function addNote(folderId?: string, parentId?: string, template?: NoteTemplate) {
    const id = `n-${Date.now()}`;
    const fid = folderId ?? state.folders[0]?.id ?? "f-work";
    const chosen = template ?? state.settings.noteTemplate ?? "blank";
    const { title, body } = buildNoteTemplate(chosen, Date.now(), state.settings.customNoteTemplate);
    dispatch({ type: "upsertNote", note: { id, folderId: fid, parentId, title, body, updatedAt: Date.now() } });
    nav(`/notes/${id}`);
  }
  /** True when every "+" should open the layout chooser rather than silently
      applying the default (Settings → Plugins → Notes). */
  const askTemplate = !!state.settings.askNoteTemplate;
  return { addNote, askTemplate };
}

/** The list of layouts, as a popup menu. One component so the sidebar's "+",
    every per-notebook and per-page "+", and the editor's "Change layout" all
    offer exactly the same set — including the user's own layout, and marked
    with which one is the current default. */
function TemplateMenu({ onPick, markDefault = true, align = "right" }: {
  onPick: (template: NoteTemplate) => void;
  markDefault?: boolean;
  align?: "left" | "right";
}) {
  const { state } = useStore();
  const fallback = state.settings.noteTemplate ?? "blank";
  const templates = availableTemplates(state.settings.customNoteTemplate);
  return (
    <div
      role="menu"
      style={{
        position: "absolute", [align]: 0, top: "100%", marginTop: 4, zIndex: 40, minWidth: 208,
        background: "var(--color-bg)", border: "1px solid var(--color-divider)",
        borderRadius: "var(--radius)", boxShadow: "var(--shadow-md)", padding: "4px 0",
      }}
    >
      {templates.map((t) => (
        <button
          key={t.id}
          role="menuitem"
          title={t.desc}
          onClick={() => onPick(t.id)}
          style={{
            display: "block", width: "100%", border: "none", background: "none", cursor: "pointer",
            textAlign: "left", padding: "8px 12px", fontSize: 13, color: "var(--color-text)",
            fontFamily: "var(--font-body)",
          }}
        >
          {t.label}
          {markDefault && t.id === fallback && <span style={{ color: "var(--color-text-3)", fontSize: 11 }}> · default</span>}
        </button>
      ))}
    </div>
  );
}

/** Close a popup when the next pointer-down lands outside it. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return ref;
}

/** The inline "+" on a notebook or page row. Silent by default — it applies
    the layout from Settings — and opens the chooser instead when "Ask which
    layout every time" is on, so that setting reaches every create button and
    not just the sidebar's. */
function AddPageButton({ folderId, parentId, label, title, className, iconSize = 13, style }: {
  folderId: string;
  parentId?: string;
  label: string;
  title: string;
  className?: string;
  iconSize?: number;
  style?: React.CSSProperties;
}) {
  const { addNote, askTemplate } = useNoteActions();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  return (
    <div ref={ref} style={{ position: "relative", flex: "none", display: "flex" }}>
      <button
        className={className}
        onClick={() => (askTemplate ? setOpen(!open) : addNote(folderId, parentId))}
        aria-label={label}
        aria-expanded={askTemplate ? open : undefined}
        title={title}
        style={style}
      >
        <IPlus size={iconSize} strokeWidth={1.8} />
      </button>
      {open && <TemplateMenu onPick={(t) => { setOpen(false); addNote(folderId, parentId, t); }} />}
    </div>
  );
}

/** The "+" split into a template chooser: click for the default, or pick a
    layout from the menu. Used by the sidebar header and the mobile list. */
function NewNoteButton({ onAdd, size = 28 }: { onAdd: (template?: NoteTemplate) => void; size?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  return (
    <div ref={ref} style={{ position: "relative", flex: "none" }}>
      <button
        className="btn btn-icon btn-secondary"
        style={{ width: size, height: size }}
        onClick={() => setOpen(!open)}
        aria-label="New note"
        aria-expanded={open}
      >
        <IPlus size={15} strokeWidth={1.6} />
      </button>
      {open && <TemplateMenu onPick={(t) => { setOpen(false); onAdd(t); }} />}
    </div>
  );
}

function Tree({ activeId, onSelect }: { activeId?: string; onSelect: (id: string) => void }) {
  const { state, dispatch } = useStore();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  // Drag-to-reorder: remember what's being dragged (a notebook, or a page and
  // which sibling group it belongs to) and which row is hovered, so we can draw
  // a drop line. Pages only reorder within their own group.
  const drag = useRef<{ kind: "folder" | "note"; id: string; group?: string } | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const noteGroup = (folderId: string, parentId?: string) => `${folderId}::${parentId ?? ""}`;
  const dropLine = (id: string) => (overId === id ? "inset 0 2px 0 0 var(--color-accent)" : undefined);
  /* Multi-select: the one place anything in the workspace gets deleted. It is
     opt-in ("Select"), and while it is on EVERY row — notebook, page and
     subpage alike — carries a checkbox, so a mixed selection is deleted in a
     single confirm. Before this, notebooks could only be deleted through a
     per-row icon and pages only through their own separate select mode, which
     is why "delete a notebook" read as impossible. */
  const [selMode, setSelMode] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmDel, setConfirmDel] = useState(false);
  const [addingFolder, setAddingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  /** Notebook awaiting a delete confirm — the click that follows really removes
      it and its pages, so it never happens on a single stray click. */
  const [confirmFolder, setConfirmFolder] = useState<string | null>(null);
  /** Same, for a page/subpage row — deleting takes its subpages with it. */
  const [confirmNote, setConfirmNote] = useState<string | null>(null);
  const childrenOf = (parentId: string | undefined, folderId: string) =>
    state.notes.filter((n) => n.folderId === folderId && (n.parentId ?? undefined) === parentId);

  /* Selection keys are prefixed by kind, so one Set holds both without a
     notebook and a page ever colliding on an id. */
  const folderKey = (id: string) => `f:${id}`;
  const noteKey = (id: string) => `n:${id}`;
  const toggleSel = (key: string) =>
    setSel((cur) => { const next = new Set(cur); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const exitSelect = () => { setSelMode(false); setSel(new Set()); setConfirmDel(false); };

  const selFolders = state.folders.filter((f) => sel.has(folderKey(f.id)));
  const selNotes = state.notes.filter((n) => sel.has(noteKey(n.id)));
  // The last notebook is never removed — a new page needs somewhere to live —
  // so selecting every one of them keeps the last, and says so before the tap.
  const keptFolder = selFolders.length === state.folders.length ? state.folders[state.folders.length - 1] : undefined;
  const doomedFolders = selFolders.filter((f) => f.id !== keptFolder?.id);
  const doomedFolderIds = new Set(doomedFolders.map((f) => f.id));
  // Pages inside a doomed notebook go with it; counting them twice would make
  // the confirm label lie about how much is about to disappear.
  const doomedNotes = selNotes.filter((n) => !doomedFolderIds.has(n.folderId));
  const doomedCount = doomedFolders.length + doomedNotes.length;

  const selectionSummary = [
    doomedFolders.length ? `${doomedFolders.length} notebook${doomedFolders.length === 1 ? "" : "s"}` : "",
    doomedNotes.length ? `${doomedNotes.length} page${doomedNotes.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");

  const deleteSelected = () => {
    // Notebooks first: each takes its pages with it, so any page also ticked
    // inside one is already gone by the time its own delete runs (and
    // deleteNote removes a page's whole subtree, so a parent plus a descendant
    // in the same selection is fine too — the descendant's delete no-ops).
    doomedFolders.forEach((f) => dispatch({ type: "deleteFolder", id: f.id }));
    doomedNotes.forEach((n) => dispatch({ type: "deleteNote", id: n.id }));
    exitSelect();
  };

  const NoteBranch = ({ note, folderId, depth }: { note: Note; folderId: string; depth: number }) => {
    const kids = childrenOf(note.id, folderId);
    // Everything unfolds while selecting: the row's disclosure control is a
    // checkbox in that mode, so a collapsed branch would be unreachable.
    const isOpen = selMode || !closed[note.id];
    const active = note.id === activeId;
    const checked = sel.has(noteKey(note.id));
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          className="note-row"
          draggable={!selMode}
          onDragStart={(e) => { drag.current = { kind: "note", id: note.id, group: noteGroup(folderId, note.parentId) }; e.dataTransfer.effectAllowed = "move"; }}
          onDragEnd={() => { drag.current = null; setOverId(null); }}
          onDragOver={(e) => {
            const d = drag.current;
            if (d?.kind === "note" && d.id !== note.id && d.group === noteGroup(folderId, note.parentId)) { e.preventDefault(); setOverId(note.id); }
          }}
          onDragLeave={() => setOverId((cur) => (cur === note.id ? null : cur))}
          onDrop={(e) => {
            const d = drag.current;
            if (d?.kind === "note" && d.id !== note.id && d.group === noteGroup(folderId, note.parentId)) { e.preventDefault(); dispatch({ type: "reorderNote", id: d.id, targetId: note.id }); }
            drag.current = null; setOverId(null);
          }}
          style={{
            display: "flex", alignItems: "center", gap: 4, paddingLeft: 12 + depth * 14, paddingRight: 6,
            borderLeft: active ? "2px solid var(--color-accent)" : "2px solid transparent",
            background: checked || active ? "var(--accent-wash)" : "none",
            boxShadow: dropLine(note.id),
          }}
        >
          {selMode ? (
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggleSel(noteKey(note.id))}
              aria-label={`Select page ${note.title || "Untitled"}`}
              style={{ width: 15, height: 15, flex: "none", margin: "0 1px", cursor: "pointer", accentColor: "var(--color-accent)" }}
            />
          ) : (
            <button
              onClick={() => (kids.length ? setClosed({ ...closed, [note.id]: isOpen }) : onSelect(note.id))}
              aria-label={kids.length ? `Toggle ${note.title}` : note.title}
              style={{ width: 16, flex: "none", display: "grid", placeItems: "center", border: "none", background: "none", cursor: "pointer", color: "var(--color-text-3)", padding: 0 }}
            >
              {kids.length ? (isOpen ? <IChevronD size={12} strokeWidth={2} /> : <IChevronR size={12} strokeWidth={2} />) : <IFile size={13} />}
            </button>
          )}
          <button
            onClick={() => (selMode ? toggleSel(noteKey(note.id)) : onSelect(note.id))}
            style={{
              flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", cursor: "pointer", padding: "6px 2px", fontSize: 13,
              color: active ? "var(--accent-strong)" : "color-mix(in srgb, var(--color-text) 72%, transparent)",
              fontWeight: active ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {note.title || "Untitled"}
          </button>
          {!selMode && (
            <AddPageButton
              className="note-add"
              folderId={folderId}
              parentId={note.id}
              label={`Add a page inside ${note.title}`}
              title="Add subpage"
              style={{ flex: "none", width: 20, height: 20, display: "grid", placeItems: "center", border: "none", background: "none", cursor: "pointer", color: "var(--color-text-3)" }}
            />
          )}
          {/* Per-row delete — the notebooks always had one; pages only had it
              through "Select" mode, which read as "you can't delete a page". */}
          {!selMode && (
            confirmNote === note.id ? (
              <button
                onClick={() => {
                  dispatch({ type: "deleteNote", id: note.id });
                  setConfirmNote(null);
                  if (note.id === activeId) nav("/notes");
                }}
                title={kids.length ? `Delete “${note.title}” and its ${kids.length} subpage${kids.length === 1 ? "" : "s"}` : `Delete “${note.title}”`}
                style={{ flex: "none", border: "none", background: "none", cursor: "pointer", color: "var(--prio-hi-text)", fontSize: 11, padding: "2px 4px" }}
              >
                Really?
              </button>
            ) : (
              <button
                className="note-del"
                onClick={() => setConfirmNote(note.id)}
                aria-label={`Delete page ${note.title || "Untitled"}`}
                title={kids.length ? `Delete page — its ${kids.length} subpage${kids.length === 1 ? "" : "s"} go too` : "Delete page"}
                style={{ flex: "none", width: 20, height: 20, display: "grid", placeItems: "center", border: "none", background: "none", cursor: "pointer", color: "var(--color-text-3)" }}
              >
                <ITrash size={12} />
              </button>
            )
          )}
        </div>
        {isOpen && kids.map((k) => <NoteBranch key={k.id} note={k} folderId={folderId} depth={depth + 1} />)}
      </div>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", fontSize: 13 }}>
      {/* Select mode: reveal per-page checkboxes, then bulk-delete the selection. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 34, padding: "4px 10px", borderBottom: "1px solid var(--color-divider-soft)" }}>
        {selMode ? (
          <>
            <span style={{ fontSize: 12, color: "var(--color-text-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectionSummary || "Nothing selected"}
            </span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 4, flex: "none" }}>
              {confirmDel ? (
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: "3px 8px", color: "var(--prio-hi-text)", borderColor: "var(--prio-hi-border)" }} onClick={deleteSelected}>
                  Delete {doomedCount}?
                </button>
              ) : (
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: "3px 8px", display: "flex", alignItems: "center", gap: 5, color: doomedCount ? "var(--prio-hi-text)" : "var(--color-text-3)" }} disabled={!doomedCount} onClick={() => setConfirmDel(true)}>
                  <ITrash size={13} /> Delete
                </button>
              )}
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "3px 8px", color: "var(--color-text-2)" }} onClick={exitSelect}>Cancel</button>
            </span>
          </>
        ) : (
          <button className="btn btn-ghost" style={{ marginLeft: "auto", fontSize: 12, padding: "3px 8px", color: "var(--color-text-2)" }} onClick={() => setSelMode(true)} disabled={state.notes.length === 0 && state.folders.length < 2}>
            Select
          </button>
        )}
      </div>
      {selMode && (
        <p style={{ margin: 0, padding: "5px 12px", fontSize: 11, lineHeight: 1.5, color: "var(--color-text-3)", borderBottom: "1px solid var(--color-divider-soft)" }}>
          {keptFolder
            ? `“${keptFolder.name}” is kept — a vault always needs one notebook.`
            : "Tick notebooks, pages or subpages. Deleting a notebook deletes its pages; deleting a page deletes its subpages."}
        </p>
      )}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 6px", display: "flex", flexDirection: "column" }}>
      {state.folders.map((f) => {
        const roots = childrenOf(undefined, f.id);
        const isOpen = selMode || !closed[f.id];
        return (
          <div key={f.id} style={{ display: "flex", flexDirection: "column" }}>
            {/* The row carries the drag/drop; the name and the delete control are
                siblings inside it, since a button cannot live inside a button. */}
            <div
              className="note-row"
              draggable={!selMode}
              onDragStart={(e) => { drag.current = { kind: "folder", id: f.id }; e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => { drag.current = null; setOverId(null); }}
              // A folder accepts two drops: another folder (reorder) and a page
              // from anywhere (move it, and its subpages, into this notebook).
              onDragOver={(e) => {
                const d = drag.current;
                if (!d) return;
                if (d.kind === "folder" ? d.id !== f.id : state.notes.find((n) => n.id === d.id)?.folderId !== f.id) {
                  e.preventDefault();
                  setOverId(f.id);
                }
              }}
              onDragLeave={() => setOverId((cur) => (cur === f.id ? null : cur))}
              onDrop={(e) => {
                const d = drag.current;
                if (d?.kind === "folder" && d.id !== f.id) {
                  e.preventDefault();
                  dispatch({ type: "reorderFolder", id: d.id, targetId: f.id });
                } else if (d?.kind === "note") {
                  e.preventDefault();
                  dispatch({ type: "moveNoteToFolder", id: d.id, folderId: f.id });
                }
                drag.current = null; setOverId(null);
              }}
              style={{
                display: "flex", alignItems: "center", paddingRight: 6, boxShadow: dropLine(f.id),
                background: sel.has(folderKey(f.id)) ? "var(--accent-wash)" : undefined,
              }}
            >
              {selMode && (
                <input
                  type="checkbox"
                  checked={sel.has(folderKey(f.id))}
                  onChange={() => toggleSel(folderKey(f.id))}
                  aria-label={`Select notebook ${f.name}`}
                  style={{ width: 15, height: 15, flex: "none", margin: "0 1px 0 11px", cursor: "pointer", accentColor: "var(--color-accent)" }}
                />
              )}
              <button
                onClick={() => (selMode ? toggleSel(folderKey(f.id)) : setClosed({ ...closed, [f.id]: isOpen }))}
                style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", border: "none", background: "none", cursor: "pointer", color: "color-mix(in srgb, var(--color-text) 75%, transparent)", fontSize: 13, textAlign: "left" }}
                aria-expanded={isOpen}
              >
                {!selMode && (isOpen ? <IChevronD size={13} strokeWidth={2} /> : <IChevronR size={13} strokeWidth={2} />)}
                <IFolder size={15} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                <span style={{ fontSize: 11, color: "var(--color-text-3)" }}>{roots.length || ""}</span>
              </button>
              {!selMode && (
                <AddPageButton
                  className="note-del"
                  folderId={f.id}
                  label={`New page in ${f.name}`}
                  title={`New page in “${f.name}”`}
                  style={{ flex: "none", border: "none", background: "none", cursor: "pointer", color: "var(--color-text-3)", padding: "2px 4px", display: "flex" }}
                />
              )}
              {/* The last notebook has no delete: a new note needs a home. */}
              {!selMode && state.folders.length > 1 && (
                confirmFolder === f.id ? (
                  <button
                    onClick={() => { dispatch({ type: "deleteFolder", id: f.id }); setConfirmFolder(null); }}
                    title={roots.length ? `Delete “${f.name}” and its ${roots.length} page${roots.length === 1 ? "" : "s"}` : `Delete “${f.name}”`}
                    style={{ flex: "none", border: "none", background: "none", cursor: "pointer", color: "var(--prio-hi-text)", fontSize: 11, padding: "2px 4px" }}
                  >
                    Really?
                  </button>
                ) : (
                  <button
                    className="note-del"
                    onClick={() => setConfirmFolder(f.id)}
                    aria-label={`Delete notebook ${f.name}`}
                    title={roots.length ? `Delete notebook — its ${roots.length} page${roots.length === 1 ? "" : "s"} go too` : "Delete notebook"}
                    style={{ flex: "none", border: "none", background: "none", cursor: "pointer", color: "var(--color-text-3)", padding: "2px 4px", display: "flex" }}
                  >
                    <ITrash size={13} />
                  </button>
                )
              )}
            </div>
            {isOpen && roots.map((n) => <NoteBranch key={n.id} note={n} folderId={f.id} depth={1} />)}
          </div>
        );
      })}
      {!selMode && (
        <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--color-divider-soft)" }}>
          {addingFolder ? (
            <form
              style={{ display: "flex", gap: 4, padding: "4px 8px" }}
              onSubmit={(e) => {
                e.preventDefault();
                dispatch({ type: "addFolder", name: folderName });
                setFolderName("");
                setAddingFolder(false);
              }}
            >
              <input
                className="input"
                autoFocus
                value={folderName}
                placeholder="Notebook name"
                aria-label="New notebook name"
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setAddingFolder(false); setFolderName(""); } }}
                style={{ flex: 1, minWidth: 0, fontSize: 12, padding: "4px 6px" }}
              />
              <button className="btn btn-primary" type="submit" style={{ fontSize: 12, padding: "3px 9px" }} disabled={!folderName.trim()}>Add</button>
            </form>
          ) : (
            <button
              className="btn btn-ghost"
              style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "flex-start", fontSize: 12, padding: "6px 10px", color: "var(--color-text-2)" }}
              onClick={() => setAddingFolder(true)}
            >
              <IPlus size={13} strokeWidth={1.8} /> New notebook
            </button>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

function NoteList({ onAdd }: { onAdd: (template?: NoteTemplate) => void }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <MobileHeader
        title="Notes"
        right={
          <NewNoteButton onAdd={onAdd} size={34} />
        }
      />
      <Tree onSelect={(id) => nav(`/notes/${id}`)} />
    </div>
  );
}

function NoteEditor({ note, mobile, onBack }: { note: Note; mobile?: boolean; onBack?: () => void }) {
  const { state, dispatch } = useStore();
  const { openTask } = useEditor();
  const now = useNow(30_000);
  /* Editor or raw markdown — remembered per device. Anyone who works in
     markdown was switching back to it on every note and every visit. */
  const [mode, setMode] = useStickyView("lg:notesMode", EDITOR_MODES, "editor");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sentFlash, setSentFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  const backlinks = useMemo(
    () => state.tasks.filter((t) => (t.description ?? "").includes(`[[${note.title}]]`)),
    [state.tasks, note.title],
  );
  const bulletCount = useMemo(() => parseMarkdownTasks(note.body).length, [note.body]);

  const ancestors = useMemo(() => {
    const chain: Note[] = [];
    let pid = note.parentId;
    const guard = new Set<string>();
    while (pid && !guard.has(pid)) {
      guard.add(pid);
      const p = state.notes.find((n) => n.id === pid);
      if (!p) break;
      chain.unshift(p);
      pid = p.parentId;
    }
    return chain;
  }, [note.parentId, state.notes]);
  const folder = state.folders.find((f) => f.id === note.folderId);

  /** Put a layout onto THIS page. Non-destructive: an empty page is replaced,
      a page with content keeps every word and gets the layout's sections
      appended below a rule (lib/noteTemplates.ts). */
  function applyLayout(template: NoteTemplate) {
    const next = applyTemplateToNote(note, template, Date.now(), state.settings.customNoteTemplate);
    dispatch({ type: "upsertNote", note: { ...note, title: next.title, body: next.body, updatedAt: Date.now() } });
  }

  function sendToTodo() {
    // `noteId` lets the import stamp `@id(...)` back onto every task line here,
    // which is what makes renaming a line safe from now on.
    dispatch({ type: "importMarkdown", text: note.body, sourceName: note.title, linkBack: true, noteId: note.id });
    setSentFlash(`${bulletCount} bullet${bulletCount === 1 ? "" : "s"} synced to Todo — re-send anytime to keep them matched.`);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSentFlash(null), 4500);
  }

  function update(body: string) {
    const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || note.title;
    dispatch({ type: "upsertNote", note: { ...note, body, title, updatedAt: Date.now() } });
  }

  function openLink(name: string) {
    const target = state.notes.find((n) => n.title === name);
    if (target) { nav(`/notes/${target.id}`); return; }
    const task = state.tasks.find((t) => t.title === name);
    if (task) openTask(task.id);
  }

  /** markdown-all-in-one-style shortcuts for the raw markdown mode. */
  function onEditorKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget;
    if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "i")) {
      e.preventDefault();
      const mark = e.key === "b" ? "**" : "*";
      const { selectionStart: s, selectionEnd: end, value } = ta;
      const seln = value.slice(s, end);
      const wrapped = seln.startsWith(mark) && seln.endsWith(mark) && seln.length >= mark.length * 2
        ? seln.slice(mark.length, -mark.length)
        : `${mark}${seln}${mark}`;
      update(value.slice(0, s) + wrapped + value.slice(end));
      requestAnimationFrame(() => ta.setSelectionRange(s, s + wrapped.length));
      return;
    }
    if (e.key === "Tab") {
      // Markdown source has no focus-traversal use for Tab; make it indent
      // (two spaces) like a code editor. Shift+Tab — and any Tab with a
      // selection — outdents/indents every line the selection touches.
      e.preventDefault();
      const INDENT = "  ";
      const { selectionStart: s, selectionEnd: end, value } = ta;
      if (s === end && !e.shiftKey) {
        update(value.slice(0, s) + INDENT + value.slice(s));
        const caret = s + INDENT.length;
        requestAnimationFrame(() => ta.setSelectionRange(caret, caret));
        return;
      }
      const from = value.lastIndexOf("\n", s - 1) + 1;
      const nl = value.indexOf("\n", end);
      const to = nl === -1 ? value.length : nl;
      let firstCut = 0;
      let totalCut = 0;
      const lines = value.slice(from, to).split("\n").map((ln, i) => {
        if (e.shiftKey) {
          const cut = /^( {1,2}|\t)/.exec(ln)?.[0].length ?? 0;
          if (i === 0) firstCut = cut;
          totalCut += cut;
          return ln.slice(cut);
        }
        if (i === 0) firstCut = -INDENT.length;
        totalCut -= INDENT.length;
        return INDENT + ln;
      });
      update(value.slice(0, from) + lines.join("\n") + value.slice(to));
      const ns = Math.max(from, s - firstCut);
      const ne = Math.max(ns, end - totalCut);
      requestAnimationFrame(() => ta.setSelectionRange(ns, ne));
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      const { selectionStart: s, value } = ta;
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const line = value.slice(lineStart, s);
      const m = /^(\s*)(?:([-*+])( \[[ xX]\])? |(\d+)\. )(.*)$/.exec(line);
      if (!m) return;
      e.preventDefault();
      if (!m[5].trim()) {
        update(value.slice(0, lineStart) + value.slice(s));
        requestAnimationFrame(() => ta.setSelectionRange(lineStart, lineStart));
        return;
      }
      const prefix = m[4] !== undefined ? `${Number(m[4]) + 1}. ` : `${m[2]}${m[3] ? " [ ]" : ""} `;
      const inserted = `\n${m[1]}${prefix}`;
      update(value.slice(0, s) + inserted + value.slice(s));
      const caret = s + inserted.length;
      requestAnimationFrame(() => ta.setSelectionRange(caret, caret));
    }
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: mobile ? "10px 12px" : "10px 20px", borderBottom: "1px solid var(--color-divider)" }}>
        {mobile && (
          <button className="btn btn-icon btn-ghost" style={{ width: 30, height: 30, color: "var(--color-text-2)" }} onClick={onBack} aria-label="Back to notes">
            <IBack size={17} strokeWidth={1.6} />
          </button>
        )}
        {/* Breadcrumb: folder › ancestor pages › current. */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, flex: 1, fontSize: 12, color: "var(--color-text-2)", overflow: "hidden", whiteSpace: "nowrap" }}>
          {/* The notebook name is also the move control — picking another one
              moves this page (and its subpages) there. Shown on mobile too,
              where the rest of the breadcrumb is hidden but moving still
              needs to be reachable. */}
          {folder && (
            <select
              value={note.folderId}
              aria-label="Notebook — change to move this page"
              title={note.parentId ? "Moving to another notebook makes this a top-level page there" : "Move this page to another notebook"}
              onChange={(e) => dispatch({ type: "moveNoteToFolder", id: note.id, folderId: e.target.value })}
              style={{
                flex: "none", maxWidth: 150, border: "1px solid transparent", background: "none",
                color: "var(--color-text-2)", fontSize: 12, fontFamily: "inherit", padding: "2px 4px",
                borderRadius: 4, cursor: "pointer",
              }}
            >
              {state.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          {!mobile && ancestors.map((a) => (
            <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              <span style={{ color: "var(--color-text-3)" }}>›</span>
              <button onClick={() => nav(`/notes/${a.id}`)} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: "var(--accent-strong)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130 }}>{a.title}</button>
            </span>
          ))}
          {!mobile && (ancestors.length > 0 || folder) && <span style={{ color: "var(--color-text-3)" }}>›</span>}
          <span style={{ color: "var(--color-text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note.title || "Untitled"}</span>
        </div>
        <Seg
          small
          ariaLabel="Editor mode"
          items={[{ id: "editor", label: "Editor" }, { id: "markdown", label: "Markdown" }]}
          active={mode}
          onSelect={(m) => setMode(m as "editor" | "markdown")}
        />
        <ChangeLayoutButton note={note} onApply={applyLayout} />
        <AddPageButton
          className="btn btn-icon btn-ghost"
          folderId={note.folderId}
          parentId={note.id}
          label="Add subpage"
          title={`Add a page inside "${note.title}"`}
          iconSize={16}
          style={{ width: 28, height: 28, color: "var(--color-text-2)" }}
        />
        <button
          className="btn btn-icon btn-ghost"
          style={{ width: 28, height: 28, color: "var(--color-text-2)" }}
          title={`Export "${note.title}.md" — drop it on Todo (here or on desktop) to import its bullets`}
          aria-label="Export note as markdown"
          onClick={() => void saveTextFile(`${note.title.replace(/[/\\:]/g, "-")}.md`, "text/markdown", note.body)}
        >
          <IDownload size={15} />
        </button>
        {confirmDelete ? (
          <button className="btn btn-secondary" style={{ fontSize: 12, color: "var(--prio-hi-text)", borderColor: "var(--prio-hi-border)" }} onClick={() => { dispatch({ type: "deleteNote", id: note.id }); nav("/notes"); }}>
            Really delete?
          </button>
        ) : (
          <button className="btn btn-icon btn-ghost" style={{ width: 28, height: 28, color: "var(--color-text-2)" }} onClick={() => setConfirmDelete(true)} aria-label="Delete note">
            <ITrash size={15} />
          </button>
        )}
      </div>

      {/* Editor mode carries the tags inside the formatting bar (saves a whole
          chrome row); the markdown view has no bar, so they keep their own row. */}
      {mode !== "editor" && <NoteTags note={note} />}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {mode === "editor" ? (
          /* Wide view: the editor spans the pane; the draggable margin rule
             inside BlockEditor sets where content starts (Word-style). */
          <div style={{ padding: mobile ? "8px 10px" : "12px 16px" }}>
            <BlockEditor body={note.body} onChange={update} onOpenLink={openLink} barExtra={<NoteTags note={note} inline />} />
          </div>
        ) : (
          <MarkdownRaw body={note.body} onChange={update} onKeyDown={onEditorKeyDown} />
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: mobile ? "9px 14px" : "9px 20px", borderTop: "1px solid var(--color-divider)", fontSize: 12, color: "var(--color-text-2)" }}>
        <span style={{ color: "var(--color-accent)", display: "flex" }}><ILink size={14} strokeWidth={1.6} /></span>
        {backlinks.length > 0 ? (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Linked from{" "}
            {backlinks.map((t, i) => (
              <button key={t.id} onClick={() => openTask(t.id)} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: "var(--accent-strong)", fontSize: 12 }}>
                {t.title}{i < backlinks.length - 1 ? ", " : ""}
              </button>
            ))}
          </span>
        ) : (
          <span>No task links yet</span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-text-3)", whiteSpace: "nowrap" }}>edited {agoLabel(note.updatedAt, now)}</span>
        {sentFlash ? (
          <span style={{ fontSize: 12, color: "var(--accent-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {sentFlash}
          </span>
        ) : (
          <button
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: "3px 10px", flex: "none", ...(bulletCount ? { color: "var(--accent-strong)", borderColor: "var(--color-accent)" } : {}) }}
            title={bulletCount ? "Create/sync tasks from this note's bullets — edits and deletions here carry over on re-send" : "Write - [ ] bullets in the note to send them to Todo"}
            disabled={!bulletCount}
            onClick={sendToTodo}
          >
            <ITodo size={13} />
            Send {bulletCount || ""} to Todo
          </button>
        )}
        <span style={{ whiteSpace: "nowrap" }}>{wordCount(note.body)} words</span>
      </div>
    </div>
  );
}

/** Tag strip under the note header. GOAL gets its own toggle rather than
    hiding among free-form tags: it is the one tag that changes behaviour
    (the page gains a progress bar on the dashboard), so it deserves to be
    discoverable without knowing the magic word. */
function NoteTags({ note, inline }: { note: Note; inline?: boolean }) {
  const { dispatch } = useStore();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const tags = note.tags ?? [];
  const isGoal = hasGoalTag(note);

  const write = (next: string[]) =>
    dispatch({ type: "upsertNote", note: { ...note, tags: next.length ? next : undefined, updatedAt: Date.now() } });

  const addTag = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) return;
    write([...tags, value]);
  };

  return (
    /* inline: lives at the right end of the editor's formatting bar; standalone
       (markdown view): its own bordered row above the text. */
    <div style={inline
      ? { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }
      : { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "6px 20px", borderBottom: "1px solid var(--color-divider-soft)" }}>
      <button
        className="btn btn-ghost"
        aria-pressed={isGoal}
        title={isGoal ? "Tracked as a goal on the dashboard" : "Track this page as a goal — the dashboard shows its progress"}
        onClick={() => (isGoal ? write(tags.filter((t) => t.trim().toLowerCase() !== GOAL_TAG)) : addTag("GOAL"))}
        style={{
          fontSize: 11, padding: "2px 9px", letterSpacing: "0.04em", flex: "none",
          border: `1px solid ${isGoal ? "var(--color-accent)" : "var(--color-divider)"}`,
          color: isGoal ? "var(--accent-strong)" : "var(--color-text-3)",
          background: isGoal ? "var(--accent-wash)" : "none",
        }}
      >
        {isGoal ? "◆ GOAL" : "◇ Goal"}
      </button>
      {tags
        .filter((t) => t.trim().toLowerCase() !== GOAL_TAG)
        .map((t) => (
          <span key={t} className="tag tag-neutral" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {t}
            <button
              aria-label={`Remove tag ${t}`}
              onClick={() => write(tags.filter((x) => x !== t))}
              style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: "inherit", lineHeight: 1, fontSize: 13 }}
            >
              &times;
            </button>
          </span>
        ))}
      {adding ? (
        <form
          onSubmit={(e) => { e.preventDefault(); addTag(draft); setDraft(""); setAdding(false); }}
          style={{ display: "flex", gap: 4 }}
        >
          <input
            className="input"
            autoFocus
            value={draft}
            placeholder="tag"
            aria-label="New tag"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { addTag(draft); setDraft(""); setAdding(false); }}
            onKeyDown={(e) => { if (e.key === "Escape") { setDraft(""); setAdding(false); } }}
            style={{ width: 110, fontSize: 11, padding: "2px 6px" }}
          />
        </form>
      ) : (
        <button
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: "2px 7px", color: "var(--color-text-3)" }}
          onClick={() => setAdding(true)}
        >
          + tag
        </button>
      )}
    </div>
  );
}

/** Raw markdown source view: line-number gutter (scroll-synced to the
    textarea) plus the shared word-wrap preference set in the editor bar
    (lg:noteWrap). Wrap off = horizontal scroll, numbers align 1:1. */
/** "Change layout" for a page that already exists — the other half of the
    template feature, which until now could only be chosen at creation time and
    never afterwards. Deliberately worded as APPLY, not "switch": the page's own
    writing is never traded for a scaffold. */
function ChangeLayoutButton({ note, onApply }: { note: Note; onApply: (template: NoteTemplate) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const empty = isNoteEmpty(note.body);

  return (
    <div ref={ref} style={{ position: "relative", flex: "none", display: "flex" }}>
      <button
        className="btn btn-icon btn-ghost"
        style={{ width: 28, height: 28, color: "var(--color-text-2)" }}
        onClick={() => setOpen(!open)}
        aria-label="Change this page's layout"
        aria-expanded={open}
        title={empty ? "Start this page from a layout" : "Add a layout's sections below what is already here"}
      >
        <ILayout size={15} />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 40, minWidth: 228,
            background: "var(--color-bg)", border: "1px solid var(--color-divider)",
            borderRadius: "var(--radius)", boxShadow: "var(--shadow-md)", padding: "4px 0",
          }}
        >
            <p style={{ margin: 0, padding: "6px 12px 8px", fontSize: 11, lineHeight: 1.45, color: "var(--color-text-3)", borderBottom: "1px solid var(--color-divider-soft)" }}>
              {empty
                ? "This page is empty — the layout replaces it."
                : "Your writing stays. The layout's sections are added below it."}
            </p>
          <TemplateMenuRows onPick={(t) => { setOpen(false); onApply(t); }} />
        </div>
      )}
    </div>
  );
}

/** The same rows `TemplateMenu` draws, without its own popup frame — so the
    "change layout" popup can put an explanation above them. */
function TemplateMenuRows({ onPick }: { onPick: (template: NoteTemplate) => void }) {
  const { state } = useStore();
  const templates = availableTemplates(state.settings.customNoteTemplate);
  return (
    <>
      {templates.map((t) => (
        <button
          key={t.id}
          role="menuitem"
          title={t.desc}
          onClick={() => onPick(t.id)}
          style={{
            display: "block", width: "100%", border: "none", background: "none", cursor: "pointer",
            textAlign: "left", padding: "8px 12px", fontSize: 13, color: "var(--color-text)",
            fontFamily: "var(--font-body)",
          }}
        >
          {t.label}
        </button>
      ))}
    </>
  );
}

function MarkdownRaw({ body, onChange, onKeyDown }: {
  body: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const wrap = localStorage.getItem("lg:noteWrap") !== "0";
  const gutterRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [skipped, setSkipped] = useState<MetaField[]>([]);
  const lines = body.split("\n").length;

  /* The same guided entry the block editor offers, on the raw source. The
     mirror repeats the document up to the END OF THE CARET'S LINE in
     transparent ink, so the hint lands exactly where typing would continue —
     wrapping, scrolling and all. Every layout-affecting style below is shared
     with the textarea through TEXT_STYLE; they must not drift. */
  const lineStart = body.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const lineBreak = body.indexOf("\n", caret);
  const lineEnd = lineBreak === -1 ? body.length : lineBreak;
  const line = body.slice(lineStart, lineEnd);
  const box = /^\s*[-*+] \[[ xX/-]\] /.exec(line);
  const hint: MetaHint | undefined =
    box && caret === lineEnd && /[ \t]$/.test(line)
      ? nextMetaHint(line.slice(box[0].length), skipped, Date.now())
      : undefined;

  // A skip belongs to the line it was made on.
  useEffect(() => { setSkipped([]); }, [lineStart]);

  function accept(h: MetaHint) {
    const next = body.slice(0, lineEnd) + h.insert + body.slice(lineEnd);
    const pos = lineEnd + h.insert.length - h.caretFromEnd;
    onChange(next);
    requestAnimationFrame(() => {
      taRef.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  }

  const TEXT_STYLE: React.CSSProperties = {
    fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.7,
    padding: "20px 24px 20px 12px",
    whiteSpace: wrap ? "pre-wrap" : "pre",
    overflowWrap: wrap ? "break-word" : "normal",
  };

  const syncCaret = (t: HTMLTextAreaElement) => setCaret(t.selectionStart);

  return (
    <div className="md-raw">
      <pre ref={gutterRef} className="md-raw-gutter" aria-hidden>
        {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
      </pre>
      <div style={{ position: "relative", flex: 1, minWidth: 0, height: "100%", display: "flex" }}>
        <textarea
          ref={taRef}
          className="input"
          aria-label="Markdown source"
          wrap={wrap ? "soft" : "off"}
          style={{
            border: "none", background: "none", flex: 1, minWidth: 0, height: "100%",
            minHeight: 320, resize: "none", ...TEXT_STYLE,
          }}
          value={body}
          onChange={(e) => { onChange(e.target.value); syncCaret(e.currentTarget); }}
          onSelect={(e) => syncCaret(e.currentTarget)}
          onKeyDown={(e) => {
            // Guided entry only claims the key while a ghost is showing, which
            // needs a trailing space — so Tab still indents everywhere else.
            if (hint) {
              if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); accept(hint); return; }
              if (e.key === "-") { e.preventDefault(); setSkipped([...skipped, hint.field]); return; }
            }
            onKeyDown(e);
          }}
          onScroll={(e) => {
            if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
            if (ghostRef.current) {
              ghostRef.current.scrollTop = e.currentTarget.scrollTop;
              ghostRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
        />
        {hint && (
          <div
            ref={ghostRef}
            aria-hidden="true"
            style={{
              position: "absolute", inset: 0, overflow: "hidden",
              pointerEvents: "none", userSelect: "none", color: "transparent",
              ...TEXT_STYLE,
            }}
          >
            {body.slice(0, lineEnd)}
            <span className="blk-ghost-hint">{hint.ghost}</span>
            <span className="blk-ghost-key">↹</span>
          </div>
        )}
      </div>
    </div>
  );
}
