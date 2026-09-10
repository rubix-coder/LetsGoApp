import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import type { Task, TaskStatus } from "../lib/types";
import { IKebab, ILock, IPause, IPlay, IUnlock } from "./Icons";

/* The desktop's "⋯" options menu (0.27): change status without opening the
   editor, from any card/row. Status entries hide when the task is already
   in that state; parents hide them entirely (status is derived).

   Scheduling lock lives here too, so freezing or releasing a task's times is a
   two-click job from every board view — it used to be reachable only through
   the list view's bulk-edit bar, which meant selecting a task in one specific
   view just to undo a lock you set somewhere else. */

const ACTION_LABEL: Record<TaskStatus, string> = {
  pending: "Reopen",
  in_progress: "Move to in progress",
  paused: "Pause",
  done: "Mark done",
  skipped: "Skip",
};

export function StatusMenu({ task, light }: { task: Task; light?: boolean }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isParent = state.tasks.some((t) => t.parentId === task.id);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const entries: TaskStatus[] = (["in_progress", "done", "skipped", "pending"] as TaskStatus[])
    .filter((s) => s !== task.status && (s !== "pending" || task.status === "done" || task.status === "skipped"))
    // A paused task's "Resume" button already covers going back to in progress.
    .filter((s) => !(task.status === "paused" && s === "in_progress"));

  return (
    <div ref={ref} style={{ position: "relative", flex: "none" }} onClick={(e) => e.stopPropagation()}>
      <button
        aria-label={`Options for ${task.title}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{
          border: "none", background: "none", cursor: "pointer", padding: "2px 1px", display: "flex",
          color: light ? "color-mix(in srgb, var(--on-accent) 75%, transparent)" : "var(--color-text-3)",
        }}
      >
        <IKebab size={14} />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", right: 0, top: "100%", zIndex: 40, minWidth: 172,
            background: "var(--color-bg)", border: "1px solid var(--color-divider)", boxShadow: "var(--shadow-md)",
            display: "flex", flexDirection: "column", padding: "4px 0",
          }}
        >
          {/* Pause / Resume — the "quick errand" hold. Keeps the elapsed time;
              the timer freezes and continues on resume (lib/store.tsx). */}
          {!isParent && task.status === "in_progress" && (
            <button
              role="menuitem"
              onClick={() => { dispatch({ type: "setStatus", id: task.id, status: "paused" }); setOpen(false); }}
              style={{ border: "none", background: "none", cursor: "pointer", textAlign: "left", padding: "7px 12px", fontSize: 13, color: "var(--color-text)", fontFamily: "var(--font-body)", display: "flex", alignItems: "center", gap: 8 }}
            >
              <IPause size={13} /> Pause
            </button>
          )}
          {!isParent && task.status === "paused" && (
            <button
              role="menuitem"
              onClick={() => { dispatch({ type: "setStatus", id: task.id, status: "in_progress" }); setOpen(false); }}
              style={{ border: "none", background: "none", cursor: "pointer", textAlign: "left", padding: "7px 12px", fontSize: 13, color: "var(--color-text)", fontFamily: "var(--font-body)", display: "flex", alignItems: "center", gap: 8 }}
            >
              <IPlay size={13} /> Resume
            </button>
          )}
          {!isParent && entries.map((s) => (
            <button
              key={s}
              role="menuitem"
              onClick={() => { dispatch({ type: "setStatus", id: task.id, status: s }); setOpen(false); }}
              style={{ border: "none", background: "none", cursor: "pointer", textAlign: "left", padding: "7px 12px", fontSize: 13, color: "var(--color-text)", fontFamily: "var(--font-body)" }}
            >
              {ACTION_LABEL[s]}
            </button>
          ))}
          {!isParent && <span style={{ height: 1, background: "var(--color-divider)", margin: "4px 0" }} />}
          <button
            role="menuitem"
            title={task.locked
              ? "Release the times so drags, re-packs and the day-start re-plan can move this task again"
              : "Freeze this task's times — nothing auto-scheduled will move it, or be placed within 5 minutes of it"}
            onClick={() => { dispatch({ type: "upsertTask", task: { ...task, locked: !task.locked } }); setOpen(false); }}
            style={{ border: "none", background: "none", cursor: "pointer", textAlign: "left", padding: "7px 12px", fontSize: 13, color: "var(--color-text)", fontFamily: "var(--font-body)", display: "flex", alignItems: "center", gap: 8 }}
          >
            {task.locked ? <IUnlock size={13} /> : <ILock size={13} />}
            {task.locked ? "Unlock scheduling" : "Lock scheduling"}
          </button>
          <span style={{ height: 1, background: "var(--color-divider)", margin: "4px 0" }} />
          <button
            role="menuitem"
            onClick={() => { dispatch({ type: "deleteTask", id: task.id }); setOpen(false); }}
            style={{ border: "none", background: "none", cursor: "pointer", textAlign: "left", padding: "7px 12px", fontSize: 13, color: "var(--prio-hi-text)", fontFamily: "var(--font-body)" }}
          >
            Delete{isParent ? " (with subtasks)" : ""}
          </button>
        </div>
      )}
    </div>
  );
}
