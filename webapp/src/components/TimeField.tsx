// App-controlled date/time fields. Native datetime-local and time inputs
// render in the DEVICE locale and ignore the Settings clock style — a 24h
// app still showed AM/PM pickers — and their segmented typing garbles. So:
// a native date input (dates have no clock-style problem) beside a
// free-typed time field that displays and parses per the app's clock
// setting ("14:30", or "2:30 PM" in 12-hour mode; typing either always
// works). Invalid text reverts on blur.

import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { fmtClockMin, parseClockText, startOfDay } from "../lib/dates";

export function TimeField({ minutes, onChange, disabled, ariaLabel, width = 96, fontSize = 13 }: {
  /** Minutes from local midnight; undefined renders an empty field. */
  minutes?: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
  ariaLabel: string;
  width?: number;
  fontSize?: number;
}) {
  const { state } = useStore();
  const hourFormat = state.settings.hourFormat ?? "24";
  const display = minutes !== undefined ? fmtClockMin(minutes) : "";
  const [text, setText] = useState(display);
  // Re-sync when the value or the clock style changes under the field.
  useEffect(() => { setText(display); }, [display, hourFormat]);

  const commit = () => {
    const parsed = parseClockText(text);
    if (parsed === null || parsed === minutes) {
      setText(display); // unreadable or unchanged: show the stored value again
      return;
    }
    onChange(parsed);
  };

  return (
    <input
      className="input"
      style={{ width, fontSize }}
      inputMode="numeric"
      placeholder={hourFormat === "12" ? "2:30 PM" : "14:30"}
      aria-label={ariaLabel}
      disabled={disabled}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function toDateInput(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** datetime-local replacement: date picker + clock-style-aware time text.
    Clearing the date clears the whole value; picking a date with no time
    defaults to 09:00; typing a time with no date lands on today. */
export function DateTimeField({ value, onChange, id, ariaLabel }: {
  /** Epoch ms, or undefined for unset. */
  value?: number;
  onChange: (ms: number | undefined) => void;
  id?: string;
  ariaLabel: string;
}) {
  const minutes = value !== undefined ? Math.round((value - startOfDay(value)) / 60_000) : undefined;

  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input
        id={id}
        type="date"
        className="input"
        style={{ flex: 1, minWidth: 0, fontSize: 13 }}
        aria-label={`${ariaLabel} date`}
        value={value !== undefined ? toDateInput(value) : ""}
        onChange={(e) => {
          if (!e.target.value) { onChange(undefined); return; }
          const [y, m, d] = e.target.value.split("-").map(Number);
          onChange(new Date(y, m - 1, d).getTime() + (minutes ?? 9 * 60) * 60_000);
        }}
      />
      <TimeField
        minutes={minutes}
        ariaLabel={`${ariaLabel} time`}
        width={86}
        onChange={(min) => {
          const base = value !== undefined ? startOfDay(value) : startOfDay(Date.now());
          onChange(base + min * 60_000);
        }}
      />
    </div>
  );
}
