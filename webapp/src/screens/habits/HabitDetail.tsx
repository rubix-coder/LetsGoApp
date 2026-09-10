/* One habit, over its whole life.

   The Habits screen answers "what do I do today". This answers "am I actually
   the kind of person who does this" — which is the question that keeps a habit
   alive, and the one a 7-day strip and a single 28-day percentage could not
   touch.

   Ordered by how far the reader is looking: the records first (a number you can
   feel), then the year as a grid, then the trend, then the breakdowns that tell
   you WHERE it goes wrong. Anything that needs a year of data to mean anything
   hides itself until there is a year of data — an empty chart is worse than no
   chart, because it reads as failure rather than as youth. */

import { useMemo } from "react";
import { useStore } from "../../lib/store";
import { currentStreak } from "../../lib/habits";
import {
  heatmapWeeks, lifetimeStats, longestStreak, monthlyStats,
  rollingTrend, weekdayStats, yearlyStats,
} from "../../lib/habitStats";
import { habitTargetOn, tasksForHabit } from "../../lib/habitLink";
import { fmtDayMed } from "../../lib/dates";
import { Modal, Seg, StatusSq } from "../../components/ui";
import { IX } from "../../components/Icons";
import { HeatGrid, PeriodColumns, StatRow, StatTile, TrendLine, WeekdayBars } from "./HabitCharts";
import { PanelGrid } from "../../components/PanelGrid";
import { usePanelLayout } from "../../lib/usePanelLayout";
import type { PanelDef } from "../../lib/panelLayout";
import { useStickyView } from "../../lib/viewMemory";
import { useMobile } from "../../lib/router";
import type { Habit } from "../../lib/types";

const RANGES = [
  { id: "13", label: "3 months", weeks: 13 },
  { id: "26", label: "6 months", weeks: 26 },
  { id: "53", label: "1 year", weeks: 53 },
] as const;
const RANGE_IDS = RANGES.map((r) => r.id);

/** Wide enough for three columns of chart; the detail used to be a 640px
    column because it was a stack. Capped to the viewport on small screens. */
const DETAIL_COLS = 3;
const PANEL_ROW_H = 132;

/** One chart in its own panel: a heading that stays put and a body that
    scrolls, since the panel's height is the user's choice now. */
function Block({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="hd-block">
      <div className="cap" style={{ flex: "none" }}>{title}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--color-text-3)", margin: "2px 0 6px", flex: "none" }}>{sub}</div>}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", marginTop: sub ? 0 : 8 }}>{children}</div>
    </section>
  );
}

export function HabitDetail({ habit, now, onClose, onEdit }: {
  habit: Habit;
  now: number;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { state } = useStore();
  const mobile = useMobile();
  // Sticky per device: the record is opened one habit after another, and a
  // 3-month window had to be re-picked for every one of them.
  const [rangeId, setRangeId] = useStickyView("lg:habitRange", RANGE_IDS, "53");
  const weeks = RANGES.find((r) => r.id === rangeId)?.weeks ?? 53;

  const stats = useMemo(() => {
    const life = lifetimeStats(habit, now);
    return {
      life,
      best: longestStreak(habit, now),
      streak: currentStreak(habit, now),
      grid: heatmapWeeks(habit, now, weeks, state.settings.weekStart),
      months: monthlyStats(habit, now, 12),
      years: yearlyStats(habit, now),
      weekdays: weekdayStats(habit, now),
      trend: rollingTrend(habit, now, Math.min(life.ageDays, 180), 30, 2),
    };
  }, [habit, now, weeks, state.settings.weekStart]);

  const { life, best, streak } = stats;
  // Today's target, which the linked tasks may be setting (lib/habitLink.ts).
  const target = habitTargetOn(habit, state.tasks, now, now);
  const linked = tasksForHabit(state.tasks, habit.id);
  // A weekday breakdown needs a few of each weekday before it means anything;
  // below that it is just noise shaped like an insight.
  const weekdaysMeaningful = life.ageDays >= 28;
  const worst = weekdaysMeaningful
    ? stats.weekdays.reduce<null | (typeof stats.weekdays)[number]>((w, p) => (p.rate !== null && p.due >= 3 && (w === null || p.rate < (w.rate ?? 1)) ? p : w), null)
    : null;

  // Panels are declared only when their chart has enough history to say
  // something — an empty chart reads as failure rather than as youth, and a
  // panel that renders nothing would still hold its cell.
  const defs: PanelDef[] = [
    { id: "stats", title: "Records", w: 3, h: 1 },
    { id: "record", title: "The record", w: 3, h: 2, minH: 2 },
    ...(stats.trend.length > 2 ? [{ id: "trend", title: "Trend", w: 2, h: 2, minH: 2 } as PanelDef] : []),
    ...(life.ageDays >= 45 ? [{ id: "months", title: "By month", w: 1, h: 2, minH: 2 } as PanelDef] : []),
    ...(weekdaysMeaningful ? [{ id: "weekdays", title: "By weekday", w: 1, h: 2, minH: 2 } as PanelDef] : []),
    ...(stats.years.length > 1 ? [{ id: "years", title: "By year", w: 1, h: 2, minH: 2 } as PanelDef] : []),
    ...(linked.length > 0 ? [{ id: "linked", title: "Linked tasks", w: 1, h: 2 } as PanelDef] : []),
  ];
  // One arrangement for every habit, not one per habit: you lay the record out
  // once and then read every habit the same way.
  const cols = mobile ? 1 : DETAIL_COLS;
  const { layout, setLayout, reset, isDefault } = usePanelLayout("habit-detail", defs, cols);

  return (
    <Modal onClose={onClose} width={mobile ? 640 : 1080}>
      <div style={{ padding: "18px 22px 24px", maxHeight: "82vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }} aria-hidden>{habit.emoji ?? "▸"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{habit.name}</div>
            <div style={{ fontSize: 11.5, color: "var(--color-text-3)" }}>
              since {fmtDayMed(life.firstDayMs)} · {life.ageDays} day{life.ageDays === 1 ? "" : "s"}
              {target > 1 ? ` · ${target}× a day` : ""}
            </div>
          </div>
          {!isDefault && !mobile && (
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={reset}>Reset layout</button>
          )}
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onEdit}>Edit</button>
          <button className="btn btn-ghost btn-icon" style={{ width: 28, height: 28 }} onClick={onClose} aria-label="Close">
            <IX size={15} />
          </button>
        </div>

        <div style={{ height: 18 }} />
        <PanelGrid
          ariaLabel="Habit record panels"
          defs={defs}
          layout={layout}
          onLayoutChange={setLayout}
          cols={cols}
          rowHeight={PANEL_ROW_H}
          gap={12}
          locked={mobile}
        >
          {(id) => {
            if (id === "stats") {
              return (
                <div className="hd-block" style={{ justifyContent: "center" }}>
                  <StatRow>
                    <StatTile emphasis value={String(streak)} label="Current streak" hint={streak === best.length && streak > 0 ? "your record" : undefined} />
                    <StatTile value={String(best.length)} label="Longest run" hint={best.toMs ? `to ${fmtDayMed(best.toMs)}` : undefined} />
                    <StatTile value={life.rate === null ? "—" : `${Math.round(life.rate * 100)}%`} label="Lifetime" hint={`${life.doneDays}/${life.dueDays} days`} />
                    <StatTile value={life.totalTicks.toLocaleString()} label={target > 1 ? "Total ticks" : "Days kept"} hint={target > 1 ? `${life.activeDays} active days` : undefined} />
                  </StatRow>
                </div>
              );
            }
            if (id === "record") {
              return (
                <Block title="The record">
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <Seg small ariaLabel="Heat grid range" items={RANGES.map((r) => ({ id: r.id, label: r.label }))} active={rangeId} onSelect={(id) => setRangeId(id as typeof rangeId)} />
                  </div>
                  <HeatGrid weeks={stats.grid} title={`${habit.name} over the last ${RANGES.find((r) => r.id === rangeId)?.label}`} />
                </Block>
              );
            }
            if (id === "trend") {
              return (
                <Block title="Trend" sub="Share of due days kept, over a rolling 30-day window.">
                  <TrendLine points={stats.trend} title={`${habit.name} trend`} windowDays={30} />
                </Block>
              );
            }
            if (id === "months") {
              return (
                <Block title="By month">
                  <PeriodColumns data={stats.months} title={`${habit.name} by month`} />
                </Block>
              );
            }
            if (id === "weekdays") {
              return (
                <Block
                  title="By weekday"
                  sub={worst && (worst.rate ?? 1) < 0.999 ? `${worst.label} is where it slips most.` : undefined}
                >
                  <WeekdayBars data={stats.weekdays} title={`${habit.name} by weekday`} />
                </Block>
              );
            }
            if (id === "years") {
              return (
                <Block title="By year">
                  <PeriodColumns data={stats.years} title={`${habit.name} by year`} />
                </Block>
              );
            }
            if (id === "linked") {
              return (
                <Block title="Linked tasks" sub="Completing either side fills the other.">
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {linked.map((t) => (
                      <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                        <StatusSq status={t.status} size={9} />
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                        {t.repeat && <span style={{ fontSize: 10.5, color: "var(--color-text-3)" }}>repeats {t.repeat.unit}</span>}
                      </div>
                    ))}
                  </div>
                </Block>
              );
            }
            return null;
          }}
        </PanelGrid>

        {life.ageDays < 45 && (
          <p style={{ fontSize: 11.5, color: "var(--color-text-3)", marginTop: 20, lineHeight: 1.5 }}>
            Monthly and yearly breakdowns appear once there is enough history to compare — around six weeks in.
          </p>
        )}
      </div>
    </Modal>
  );
}
