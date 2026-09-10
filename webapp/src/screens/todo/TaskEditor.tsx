import { useEffect, useRef, useState, type ReactNode } from "react";
import { childTasks, newTask, useStore } from "../../lib/store";
import { useMobile, nav } from "../../lib/router";
import { ensurePermission } from "../../lib/notify";
import { parseTimeBlock, parsedBlockToTimeBlock } from "../../lib/mdTasks";
import { STATUS_LABEL, type Priority, type Task, type TaskStatus } from "../../lib/types";
import { Modal, Seg, Toggle } from "../../components/ui";
import { EVENT_EMOJIS, EVENT_KINDS, FALLBACK_EVENT_EMOJI } from "../../lib/dayEvents";
import { eventKindOf } from "../../lib/eventList";
import { DateTimeField } from "../../components/TimeField";
import { ReminderPicker, reminderLabel } from "../../components/ReminderPicker";
import { ICalendar, ICheck, IChevronR, IClock, IDeadline, IGrab, ILock, IPlus, ITrash, IUnlock, IX } from "../../components/Icons";
import { fmtDateTime, fmtMin } from "../../lib/dates";
import { occurrenceDateKey, occurrenceStatusOf, occurrenceTask } from "../../lib/occurrence";
import { childIndex, subtreeIds } from "../../lib/taskTree";

/** Collapsible section for the task editor. Defined at module level (NOT inside
    TaskEditor) so it keeps a stable component identity across renders — an
    inline definition is a new component type every render, so React remounts its
    inputs on each keystroke and they lose focus after one character. */
function Section({ title, summary, open, onToggle, children }: {
  title: string;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const sectionRef = useRef<HTMLDivElement>(null);
  // Bring the freshly opened section fully into the editor's scroll view —
  // without this, a section opened near the bottom sits half cut at the
  // scroll edge and looks like it never fully expanded.
  useEffect(() => {
    if (open) {
      sectionRef.current?.scrollIntoView({
        block: "nearest",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
  }, [open]);
  return (
    <div className="te-section" ref={sectionRef}>
      <button type="button" className="te-sechead" aria-expanded={open} onClick={onToggle}>
        <span className="te-secchevron" data-open={open ? "true" : "false"}><IChevronR size={13} strokeWidth={2} /></span>
        <span className="te-sectitle">{title}</span>
        {!open && summary != null && <span className="te-secsummary">{summary}</span>}
      </button>
      {open && <div className="te-secbody">{children}</div>}
    </div>
  );
}

export function TaskEditor({ taskId, presets, onClose }: {
  taskId: string | null;
  presets?: { scheduledAt?: number; parentId?: string };
  onClose: () => void;
}) {
  const { state, dispatch, readOnly } = useStore();
  const mobile = useMobile();
  const existing = taskId ? state.tasks.find((t) => t.id === taskId) : undefined;
  // Routines open showing TODAY's occurrence status (the template's own
  // status is never shown or edited here — save() maps a change back into
  // today's override).
  const [draft, setDraft] = useState<Task>(() => existing ? { ...occurrenceTask(existing, Date.now()) } : newTask(presets));
  const [tagInput, setTagInput] = useState("");
  const [newSub, setNewSub] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Subtasks staged on the draft rather than dispatched immediately, so the
  // section works for a task that does not exist yet and so Cancel really
  // cancels. Both lists are flushed in save(), after the parent is written.
  const [stagedTitles, setStagedTitles] = useState<string[]>([]);
  const [stagedAttachIds, setStagedAttachIds] = useState<string[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [attachQuery, setAttachQuery] = useState("");
  // Drag-to-reorder saved subtask rows.
  const subDrag = useRef<string | null>(null);
  const [subOver, setSubOver] = useState<string | null>(null);

  const subs = existing ? childTasks(state, existing.id) : [];
  const stagedAttached = stagedAttachIds
    .map((id) => state.tasks.find((t) => t.id === id))
    .filter((t): t is Task => t !== undefined);
  const subCount = subs.length + stagedTitles.length + stagedAttached.length;
  const doneSubs = [...subs, ...stagedAttached].filter((s) => s.status === "done").length;

  /** Tasks that may become a subtask of this one: anything that is not the
      task itself, not already one of its children, and not one of its own
      descendants — reparenting a descendant would build a cycle. */
  const attachCandidates = (() => {
    const forbidden = existing ? subtreeIds(childIndex(state.tasks), existing.id) : new Set<string>([draft.id]);
    const q = attachQuery.trim().toLowerCase();
    return state.tasks
      .filter((t) => !forbidden.has(t.id) && t.parentId !== draft.id && !stagedAttachIds.includes(t.id))
      .filter((t) => (q ? t.title.toLowerCase().includes(q) : true))
      .slice(0, 8);
  })();

  // Accordion (user decision 2026-07-19): every section starts collapsed and
  // at most one is open at a time — opening a section closes the previous
  // one. The summaries on the collapsed headers carry what's set, so nothing
  // is hidden, and the editor never grows taller than one section's content.
  const [openSection, setOpenSection] = useState<string | null>(null);
  const open = (id: string) => openSection === id;
  const toggle = (id: string) => setOpenSection((current) => (current === id ? null : id));

  const set = (patch: Partial<Task>) => setDraft((d) => ({ ...d, ...patch }));

  function commitTag() {
    const tag = tagInput.trim().replace(/^#/, "");
    if (tag && !draft.tags.includes(tag)) set({ tags: [...draft.tags, tag] });
    setTagInput("");
  }

  function save() {
    const title = draft.title.trim();
    if (!title) return;
    // `[block]label [HHMM:HHMM][nX]` from the add editor becomes a
    // blocked-time placeholder, exactly like the desktop and md import.
    const asBlock = !existing ? parseTimeBlock(title) : undefined;
    if (asBlock) {
      dispatch({ type: "addBlock", block: parsedBlockToTimeBlock(asBlock) });
      onClose();
      return;
    }
    const completedAt = draft.status === "done" ? (draft.completedAt ?? Date.now()) : undefined;
    let task: Task = { ...draft, title, completedAt };
    // Routines: the status control edited today's occurrence — record it as
    // the per-day override and restore the template's own status/completedAt.
    if (task.repeat) {
      const before = existing ? occurrenceStatusOf(existing, Date.now()) : "pending";
      task = {
        ...task,
        status: existing?.status ?? "pending",
        completedAt: existing?.completedAt,
        occurrenceStatus: draft.status === before
          ? task.occurrenceStatus
          : { ...task.occurrenceStatus, [occurrenceDateKey(Date.now())]: draft.status },
      };
    }
    dispatch({ type: "upsertTask", task });
    // Parent first: the children below reference task.id, and each dispatch
    // re-derives parent status from whatever is already in the tree.
    // New subtasks are prerequisites you just realised — they slot in BEFORE
    // the existing ones (keeping their own typed order), so the chronology is
    // "the thing I forgot, then what I already had".
    const firstExistingSub = subs[0]?.id;
    const stagedIds: string[] = [];
    for (const title of stagedTitles) {
      const child = newTask({ title, parentId: task.id, priority: task.priority });
      stagedIds.push(child.id);
      dispatch({ type: "upsertTask", task: child });
    }
    if (firstExistingSub) {
      for (const id of stagedIds) {
        dispatch({ type: "reorderTask", id, targetId: firstExistingSub, place: "before" });
      }
    }
    for (const id of stagedAttachIds) {
      const attach = state.tasks.find((t) => t.id === id);
      if (attach) dispatch({ type: "upsertTask", task: { ...attach, parentId: task.id } });
    }
    onClose();
  }

  function startTimer() {
    if (!draft.title.trim()) return;
    const task = draft.repeat
      ? { ...draft, title: draft.title.trim(), status: existing?.status ?? "pending", completedAt: existing?.completedAt }
      : { ...draft, title: draft.title.trim() };
    dispatch({ type: "upsertTask", task });
    void ensurePermission();
    dispatch({ type: "timerStart", taskId: draft.id });
    onClose();
    nav("/timer");
  }

  /** What "inherit" means here, spelled out so the chip is not a mystery. */
  const accountReminderSummary = `Account default · ${reminderLabel(state.settings.google?.reminderMinutes)}`;

  const scheduleSummary = [
    draft.scheduledAt ? fmtDateTime(draft.scheduledAt) : "",
    draft.deadline ? `due ${fmtDateTime(draft.deadline)}` : "",
    draft.estimateMin ? `~${fmtMin(draft.estimateMin)}` : "",
    draft.loggedMin ? `${fmtMin(draft.loggedMin)} logged` : "",
    draft.locked ? "locked" : "",
  ].filter(Boolean).join(" · ") || "Not scheduled";

  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: mobile ? "12px 16px" : "16px 20px", borderBottom: "1px solid var(--color-divider)" }}>
        {mobile && (
          <button className="btn btn-icon btn-ghost" style={{ width: 30, height: 30, color: "var(--color-text-2)" }} onClick={onClose} aria-label="Close">
            <IX size={17} />
          </button>
        )}
        <span className="cap" style={{ fontSize: 11, flex: mobile ? 1 : undefined }}>{readOnly ? "View task" : existing ? "Edit task" : "New task"}</span>
        {!mobile && <h3 style={{ fontSize: 22, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{draft.title || "Untitled"}</h3>}
        {mobile && !readOnly ? (
          <button className="btn btn-primary" style={{ height: 32, padding: "0 14px" }} onClick={save} disabled={!draft.title.trim()}>Save</button>
        ) : (
          <button className="btn btn-icon btn-ghost" style={{ width: 32, height: 32, color: "var(--color-text-2)" }} onClick={onClose} aria-label="Close">
            <IX size={17} />
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: mobile ? 16 : "16px 20px" }}>
        <div className="field">
          <label htmlFor="te-title">Title</label>
          <input id="te-title" className="input" value={draft.title} autoFocus={!existing} onChange={(e) => set({ title: e.target.value })} />
          {!existing && draft.title.trim().toLowerCase().startsWith("[block]") && (
            <p style={{ fontSize: 11, color: parseTimeBlock(draft.title) ? "var(--accent-strong)" : "var(--color-text-2)" }}>
              {parseTimeBlock(draft.title)
                ? "Saves as a blocked-time placeholder, not a task."
                : "Blocked time: [block]label [HHMM:HHMM][nD|nW|nM]"}
            </p>
          )}
        </div>

        <Section
          open={open("desc")}
          onToggle={() => toggle("desc")}
          title="Description"
          summary={draft.description?.trim() ? draft.description.trim().slice(0, 40) : draft.comment?.trim() ? draft.comment.trim().slice(0, 40) : "Add notes or [[links]]"}
        >
          <textarea
            id="te-desc"
            className="input"
            style={{ fontSize: 13 }}
            value={draft.description ?? ""}
            placeholder="Notes, context, [[note links]]…"
            onChange={(e) => set({ description: e.target.value })}
          />
          {/* Same field the list view's Comment column edits. Surfaced here too
              because that column is desktop-only, and a quick note is exactly
              the thing you want to jot from a phone. */}
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="te-comment">Comment</label>
            <input
              id="te-comment"
              className="input"
              style={{ fontSize: 13 }}
              value={draft.comment ?? ""}
              placeholder="Quick note — “waiting on the API key”"
              onChange={(e) => set({ comment: e.target.value || undefined })}
            />
          </div>
        </Section>

        <Section open={open("meta")} onToggle={() => toggle("meta")} title="Status & priority" summary={`${STATUS_LABEL[draft.status]} · P${draft.priority}`}>
          <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: 16 }}>
            <div className="field">
              <label>Status</label>
              <Seg
                ariaLabel="Status"
                items={[
                  { id: "pending", label: "Pending" },
                  { id: "in_progress", label: "Active" },
                  { id: "done", label: "Done" },
                  { id: "skipped", label: "Skipped" },
                ]}
                active={draft.status}
                onSelect={(id) => set({ status: id as TaskStatus })}
              />
            </div>
            <div className="field">
              <label>Priority</label>
              <div style={{ display: "flex", gap: 6 }} role="radiogroup" aria-label="Priority">
                {([0, 1, 2, 3] as Priority[]).map((p) => {
                  const active = draft.priority === p;
                  return (
                    <button
                      key={p}
                      role="radio"
                      aria-checked={active}
                      onClick={() => set({ priority: p })}
                      style={{
                        flex: 1, textAlign: "center", font: "600 12px var(--font-heading)", padding: "8px 0", cursor: "pointer",
                        border: active ? "1.5px solid var(--color-accent)" : "1px solid var(--color-divider)",
                        borderRadius: "var(--radius)",
                        background: active ? "var(--color-accent)" : "transparent",
                        color: active ? "var(--on-accent)" : "var(--color-text-2)",
                      }}
                    >
                      P{p}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Section>

        <Section open={open("schedule")} onToggle={() => toggle("schedule")} title="Schedule & estimate" summary={scheduleSummary}>
          {/* One column on mobile: two date+time pairs side by side overflow
              a phone viewport. */}
          <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr 1fr", gap: mobile ? 12 : 16 }}>
            <div className="field">
              <label htmlFor="te-sched" style={{ display: "flex", alignItems: "center", gap: 5 }}><ICalendar size={12} />Scheduled</label>
              <DateTimeField id="te-sched" ariaLabel="Scheduled" value={draft.scheduledAt} onChange={(ms) => set({ scheduledAt: ms })} />
            </div>
            <div className="field">
              <label htmlFor="te-dead" style={{ display: "flex", alignItems: "center", gap: 5 }}><IDeadline size={12} />Deadline</label>
              <DateTimeField id="te-dead" ariaLabel="Deadline" value={draft.deadline} onChange={(ms) => set({ deadline: ms })} />
            </div>
            <div className="field">
              <label htmlFor="te-est">Estimate (min)</label>
              <input id="te-est" type="number" min={0} step={5} className="input" style={{ fontSize: 13 }} value={draft.estimateMin ?? ""} placeholder="—" onChange={(e) => set({ estimateMin: e.target.value ? Number(e.target.value) : undefined })} />
              <div style={{ display: "flex", gap: 4 }}>
                {[15, 30, 45, 60].map((m) => (
                  <button key={m} onClick={() => set({ estimateMin: m })} style={{ flex: 1, border: "1px solid var(--color-divider)", borderRadius: "var(--radius-sm)", background: draft.estimateMin === m ? "var(--accent-soft)" : "none", color: "var(--color-text-2)", fontSize: 11, padding: "2px 0", cursor: "pointer" }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {/* Backfill for late status moves: if work started before the task
                was flipped to Active, feed the minutes here — "took X" on the
                done card then comes out right (loggedMin + timer sessions). */}
            <div className="field">
              <label htmlFor="te-elapsed" style={{ display: "flex", alignItems: "center", gap: 5 }}><IClock size={12} />Elapsed (min)</label>
              <input id="te-elapsed" type="number" min={0} step={5} className="input" style={{ fontSize: 13 }} value={draft.loggedMin || ""} placeholder="0" onChange={(e) => set({ loggedMin: e.target.value ? Math.max(0, Number(e.target.value)) : 0 })} />
            </div>
          </div>
          {/* The editor opens from every surface — board, list, schedule,
              calendar, dashboard — so this is the one lock control that is
              always within reach, whichever view you spotted the task in. */}
          <label
            style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 16, cursor: "pointer" }}
            title="A locked task is an appointment: auto-scheduling never moves it, and never places other work within the break either side of it."
          >
            <input
              type="checkbox"
              checked={draft.locked ?? false}
              onChange={(e) => set({ locked: e.target.checked || undefined })}
              // accentColor matches the app's other checkboxes; the whole label
              // is the hit area, so the box itself never needs to be finger-sized.
              style={{ marginTop: 2, flex: "none", accentColor: "var(--color-accent)", width: mobile ? 18 : undefined, height: mobile ? 18 : undefined }}
            />
            <span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500 }}>
                {draft.locked ? <ILock size={12} /> : <IUnlock size={12} />}
                Lock scheduling
              </span>
              <span style={{ display: "block", fontSize: 12, color: "var(--color-text-2)", marginTop: 3 }}>
                Freeze these times. Drags, re-packs and the day-start re-plan leave the task alone, and nothing else is
                scheduled within the break either side of it. Status, priority and tags stay editable.
              </span>
            </span>
          </label>
        </Section>

        {/* Events sit directly above Repeat: making something an event is
            almost always followed by setting it to repeat yearly, and picking
            a kind below does exactly that in one tap. */}
        <Section
          open={open("event")}
          onToggle={() => toggle("event")}
          title="All-day event"
          summary={draft.allDay ? `${draft.emoji ?? FALLBACK_EVENT_EMOJI} ${draft.title || "Event"}` : "No"}
        >
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <Toggle
              on={!!draft.allDay}
              onChange={(on) =>
                set(
                  on
                    ? { allDay: true, emoji: draft.emoji ?? FALLBACK_EVENT_EMOJI }
                    : { allDay: false },
                )
              }
              label="All-day event"
            />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>Mark the whole day</span>
              <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>
                Birthdays, anniversaries and holidays have no start time. They hang
                under the date as a notch instead of taking an hour on the schedule.
                Your scheduled time is kept, just ignored — switching this back
                restores it.
              </span>
            </span>
          </label>

          {draft.allDay && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="cap">Kind</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {EVENT_KINDS.map((kind) => {
                    // Pressed state reads the recorded kind, falling back to
                    // the emoji — so an event saved before `eventKind` existed
                    // still shows which kind it is.
                    const picked = eventKindOf(draft) === kind.id;
                    return (
                      <button
                        key={kind.id}
                        type="button"
                        className="btn btn-secondary"
                        aria-pressed={picked}
                        onClick={() =>
                          // A kind fills the emoji and, where one obviously
                          // applies, the routine — one tap for the common case,
                          // still fully overridable in Repeat below. It also
                          // records the kind itself, which is the section this
                          // event lands in on the Events screen.
                          set({ eventKind: kind.id, emoji: kind.emoji, ...(kind.defaultRepeat ? { repeat: kind.defaultRepeat } : {}) })
                        }
                        style={{
                          padding: "4px 10px", fontSize: 12,
                          borderColor: picked ? "var(--event-edge)" : undefined,
                          background: picked ? "var(--event-tint)" : undefined,
                          color: picked ? "var(--event-ink)" : undefined,
                        }}
                      >
                        {kind.emoji} {kind.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="cap">Emoji — shown on the day</span>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {EVENT_EMOJIS.map((glyph) => (
                    <button
                      key={glyph}
                      type="button"
                      aria-label={`Use ${glyph}`}
                      aria-pressed={draft.emoji === glyph}
                      onClick={() => set({ emoji: glyph })}
                      style={{
                        width: 30, height: 30, fontSize: 15, lineHeight: 1, cursor: "pointer",
                        borderRadius: "var(--radius)",
                        border: `1px solid ${draft.emoji === glyph ? "var(--event-edge)" : "var(--color-divider)"}`,
                        background: draft.emoji === glyph ? "var(--event-tint)" : "var(--color-card)",
                      }}
                    >
                      {glyph}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Section>

        <Section open={open("repeat")} onToggle={() => toggle("repeat")} title="Repeat" summary={draft.repeat ? `Every ${draft.repeat.interval > 1 ? `${draft.repeat.interval} ` : ""}${draft.repeat.unit.replace("ly", draft.repeat.interval > 1 ? "s" : "")}` : "None"}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Seg
              ariaLabel="Repeat"
              small
              items={[
                { id: "none", label: "None" },
                { id: "daily", label: "Daily" },
                { id: "weekly", label: "Weekly" },
                { id: "monthly", label: "Monthly" },
                { id: "yearly", label: "Yearly" },
              ]}
              active={draft.repeat?.unit ?? "none"}
              onSelect={(id) => set({ repeat: id === "none" ? undefined : { interval: draft.repeat?.interval ?? 1, unit: id as NonNullable<Task["repeat"]>["unit"] } })}
            />
            {draft.repeat && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-text-2)" }}>
                every
                <input
                  type="number"
                  min={1}
                  aria-label="Repeat interval"
                  value={draft.repeat.interval}
                  onChange={(e) => set({ repeat: { ...draft.repeat!, interval: Math.max(1, Number(e.target.value) || 1) } })}
                  className="input"
                  style={{ width: 56, minHeight: 28, padding: "2px 6px", fontSize: 12 }}
                />
                {draft.repeat.unit === "daily" ? "day(s)" : draft.repeat.unit === "weekly" ? "week(s)" : draft.repeat.unit === "yearly" ? "year(s)" : "month(s)"} from its scheduled day
              </span>
            )}
          </div>
        </Section>

        {/* The other end of the habit binding (lib/habitLink.ts). Offered only
            when habits exist at all — an empty picker is a question about a
            feature the user has not opted into. */}
        {state.habits.some((h) => !h.archivedAt) && (() => {
          const live = state.habits.filter((h) => !h.archivedAt);
          const picked = draft.habitIds ?? [];
          /* Absent rather than an empty array when nothing is picked, so a
             task that was never linked stays byte-identical to what it was. */
          const toggleHabit = (id: string) => {
            const next = picked.includes(id) ? picked.filter((h) => h !== id) : [...picked, id];
            set({ habitIds: next.length ? next : undefined });
          };
          const names = live.filter((h) => picked.includes(h.id)).map((h) => h.name);

          return (
            <Section
              open={open("habit")}
              onToggle={() => toggle("habit")}
              title="Habits"
              summary={
                names.length === 0 ? "Not linked"
                : names.length <= 2 ? names.join(", ")
                : `${names[0]} +${names.length - 1}`
              }
            >
              <p style={{ fontSize: 12, color: "var(--color-text-2)", margin: "0 0 10px" }}>
                Feed habit streaks with this task &mdash; pick as many as it covers. Completing the task fills all of
                them, and the task closes once every one is kept, on the day this task is scheduled for &mdash; so
                ticking Monday&rsquo;s task on Tuesday still credits Monday.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {live.map((h) => (
                  <button
                    key={h.id}
                    className={`chip${picked.includes(h.id) ? " on" : ""}`}
                    aria-pressed={picked.includes(h.id)}
                    onClick={() => toggleHabit(h.id)}
                  >
                    {h.emoji ? `${h.emoji} ` : ""}{h.name}
                  </button>
                ))}
              </div>
              {names.length > 1 && (
                <p style={{ fontSize: 11.5, color: "var(--color-text-2)", margin: "8px 0 0" }}>
                  This task stays open until all {names.length} are kept.
                </p>
              )}
            </Section>
          );
        })()}

        {/* Only meaningful once the task reaches a calendar, so it sits behind
            a collapsed section — but it is offered for every task, since a
            task acquires a Google link the moment the next sync runs. */}
        <Section
          open={open("reminder")}
          onToggle={() => toggle("reminder")}
          title="Reminder"
          summary={reminderLabel(draft.reminderMinutes, accountReminderSummary)}
        >
          <p style={{ fontSize: 12, color: "var(--color-text-2)", margin: "0 0 10px" }}>
            How long before this task's Google Calendar event the notification pops. Leave it on
            “{accountReminderSummary}” to follow Settings → Google Calendar.
          </p>
          <ReminderPicker
            value={draft.reminderMinutes}
            onChange={(v) => set({ reminderMinutes: v })}
            inheritLabel={accountReminderSummary}
          />
        </Section>

        <Section open={open("tags")} onToggle={() => toggle("tags")} title="Tags" summary={draft.tags.length ? draft.tags.map((t) => `#${t}`).join(" ") : "None"}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {draft.tags.map((tag) => (
              <span key={tag} className="tag tag-accent">
                {tag}
                <button onClick={() => set({ tags: draft.tags.filter((x) => x !== tag) })} aria-label={`Remove ${tag}`} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "inherit", display: "flex" }}>
                  <IX size={10} />
                </button>
              </span>
            ))}
            <input
              id="te-tag"
              value={tagInput}
              placeholder="add"
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitTag(); } }}
              onBlur={commitTag}
              style={{ border: "1px dashed var(--color-divider)", background: "none", padding: "3px 8px", fontSize: 12, width: 90, color: "var(--color-text)" }}
            />
          </div>
        </Section>

        {/* Available while creating a task too, not just when editing one — a
            plan is usually broken down at the moment it is written. Hidden only
            when this task is itself a subtask. */}
        {!draft.parentId && (
          <Section
            open={open("subs")}
            onToggle={() => toggle("subs")}
            title={`Subtasks · ${doneSubs} / ${subCount}`}
            summary={subCount ? `${doneSubs}/${subCount} done` : "Break this down"}
          >
            <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--color-divider)" }}>
              {subs.map((s) => (
                <div
                  key={s.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid var(--color-divider)", boxShadow: subOver === s.id ? "inset 0 2px 0 0 var(--color-accent)" : undefined }}
                  onDragOver={(e) => { if (subDrag.current && subDrag.current !== s.id) { e.preventDefault(); setSubOver(s.id); } }}
                  onDragLeave={() => setSubOver((c) => (c === s.id ? null : c))}
                  onDrop={(e) => {
                    if (subDrag.current && subDrag.current !== s.id) {
                      e.preventDefault();
                      dispatch({ type: "reorderTask", id: subDrag.current, targetId: s.id, place: "before" });
                    }
                    subDrag.current = null; setSubOver(null);
                  }}
                >
                  <span
                    draggable
                    onDragStart={(e) => { subDrag.current = s.id; e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { subDrag.current = null; setSubOver(null); }}
                    aria-label={`Reorder ${s.title}`}
                    title="Drag to reorder"
                    style={{ display: "flex", cursor: "grab", color: "var(--color-text-3)", flex: "none" }}
                  >
                    <IGrab size={12} />
                  </span>
                  <button
                    aria-label={s.status === "done" ? `Reopen ${s.title}` : `Complete ${s.title}`}
                    onClick={() => dispatch({ type: "setStatus", id: s.id, status: s.status === "done" ? "pending" : "done" })}
                    style={{ border: s.status === "done" ? "none" : "1.5px solid var(--color-text-3)", background: "none", width: 15, height: 15, padding: 0, cursor: "pointer", display: "grid", placeItems: "center", color: "var(--color-accent)" }}
                  >
                    {s.status === "done" && <ICheck size={15} strokeWidth={2.2} />}
                  </button>
                  <span style={{ flex: 1, fontSize: 13, ...(s.status === "done" ? { textDecoration: "line-through", color: "var(--color-text-2)" } : {}) }}>{s.title}</span>
                  {s.estimateMin && <span style={{ fontSize: 11, color: "var(--color-text-3)" }}>~{s.estimateMin}m</span>}
                </div>
              ))}

              {/* Staged rows — written when the task is saved, dropped on cancel. */}
              {stagedAttached.map((s) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid var(--color-divider)", background: "var(--accent-wash)" }}>
                  <span style={{ flex: 1, fontSize: 13 }}>
                    {s.title}
                    <span style={{ fontSize: 11, color: "var(--color-text-2)", marginLeft: 6 }}>
                      {s.parentId ? "will move here on save" : "will be attached on save"}
                    </span>
                  </span>
                  <button
                    aria-label={`Don't attach ${s.title}`}
                    onClick={() => setStagedAttachIds((ids) => ids.filter((x) => x !== s.id))}
                    style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: "var(--color-text-2)", display: "flex" }}
                  >
                    <IX size={13} />
                  </button>
                </div>
              ))}
              {stagedTitles.map((title, i) => (
                <div key={`${title}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid var(--color-divider)", background: "var(--accent-wash)" }}>
                  <span style={{ flex: 1, fontSize: 13 }}>
                    {title}
                    <span style={{ fontSize: 11, color: "var(--color-text-2)", marginLeft: 6 }}>new</span>
                  </span>
                  <button
                    aria-label={`Remove ${title}`}
                    onClick={() => setStagedTitles((list) => list.filter((_, k) => k !== i))}
                    style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: "var(--color-text-2)", display: "flex" }}
                  >
                    <IX size={13} />
                  </button>
                </div>
              ))}

              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 12px", color: "var(--color-text-2)", fontSize: 13 }}>
                <IPlus size={14} />
                <input
                  value={newSub}
                  placeholder="Add a new subtask"
                  aria-label="New subtask title"
                  onChange={(e) => setNewSub(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newSub.trim()) {
                      e.preventDefault();
                      setStagedTitles((list) => [...list, newSub.trim()]);
                      setNewSub("");
                    }
                  }}
                  style={{ border: "none", background: "none", flex: 1, padding: "5px 0", fontSize: 13, color: "var(--color-text)" }}
                />
              </div>
            </div>

            {attaching ? (
              <div style={{ marginTop: 8, border: "1px solid var(--color-divider)", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    className="input"
                    autoFocus
                    value={attachQuery}
                    placeholder="Search existing tasks…"
                    aria-label="Search tasks to attach"
                    onChange={(e) => setAttachQuery(e.target.value)}
                    style={{ flex: 1, fontSize: 13 }}
                  />
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: "0 8px" }} onClick={() => { setAttaching(false); setAttachQuery(""); }}>Done</button>
                </div>
                {attachCandidates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setStagedAttachIds((ids) => [...ids, t.id]); setAttachQuery(""); }}
                    style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left", border: "1px solid var(--color-divider)", background: "none", padding: "6px 9px", cursor: "pointer", color: "var(--color-text)", fontSize: 13 }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                    <span style={{ fontSize: 11, color: "var(--color-text-3)", flex: "none" }}>{STATUS_LABEL[t.status]}</span>
                  </button>
                ))}
                {attachCandidates.length === 0 && (
                  <p style={{ fontSize: 12, color: "var(--color-text-2)", margin: 0 }}>
                    {attachQuery ? "No matching task." : "No other task is available to attach."}
                  </p>
                )}
              </div>
            ) : (
              <button className="btn btn-secondary" style={{ marginTop: 8, fontSize: 12, padding: "4px 10px" }} onClick={() => setAttaching(true)}>
                Attach an existing task
              </button>
            )}
          </Section>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: mobile ? "12px 16px" : "14px 20px", borderTop: "1px solid var(--color-divider)" }}>
        {readOnly ? (
          <button className={mobile ? "btn btn-secondary btn-block" : "btn btn-secondary"} style={mobile ? { height: 40 } : { marginLeft: "auto" }} onClick={onClose}>Close</button>
        ) : (
          <>
            <button className={mobile ? "btn btn-secondary btn-block" : "btn btn-ghost"} style={mobile ? { height: 40, flex: 1 } : { color: "var(--accent-strong)" }} onClick={startTimer} disabled={!draft.title.trim()}>
              <IClock size={15} />
              Start timer
            </button>
            {/* Mobile delete lived nowhere — desktop had it in this footer, so
                a phone could only delete via a card's ⋯ menu. */}
            {mobile && existing && (
              confirmDelete ? (
                <button className="btn btn-secondary" style={{ height: 40, flex: "none", color: "var(--prio-hi-text)", borderColor: "var(--prio-hi-border)" }} onClick={() => { dispatch({ type: "deleteTask", id: existing.id }); onClose(); }}>
                  Really delete?
                </button>
              ) : (
                <button className="btn btn-icon btn-secondary" style={{ width: 40, height: 40, flex: "none", color: "var(--color-text-2)" }} onClick={() => setConfirmDelete(true)} aria-label="Delete task">
                  <ITrash size={16} />
                </button>
              )
            )}
            {!mobile && (
              <>
                {existing && (
                  confirmDelete ? (
                    <button className="btn btn-secondary" style={{ marginLeft: "auto", color: "var(--prio-hi-text)", borderColor: "var(--prio-hi-border)" }} onClick={() => { dispatch({ type: "deleteTask", id: existing.id }); onClose(); }}>
                      Really delete?
                    </button>
                  ) : (
                    <button className="btn btn-ghost" style={{ marginLeft: "auto", color: "var(--color-text-2)" }} onClick={() => setConfirmDelete(true)}>
                      <ITrash size={15} />
                      Delete
                    </button>
                  )
                )}
                <button className="btn btn-secondary" style={existing ? {} : { marginLeft: "auto" }} onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" onClick={save} disabled={!draft.title.trim()}>Save task</button>
              </>
            )}
          </>
        )}
      </div>
    </>
  );

  if (mobile) {
    return <div className="sheet">{body}</div>;
  }
  return <Modal onClose={onClose}>{body}</Modal>;
}
