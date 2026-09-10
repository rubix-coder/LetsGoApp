import { useRef, useState } from "react";
import { useStore } from "../lib/store";
import { useMobile, useNow } from "../lib/router";
import { completionStats, currentStreak, dueToday, habitScheduleSummary, habitTarget, HABIT_EMOJIS, isDoneOn, isDueOn, ticksOn } from "../lib/habits";
import { combinedDays, combinedWeeks, lifetimeStats, longestStreak, overallHabitScore, perfectDays } from "../lib/habitStats";
import { habitTargetOn, tasksForHabit, tasksForHabitOn } from "../lib/habitLink";
import { HabitDetail } from "./habits/HabitDetail";
import { StatRow, StatTile } from "./habits/HabitCharts";
import { habitsToMarkdown, parseHabitsMarkdown } from "../lib/habitsMd";
import { occurrenceDateKey } from "../lib/occurrence";
import { saveTextFile } from "../lib/download";
import type { Habit, Task } from "../lib/types";
import { BP, Collapse, Modal, StatusSq, Toggle } from "../components/ui";
import { ICheck, IDownload, IInfo, IPlus, ITrash, IUpload, IX } from "../components/Icons";
import { MobileHeader } from "../shell/AppShell";
import { PanelGrid } from "../components/PanelGrid";
import { usePanelLayout } from "../lib/usePanelLayout";
import type { PanelDef } from "../lib/panelLayout";

/** Same grid geometry as the Dashboard, so the two surfaces feel like one
    system rather than two implementations of the same idea. */
const HABITS_COLS = 3;
const PANEL_ROW_H = 132;

const DAY_LABEL = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function newHabit(): Habit {
  return { id: `h-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, name: "", createdAt: Date.now(), log: {} };
}

/** Noon `offset` days before `now` — the same DST-safe stepping lib/habits uses. */
function dayAt(now: number, offset: number): number {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
}

export function HabitsScreen() {
  const { state, dispatch, readOnly } = useStore();
  const mobile = useMobile();
  const now = useNow(60_000);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const live = state.habits.filter((h) => !h.archivedAt);
  const archived = state.habits.filter((h) => h.archivedAt);
  const today = dueToday(state.habits, now);
  /* A habit's daily target is its own `timesPerDay` until two or more tasks
     feed it on that day, at which point the tasks ARE the target — one tick
     each (lib/habitLink.ts). Every cell below judges the day through this. */
  const targetOn = (h: Habit) => (dayMs: number) => habitTargetOn(h, state.tasks, dayMs, now);
  const doneCount = today.filter((h) => isDoneOn(h, now, targetOn(h)(now))).length;

  function importFile(file: File) {
    void file.text().then((text) => {
      const parsed = parseHabitsMarkdown(text);
      if (parsed.length > 0) dispatch({ type: "importHabits", habits: parsed, source: file.name });
    });
  }

  const importExport = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }}
      />
      {!readOnly && (
        <button className="btn btn-icon btn-secondary" onClick={() => fileRef.current?.click()} title="Import habits from markdown" aria-label="Import habits from markdown">
          <IUpload size={16} strokeWidth={1.6} />
        </button>
      )}
      <button
        className="btn btn-icon btn-secondary"
        onClick={() => void saveTextFile("letsgo-habits.md", "text/markdown", habitsToMarkdown(state.habits))}
        title="Export habits as markdown"
        aria-label="Export habits as markdown"
      >
        <IDownload size={16} strokeWidth={1.6} />
      </button>
    </>
  );

  const addButton = !readOnly && (
    <button className="btn btn-primary" onClick={() => setEditing(newHabit())}>
      <IPlus size={16} strokeWidth={1.6} />
      {mobile ? "" : "Add habit"}
    </button>
  );

  // Desktop panels. Each is declared only when it has something in it — a
  // panel that renders nothing still holds its cell.
  const defs: PanelDef[] = [
    ...(live.length > 0 ? [{ id: "overview", title: "Overview", w: 3, h: 3, minH: 2 } as PanelDef] : []),
    ...(today.length > 0 ? [{ id: "today", title: "Today", w: 1, h: 2 } as PanelDef] : []),
    ...(live.length > 0 ? [{ id: "week", title: "This week", w: 2, h: 2, minW: 2 } as PanelDef] : []),
    ...(archived.length > 0 ? [{ id: "archived", title: "Archived", w: 1, h: 1 } as PanelDef] : []),
  ];
  const { layout, setLayout, reset, isDefault } = usePanelLayout("habits", defs, HABITS_COLS);

  const todayList = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {today.map((h) => (
        <TodayRow key={h.id} habit={h} now={now} readOnly={readOnly} targetOn={targetOn(h)}
          onTick={(delta) => dispatch({ type: "tickHabit", id: h.id, day: occurrenceDateKey(now), delta })} />
      ))}
    </div>
  );

  const weekList = live.map((h) => (
    <WeekRow key={h.id} habit={h} now={now} weekStart={state.settings.weekStart} readOnly={readOnly}
      onOpen={() => setDetail(h.id)}
      targetOn={targetOn(h)}
      onSetDay={(dayMs, done) =>
        dispatch({ type: "tickHabit", id: h.id, day: occurrenceDateKey(dayMs), delta: done ? targetOn(h)(dayMs) - ticksOn(h, dayMs) : -ticksOn(h, dayMs) })} />
  ));

  const archivedList = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {archived.map((h) => (
        <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-text-2)", padding: "4px 2px" }}>
          <span>{h.emoji}</span>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
          {!readOnly && (
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => dispatch({ type: "upsertHabit", habit: { ...h, archivedAt: undefined } })}>
              Restore
            </button>
          )}
        </div>
      ))}
    </div>
  );

  const desktopBody = (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 22px 32px" }}>
      {live.length === 0 && archived.length === 0 ? (
        <BP style={{ background: "var(--color-card)", padding: "28px 24px", textAlign: "center", color: "var(--color-text-2)", fontSize: 13, maxWidth: 1100 }}>
          No habits yet. Add one — or import a markdown ledger you already keep.
        </BP>
      ) : (
        <PanelGrid
          ariaLabel="Habit panels"
          defs={defs}
          layout={layout}
          onLayoutChange={setLayout}
          cols={HABITS_COLS}
          rowHeight={PANEL_ROW_H}
        >
          {(id) => {
            if (id === "overview") return <Overview habits={live} now={now} weekStart={state.settings.weekStart} />;
            if (id === "today") return <PanelCard title={`Today · ${doneCount}/${today.length} done`}>{todayList}</PanelCard>;
            if (id === "week") return <PanelCard title="This week">{weekList}</PanelCard>;
            if (id === "archived") return <PanelCard title="Archived">{archivedList}</PanelCard>;
            return null;
          }}
        </PanelGrid>
      )}
    </div>
  );

  const body = (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: mobile ? "0 16px 24px" : "18px 22px 32px" }}>
      <div style={{ maxWidth: 1100 }}>
        {live.length === 0 && (
          <BP style={{ background: "var(--color-card)", padding: "28px 24px", textAlign: "center", color: "var(--color-text-2)", fontSize: 13 }}>
            No habits yet. Add one — or import a markdown ledger you already keep.
          </BP>
        )}

        {/* The grid owns spacing on desktop, so Overview no longer carries its
            own bottom margin — the stacked mobile body supplies it here. */}
        {live.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <Overview habits={live} now={now} weekStart={state.settings.weekStart} />
          </div>
        )}

        {today.length > 0 && (
          <>
            <div className="cap" style={{ margin: "4px 0 10px" }}>
              Today &middot; {doneCount}/{today.length} done
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
              {today.map((h) => (
                <TodayRow key={h.id} habit={h} now={now} readOnly={readOnly} targetOn={targetOn(h)}
                  onTick={(delta) => dispatch({ type: "tickHabit", id: h.id, day: occurrenceDateKey(now), delta })} />
              ))}
            </div>
          </>
        )}

        {live.length > 0 && (
          <>
            <div className="cap" style={{ margin: "4px 0 10px" }}>This week</div>
            <BP style={{ background: "var(--color-card)", padding: "14px 16px", marginBottom: 22 }}>
              {live.map((h) => (
                <WeekRow key={h.id} habit={h} now={now} weekStart={state.settings.weekStart} readOnly={readOnly}
                  onOpen={() => setDetail(h.id)}
                  targetOn={targetOn(h)}
                  onSetDay={(dayMs, done) =>
                    dispatch({ type: "tickHabit", id: h.id, day: occurrenceDateKey(dayMs), delta: done ? targetOn(h)(dayMs) - ticksOn(h, dayMs) : -ticksOn(h, dayMs) })} />
              ))}
            </BP>
          </>
        )}

        {archived.length > 0 && (
          <>
            <div className="cap" style={{ margin: "4px 0 10px" }}>Archived</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {archived.map((h) => (
                <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-text-2)", padding: "4px 2px" }}>
                  <span>{h.emoji}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                  {!readOnly && (
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => dispatch({ type: "upsertHabit", habit: { ...h, archivedAt: undefined } })}>
                      Restore
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {mobile ? (
        <MobileHeader title="Habits" right={<>{importExport}{addButton}</>} />
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 22px", borderBottom: "1px solid var(--color-divider)" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Habits</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {!isDefault && (
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "3px 9px" }} onClick={reset}>
                Reset layout
              </button>
            )}
            {importExport}
            {addButton}
          </div>
        </div>
      )}
      {mobile ? body : desktopBody}
      {detail && !editing && (() => {
        const h = state.habits.find((x) => x.id === detail);
        return h ? (
          <HabitDetail habit={h} now={now} onClose={() => setDetail(null)} onEdit={() => { setEditing(h); setDetail(null); }} />
        ) : null;
      })()}
      {editing && (
        <HabitEditor
          habit={editing}
          isNew={!state.habits.some((h) => h.id === editing.id)}
          onClose={() => setEditing(null)}
          onSave={(h) => { dispatch({ type: "upsertHabit", habit: h }); setEditing(null); }}
          onArchive={(h) => { dispatch({ type: "upsertHabit", habit: { ...h, archivedAt: Date.now() } }); setEditing(null); }}
          onDelete={(h) => { dispatch({ type: "deleteHabit", id: h.id }); setEditing(null); }}
        />
      )}
    </div>
  );
}

/** Everything at once, before the per-habit detail.

    Deliberately four numbers and a 12-week strip rather than a chart: the
    question this answers is "how am I doing overall", and a headline figure
    answers it faster than any plot. The strip underneath is the one bit of
    shape worth carrying here — a glance at whether the last three months are
    getting denser or thinner. */
const OVERVIEW_DAYS = 371; // 53 weeks — a full year, GitHub-contributions style

/** Heat ramp step for a day's completion rate — same thresholds the per-habit
    year grid uses, so the two read alike. */
function rateBg(rate: number | null): string {
  if (rate === null) return "var(--heat-0)";
  if (rate >= 1) return "var(--heat-4)";
  if (rate >= 0.66) return "var(--heat-3)";
  if (rate >= 0.33) return "var(--heat-2)";
  if (rate > 0) return "var(--heat-1)";
  return "var(--heat-0)";
}

function Overview({ habits, now, weekStart }: { habits: readonly Habit[]; now: number; weekStart: 0 | 1 | 6 }) {
  const days = combinedDays(habits, now, 84);
  const weeks = combinedWeeks(habits, now, OVERVIEW_DAYS, weekStart);
  const perfect = perfectDays(habits, now, 84);
  const kept = days.reduce((n, d) => n + d.done, 0);
  const due = days.reduce((n, d) => n + d.due, 0);
  const best = habits.reduce((b, h) => Math.max(b, longestStreak(h, now).length), 0);
  const ticks = habits.reduce((n, h) => n + lifetimeStats(h, now).totalTicks, 0);
  const { score, band } = overallHabitScore(habits, now);

  return (
    <BP style={{ background: "var(--color-card)", padding: "16px 18px" }}>
      <StatRow>
        <StatTile emphasis value={String(score)} label="Overall score" hint={band} />
        <StatTile value={due === 0 ? "—" : `${Math.round((100 * kept) / due)}%`} label="Last 12 weeks" hint={`${kept}/${due} kept`} />
        <StatTile value={String(perfect)} label="Perfect days" hint="every habit kept" />
        <StatTile value={String(best)} label="Best run" hint="any habit" />
        <StatTile value={ticks.toLocaleString()} label="Total ticks" hint="all time" />
      </StatRow>

      {/* Contribution grid — a column is a week, a row a weekday, filling the
          full width of the card so a wide screen shows more history. */}
      <div
        aria-hidden
        style={{
          display: "grid", gridAutoFlow: "column", gridAutoColumns: "1fr",
          gridTemplateRows: "repeat(7, 1fr)", gap: 2, marginTop: 16, width: "100%",
        }}
      >
        {weeks.flatMap((col) =>
          col.map((cell) => (
            <span
              key={cell.dayMs}
              title={
                cell.inRange
                  ? `${new Date(cell.dayMs).toLocaleDateString(undefined, { day: "numeric", month: "short" })} — ${cell.done}/${cell.due}`
                  : undefined
              }
              style={{
                aspectRatio: "1 / 1", borderRadius: 2, minWidth: 0,
                background: cell.inRange ? rateBg(cell.rate) : "transparent",
              }}
            />
          )),
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, color: "var(--color-text-3)", marginTop: 7 }}>
        <span>Each square is a day · the past year, oldest top-left</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 3 }}>
          less
          {["var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"].map((c) => (
            <span key={c} style={{ width: 9, height: 9, borderRadius: 2, background: c, display: "inline-block" }} />
          ))}
          more
        </span>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--color-text-3)", marginTop: 4 }}>
        Tap the <span style={{ verticalAlign: "middle" }}><IInfo size={11} /></span> beside a habit below for its full record.
      </div>
    </BP>
  );
}

/** The card a habit panel's contents sit in: a heading that stays put and a
    body that scrolls, since the panel's height is the user's choice now. */
function PanelCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <BP style={{ background: "var(--color-card)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
      <div className="cap" style={{ flex: "none" }}>{title}</div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</div>
    </BP>
  );
}

/** Today's checklist row: one tap ticks; multi-target habits count up with ±. */
function TodayRow({ habit, now, readOnly, targetOn, onTick }: { habit: Habit; now: number; readOnly: boolean; targetOn: (dayMs: number) => number; onTick: (delta: number) => void }) {
  const target = targetOn(now);
  const ticks = ticksOn(habit, now);
  const done = ticks >= target;
  const streak = currentStreak(habit, now);
  return (
    <BP style={{ background: "var(--color-card)", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
      <button
        className={`btn btn-icon ${done ? "btn-primary" : "btn-secondary"}`}
        style={{ width: 38, height: 38, fontSize: 16, flex: "none" }}
        disabled={readOnly}
        aria-label={done ? `${habit.name} — done today` : `Mark ${habit.name} done`}
        /* Counting up one at a time while there is room, but a tap on a habit
           already at target CLEARS the day. It used to send +1 regardless, so
           a multi-target habit could be ticked past its target and never
           un-ticked from this button at all. */
        onClick={() => onTick(done ? -ticks : 1)}
      >
        {done ? <ICheck size={18} strokeWidth={2} /> : <span aria-hidden>{habit.emoji ?? "▸"}</span>}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {habit.emoji && done ? `${habit.emoji} ` : ""}{habit.name}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--color-text-3)", fontFamily: "var(--font-mono)" }}>
          {target > 1 ? `${ticks}/${target} today · ` : ""}
          {streak > 0 ? `${streak}-day streak` : "no streak yet"}
        </div>
      </div>
      {target > 1 && !readOnly && (
        <div style={{ display: "flex", gap: 6, flex: "none" }}>
          <button className="btn btn-secondary btn-icon" style={{ width: 30, height: 30 }} aria-label={`Undo one ${habit.name}`} disabled={ticks === 0} onClick={() => onTick(-1)}>
            &minus;
          </button>
          <button className="btn btn-secondary btn-icon" style={{ width: 30, height: 30 }} aria-label={`One more ${habit.name}`} onClick={() => onTick(1)}>
            +
          </button>
        </div>
      )}
    </BP>
  );
}

/** One habit's last-7-days strip. Cells are tappable to fix history — missed
    yesterday's log, not yesterday's habit. */
function WeekRow({ habit, now, weekStart, readOnly, targetOn, onOpen, onSetDay }: {
  habit: Habit;
  now: number;
  weekStart: 0 | 1 | 6;
  readOnly: boolean;
  targetOn: (dayMs: number) => number;
  onOpen: () => void;
  onSetDay: (dayMs: number, done: boolean) => void;
}) {
  // The strip shows the current week (from weekStart) up to today.
  const todayDow = new Date(now).getDay();
  const back = (todayDow - weekStart + 7) % 7;
  const days = Array.from({ length: 7 }, (_, i) => dayAt(now, i - back));
  const month = completionStats(habit, 28, now);
  const pct = month.due === 0 ? null : Math.round((100 * month.done) / month.due);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--color-divider)" }}>
      <button
        className="btn btn-ghost"
        style={{ flex: 1, minWidth: 0, justifyContent: "flex-start", textAlign: "left", padding: "2px 4px", fontSize: 13, gap: 7 }}
        onClick={onOpen}
        title={`${habit.name} — records, year grid and breakdowns`}
      >
        <span aria-hidden>{habit.emoji ?? "▸"}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{habit.name}</span>
        <span
          aria-hidden
          title="Full records, year grid & breakdowns"
          style={{ display: "flex", flex: "none", color: "var(--color-text-3)" }}
        >
          <IInfo size={14} strokeWidth={1.8} />
        </span>
      </button>
      <div style={{ display: "flex", gap: 4, flex: "none" }} aria-label={`${habit.name} this week`}>
        {days.map((dayMs) => {
          const future = dayMs > dayAt(now, 0);
          const due = isDueOn(habit, dayMs);
          const done = isDoneOn(habit, dayMs, targetOn(dayMs));
          const label = `${DAY_FULL[new Date(dayMs).getDay()]}: ${!due ? "not due" : done ? "done" : "not done"}`;
          return (
            <button
              key={dayMs}
              disabled={readOnly || future || !due}
              onClick={() => onSetDay(dayMs, !done)}
              aria-label={label}
              title={label}
              style={{
                width: 22, height: 22, borderRadius: "50%", border: "1px solid",
                borderColor: done ? "var(--color-accent)" : "var(--color-divider)",
                background: done ? "var(--color-accent)" : "transparent",
                color: done ? "var(--color-bg)" : "var(--color-text-3)",
                fontSize: 9.5, fontFamily: "var(--font-mono)", cursor: readOnly || future || !due ? "default" : "pointer",
                opacity: future ? 0.35 : due ? 1 : 0.35,
                padding: 0,
              }}
            >
              {DAY_LABEL[new Date(dayMs).getDay()]}
            </button>
          );
        })}
      </div>
      <span style={{ flex: "none", width: 44, textAlign: "right", fontSize: 11, color: "var(--color-text-3)", fontFamily: "var(--font-mono)" }}>
        {pct === null ? "—" : `${pct}%`}
      </span>
    </div>
  );
}

function HabitEditor({ habit, isNew, onClose, onSave, onArchive, onDelete }: {
  habit: Habit;
  isNew: boolean;
  onClose: () => void;
  onSave: (h: Habit) => void;
  onArchive: (h: Habit) => void;
  onDelete: (h: Habit) => void;
}) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(habit.name);
  const [emoji, setEmoji] = useState(habit.emoji ?? "");
  const [everyDay, setEveryDay] = useState(!habit.days || habit.days.length === 0);
  const [days, setDays] = useState<number[]>(habit.days ?? []);
  const [times, setTimes] = useState(habitTarget(habit));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mobile = useMobile();
  const linkedCount = tasksForHabit(state.tasks, habit.id).length;
  /* Times per day, set for you by the tasks feeding this habit: link morning,
     noon and evening water and the day wants three ticks, one per task. Only
     from two upwards — a single task is one whole obligation ("drink water",
     8 glasses), and deriving from it would demote that 8 to a 1. Below two the
     typed number stands, and it is what days with no linked task fall back to
     either way, so the field stays live rather than going read-only. */
  const derivedTimes = tasksForHabitOn(state.tasks, habit.id, Date.now(), Date.now()).length;
  const timesFromTasks = derivedTimes >= 2;
  const effectiveTimes = timesFromTasks ? derivedTimes : times;
  const scheduleSummary = habitScheduleSummary(everyDay, days, effectiveTimes);

  const canSave = name.trim().length > 0 && (everyDay || days.length > 0);
  const save = () =>
    onSave({
      ...habit,
      name: name.trim(),
      emoji: emoji.trim() || undefined,
      days: everyDay ? undefined : [...days].sort(),
      timesPerDay: effectiveTimes > 1 ? effectiveTimes : undefined,
    });

  /* Header, a scrolling body, and a footer that is always on screen.

     The form used to be one long column inside a dialog capped at
     calc(100vh - 48px) with nothing set to scroll, so past about 700px of
     viewport the Cancel/Save row was simply clipped off the bottom and the
     habit could not be saved at all. The optional bulk — the 30-glyph emoji
     grid and the linked-task picker — is folded into <Collapse> sections that
     state their value on the header line, so the form opens short and stays a
     complete read of the habit. */
  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 18px 12px", borderBottom: "1px solid var(--color-divider)" }}>
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{isNew ? "New habit" : "Edit habit"}</span>
        <button className="btn btn-ghost btn-icon" style={{ width: 28, height: 28 }} onClick={onClose} aria-label="Close">
          <IX size={15} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 10 }}>
          <div className="field">
            <label htmlFor="hb-emoji">Emoji</label>
            <input id="hb-emoji" className="input" value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="&#127749;" style={{ textAlign: "center" }} />
          </div>
          <div className="field">
            <label htmlFor="hb-name">Name</label>
            <input id="hb-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Wake up by 6" />
          </div>
        </div>

        {/* The glyph is the habit's identity everywhere it appears in a dense
            list, so it gets one tap rather than a trip to an emoji keyboard.
            The field above still takes anything not in the set. */}
        <Collapse title="Pick an emoji" summary={emoji || "None"}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }} role="group" aria-label="Pick an emoji">
            {HABIT_EMOJIS.map((glyph) => {
              const on = emoji === glyph;
              return (
                <button
                  key={glyph}
                  type="button"
                  aria-label={`Emoji ${glyph}`}
                  aria-pressed={on}
                  onClick={() => setEmoji(on ? "" : glyph)}
                  style={{
                    width: 30, height: 30, fontSize: 15, lineHeight: 1, padding: 0, cursor: "pointer",
                    borderRadius: "var(--radius-sm, 6px)",
                    border: `1px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`,
                    background: on ? "var(--accent-wash)" : "var(--color-surface)",
                  }}
                >
                  {glyph}
                </button>
              );
            })}
          </div>
        </Collapse>

        {/* Open by default: when a habit is due IS the habit, and it is the one
            section whose unset state (no days picked) blocks saving. */}
        <Collapse title="Schedule" summary={scheduleSummary} defaultOpen>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <Toggle on={everyDay} onChange={setEveryDay} label="Every day" />
              Every day
            </label>
            {!everyDay && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="group" aria-label="Due on">
                {DAY_LABEL.map((l, dow) => {
                  const on = days.includes(dow);
                  return (
                    <button
                      key={dow}
                      className={`btn ${on ? "btn-primary" : "btn-secondary"}`}
                      style={{ width: 34, height: 34, padding: 0, fontFamily: "var(--font-mono)", fontSize: 12 }}
                      aria-pressed={on}
                      aria-label={DAY_FULL[dow]}
                      onClick={() => setDays((d) => (on ? d.filter((x) => x !== dow) : [...d, dow]))}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="field" style={{ maxWidth: 230 }}>
              <label htmlFor="hb-times">Times per day</label>
              <input id="hb-times" type="number" className="input" min={1} max={99} style={{ maxWidth: 160 }}
                value={effectiveTimes} disabled={timesFromTasks}
                onChange={(e) => setTimes(Math.max(1, Math.min(99, Math.round(Number(e.target.value) || 1))))} />
              {timesFromTasks && (
                <span style={{ fontSize: 11.5, color: "var(--color-text-2)" }}>
                  Set by the {derivedTimes} tasks linked to this habit today — one tick each.
                  Unlink a task to set this by hand.
                </span>
              )}
            </div>
          </div>
        </Collapse>

        {!isNew && (
          <Collapse title="Linked tasks" summary={linkedCount === 0 ? "None" : `${linkedCount} linked`}>
            <LinkedTasks habitId={habit.id} tasks={state.tasks} onLink={(t) => dispatch({ type: "upsertTask", task: t, repack: false })} />
          </Collapse>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", borderTop: "1px solid var(--color-divider)" }}>
        {!isNew && (
          confirmDelete ? (
            <button className="btn btn-secondary" style={{ color: "var(--prio-hi-text)", borderColor: "var(--prio-hi-border)" }} onClick={() => onDelete(habit)}>
              Really delete?
            </button>
          ) : (
            <>
              <button className="btn btn-ghost btn-icon" style={{ width: 32, height: 32, color: "var(--color-text-2)" }} onClick={() => setConfirmDelete(true)} aria-label="Delete habit">
                <ITrash size={15} />
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--color-text-2)" }} onClick={() => onArchive(habit)}>
                Archive
              </button>
            </>
          )
        )}
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!canSave} onClick={save}>Save</button>
      </div>
    </>
  );

  // The house split: a full-height sheet on a phone, a modal on a desktop.
  if (mobile) return <div className="sheet">{body}</div>;
  return <Modal onClose={onClose} width={420}>{body}</Modal>;
}

/** Bind scheduled tasks to this habit, from the habit's side.

    The link itself lives on the TASK (`Task.habitIds`), and the task editor is
    where you would naturally set it — but someone looking at a habit and
    thinking "this is already on my Tuesday list" will look here, so the same
    binding is reachable from both ends. Once bound, completing either side
    fills the other (lib/habitLink.ts). */
function LinkedTasks({ habitId, tasks, onLink }: {
  habitId: string;
  tasks: readonly Task[];
  onLink: (task: Task) => void;
}) {
  const linked = tasksForHabit(tasks, habitId);
  /* Offer what could plausibly be this habit: unfinished, not already bound to
     THIS habit, and not a parent (a parent's status is derived).

     Being bound to some OTHER habit is no longer a disqualifier — that is the
     whole point of the many-to-many binding. One "Get ready" task legitimately
     feeds brush teeth, shampoo and clean the floor, so it must stay offerable
     from each of their editors. */
  const parents = new Set(tasks.map((t) => t.parentId).filter(Boolean) as string[]);
  const candidates = tasks.filter(
    (t) => !t.habitIds?.includes(habitId) && t.status !== "done" && t.status !== "skipped" && !parents.has(t.id),
  );

  return (
    <div className="field">
      {/* No heading of its own — the <Collapse> above it is the heading now. */}
      <p style={{ fontSize: 11.5, color: "var(--color-text-2)", margin: "0 0 8px" }}>
        Completing a linked task fills this habit for that task&rsquo;s day, and keeping the habit completes the task.
        Tick it once, wherever you happen to be.
      </p>
      {linked.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 8 }}>
          {linked.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
              <StatusSq status={t.status} size={9} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.title}
                {(t.habitIds?.length ?? 0) > 1 && (
                  <span style={{ color: "var(--color-text-2)" }}>
                    {" "}&middot; feeds {t.habitIds!.length} habits
                  </span>
                )}
              </span>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: "2px 6px", color: "var(--color-text-2)" }}
                onClick={() => {
                  const rest = (t.habitIds ?? []).filter((id) => id !== habitId);
                  onLink({ ...t, habitIds: rest.length ? rest : undefined });
                }}
              >
                Unlink
              </button>
            </div>
          ))}
        </div>
      )}
      <select
        className="input"
        aria-label="Link a task to this habit"
        value=""
        disabled={candidates.length === 0}
        onChange={(e) => {
          const t = candidates.find((c) => c.id === e.target.value);
          if (t) onLink({ ...t, habitIds: [...(t.habitIds ?? []), habitId] });
        }}
        style={{ fontSize: 12, height: 30 }}
      >
        <option value="">{candidates.length ? "Link a task\u2026" : "No open tasks to bind"}</option>
        {candidates.map((t) => (
          <option key={t.id} value={t.id}>{t.title}</option>
        ))}
      </select>
    </div>
  );
}
