/* Events — every all-day event in one list, sectioned by kind.

   The Calendar is a month of days that happen to carry events. This is the
   inverse: the events themselves, each shown at the day it NEXT falls on, so
   the yearly ones that are invisible until they are late become the thing you
   actually look at. Date logic lives in lib/eventList.ts; this file is the
   toolbar, the glance band, the accordion and the quick-add.

   Sections start closed and open one at a time. Every header carries its own
   count and next date, so the collapsed state is already the answer to "what
   is coming up" — opening a section is for the detail, not the summary. */

import { useMemo, useState } from "react";
import { newTask, useStore } from "../../lib/store";
import { useMobile } from "../../lib/router";
import { useEditor } from "../../App";
import { fmtDayMed, startOfDay } from "../../lib/dates";
import { EVENT_EMOJIS, EVENT_KINDS, FALLBACK_EVENT_EMOJI, type EventKind } from "../../lib/dayEvents";
import {
  EVENT_SCOPES,
  daysUntil,
  glanceCounts,
  groupByKind,
  nextOccurrenceOf,
  occurrencesInRange,
  relativeDayLabel,
  scopeLabel,
  scopeRange,
  shiftScope,
  upcomingOccurrences,
  type EventOccurrence,
  type EventScope,
} from "../../lib/eventList";
import type { Repeat, Task } from "../../lib/types";
import { Modal, Seg } from "../../components/ui";
import { PanelGrid } from "../../components/PanelGrid";
import { usePanelLayout } from "../../lib/usePanelLayout";
import { resizePanel, type PanelDef } from "../../lib/panelLayout";
import { IChevronL, IChevronR, IPlus, IX } from "../../components/Icons";

/** Sections sit in the same movable grid the Dashboard uses. Two columns
    rather than three: a section is a list of dated rows, and three of them
    across leaves no room for the date. */
const EVENTS_COLS = 2;
const PANEL_ROW_H = 120;

/** The repeat choices the quick-add offers. Anything finer (every 3 weeks,
    every 2 years) stays in the full editor — this list is the 95% case, and a
    quick-add that grows an interval spinner is no longer quick. */
const QUICK_REPEATS: readonly { id: string; label: string; repeat?: Repeat }[] = [
  { id: "none", label: "Once" },
  { id: "yearly", label: "Yearly", repeat: { interval: 1, unit: "yearly" } },
  { id: "monthly", label: "Monthly", repeat: { interval: 1, unit: "monthly" } },
  { id: "weekly", label: "Weekly", repeat: { interval: 1, unit: "weekly" } },
];

/** "2026-09-05" for a native date input — always local, never the UTC slide
    `toISOString()` would give a timezone east or west of Greenwich. */
function dateInputValue(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local midnight of a "2026-09-05" date input value, or undefined if blank. */
function dateInputToDay(value: string): number | undefined {
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return undefined;
  return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
}

export function Events() {
  const { state, dispatch, readOnly } = useStore();
  const { openTask } = useEditor();
  const mobile = useMobile();
  const today = startOfDay(Date.now());
  const weekStart = state.settings.weekStart;

  const [scope, setScope] = useState<EventScope>("year");
  const [cursor, setCursor] = useState(today);
  // Which sections are expanded. Sections used to be an accordion — one open
  // at a time — but that fights being able to place them side by side, so
  // each now opens independently. Absent = closed; the headers alone are
  // still the glance.
  const [openKinds, setOpenKinds] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);

  const range = scopeRange(scope, cursor, weekStart);
  const occurrences = useMemo(
    () => (range ? occurrencesInRange(state.tasks, range) : upcomingOccurrences(state.tasks, today)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.tasks, range?.from, range?.to, today],
  );
  const sections = useMemo(() => groupByKind(occurrences), [occurrences]);
  const glance = useMemo(() => glanceCounts(state.tasks, today), [state.tasks, today]);

  const defs: PanelDef[] = sections.map((section) => ({
    id: section.kind.id,
    title: section.kind.label,
    w: 1,
    h: openKinds.has(section.kind.id) ? 2 : 1,
  }));
  // One column on a phone. Passing the narrower count keeps resolveLayout
  // clamping for display only — nothing is written back, so the arrangement
  // built on a desktop survives being viewed on a phone.
  const cols = mobile ? 1 : EVENTS_COLS;
  const { layout, setLayout, reset, isDefault } = usePanelLayout("events", defs, cols);

  function toggleKind(id: string) {
    const opening = !openKinds.has(id);
    setOpenKinds((prev) => {
      const next = new Set(prev);
      if (opening) next.add(id);
      else next.delete(id);
      return next;
    });
    // Once ANY panel has been arranged the whole surface has saved heights,
    // so a section left at one row would open into a header's worth of space.
    // Give it room; the user can drag it back down.
    // Never on mobile: the layout there is clamped to one column for display,
    // and writing it back would flatten the desktop arrangement.
    const span = layout.find((p) => p.id === id);
    if (!mobile && opening && span && span.h < 2) setLayout(resizePanel(layout, defs, id, span.w, 2, cols));
  }

  function goToday() {
    setCursor(today);
  }

  /** A glance tile jumps the list to the window it counted. */
  function showScope(next: EventScope) {
    setScope(next);
    setCursor(today);
  }

  const stepper = scope !== "all" && (
    <>
      <button className="btn btn-icon btn-secondary" style={{ width: 30, height: 30 }} onClick={() => setCursor(shiftScope(scope, cursor, -1, weekStart))} aria-label={`Previous ${scope}`}>
        <IChevronL size={15} strokeWidth={1.6} />
      </button>
      <button className="btn btn-icon btn-secondary" style={{ width: 30, height: 30 }} onClick={() => setCursor(shiftScope(scope, cursor, 1, weekStart))} aria-label={`Next ${scope}`}>
        <IChevronR size={15} strokeWidth={1.6} />
      </button>
      <button className="btn btn-secondary" style={{ padding: "5px 12px", fontSize: 13 }} onClick={goToday}>Today</button>
    </>
  );

  const toolbar = (
    <div className="ev-toolbar" style={{ padding: mobile ? "0 16px 10px" : "10px 22px", borderBottom: mobile ? "none" : "1px solid var(--color-divider)" }}>
      <Seg
        small={mobile}
        ink
        ariaLabel="Event range"
        items={EVENT_SCOPES.map((s) => ({ id: s.id, label: s.label }))}
        active={scope}
        onSelect={(id) => setScope(id as EventScope)}
      />
      <span className="ev-range" aria-live="polite">{scopeLabel(scope, cursor, weekStart)}</span>
      {stepper}
      {!isDefault && !mobile && (
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: "3px 9px" }} onClick={reset}>
          Reset layout
        </button>
      )}
      {!readOnly && (
        <button className="btn btn-primary ev-add" onClick={() => setAdding(true)}>
          <IPlus size={16} strokeWidth={1.6} />
          Add event
        </button>
      )}
    </div>
  );

  const glanceBand = (
    <div className="ev-glance" style={{ padding: mobile ? "0 16px 12px" : "12px 22px" }}>
      <GlanceTile label="Next 7 days" count={glance.week} onClick={() => showScope("week")} />
      <GlanceTile label="Rest of this month" count={glance.month} onClick={() => showScope("month")} />
      <GlanceTile label="Rest of this year" count={glance.year} onClick={() => showScope("year")} />
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {toolbar}
      {glanceBand}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: mobile ? "0 16px 24px" : "0 22px 24px" }}>
        <PanelGrid
          ariaLabel="Event sections"
          defs={defs}
          layout={layout}
          onLayoutChange={setLayout}
          cols={cols}
          rowHeight={PANEL_ROW_H}
          gap={10}
          // One column on a phone is a list, and a list has nothing to
          // rearrange in two dimensions.
          locked={mobile}
        >
          {(id) => {
            const section = sections.find((s) => s.kind.id === id);
            if (!section) return null;
            return (
              <Section
                kind={section.kind}
                occurrences={section.occurrences}
                today={today}
                open={openKinds.has(id)}
                onToggle={() => toggleKind(id)}
                onOpenTask={openTask}
              />
            );
          }}
        </PanelGrid>
        {sections.length === 0 && (
          <p style={{ margin: "24px 0", fontSize: 13, color: "var(--color-text-2)", textAlign: "center" }}>
            {scope === "all"
              ? "No all-day events yet. Birthdays, anniversaries, holidays and bills live here."
              : `Nothing in ${scopeLabel(scope, cursor, weekStart)}.`}
          </p>
        )}
      </div>
      {adding && (
        <QuickAdd
          defaultDay={range && (today < range.from || today > range.to) ? range.from : today}
          onClose={() => setAdding(false)}
          onSave={(task) => {
            dispatch({ type: "upsertTask", task });
            setAdding(false);
            // Reveal what was just saved rather than leaving it filed away in
            // a collapsed section — and if it lands outside the window on
            // screen (a birthday added while looking at last year), widen to
            // All so the save is visibly a save rather than a silent one.
            if (task.eventKind) setOpenKinds((prev) => new Set(prev).add(task.eventKind!));
            const landsInView = range
              ? (nextOccurrenceOf(task, range.from) ?? Infinity) <= range.to
              : true;
            if (!landsInView) setScope("all");
          }}
        />
      )}
    </div>
  );
}

function GlanceTile({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <button type="button" className="ev-tile" onClick={onClick}>
      <span className="ev-tile-count">{count}</span>
      <span className="ev-tile-label">{label}</span>
    </button>
  );
}

function Section({ kind, occurrences, today, open, onToggle, onOpenTask }: {
  kind: EventKind;
  occurrences: EventOccurrence[];
  today: number;
  open: boolean;
  onToggle: () => void;
  onOpenTask: (id: string) => void;
}) {
  // The collapsed summary is the whole point of the accordion: the soonest
  // day in this section, which is what the header is read for.
  const soonest = occurrences.find((o) => o.day >= today) ?? occurrences[0];
  return (
    <div className="ev-section">
      <button type="button" className="ev-sechead" aria-expanded={open} onClick={onToggle}>
        <span className="ev-secchevron" data-open={open ? "true" : "false"}><IChevronR size={13} strokeWidth={2} /></span>
        <span className="ev-secemoji" aria-hidden="true">{kind.emoji}</span>
        <span className="ev-sectitle">{kind.label}</span>
        <span className="ev-seccount">{occurrences.length}</span>
        {soonest && <span className="ev-secsummary">{fmtDayMed(soonest.day)} · {relativeDayLabel(soonest.day, today)}</span>}
      </button>
      {open && (
        <ul className="ev-list">
          {occurrences.map((occurrence) => (
            <Row
              key={`${occurrence.event.task.id}-${occurrence.day}`}
              occurrence={occurrence}
              today={today}
              onOpen={() => onOpenTask(occurrence.event.task.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ occurrence, today, onOpen }: { occurrence: EventOccurrence; today: number; onOpen: () => void }) {
  const { day, event } = occurrence;
  const delta = daysUntil(day, today);
  return (
    <li>
      <button type="button" className="ev-row" data-past={delta < 0 ? "true" : "false"} onClick={onOpen}>
        <span className="ev-row-emoji" aria-hidden="true">{event.emoji}</span>
        <span className="ev-row-title">{event.title || "Untitled event"}</span>
        {event.repeatLabel && <span className="ev-row-repeat">{event.repeatLabel}</span>}
        <span className="ev-row-date">{fmtDayMed(day)}</span>
        <span className="ev-row-rel" data-soon={delta >= 0 && delta <= 7 ? "true" : "false"}>
          {relativeDayLabel(day, today)}
        </span>
      </button>
    </li>
  );
}

function QuickAdd({ defaultDay, onClose, onSave }: {
  defaultDay: number;
  onClose: () => void;
  onSave: (task: Task) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => dateInputValue(defaultDay));
  const [kindId, setKindId] = useState<string>(EVENT_KINDS[0].id);
  const [emoji, setEmoji] = useState<string>(EVENT_KINDS[0].emoji);
  // The kind's own default repeat unless the user overrides it here.
  const [repeatId, setRepeatId] = useState<string>(EVENT_KINDS[0].defaultRepeat?.unit ?? "none");

  function pickKind(kind: EventKind) {
    setKindId(kind.id);
    setEmoji(kind.emoji);
    setRepeatId(kind.defaultRepeat?.unit ?? "none");
  }

  const day = dateInputToDay(date);
  const canSave = title.trim().length > 0 && day !== undefined;

  function save() {
    if (!canSave) return;
    onSave(newTask({
      title: title.trim(),
      allDay: true,
      emoji: emoji || FALLBACK_EVENT_EMOJI,
      eventKind: kindId,
      // Midnight: an event marks the day, and the editor's own all-day toggle
      // keeps whatever time a task already had for exactly this reason.
      scheduledAt: day,
      repeat: QUICK_REPEATS.find((r) => r.id === repeatId)?.repeat,
    }));
  }

  return (
    <Modal onClose={onClose} width={520}>
      <div className="ev-add-head">
        <span style={{ fontSize: 15, fontWeight: 600 }}>New all-day event</span>
        <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
          <IX size={15} />
        </button>
      </div>
      <div className="ev-add-body">
        <div className="field">
          <label htmlFor="ev-title">Name</label>
          <input
            id="ev-title"
            className="input"
            autoFocus
            value={title}
            placeholder="Priya's birthday"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canSave) save(); }}
          />
        </div>

        <div className="field">
          <label htmlFor="ev-date">Date</label>
          <input id="ev-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div className="field">
          <span className="cap">Kind</span>
          <div className="ev-chiprow">
            {EVENT_KINDS.map((kind) => (
              <button
                key={kind.id}
                type="button"
                className={`chip${kindId === kind.id ? " on" : ""}`}
                aria-pressed={kindId === kind.id}
                onClick={() => pickKind(kind)}
              >
                {kind.emoji} {kind.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="cap">Emoji — shown on the day</span>
          <div className="ev-chiprow">
            {EVENT_EMOJIS.map((glyph) => (
              <button
                key={glyph}
                type="button"
                className="ev-emoji"
                aria-label={`Use ${glyph}`}
                aria-pressed={emoji === glyph}
                data-on={emoji === glyph ? "true" : "false"}
                onClick={() => setEmoji(glyph)}
              >
                {glyph}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="cap">Repeats</span>
          <div className="ev-chiprow">
            {QUICK_REPEATS.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className={`chip${repeatId === choice.id ? " on" : ""}`}
                aria-pressed={repeatId === choice.id}
                onClick={() => setRepeatId(choice.id)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="ev-add-foot">
        <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>
          Every other field — notes, tags, reminders — is in the full editor.
        </span>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!canSave} onClick={save}>Add event</button>
      </div>
    </Modal>
  );
}
