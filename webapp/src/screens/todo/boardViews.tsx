import { Fragment, useEffect, useRef, useState } from "react";
import { childTasks, rootTasks, useStore } from "../../lib/store";
import { useMobile } from "../../lib/router";
import { useEditor } from "../../App";
import { STATUS_LABEL, STATUS_VAR, type Priority, type Task, type TaskStatus } from "../../lib/types";
import { boardStatus, nextStatus } from "../../lib/status";
import { BP, Modal, Prio, Seg, StatusSq, Toggle } from "../../components/ui";
import { StatusMenu } from "../../components/StatusMenu";
import { IChevronD, IChevronR, IGear, IGrab, IInfo, IKebab, ILock, IPlus, IUnlock, IX } from "../../components/Icons";
import { addDays, at, fmtDateTime, fmtMin, fmtRange, sameDay, startOfDay } from "../../lib/dates";
import { canDepend, ganttSpan, groupGanttTasks, routineDaysInSpan, taskGanttWindow, type GanttPreset, type GanttWindow } from "../../lib/gantt";
import { occurrenceStatusOf, occurrenceTask } from "../../lib/occurrence";
import { eventsOnDay, isAllDayEvent, repeatLabel } from "../../lib/dayEvents";
import { DayNotch } from "../../components/DayNotch";
import { beginTouchDrag } from "../../lib/touchDrag";
import { DateTimeField } from "../../components/TimeField";

/* ————— Eisenhower: priority → quadrant ————— */

const QUADRANTS: { title: string; p: 0 | 1 | 2 | 3 }[] = [
  { title: "Do first", p: 0 },
  { title: "Schedule", p: 1 },
  { title: "Delegate", p: 2 },
  { title: "Eliminate", p: 3 },
];

export function Eisenhower({ tasks }: { tasks: Task[] }) {
  const mobile = useMobile();
  const { openTask } = useEditor();
  // Routines read as today's occurrence (view copies — never written back),
  // so a routine marked done today drops out until tomorrow.
  const actionable = tasks.map((t) => occurrenceTask(t, Date.now())).filter((t) => t.status !== "done");

  const cell = (q: (typeof QUADRANTS)[number], style: React.CSSProperties) => {
    const items = actionable.filter((t) => t.priority === q.p);
    return (
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 9, overflowY: "auto", minHeight: 0, ...style }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h4 style={{ fontSize: 16 }}>{q.title}</h4>
          <span className={`tag ${q.p === 0 ? "tag-accent" : "tag-neutral"}`}>{items.length}</span>
        </div>
        {items.map((t) => (
          <BP
            key={t.id}
            className={t.status === "skipped" ? "hatch" : ""}
            style={{ background: t.status === "skipped" ? undefined : "var(--color-card)", padding: "9px 11px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", opacity: t.status === "skipped" ? 0.75 : 1 }}
            onClick={() => openTask(t.id)}
          >
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {isAllDayEvent(t) && <span aria-hidden="true">{t.emoji ?? "📌"} </span>}
              {t.title}
            </span>
            <Prio p={t.priority} />
            <StatusMenu task={t} />
          </BP>
        ))}
      </div>
    );
  };

  if (mobile) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "grid", gridTemplateColumns: "1fr", gridAutoRows: "min-content" }}>
        {QUADRANTS.map((q) => cell(q, { borderBottom: "1px solid var(--color-divider)" }))}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "26px 1fr 1fr", gridTemplateRows: "26px 1fr 1fr" }}>
      <div />
      <div className="cap" style={{ display: "grid", placeItems: "center", borderBottom: "1px solid var(--color-divider)" }}>Urgent</div>
      <div className="cap" style={{ display: "grid", placeItems: "center", borderBottom: "1px solid var(--color-divider)" }}>Not urgent</div>
      <div className="cap" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", display: "grid", placeItems: "center", borderRight: "1px solid var(--color-divider)" }}>Important</div>
      {cell(QUADRANTS[0], { borderRight: "1px solid var(--color-divider)", borderBottom: "1px solid var(--color-divider)", background: "color-mix(in srgb, var(--color-accent) 5%, transparent)" })}
      {cell(QUADRANTS[1], { borderBottom: "1px solid var(--color-divider)" })}
      <div className="cap" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", display: "grid", placeItems: "center", borderRight: "1px solid var(--color-divider)" }}>Not important</div>
      {cell(QUADRANTS[2], { borderRight: "1px solid var(--color-divider)" })}
      {cell(QUADRANTS[3], {})}
    </div>
  );
}

/* ————— Gantt: full-span scrollable timeline with Day/Week/Month scale ————— */

type GanttScale = "day" | "week" | "month";
const SCALE_DAY_W: Record<GanttScale, number> = { day: 88, week: 34, month: 12 };
const DAY_MS = 86_400_000;
const GANTT_HEADER_H = 46;
const GANTT_ROW_H = 40;

/* Horizon now-gantt "settings menu" equivalent: which layers/columns render.
   Persisted per device — layer choices are a viewing habit, not document data. */
interface GanttViewOpts { dates: boolean; deps: boolean; hideMilestones: boolean; progress: boolean; weekends: boolean; hideDone: boolean }
const GANTT_VIEW_DEFAULTS: GanttViewOpts = { dates: true, deps: true, hideMilestones: false, progress: true, weekends: true, hideDone: false };
function loadGanttView(): GanttViewOpts {
  try { return { ...GANTT_VIEW_DEFAULTS, ...JSON.parse(localStorage.getItem("lg:ganttView") ?? "{}") }; }
  catch { return GANTT_VIEW_DEFAULTS; }
}

/* A settings-popover row: visible label on the left, switch on the right.
   The shared Toggle renders only the switch, so the gantt menu supplies its
   own label text (the Settings-screen rows pair it the same way). */
function GRow({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <span style={{ fontSize: 12, color: "var(--color-text)" }}>{label}</span>
      <Toggle on={on} onChange={onChange} label={label} />
    </div>
  );
}

export function Gantt({ visibleIds }: { visibleIds?: Set<string> | null } = {}) {
  const { state, dispatch } = useStore();
  const { openTask } = useEditor();
  const mobile = useMobile();
  const [scale, setScale] = useState<GanttScale>("day");
  const [preset, setPreset] = useState<GanttPreset>("timeline");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Drag the date header to pan the chart — grab the timeline and pull it the
  // way you want it to go, rather than aiming at the scrollbar. Wheel, trackpad
  // and keyboard scrolling are untouched; this is an extra way in, not a
  // replacement for the scroll container.
  const panRef = useRef<{ pointerId: number; startX: number; startScroll: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [view, setViewState] = useState<GanttViewOpts>(loadGanttView);
  const setView = (patch: Partial<GanttViewOpts>) =>
    setViewState((v) => { const next = { ...v, ...patch }; localStorage.setItem("lg:ganttView", JSON.stringify(next)); return next; });
  // Auto-collapse: parents start folded so the chart opens as a tidy list of
  // top-level bars; the chevron expands the branch being worked. Parents
  // created after mount stay expanded (not in the set) — that's the branch
  // you're actively building.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
    () => new Set(state.tasks.filter((t) => state.tasks.some((c) => c.parentId === t.id)).map((t) => t.id)),
  );
  const [menu, setMenu] = useState<"settings" | "help" | null>(null);
  const [rowMenu, setRowMenu] = useState<{ task: Task; win: GanttWindow; depth: number; x: number; y: number } | null>(null);
  const [hoverBar, setHoverBar] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dragTip, setDragTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [dragDelta, setDragDelta] = useState<{ id: string; mode: "move" | "start" | "end"; delta: number } | null>(null);
  const [depDrag, setDepDrag] = useState<{ fromId: string; x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [depSel, setDepSel] = useState<{ fromId: string; toId: string; x: number; y: number } | null>(null);

  // Esc dismisses every transient surface (Horizon keyboard guideline).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setMenu(null); setRowMenu(null); setDepSel(null); setHoverBar(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const labelW = mobile ? 120 : view.dates ? 304 : 220;
  const dayW = SCALE_DAY_W[scale];

  interface Row { task: Task; depth: number; win: GanttWindow; kids?: number }
  interface Group { key: string; label: string; color?: string; rows: Row[] }

  // "All tasks" keeps the parent/child tree; the grouped presets flatten it —
  // a child can sit in a different group than its parent. Group color encodes
  // the grouping dimension only where the app already has a color language
  // for it (status squares, priority pills); tag groups stay accent — tags
  // are unbounded, so cycling hues over them would be noise, and the header
  // labels already carry identity.
  // Layer filters from the settings menu: hide finished work, hide
  // deadline-only milestone rows.
  // An all-day event has no duration to draw, so it never becomes a bar: it
  // shows as the day's notch plus a rule down the body instead. Filtering here
  // covers both presets, since every row in either goes through this gate.
  const rowVisible = (t: Task, win: GanttWindow) =>
    !isAllDayEvent(t) &&
    (!visibleIds || visibleIds.has(t.id)) && // the board search filter, when active
    (!view.hideDone || (t.status !== "done" && t.status !== "skipped")) && (!view.hideMilestones || !win.milestone);

  let groups: Group[];
  if (preset === "timeline") {
    const rows: Row[] = [];
    for (const t of rootTasks(state)) {
      const rootWin = taskGanttWindow(t);
      const kids = childTasks(state, t.id).filter((s) => {
        const w = taskGanttWindow(s);
        return w !== null && rowVisible(s, w);
      });
      if (rootWin && rowVisible(t, rootWin)) rows.push({ task: t, depth: 0, win: rootWin, kids: kids.length });
      if (collapsedIds.has(t.id)) continue;
      for (const s of kids) rows.push({ task: s, depth: 1, win: taskGanttWindow(s)! });
    }
    groups = [{ key: "all", label: "", rows }];
  } else {
    const groupColor = (key: string) =>
      preset === "status" ? STATUS_VAR[key as TaskStatus]
      : preset === "priority" ? (key === "p0" ? "var(--prio0-fg)" : key === "p1" ? "var(--prio1-fg)" : "var(--prio-fg)")
      : undefined;
    groups = groupGanttTasks(state.tasks.filter((t) => {
      const w = taskGanttWindow(t);
      return w !== null && rowVisible(t, w);
    }), preset).map((g) => ({
      key: g.key,
      label: g.label,
      color: groupColor(g.key),
      rows: g.tasks
        .map((task) => ({ task, depth: 0, win: taskGanttWindow(task)! }))
        .sort((a, b) => a.win.start - b.win.start),
    }));
  }
  const rows = groups.flatMap((g) => g.rows);

  const now = Date.now();
  const { start: spanStart, days: totalDays } = ganttSpan(rows.map((r) => r.win), now);
  const x = (t: number) => ((t - spanStart) / DAY_MS) * dayW;

  const spanEndMs = addDays(spanStart, totalDays);

  const shortDate = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  /** "Jul 19 – 21" / "Jul 29 – Aug 2" / "Sep 4" — compact, no year. */
  const shortRange = (a: number, b: number) => {
    if (sameDay(a, b)) return shortDate(a);
    const d1 = new Date(a);
    const d2 = new Date(b);
    return d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear()
      ? `${shortDate(a)} – ${d2.getDate()}`
      : `${shortDate(a)} – ${shortDate(b)}`;
  };

  // Two-tier header: coarse bands on top (weeks / months / years by scale),
  // fine ticks underneath (day numbers / week starts / month names). Today's
  // day number wears the accent pill at day scale; weekends get shaded
  // columns except at month scale, where they'd be sub-pixel noise.
  interface Band { t: number; endMs: number; label: string; sub?: string }
  const bands: Band[] = [];
  // All-day events only get a per-day notch at day scale — at week/month
  // scale a single column covers 7-31 days, so a day-precise marker would
  // point at nothing in particular.
  const ticks: { t: number; label: string; weekend?: boolean; today?: boolean; major?: boolean }[] = [];
  const weekendDays: number[] = [];
  {
    const bandBounds: { t: number; label: string; sub?: string }[] = [];
    for (let i = 0, d = spanStart; i < totalDays; i++, d = addDays(d, 1)) {
      const date = new Date(d);
      const isWeekStart = date.getDay() === state.settings.weekStart;
      const isMonthStart = date.getDate() === 1;
      if (scale !== "month" && (date.getDay() === 0 || date.getDay() === 6)) weekendDays.push(d);
      if (scale === "day") {
        ticks.push({ t: d, label: String(date.getDate()), weekend: date.getDay() === 0 || date.getDay() === 6, today: sameDay(d, now), major: isMonthStart });
        if (isWeekStart || i === 0) bandBounds.push({ t: d, label: "" });
      } else if (scale === "week") {
        if (isWeekStart) ticks.push({ t: d, label: String(date.getDate()), today: now >= d && now < addDays(d, 7), major: date.getDate() <= 7 });
        if (isMonthStart || i === 0) bandBounds.push({ t: d, label: date.toLocaleDateString("en-US", { month: "long" }), sub: String(date.getFullYear()) });
      } else {
        if (isMonthStart) ticks.push({ t: d, label: date.toLocaleDateString("en-US", { month: "short" }), major: date.getMonth() === 0 });
        if ((isMonthStart && date.getMonth() === 0) || i === 0) bandBounds.push({ t: d, label: String(date.getFullYear()) });
      }
    }
    for (let i = 0; i < bandBounds.length; i++) {
      const bandStart = bandBounds[i].t;
      const bandEnd = i + 1 < bandBounds.length ? bandBounds[i + 1].t : spanEndMs;
      bands.push({
        t: bandStart,
        endMs: bandEnd,
        label: scale === "day" ? shortRange(bandStart, addDays(bandEnd, -1)) : bandBounds[i].label,
        sub: bandBounds[i].sub,
      });
    }
  }

  const eventDays =
    scale === "day"
      ? ticks
          .map((tk) => ({ day: tk.t, events: eventsOnDay(state.tasks, tk.t) }))
          .filter((d) => d.events.length > 0)
      : [];

  // Parent→child elbow connectors, timeline preset only — its rows ARE the
  // tree, at a fixed row pitch with no group header rows shifting the y math.
  const connectors: { x1: number; y1: number; x2: number; y2: number }[] = [];
  if (preset === "timeline") {
    let parentIdx = -1;
    rows.forEach((r, i) => {
      if (r.depth === 0) {
        parentIdx = i;
        return;
      }
      if (parentIdx < 0) return;
      const x1 = x(rows[parentIdx].win.start) + 7;
      const x2 = x(r.win.start) - (r.win.milestone ? 12 : 4);
      // Forward elbows only — a child starting before its parent would need
      // a leftward line that runs across its own bar label.
      if (x2 < x1 + 6) return;
      connectors.push({ x1, y1: parentIdx * GANTT_ROW_H + 29, x2, y2: i * GANTT_ROW_H + GANTT_ROW_H / 2 });
    });
  }

  // Dependency lines ("order of operations" links) — timeline preset only,
  // where the flat row list keeps y-positions at a fixed pitch. Grouped
  // presets reorder rows per lens, so cross-group lines would mislead.
  const rowIndex = new Map(rows.map((r, i) => [r.task.id, i]));
  interface DepLine { from: string; to: string; x1: number; y1: number; x2: number; y2: number }
  const depLines: DepLine[] = [];
  if (preset === "timeline" && view.deps) {
    for (const r of rows) {
      for (const depId of r.task.dependsOn ?? []) {
        const fi = rowIndex.get(depId);
        if (fi === undefined) continue;
        const from = rows[fi];
        depLines.push({
          from: depId,
          to: r.task.id,
          x1: x(from.win.end) + (from.win.milestone ? 9 : 2),
          y1: fi * GANTT_ROW_H + GANTT_ROW_H / 2,
          x2: x(r.win.start) - (r.win.milestone ? 11 : 3),
          y2: rowIndex.get(r.task.id)! * GANTT_ROW_H + GANTT_ROW_H / 2,
        });
      }
    }
  }
  /** Forward links get an S-elbow; backward links route around via a Z. */
  const depPath = (d: DepLine) => {
    const stub = 10;
    if (d.x2 >= d.x1 + stub * 2) {
      const mx = d.x1 + stub;
      return `M ${d.x1} ${d.y1} L ${mx} ${d.y1} L ${mx} ${d.y2} L ${d.x2} ${d.y2}`;
    }
    const mid = d.y1 <= d.y2 ? d.y1 + GANTT_ROW_H / 2 : d.y1 - GANTT_ROW_H / 2;
    return `M ${d.x1} ${d.y1} L ${d.x1 + stub} ${d.y1} L ${d.x1 + stub} ${mid} L ${d.x2 - stub} ${mid} L ${d.x2 - stub} ${d.y2} L ${d.x2} ${d.y2}`;
  };

  /* — bar drag: move keeps duration, edge drags resize; day-snapped with a
       live date chip. Locked tasks and mobile (where the pointer must keep
       scrolling the sheet) don't drag. — */
  const barDrag = useRef<{ task: Task; win: GanttWindow; mode: "move" | "start" | "end"; originX: number; delta: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const liveWin = (win: GanttWindow, mode: "move" | "start" | "end", delta: number): GanttWindow => {
    const ms = delta * DAY_MS;
    if (mode === "move") return { ...win, start: win.start + ms, end: win.end + ms };
    if (mode === "end") return { ...win, end: Math.max(win.start + 30 * 60_000, win.end + ms) };
    return { ...win, start: Math.min(win.start + ms, win.end - 30 * 60_000) };
  };

  function beginBarDrag(e: React.PointerEvent, task: Task, win: GanttWindow, mode: "move" | "start" | "end") {
    // Touch drags go through the long-press path below (immediate capture
    // would fight scrolling); routines have no single bar to move.
    if (mobile || task.locked || task.repeat || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    barDrag.current = { task, win, mode, originX: e.clientX, delta: 0, moved: false };
    setHoverBar(null);
  }
  function moveBarDrag(e: React.PointerEvent) {
    const d = barDrag.current;
    if (!d) return;
    const delta = Math.round((e.clientX - d.originX) / dayW);
    if (delta !== 0) d.moved = true;
    d.delta = delta;
    setDragDelta({ id: d.task.id, mode: d.mode, delta });
    const w = liveWin(d.win, d.mode, delta);
    setDragTip({ x: e.clientX, y: e.clientY, text: shortRange(w.start, w.end) });
  }
  function endBarDrag() {
    const d = barDrag.current;
    barDrag.current = null;
    setDragDelta(null);
    setDragTip(null);
    if (!d) return;
    if (d.moved) suppressClick.current = true;
    if (d.delta === 0) return;
    const ms = d.delta * DAY_MS;
    const t = d.task;
    if (d.mode === "move") {
      // Milestones are deadline-only points; bars ride the schedule (whole
      // tree shifts with them, per scheduleTask semantics).
      if (d.win.milestone) dispatch({ type: "upsertTask", task: { ...t, deadline: t.deadline! + ms } });
      else dispatch({ type: "scheduleTask", id: t.id, at: t.scheduledAt! + ms });
    } else if (d.mode === "end") {
      const estimateEnd = t.scheduledAt! + Math.max(30, t.estimateMin ?? 60) * 60_000;
      if (t.deadline !== undefined && t.deadline >= estimateEnd) {
        dispatch({ type: "upsertTask", task: { ...t, deadline: Math.max(t.scheduledAt! + 30 * 60_000, t.deadline + ms) } });
      } else {
        dispatch({ type: "upsertTask", task: { ...t, estimateMin: Math.max(30, (t.estimateMin ?? 60) + d.delta * 1440) } });
      }
    } else {
      const newStart = Math.min(t.scheduledAt! + ms, d.win.end - 30 * 60_000);
      const endPinnedByDeadline = t.deadline !== undefined && d.win.end === t.deadline;
      dispatch({
        type: "upsertTask",
        task: endPinnedByDeadline
          ? { ...t, scheduledAt: newStart }
          : { ...t, scheduledAt: newStart, estimateMin: Math.max(30, Math.round((d.win.end - newStart) / 60_000)) },
      });
    }
  }

  /** Mobile: long-press a bar to move it — the shared touch-drag helper arms
      after a hold (so the sheet still scrolls), then feeds the same
      day-snapped pipeline as the desktop pointer drag. Resize handles don't
      render on mobile, so touch is move-only. */
  function touchBarProps(task: Task, win: GanttWindow) {
    if (!mobile || task.locked || task.repeat) return {};
    return {
      onPointerDown: (e: React.PointerEvent) => beginTouchDrag(e, {
        label: task.title,
        onStart: (startX) => { barDrag.current = { task, win, mode: "move", originX: startX, delta: 0, moved: false }; setHoverBar(null); },
        onMove: (mx, my) => {
          const d = barDrag.current;
          if (!d) return;
          const delta = Math.round((mx - d.originX) / dayW);
          if (delta !== 0) d.moved = true;
          d.delta = delta;
          setDragDelta({ id: d.task.id, mode: d.mode, delta });
          const w = liveWin(d.win, d.mode, delta);
          setDragTip({ x: mx, y: my, text: shortRange(w.start, w.end) });
        },
        onDrop: () => endBarDrag(),
        onEnd: () => { if (barDrag.current) { barDrag.current = null; setDragDelta(null); setDragTip(null); } },
      }),
    };
  }

  /* — dependency creation: drag an end dot onto another row (Horizon's
       dot-to-dot gesture); canDepend rejects self/dup/cycle links. — */
  function beginDepDrag(e: React.PointerEvent, fromId: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDepDrag({ fromId, x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
  }
  function moveDepDrag(e: React.PointerEvent) {
    setDepDrag((d) => (d ? { ...d, x2: e.clientX, y2: e.clientY } : d));
  }
  function endDepDrag(e: React.PointerEvent) {
    const fromId = depDrag?.fromId;
    setDepDrag(null);
    if (!fromId) return;
    const toId = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-gv-task]")?.getAttribute("data-gv-task");
    if (!toId || !canDepend(state.tasks, fromId, toId)) return;
    const target = state.tasks.find((t) => t.id === toId)!;
    dispatch({ type: "upsertTask", task: { ...target, dependsOn: [...(target.dependsOn ?? []), fromId] } });
  }

  function duplicateTask(t: Task) {
    dispatch({
      type: "upsertTask",
      task: {
        ...t,
        id: `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        title: `${t.title} (copy)`,
        createdAt: Date.now(),
        loggedMin: 0,
        completedAt: undefined,
        status: "pending",
        dependsOn: undefined,
      },
    });
  }

  const scrollToNow = () => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, x(now) - (el.clientWidth - labelW) / 3);
  };
  useEffect(scrollToNow, [scale]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 22px", borderBottom: "1px solid var(--color-divider)", flexWrap: "wrap" }}>
        <select
          className="input"
          style={{ height: 30, fontSize: 13, width: "auto", minHeight: 0, padding: "2px 8px" }}
          value={preset}
          onChange={(e) => setPreset(e.target.value as GanttPreset)}
          aria-label="Gantt view"
        >
          <option value="timeline">All tasks</option>
          <option value="status">Group: Status</option>
          <option value="priority">Group: Priority</option>
          <option value="tag">Group: Tag</option>
        </select>
        <Seg
          small
          ink
          ariaLabel="Timeline scale"
          items={[{ id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "month", label: "Month" }]}
          active={scale}
          onSelect={(id) => setScale(id as GanttScale)}
        />
        <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={scrollToNow}>Today</button>
        <button
          className="btn btn-secondary"
          style={{ padding: "4px 10px", fontSize: 12 }}
          onClick={() => openTask(null, { scheduledAt: at(startOfDay(Date.now()), 9) })}
        >
          <IPlus size={13} strokeWidth={1.8} /> Task
        </button>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>
            {fmtRange(spanStart, addDays(spanStart, totalDays - 1))}
          </span>
          <span style={{ position: "relative", display: "inline-flex" }}>
            <button
              className="btn btn-icon btn-secondary"
              style={{ width: 28, height: 28 }}
              aria-label="Timeline settings"
              aria-expanded={menu === "settings"}
              onClick={() => setMenu(menu === "settings" ? null : "settings")}
            >
              <IGear size={14} strokeWidth={1.6} />
            </button>
            {menu === "settings" && (
              <div className="gv-pop" style={{ position: "absolute", right: 0, top: "100%", marginTop: 6, width: 224, display: "flex", flexDirection: "column", gap: 9 }}>
                <span className="cap" style={{ fontSize: 10.5 }}>Show</span>
                <GRow on={view.dates} onChange={(v) => setView({ dates: v })} label="Dates column" />
                {preset === "timeline" && <GRow on={view.deps} onChange={(v) => setView({ deps: v })} label="Dependency lines" />}
                <GRow on={view.progress} onChange={(v) => setView({ progress: v })} label="Progress fill" />
                <GRow on={view.weekends} onChange={(v) => setView({ weekends: v })} label="Weekend shading" />
                <span className="cap" style={{ fontSize: 10.5, marginTop: 2 }}>Filter</span>
                <GRow on={view.hideDone} onChange={(v) => setView({ hideDone: v })} label="Hide done & skipped" />
                <GRow on={view.hideMilestones} onChange={(v) => setView({ hideMilestones: v })} label="Hide milestones" />
              </div>
            )}
          </span>
          <span style={{ position: "relative", display: "inline-flex" }}>
            <button
              className="btn btn-icon btn-secondary"
              style={{ width: 28, height: 28 }}
              aria-label="Legend and shortcuts"
              aria-expanded={menu === "help"}
              onClick={() => setMenu(menu === "help" ? null : "help")}
            >
              <IInfo size={14} strokeWidth={1.6} />
            </button>
            {menu === "help" && (
              <div className="gv-pop" style={{ position: "absolute", right: 0, top: "100%", marginTop: 6, width: 252, display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="cap" style={{ fontSize: 10.5 }}>Legend</span>
                <span className="gv-legend"><i style={{ width: 22, height: 10, borderRadius: 5, background: "var(--color-accent)" }} /> Task bar (darker fill = progress)</span>
                <span className="gv-legend"><i style={{ width: 22, height: 10, borderRadius: 5, background: "var(--accent-soft)", border: "1px solid var(--accent-mid)" }} /> Subtask bar</span>
                <span className="gv-legend"><i style={{ width: 9, height: 9, border: "2px solid var(--color-accent)", transform: "rotate(45deg)" }} /> Milestone (deadline only)</span>
                <span className="gv-legend"><i style={{ width: 22, height: 0, borderTop: "1.5px solid var(--color-accent)" }} /> Dependency link</span>
                <span className="gv-legend"><i style={{ width: 22, height: 0, borderTop: "1px solid var(--color-text-3)" }} /> Parent → subtask</span>
                <span className="gv-legend"><i className="gv-crit" style={{ width: "auto" }}>P0</i> Critical priority</span>
                <span className="gv-legend"><ILock size={11} /> Scheduling locked</span>
                <span className="cap" style={{ fontSize: 10.5, marginTop: 4 }}>Interactions</span>
                <span className="gv-hint">Drag the date header to move through time</span>
                <span className="gv-hint">Drag a bar to move it (whole day steps)</span>
                <span className="gv-hint">Drag a bar's edge to change its length</span>
                <span className="gv-hint">Drag an end dot onto another row to link them</span>
                <span className="gv-hint">Click a link line to remove it</span>
                <span className="gv-hint">Tab + Enter opens a task · Esc closes menus</span>
              </div>
            )}
          </span>
        </span>
      </div>

      {rows.length === 0 ? (
        <p style={{ padding: "28px 22px", fontSize: 13, color: "var(--color-text-2)" }}>
          Nothing on the timeline — give tasks a schedule or a deadline to see them here.
        </p>
      ) : (
        <div ref={scrollRef} className="gv-scroll">
          <div style={{ width: labelW + totalDays * dayW, position: "relative" }}>
            <div className="gv-head">
              <div className="gv-corner" style={{ width: labelW }}>
                <span className="cap" style={{ flex: 1 }}>Task</span>
                {!mobile && view.dates && <span className="cap" style={{ width: 84, textAlign: "right" }}>Dates</span>}
              </div>
              <div
                className={panning ? "gv-headtrack panning" : "gv-headtrack"}
                title="Drag to move through time"
                onPointerDown={(e) => {
                  const el = scrollRef.current;
                  if (!el || e.button !== 0) return;
                  panRef.current = { pointerId: e.pointerId, startX: e.clientX, startScroll: el.scrollLeft };
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setPanning(true);
                }}
                onPointerMove={(e) => {
                  const pan = panRef.current;
                  const el = scrollRef.current;
                  if (!pan || !el || e.pointerId !== pan.pointerId) return;
                  // Pull the timeline right and earlier dates come into view —
                  // the sheet of paper moves with the finger, so the scroll
                  // offset goes the other way.
                  el.scrollLeft = pan.startScroll - (e.clientX - pan.startX);
                }}
                onPointerUp={(e) => {
                  if (panRef.current?.pointerId !== e.pointerId) return;
                  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                  panRef.current = null;
                  setPanning(false);
                }}
                onPointerCancel={() => { panRef.current = null; setPanning(false); }}
              >
                {bands.map((b) => (
                  <div key={b.t} className="gv-band" style={{ left: x(b.t), width: x(b.endMs) - x(b.t) }}>
                    <b>{b.label}</b>
                    {b.sub && <span>{b.sub}</span>}
                  </div>
                ))}
                {ticks.map((tk) => (
                  <span
                    key={tk.t}
                    className={`gv-tick${tk.weekend ? " wknd" : ""}${tk.today ? " today" : ""}`}
                    style={{ left: x(tk.t) + (scale === "day" ? dayW / 2 : 14) }}
                  >
                    {tk.label}
                  </span>
                ))}
              </div>
            </div>
            {/* Weekend shading, gridlines and the pill-fed today rule sit
                under the rows; bars paint on top, sticky cells cover them
                while scrolling. */}
            <div style={{ position: "absolute", top: GANTT_HEADER_H, bottom: 0, left: labelW, right: 0, overflow: "hidden", pointerEvents: "none" }}>
              {view.weekends && weekendDays.map((d) => (
                <div key={d} className="gv-wknd" style={{ left: x(d), width: dayW }} />
              ))}
              {ticks.map((tk) => (
                <div key={tk.t} className={tk.major ? "gv-grid major" : "gv-grid"} style={{ left: x(tk.t) }} />
              ))}
              {/* An event's day runs a faint rule down the whole track body, so
                  you can see at a glance which bars pass THROUGH the birthday
                  or the holiday — the reason to look at a Gantt at all. */}
              {eventDays.map((d) => (
                <div key={`evl-${d.day}`} className="gv-event-line" style={{ left: x(d.day) + dayW / 2 }} />
              ))}
              <div className="gv-today" style={{ left: x(now) }} />
            </div>
            {/* The notches themselves need pointer events, so they sit in their
                own layer just under the date header rather than in the
                decorations layer above. */}
            {eventDays.length > 0 && (
              <div style={{ position: "absolute", top: GANTT_HEADER_H + 2, left: labelW, right: 0, height: 18, zIndex: 3 }}>
                {eventDays.map((d) => (
                  <span key={`evn-${d.day}`} style={{ position: "absolute", left: x(d.day) + dayW / 2, transform: "translateX(-50%)" }}>
                    <DayNotch events={d.events} max={2} />
                  </span>
                ))}
              </div>
            )}
            {connectors.length > 0 && (
              <svg
                className="gv-connectors"
                style={{ left: labelW, top: GANTT_HEADER_H }}
                width={totalDays * dayW}
                height={rows.length * GANTT_ROW_H}
                aria-hidden="true"
              >
                {connectors.map((c, i) => (
                  <g key={i} stroke="var(--color-text-3)" fill="none" strokeWidth={1}>
                    <path d={`M ${c.x1} ${c.y1} L ${c.x1} ${c.y2} L ${c.x2} ${c.y2}`} strokeLinejoin="round" />
                    <path d={`M ${c.x2 - 4} ${c.y2 - 3} L ${c.x2} ${c.y2} L ${c.x2 - 4} ${c.y2 + 3}`} />
                  </g>
                ))}
              </svg>
            )}
            {depLines.length > 0 && (
              <svg
                className="gv-deps"
                style={{ left: labelW, top: GANTT_HEADER_H }}
                width={totalDays * dayW}
                height={rows.length * GANTT_ROW_H}
              >
                {depLines.map((d) => (
                  <g key={`${d.from}-${d.to}`} fill="none">
                    <path d={depPath(d)} stroke="var(--color-accent)" strokeWidth={1.4} strokeLinejoin="round" opacity={0.85} />
                    <path d={`M ${d.x2 - 5} ${d.y2 - 3.5} L ${d.x2} ${d.y2} L ${d.x2 - 5} ${d.y2 + 3.5}`} stroke="var(--color-accent)" strokeWidth={1.4} />
                    <path
                      className="hit"
                      d={depPath(d)}
                      stroke="transparent"
                      strokeWidth={10}
                      onClick={(e) => setDepSel({ fromId: d.from, toId: d.to, x: e.clientX, y: e.clientY })}
                    >
                      <title>Click to remove this link</title>
                    </path>
                  </g>
                ))}
              </svg>
            )}
            {groups.map((g) => (
              <Fragment key={g.key}>
                {g.label !== "" && (() => {
                  const groupStart = Math.min(...g.rows.map((r) => r.win.start));
                  const groupEnd = Math.max(...g.rows.map((r) => r.win.end));
                  const c = g.color ?? "var(--color-accent)";
                  const durationDays = Math.max(1, Math.round((groupEnd - groupStart) / DAY_MS));
                  return (
                    <div className="gv-grow">
                      <div className="gv-cell" style={{ width: labelW }}>
                        <span className="gv-gdot" aria-hidden="true" style={{ background: c }} />
                        <span className="gv-gname" style={{ flex: 1 }}>{g.label}</span>
                        <span className="gv-gcount">{g.rows.length}</span>
                      </div>
                      <div className="gv-track">
                        <span className="gv-glabel" style={{ left: x(groupStart) + 2 }}>
                          <b>{g.label}</b> · {shortRange(groupStart, groupEnd)} · {durationDays}d
                        </span>
                        <div className="gv-gline" style={{ left: x(groupStart), width: Math.max(6, x(groupEnd) - x(groupStart)), background: c, opacity: 0.5 }} />
                      </div>
                    </div>
                  );
                })()}
                {g.rows.map(({ task, depth, win, kids }) => {
                  const barColor = g.color ?? "var(--color-accent)";
                  const softBar = !g.color && depth > 0;
                  const progress = view.progress && !win.milestone && task.estimateMin && task.loggedMin
                    ? Math.min(100, (task.loggedMin / task.estimateMin) * 100)
                    : 0;
                  // Live geometry: while this row's bar is mid-drag, render it
                  // at the day-snapped drag position instead of the saved one.
                  let barLeft = x(win.start);
                  let barW = Math.max(12, x(win.end) - x(win.start));
                  if (dragDelta && dragDelta.id === task.id) {
                    const px = dragDelta.delta * dayW;
                    if (dragDelta.mode === "move") barLeft += px;
                    else if (dragDelta.mode === "end") barW = Math.max(12, barW + px);
                    else { const nl = Math.min(barLeft + px, barLeft + barW - 12); barW = Math.max(12, barW - (nl - barLeft)); barLeft = nl; }
                  }
                  const draggable = !mobile && !task.locked && !task.repeat;
                  const openIfNotDragged = () => {
                    if (suppressClick.current) { suppressClick.current = false; return; }
                    openTask(task.id);
                  };
                  const collapsible = preset === "timeline" && depth === 0 && (kids ?? 0) > 0;
                  return (
                    <div key={task.id} className="gv-row" data-gv-task={task.id}>
                      <div className="gv-cell" style={{ width: labelW }}>
                        {collapsible ? (
                          <button
                            className="gv-chev"
                            aria-expanded={!collapsedIds.has(task.id)}
                            aria-label={`${kids} subtasks`}
                            onClick={() => setCollapsedIds((s) => { const n = new Set(s); n.has(task.id) ? n.delete(task.id) : n.add(task.id); return n; })}
                          >
                            {collapsedIds.has(task.id) ? <IChevronR size={12} strokeWidth={2} /> : <IChevronD size={12} strokeWidth={2} />}
                          </button>
                        ) : depth > 0 ? (
                          <span aria-hidden="true" style={{ color: "var(--color-text-3)", fontSize: 11, flexShrink: 0 }}>└</span>
                        ) : null}
                        <span className={depth ? "gv-title sub" : "gv-title"} style={{ fontWeight: depth ? 400 : 500 }}>{task.title}</span>
                        {task.priority === 0 && <span className="gv-crit" title="Critical — P0 priority">P0</span>}
                        {task.locked && <ILock size={11} style={{ color: "var(--color-text-3)", flexShrink: 0 }} aria-label="Scheduling locked" />}
                        <button
                          className="gv-kebab"
                          aria-label={`Actions for ${task.title}`}
                          aria-haspopup="menu"
                          onClick={(e) => {
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setRowMenu({ task, win, depth, x: r.right, y: r.bottom + 4 });
                          }}
                        >
                          <IKebab size={13} />
                        </button>
                        {!mobile && view.dates && <span className="gv-dates">{shortRange(win.start, win.end)}</span>}
                      </div>
                      <div className="gv-track">
                        {win.milestone ? (
                          <>
                            <button
                              className="gv-ms"
                              data-gv-task={task.id}
                              aria-label={`Edit ${task.title}`}
                              style={{ left: barLeft - 6.5, border: `2px solid ${barColor}`, cursor: draggable ? "grab" : "pointer" }}
                              onClick={openIfNotDragged}
                              onPointerDown={(e) => beginBarDrag(e, task, win, "move")}
                              onPointerMove={moveBarDrag}
                              onPointerUp={endBarDrag}
                              onMouseEnter={(e) => { if (!barDrag.current && !depDrag) { const r = e.currentTarget.getBoundingClientRect(); setHoverBar({ id: task.id, x: r.left, y: r.bottom }); } }}
                              onMouseLeave={() => setHoverBar(null)}
                              {...touchBarProps(task, win)}
                            />
                            <span className="gv-barlabel" style={{ left: barLeft + 14 }}>{task.title}</span>
                          </>
                        ) : task.repeat && task.scheduledAt !== undefined ? (
                          /* Routine: one per-day pill per occurrence, each
                             tinted by THAT day's status (template status never
                             moves for routines) — a single bar would repaint
                             the whole series with one day's mark. Clicking a
                             pill cycles that day; unmarked days sit faint. */
                          <>
                            {routineDaysInSpan(task.scheduledAt, task.repeat, spanStart, spanEndMs).map((d) => {
                              const st = occurrenceStatusOf(task, d);
                              const pillW = Math.max(8, Math.min(dayW - 4, 18));
                              return (
                                <button
                                  key={d}
                                  aria-label={`${task.title} ${shortDate(d)}: ${STATUS_LABEL[st]} — click to cycle`}
                                  title={`${shortDate(d)} · ${STATUS_LABEL[st]} — click to cycle`}
                                  onClick={() => dispatch({
                                    type: "setStatus",
                                    id: task.id,
                                    status: nextStatus(st),
                                    occurrenceDay: d,
                                  })}
                                  style={{
                                    position: "absolute", left: x(d) + (dayW - pillW) / 2, width: pillW,
                                    top: "50%", transform: "translateY(-50%)", height: 14,
                                    borderRadius: 4, border: "none", padding: 0, cursor: "pointer",
                                    background: STATUS_VAR[st], opacity: st === "pending" ? 0.45 : 1,
                                  }}
                                />
                              );
                            })}
                            <span className="gv-barlabel" style={{ left: barLeft + barW + 8 }}>↻ {task.title}</span>
                          </>
                        ) : (
                          <>
                            <button
                              className="gv-bar"
                              data-gv-task={task.id}
                              aria-label={`Edit ${task.title}`}
                              style={softBar
                                ? { left: barLeft, width: barW, background: "var(--accent-soft)", border: "1px solid var(--accent-mid)", cursor: draggable ? "grab" : "pointer" }
                                : { left: barLeft, width: barW, background: barColor, cursor: draggable ? "grab" : "pointer" }}
                              onClick={openIfNotDragged}
                              onPointerDown={(e) => beginBarDrag(e, task, win, "move")}
                              onPointerMove={moveBarDrag}
                              onPointerUp={endBarDrag}
                              onMouseEnter={(e) => { if (!barDrag.current && !depDrag) { const r = e.currentTarget.getBoundingClientRect(); setHoverBar({ id: task.id, x: r.left, y: r.bottom }); } }}
                              onMouseLeave={() => setHoverBar(null)}
                              {...touchBarProps(task, win)}
                            >
                              {progress > 0 && <span className="gv-progress" style={{ width: `${progress}%` }} />}
                              {draggable && !win.milestone && (
                                <>
                                  <span className="gv-handle" style={{ left: 0 }} onPointerDown={(e) => beginBarDrag(e, task, win, "start")} onPointerMove={moveBarDrag} onPointerUp={endBarDrag} />
                                  <span className="gv-handle" style={{ right: 0 }} onPointerDown={(e) => beginBarDrag(e, task, win, "end")} onPointerMove={moveBarDrag} onPointerUp={endBarDrag} />
                                </>
                              )}
                            </button>
                            <span className="gv-barlabel" style={{ left: barLeft + barW + 8 }}>{task.title}</span>
                          </>
                        )}
                        {!mobile && preset === "timeline" && view.deps && (
                          <>
                            <span
                              className="gv-dot"
                              style={{ left: barLeft - (win.milestone ? 16 : 13) }}
                              title="Drag onto another row to link"
                              onPointerDown={(e) => beginDepDrag(e, task.id)}
                              onPointerMove={moveDepDrag}
                              onPointerUp={endDepDrag}
                            />
                            <span
                              className="gv-dot"
                              style={{ left: barLeft + (win.milestone ? 8 : barW) + 5 }}
                              title="Drag onto another row to link"
                              onPointerDown={(e) => beginDepDrag(e, task.id)}
                              onPointerMove={moveDepDrag}
                              onPointerUp={endDepDrag}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {/* — floating layers: hover card, live drag chip, link-drag line,
           row menu, link-removal popover. All fixed-position so the
           scrolling sheet never clips them. — */}
      {hoverBar && !dragTip && (() => {
        const r = rows.find((row) => row.task.id === hoverBar.id);
        if (!r) return null;
        const t = r.task;
        const parent = t.parentId ? state.tasks.find((p) => p.id === t.parentId) : undefined;
        const days = Math.max(1, Math.round((r.win.end - r.win.start) / DAY_MS));
        return (
          <div className="gv-pop" style={{ left: Math.min(hoverBar.x, window.innerWidth - 292), top: hoverBar.y + 8, pointerEvents: "none" }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{t.title}</div>
            {parent && <div style={{ color: "var(--color-text-3)", fontSize: 11 }}>{parent.title} ›</div>}
            <div style={{ marginTop: 4, color: "var(--color-text-2)" }}>
              {r.win.milestone ? `Deadline ${fmtDateTime(r.win.start)}` : `${shortRange(r.win.start, r.win.end)} · ${days}d`}
            </div>
            {t.estimateMin ? (
              <div style={{ color: "var(--color-text-2)" }}>
                {t.loggedMin ? `${fmtMin(t.loggedMin)} of ~${fmtMin(t.estimateMin)} logged` : `~${fmtMin(t.estimateMin)} estimated`}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: t.tags.length || t.priority === 0 || t.locked ? 6 : 0 }}>
              {t.priority === 0 && <span className="gv-crit">P0</span>}
              {t.locked && <span className="tag tag-neutral" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><ILock size={10} /> locked</span>}
              {t.tags.map((tag) => <span key={tag} className="tag tag-neutral">{tag}</span>)}
            </div>
          </div>
        );
      })()}
      {dragTip && (
        <span className="gv-dragtip" style={{ left: dragTip.x + 14, top: dragTip.y - 30 }}>{dragTip.text}</span>
      )}
      {depDrag && (
        <svg className="gv-templine" width={window.innerWidth} height={window.innerHeight} aria-hidden="true">
          <line x1={depDrag.x1} y1={depDrag.y1} x2={depDrag.x2} y2={depDrag.y2} stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="5 4" />
          <circle cx={depDrag.x2} cy={depDrag.y2} r={3.5} fill="var(--color-accent)" />
        </svg>
      )}
      {(rowMenu || depSel) && (
        <div style={{ position: "fixed", inset: 0, zIndex: 45 }} onClick={() => { setRowMenu(null); setDepSel(null); }} />
      )}
      {menu && (
        <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setMenu(null)} />
      )}
      {rowMenu && (
        <div className="gv-menu" role="menu" style={{ left: Math.min(rowMenu.x - 168, window.innerWidth - 180), top: Math.min(rowMenu.y, window.innerHeight - 220) }}>
          <button role="menuitem" onClick={() => { openTask(rowMenu.task.id); setRowMenu(null); }}>Edit</button>
          <button role="menuitem" onClick={() => { openTask(null, { scheduledAt: rowMenu.win.start }); setRowMenu(null); }}>New task, same day</button>
          {rowMenu.depth === 0 && (
            <button role="menuitem" onClick={() => { openTask(null, { parentId: rowMenu.task.id, scheduledAt: rowMenu.win.start }); setRowMenu(null); }}>New subtask</button>
          )}
          <button role="menuitem" onClick={() => { duplicateTask(rowMenu.task); setRowMenu(null); }}>Duplicate</button>
          <button
            role="menuitem"
            title={rowMenu.task.locked ? "Allow rescheduling again" : "Freeze the times; nothing is auto-scheduled within the break either side"}
            onClick={() => { dispatch({ type: "upsertTask", task: { ...rowMenu.task, locked: !rowMenu.task.locked } }); setRowMenu(null); }}
          >
            {rowMenu.task.locked ? "Unlock scheduling" : "Lock scheduling"}
          </button>
          <button role="menuitem" className="danger" onClick={() => { dispatch({ type: "deleteTask", id: rowMenu.task.id }); setRowMenu(null); }}>Delete</button>
        </div>
      )}
      {depSel && (() => {
        const from = state.tasks.find((t) => t.id === depSel.fromId);
        const to = state.tasks.find((t) => t.id === depSel.toId);
        if (!from || !to) return null;
        return (
          <div className="gv-pop" style={{ left: Math.min(depSel.x, window.innerWidth - 260), top: depSel.y + 6 }}>
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              <b>{to.title}</b> starts after <b>{from.title}</b>
            </div>
            <button
              className="btn btn-secondary"
              style={{ padding: "3px 10px", fontSize: 12 }}
              onClick={() => {
                dispatch({ type: "upsertTask", task: { ...to, dependsOn: to.dependsOn?.filter((d) => d !== from.id) } });
                setDepSel(null);
              }}
            >
              Remove link
            </button>
          </div>
        );
      })()}
    </div>
  );
}

/* ————— List: nested tree, inline editing, multi-select bulk ops ————— */

interface ListColumn {
  id: string;
  label: string;
  width: number;
  /** Fixed-purpose gutters (the tick box, the row menu) are not resizable. */
  fixed?: boolean;
  desktopOnly?: boolean;
}

const LIST_COLUMNS: ListColumn[] = [
  { id: "select", label: "", width: 34, fixed: true },
  { id: "task", label: "Task", width: 280 },
  { id: "status", label: "Status", width: 130 },
  { id: "priority", label: "Priority", width: 74 },
  { id: "estimate", label: "Est.", width: 80 },
  { id: "deadline", label: "Deadline", width: 150, desktopOnly: true },
  { id: "tags", label: "Tags", width: 150, desktopOnly: true },
  { id: "comment", label: "Comment", width: 200, desktopOnly: true },
  { id: "menu", label: "", width: 34, fixed: true },
];

const COL_WIDTH_KEY = "letsgo.listColumnWidths";
const MIN_COL_WIDTH = 56;

/** Column widths are a per-device display preference (they track screen size,
    not content), so they live in localStorage rather than the synced vault. */
function loadColumnWidths(): Record<string, number> {
  try {
    const raw = localStorage.getItem(COL_WIDTH_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function ListView({ tasks }: { tasks: Task[] }) {
  const { state, dispatch } = useStore();
  const { openTask } = useEditor();
  const mobile = useMobile();
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkEdit, setBulkEdit] = useState(false);
  const [widths, setWidths] = useState<Record<string, number>>(loadColumnWidths);
  const [dragCol, setDragCol] = useState<string | null>(null);
  // Row reorder: what's being dragged (with its sibling group) and which row
  // the pointer is over, for the drop line. Reorder is sibling-only, matching
  // the order the estimate packer walks children in.
  const dragRow = useRef<{ id: string; parentId: string } | null>(null);
  const [overRow, setOverRow] = useState<string | null>(null);
  const sameGroup = (t: Task) => dragRow.current !== null && dragRow.current.id !== t.id && dragRow.current.parentId === (t.parentId ?? "");

  const columns = LIST_COLUMNS.filter((c) => !(mobile && c.desktopOnly));
  const widthOf = (c: ListColumn) => widths[c.id] ?? c.width;

  const saveWidths = (next: Record<string, number>) => {
    setWidths(next);
    try { localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(next)); } catch { /* private mode — session-only widths */ }
  };

  /** Pointer-driven column resize. Pointer capture keeps the drag alive even
      when the cursor outruns the 9px handle, which is most of the time. */
  const startResize = (col: ListColumn, e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthOf(col);
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragCol(col.id);
    let latest = startWidth;
    const onMove = (ev: PointerEvent) => {
      latest = Math.max(MIN_COL_WIDTH, Math.round(startWidth + (ev.clientX - startX)));
      setWidths((w) => ({ ...w, [col.id]: latest }));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setDragCol(null);
      saveWidths({ ...loadColumnWidths(), ...widths, [col.id]: latest });
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  /** Keyboard equivalent so resizing is not pointer-only. */
  const nudgeWidth = (col: ListColumn, delta: number) =>
    saveWidths({ ...widths, [col.id]: Math.max(MIN_COL_WIDTH, widthOf(col) + delta) });

  // Routines group/sort by today's occurrence, matching what their row shows.
  // Paused groups with In progress (the row still shows its own "Paused" chip).
  const order: TaskStatus[] = ["in_progress", "pending", "done", "skipped"];
  const statusToday = (t: Task) => boardStatus(occurrenceTask(t, Date.now()).status);
  const roots = [...tasks].sort((a, b) => {
    const sa = statusToday(a), sb = statusToday(b);
    return grouped && sa !== sb ? order.indexOf(sa) - order.indexOf(sb) : a.priority - b.priority;
  });

  interface Row { task: Task; depth: number }
  const rows: Row[] = [];
  const walk = (task: Task, depth: number) => {
    rows.push({ task, depth });
    if (collapsed[task.id]) return;
    for (const child of childTasks(state, task.id)) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);

  // Selecting a parent selects its whole subtree (and deselecting clears
  // it) — bulk actions on a parent almost always mean "and its subtasks".
  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    const subtree = (tid: string, fn: (x: string) => void) => {
      fn(tid);
      for (const child of childTasks(state, tid)) subtree(child.id, fn);
    };
    if (next.has(id)) subtree(id, (x) => next.delete(x));
    else subtree(id, (x) => next.add(x));
    setSelected(next);
  };

  const bulk = (fn: (id: string) => void) => {
    selected.forEach(fn);
    setSelected(new Set());
  };

  const commit = (task: Task, patch: Partial<Task>) => dispatch({ type: "upsertTask", task: { ...task, ...patch } });

  const row = ({ task: t, depth }: Row) => {
    // Display/status actions read today's occurrence for routines; `t` stays
    // the raw task because `commit` writes it back whole.
    const view = occurrenceTask(t, Date.now());
    const done = view.status === "done";
    const subs = childTasks(state, t.id);
    const isParent = subs.length > 0;
    return (
      <tr
        key={t.id}
        onClick={() => openTask(t.id)}
        onDragOver={(e) => { if (sameGroup(t)) { e.preventDefault(); setOverRow(t.id); } }}
        onDragLeave={() => setOverRow((c) => (c === t.id ? null : c))}
        onDrop={(e) => {
          if (sameGroup(t)) { e.preventDefault(); dispatch({ type: "reorderTask", id: dragRow.current!.id, targetId: t.id, place: "before" }); }
          dragRow.current = null; setOverRow(null);
        }}
        style={{ cursor: "pointer", boxShadow: overRow === t.id ? "inset 0 2px 0 0 var(--color-accent)" : undefined }}
      >
        {/* The tick box has ONE job — selection for bulk actions. It used to
            double as "mark done", which made every bulk selection read like a
            row of completion toggles; status now lives on the status chip. */}
        <td onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected.has(t.id)}
            onChange={() => toggleSelect(t.id)}
            aria-label={`Select ${t.title}`}
            style={{ accentColor: "var(--color-accent)", width: 15, height: 15 }}
          />
        </td>
        <td>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, paddingLeft: depth * 22 }}>
            <span
              className="list-grip"
              draggable
              onClick={(e) => e.stopPropagation()}
              onDragStart={(e) => { dragRow.current = { id: t.id, parentId: t.parentId ?? "" }; e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => { dragRow.current = null; setOverRow(null); }}
              aria-label={`Reorder ${t.title}`}
              title="Drag to reorder among siblings"
              style={{ flex: "none", display: "flex", cursor: "grab", color: "var(--color-text-3)" }}
            >
              <IGrab size={12} />
            </span>
            {isParent ? (
              <button
                onClick={(e) => { e.stopPropagation(); setCollapsed({ ...collapsed, [t.id]: !collapsed[t.id] }); }}
                aria-expanded={!collapsed[t.id]}
                aria-label={`${subs.length} subtasks`}
                style={{ border: "none", background: "none", cursor: "pointer", padding: 0, display: "flex", color: "var(--accent-strong)" }}
              >
                {collapsed[t.id] ? <IChevronR size={12} strokeWidth={2} /> : <IChevronD size={12} strokeWidth={2} />}
              </button>
            ) : depth > 0 ? (
              <span style={{ color: "var(--color-text-3)", fontSize: 11 }}>└</span>
            ) : null}
            {/* List has no day header for a notch to hang from, so an event
                identifies itself in the row: its emoji, then an "all day"
                tag where a time would otherwise be. */}
            {isAllDayEvent(t) && <span aria-hidden="true">{t.emoji ?? "📌"}</span>}
            <span style={done ? { textDecoration: "line-through", color: "var(--color-text-2)" } : { fontWeight: depth ? 400 : 500 }}>{t.title}</span>
            {isAllDayEvent(t) && (
              <span className="event-pill">
                all day{repeatLabel(t.repeat) ? ` · ${repeatLabel(t.repeat)}` : ""}
              </span>
            )}
            {t.locked && <ILock size={11} style={{ color: "var(--color-text-3)", flex: "none" }} aria-label="Scheduling locked" />}
          </span>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {/* Click to walk pending → in progress → done → skipped. A parent's
              status is derived from its subtasks, so it stays read-only. */}
          <button
            className="status-cycle"
            disabled={isParent}
            title={isParent ? "Derived from subtasks" : view.status === "paused" ? "Paused — click to resume" : "Click to cycle status"}
            aria-label={`Status ${STATUS_LABEL[view.status]}${isParent ? " (derived from subtasks)" : view.status === "paused" ? " — click to resume" : " — click to cycle"}`}
            onClick={() => dispatch({ type: "setStatus", id: t.id, status: nextStatus(view.status) })}
          >
            <StatusSq status={view.status} size={8} />
            {STATUS_LABEL[view.status]}
          </button>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <button
            aria-label={`Priority P${t.priority} — click to change`}
            title="Click to cycle priority"
            onClick={() => commit(t, { priority: ((t.priority + 1) % 4) as Priority })}
            style={{ border: "none", background: "none", padding: 0, cursor: "pointer" }}
          >
            <Prio p={t.priority} />
          </button>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {!isParent ? (
            <input
              type="number"
              min={0}
              step={5}
              value={t.estimateMin ?? ""}
              placeholder="—"
              disabled={t.locked}
              title={t.locked ? "Scheduling locked" : undefined}
              aria-label={`Estimate for ${t.title} in minutes`}
              onChange={(e) => commit(t, { estimateMin: e.target.value ? Number(e.target.value) : undefined })}
              style={{ width: 58, border: "1px solid transparent", background: "none", fontSize: 13, color: "var(--color-text)", padding: "2px 4px" }}
              onFocus={(e) => (e.target.style.borderColor = "var(--color-accent)")}
              onBlur={(e) => (e.target.style.borderColor = "transparent")}
            />
          ) : (
            <span style={{ fontSize: 12, color: "var(--color-text-3)" }} title="Derived from subtasks">{t.estimateMin ? `${t.estimateMin}m` : "—"}</span>
          )}
        </td>
        {!mobile && (
          <td style={{ color: "var(--color-text-2)", whiteSpace: "nowrap" }}>{t.deadline ? fmtDateTime(t.deadline) : "—"}</td>
        )}
        {!mobile && (
          <td>
            {t.tags.map((tag, i) => (
              <span key={tag} className={`tag ${i === 0 ? "tag-accent" : "tag-neutral"}`} style={{ marginRight: 4 }}>{tag}</span>
            ))}
          </td>
        )}
        {!mobile && (
          <td onClick={(e) => e.stopPropagation()}>
            {/* Committed on blur rather than per keystroke: every dispatch
                re-encrypts and re-syncs the vault, so typing a sentence should
                not be a sentence's worth of saves. */}
            {/* Uncontrolled + keyed on the stored value: typing does not
                dispatch, but an edit from elsewhere (the task editor, a sync
                pull) remounts the input so it never shows a stale comment. */}
            <input
              key={t.comment ?? ""}
              className="cell-input"
              defaultValue={t.comment ?? ""}
              placeholder="Add a note…"
              aria-label={`Comment on ${t.title}`}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value !== (t.comment ?? "")) commit(t, { comment: value || undefined });
              }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            />
          </td>
        )}
        <td onClick={(e) => e.stopPropagation()}><StatusMenu task={view} /></td>
      </tr>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: mobile ? "6px 12px 16px" : "6px 20px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {Object.keys(widths).length > 0 && (
            <button
              className="btn btn-ghost"
              style={{ padding: "5px 11px", fontSize: 13 }}
              onClick={() => { setWidths({}); try { localStorage.removeItem(COL_WIDTH_KEY); } catch { /* no-op */ } }}
            >
              Reset widths
            </button>
          )}
          <button className="btn btn-secondary" style={{ padding: "5px 11px", fontSize: 13 }} onClick={() => setGrouped(!grouped)}>
            Group: {grouped ? "Status" : "Priority"}
          </button>
        </span>
      </div>
      <table className="table table-resizable">
        <colgroup>
          {columns.map((c) => <col key={c.id} style={{ width: widthOf(c) }} />)}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} scope="col">
                {c.label}
                {!c.fixed && (
                  <button
                    className={`col-resizer${dragCol === c.id ? " dragging" : ""}`}
                    aria-label={`Resize ${c.label} column`}
                    title={`Drag to resize — currently ${widthOf(c)}px`}
                    onPointerDown={(e) => startResize(c, e)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowLeft") { e.preventDefault(); nudgeWidth(c, -16); }
                      if (e.key === "ArrowRight") { e.preventDefault(); nudgeWidth(c, 16); }
                    }}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map(row)}</tbody>
      </table>
      {/* Selection popup: surfaces the moment anything is ticked, floating
          over the list so bulk actions never hide in the toolbar. */}
      {selected.size > 0 && (
        <div
          style={{
            position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 40,
            display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", maxWidth: "calc(100vw - 24px)", flexWrap: "wrap",
            background: "var(--color-bg)", border: "1px solid var(--color-divider)", boxShadow: "var(--shadow-lg)",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--color-text-2)", whiteSpace: "nowrap" }}>{selected.size} selected</span>
          <button className="btn btn-primary" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => setBulkEdit(true)}>Edit…</button>
          {(() => {
            const allLocked = [...selected].every((id) => state.tasks.find((t) => t.id === id)?.locked);
            return (
              <button
                className="btn btn-icon btn-secondary"
                style={{ width: 28, height: 28 }}
                aria-label={allLocked ? "Unlock scheduling" : "Lock scheduling"}
                title={allLocked ? "Unlock — allow rescheduling again" : "Lock — freeze date-times; only status, priority and tags stay editable"}
                onClick={() => bulk((id) => {
                  const t = state.tasks.find((x) => x.id === id);
                  if (t) dispatch({ type: "upsertTask", task: { ...t, locked: !allLocked } });
                })}
              >
                {allLocked ? <IUnlock size={14} /> : <ILock size={14} />}
              </button>
            );
          })()}
          <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => bulk((id) => dispatch({ type: "setStatus", id, status: "done" }))}>Mark done</button>
          <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => bulk((id) => dispatch({ type: "setStatus", id, status: "skipped" }))}>Skip</button>
          <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12, color: "var(--prio-hi-text)", borderColor: "var(--prio-hi-border)" }} onClick={() => bulk((id) => dispatch({ type: "deleteTask", id }))}>Delete</button>
          <button className="btn btn-icon btn-ghost" style={{ width: 26, height: 26 }} aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            <IX size={14} />
          </button>
        </div>
      )}
      {bulkEdit && (
        <BulkEditModal
          ids={selected}
          onClose={() => setBulkEdit(false)}
          onDone={() => { setBulkEdit(false); setSelected(new Set()); }}
        />
      )}
    </div>
  );
}

/** Bulk-edit popup: one form applied to every selected task. Only the fields
    the user touches are written; untouched fields keep their per-task values.
    Status goes through setStatus (timer banking + parent derivation); estimate
    skips parents, whose estimate is derived from their subtasks. */
function BulkEditModal({ ids, onClose, onDone }: { ids: Set<string>; onClose: () => void; onDone: () => void }) {
  const { state, dispatch } = useStore();
  const [status, setStatus] = useState<"" | TaskStatus>("");
  const [prio, setPrio] = useState("");
  const [deadline, setDeadline] = useState<number | undefined>(undefined);
  const [clearDeadline, setClearDeadline] = useState(false);
  const [estimate, setEstimate] = useState("");
  const [addTags, setAddTags] = useState("");
  const field = { display: "flex", flexDirection: "column" as const, gap: 4 };

  const apply = () => {
    for (const id of ids) {
      const t = state.tasks.find((x) => x.id === id);
      if (!t) continue;
      const patch: Partial<Task> = {};
      if (prio !== "") patch.priority = Number(prio) as Priority;
      if (clearDeadline) patch.deadline = undefined;
      else if (deadline !== undefined) patch.deadline = deadline;
      if (estimate && Number(estimate) > 0 && childTasks(state, id).length === 0) patch.estimateMin = Number(estimate);
      if (addTags.trim()) patch.tags = [...new Set([...t.tags, ...addTags.split(",").map((s) => s.trim()).filter(Boolean)])];
      if (Object.keys(patch).length > 0) dispatch({ type: "upsertTask", task: { ...t, ...patch } });
      if (status !== "") dispatch({ type: "setStatus", id, status });
    }
    onDone();
  };

  return (
    <Modal onClose={onClose} width={420}>
      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ fontSize: 17 }}>Edit {ids.size} task{ids.size === 1 ? "" : "s"}</h3>
          <button className="btn btn-icon btn-ghost" style={{ width: 26, height: 26 }} onClick={onClose} aria-label="Close">
            <IX size={15} />
          </button>
        </div>
        <p style={{ fontSize: 12, color: "var(--color-text-2)", margin: 0 }}>
          Only the fields you set are applied — everything else stays as-is on each task.
        </p>
        <label style={field}>
          <span className="cap" style={{ fontSize: 10.5 }}>Status</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as "" | TaskStatus)}>
            <option value="">— unchanged —</option>
            {(["pending", "in_progress", "done", "skipped"] as TaskStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </label>
        <label style={field}>
          <span className="cap" style={{ fontSize: 10.5 }}>Priority</span>
          <select className="input" value={prio} onChange={(e) => setPrio(e.target.value)}>
            <option value="">— unchanged —</option>
            {[0, 1, 2, 3].map((p) => <option key={p} value={p}>P{p}{p === 0 ? " — highest" : p === 3 ? " — lowest" : ""}</option>)}
          </select>
        </label>
        <label style={field}>
          <span className="cap" style={{ fontSize: 10.5 }}>Deadline</span>
          {clearDeadline
            ? <input className="input" disabled value="cleared on apply" aria-label="Deadline (clearing)" />
            : <DateTimeField ariaLabel="Deadline" value={deadline} onChange={setDeadline} />}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-text-2)" }}>
            <input type="checkbox" checked={clearDeadline} onChange={(e) => setClearDeadline(e.target.checked)} style={{ accentColor: "var(--color-accent)" }} />
            Clear existing deadlines
          </label>
        </label>
        <label style={field}>
          <span className="cap" style={{ fontSize: 10.5 }}>Estimate (minutes — parents keep their derived value)</span>
          <input className="input" type="number" min={0} step={5} placeholder="unchanged" value={estimate} onChange={(e) => setEstimate(e.target.value)} />
        </label>
        <label style={field}>
          <span className="cap" style={{ fontSize: 10.5 }}>Add tags</span>
          <input className="input" placeholder="comma, separated" value={addTags} onChange={(e) => setAddTags(e.target.value)} />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={apply}>Apply to {ids.size}</button>
        </div>
      </div>
    </Modal>
  );
}
