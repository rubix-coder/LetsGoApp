import { useEffect, useMemo, useRef, useState } from "react";
import { taskElapsedMin, useStore } from "../../lib/store";
import { useMobile, useNow } from "../../lib/router";
import { useEditor } from "../../App";
import { STATUS_LABEL, type Task } from "../../lib/types";
import { nextStatus } from "../../lib/status";
import { Corners, Prio, Seg, StatusSq } from "../../components/ui";
import { IChevronL, IChevronR, ILock, IPause } from "../../components/Icons";
import { addDays, fmtDayMed, fmtDayShort, fmtHour, fmtRange, fmtTime, sameDay, startOfDay } from "../../lib/dates";
import { blockOccursOn, blockSlotOn, repeatOccursOn } from "../../lib/mdTasks";
import { occurrenceStatusOf } from "../../lib/occurrence";
import { eventsOnDay, isAllDayEvent } from "../../lib/dayEvents";
import { DayNotch } from "../../components/DayNotch";
import { beginTouchDrag, hitData } from "../../lib/touchDrag";
import { assignLanes } from "../../lib/dayLanes";
import { HOUR_H_MAX, HOUR_H_MIN, carrySegmentMs, visibleCardMinutes, zoomHourH } from "../../lib/scheduleGeometry";
import { cardDetailText, detailLinesFor, timeBadge } from "../../lib/taskCardMeta";

const HOURS = 24; // full-day grid (desktop 0.21.4); view auto-scrolls to morning

// The "now" rule: a fixed red, deliberately NOT an accent/theme token — an
// accent-colored line vanished against accent-filled (in-progress) cards and
// would shift hue with the selectable accents. Painted above the cards.
const NOW_LINE = "var(--now-line)";


// Card and notch times go through fmtTime so the Settings clock style
// (24h default / 12h) applies here too.
const clock = fmtTime;

/** Ancestry breadcrumb (root → immediate parent) for a task; "" if top-level.
    Shown as the leaf's slide-out bookmark tag now that parent container blocks
    are hidden from the grid. Reads a shared id→task map built once per render. */
function lineageOf(byId: Map<string, Task>, task: Task): string {
  const chain: string[] = [];
  let cursor = task.parentId ? byId.get(task.parentId) : undefined;
  while (cursor) {
    chain.unshift(cursor.title);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return chain.join(" › ");
}

interface DayEvent {
  task: Task;
  start: number;
  ghost: boolean; // computed-on-read routine occurrence, non-draggable
  /** Tail of yesterday's overnight card, rendered from 00:00; `end` is its
      clipped finish. Continuations are display-only — not draggable, not
      resizable — and their status belongs to yesterday's occurrence. */
  cont?: boolean;
  end?: number;
  lane: number;
  lanes: number;
}

/** Side-by-side placement, sized per overlap cluster (lib/dayLanes.ts) so a
    collision in the evening cannot narrow the morning's cards. */
function layoutDay(events: { task: Task; start: number; ghost: boolean; cont?: boolean; end?: number }[]): DayEvent[] {
  const spans = events.map((e) => ({
    ...e,
    end: e.end ?? e.start + Math.max(30, e.task.estimateMin ?? 60) * 60_000,
  }));
  return assignLanes(spans).map(({ task, start, ghost, cont, end, lane, lanes }) => ({ task, start, ghost, cont, end, lane, lanes }));
}

export function Schedule() {
  const { state, dispatch } = useStore();
  const { openTask } = useEditor();
  const mobile = useMobile();
  const now = useNow(30_000);
  // One id→task map per render, shared by every Event's lineage breadcrumb.
  const byId = useMemo(() => new Map(state.tasks.map((t) => [t.id, t])), [state.tasks]);
  const [span, setSpan] = useState(mobile ? 1 : 3);
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));
  // Row height is zoomable (a tightly packed day is unreadable at 54px/h)
  // and persists per device; out-of-range stored values fall back to default.
  const [hourH, setHourH] = useState(() => {
    const stored = Number(localStorage.getItem("letsgo.scheduleHourH"));
    return stored >= HOUR_H_MIN && stored <= HOUR_H_MAX ? stored : mobile ? 60 : 54;
  });
  const axisW = mobile ? 46 : 56;
  const scroller = useRef<HTMLDivElement>(null);
  // Live drop-position indicator shown while a card is dragged over a column.
  const [notch, setNotch] = useState<{ day: number; at: number } | null>(null);

  // Initial position only — zooming must not yank the view back to 07:00,
  // so this deliberately doesn't re-run on hourH changes (zoom() keeps the
  // viewport centered itself).
  useEffect(() => {
    scroller.current?.scrollTo({ top: 7 * hourH });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function zoom(dir: 1 | -1) {
    setHourH((h) => {
      const next = zoomHourH(h, dir);
      if (next !== h) {
        localStorage.setItem("letsgo.scheduleHourH", String(next));
        const el = scroller.current;
        if (el) {
          // Keep the time at the viewport's center fixed while the grid
          // stretches under it.
          const center = el.scrollTop + el.clientHeight / 2;
          const top = (center * next) / h - el.clientHeight / 2;
          requestAnimationFrame(() => el.scrollTo({ top }));
        }
      }
      return next;
    });
  }

  const days = [...Array(span)].map((_, i) => addDays(anchor, i));
  /* Where a card is too slim to carry its description. Week view on a desktop
     is seven columns of ~140px; a phone is narrow at anything above one day. */
  const narrowColumns = span >= 7 || (mobile && span > 1);
  // All-day events are kept out of the hour grid entirely (they render as day
  // notches in the header): they carry no start time, so they can neither
  // occupy a slot nor take part in overlap-lane assignment.
  const scheduled = state.tasks.filter((t) => t.scheduledAt !== undefined && !isAllDayEvent(t));
  // A parent whose subtree was auto-scheduled (estimate pack) lands on the grid
  // as a lane spanning the union of its children — redundant, and it forces the
  // leaves into overflow columns. Hide any task that has a scheduled child; the
  // leaves (packed back-to-back, so non-overlapping) then collapse to one
  // full-width column, and each carries its ancestry as a hover bookmark tag.
  const scheduledParentIds = new Set(
    scheduled.filter((t) => t.parentId).map((t) => t.parentId!),
  );
  const leaves = scheduled.filter((t) => !scheduledParentIds.has(t.id));

  // Minute-resolution: a drop at 19:03 lands at 19:03, not a snapped 30-min slot.
  function dropTime(day: number, clientY: number, el: HTMLElement): number {
    const rect = el.getBoundingClientRect();
    const mins = Math.max(0, Math.min(HOURS * 60 - 1, ((clientY - rect.top) / hourH) * 60));
    return day + Math.round(mins) * 60_000;
  }

  // Holding a dragged card against the viewport's right edge (or over the time
  // axis on the left) steps the visible window ±1 day so out-of-view dates
  // become reachable mid-drag. dragover re-fires ~every 350ms while the pointer
  // is stationary, so a throttle timestamp is enough — no timer to clean up.
  const lastEdgeStep = useRef(0);
  function edgeAdvance(clientX: number) {
    const rect = scroller.current?.getBoundingClientRect();
    if (!rect) return;
    const dir = rect.right - clientX <= 44 ? 1 : clientX - rect.left <= axisW + 8 ? -1 : 0;
    if (dir === 0 || Date.now() - lastEdgeStep.current < 600) return;
    lastEdgeStep.current = Date.now();
    setAnchor((a) => addDays(a, dir));
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: mobile ? "0 16px 10px" : "10px 22px", borderBottom: "1px solid var(--color-divider)" }}>
        <button className="btn btn-icon btn-secondary" style={{ width: 30, height: 30 }} onClick={() => setAnchor(addDays(anchor, -span))} aria-label="Earlier">
          <IChevronL size={15} strokeWidth={1.6} />
        </button>
        <button className="btn btn-secondary" style={{ padding: "5px 12px", fontSize: 13 }} onClick={() => setAnchor(startOfDay(Date.now()))}>Today</button>
        <button className="btn btn-icon btn-secondary" style={{ width: 30, height: 30 }} onClick={() => setAnchor(addDays(anchor, span))} aria-label="Later">
          <IChevronR size={15} strokeWidth={1.6} />
        </button>
        <span style={{ fontSize: 15, fontFamily: "var(--font-heading)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {span === 1 ? fmtDayMed(anchor) : fmtRange(anchor, addDays(anchor, span - 1))}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <button className="btn btn-icon btn-secondary" style={{ width: 30, height: 30, fontSize: 16 }} onClick={() => zoom(-1)} disabled={hourH <= HOUR_H_MIN} aria-label="Shorter hour rows" title="Zoom out (shorter hour rows)">−</button>
          <button className="btn btn-icon btn-secondary" style={{ width: 30, height: 30, fontSize: 16 }} onClick={() => zoom(1)} disabled={hourH >= HOUR_H_MAX} aria-label="Taller hour rows" title="Zoom in (taller hour rows)">+</button>
          <Seg
            small
            ariaLabel="Days shown"
            items={mobile ? [{ id: "1", label: "Day" }, { id: "3", label: "3d" }] : [{ id: "1", label: "Day" }, { id: "3", label: "3-day" }, { id: "7", label: "Week" }]}
            active={String(span)}
            onSelect={(id) => setSpan(Number(id))}
          />
        </span>
      </div>

      <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: "auto" }} onDragOver={(e) => edgeAdvance(e.clientX)} onDragEnd={() => setNotch(null)}>
        <div style={{ display: "flex" }}>
          {/* time axis */}
          <div style={{ width: axisW, flex: "none", paddingTop: 34 }}>
            {[...Array(HOURS)].map((_, i) => (
              <div key={i} style={{ height: hourH, textAlign: "right", paddingRight: 8, fontSize: 11, color: "var(--color-text-3)" }}>
                {fmtHour(i)}
              </div>
            ))}
          </div>
          {/* day columns */}
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${span}, 1fr)` }}>
            {days.map((day) => {
              const isToday = sameDay(day, now);
              const real = leaves
                .filter((t) => sameDay(t.scheduledAt!, day))
                .map((t) => ({ task: t, start: t.scheduledAt!, ghost: false }));
              const ghosts = leaves
                .filter((t) => t.repeat && !sameDay(t.scheduledAt!, day) && repeatOccursOn(t.scheduledAt!, t.repeat, day))
                .map((t) => ({ task: t, start: day + (t.scheduledAt! - startOfDay(t.scheduledAt!)), ghost: true }));
              // Yesterday's overnight cards continue here from 00:00 — the
              // half of them that visibleCardMinutes clipped off yesterday.
              const prevDay = addDays(day, -1);
              const estMin = (t: Task) => Math.max(30, t.estimateMin ?? 60);
              const conts = [
                ...leaves
                  .filter((t) => sameDay(t.scheduledAt!, prevDay))
                  .map((t) => ({ t, ghost: false, seg: carrySegmentMs(t.scheduledAt!, estMin(t), day) })),
                ...leaves
                  .filter((t) => t.repeat && !sameDay(t.scheduledAt!, prevDay) && repeatOccursOn(t.scheduledAt!, t.repeat, prevDay))
                  .map((t) => ({ t, ghost: true, seg: carrySegmentMs(prevDay + (t.scheduledAt! - startOfDay(t.scheduledAt!)), estMin(t), day) })),
              ]
                .filter((x) => x.seg !== null)
                .map(({ t, ghost, seg }) => ({ task: t, start: seg!.start, end: seg!.end, ghost, cont: true }));
              const events = layoutDay([...conts, ...real, ...ghosts]);
              const dayBlocks = state.blocks.filter((b) => blockOccursOn(b, day));
              const nowMin = (now - day) / 60_000;
              return (
                <div key={day} style={{ borderLeft: "1px solid var(--color-divider)", display: "flex", flexDirection: "column", minWidth: 0 }}>
                  {/* All-day events hang under the day label rather than
                      claiming an hour slot — they have no start time, and
                      placing them at midnight would falsely fill the day. */}
                  <div style={{ minHeight: 34, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: "3px 0", borderBottom: "1px solid var(--color-divider)", background: isToday ? "color-mix(in srgb, var(--color-accent) 8%, var(--color-bg))" : "var(--color-bg)", position: "sticky", top: 0, zIndex: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: isToday ? undefined : "var(--color-text-2)" }}>{fmtDayShort(day)}</span>
                      {isToday && <span className="tag tag-accent" style={{ padding: "1px 6px" }}>Today</span>}
                    </div>
                    <DayNotch events={eventsOnDay(state.tasks, day)} />
                  </div>
                  <div
                    data-sched-day={day}
                    style={{
                      position: "relative", height: HOURS * hourH,
                      // Two rulings per hour: a faint half-hour line so a
                      // packed day stays scannable, and the full-hour divider.
                      background: `repeating-linear-gradient(transparent 0 ${hourH / 2 - 1}px, color-mix(in srgb, var(--color-divider) 45%, transparent) ${hourH / 2 - 1}px ${hourH / 2}px, transparent ${hourH / 2}px ${hourH}px), repeating-linear-gradient(transparent 0 ${hourH - 1}px, var(--color-divider) ${hourH - 1}px ${hourH}px)`,
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setNotch({ day, at: dropTime(day, e.clientY, e.currentTarget) });
                    }}
                    onDrop={(e) => {
                      setNotch(null);
                      const id = e.dataTransfer.getData("text/task-id");
                      if (id) dispatch({ type: "scheduleTask", id, at: dropTime(day, e.clientY, e.currentTarget) });
                    }}
                    onClick={(e) => {
                      if (e.target === e.currentTarget) openTask(null, { scheduledAt: dropTime(day, e.clientY, e.currentTarget) });
                    }}
                  >
                    {dayBlocks.map((b) => {
                      const slot = blockSlotOn(b, day);
                      return (
                        <div key={b.id} style={{ position: "absolute", top: ((slot.start - day) / 3_600_000) * hourH, left: 4, right: 4, height: (visibleCardMinutes((slot.start - day) / 60_000, slot.durationMin) / 60) * hourH, background: "color-mix(in srgb, var(--color-accent) 10%, transparent)", border: "1px dashed var(--accent-mid)", borderRadius: 8, padding: "6px 8px", overflow: "hidden", pointerEvents: "none" }}>
                          <div style={{ fontSize: 11, color: "var(--accent-deep)" }}>
                            {b.title} — blocked{b.repeat ? ` · every ${b.repeat.interval > 1 ? `${b.repeat.interval} ` : ""}${b.repeat.unit.replace("ly", b.repeat.interval > 1 ? "s" : "")}` : ""}
                          </div>
                        </div>
                      );
                    })}
                    {events.map((e) => <Event key={`${e.task.id}-${e.start}`} event={e} day={day} hourH={hourH} byId={byId} notch={setNotch} edgeAdvance={edgeAdvance} narrow={narrowColumns} now={now} />)}
                    {isToday && nowMin >= 0 && nowMin <= HOURS * 60 && (
                      <div style={{ position: "absolute", top: (nowMin / 60) * hourH, left: 0, right: 0, height: 0, borderTop: `2px solid ${NOW_LINE}`, zIndex: 5, pointerEvents: "none" }}>
                        {/* The parent's 2px borderTop sits ABOVE its padding box,
                            so absolute children measure from 2px below the visible
                            line; -5.5 centers the 9px dot on the line itself. */}
                        <span style={{ position: "absolute", left: -1, top: -5.5, width: 9, height: 9, background: NOW_LINE, borderRadius: "50%" }} />
                      </div>
                    )}
                    {notch && notch.day === day && (
                      <div style={{ position: "absolute", top: ((notch.at - day) / 3_600_000) * hourH, left: 0, right: 0, height: 0, borderTop: "1.5px dashed var(--color-accent)", zIndex: 6, pointerEvents: "none" }}>
                        <span style={{ position: "absolute", right: 4, top: -9, fontSize: 10.5, fontWeight: 600, lineHeight: "17px", padding: "0 6px", background: "var(--color-accent)", color: "var(--on-accent)", borderRadius: 3, whiteSpace: "nowrap" }}>
                          {clock(notch.at)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Event({ event, day, hourH, byId, notch, edgeAdvance, narrow, now }: {
  event: DayEvent;
  day: number;
  hourH: number;
  byId: Map<string, Task>;
  notch: (n: { day: number; at: number } | null) => void;
  edgeAdvance: (x: number) => void;
  /** Columns too slim for prose — a week of them on a laptop, or more than one
      day on a phone. The card keeps its title and time badge; only the
      description is held back, because three words per line is not a glance. */
  narrow: boolean;
  /** The grid's own clock, so the live elapsed badge ticks without every card
      owning an interval of its own. */
  now: number;
}) {
  const { state, dispatch } = useStore();
  const { openTask } = useEditor();
  const { task, start, ghost, cont, lane, lanes } = event;
  const dragging = useRef(false);
  const [resizeDur, setResizeDur] = useState<number | null>(null);
  const resizeRef = useRef<{ startY: number; origMin: number } | null>(null);

  const top = ((start - day) / 3_600_000) * hourH;
  // A continuation renders its pre-clipped segment; everything else sizes
  // from the estimate (or the live resize preview).
  const durMin = cont ? (event.end! - start) / 60_000 : resizeDur ?? Math.max(30, task.estimateMin ?? 60);
  const end = start + durMin * 60_000;
  // An overnight duration (sleep, a long block near the bottom) clips at
  // 24:00 — the remainder belongs to the next day's column, not to the
  // space below the grid.
  const shownMin = visibleCardMinutes((start - day) / 60_000, durMin);

  // Routines resolve each card to ITS day's own status — marking today done
  // must not strike through tomorrow's card (they share one task object).
  // A continuation belongs to the day it STARTED on: last night's sleep tail
  // reads and writes yesterday's occurrence, not today's.
  const occDay = cont ? addDays(day, -1) : day;
  const status = task.repeat ? occurrenceStatusOf(task, occDay) : task.status;
  const running = state.timer.taskId === task.id && state.timer.runningSince !== undefined;
  const paused = status === "paused";
  const solid = !paused && (status === "in_progress" || (!ghost && running));
  const done = status === "done";
  const widthPct = 100 / lanes;
  const lineage = lineageOf(byId, task);

  /* The card's height is the budget everything below is spent against, so it
     is computed once here rather than inline in the style. */
  const cardH = Math.max(26, (shownMin / 60) * hourH - 2);

  /* Elapsed against estimate, right on the card. Live only while the timer is
     actually on this task; otherwise it is the banked total. A ghost is a
     future repeat with no time of its own to report. */
  const elapsedMin = taskElapsedMin(state, task, now);
  const badge = ghost ? null : timeBadge(task, elapsedMin);

  /* The write-up, shown in whatever vertical space the block has left over.

     A two-hour block was a big empty rectangle carrying a title, so the
     details needed to START the work sat one click away — a click made at the
     exact moment you were about to begin. Short blocks get nothing: a 15- or
     30-minute card has no room, and crushed text there would be worse than
     the empty rectangle. Lanes matter too — side-by-side cards are half-width
     or narrower, where a description is noise rather than information. */
  const detail = ghost ? "" : cardDetailText(task);
  // A lineage tag steals 18px of body padding on hover; budget for it so the
  // clamped text never shifts under the pointer.
  const detailLines = detail && lanes === 1 && !narrow
    ? detailLinesFor(cardH, lineage ? 18 : 0)
    : 0;

  function onResizeDown(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = { startY: e.clientY, origMin: Math.max(30, task.estimateMin ?? 60) };
  }
  function onResizeMove(e: React.PointerEvent) {
    if (!resizeRef.current) return;
    const dyMin = ((e.clientY - resizeRef.current.startY) / hourH) * 60;
    setResizeDur(Math.max(15, Math.round((resizeRef.current.origMin + dyMin) / 15) * 15));
  }
  function onResizeUp() {
    if (resizeRef.current && resizeDur !== null && resizeDur !== resizeRef.current.origMin) {
      dispatch({ type: "upsertTask", task: { ...task, estimateMin: resizeDur }, repack: false });
    }
    resizeRef.current = null;
    setResizeDur(null);
  }

  function cycleStatus(e: React.MouseEvent) {
    e.stopPropagation();
    dispatch({ type: "setStatus", id: task.id, status: nextStatus(status), occurrenceDay: task.repeat ? occDay : undefined });
  }

  function pauseTask(e: React.MouseEvent) {
    e.stopPropagation();
    dispatch({ type: "setStatus", id: task.id, status: "paused", occurrenceDay: task.repeat ? occDay : undefined });
  }

  /** Minute-resolution drop time under a viewport point, resolved against
      whichever day column is under the finger (`data-sched-day`). */
  function touchAt(mx: number, my: number): { day: number; at: number } | null {
    const hit = hitData(mx, my, "data-sched-day");
    if (!hit) return null;
    const hitDay = Number(hit.value);
    const rect = hit.el.getBoundingClientRect();
    const mins = Math.max(0, Math.min(HOURS * 60 - 1, ((my - rect.top) / hourH) * 60));
    return { day: hitDay, at: hitDay + Math.round(mins) * 60_000 };
  }

  // Touch: long-press then drag (HTML5 drag never fires from touch). Shares
  // the desktop path's notch indicator and edge day-stepping.
  function onCardPointerDown(e: React.PointerEvent) {
    if (ghost || cont || task.locked || resizeRef.current) return;
    beginTouchDrag(e, {
      label: task.title,
      onMove: (mx, my) => { edgeAdvance(mx); notch(touchAt(mx, my)); },
      onDrop: (mx, my) => {
        const hit = touchAt(mx, my);
        if (hit) dispatch({ type: "scheduleTask", id: task.id, at: hit.at });
      },
      onEnd: () => notch(null),
    });
  }

  return (
    <div
      className={`${lineage ? "blueprint lineageHost" : "blueprint"}${paused ? " card-paused" : ""}`}
      draggable={!ghost && !cont && !task.locked}
      onDragStart={(e) => { dragging.current = true; e.dataTransfer.setData("text/task-id", task.id); }}
      onDragEnd={() => { dragging.current = false; }}
      onPointerDown={onCardPointerDown}
      onClick={(e) => { e.stopPropagation(); if (!dragging.current && !resizeRef.current) openTask(task.id); }}
      style={{
        position: "absolute", top,
        left: `calc(${lane * widthPct}% + 4px)`,
        width: `calc(${widthPct}% - 8px)`,
        height: cardH,
        background: solid ? "var(--color-accent)" : "var(--color-card)",
        borderColor: solid ? "var(--accent-strong)" : undefined,
        borderStyle: ghost ? "dashed" : "solid",
        // Dashed top edge on a continuation: the card "enters" from yesterday.
        borderTopStyle: cont ? "dashed" : undefined,
        padding: "5px 8px", overflow: "hidden", cursor: ghost || task.locked ? "pointer" : "grab",
        opacity: done ? 0.65 : ghost ? 0.65 : 1, zIndex: 1,
      }}
      title={[
        cont ? `${task.title} — continues from yesterday`
          : ghost ? `${task.title} — repeats ${task.repeat?.unit}`
          : task.title,
        // The card clamps the write-up to the lines that fit; hovering gives
        // the whole of it back without opening the editor.
        detail,
      ].filter(Boolean).join("\n\n")}
    >
      <Corners />
      {lineage && (
        <div className="lineageTag" title={lineage} aria-hidden="true">
          {lineage}
        </div>
      )}
      <div className="lineageBody">
        {/* Height pinned to TITLE_ROW in lib/taskCardMeta: the detail clamp is
            computed against these numbers, so a row that quietly grew would
            slice the last line of text in half. */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, height: 16 }}>
          {/* Every card gets the one-click status square — ghost routine
              occurrences included, since each day now marks independently.
              Priority stays off ghosts (it belongs to the template). */}
          {(!ghost || task.repeat) && (
            <button
              onClick={cycleStatus}
              onPointerDown={(e) => e.stopPropagation()}
              title={status === "paused" ? "Paused — click to resume" : "Click to cycle status"}
              aria-label={`Status ${STATUS_LABEL[status]} — click to ${status === "paused" ? "resume" : "change"}`}
              // Padded past the glyph for a finger-sized target; the negative
              // margin keeps the card layout unchanged (same trick as the lock
              // badge below).
              style={{ flex: "none", display: "flex", alignItems: "center", background: "none", border: "none", padding: 7, margin: "-7px -5px -7px -7px", cursor: "pointer" }}
            >
              <StatusSq status={status} size={11} pulse={status === "in_progress"} />
            </button>
          )}
          {/* Quick "attend an errand" pause — only while actually in progress. */}
          {status === "in_progress" && (
            <button
              onClick={pauseTask}
              onPointerDown={(e) => e.stopPropagation()}
              title="Pause — hold this task, keep the elapsed time"
              aria-label={`Pause ${task.title}`}
              style={{ flex: "none", display: "flex", alignItems: "center", background: "none", border: "none", padding: 6, margin: "-6px -4px -6px -4px", cursor: "pointer", color: solid ? "var(--on-accent)" : "var(--color-text-3)" }}
            >
              <IPause size={12} />
            </button>
          )}
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: solid ? "var(--on-accent)" : undefined, textDecoration: done ? "line-through" : undefined, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {/* Tap the badge to release the lock — the card itself is not
                draggable while locked, so this is the way out from here. The
                padding/negative-margin pair buys a finger-sized hit area
                without the glyph moving a pixel, and stopping pointerdown
                keeps a tap from starting the card's touch-drag. */}
            {task.locked && (
              <button
                onClick={(e) => { e.stopPropagation(); dispatch({ type: "upsertTask", task: { ...task, locked: undefined } }); }}
                onPointerDown={(e) => e.stopPropagation()}
                title="Scheduling locked — tap to unlock"
                aria-label={`${task.title} — scheduling locked, tap to unlock`}
                style={{
                  background: "none", border: "none", cursor: "pointer", color: "inherit", verticalAlign: -1,
                  padding: 8, margin: "-8px -5px -8px -8px", touchAction: "manipulation", lineHeight: 0,
                }}
              >
                <ILock size={10} />
              </button>
            )}
            {cont ? "⤷ " : ghost ? "↻ " : ""}{task.title}
          </span>
          {badge && (
            /* Elapsed against estimate. On the TITLE row rather than under it:
               that row is the one thing every card renders, however short, so
               a 30-minute block still reports its time — which the row below
               cannot promise. The pill's own background IS the progress bar (a
               gradient stop at `frac`), so the card gains a progress indicator
               without spending a row on one. Grey before the clock runs,
               accent while it does, warning tint once past the estimate. */
            <span
              title={badge.started
                ? `${badge.text} — elapsed against estimate${badge.over ? ", over" : ""}`
                : `Estimated ${badge.text.slice(1)}`}
              style={{
                flex: "none",
                fontFamily: "var(--font-mono)", fontSize: 9, lineHeight: "13px",
                padding: "0 4px", borderRadius: 7, whiteSpace: "nowrap",
                border: `1px solid ${solid
                  ? "color-mix(in srgb, var(--on-accent) 35%, transparent)"
                  : badge.over ? "var(--st-paused)" : "var(--color-divider)"}`,
                color: solid ? "var(--on-accent)" : badge.over ? "var(--st-paused)" : "var(--color-text-2)",
                background: badge.frac === null || badge.frac === 0
                  ? "transparent"
                  : `linear-gradient(to right, ${solid
                      ? "color-mix(in srgb, var(--on-accent) 22%, transparent)"
                      : badge.over
                        ? "color-mix(in srgb, var(--st-paused) 20%, transparent)"
                        : "var(--accent-wash)"} ${badge.frac * 100}%, transparent ${badge.frac * 100}%)`,
              }}
            >
              {badge.text}
            </span>
          )}
          {!ghost && <Prio p={task.priority} />}
        </div>
        {/* Height pinned to META_ROW, for the same reason as the title row. */}
        <div style={{
          height: 13, lineHeight: "13px", whiteSpace: "nowrap",
          fontSize: 10, color: solid ? "color-mix(in srgb, var(--on-accent) 78%, transparent)" : "var(--color-text-2)",
        }}>
          {clock(start)} – {clock(end)}
        </div>

        {detailLines > 0 && (
          /* The write-up itself. `pre-line` keeps the author's line breaks so a
             checklist still reads as a checklist, and the clamp is set to the
             number of lines the block was measured to hold — so the text ends
             in an ellipsis at the card's edge rather than being sliced through
             the middle of a glyph by `overflow: hidden`. */
          <div
            style={{
              marginTop: 2,
              fontSize: 10.5, lineHeight: "13px",
              whiteSpace: "pre-line", overflow: "hidden", wordBreak: "break-word",
              display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: detailLines,
              color: solid ? "color-mix(in srgb, var(--on-accent) 82%, transparent)" : "var(--color-text-2)",
              opacity: done ? 0.8 : 1,
            }}
          >
            {detail}
          </div>
        )}
      </div>
      {!ghost && !cont && !task.locked && (
        <div
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          title="Drag to resize (15-minute steps)"
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 7, cursor: "ns-resize", touchAction: "none" }}
        />
      )}
    </div>
  );
}
