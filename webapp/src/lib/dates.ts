const DAY = 86_400_000;

/* Clock style (Settings → Appearance). A module flag instead of a parameter
   so the dozens of fmtTime/fmtDateTime call sites stay untouched; the store
   providers sync it whenever settings load or change. 24-hour is the app
   default. Native datetime-local inputs follow the device locale instead. */
let hour12 = false;

export function setHourFormat(fmt: "12" | "24"): void {
  hour12 = fmt === "12";
}

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(t: number, n: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function sameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

export function at(dayStart: number, hour: number, min = 0): number {
  return dayStart + hour * 3_600_000 + min * 60_000;
}

/** "Jul 18, 14:00" (24h default) / "Jul 18, 2:00 PM" */
export function fmtDateTime(t: number): string {
  return new Date(t).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: hour12 ? "numeric" : "2-digit", minute: "2-digit", hour12,
  });
}

/** "16:10" (24h default) / "4:10 PM" */
export function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString("en-US", { hour: hour12 ? "numeric" : "2-digit", minute: "2-digit", hour12 });
}

/** Minutes-from-midnight → "14:30" (24h default) / "2:30 PM". */
export function fmtClockMin(minOfDay: number): string {
  const h = Math.floor(minOfDay / 60), m = minOfDay % 60;
  if (!hour12) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Parse a typed clock time — "14:30", "9:5", "2:30 pm", "12am" — into
    minutes from midnight, or null when unreadable. An am/pm suffix always
    wins; without one the hour is read as 24h. */
export function parseClockText(text: string): number | null {
  const m = text.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3] === "pm" && h !== 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
  } else if (h > 23) return null;
  return h * 60 + min;
}

/** "14:00" / "2 PM" for grid axis labels */
export function fmtHour(hour: number): string {
  if (!hour12) return `${String(hour).padStart(2, "0")}:00`;
  return new Date(2000, 0, 1, hour).toLocaleTimeString("en-US", { hour: "numeric", hour12: true });
}

/** "Tue 15" */
export function fmtDayShort(t: number): string {
  return new Date(t).toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
}

/** "Tue, Jul 15" */
export function fmtDayMed(t: number): string {
  return new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "July 2026" */
export function fmtMonth(t: number): string {
  return new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** "Jul 15 – 17, 2026" */
export function fmtRange(a: number, b: number): string {
  const d1 = new Date(a); const d2 = new Date(b);
  const m1 = d1.toLocaleDateString("en-US", { month: "short" });
  const m2 = d2.toLocaleDateString("en-US", { month: "short" });
  if (sameDay(a, b)) return `${m1} ${d1.getDate()}, ${d1.getFullYear()}`;
  if (m1 === m2) return `${m1} ${d1.getDate()} – ${d2.getDate()}, ${d2.getFullYear()}`;
  return `${m1} ${d1.getDate()} – ${m2} ${d2.getDate()}, ${d2.getFullYear()}`;
}

/** minutes → "1h 30m" / "48m" */
export function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${String(rest).padStart(2, "0")}m` : `${h}h 00m`;
}

/** seconds → "16:42" */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Days in a row (ending today or yesterday) that saw at least one completion. */
export function streakDays(completionDays: number[]): number {
  const set = new Set(completionDays.map(startOfDay));
  let cursor = startOfDay(Date.now());
  if (!set.has(cursor)) cursor -= DAY;
  let run = 0;
  while (set.has(cursor)) {
    run++;
    cursor -= DAY;
  }
  return run;
}
