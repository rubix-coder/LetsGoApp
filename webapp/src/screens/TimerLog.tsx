import { useStore } from "../lib/store";
import { groupSessionsByDay, sessionKind } from "../lib/sessionLog";
import { fmtDayMed, fmtMin } from "../lib/dates";
import { ITrash } from "../components/Icons";

/* The full session history behind the dashboard's "Tracked" figure: worked time
   and logged breaks, per day, so a run that was really half wandering reads as
   what it was. A bad row can be deleted — a focus row also refunds its minutes
   to the task it was logged against. */
export function TimerLog() {
  const { state, dispatch, readOnly } = useStore();
  const days = groupSessionsByDay(state.sessions);

  if (days.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--color-text-2)", padding: "16px 18px" }}>No sessions logged yet — start the timer to fill this in.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", overflowY: "auto", minHeight: 0 }}>
      {days.map((d) => (
        <div key={d.day}>
          <div style={{ padding: "12px 18px 6px", display: "flex", alignItems: "baseline", justifyContent: "space-between", position: "sticky", top: 0, background: "var(--color-bg)" }}>
            <span className="cap" style={{ fontSize: 11 }}>{fmtDayMed(d.day)}</span>
            <span style={{ fontSize: 11, color: "var(--color-text-3)", fontFamily: "var(--font-mono)" }}>
              {fmtMin(d.focusMin)} worked{d.pauseMin > 0 ? ` · ${fmtMin(d.pauseMin)} paused` : ""}
            </span>
          </div>
          {d.rows.map((s) => {
            const pause = sessionKind(s) === "pause";
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: pause ? "6px 18px 6px 30px" : "7px 18px", borderBottom: "1px solid var(--color-divider)" }}>
                <span style={{ flex: "none", width: 6, height: 6, borderRadius: "50%", background: pause ? "transparent" : "var(--color-accent)", border: pause ? "1px solid var(--color-text-3)" : undefined }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: pause ? 12 : 13, color: pause ? "var(--color-text-2)" : undefined }}>
                  {pause ? `⏸ stepped away · ${s.label}` : s.label}
                </span>
                <span style={{ fontSize: 12, color: "var(--color-text-3)", fontFamily: "var(--font-mono)" }}>{fmtMin(s.minutes)}</span>
                {!readOnly && (
                  <button
                    className="btn btn-icon btn-ghost"
                    style={{ width: 22, height: 22, color: "var(--color-text-3)" }}
                    aria-label={`Delete ${s.label} session`}
                    onClick={() => dispatch({ type: "sessionDelete", id: s.id })}
                  >
                    <ITrash size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
