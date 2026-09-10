import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { useNow } from "../lib/router";
import { Modal, StatusSq } from "../components/ui";
import { IClock } from "../components/Icons";
import { fmtTime } from "../lib/dates";

type Prompt = { kind: "start" | "end"; taskId: string; key: string; scheduledAt: number; end: number };

/** Window used only to decide a start reminder is still fresh when a task has
    no estimate — a task whose whole slot already passed is not nagged. */
const DEFAULT_DUR_MIN = 60;

/* App-root watcher: once a scheduled task's start time arrives it offers to
   move the task to In progress or push the start later; once its scheduled
   end passes it offers to extend the estimate or mark it done. Fires for
   leaf, one-off tasks only
   (parents derive their status; routines have their own per-day model). One
   prompt shows at a time; a dismissed edge is remembered so it doesn't reopen
   until the task is rescheduled or extended. */
export function ScheduleAlerts() {
  const { state, dispatch, readOnly } = useStore();
  const now = useNow(15_000);
  const fired = useRef<Set<string>>(new Set());
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [extendMin, setExtendMin] = useState(15);
  const on = state.settings.scheduleReminders !== false;

  useEffect(() => {
    if (!on || readOnly || prompt) return;
    const parents = new Set(state.tasks.filter((t) => t.parentId).map((t) => t.parentId));
    for (const t of state.tasks) {
      if (t.scheduledAt === undefined || t.repeat || parents.has(t.id)) continue;
      const end = t.scheduledAt + Math.max(1, t.estimateMin ?? DEFAULT_DUR_MIN) * 60_000;
      if (t.status === "pending") {
        const key = `start:${t.id}:${t.scheduledAt}`;
        if (!fired.current.has(key) && now >= t.scheduledAt && now < end) {
          setPrompt({ kind: "start", taskId: t.id, key, scheduledAt: t.scheduledAt, end });
          return;
        }
      } else if (t.status === "in_progress" && t.estimateMin) {
        const key = `end:${t.id}:${end}`;
        if (!fired.current.has(key) && now >= end) {
          setPrompt({ kind: "end", taskId: t.id, key, scheduledAt: t.scheduledAt, end });
          return;
        }
      }
    }
  }, [now, state.tasks, on, readOnly, prompt]);

  // The task backing an open prompt got deleted — drop it.
  useEffect(() => {
    if (prompt && !state.tasks.some((t) => t.id === prompt.taskId)) setPrompt(null);
  }, [prompt, state.tasks]);

  if (!prompt) return null;
  const task = state.tasks.find((t) => t.id === prompt.taskId);
  if (!task) return null;

  const close = () => { setExtendMin(15); setPrompt(null); };
  const dismiss = () => { fired.current.add(prompt.key); close(); };
  const start = () => { dispatch({ type: "setStatus", id: task.id, status: "in_progress" }); close(); };
  const markDone = () => { dispatch({ type: "setStatus", id: task.id, status: "done" }); close(); };
  const extend = () => {
    fired.current.add(prompt.key);
    dispatch({ type: "upsertTask", task: { ...task, estimateMin: (task.estimateMin ?? DEFAULT_DUR_MIN) + extendMin }, repack: false });
    close();
  };
  // Not ready when the start bell rings: shove the whole slot X minutes out
  // (estimate preserved, so the end moves with it) and let it re-prompt then.
  const pushStart = () => {
    fired.current.add(prompt.key);
    dispatch({ type: "upsertTask", task: { ...task, scheduledAt: Date.now() + extendMin * 60_000 }, repack: false });
    close();
  };

  const starting = prompt.kind === "start";

  return (
    <Modal onClose={dismiss} width={400}>
      <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--accent-strong)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          <IClock size={14} />
          {starting ? "Time to start" : "Scheduled time's up"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusSq status={task.status} size={11} />
          <span style={{ fontSize: 17, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--color-text-2)" }}>
          {starting
            ? `Scheduled for ${fmtTime(prompt.scheduledAt)}. Start it now?`
            : `Planned ${fmtTime(prompt.scheduledAt)}–${fmtTime(prompt.end)}. Keep going or wrap up?`}
        </div>

        {starting ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number"
                className="input"
                min={5}
                step={5}
                value={extendMin}
                onChange={(e) => setExtendMin(Math.max(1, Math.round(Number(e.target.value) || 0)))}
                aria-label="Push start by minutes"
                style={{ width: 74 }}
              />
              <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>min later</span>
              <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                {[15, 30, 60].map((m) => (
                  <button key={m} className="btn btn-secondary" style={{ fontSize: 12, padding: "3px 9px" }} onClick={() => setExtendMin(m)}>+{m}</button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={pushStart}>Push +{extendMin}m</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={start}>Start now</button>
            </div>
            <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--color-text-2)", alignSelf: "center" }} onClick={dismiss}>Not now</button>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number"
                className="input"
                min={5}
                step={5}
                value={extendMin}
                onChange={(e) => setExtendMin(Math.max(1, Math.round(Number(e.target.value) || 0)))}
                aria-label="Extend by minutes"
                style={{ width: 74 }}
              />
              <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>min more</span>
              <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                {[15, 30, 60].map((m) => (
                  <button key={m} className="btn btn-secondary" style={{ fontSize: 12, padding: "3px 9px" }} onClick={() => setExtendMin(m)}>+{m}</button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={extend}>Extend +{extendMin}m</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={markDone}>Mark done</button>
            </div>
            <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--color-text-2)", alignSelf: "center" }} onClick={dismiss}>Remind me later</button>
          </>
        )}
      </div>
    </Modal>
  );
}
