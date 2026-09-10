import { useState } from "react";
import { elapsedSec, sessionKind, useStore } from "../lib/store";
import { nav, useMobile, useNow } from "../lib/router";
import { useStickyView } from "../lib/viewMemory";
import { ensurePermission } from "../lib/notify";
import type { QuickTimer, TimerMode } from "../lib/types";
import { BP, Seg } from "../components/ui";
import { ClockDisplay } from "../components/ClockFace";
import { ICheck, IFocus, IPause, IPlay, IReset, IX } from "../components/Icons";
import { MobileHeader } from "../shell/AppShell";
import { TimerLog } from "./TimerLog";
import { fmtClock, fmtMin, sameDay } from "../lib/dates";
import { DURATION_HINT, fmtDuration, parseDurationToSeconds } from "../lib/duration";

/** Focus ring + dot-matrix readout. The ring still carries the information
    (fraction of the target elapsed); the face is the LED panel. */
export function Dial({ size, running }: { size: number; running: boolean }) {
  const { state } = useStore();
  const now = useNow(500);
  const t = state.timer;
  const estTask = state.tasks.find((x) => x.id === t.taskId);
  const elapsed = elapsedSec(t, now);
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const frac = t.mode === "stopwatch" ? 0 : Math.min(1, elapsed / t.targetSec);
  const overtime = t.mode !== "stopwatch" && elapsed > t.targetSec;
  const display = t.mode === "stopwatch" ? elapsed : Math.abs(t.targetSec - elapsed);
  const text = overtime ? `+${fmtClock(display)}` : fmtClock(display);
  // Readout spans ~62% of the dial so it clears the ring; the face fits itself.
  const faceSize = Math.round(size * 0.62);

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <defs>
          <linearGradient id="lgTimerGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent-grad-a)" />
            <stop offset="100%" stopColor="var(--accent-grad-b)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-divider)" strokeWidth={2} />
        {t.mode !== "stopwatch" && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={overtime ? "var(--st-pending)" : "url(#lgTimerGrad)"} strokeWidth={6}
            strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <ClockDisplay
          text={text}
          size={faceSize}
          color={overtime ? "var(--st-pending)" : "var(--color-accent)"}
          label={`${text} ${t.mode === "stopwatch" ? "elapsed" : overtime ? "over" : "left"}`}
        />
        <span className="cap" style={{ fontSize: 11 }}>
          {t.mode === "stopwatch"
            ? "stopwatch"
            : `of ${fmtClock(t.targetSec)} · ${t.mode === "countdown" && estTask?.estimateMin ? "task estimate" : t.mode}`}
        </span>
      </div>
      {running && <span style={{ position: "absolute", top: 6, left: "50%", transform: "translateX(-50%)", width: 6, height: 6, background: "var(--color-accent)", borderRadius: "50%" }} />}
    </div>
  );
}

export function Controls({ size = 1 }: { size?: number }) {
  const { state, dispatch } = useStore();
  const running = state.timer.runningSince !== undefined;
  const s = (px: number) => Math.round(px * size);
  return (
    <div style={{ display: "flex", gap: s(12) }}>
      <button className="btn btn-icon btn-secondary" style={{ width: s(48), height: s(48) }} aria-label="Reset" onClick={() => dispatch({ type: "timerReset" })}>
        <IReset size={s(20)} strokeWidth={1.6} />
      </button>
      <button
        className="btn btn-icon btn-primary"
        style={{ width: s(60), height: s(60) }}
        aria-label={running ? "Pause" : "Start"}
        onClick={() => {
          if (running) dispatch({ type: "timerPause" });
          else { void ensurePermission(); dispatch({ type: "timerStart" }); }
        }}
      >
        {running ? <IPause size={s(24)} /> : <IPlay size={s(22)} />}
      </button>
      <button className="btn btn-icon btn-secondary" style={{ width: s(48), height: s(48) }} aria-label="Complete session" onClick={() => dispatch({ type: "timerComplete" })}>
        <ICheck size={s(20)} strokeWidth={1.8} />
      </button>
    </div>
  );
}

function TaskPicker() {
  const { state, dispatch } = useStore();
  const candidates = state.tasks.filter((t) => t.status === "in_progress" || t.status === "pending");
  return (
    <select
      aria-label="Task to focus on"
      className="input"
      style={{ maxWidth: 320, textAlign: "center", fontSize: 16, fontWeight: 500, background: "transparent", borderColor: "transparent", cursor: "pointer" }}
      value={state.timer.taskId ?? ""}
      onChange={(e) => dispatch({ type: "timerStart", taskId: e.target.value || undefined })}
    >
      <option value="">— pick a task —</option>
      {candidates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
    </select>
  );
}

function SessionLog() {
  const { state } = useStore();
  const now = useNow(30_000);
  const todays = state.sessions.filter((s) => sameDay(s.startedAt, now));
  // Held time counts whether the clock is running or paused — a pause freezes
  // the count, it does not discard it, so today's total must not dip when the
  // away-guard pauses for you.
  const runningMin = elapsedSec(state.timer, now) / 60;
  // Worked time only — a logged break is not focus.
  const total = todays.reduce((sum, s) => sum + (sessionKind(s) === "pause" ? 0 : s.minutes), 0) + runningMin;
  const runningTask = state.tasks.find((t) => t.id === state.timer.taskId);

  return (
    <>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-divider)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="cap" style={{ fontSize: 11 }}>Today</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent-strong)", fontFamily: "var(--font-mono)" }}>{fmtMin(total)}</span>
      </div>
      <div style={{ padding: "10px 18px", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        {state.timer.runningSince && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--color-divider)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-accent)" }} />
            <span style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{runningTask?.title ?? "Untimed focus"}</span>
            <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>running</span>
          </div>
        )}
        {[...todays].reverse().map((s) => {
          const pause = sessionKind(s) === "pause";
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--color-divider)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", border: "1px solid var(--color-text-3)" }} />
              <span style={{ flex: 1, fontSize: 13, color: "color-mix(in srgb, var(--color-text) 72%, transparent)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pause ? `⏸ ${s.label}` : s.label}</span>
              <span style={{ fontSize: 12, color: "var(--color-text-3)", fontFamily: "var(--font-mono)" }}>{fmtMin(s.minutes)}</span>
            </div>
          );
        })}
        {todays.length === 0 && !state.timer.runningSince && (
          <p style={{ fontSize: 12, color: "var(--color-text-2)", padding: "10px 0" }}>No sessions yet — start the timer to log one.</p>
        )}
      </div>
    </>
  );
}

const PANEL_TABS = ["today", "log"] as const;

/** The side panel: today's running total and session list, or the full history
    log. The log has no route of its own, so the choice is remembered per
    device instead — it used to snap back to Today on every visit. */
function SidePanel() {
  const [tab, setTab] = useStickyView("lg:timerPanel", PANEL_TABS, "today");
  return (
    <>
      <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid var(--color-divider)" }}>
        <Seg
          ariaLabel="Timer panel"
          items={[{ id: "today", label: "Today" }, { id: "log", label: "Log" }]}
          active={tab}
          onSelect={(id) => setTab(id as "today" | "log")}
        />
      </div>
      {tab === "today" ? <SessionLog /> : <TimerLog />}
    </>
  );
}

/** Preset chips + a free-text duration field: "10s", "25m", "1h30m", or a
    plain number for minutes as before. The parse result is echoed under the
    box so the entry is confirmed before it starts. */
function QuickTimerLauncher() {
  const { dispatch } = useStore();
  const [durationText, setDurationText] = useState("");
  const customSec = parseDurationToSeconds(durationText);
  const invalid = durationText.trim() !== "" && customSec === null;
  const start = (sec: number) => {
    void ensurePermission();
    dispatch({ type: "quickTimerAdd", minutes: sec / 60, label: fmtDuration(sec) });
  };
  const startCustom = () => {
    if (customSec === null) return;
    start(customSec);
    setDurationText("");
  };
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
      {[5, 7, 10, 25].map((m) => (
        <button key={m} className="chip" style={{ marginTop: 2 }} onClick={() => start(m * 60)}>{m}m</button>
      ))}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
        <input
          className="input"
          style={{
            width: 96,
            height: 32,
            minHeight: 32,
            padding: "0 10px",
            fontSize: 13,
            borderColor: invalid ? "var(--st-pending)" : undefined,
          }}
          type="text"
          inputMode="text"
          placeholder="10s / 1h30m"
          aria-label="Custom timer duration"
          aria-invalid={invalid || undefined}
          aria-describedby="quickTimerDurationHint"
          value={durationText}
          onChange={(e) => setDurationText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") startCustom(); }}
        />
        <span
          id="quickTimerDurationHint"
          style={{ fontSize: 11, maxWidth: 190, color: invalid ? "var(--st-pending)" : "var(--color-text-3)" }}
        >
          {invalid ? DURATION_HINT : customSec === null ? "units: s, m, h" : `= ${fmtDuration(customSec)}`}
        </span>
      </div>
      <button className="chip" style={{ marginTop: 2 }} disabled={customSec === null} onClick={startCustom}>Start</button>
    </div>
  );
}

/** One running/paused/rung countdown as an LED card on the deck. */
function QuickTimerCard({ timer }: { timer: QuickTimer }) {
  const { dispatch } = useStore();
  const now = useNow(500);
  const remain = timer.endsAt !== undefined ? Math.max(0, Math.ceil((timer.endsAt - now) / 1000)) : Math.ceil(timer.remainSec ?? timer.totalSec);
  const rung = timer.endsAt !== undefined && remain <= 0;
  const running = timer.endsAt !== undefined && !rung;
  const color = rung ? "var(--st-pending)" : running ? "var(--color-accent)" : "var(--color-text-3)";
  const frac = Math.max(0, Math.min(1, remain / timer.totalSec));

  return (
    <BP style={{ background: "var(--color-card)", padding: "12px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 148 }}>
      <div style={{ alignSelf: "stretch", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: "none", width: 6, height: 6, borderRadius: "50%", background: color }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600 }}>{timer.label}</span>
        <button className="btn btn-icon btn-ghost" style={{ width: 22, height: 22, color: "var(--color-text-3)" }} aria-label={`Dismiss ${timer.label} timer`} onClick={() => dispatch({ type: "quickTimerRemove", id: timer.id })}>
          <IX size={12} />
        </button>
      </div>
      <ClockDisplay
        text={fmtClock(remain)}
        size={112}
        color={color}
        label={rung ? `${timer.label} finished` : `${fmtClock(remain)} left of ${timer.label}`}
      />
      <span aria-hidden style={{ alignSelf: "stretch", height: 2, background: "var(--color-divider)", position: "relative", overflow: "hidden" }}>
        <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${frac * 100}%`, background: color }} />
      </span>
      <button
        className="btn btn-secondary"
        style={{ height: 28, padding: "0 14px", fontSize: 12 }}
        aria-label={running ? `Pause ${timer.label} timer` : rung ? `Restart ${timer.label} timer` : `Resume ${timer.label} timer`}
        onClick={() => dispatch({ type: "quickTimerToggle", id: timer.id })}
      >
        {running ? <IPause size={12} /> : <IPlay size={11} />}
        {running ? "Pause" : rung ? "Restart" : "Resume"}
      </button>
    </BP>
  );
}

/** Every extra countdown lives on the main deck, beside the focus timer —
    not tucked into the side panel. */
function QuickTimerDeck() {
  const { state } = useStore();
  return (
    <div style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "0 20px" }}>
      <span className="cap" style={{ fontSize: 11 }}>Quick timers</span>
      <QuickTimerLauncher />
      {state.quickTimers.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, maxWidth: 560 }}>
          {state.quickTimers.map((t) => <QuickTimerCard key={t.id} timer={t} />)}
        </div>
      )}
    </div>
  );
}

function ModeSeg() {
  const { state, dispatch } = useStore();
  return (
    <Seg
      ariaLabel="Timer mode"
      items={[{ id: "pomodoro", label: "Pomodoro" }, { id: "countdown", label: "Countdown" }, { id: "stopwatch", label: "Stopwatch" }]}
      active={state.timer.mode}
      onSelect={(id) => dispatch({ type: "timerMode", mode: id as TimerMode })}
    />
  );
}

export function TimerScreen() {
  const { state } = useStore();
  const mobile = useMobile();
  const running = state.timer.runningSince !== undefined;

  const focusBtn = (
    <button className="btn btn-secondary" onClick={() => nav("/focus")}>
      <IFocus size={15} strokeWidth={1.6} />
      Focus mode
    </button>
  );

  const deck = (
    <>
      <span className="cap" style={{ fontSize: 11 }}>Focusing on</span>
      <div style={{ marginTop: -12 }}><TaskPicker /></div>
      <Dial size={mobile ? 230 : 250} running={running} />
      <Controls />
      <ModeSeg />
      <span aria-hidden style={{ alignSelf: "stretch", height: 1, background: "var(--color-divider)", margin: "4px 24px" }} />
      <QuickTimerDeck />
    </>
  );

  if (mobile) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <MobileHeader title="Timer" right={focusBtn} />
        <div className="gridbg" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, padding: "18px 16px 24px" }}>
          {deck}
        </div>
        <div style={{ borderTop: "1px solid var(--color-divider)" }}>
          <SidePanel />
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 22px", borderBottom: "1px solid var(--color-divider)" }}>
        <h3 style={{ fontSize: 22 }}>Timer</h3>
        <div style={{ marginLeft: "auto" }}>{focusBtn}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 300px" }}>
        <div className="gridbg" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, overflowY: "auto", padding: "24px 0" }}>
          {deck}
        </div>
        <div style={{ borderLeft: "1px solid var(--color-divider)", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <SidePanel />
        </div>
      </div>
    </div>
  );
}
