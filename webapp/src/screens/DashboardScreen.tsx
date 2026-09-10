import { useState } from "react";
import { elapsedSec, rootTasks, sessionKind, useStore } from "../lib/store";
import { nav, useMobile, useNow } from "../lib/router";
import { useEditor } from "../App";
import { BOOK_STATUS_LABEL, STATUS_LABEL, STATUS_VAR, type AppState, type Habit, type TaskStatus } from "../lib/types";
import { BP, Prio, Seg } from "../components/ui";
import { addDays, fmtMin, fmtTime, sameDay, startOfDay, streakDays } from "../lib/dates";
import { occurrenceDoneDays, occurrenceTask } from "../lib/occurrence";
import { goalProgress } from "../lib/goals";
import { readingStats } from "../lib/books";
import { completionStats, currentStreak, dueToday, isDoneOn } from "../lib/habits";
import { habitTargetOn } from "../lib/habitLink";
import { PanelGrid } from "../components/PanelGrid";
import { usePanelLayout } from "../lib/usePanelLayout";
import { useStickyView } from "../lib/viewMemory";
import type { PanelDef } from "../lib/panelLayout";

/** The dashboard's grid. Three columns is what the layout has always been;
    the row height is new — panels need a definite height before "drag it
    taller" can mean anything, and each one scrolls internally past it. */
const DASHBOARD_COLS = 3;
const PANEL_ROW_H = 132;

type Range = "week" | "month" | "year" | "all";
const RANGES: readonly Range[] = ["week", "month", "year", "all"];
const RANGE_LABEL: Record<Range, string> = { week: "this week", month: "this month", year: "this year", all: "all time" };

function rangeStart(range: Range, now: number, weekStart: number): number {
  const today = startOfDay(now);
  if (range === "week") return addDays(today, -((new Date(today).getDay() - weekStart + 7) % 7));
  if (range === "month") { const d = new Date(today); d.setDate(1); return d.getTime(); }
  if (range === "year") { const d = new Date(today); d.setMonth(0, 1); return d.getTime(); }
  return 0;
}

/* Donut segment order keeps the two CVD-closest statuses (done/skipped)
   non-adjacent — validated with the dataviz palette checker. */
const DONUT_ORDER: TaskStatus[] = ["done", "pending", "skipped", "in_progress", "paused"];

function bestStreak(days: number[]): number {
  const uniq = [...new Set(days.map(startOfDay))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < uniq.length; i++) {
    run = i > 0 && uniq[i] - uniq[i - 1] === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

export function DashboardScreen() {
  const { state } = useStore();
  const { openTask } = useEditor();
  const mobile = useMobile();
  const now = useNow(30_000);
  // Sticky per device: the range you read the dashboard through is a habit,
  // and resetting it to "week" on every visit made it one you had to repeat.
  const [range, setRange] = useStickyView("lg:dashboardRange", RANGES, "week");
  const since = rangeStart(range, now, state.settings.weekStart);

  // Routines read as today's occurrence, and their per-day done marks count
  // as completions (they never set completedAt).
  const tasksToday = state.tasks.map((t) => occurrenceTask(t, now));
  const occurrenceDones = state.tasks.flatMap(occurrenceDoneDays);
  const doneToday = state.tasks.filter((t) => t.completedAt && sameDay(t.completedAt, now)).length
    + occurrenceDones.filter((d) => sameDay(d, now)).length;
  const doneInRange = state.tasks.filter((t) => t.completedAt && t.completedAt >= since).length
    + occurrenceDones.filter((d) => d >= since).length;
  const dueToday = tasksToday.filter(
    (t) => t.status !== "done" && t.status !== "skipped" &&
      ((t.scheduledAt && sameDay(t.scheduledAt, now)) || (t.deadline && sameDay(t.deadline, now))),
  ).length;
  const planned = doneToday + dueToday;

  const rangeSessions = state.sessions.filter((s) => s.startedAt >= since && sessionKind(s) !== "pause");
  // Held time counts whether the clock is running or paused — a pause freezes
  // the count, it does not discard it, so today's total must not dip when the
  // away-guard pauses for you.
  const runningMin = elapsedSec(state.timer, now) / 60;
  const trackedMin = rangeSessions.reduce((sum, s) => sum + s.minutes, 0) + runningMin;
  const sessionCount = rangeSessions.length + (state.timer.runningSince ? 1 : 0);
  const pausedMin = state.sessions
    .filter((s) => s.startedAt >= since && sessionKind(s) === "pause")
    .reduce((sum, s) => sum + s.minutes, 0);

  const completionDays = [...state.tasks.filter((t) => t.completedAt).map((t) => t.completedAt!), ...occurrenceDones];
  const streak = streakDays(completionDays);
  const best = Math.max(streak, bestStreak(completionDays));

  const counts = Object.fromEntries(
    DONUT_ORDER.map((s) => [s, tasksToday.filter((t) => t.status === s).length]),
  ) as Record<TaskStatus, number>;

  const running = state.tasks.find((t) => t.id === state.timer.taskId && state.timer.runningSince);
  const upcoming = rootTasks(state)
    .map((t) => occurrenceTask(t, now))
    .filter((t) => t.status !== "done" && t.status !== "skipped" && t.id !== running?.id)
    .sort((a, b) => (a.scheduledAt ?? a.deadline ?? Infinity) - (b.scheduledAt ?? b.deadline ?? Infinity))
    .slice(0, running ? 2 : 3);
  const upNext = running ? [occurrenceTask(running, now), ...upcoming] : upcoming;

  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const leftToday = dueToday;

  const headerDate = new Date(now).toLocaleDateString("en-US", {
    weekday: mobile ? "short" : "long", month: "short", day: "numeric",
  });

  // Only panels with something to show: a card that renders null would still
  // hold its cell, leaving a hole nothing can fill.
  const defs: PanelDef[] = [
    { id: "completed", title: "Completed", w: 1, h: 1 },
    { id: "tracked", title: "Tracked", w: 1, h: 1 },
    { id: "streak", title: "Streak", w: 1, h: 1 },
    { id: "status", title: "Status breakdown", w: 1, h: 2, minH: 2 },
    { id: "week", title: "This week", w: 2, h: 2, minW: 2, minH: 2 },
    { id: "pattern", title: "Work pattern", w: 3, h: 2, minH: 2 },
    { id: "upnext", title: "Up next", w: 3, h: 2, minW: 2, minH: 2 },
    ...(hasHabits(state) ? [{ id: "habits", title: "Habits", w: 3, h: 2, minH: 2 } as PanelDef] : []),
    ...(hasReading(state) ? [{ id: "reading", title: "Reading", w: 3, h: 2, minH: 2 } as PanelDef] : []),
    ...(hasGoals(state) ? [{ id: "goals", title: "Goals", w: 3, h: 2, minH: 2 } as PanelDef] : []),
  ];
  const { layout, setLayout, reset, isDefault } = usePanelLayout("dashboard", defs, DASHBOARD_COLS);

  const kpi = (label: string, value: React.ReactNode, sub: string, color?: string) => (
    <BP style={{ background: "var(--color-card)", padding: mobile ? "12px 14px" : "16px 18px" }}>
      <div className="cap" style={{ fontSize: mobile ? 9 : 10 }}>{label}</div>
      <div style={{ font: `600 ${mobile ? 30 : 40}px var(--font-heading)`, lineHeight: 1.1, color }}>{value}</div>
      {!mobile && <div style={{ fontSize: 12, color: "var(--color-text-2)" }}>{sub}</div>}
    </BP>
  );

  const upNextCard = (
    <BP style={{ background: "var(--color-card)", padding: mobile ? "14px 16px" : 18, display: "flex", flexDirection: "column", gap: mobile ? 10 : 12 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="cap" style={{ fontSize: mobile ? 9 : 10 }}>Up next</div>
        <button onClick={() => nav("/todo/schedule")} style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent-strong)", border: "none", background: "none", cursor: "pointer" }}>
          Open planner &rarr;
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "repeat(3, 1fr)", gap: mobile ? 10 : 14 }}>
        {upNext.map((t) => {
          const isRunning = t.id === running?.id;
          const when = isRunning
            ? `now · ${fmtMin(t.loggedMin + runningMin)} in`
            : t.scheduledAt
              ? sameDay(t.scheduledAt, now) ? fmtTime(t.scheduledAt) : new Date(t.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ` · ${fmtTime(t.scheduledAt)}`
              : t.deadline ? `due ${fmtTime(t.deadline)}` : "unscheduled";
          return (
            <button
              key={t.id}
              onClick={() => openTask(t.id)}
              style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", border: "1px solid var(--color-divider)", borderLeft: `3px solid ${STATUS_VAR[t.status]}`, borderRadius: "var(--radius-card)", background: "none", cursor: "pointer", textAlign: "left", color: "var(--color-text)" }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                <span style={{ display: "block", fontSize: 11, color: "var(--color-text-2)", marginTop: 3 }}>{when}</span>
              </span>
              <Prio p={t.priority} />
            </button>
          );
        })}
        {upNext.length === 0 && <p style={{ fontSize: 13, color: "var(--color-text-2)" }}>All clear — nothing waiting.</p>}
      </div>
    </BP>
  );

  if (mobile) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--color-divider)" }}>
          <h3 style={{ fontSize: 20 }}>{headerDate}</h3>
          <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>{leftToday} task{leftToday === 1 ? "" : "s"} left today</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {kpi("Done today", doneToday, "", "var(--st-done)")}
            {kpi("Tracked", fmtMin(trackedMin), "", "var(--accent-strong)")}
          </div>
          <BP style={{ background: "var(--color-card)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 16 }}>
            <Donut counts={counts} size={86} />
            <DonutLegend counts={counts} compact />
          </BP>
          {upNextCard}
          <Habits mobile />
          <Reading mobile />
          <Goals mobile />
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, padding: "16px 26px", borderBottom: "1px solid var(--color-divider)" }}>
        <h3 style={{ fontSize: 24 }}>{headerDate}</h3>
        <span style={{ fontSize: 13, color: "var(--color-text-2)" }}>{greeting} — {leftToday} task{leftToday === 1 ? "" : "s"} left today</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {!isDefault && (
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "3px 9px" }} onClick={reset}>
              Reset layout
            </button>
          )}
          <Seg
            small
            ariaLabel="Dashboard range"
            items={[{ id: "week", label: "Week" }, { id: "month", label: "Month" }, { id: "year", label: "Year" }, { id: "all", label: "All" }]}
            active={range}
            onSelect={(id) => setRange(id as Range)}
          />
        </span>
      </div>
      <div className="gridbg" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 26px" }}>
        <PanelGrid
          ariaLabel="Dashboard panels"
          defs={defs}
          layout={layout}
          onLayoutChange={setLayout}
          cols={DASHBOARD_COLS}
          rowHeight={PANEL_ROW_H}
        >
          {(id) => {
            switch (id) {
              case "completed":
                return kpi(`Completed · ${RANGE_LABEL[range]}`, doneInRange, `${doneToday} today · ${planned} planned today`, "var(--st-done)");
              case "tracked":
                return kpi(`Tracked · ${RANGE_LABEL[range]}`, fmtMin(trackedMin), `across ${sessionCount} session${sessionCount === 1 ? "" : "s"}${pausedMin > 0 ? ` · ${fmtMin(pausedMin)} paused` : ""}`, "var(--accent-strong)");
              case "streak":
                return kpi("Streak", <>{streak}<span style={{ fontSize: 18, color: "var(--color-text-2)" }}> days</span></>, `best · ${best} days`);
              case "status":
                return (
                  <BP style={{ background: "var(--color-card)", padding: 18, display: "flex", gap: 18, alignItems: "center" }}>
                    <Donut counts={counts} size={120} />
                    <DonutLegend counts={counts} />
                  </BP>
                );
              case "week": return <WeekBars />;
              case "pattern": return <WorkPattern since={since} rangeLabel={RANGE_LABEL[range]} />;
              case "upnext": return upNextCard;
              case "habits": return <Habits />;
              case "reading": return <Reading />;
              case "goals": return <Goals />;
              default: return null;
            }
          }}
        </PanelGrid>
      </div>
    </div>
  );
}

/** Today's habits at a glance: done/due, each habit's tick + streak, and how
    consistent the whole week actually was. Renders nothing when the Habits
    plugin is off or empty — the same contract Reading and Goals follow. */
/** Habits / Reading / Goals each render nothing when their plugin is off or
    has no data. The panel grid needs that answer up front: a panel that
    renders null still occupies its cell, so an empty card would leave a hole
    the user cannot fill. */
export function hasHabits(state: AppState): boolean {
  return state.settings.plugins.habits && state.habits.some((h) => !h.archivedAt);
}

export function hasReading(state: AppState): boolean {
  return state.settings.plugins.library && readingStats(state.books).total > 0;
}

export function hasGoals(state: AppState): boolean {
  return goalProgress(state).length > 0;
}

function Habits({ mobile }: { mobile?: boolean }) {
  const { state } = useStore();
  const now = useNow(60_000);
  if (!state.settings.plugins.habits) return null;

  const due = dueToday(state.habits, now);
  const live = state.habits.filter((h) => !h.archivedAt);
  if (live.length === 0) return null;

  // Same per-day target the Habits screen judges by: two or more tasks feeding
  // a habit today ARE today's target (lib/habitLink.ts).
  const doneToday = (h: Habit) => isDoneOn(h, now, habitTargetOn(h, state.tasks, now, now));
  const doneNow = due.filter(doneToday).length;
  // Aggregate week consistency: every habit's due-days vs done-days, one ratio.
  const week = live.reduce(
    (acc, h) => {
      const s = completionStats(h, 7, now);
      return { due: acc.due + s.due, done: acc.done + s.done };
    },
    { due: 0, done: 0 },
  );
  const weekPct = week.due === 0 ? null : Math.round((100 * week.done) / week.due);
  const leader = [...live].map((h) => ({ h, streak: currentStreak(h, now) })).sort((a, b) => b.streak - a.streak)[0];

  return (
    <BP style={{ background: "var(--color-card)", padding: mobile ? "14px 16px" : 18, display: "flex", flexDirection: "column", gap: mobile ? 10 : 12 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="cap" style={{ fontSize: mobile ? 9 : 10 }}>Habits</div>
        <button onClick={() => nav("/habits")} style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent-strong)", border: "none", background: "none", cursor: "pointer" }}>
          Open habits &rarr;
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <span style={{ font: `600 ${mobile ? 24 : 30}px var(--font-heading)`, lineHeight: 1 }}>
          {doneNow}<span style={{ fontSize: 15, color: "var(--color-text-2)" }}>/{due.length} today</span>
        </span>
        {weekPct !== null && (
          <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>7-day consistency {weekPct}%</span>
        )}
        {leader && leader.streak > 1 && (
          <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>
            longest run — {leader.h.emoji ? `${leader.h.emoji} ` : ""}{leader.h.name}, {leader.streak} days
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {due.map((h) => {
          const done = doneToday(h);
          const streak = currentStreak(h, now);
          return (
            <span
              key={h.id}
              title={`${h.name}: ${done ? "done today" : "not yet today"}${streak > 0 ? ` · ${streak}-day streak` : ""}`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "4px 9px",
                border: "1px solid", borderRadius: 999,
                borderColor: done ? "var(--color-accent)" : "var(--color-divider)",
                background: done ? "var(--accent-soft)" : "transparent",
                color: done ? "var(--accent-strong)" : "var(--color-text-2)",
              }}
            >
              {h.emoji && <span aria-hidden>{h.emoji}</span>}
              {h.name}
              {streak > 0 && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}>{streak}d</span>}
            </span>
          );
        })}
        {due.length === 0 && <span style={{ fontSize: 13, color: "var(--color-text-2)" }}>Nothing due today.</span>}
      </div>
    </BP>
  );
}

/** Progress bars for pages tagged GOAL in Notes — how much of each long-running
    goal is actually done. Renders nothing at all until something is tagged, so
    the dashboard stays as it was for anyone not using goals. */
function Goals({ mobile }: { mobile?: boolean }) {
  const { state } = useStore();
  const goals = goalProgress(state);
  if (goals.length === 0) return null;

  return (
    <BP style={{ background: "var(--color-card)", padding: mobile ? "14px 16px" : 18, display: "flex", flexDirection: "column", gap: mobile ? 12 : 14 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="cap" style={{ fontSize: mobile ? 9 : 10 }}>Goals</div>
        <button onClick={() => nav("/notes")} style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent-strong)", border: "none", background: "none", cursor: "pointer" }}>
          Open notes &rarr;
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "repeat(auto-fit, minmax(240px, 1fr))", gap: mobile ? 12 : 18 }}>
        {goals.map((g) => {
          const pct = Math.round(g.ratio * 100);
          const empty = g.total === 0;
          return (
            <button
              key={g.note.id}
              onClick={() => nav(`/notes/${g.note.id}`)}
              style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left", border: "none", background: "none", padding: 0, cursor: "pointer", color: "var(--color-text)", minWidth: 0 }}
            >
              <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {g.note.title || "Untitled"}
                </span>
                <span style={{ marginLeft: "auto", flex: "none", font: "600 15px var(--font-heading)", color: empty ? "var(--color-text-3)" : "var(--accent-strong)" }}>
                  {empty ? "—" : `${pct}%`}
                </span>
              </span>
              <span style={{ display: "block", height: 6, background: "var(--color-divider)", borderRadius: 3, overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${pct}%`, background: "var(--color-accent)", borderRadius: 3 }} />
              </span>
              <span style={{ fontSize: 11, color: "var(--color-text-2)" }}>
                {empty
                  ? `nothing to track yet — add ${g.basis === "tasks" ? "tasks" : "- [ ] items"} to this page`
                  : `${g.done} of ${g.total} ${g.basis === "tasks" ? "tasks" : "items"} done`}
                {g.pageCount > 1 && ` · ${g.pageCount} pages`}
              </span>
            </button>
          );
        })}
      </div>
    </BP>
  );
}

/** Desktop 0.37's "Work pattern": completion score, skip rate, and how
    early/late finished tasks land against their deadlines. */
function WorkPattern({ since, rangeLabel }: { since: number; rangeLabel: string }) {
  const { state } = useStore();
  const all = state.tasks.length || 1;
  const done = state.tasks.filter((t) => t.status === "done").length;
  const skipped = state.tasks.filter((t) => t.status === "skipped").length;
  const withDeadline = state.tasks.filter((t) => t.completedAt && t.completedAt >= since && t.deadline);
  const delays = withDeadline.map((t) => t.completedAt! - t.deadline!);
  const onTime = delays.filter((d) => d <= 0).length;
  const avgDelayMin = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length / 60_000 : 0;

  const gauge = (label: string, pct: number, color: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ font: "600 26px var(--font-heading)", color }}>{Math.round(pct)}%</span>
      <span style={{ display: "block", height: 4, background: "var(--color-divider)" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.min(100, pct)}%`, background: color }} />
      </span>
      <span className="cap" style={{ fontSize: 9 }}>{label}</span>
    </div>
  );

  return (
    <BP style={{ background: "var(--color-card)", padding: 18, display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
      <div className="cap" style={{ fontSize: 10, width: "100%" }}>Work pattern</div>
      {gauge("Completion score", (done / all) * 100, "var(--st-done)")}
      {gauge("Skip rate", (skipped / all) * 100, "var(--st-skipped)")}
      <div style={{ flex: 1.4, minWidth: 160, fontSize: 13, color: "var(--color-text-2)", lineHeight: 1.5 }}>
        {withDeadline.length ? (
          <>
            Done tasks finish <strong style={{ color: avgDelayMin <= 0 ? "var(--st-done)" : "var(--st-pending)" }}>
              {fmtMin(Math.abs(avgDelayMin))} {avgDelayMin <= 0 ? "early" : "late"}
            </strong> on average · {onTime} on time, {withDeadline.length - onTime} late ({rangeLabel})
          </>
        ) : (
          <>No deadline-carrying completions {rangeLabel} yet.</>
        )}
      </div>
    </BP>
  );
}

function Donut({ counts, size }: { counts: Record<TaskStatus, number>; size: number }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const r = 15.9;
  const gap = 2; // 2% surface gap between segments (mark spec)
  let cursor = 0;
  const segs = DONUT_ORDER.filter((s) => counts[s] > 0).map((s) => {
    const frac = (counts[s] / total) * 100;
    const seg = { status: s, len: Math.max(0.5, frac - gap), offset: -(cursor + gap / 2) };
    cursor += frac;
    return seg;
  });
  return (
    <svg width={size} height={size} viewBox="0 0 42 42" role="img" aria-label={DONUT_ORDER.map((s) => `${STATUS_LABEL[s]} ${counts[s]}`).join(", ")}>
      <defs>
        <pattern id="hatch-skip" patternUnits="userSpaceOnUse" width="2.4" height="2.4" patternTransform="rotate(45)">
          <rect width="2.4" height="2.4" fill="var(--st-skipped)" />
          <line x1="0" y1="0" x2="0" y2="2.4" stroke="var(--color-card)" strokeWidth="1" />
        </pattern>
      </defs>
      <circle cx="21" cy="21" r={r} fill="none" stroke="var(--color-divider)" strokeWidth="6" />
      {segs.map((seg) => (
        <circle
          key={seg.status}
          cx="21" cy="21" r={r} fill="none"
          stroke={seg.status === "skipped" ? "url(#hatch-skip)" : STATUS_VAR[seg.status]}
          strokeWidth="6"
          strokeDasharray={`${seg.len} ${100 - seg.len}`}
          strokeDashoffset={seg.offset}
          transform="rotate(-90 21 21)"
        >
          <title>{STATUS_LABEL[seg.status]}</title>
        </circle>
      ))}
    </svg>
  );
}

function DonutLegend({ counts, compact }: { counts: Record<TaskStatus, number>; compact?: boolean }) {
  const rows: TaskStatus[] = ["done", "in_progress", "paused", "pending", "skipped"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 5 : 8, fontSize: compact ? 12 : 13, minWidth: compact ? 0 : 150 }}>
      {rows.map((s) => (
        <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: compact ? 7 : 8 }}>
          <span style={{
            width: compact ? 9 : 11, height: compact ? 9 : 11, flex: "none", borderRadius: "50%",
            background: s === "skipped"
              ? `repeating-linear-gradient(45deg, ${STATUS_VAR[s]} 0 1.5px, transparent 1.5px 3px)`
              : STATUS_VAR[s],
            border: s === "skipped" ? `1px solid ${STATUS_VAR[s]}` : "none",
          }} />
          {s === "in_progress" ? (compact ? "Active" : "In progress") : STATUS_LABEL[s]}
          <span style={{ marginLeft: "auto", color: "var(--color-text-2)" }}>{counts[s]}</span>
        </span>
      ))}
    </div>
  );
}

function WeekBars() {
  const { state } = useStore();
  const now = useNow(60_000);
  const [hover, setHover] = useState<number | null>(null);
  const today = startOfDay(now);
  const dow = (new Date(today).getDay() - state.settings.weekStart + 7) % 7;
  const weekStart = addDays(today, -dow);
  const days = [...Array(7)].map((_, i) => addDays(weekStart, i));

  // Held time counts whether the clock is running or paused — a pause freezes
  // the count, it does not discard it, so today's total must not dip when the
  // away-guard pauses for you.
  const runningMin = elapsedSec(state.timer, now) / 60;
  const minutes = days.map((d) =>
    state.sessions.filter((s) => sameDay(s.startedAt, d) && sessionKind(s) !== "pause").reduce((sum, s) => sum + s.minutes, 0) +
    (sameDay(d, today) ? runningMin : 0),
  );
  const max = Math.max(...minutes, 60);

  return (
    <BP style={{ background: "var(--color-card)", padding: 18, display: "flex", flexDirection: "column" }}>
      <div className="cap" style={{ fontSize: 10, marginBottom: 14 }}>Focus hours · this week</div>
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 14, alignItems: "end", minHeight: 120, position: "relative" }}>
        {days.map((d, i) => {
          const isToday = sameDay(d, today);
          const has = minutes[i] > 0;
          const hPct = has ? Math.max(6, (minutes[i] / max) * 100) : 4;
          return (
            <div
              key={d}
              role="img"
              aria-label={`${new Date(d).toLocaleDateString("en-US", { weekday: "long" })}: ${has ? fmtMin(minutes[i]) : "no focus time"}`}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end", position: "relative", cursor: "default" }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {hover === i && (
                <span style={{ position: "absolute", bottom: "100%", marginBottom: 4, background: "var(--color-text)", color: "var(--color-bg)", fontSize: 11, padding: "3px 8px", whiteSpace: "nowrap", zIndex: 2 }}>
                  {has ? fmtMin(minutes[i]) : "—"}
                </span>
              )}
              <div style={{
                width: "100%", height: `${hPct}%`,
                background: has ? "var(--color-accent)" : "var(--color-divider)",
                outline: isToday ? "1px solid var(--accent-deep)" : undefined,
              }} />
              <span className="cap" style={{ fontSize: 10, color: isToday ? "var(--accent-strong)" : undefined, fontWeight: isToday ? 700 : 600 }}>
                {new Date(d).toLocaleDateString("en-US", { weekday: "narrow" })}
              </span>
            </div>
          );
        })}
      </div>
    </BP>
  );
}

/** How much of the shelf has actually been read.

    Renders nothing when the Library is off or empty, so the dashboard is
    unchanged for anyone not using it — the same contract Goals follows.

    The bar is the whole point: "412 books" alone says nothing, while "18%
    read, 3 under way" answers the question someone with an untracked shelf is
    actually asking. Unread is shown as the remainder rather than a number to
    beat, because it is the one figure that only ever grows. */
function Reading({ mobile }: { mobile?: boolean }) {
  const { state } = useStore();
  if (!state.settings.plugins.library) return null;

  const s = readingStats(state.books);
  if (s.total === 0) return null;

  const segments = [
    { key: "read", n: s.read, label: BOOK_STATUS_LABEL.read, color: "var(--st-done)" },
    { key: "reading", n: s.reading, label: BOOK_STATUS_LABEL.reading, color: "var(--st-progress)" },
    { key: "dnf", n: s.dnf, label: BOOK_STATUS_LABEL.dnf, color: "var(--st-skipped)" },
    { key: "unread", n: s.unread, label: BOOK_STATUS_LABEL.unread, color: "var(--color-divider)" },
  ].filter((seg) => seg.n > 0);

  return (
    <BP style={{
      background: "var(--color-card)", padding: mobile ? "14px 16px" : 18,
      display: "flex", flexDirection: "column", gap: mobile ? 11 : 13,
    }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="cap" style={{ fontSize: mobile ? 9 : 10 }}>Reading</div>
        <button onClick={() => nav("/library")} style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent-strong)", border: "none", background: "none", cursor: "pointer" }}>
          Open library &rarr;
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: mobile ? 14 : 22, flexWrap: "wrap" }}>
        <span>
          <span style={{ font: `600 ${mobile ? 30 : 40}px var(--font-heading)`, lineHeight: 1.1 }}>{s.total}</span>
          <span style={{ fontSize: 12, color: "var(--color-text-2)" }}> owned</span>
        </span>
        <span>
          <span style={{ font: `600 ${mobile ? 26 : 34}px var(--font-heading)`, lineHeight: 1.1, color: "var(--st-done)" }}>
            {s.pctRead}%
          </span>
          <span style={{ fontSize: 12, color: "var(--color-text-2)" }}> read · {s.read}</span>
        </span>
        <span>
          <span style={{ font: `600 ${mobile ? 26 : 34}px var(--font-heading)`, lineHeight: 1.1, color: "var(--st-progress)" }}>
            {s.reading}
          </span>
          <span style={{ fontSize: 12, color: "var(--color-text-2)" }}> in progress</span>
        </span>
      </div>

      {/* One stacked bar rather than four: the split is the story, and four
          separate bars would invite comparing them to each other instead. */}
      <div
        role="img"
        aria-label={`${s.read} read, ${s.reading} in progress, ${s.dnf} did not finish, ${s.unread} unread, of ${s.total} books`}
        style={{ display: "flex", height: 9, borderRadius: 999, overflow: "hidden", background: "var(--color-divider)" }}
      >
        {segments.map((seg) => (
          <span key={seg.key} style={{ width: `${(seg.n / s.total) * 100}%`, background: seg.color }} />
        ))}
      </div>

      <div style={{ display: "flex", gap: mobile ? 10 : 16, flexWrap: "wrap", fontSize: 11.5, color: "var(--color-text-2)" }}>
        {segments.map((seg) => (
          <span key={seg.key} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flex: "none" }} />
            {seg.label} <strong style={{ color: "var(--color-text)", fontFamily: "var(--font-mono)" }}>{seg.n}</strong>
          </span>
        ))}
        {/* Only shown when it means something: page counts are missing for a
            good share of a real shelf, so the sample size is stated. */}
        {s.pagesKnownFor > 0 && s.pagesRead > 0 && (
          <span style={{ marginLeft: mobile ? undefined : "auto" }}>
            <strong style={{ color: "var(--color-text)", fontFamily: "var(--font-mono)" }}>
              {s.pagesRead.toLocaleString()}
            </strong>{" "}
            pages read, across the {s.pagesKnownFor} with a known length
          </span>
        )}
      </div>
    </BP>
  );
}
