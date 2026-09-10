/* iCalendar (.ics) → LetsGo tasks. Reads RFC 5545 VTODO *and* VEVENT
   components so a calendar exported from Google/Apple/Nextcloud/Outlook
   imports as todos with dates, priority, tags, status and recurrence.
   Full VTIMEZONE resolution is out of scope: a TZID or floating datetime is
   read as local wall-clock; only the trailing `Z` (UTC) form is offset-
   corrected. Every parsed component carries the properties LetsGo tasks
   support, so imported items show up in every view (board, schedule,
   calendar, gantt, list). */

import type { Priority, Repeat, TaskStatus } from "./types";

export interface ParsedIcalTask {
  uid?: string;
  title: string;
  description?: string;
  /** Epoch ms — hard due date (VTODO DUE). */
  deadline?: number;
  /** Epoch ms — placement on the schedule/calendar (DTSTART). */
  scheduledAt?: number;
  estimateMin?: number;
  priority: Priority;
  tags: string[];
  status: TaskStatus;
  completedAt?: number;
  repeat?: Repeat;
}

interface RawProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** RFC 5545 line unfolding: a line starting with a space or tab continues
    the one before it. Tolerates CRLF, CR and LF endings. */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** Split `NAME;PARAM=val;PARAM2="v:v":VALUE` — the value starts at the first
    colon that is not inside a quoted parameter. */
function parseLine(line: string): RawProp | undefined {
  let colon = -1;
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ":" && !inQuote) { colon = i; break; }
  }
  if (colon === -1) return undefined;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(";");
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: parts[0].toUpperCase(), params, value };
}

/** Unescape a TEXT value: `\n`/`\N` → newline; `\,` `\;` `\\` → the char. */
function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** DATE (`YYYYMMDD`, all-day → local midnight) or DATE-TIME
    (`YYYYMMDDTHHMMSS[Z]`, `Z` = UTC else local) → epoch ms. */
function parseIcalDate(value: string, params: Record<string, string>): number | undefined {
  const v = value.trim();
  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return undefined;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!dt) return undefined;
  const [, y, mo, d, h, mi, s, z] = dt;
  const a = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const;
  return z ? Date.UTC(a[0], a[1], a[2], a[3], a[4], a[5]) : new Date(a[0], a[1], a[2], a[3], a[4], a[5]).getTime();
}

/** ISO 8601 duration (`P1DT2H30M`, `PT45M`, `P1W`) → whole minutes. */
function parseDurationMin(value: string): number | undefined {
  const m = /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return undefined;
  const [, sign, w, d, h, mi, s] = m;
  const min = Number(w || 0) * 7 * 24 * 60 + Number(d || 0) * 24 * 60 + Number(h || 0) * 60 + Number(mi || 0) + Math.round(Number(s || 0) / 60);
  if (min <= 0 || sign === "-") return undefined;
  return min;
}

/** RFC PRIORITY is 1 (highest) … 9 (lowest); 0/absent = undefined. LetsGo
    inverts to P0 (highest) … P3. */
function mapPriority(raw: string | undefined): Priority {
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 2;
  if (n <= 2) return 0;
  if (n <= 4) return 1;
  if (n === 5) return 2;
  return 3;
}

/** RRULE `FREQ`/`INTERVAL` → LetsGo repeat. Only the daily/weekly/monthly/
    yearly frequencies map; anything else (COUNT/UNTIL/BYDAY) is ignored. */
function mapRepeat(rrule: string | undefined): Repeat | undefined {
  if (!rrule) return undefined;
  const parts: Record<string, string> = {};
  for (const p of rrule.split(";")) {
    const eq = p.indexOf("=");
    if (eq !== -1) parts[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  const freq = (parts.FREQ || "").toUpperCase();
  const unit = freq === "DAILY" ? "daily" : freq === "WEEKLY" ? "weekly" : freq === "MONTHLY" ? "monthly" : freq === "YEARLY" ? "yearly" : undefined;
  if (!unit) return undefined;
  return { interval: Math.max(1, Number(parts.INTERVAL) || 1), unit };
}

interface Acc {
  uid?: string;
  title?: string;
  description?: string;
  dtstart?: number;
  dtend?: number;
  due?: number;
  durationMin?: number;
  allDay?: boolean;
  priorityRaw?: string;
  statusRaw?: string;
  percent?: number;
  completed?: number;
  rrule?: string;
  tags: string[];
}

function resolveStatus(a: Acc): TaskStatus {
  const s = a.statusRaw;
  if (s === "COMPLETED" || a.percent === 100 || a.completed !== undefined) return "done";
  if (s === "IN-PROCESS") return "in_progress";
  if (s === "CANCELLED") return "skipped";
  return "pending";
}

function finalize(a: Acc): ParsedIcalTask | undefined {
  const title = (a.title ?? "").trim();
  if (!title) return undefined;

  let estimateMin = a.durationMin;
  if (estimateMin === undefined && !a.allDay && a.dtstart !== undefined && a.dtend !== undefined) {
    const diff = Math.round((a.dtend - a.dtstart) / 60_000);
    if (diff > 0 && diff <= 24 * 60) estimateMin = diff;
  }

  const status = resolveStatus(a);
  const completedAt = status === "done" ? (a.completed ?? a.due ?? a.dtstart ?? Date.now()) : undefined;

  return {
    uid: a.uid,
    title,
    description: a.description?.trim() || undefined,
    deadline: a.due,
    scheduledAt: a.dtstart,
    estimateMin,
    priority: mapPriority(a.priorityRaw),
    tags: a.tags,
    status,
    completedAt,
    repeat: mapRepeat(a.rrule),
  };
}

export function parseIcal(text: string): ParsedIcalTask[] {
  const tasks: ParsedIcalTask[] = [];
  let acc: Acc | null = null;

  for (const line of unfold(text)) {
    const prop = parseLine(line);
    if (!prop) continue;
    const upper = prop.value.trim().toUpperCase();

    if (prop.name === "BEGIN") {
      if (upper === "VTODO" || upper === "VEVENT") acc = { tags: [] };
      continue;
    }
    if (prop.name === "END") {
      if ((upper === "VTODO" || upper === "VEVENT") && acc) {
        const t = finalize(acc);
        if (t) tasks.push(t);
      }
      acc = null;
      continue;
    }
    if (!acc) continue;

    switch (prop.name) {
      case "SUMMARY": acc.title = unescapeText(prop.value); break;
      case "DESCRIPTION": acc.description = unescapeText(prop.value); break;
      case "UID": acc.uid = prop.value.trim(); break;
      case "DTSTART":
        acc.dtstart = parseIcalDate(prop.value, prop.params);
        acc.allDay = prop.params.VALUE === "DATE" || /^\d{8}$/.test(prop.value.trim());
        break;
      case "DTEND": acc.dtend = parseIcalDate(prop.value, prop.params); break;
      case "DUE": acc.due = parseIcalDate(prop.value, prop.params); break;
      case "DURATION": acc.durationMin = parseDurationMin(prop.value); break;
      case "PRIORITY": acc.priorityRaw = prop.value.trim(); break;
      case "STATUS": acc.statusRaw = upper; break;
      case "PERCENT-COMPLETE": acc.percent = Number(prop.value); break;
      case "COMPLETED": acc.completed = parseIcalDate(prop.value, prop.params); break;
      case "RRULE": acc.rrule = prop.value.trim(); break;
      case "CATEGORIES":
        for (const c of unescapeText(prop.value).split(",")) {
          const tag = c.trim();
          if (tag) acc.tags.push(tag);
        }
        break;
    }
  }
  return tasks;
}
