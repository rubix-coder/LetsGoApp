import { useState } from "react";
import { useStore } from "../../lib/store";
import { useMobile } from "../../lib/router";
import { useEditor } from "../../App";
import type { Task } from "../../lib/types";
import { BP } from "../../components/ui";
import { IChevronL, IChevronR } from "../../components/Icons";
import { addDays, at, fmtDayMed, fmtMonth, fmtTime, sameDay, startOfDay } from "../../lib/dates";
import { repeatOccursOn } from "../../lib/mdTasks";
import { occurrenceStatusOf } from "../../lib/occurrence";
import { eventsOnDay, isAllDayEvent } from "../../lib/dayEvents";
import { DayNotch } from "../../components/DayNotch";
import { beginTouchDrag, hitData } from "../../lib/touchDrag";

function monthStart(t: number): number {
  const d = new Date(t);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function shiftMonth(t: number, n: number): number {
  const d = new Date(t);
  d.setMonth(d.getMonth() + n);
  return monthStart(d.getTime());
}

export function Calendar() {
  const { state, dispatch } = useStore();
  const { openTask } = useEditor();
  const mobile = useMobile();
  const [month, setMonth] = useState(() => monthStart(Date.now()));
  const [selected, setSelected] = useState(() => startOfDay(Date.now()));
  // Desktop: the day whose "+n more" is being hovered — expands into a
  // floating panel listing every task, anchored over the (overflow-clipped) cell.
  const [expanded, setExpanded] = useState<{ day: number; left: number; top: number; width: number } | null>(null);

  const weekStart = state.settings.weekStart;
  const gridStart = addDays(month, -((new Date(month).getDay() - weekStart + 7) % 7));
  const cells = [...Array(42)].map((_, i) => addDays(gridStart, i));
  const today = startOfDay(Date.now());
  // All-day events are excluded here and rendered as day notches instead: they
  // have no start time, so a chip in the task stream would both misstate them
  // and crowd out the day's real work.
  const scheduled = state.tasks.filter((t) => t.scheduledAt !== undefined && !isAllDayEvent(t));
  const tasksOn = (day: number) =>
    scheduled.filter((t) => sameDay(t.scheduledAt!, day)).sort((a, b) => a.scheduledAt! - b.scheduledAt!);
  /** Routine occurrences beyond the anchor day — rendered as ghost chips. */
  const ghostsOn = (day: number) =>
    scheduled.filter((t) => t.repeat && !sameDay(t.scheduledAt!, day) && repeatOccursOn(t.scheduledAt!, t.repeat, day));
  const weekdayLabels = (short: boolean) => {
    const names = short ? ["S", "M", "T", "W", "T", "F", "S"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return [...names.slice(weekStart), ...names.slice(0, weekStart)];
  };

  const toolbar = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: mobile ? "0 16px 10px" : "10px 22px", borderBottom: mobile ? "none" : "1px solid var(--color-divider)" }}>
      <button className="btn btn-icon btn-secondary" style={{ width: 30, height: 30 }} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
        <IChevronL size={15} strokeWidth={1.6} />
      </button>
      <span style={{ fontSize: 18, fontFamily: "var(--font-heading)", fontWeight: 600, minWidth: 120, textAlign: "center" }}>{fmtMonth(month)}</span>
      <button className="btn btn-icon btn-secondary" style={{ width: 30, height: 30 }} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
        <IChevronR size={15} strokeWidth={1.6} />
      </button>
      <button className="btn btn-secondary" style={{ padding: "5px 12px", fontSize: 13 }} onClick={() => { setMonth(monthStart(Date.now())); setSelected(today); }}>Today</button>
    </div>
  );

  if (mobile) {
    // Mobile month/day view: routines appear on every occurrence day (desktop
    // grid parity — they were invisible past their anchor day here), each day
    // carrying its own per-day status.
    const dayTasks = tasksOn(selected);
    const dayGhosts = ghostsOn(selected);
    const dayCount = dayTasks.length + dayGhosts.length;
    const selectedEvents = eventsOnDay(state.tasks, selected);
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {toolbar}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "0 12px 4px" }}>
          {weekdayLabels(true).map((d, i) => (
            <div key={i} className="cap" style={{ textAlign: "center", fontSize: 9 }}>{d}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, padding: "0 12px 12px", borderBottom: "1px solid var(--color-divider)" }}>
          {cells.map((day) => {
            const inMonth = new Date(day).getMonth() === new Date(month).getMonth();
            const dt = tasksOn(day);
            const isToday = sameDay(day, today);
            const isSel = sameDay(day, selected);
            const dayEvents = eventsOnDay(state.tasks, day);
            const statuses = [
              ...dt.map((t) => (t.repeat ? occurrenceStatusOf(t, day) : t.status)),
              ...ghostsOn(day).map((t) => occurrenceStatusOf(t, day)),
            ];
            const allDone = statuses.length > 0 && statuses.every((s) => s === "done");
            return (
              <button
                key={day}
                data-cal-day={day}
                onClick={() => setSelected(day)}
                style={{
                  textAlign: "center", padding: "7px 0", fontSize: 12, position: "relative",
                  border: isSel && !isToday ? "1px solid var(--color-accent)" : "none",
                  cursor: "pointer",
                  background: isToday ? "var(--color-accent)" : "none",
                  color: isToday ? "var(--on-accent)" : inMonth ? "var(--color-text)" : "var(--color-text-3)",
                  fontWeight: isToday ? 700 : 400, fontFamily: "var(--font-body)",
                }}
              >
                {new Date(day).getDate()}
                {/* A day cell here is far too small for a notch, so the event's
                    emoji takes the marker slot — it is a strictly stronger
                    signal than the task dot, and tapping the day reveals both
                    in the list below. */}
                {dayEvents.length > 0 ? (
                  <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 0, fontSize: 9, lineHeight: 1 }}>
                    {dayEvents[0].emoji}
                  </span>
                ) : statuses.length > 0 && !isToday ? (
                  <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 2, width: 4, height: 4, borderRadius: "50%", background: allDone ? "var(--color-text-3)" : "var(--color-accent)" }} />
                ) : null}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 16px" }}>
          <div className="cap" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <span>{fmtDayMed(selected)} · {dayCount} task{dayCount === 1 ? "" : "s"}</span>
            <DayNotch events={selectedEvents} />
          </div>
          {selectedEvents.map((event) => (
            <button
              key={`ev-${event.task.id}`}
              onClick={() => openTask(event.task.id)}
              style={{
                marginBottom: 8, width: "100%", textAlign: "left", cursor: "pointer",
                background: "var(--event-tint)", border: "1px solid var(--event-edge)", color: "var(--event-ink)",
                borderRadius: "var(--radius)", padding: "9px 11px",
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              <span aria-hidden="true">{event.emoji}</span>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{event.title}</span>
              <span style={{ fontSize: 11, opacity: 0.75 }}>
                All day{event.repeatLabel ? ` · ${event.repeatLabel}` : ""}
              </span>
            </button>
          ))}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dayTasks.map((t) => {
              const status = t.repeat ? occurrenceStatusOf(t, selected) : t.status;
              const active = status === "in_progress";
              return (
                <BP
                  key={t.id}
                  style={{ background: active ? "var(--color-accent)" : "var(--color-card)", borderColor: active ? "var(--accent-strong)" : undefined, padding: "9px 11px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                  onClick={() => openTask(t.id)}
                  onPointerDown={(e: React.PointerEvent) => {
                    if (t.locked) return;
                    // Long-press a day row, drop on a month-strip day above.
                    beginTouchDrag(e, {
                      label: t.title,
                      onDrop: (x, y) => {
                        const hit = hitData(x, y, "data-cal-day");
                        if (!hit) return;
                        const prev = t.scheduledAt! - startOfDay(t.scheduledAt!);
                        dispatch({ type: "scheduleTask", id: t.id, at: Number(hit.value) + prev });
                      },
                    });
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: active ? "var(--on-accent)" : undefined, textDecoration: status === "done" ? "line-through" : undefined }}>{t.title}</span>
                  <span style={{ fontSize: 11, color: active ? "color-mix(in srgb, var(--on-accent) 78%, transparent)" : "var(--color-text-2)" }}>{fmtTime(t.scheduledAt!)}</span>
                </BP>
              );
            })}
            {dayGhosts.map((t) => {
              const status = occurrenceStatusOf(t, selected);
              const active = status === "in_progress";
              return (
                <BP
                  key={`g-${t.id}`}
                  style={{ background: active ? "var(--color-accent)" : "var(--color-card)", borderStyle: active ? "solid" : "dashed", borderColor: active ? "var(--accent-strong)" : "var(--accent-mid)", opacity: active ? 1 : 0.85, padding: "9px 11px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                  onClick={() => openTask(t.id)}
                >
                  <span style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: active ? "var(--on-accent)" : undefined, textDecoration: status === "done" ? "line-through" : undefined }}>↻ {t.title}</span>
                  <span style={{ fontSize: 11, color: active ? "color-mix(in srgb, var(--on-accent) 78%, transparent)" : "var(--color-text-2)" }}>{fmtTime(selected + (t.scheduledAt! - startOfDay(t.scheduledAt!)))}</span>
                </BP>
              );
            })}
            {dayCount === 0 && (
              <button className="btn btn-secondary" onClick={() => openTask(null, { scheduledAt: at(selected, 9) })}>Schedule something here</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {toolbar}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--color-divider)" }}>
        {weekdayLabels(false).map((d) => (
          <div key={d} className="cap" style={{ textAlign: "center", padding: "8px 0" }}>{d}</div>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridTemplateRows: "repeat(6, 1fr)", gap: 1, background: "var(--color-divider)", overflow: "hidden" }}>
        {cells.map((day) => {
          const inMonth = new Date(day).getMonth() === new Date(month).getMonth();
          const isToday = sameDay(day, today);
          const dt = tasksOn(day);
          const shown = dt.slice(0, 3);
          return (
            <div
              key={day}
              data-cal-day={day}
              style={{
                background: isToday ? "color-mix(in srgb, var(--color-accent) 6%, var(--color-bg))" : "var(--color-bg)",
                outline: isToday ? "1.5px solid var(--color-accent)" : undefined, outlineOffset: -1.5,
                padding: "6px 7px", display: "flex", flexDirection: "column", gap: 3, minWidth: 0, overflow: "hidden", cursor: "pointer",
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("text/task-id");
                const task = state.tasks.find((t) => t.id === id);
                if (task) {
                  const prev = task.scheduledAt ? task.scheduledAt - startOfDay(task.scheduledAt) : 9 * 3_600_000;
                  dispatch({ type: "scheduleTask", id, at: day + prev });
                }
              }}
              onClick={(e) => { if (e.target === e.currentTarget) openTask(null, { scheduledAt: at(day, 9) }); }}
              onMouseEnter={() => { if (expanded && expanded.day !== day) setExpanded(null); }}
            >
              {isToday ? (
                <span style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 700, color: "var(--on-accent)", background: "var(--color-accent)", width: 20, height: 20, display: "grid", placeItems: "center" }}>
                  {new Date(day).getDate()}
                </span>
              ) : (
                <span style={{ fontSize: 12, fontWeight: inMonth ? 600 : 400, color: inMonth ? undefined : "var(--color-text-3)" }}>{new Date(day).getDate()}</span>
              )}
              <DayNotch events={eventsOnDay(state.tasks, day)} />
              {shown.map((t) => <Chip key={t.id} task={t} day={day} />)}
              {ghostsOn(day).slice(0, Math.max(0, 3 - shown.length)).map((t) => <Chip key={`g-${t.id}`} task={t} day={day} ghost />)}
              {dt.length > 3 && (
                <button
                  onMouseEnter={(e) => {
                    const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                    setExpanded({ day, left: r.left, top: r.top, width: r.width });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ border: "none", background: "none", padding: 0, textAlign: "left", cursor: "pointer", fontSize: 10, color: "var(--color-text-2)" }}
                >
                  +{dt.length - 3} more
                </button>
              )}
            </div>
          );
        })}
      </div>
      {expanded && (() => {
        const dt = tasksOn(expanded.day);
        // Sized to cover the source cell so the pointer is already inside the
        // panel when it appears — leaving it is the single close gesture.
        const width = Math.max(expanded.width + 18, 232);
        const height = Math.min(320, 46 + dt.length * 23);
        const left = Math.max(6, Math.min(expanded.left - 9, window.innerWidth - width - 6));
        const top = Math.max(6, Math.min(expanded.top - 9, window.innerHeight - height - 6));
        return (
          <div
            onMouseLeave={() => setExpanded(null)}
            style={{
              position: "fixed", left, top, width, maxHeight: 320, zIndex: 40,
              background: "var(--color-bg)", border: "1px solid var(--color-divider)", boxShadow: "var(--shadow-md)",
              padding: "8px 9px", display: "flex", flexDirection: "column", gap: 3, overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, paddingBottom: 3 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{fmtDayMed(expanded.day)}</span>
              <span style={{ fontSize: 10.5, color: "var(--color-text-2)" }}>{dt.length} tasks</span>
            </div>
            {dt.map((t) => <Chip key={t.id} task={t} day={expanded.day} />)}
          </div>
        );
      })()}
    </div>
  );
}

function Chip({ task, day, ghost }: { task: Task; day: number; ghost?: boolean }) {
  const { dispatch } = useStore();
  const { openTask } = useEditor();
  // Routines show the chip's OWN day's status — ghosts included — so one
  // day's mark never repaints the rest of the month.
  const status = task.repeat ? occurrenceStatusOf(task, day) : task.status;
  const active = status === "in_progress";
  const paused = status === "paused";
  const done = status === "done";
  return (
    <span
      draggable={!ghost && !task.locked}
      onDragStart={(e) => e.dataTransfer.setData("text/task-id", task.id)}
      onPointerDown={(e) => {
        if (ghost || task.locked) return;
        // Touch: long-press a chip, drop on any `data-cal-day` cell (desktop
        // grid or the mobile month strip) — keeps the scheduled time-of-day.
        beginTouchDrag(e, {
          label: task.title,
          onDrop: (x, y) => {
            const hit = hitData(x, y, "data-cal-day");
            if (!hit) return;
            const prev = task.scheduledAt ? task.scheduledAt - startOfDay(task.scheduledAt) : 9 * 3_600_000;
            dispatch({ type: "scheduleTask", id: task.id, at: Number(hit.value) + prev });
          },
        });
      }}
      onClick={(e) => { e.stopPropagation(); openTask(task.id); }}
      title={ghost ? `${task.title} — repeats ${task.repeat?.unit}` : task.title}
      style={{
        fontSize: 10, padding: "2px 5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: ghost || task.locked ? "pointer" : "grab",
        background: active ? "var(--color-accent)" : paused ? "color-mix(in srgb, var(--st-paused) 16%, transparent)" : done ? "color-mix(in srgb, var(--color-text) 8%, transparent)" : ghost ? "transparent" : "var(--accent-soft)",
        border: ghost ? "1px dashed var(--accent-mid)" : paused ? "1px solid color-mix(in srgb, var(--st-paused) 50%, transparent)" : undefined,
        color: active ? "var(--on-accent)" : paused ? "var(--st-paused)" : done ? "var(--color-text-2)" : "var(--accent-deep)",
        textDecoration: done ? "line-through" : undefined,
        opacity: ghost ? 0.8 : 1,
      }}
    >
      {ghost ? "↻ " : ""}{task.title}
    </span>
  );
}
