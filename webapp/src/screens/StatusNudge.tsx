import { useEffect, useRef, useState } from "react";
import { taskElapsedMin, useStore } from "../lib/store";
import { useNow } from "../lib/router";
import { notify } from "../lib/notify";
import { alertChime, playChime } from "../lib/sound";
import { Modal, StatusSq } from "../components/ui";
import { IClock } from "../components/Icons";
import { fmtMin } from "../lib/dates";

const DEFAULT_EVERY_MIN = 25;

/* App-root watcher: while a leaf, one-off task sits in `in_progress`, ping every
   N minutes (default 25) so its status stays honest — the antidote to a pile of
   half-finished tasks nobody closed out. Routines have their own per-day model
   and are left alone; pomodoro-mode runs already banner at their target, so a
   running pomodoro on the same task suppresses this. */
export function StatusNudge() {
  const { state, dispatch, readOnly } = useStore();
  const now = useNow(30_000);
  const nudged = useRef<Map<string, number>>(new Map());
  const [taskId, setTaskId] = useState<string | null>(null);

  const cfg = state.settings.statusNudge;
  const on = cfg?.enabled !== false && !readOnly;
  const everyMin = Math.max(1, cfg?.everyMin ?? DEFAULT_EVERY_MIN);

  useEffect(() => {
    if (!on || taskId) return;
    const parents = new Set(state.tasks.map((t) => t.parentId).filter(Boolean));
    for (const t of state.tasks) {
      if (t.repeat || parents.has(t.id) || t.status !== "in_progress" || t.startedAt === undefined) continue;
      if (state.timer.mode === "pomodoro" && state.timer.runningSince && state.timer.taskId === t.id) continue;
      const count = Math.floor((now - t.startedAt) / (everyMin * 60_000));
      if (count >= 1 && count > (nudged.current.get(t.id) ?? 0)) {
        nudged.current.set(t.id, count);
        setTaskId(t.id);
        if (document.visibilityState !== "visible") {
          if (state.settings.notifications) void notify("Time check", `Still working on "${t.title}"?`);
          if (state.settings.sounds) playChime(alertChime(state.settings.alertSound));
        }
        return;
      }
    }
  }, [now, state.tasks, state.timer, on, everyMin]);

  // The task backing an open prompt vanished, or moved off in_progress elsewhere.
  const task = state.tasks.find((t) => t.id === taskId);
  useEffect(() => {
    if (taskId && (!task || task.status !== "in_progress")) setTaskId(null);
  }, [taskId, task]);

  if (!taskId || !task) return null;

  const close = () => setTaskId(null);
  // Time WORKED on the task, not wall-clock since the last resume: `startedAt`
  // is reset on every re-entry to in_progress, so the old figure under-reported
  // a task that had been paused and picked back up, and disagreed with the
  // elapsed badge on the very card the prompt is about.
  const onMin = fmtMin(taskElapsedMin(state, task, now));
  const setStatus = (status: "paused" | "done") => { dispatch({ type: "setStatus", id: task.id, status }); close(); };

  return (
    <Modal onClose={close} width={380}>
      <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--accent-strong)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          <IClock size={14} />
          Time check
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusSq status={task.status} size={11} />
          <span style={{ fontSize: 17, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--color-text-2)" }}>
          {onMin} on this so far. Still your focus, or has it moved on?
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStatus("paused")}>Pause</button>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStatus("done")}>Mark done</button>
        </div>
        <button className="btn btn-primary" onClick={close}>Still on it</button>
      </div>
    </Modal>
  );
}
