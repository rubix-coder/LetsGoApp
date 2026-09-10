import { useEffect, useMemo, useState } from "react";
import { shouldAskDayStart, useStore } from "../lib/store";
import { useMobile } from "../lib/router";
import { DEFAULT_ESTIMATE_MINUTES, planDayStartOutcome } from "../lib/estimate";
import { fmtClockMin, fmtTime, startOfDay } from "../lib/dates";
import { Modal, StatusSq } from "../components/ui";
import { IClock, ILock } from "../components/Icons";
import { TimeField } from "../components/TimeField";

/* First open of the day: "when does today actually start?"

   You plan a 7:00 start, wake late, and open the app at 09:20 — the morning's
   tasks are now sitting in the past, dragging every downstream estimate out of
   date. Rather than making you re-drag them one by one, this asks for the real
   starting time once, then re-packs today's remaining UNLOCKED tasks from
   there, in their planned order. Locked tasks are appointments: they never
   move, and nothing is placed within the break either side of them.

   Asked once per day (the answer is recorded in the synced settings, so a
   second device does not ask again) and switchable off in Settings → Schedule. */

const MIN = 60_000;

/** Round up to the next 5-minute mark — "start at 09:22" is nobody's plan. */
function roundUpTo5(ms: number): number {
  return Math.ceil(ms / (5 * MIN)) * 5 * MIN;
}

export function DayStartPrompt() {
  const { state, dispatch, readOnly: viewer, team } = useStore();
  const mobile = useMobile();
  // "When does MY day start" re-packs the plan and records the answer in the
  // settings. In a shared team document both are collective, so one member
  // answering would move everyone's tasks and silence everyone's prompt.
  const readOnly = viewer || team !== undefined;
  const [asked, setAsked] = useState(false);
  const [startMin, setStartMin] = useState(() => {
    const rounded = roundUpTo5(Date.now());
    return Math.round((rounded - startOfDay(rounded)) / MIN);
  });

  // Decide once per mount. Re-checking on a clock tick would pop the modal
  // mid-session at midnight, on top of whatever the user was doing.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (asked || readOnly) return;
    setAsked(true);
    if (shouldAskDayStart(state, Date.now())) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, readOnly]);

  const fromMs = startOfDay(Date.now()) + startMin * MIN;

  // Live preview of the re-plan, so the choice is made with its consequences
  // visible rather than after the fact. When nothing moves it says WHY, which
  // is the whole difference between "already fits" and "every task today is a
  // locked appointment" — the second used to read as the dialog being broken.
  const outcome = useMemo(() => {
    if (!open) return null;
    const wh = state.settings.workHours;
    const win = wh.enabled && wh.endMin > wh.startMin ? { startMin: wh.startMin, endMin: wh.endMin } : undefined;
    return planDayStartOutcome(state.tasks, fromMs, state.settings.breakMin ?? 5, win);
  }, [open, fromMs, state.tasks, state.settings.workHours, state.settings.breakMin]);

  const preview = useMemo(() => {
    if (outcome?.kind !== "repacked") return null;
    const plan = outcome.plan;
    const moved = plan.tasks
      .filter((t) => {
        const before = state.tasks.find((x) => x.id === t.id);
        return before && before.scheduledAt !== t.scheduledAt && !state.tasks.some((c) => c.parentId === t.id);
      })
      .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
    return { plan, moved };
  }, [outcome, state.tasks]);

  if (!open) return null;

  const close = () => setOpen(false);
  const apply = () => { dispatch({ type: "dayStart", from: fromMs }); close(); };
  const skip = () => { dispatch({ type: "skipDayStart", day: Date.now() }); close(); };

  const nowMin = Math.round((roundUpTo5(Date.now()) - startOfDay(Date.now())) / MIN);

  /* Header and the action row stay put; only the middle scrolls. Without this
     the preview list pushes the buttons off a short phone viewport — and the
     buttons are the whole point of the dialog. */
  const body = (
    <>
      <div style={{ padding: mobile ? "16px 16px 0" : "20px 22px 0", display: "flex", flexDirection: "column", gap: 10, flex: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--accent-strong)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          <IClock size={14} />
          Good to see you
        </div>
        <div style={{ fontSize: mobile ? 20 : 17, fontWeight: 600 }}>When does today start?</div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: mobile ? 16 : "14px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, color: "var(--color-text-2)" }}>
          Today’s unlocked tasks re-pack from this time, in the order you planned them. Locked tasks stay exactly where
          they are, and nothing lands within {state.settings.breakMin ?? 5} minutes of one.
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <TimeField ariaLabel="Start the day at" width={130} fontSize={15} minutes={startMin} onChange={setStartMin} />
          <button
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: "3px 9px" }}
            onClick={() => setStartMin(nowMin)}
            title={`Right now — ${fmtClockMin(nowMin)}`}
          >
            Now
          </button>
          {[[6, 0], [7, 0], [8, 0], [9, 0]].map(([h, m]) => (
            <button
              key={h}
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: "3px 9px" }}
              onClick={() => setStartMin(h * 60 + m)}
            >
              {fmtClockMin(h * 60 + m)}
            </button>
          ))}
        </div>

        <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>
          {preview ? (
            <>
              <div style={{ fontSize: 12, color: "var(--color-text-2)", marginBottom: 8 }}>
                {preview.plan.movedCount} task{preview.plan.movedCount === 1 ? "" : "s"} would move
                {preview.plan.blockedBy && (
                  <>
                    {" "}· flowing around <ILock size={10} style={{ verticalAlign: -1 }} /> “{preview.plan.blockedBy.title}”
                  </>
                )}
              </div>
              {/* On a phone the whole dialog already scrolls, so a nested
                  scroller here would trap the gesture — let it grow instead. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: mobile ? undefined : 168, overflowY: mobile ? undefined : "auto" }}>
                {preview.moved.slice(0, 6).map((t) => {
                  const before = state.tasks.find((x) => x.id === t.id)!;
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: mobile ? 6 : 8, fontSize: 12 }}>
                      <StatusSq status={t.status} size={9} />
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                      <span style={{ color: "var(--color-text-3)", textDecoration: "line-through", flex: "none" }}>
                        {fmtTime(before.scheduledAt!)}
                      </span>
                      <span style={{ color: "var(--color-text-2)", flex: "none" }}>→</span>
                      <span style={{ fontWeight: 600, flex: "none" }}>{fmtTime(t.scheduledAt!)}</span>
                      {/* The duration is the first thing to give up when a
                          narrow screen runs out of room. */}
                      {!mobile && (
                        <span style={{ color: "var(--color-text-3)", flex: "none" }}>
                          {t.estimateMin ?? DEFAULT_ESTIMATE_MINUTES}m
                        </span>
                      )}
                    </div>
                  );
                })}
                {preview.moved.length > 6 && (
                  <div style={{ fontSize: 12, color: "var(--color-text-3)" }}>+{preview.moved.length - 6} more</div>
                )}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--color-text-2)" }}>
              {outcome?.kind === "pinned" ? (
                <>
                  <ILock size={11} style={{ verticalAlign: -1 }} /> Nothing re-packs: everything left today is
                  {outcome.locked.length ? ` locked (${outcome.locked.map((t) => `“${t.title}”`).join(", ")})` : ""}
                  {outcome.locked.length && outcome.routines.length ? " or" : ""}
                  {outcome.routines.length ? " a repeating routine" : ""}, and both stay exactly where they are.
                  Your {fmtClockMin(startMin)} start is still recorded — unlock a task to have it flow from there.
                </>
              ) : outcome?.kind === "empty" ? (
                <>Nothing is scheduled for today yet, so there is nothing to re-pack — the {fmtClockMin(startMin)} start
                is still recorded.</>
              ) : (
                <>Nothing needs moving for a {fmtClockMin(startMin)} start — today’s plan already fits.</>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: "none", display: "flex", gap: 8, padding: mobile ? "12px 16px" : "0 22px 20px", borderTop: mobile ? "1px solid var(--color-divider)" : undefined }}>
        <button className="btn btn-secondary" style={{ flex: 1, height: mobile ? 44 : undefined }} onClick={skip}>Keep my plan</button>
        {/* Never disabled. Answering the question is the point; whether any
            task happens to move is a consequence, not a precondition — and a
            day of locked appointments is exactly a day you may be starting
            late. The reducer records the answer either way. */}
        <button className="btn btn-primary" style={{ flex: 1, height: mobile ? 44 : undefined }} onClick={apply}>
          Start at {fmtClockMin(startMin)}
        </button>
      </div>
    </>
  );

  // Full-screen sheet on a phone, centred dialog on a desktop — the same
  // split TaskEditor uses for a dialog with this much in it.
  if (mobile) return <div className="sheet">{body}</div>;
  return <Modal onClose={skip} width={440}>{body}</Modal>;
}
