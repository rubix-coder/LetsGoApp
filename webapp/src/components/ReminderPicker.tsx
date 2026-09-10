/* How long before an event Google should pop its reminder.

   Google's own default is 30 minutes, and until this existed that was the only
   answer the app could give: a task that wanted a nudge AT its start time, or
   five minutes ahead, had no way to say so. The control appears twice — once in
   Settings as the account-wide default, once in the task editor as that task's
   override — so it is one component with an "inherit" chip that the editor
   shows and Settings does not. */

import { useState } from "react";
import type { ReminderChoice } from "../lib/types";

/** The one-tap answers, shortest first. Anything else goes in the custom box. */
const PRESETS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "At start" },
  { minutes: 5, label: "5 min" },
  { minutes: 10, label: "10 min" },
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 1440, label: "1 day" },
];

/** "10 min before", "at start", "1 day before" — the phrasing used in summaries. */
export function reminderLabel(choice: ReminderChoice | undefined, inheritLabel = "Calendar default"): string {
  if (choice === undefined || choice === "default") return inheritLabel;
  if (choice === "none") return "No reminder";
  if (choice === 0) return "At start";
  const preset = PRESETS.find((p) => p.minutes === choice);
  if (preset) return `${preset.label} before`;
  if (choice % 1440 === 0) return `${choice / 1440} day${choice / 1440 === 1 ? "" : "s"} before`;
  if (choice % 60 === 0) return `${choice / 60} hour${choice / 60 === 1 ? "" : "s"} before`;
  return `${choice} min before`;
}

const chip = (active: boolean): React.CSSProperties => ({
  border: `1px solid ${active ? "var(--color-accent)" : "var(--color-divider)"}`,
  background: active ? "var(--accent-wash)" : "var(--color-surface)",
  color: active ? "var(--accent-strong)" : "var(--color-text-2)",
  fontWeight: active ? 600 : 400,
  borderRadius: "var(--radius-sm, 6px)",
  cursor: "pointer",
  fontSize: 12,
  padding: "4px 9px",
  fontFamily: "var(--font-body)",
});

export function ReminderPicker({
  value,
  onChange,
  inheritLabel,
  disabled,
}: {
  value: ReminderChoice | undefined;
  onChange: (next: ReminderChoice | undefined) => void;
  /** Wording for the "leave it to whatever is above me" chip. Omit to hide it —
      Settings is the top of the chain, so it has nothing to inherit from. */
  inheritLabel?: string;
  disabled?: boolean;
}) {
  const custom = typeof value === "number" && !PRESETS.some((p) => p.minutes === value);
  const [customText, setCustomText] = useState(custom ? String(value) : "");
  const [customOpen, setCustomOpen] = useState(custom);

  const pick = (next: ReminderChoice | undefined) => {
    if (disabled) return;
    setCustomOpen(false);
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {inheritLabel !== undefined && (
        <button type="button" disabled={disabled} style={chip(value === undefined)} onClick={() => pick(undefined)}>
          {inheritLabel}
        </button>
      )}
      <button type="button" disabled={disabled} style={chip(value === "default")} onClick={() => pick("default")}>
        Calendar default
      </button>
      {PRESETS.map((p) => (
        <button key={p.minutes} type="button" disabled={disabled} style={chip(value === p.minutes)} onClick={() => pick(p.minutes)}>
          {p.label}
        </button>
      ))}
      <button type="button" disabled={disabled} style={chip(value === "none")} onClick={() => pick("none")}>
        None
      </button>
      {customOpen ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input
            className="input"
            type="number"
            min={0}
            max={40320}
            autoFocus
            aria-label="Custom reminder, minutes before the event"
            value={customText}
            disabled={disabled}
            onChange={(e) => {
              setCustomText(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== "" && Number.isFinite(n) && n >= 0) onChange(Math.round(n));
            }}
            style={{ width: 74, fontSize: 12, padding: "3px 6px" }}
          />
          <span style={{ fontSize: 11, color: "var(--color-text-3)" }}>min before</span>
        </span>
      ) : (
        <button type="button" disabled={disabled} style={chip(custom)} onClick={() => { setCustomOpen(true); setCustomText(custom ? String(value) : "45"); if (!custom) onChange(45); }}>
          Custom…
        </button>
      )}
    </div>
  );
}
