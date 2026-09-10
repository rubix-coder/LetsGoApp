import { createContext, useContext, useMemo, useRef, useState } from "react";
import { taskElapsedMin, useStore } from "../../lib/store";
import { useMobile, useNow } from "../../lib/router";
import { useEditor } from "../../App";
import { STATUS_LABEL, type BoardSort, type Task, type TaskStatus } from "../../lib/types";
import { boardStatus, nextStatus, type ColumnStatus } from "../../lib/status";
import { BP, Prio, QuarterBar, StatusSq } from "../../components/ui";
import { StatusMenu } from "../../components/StatusMenu";
import { ICalendar, ICheck, IChevronR, IClock, IDeadline, INoteLines } from "../../components/Icons";
import { fmtDateTime, fmtMin, fmtTime } from "../../lib/dates";
import { renderMd } from "../../lib/md";
import { branchMatches, childIndex, countMatching, isLeaf, latestCompleted, type ChildIndex } from "../../lib/taskTree";
import { occurrenceTask } from "../../lib/occurrence";
import { isAllDayEvent, repeatLabel } from "../../lib/dayEvents";
import { beginTouchDrag, hitData } from "../../lib/touchDrag";

const COLUMNS: ColumnStatus[] = ["pending", "in_progress", "done", "skipped"];

/** Per-status tinted column well (Modern mock). */
const WELL: Record<ColumnStatus, string> = {
  pending: "var(--well-pending)",
  in_progress: "var(--well-progress)",
  done: "var(--well-done)",
  skipped: "var(--well-skipped)",
};

/** Colored column header text + tinted count chip (Modern mock). */
const HEAD: Record<ColumnStatus, { fg?: string; chipBg: string; chipFg?: string }> = {
  pending: { chipBg: "var(--count-neutral)" },
  in_progress: { fg: "var(--head-progress)", chipBg: "var(--count-progress)", chipFg: "var(--head-progress)" },
  done: { fg: "var(--head-done)", chipBg: "var(--count-done)", chipFg: "var(--head-done)" },
  skipped: { fg: "var(--head-skipped)", chipBg: "var(--count-skipped)", chipFg: "var(--head-skipped)" },
};

/** Per-card collapse state for the board: a set of collapsed card ids and a
    toggle. Lets a card shrink to just its title/status to declutter the board. */
const CollapseCtx = createContext<{ collapsed: Set<string>; toggle: (id: string) => void }>({ collapsed: new Set(), toggle: () => {} });
const useCollapsed = (id: string): [boolean, () => void] => {
  const { collapsed, toggle } = useContext(CollapseCtx);
  return [collapsed.has(id), () => toggle(id)];
};

/** Chevron button that collapses/expands a card; stops propagation so it never
    opens the editor or starts a drag. */
function CollapseToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={open ? "Collapse card" : "Expand card"}
      aria-expanded={open}
      style={{ flex: "none", marginTop: 2, display: "flex", background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-text-3)" }}
    >
      <span style={{ display: "flex", transform: open ? "rotate(90deg)" : undefined }}><IChevronR size={11} strokeWidth={2} /></span>
    </button>
  );
}

/** The card's status square, click-to-cycle. A padded hit area (negative
    margin keeps the layout) so it's a real touch target rather than a 9px
    dot that always misses — pointerdown is swallowed so it never starts the
    card drag. A paused square resumes to in-progress on the first click. */
function StatusCycle({ task }: { task: Task }) {
  const { dispatch } = useStore();
  const next = nextStatus(task.status);
  return (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); dispatch({ type: "setStatus", id: task.id, status: next }); }}
      title={task.status === "paused" ? "Paused — click to resume" : "Click to cycle status"}
      aria-label={`Status ${STATUS_LABEL[task.status]} — click to ${task.status === "paused" ? "resume" : "change"}`}
      style={{ flex: "none", display: "flex", alignItems: "flex-start", background: "none", border: "none", cursor: "pointer", padding: 7, margin: "-3px -5px -7px -7px" }}
    >
      <StatusSq status={task.status} size={11} pulse={task.status === "in_progress"} />
    </button>
  );
}

type Item =
  | { kind: "leaf"; task: Task; sort: number }
  | { kind: "split"; root: Task; sort: number };

const SORT_KEY = "lg:kanbanSort";
const SORT_LABEL: Record<BoardSort, string> = {
  manual: "Manual order",
  priority: "Priority",
  deadline: "Deadline",
  start: "Start time",
};

/** The task a board item is keyed by — the leaf itself, or a split card's root. */
const itemTask = (it: Item): Task => (it.kind === "leaf" ? it.task : it.root);

/** Ascending comparator for a sort mode; `manual` keeps the incoming order.
    Undated / unset tasks sort to the end so a half-planned board still reads
    top-down by what IS planned. */
function itemComparator(sort: BoardSort): ((a: Item, b: Item) => number) | null {
  if (sort === "manual") return null;
  const key = (it: Item): number => {
    const t = itemTask(it);
    if (sort === "priority") return t.priority;
    const v = sort === "deadline" ? t.deadline : t.scheduledAt;
    return v ?? Number.POSITIVE_INFINITY;
  };
  return (a, b) => key(a) - key(b);
}

export function Kanban({ tasks }: { tasks: Task[] }) {
  const mobile = useMobile();
  const [mobileCol, setMobileCol] = useState<ColumnStatus>("pending");
  // Column the dragged card is currently over — drives the drop-target
  // highlight. Cleared on drop or when the drag ends (dragend bubbles up
  // from the source card to the grid wrapper, so an abandoned drag clears too).
  const [overCol, setOverCol] = useState<ColumnStatus | null>(null);
  // Mobile cards start collapsed — the narrow board reads as a compact index
  // first, and a tap expands the task you're working. Desktop has the room, so
  // cards start expanded with their full detail on show. (Either way, tasks
  // created after mount stay expanded — what you want right after adding one.)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(mobile ? tasks.map((t) => t.id) : []));
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const { state, dispatch } = useStore();
  // One parentId → children map per render, shared by the split-card helpers so
  // the board classifies + prunes in O(N) instead of rescanning per card.
  const idx = useMemo(() => childIndex(state.tasks), [state.tasks]);

  // Card order: this device's own choice wins, else the synced Settings
  // default, else the original array order. Held in state so the in-board
  // control re-renders on change.
  const [sort, setSortState] = useState<BoardSort>(() => {
    const stored = localStorage.getItem(SORT_KEY);
    if (stored && stored in SORT_LABEL) return stored as BoardSort;
    return state.settings.boardSort ?? "manual";
  });
  const setSort = (next: BoardSort) => { setSortState(next); localStorage.setItem(SORT_KEY, next); };
  const cmp = itemComparator(sort);

  // A leaf root is one card in its own column; a parent is SPLIT — a fragment in
  // every column its subtree has a leaf for, each pruned to that status. Done is
  // LIFO (the task/branch you just finished shows first — desktop 0.41).
  // Routines land in TODAY's occurrence column (fresh pending each morning) —
  // the board is worked "today", and the shared template status must not pin a
  // routine into Done forever. Card gets the view copy; it never writes it back.
  const today = Date.now();
  const columns: Record<ColumnStatus, Item[]> = { pending: [], in_progress: [], done: [], skipped: [] };
  for (const root of tasks) {
    if (isLeaf(idx, root.id)) {
      const view = occurrenceTask(root, today);
      // Paused leaves ride in the In-progress column, styled apart.
      columns[boardStatus(view.status)].push({ kind: "leaf", task: view, sort: view.completedAt ?? 0 });
    } else {
      for (const s of COLUMNS) {
        if (branchMatches(idx, root, s)) {
          columns[s].push({ kind: "split", root, sort: latestCompleted(idx, root) });
        }
      }
    }
  }
  if (cmp) {
    for (const s of COLUMNS) columns[s].sort(cmp);
  } else {
    // Manual order: Done is LIFO (most recently finished first).
    columns.done.sort((a, b) => b.sort - a.sort);
  }

  const renderItem = (item: Item, s: ColumnStatus) =>
    item.kind === "leaf"
      ? <Card key={item.task.id} task={item.task} />
      : <SplitCard key={`${item.root.id}-split`} root={item.root} status={s} idx={idx} />;

  // "Collapse all" fills the set with every card id (leaf tasks + split roots,
  // deduped); a second press clears it.
  const cardIds = new Set<string>();
  for (const s of COLUMNS) for (const it of columns[s]) cardIds.add(it.kind === "leaf" ? it.task.id : it.root.id);
  const allCollapsed = cardIds.size > 0 && [...cardIds].every((id) => collapsed.has(id));
  const collapseAll = () => setCollapsed(allCollapsed ? new Set() : new Set(cardIds));
  const collapseBtn = (
    <button className="btn btn-secondary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={collapseAll}>
      {allCollapsed ? "Expand all" : "Collapse all"}
    </button>
  );
  const sortSelect = (
    <select
      className="input"
      aria-label="Sort cards"
      title="Card order (this device) — the default lives in Settings"
      value={sort}
      onChange={(e) => setSort(e.target.value as BoardSort)}
      style={{ height: 26, fontSize: 12, width: "auto", minHeight: 0, padding: "2px 6px" }}
    >
      {(Object.keys(SORT_LABEL) as BoardSort[]).map((k) => (
        <option key={k} value={k}>{k === "manual" ? "Manual order" : `Sort: ${SORT_LABEL[k]}`}</option>
      ))}
    </select>
  );

  if (mobile) {
    return (
      <CollapseCtx.Provider value={{ collapsed, toggle }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 16px", borderBottom: "1px solid var(--color-divider)", overflowX: "auto" }}>
          {COLUMNS.map((s) => (
            <button
              key={s}
              data-kanban-col={s}
              onClick={() => setMobileCol(s)}
              style={{
                border: "none", background: "none", cursor: "pointer", flex: "none",
                fontSize: 13, paddingBottom: 8, fontFamily: "var(--font-body)",
                fontWeight: mobileCol === s ? 600 : 400,
                borderBottom: mobileCol === s ? "2px solid var(--color-accent)" : "2px solid transparent",
                color: mobileCol === s ? "var(--accent-strong)" : "var(--color-text-2)",
              }}
            >
              {s === "in_progress" ? "In prog." : STATUS_LABEL[s]} {columns[s].length}
            </button>
          ))}
          <span style={{ marginLeft: "auto", flex: "none", paddingBottom: 6, display: "flex", gap: 6 }}>{sortSelect}{collapseBtn}</span>
        </div>
        {/* Bottom padding clears the floating Add-task FAB so the last card's
            actions are never trapped under it. */}
        <div className="gridbg" style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px 96px", backgroundSize: "30px 30px" }}>
          {columns[mobileCol].map((it) => renderItem(it, mobileCol))}
          {columns[mobileCol].length === 0 && <Empty status={mobileCol} />}
        </div>
      </div>
      </CollapseCtx.Provider>
    );
  }

  return (
    <CollapseCtx.Provider value={{ collapsed, toggle }}>
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "8px 22px 0" }}>{sortSelect}{collapseBtn}</div>
      <div
        className="gridbg"
        style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, padding: "12px 22px 18px", overflow: "hidden" }}
        onDragEnd={() => setOverCol(null)}
      >
      {COLUMNS.map((s) => (
        <div
          key={s}
          data-kanban-col={s}
          style={{
            display: "flex", flexDirection: "column", gap: 10, minWidth: 0, minHeight: 0,
            borderRadius: "var(--radius-card)", padding: "10px 10px 12px",
            outline: overCol === s ? "1.5px dashed var(--accent-mid)" : "1.5px dashed transparent",
            outlineOffset: 3,
            background: overCol === s ? "color-mix(in srgb, var(--color-accent) 12%, transparent)" : WELL[s],
          }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverCol((c) => (c === s ? c : s)); }}
          onDrop={(e) => {
            setOverCol(null);
            const id = e.dataTransfer.getData("text/task-id");
            if (id) dispatch({ type: "setStatus", id, status: s });
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px" }}>
            {s === "done"
              ? <span style={{ color: "var(--st-done)", display: "flex" }}><ICheck size={13} strokeWidth={2.4} /></span>
              : <StatusSq status={s} size={8} pulse={s === "in_progress"} />}
            <h4 style={{ fontSize: 15, color: HEAD[s].fg }}>{STATUS_LABEL[s]}</h4>
            <span style={{ font: "600 11px var(--font-mono)", background: HEAD[s].chipBg, color: HEAD[s].chipFg ?? "var(--color-text-2)", borderRadius: 999, padding: "2px 8px" }}>{columns[s].length}</span>
          </div>
          {/* flex:1 so the whole column body is a comfortable drop zone, not just
              the small area the cards happen to occupy. */}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, minHeight: 40 }}>
            {columns[s].map((it) => renderItem(it, s))}
            {columns[s].length === 0 && <Empty status={s} />}
          </div>
        </div>
      ))}
      </div>
    </div>
    </CollapseCtx.Provider>
  );
}

function Empty({ status }: { status: ColumnStatus }) {
  return (
    <p style={{ fontSize: 13, color: "var(--color-text-2)", textAlign: "center", padding: "28px 0" }}>
      Nothing {status === "pending" ? "pending — add a task to get moving" : `${STATUS_LABEL[status].toLowerCase()} here yet`}.
    </p>
  );
}

/** Collapsed "note" chip that expands to an inline, sanitized markdown preview
    of a task's description — same renderMd pipeline (escape-then-markup) as the
    Notes screen. Reused on top-level cards and on subtask rows (subtle). */
function NotePreview({ text, subtle = false }: { text: string; subtle?: boolean }) {
  const [open, setOpen] = useState(false);
  const fontSize = subtle ? 10 : 11;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Hide note" : "Show note"}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "flex-start", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize, color: "var(--accent-strong)", fontFamily: "var(--font-body)" }}
      >
        <INoteLines size={subtle ? 11 : 12} />
        note
        <span style={{ display: "flex", transform: open ? "rotate(90deg)" : undefined }}><IChevronR size={9} strokeWidth={2} /></span>
      </button>
      {open && <div className="notepreview" dangerouslySetInnerHTML={{ __html: renderMd(text) }} />}
    </div>
  );
}

/** A split fragment of a parent card, scoped to one column's status. The header
    is the root; the body is the subtree pruned to branches that reach a leaf of
    this status, so the same parent appears in Done / In progress / Pending with
    only the relevant subtasks under each. */
function SplitCard({ root, status, idx }: { root: Task; status: ColumnStatus; idx: ChildIndex }) {
  const { openTask } = useEditor();
  const count = countMatching(idx, root, status);
  const kids = (idx.get(root.id) ?? []).filter((c) => branchMatches(idx, c, status));
  const [collapsed, toggleCollapse] = useCollapsed(root.id);

  return (
    <BP
      className="lift"
      style={{ background: "var(--color-card)", padding: "11px 12px", display: "flex", flexDirection: "column", gap: 8, cursor: "pointer", borderLeft: "2px solid var(--accent-mid)" }}
      onClick={() => openTask(root.id)}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <CollapseToggle open={!collapsed} onToggle={toggleCollapse} />
        <span style={{ flex: 1, fontSize: 14, fontWeight: 500, lineHeight: 1.25, minWidth: 0 }}>{root.title}</span>
        <span className="tag tag-neutral" style={{ flex: "none" }}>{count} {status === "in_progress" ? "in prog." : STATUS_LABEL[status].toLowerCase()}</span>
        <Prio p={root.priority} />
      </div>
      {!collapsed && (<>
        {root.description?.trim() && <NotePreview text={root.description} />}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, borderLeft: "2px solid var(--color-divider)", paddingLeft: 9 }} onClick={(e) => e.stopPropagation()}>
          {kids.map((c, i) => <PrunedNode key={c.id} task={c} status={status} depth={0} last={i === kids.length - 1} idx={idx} />)}
        </div>
      </>)}
    </BP>
  );
}

/** One node of a pruned subtree: a leaf row when it has no children, otherwise a
    lightweight container header followed by its matching children. */
function PrunedNode({ task, status, depth, last, idx }: { task: Task; status: ColumnStatus; depth: number; last: boolean; idx: ChildIndex }) {
  const kids = idx.get(task.id);
  if (!kids) return <LeafRow task={task} depth={depth} last={last} />;

  const matching = kids.filter((c) => branchMatches(idx, c, status));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: depth * 12 }}>
        <span style={{ flex: "none", fontSize: 11, color: "var(--color-text-3)" }}>{last ? "└" : "├"}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 500, color: "var(--color-text-2)" }}>{task.title}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {matching.map((c, i) => <PrunedNode key={c.id} task={c} status={status} depth={depth + 1} last={i === matching.length - 1} idx={idx} />)}
      </div>
    </div>
  );
}

/** A single matching leaf inside a split card — draggable to another column to
    change its status, with a status menu and its schedule/tags/note. */
function LeafRow({ task: s, depth, last }: { task: Task; depth: number; last: boolean }) {
  const { dispatch } = useStore();
  const { openTask } = useEditor();
  const dragging = useRef(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: depth * 12 }}>
      <div
        draggable
        onDragStart={(e) => { dragging.current = true; e.dataTransfer.setData("text/task-id", s.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { dragging.current = false; }}
        onClick={() => { if (!dragging.current) openTask(s.id); }}
        onPointerDown={(e) => beginTouchDrag(e, {
          label: s.title,
          onDrop: (x, y) => {
            const col = hitData(x, y, "data-kanban-col");
            if (col) dispatch({ type: "setStatus", id: s.id, status: col.value as TaskStatus });
          },
        })}
        style={{ display: "flex", alignItems: "center", gap: 6, cursor: "grab" }}
      >
        <span style={{ flex: "none", fontSize: 11, color: "var(--color-text-3)" }}>{last ? "└" : "├"}</span>
        <StatusSq status={s.status} size={7} />
        <span style={{
          flex: 1, minWidth: 0, fontSize: 12,
          ...(s.status === "done" ? { textDecoration: "line-through", color: "var(--color-text-2)" } : {}),
        }}>
          {s.title}
        </span>
        <Prio p={s.priority} />
        <StatusMenu task={s} />
      </div>
      {(s.scheduledAt || s.tags.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, paddingLeft: 15, fontSize: 10, color: "var(--color-text-3)" }}>
          {s.scheduledAt && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <ICalendar size={10} strokeWidth={1.6} />
              {fmtDateTime(s.scheduledAt)}
            </span>
          )}
          {s.tags.map((tag) => (
            <span key={tag} className="tag tag-neutral" style={{ fontSize: 10, padding: "0 5px" }}>{tag}</span>
          ))}
        </div>
      )}
      {s.description?.trim() && (
        <div style={{ paddingLeft: 15 }}>
          <NotePreview text={s.description} subtle />
        </div>
      )}
    </div>
  );
}

function Card({ task }: { task: Task }) {
  const { state, dispatch } = useStore();
  const { openTask } = useEditor();
  // Guard the click-to-open against a completed drag (native DnD can still emit
  // a trailing click); matches the Schedule view's Event pattern.
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const now = useNow(30_000);
  const showStatus = state.settings.statusColors;

  const running = state.timer.taskId === task.id && state.timer.runningSince !== undefined;
  const elapsedMin = taskElapsedMin(state, task, now);
  const eta = task.estimateMin && task.status === "in_progress"
    ? now + Math.max(0, task.estimateMin - elapsedMin) * 60_000
    : undefined;

  const done = task.status === "done";
  const skipped = task.status === "skipped";
  const paused = task.status === "paused";
  const [collapsed, toggleCollapse] = useCollapsed(task.id);

  return (
    <BP
      className={`lift${skipped ? " hatch" : ""}${paused ? " card-paused" : ""}`}
      style={{
        background: running ? "var(--accent-soft)" : skipped ? undefined : "var(--color-card)",
        // Modern mock: an active card carries a violet border + soft violet
        // glow, whether or not its timer is running right now. A paused card
        // takes the slate treatment from .card-paused instead.
        borderColor: !paused && (running || task.status === "in_progress") ? "var(--accent-mid)" : undefined,
        boxShadow: !paused && task.status === "in_progress" ? "var(--glow-card)" : undefined,
        padding: "11px 12px", display: "flex", flexDirection: "column", gap: 8,
        opacity: isDragging ? 0.4 : done ? 0.72 : skipped ? 0.75 : 1,
        cursor: "grab",
      }}
      draggable
      onDragStart={(e: React.DragEvent) => {
        dragging.current = true;
        setIsDragging(true);
        e.dataTransfer.setData("text/task-id", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => { dragging.current = false; setIsDragging(false); }}
      onClick={() => { if (!dragging.current) openTask(task.id); }}
      // Touch: long-press then drop on a column (desktop grid) or a column
      // TAB (mobile shows one column at a time, so the tabs are the targets).
      onPointerDown={(e: React.PointerEvent) => beginTouchDrag(e, {
        label: task.title,
        onStart: () => setIsDragging(true),
        onDrop: (x, y) => {
          const col = hitData(x, y, "data-kanban-col");
          if (col) dispatch({ type: "setStatus", id: task.id, status: col.value as TaskStatus });
        },
        onEnd: () => setIsDragging(false),
      })}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <CollapseToggle open={!collapsed} onToggle={toggleCollapse} />
        {showStatus && <StatusCycle task={task} />}
        <span style={{
          flex: 1, fontSize: 14, fontWeight: done ? 400 : 500, lineHeight: 1.25, minWidth: 0,
          ...(done ? { textDecoration: "line-through", textDecorationColor: "var(--color-text-3)" } : {}),
        }}>
          {/* The board has no date axis to notch, so an event leads with its
              emoji and carries an "all day" tag instead of a time. */}
          {isAllDayEvent(task) && <span aria-hidden="true">{task.emoji ?? "📌"} </span>}
          {task.title}
          {isAllDayEvent(task) && (
            <span className="event-pill" style={{ marginLeft: 6 }}>
              all day{repeatLabel(task.repeat) ? ` · ${repeatLabel(task.repeat)}` : ""}
            </span>
          )}
        </span>
        <Prio p={task.priority} />
        <StatusMenu task={task} />
      </div>

      {!collapsed && (<>
      {/* Every started card with any time on the clock shows its elapsed total
          — a PAUSED card too, since pausing freezes the count rather than
          discarding it, and hiding the row there made the time look lost. ETA
          only ticks while actually running; the progress bar needs an estimate
          to be meaningful. */}
      {(task.status === "in_progress" || task.status === "paused") && elapsedMin > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--accent-deep)", fontFamily: "var(--font-mono)" }}>
            <IClock size={12} strokeWidth={1.8} />
            {fmtMin(elapsedMin)} elapsed{running && eta ? ` · ETA ${fmtTime(eta)}` : ""}
          </div>
          {task.estimateMin ? <QuarterBar frac={elapsedMin / task.estimateMin} /> : null}
        </>
      )}

      {/* Schedule facts — every date/estimate the task carries, so a card is
          never information-empty. Start and deadline show while a task is still
          open; a done card shows its completion time instead. Estimate/logged
          time drop out for in-progress cards, where the elapsed row above
          already carries them. */}
      {(task.scheduledAt !== undefined || task.deadline !== undefined || task.estimateMin !== undefined || task.completedAt !== undefined || task.loggedMin > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 11, color: "var(--color-text-2)" }}>
          {!done && task.scheduledAt !== undefined && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <ICalendar size={12} strokeWidth={1.6} />
              {fmtDateTime(task.scheduledAt)}
            </span>
          )}
          {!done && task.deadline !== undefined && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IDeadline size={12} strokeWidth={1.6} />
              {fmtDateTime(task.deadline)}
            </span>
          )}
          {done && task.completedAt !== undefined && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <ICheck size={12} strokeWidth={2.2} />
              {fmtDateTime(task.completedAt)}
            </span>
          )}
          {task.status !== "in_progress" && task.status !== "paused" && task.estimateMin !== undefined && (
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-3)" }}>~{fmtMin(task.estimateMin)}</span>
          )}
          {task.status !== "in_progress" && task.status !== "paused" && task.loggedMin > 0 && (
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-3)" }}>took {fmtMin(task.loggedMin)}</span>
          )}
        </div>
      )}

      {/* Note preview — shown in every state (pending/running/done), so a task's
          note is always reachable from its card, not just when it has a wikilink. */}
      {task.description?.trim() && <NotePreview text={task.description} />}

      {task.tags.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {task.tags.map((tag, i) => (
            <span key={tag} className={`tag ${i === 0 ? "tag-accent" : "tag-neutral"}`}>{tag}</span>
          ))}
        </div>
      )}
      </>)}
    </BP>
  );
}
