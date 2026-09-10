/* Google Calendar ⇄ LetsGo, decided as pure data.

   Everything that matters about the sync — which events to create, update or
   delete in Google, and which tasks to write back into the vault — is worked
   out here from two plain lists (the local tasks and the remote events). The
   network lives in gcalApi.ts, the OAuth dance in gcalAuth.ts, and the "do it"
   loop in gcalSync.ts, so the interesting decisions stay testable offline.

   The pairing survives anything: every event this app writes carries the task
   id in `extendedProperties.private.letsgoTaskId`, and every mirrored task
   carries the event id in `googleEvent`. Either side can be rebuilt from the
   other, which is also how deletions are detected — an event tagged with a task
   that no longer exists is a task you deleted, and a linked task whose event has
   left the calendar is an event you deleted. */

import type { GoogleAccount, GoogleEventLink, ReminderChoice, Repeat, Task } from "./types";
import { DEFAULT_ESTIMATE_MINUTES } from "./estimate";
import { FALLBACK_EVENT_EMOJI } from "./dayEvents";

const MIN = 60_000;
const DAY = 86_400_000;

/** Private extended property Google carries our task id in. */
export const TASK_ID_PROPERTY = "letsgoTaskId";

/** Prefix of the generated paragraph naming a nested task's ancestors. Written
    on push, stripped on pull, so round-tripping never stacks copies of it. */
const LINEAGE_PREFIX = "Part of: ";

/** `source` stamped on tasks pulled in from an account, mirroring the markdown
    and iCal importers so their origin is visible in the UI. */
export function googleSource(account: Pick<GoogleAccount, "id">): string {
  return `google:${account.id}`;
}

/* ————— the slice of the Calendar API v3 shapes we use ————— */

export interface GoogleEventTime {
  /** RFC-3339 with offset, for timed events. */
  dateTime?: string;
  /** "YYYY-MM-DD", for all-day events. */
  date?: string;
  timeZone?: string;
}

export interface GoogleEventReminders {
  useDefault: boolean;
  overrides?: { method: "popup" | "email"; minutes: number }[];
}

/** Event kinds Google generates and owns. They are listed like any other
    event and are worth reading INTO the vault, but every write to one is
    rejected — a contact birthday answers a `start` patch with a flat
    400 "Invalid start time", which is exactly the error that made every sync
    report the same handful of events over and over. */
export type GoogleEventType = "default" | "birthday" | "fromGmail" | "focusTime" | "outOfOffice" | "workingLocation";

const READ_ONLY_EVENT_TYPES: readonly string[] = ["birthday", "fromGmail", "focusTime", "outOfOffice", "workingLocation"];

/** True when Google, not the user, owns this event and will refuse our writes. */
export function isReadOnlyEvent(event: Pick<GoogleEvent, "eventType">): boolean {
  return !!event.eventType && READ_ONLY_EVENT_TYPES.includes(event.eventType);
}

export interface GoogleEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  /** RFC-3339 stamp of the last remote change. */
  updated?: string;
  recurrence?: string[];
  extendedProperties?: { private?: Record<string, string> };
  htmlLink?: string;
  reminders?: GoogleEventReminders;
  /** Absent on older payloads; "default" for anything a user made. */
  eventType?: GoogleEventType;
}

/** A start/end we WRITE. Google models a timed event and an all-day one as the
    same field holding different keys, and `events.patch` merges nested objects
    key by key — so sending only `dateTime` at an event that already carries a
    `date` leaves BOTH set and Google answers 400 "Invalid start time". Every
    body therefore states the key it does not use as an explicit null, which is
    how the API is told to clear it. `gcalApi.insertEvent` strips them again,
    since a create has nothing to clear. */
export type GoogleEventBodyTime =
  | { dateTime: string; date: null; timeZone?: string }
  | { date: string; dateTime: null; timeZone?: string };

export interface GoogleEventBody {
  summary: string;
  description?: string;
  start: GoogleEventBodyTime;
  end: GoogleEventBodyTime;
  recurrence?: string[];
  extendedProperties: { private: Record<string, string> };
  /** Omitted only when the caller has nothing to say; otherwise always stated
      so switching back to "Google's default" is a real, pushable change. */
  reminders?: GoogleEventReminders;
}

/** Epoch ms a body's start/end lands on, for comparisons and tests. */
export function bodyTimeMs(time: GoogleEventBodyTime): number {
  return time.dateTime !== null ? new Date(time.dateTime).getTime() : (parseLocalDate(time.date) ?? NaN);
}

/** This device's IANA zone ("Asia/Kolkata").

    Google REQUIRES a time zone on any event carrying an RRULE and rejects it
    with "Missing time zone definition for start time" otherwise: expanding a
    recurrence is meaningless without one, since a UTC instant cannot say which
    local 07:00 the series should follow across a DST change. Sent on every
    event, not just recurring ones, so a task that later becomes a routine does
    not start failing. */
export function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined; // exotic runtime with no zone database
  }
}

/* ————— mapping ————— */

/** Root-first ancestor titles, "Website refresh › Hero section". */
function parentChain(task: Task, all: readonly Task[]): string {
  const byId = new Map(all.map((t) => [t.id, t]));
  const names: string[] = [];
  let cursor = task.parentId ? byId.get(task.parentId) : undefined;
  for (let guard = 0; cursor && guard < 32; guard++) {
    names.unshift(cursor.title);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return names.join(" › ");
}

function stripLineage(description?: string): string | undefined {
  if (!description) return undefined;
  const kept = description
    .split(/\n{2,}/)
    .filter((para) => !para.startsWith(LINEAGE_PREFIX))
    .join("\n\n")
    .trim();
  return kept || undefined;
}

function rruleFor(repeat: Repeat): string {
  return `RRULE:FREQ=${repeat.unit.toUpperCase()};INTERVAL=${repeat.interval}`;
}

function parseRrule(recurrence?: string[]): Repeat | undefined {
  for (const line of recurrence ?? []) {
    const body = line.replace(/^RRULE:/i, "");
    const parts = Object.fromEntries(
      body.split(";").map((kv) => {
        const [k, v] = kv.split("=");
        return [k?.toUpperCase(), v];
      }),
    ) as Record<string, string | undefined>;
    const freq = parts.FREQ?.toUpperCase();
    const unit = freq === "DAILY" ? "daily" : freq === "WEEKLY" ? "weekly" : freq === "MONTHLY" ? "monthly" : freq === "YEARLY" ? "yearly" : undefined;
    if (!unit) continue;
    const interval = Number(parts.INTERVAL ?? 1);
    return { unit, interval: Number.isFinite(interval) && interval > 0 ? interval : 1 };
  }
  return undefined;
}

/** "2026-07-20" → local midnight (never UTC — an all-day event belongs to the
    day it is written on, wherever you read it). */
function parseLocalDate(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** Local midnight → "2026-07-20". Deliberately built from the LOCAL calendar
    fields: `toISOString().slice(0, 10)` is a day out for anyone east or west of
    UTC, which is how an all-day event lands on the wrong date. */
function localDateKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Which day an all-day task belongs to — the same anchor every dated view
    uses (lib/dayEvents.ts `eventAnchorOf`). */
export function allDayAnchorOf(task: Task): number | undefined {
  return task.scheduledAt ?? task.deadline;
}

/** True when this task is a whole-day obligation rather than a block of work,
    and must be written to Google as a `date` event instead of a `dateTime` one. */
export function isAllDayTask(task: Task): boolean {
  return !!task.allDay && allDayAnchorOf(task) !== undefined;
}

/** The reminder Google should attach, or undefined to say nothing about it.

    Three states, not two: an explicit lead time, "leave the calendar's own
    default alone", and "no popup at all". Stating `useDefault` rather than
    omitting the field is what makes switching BACK to the default a change
    Google actually applies on a patch. */
export function remindersFor(choice: ReminderChoice | undefined): GoogleEventReminders | undefined {
  if (choice === undefined || choice === "default") return { useDefault: true };
  if (choice === "none") return { useDefault: false, overrides: [] };
  if (!Number.isFinite(choice)) return { useDefault: true };
  return { useDefault: false, overrides: [{ method: "popup", minutes: Math.max(0, Math.round(choice)) }] };
}

/** The lead time this task should get: its own override, else the account-wide
    setting, else Google's calendar default. */
export function reminderChoiceFor(task: Task, accountDefault?: ReminderChoice): ReminderChoice | undefined {
  return task.reminderMinutes ?? accountDefault;
}

/** Normalise a body for `events.patch`.

    `events.patch` merges `reminders` key by key against what the event already
    carries, so sending `{ useDefault: true }` at an event that still has
    `overrides` from an earlier state (or a hand edit in Google) leaves BOTH set
    and Google answers 400 "Cannot specify both default reminders and overrides
    at the same time" — then every later sync of that task fails the same way.
    Stating an empty `overrides` alongside `useDefault: true` clears them.
    `remindersMatch` already treats a missing and an empty override list alike,
    so this never turns into a re-update loop. */
export function forPatch(body: GoogleEventBody): GoogleEventBody {
  const r = body.reminders;
  if (r && r.useDefault && r.overrides === undefined) {
    return { ...body, reminders: { useDefault: true, overrides: [] } };
  }
  return body;
}

export interface EventBodyOptions {
  /** Account-wide reminder lead time, overridden per task by `reminderMinutes`. */
  reminder?: ReminderChoice;
}

/** The event body a scheduled task should own.

    All-day tasks (birthdays, anniversaries, holidays) are written as `date`
    events; everything else is timed, and a task with no estimate gets the same
    default the packer gives it so the event is never a zero-length dot. */
export function taskToEventBody(task: Task, allTasks: readonly Task[], options: EventBodyOptions = {}): GoogleEventBody {
  const chain = parentChain(task, allTasks);
  const description = [task.description?.trim(), chain ? `${LINEAGE_PREFIX}${chain}` : ""]
    .filter(Boolean)
    .join("\n\n") || undefined;

  const shared = {
    summary: task.title,
    description,
    recurrence: task.repeat ? [rruleFor(task.repeat)] : undefined,
    extendedProperties: { private: { [TASK_ID_PROPERTY]: task.id, letsgoStatus: task.status } },
    reminders: remindersFor(reminderChoiceFor(task, options.reminder)),
  };

  if (isAllDayTask(task)) {
    // Google's `end.date` is EXCLUSIVE: a one-day event ends on the next day.
    const day = startOfLocalDay(allDayAnchorOf(task)!);
    return {
      ...shared,
      start: { date: localDateKey(day), dateTime: null },
      end: { date: localDateKey(day + DAY), dateTime: null },
    };
  }

  const raw = task.scheduledAt;
  const start = raw !== undefined && Number.isFinite(raw) ? raw : Date.now();
  const estimate = task.estimateMin !== undefined && Number.isFinite(task.estimateMin) && task.estimateMin > 0
    ? task.estimateMin
    : DEFAULT_ESTIMATE_MINUTES;
  const timeZone = localTimeZone();
  return {
    ...shared,
    start: { dateTime: new Date(start).toISOString(), date: null, timeZone },
    end: { dateTime: new Date(start + estimate * MIN).toISOString(), date: null, timeZone },
  };
}

/** Local midnight of the day `ms` falls on. Local by construction — see
    `localDateKey` for why UTC arithmetic is wrong here. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The task-shaped fields an event carries, or null when it is not something
    LetsGo can hold (cancelled, untitled, or undated). */
export interface EventTaskFields {
  title: string;
  description?: string;
  scheduledAt?: number;
  estimateMin?: number;
  deadline?: number;
  repeat?: Repeat;
  /** True for a `date` event. Mirrored onto `Task.allDay` so the dated views
      hang it off the day as a notch — and so the next push writes it back as
      an all-day event instead of trying to convert it to a timed one. */
  allDay?: boolean;
}

export function eventToTaskFields(event: GoogleEvent): EventTaskFields | null {
  if (event.status === "cancelled") return null;
  const title = event.summary?.trim();
  if (!title) return null;
  const description = stripLineage(event.description);
  const repeat = parseRrule(event.recurrence);

  if (event.start?.dateTime) {
    const start = new Date(event.start.dateTime).getTime();
    if (!Number.isFinite(start)) return null;
    const end = event.end?.dateTime ? new Date(event.end.dateTime).getTime() : NaN;
    const estimateMin = Number.isFinite(end) && end > start ? Math.round((end - start) / MIN) : undefined;
    return { title, description, scheduledAt: start, estimateMin, repeat };
  }

  if (event.start?.date) {
    const day = parseLocalDate(event.start.date);
    if (day === null) return null;
    // An all-day event is a dated obligation, not a block of work: it becomes a
    // deadline at the end of that day and never claims a slot on the timeline,
    // where a 24-hour bar would bury the actual plan.
    return { title, description, deadline: day + DAY - MIN, repeat, allDay: true };
  }
  return null;
}

/** Does the remote event's start/end already say exactly what the body does —
    same VALUE TYPE included, so an all-day event never counts as matching a
    timed body (or the other way round). */
function timeMatches(remote: GoogleEventTime | undefined, want: GoogleEventBodyTime): boolean {
  if (!remote) return false;
  if (want.dateTime !== null) {
    return !!remote.dateTime && new Date(remote.dateTime).getTime() === new Date(want.dateTime).getTime();
  }
  return remote.date === want.date;
}

/** Reminder settings agree. An event Google returns without `reminders` is on
    the calendar's own default, which is what `{ useDefault: true }` asks for. */
function remindersMatch(remote: GoogleEventReminders | undefined, want: GoogleEventReminders | undefined): boolean {
  if (!want) return true;
  const has = remote ?? { useDefault: true };
  if (has.useDefault !== want.useDefault) return false;
  const key = (r: GoogleEventReminders) => (r.overrides ?? []).map((o) => `${o.method}:${o.minutes}`).sort().join("|");
  return key(has) === key(want);
}

/** Is the remote event already exactly what this task says it should be? */
function eventMatchesBody(event: GoogleEvent, body: GoogleEventBody): boolean {
  if ((event.summary ?? "") !== body.summary) return false;
  if ((event.description ?? "") !== (body.description ?? "")) return false;
  if (!timeMatches(event.start, body.start)) return false;
  if (!timeMatches(event.end, body.end)) return false;
  if (!remindersMatch(event.reminders, body.reminders)) return false;
  return (event.recurrence ?? []).join("|") === (body.recurrence ?? []).join("|");
}

export function linkFor(account: GoogleAccount, event: Pick<GoogleEvent, "id" | "updated">, now: number): GoogleEventLink {
  return {
    accountId: account.id,
    calendarId: account.calendarId,
    eventId: event.id,
    updated: event.updated,
    pushedAt: now,
  };
}

/* ————— the plan ————— */

/** A change to an EXISTING task, expressed as the handful of fields the sync is
    entitled to write. Never a whole task: a sync runs for seconds, and posting
    back a complete object captured when it started would revert anything the
    user edited in the meantime. */
export interface TaskPatch {
  id: string;
  fields: Partial<Task>;
}

export interface SyncPlan {
  /** Tasks with no event yet — insert, then stamp the returned id back. */
  creates: { task: Task; body: GoogleEventBody }[];
  /** Events whose task changed locally — patch them. */
  updates: { task: Task; eventId: string; body: GoogleEventBody }[];
  /** Event ids whose task is gone locally — delete them. */
  deletes: string[];
  /** Events with no local counterpart — brand-new tasks to add to the vault. */
  localImports: Task[];
  /** Remote edits to tasks that already exist here: calendar-owned fields only,
      so local-only ones (status, priority, tags, logged time) are untouched. */
  localPatches: TaskPatch[];
  /** Task ids whose event left the calendar — delete them locally. */
  localDeletes: string[];
}

export interface SyncInput {
  tasks: readonly Task[];
  events: readonly GoogleEvent[];
  account: GoogleAccount;
  now: number;
  /** Account-wide reminder lead time for pushed events; a task's own
      `reminderMinutes` still wins over it. */
  reminder?: ReminderChoice;
  /** The span the events were listed over. A linked task outside it was simply
      not listed, so its absence proves nothing and must never delete it. */
  windowStart: number;
  windowEnd: number;
}

/** Work out both directions of one account's sync in a single pass.

    Conflict rule: whoever changed last wins, decided on Google's `updated`
    stamp against the one recorded at the last sync — EXCEPT for locked tasks,
    which are appointments the user pinned deliberately. A locked task never
    moves on a pull; the calendar is corrected to match it instead. */
export function planCalendarSync({ tasks, events, account, now, reminder, windowStart, windowEnd }: SyncInput): SyncPlan {
  const plan: SyncPlan = { creates: [], updates: [], deletes: [], localImports: [], localPatches: [], localDeletes: [] };

  const bodyFor = (task: Task) => taskToEventBody(task, tasks, { reminder });
  const eventById = new Map(events.map((e) => [e.id, e]));
  const parentIds = new Set(tasks.map((t) => t.parentId).filter(Boolean) as string[]);
  const handledEventIds = new Set<string>();
  const inWindow = (ms: number) => ms >= windowStart && ms <= windowEnd;

  for (const task of tasks) {
    const link = task.googleEvent;
    // A task mirrored into a DIFFERENT account is that account's business.
    if (link && link.accountId !== account.id) continue;

    if (!link) {
      // Parents are not pushed: their window is derived from their children,
      // so pushing both would double every nested task on the calendar.
      // An all-day event has no slot but is still a real calendar entry, so it
      // pushes off its day anchor (schedule, else deadline).
      const anchor = isAllDayTask(task) ? allDayAnchorOf(task) : task.scheduledAt;
      const pushable = !parentIds.has(task.id) && anchor !== undefined && Number.isFinite(anchor) && inWindow(anchor);
      if (pushable) plan.creates.push({ task, body: bodyFor(task) });
      continue;
    }

    handledEventIds.add(link.eventId);
    const remote = eventById.get(link.eventId);

    // Gone from Google — cancelled, or absent from a window that covers it.
    if (!remote || remote.status === "cancelled") {
      const anchor = task.scheduledAt ?? task.deadline;
      if (anchor !== undefined && inWindow(anchor)) plan.localDeletes.push(task.id);
      continue;
    }

    const remoteIsNewer = !!remote.updated && !!link.updated && remote.updated > link.updated;
    const fields = eventToTaskFields(remote);

    // Google's own events — contact birthdays, Gmail bookings, focus time —
    // are readable but not writable: patching one answers 400 "Invalid start
    // time" forever, once per sync, for every contact you have. They are
    // strictly pull-only, whatever the local task looks like.
    if (isReadOnlyEvent(remote)) {
      if (fields) plan.localPatches.push({ id: task.id, fields: remoteFields(fields, remote, account, now) });
      continue;
    }

    // A task with no day at all has nothing to push: pull-only.
    const anchor = isAllDayTask(task) ? allDayAnchorOf(task) : task.scheduledAt;
    if (anchor === undefined || !Number.isFinite(anchor)) {
      if (remoteIsNewer && fields) plan.localPatches.push({ id: task.id, fields: remoteFields(fields, remote, account, now) });
      continue;
    }

    if (remoteIsNewer && fields && !task.locked) {
      plan.localPatches.push({ id: task.id, fields: remoteFields(fields, remote, account, now) });
      continue;
    }

    const body = bodyFor(task);
    if (!eventMatchesBody(remote, body)) plan.updates.push({ task, eventId: link.eventId, body });
  }

  for (const event of events) {
    if (handledEventIds.has(event.id)) continue;
    if (event.status === "cancelled") continue;
    // Tagged as ours but no task claims it: the task was deleted here.
    // Google-owned events can never carry our tag, but guard anyway — a delete
    // it refuses would be one more error on every single sync.
    if (event.extendedProperties?.private?.[TASK_ID_PROPERTY] && !isReadOnlyEvent(event)) {
      plan.deletes.push(event.id);
      continue;
    }
    const fields = eventToTaskFields(event);
    if (fields) plan.localImports.push(taskFromEvent(fields, event, account, now));
  }

  return plan;
}

/** The fields a remote edit may write. Google owns the calendar ones; anything
    it has no concept of — status, priority, tags, logged time, subtasks, the
    lock — is simply absent here, so it survives untouched. Fields the event
    does not carry are omitted too, rather than written as undefined. */
function remoteFields(fields: EventTaskFields, event: GoogleEvent, account: GoogleAccount, now: number): Partial<Task> {
  const patch: Partial<Task> = { title: fields.title, googleEvent: linkFor(account, event, now) };
  if (fields.description !== undefined) patch.description = fields.description;
  if (fields.estimateMin !== undefined) patch.estimateMin = fields.estimateMin;
  if (fields.deadline !== undefined) patch.deadline = fields.deadline;
  if (fields.repeat !== undefined) patch.repeat = fields.repeat;
  if (fields.allDay) {
    // Becoming all-day CLEARS the slot, explicitly. Leaving a stale
    // `scheduledAt` behind is what made every sync try to rewrite the event as
    // a timed one, and Google answer 400 "Invalid start time", forever.
    patch.allDay = true;
    patch.scheduledAt = undefined;
    patch.estimateMin = undefined;
    patch.emoji = event.eventType === "birthday" ? "🎂" : FALLBACK_EVENT_EMOJI;
  } else {
    patch.allDay = undefined;
    patch.emoji = undefined;
    if (fields.scheduledAt !== undefined) patch.scheduledAt = fields.scheduledAt;
  }
  return patch;
}

function taskFromEvent(fields: EventTaskFields, event: GoogleEvent, account: GoogleAccount, now: number): Task {
  return {
    id: `t-${now}-${Math.floor(Math.random() * 1e6)}`,
    title: fields.title,
    description: fields.description,
    status: "pending",
    priority: 2,
    tags: [],
    createdAt: now,
    loggedMin: 0,
    scheduledAt: fields.scheduledAt,
    estimateMin: fields.estimateMin,
    deadline: fields.deadline,
    repeat: fields.repeat,
    // An all-day import is an EVENT here, not an undated todo: flagged so the
    // dated views draw it as a notch, and glyphed because a notch shows only
    // its emoji until hovered.
    allDay: fields.allDay || undefined,
    emoji: fields.allDay ? (event.eventType === "birthday" ? "🎂" : FALLBACK_EVENT_EMOJI) : undefined,
    source: googleSource(account),
    googleEvent: linkFor(account, event, now),
  };
}
