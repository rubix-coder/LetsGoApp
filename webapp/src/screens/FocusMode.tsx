import { elapsedSec, useStore } from "../lib/store";
import { nav, useNow } from "../lib/router";
import { Controls, Dial } from "./TimerScreen";
import { IBack } from "../components/Icons";

/* Full-screen focus: always the dark ground, whatever the app theme. */
export function FocusMode() {
  const { state } = useStore();
  useNow(500);
  const t = state.timer;
  const task = state.tasks.find((x) => x.id === t.taskId);
  const running = t.runningSince !== undefined;
  const inCycle = t.pomodorosDone % 4;
  const currentFrac = t.mode === "pomodoro" ? Math.min(1, elapsedSec(t) / t.targetSec) : 0;

  return (
    <div data-theme="dark" style={{ position: "fixed", inset: 0, background: "var(--color-bg)", color: "var(--color-text)", display: "flex", flexDirection: "column", zIndex: 40 }}>
      <div className="gridbg" style={{ position: "absolute", inset: 0, backgroundSize: "34px 34px" }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px" }}>
        <button
          onClick={() => nav("/timer")}
          className="cap"
          style={{ background: "none", border: "none", color: "var(--color-text-2)", display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}
        >
          <IBack size={16} strokeWidth={1.6} />
          Exit focus
        </button>
        {t.mode === "pomodoro" && (
          <span className="cap" style={{ fontSize: 11 }}>Pomodoro {inCycle + 1} / 4</span>
        )}
      </div>
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26, padding: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <span className="cap" style={{ fontSize: 11 }}>Focusing on</span>
          <span style={{ fontSize: 19, fontWeight: 500 }}>{task?.title ?? "Untimed focus"}</span>
        </div>
        <Dial size={250} running={running} />
        <Controls size={1.08} />
      </div>
      {t.mode === "pomodoro" && (
        <div style={{ position: "relative", display: "flex", justifyContent: "center", gap: 8, padding: 18 }}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              style={{
                width: 26, height: 4,
                background: i < inCycle ? "var(--color-accent)" : i === inCycle && currentFrac > 0 ? "var(--color-accent)" : "var(--color-divider)",
                opacity: i === inCycle && currentFrac > 0 ? 0.5 : 1,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
