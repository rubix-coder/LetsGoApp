/* Runs a sync plan against one Google account.

   The plan (gcal.ts) decides; this executes and reports. Two rules shape it:

   1. One bad event never sinks the run. Google rejects individual events for
      reasons that have nothing to do with the rest — a calendar turned
      read-only, an event someone else owns — so each operation is caught on its
      own and named in `errors`, and the sync carries on.
   2. Nothing is committed to the vault from here. The result is a list of task
      upserts and deletions the caller applies through the reducer, against
      whatever the state looks like by then — a sync that started before an edit
      must not overwrite it. */

import { planCalendarSync, linkFor, type GoogleEvent, type GoogleEventBody, type TaskPatch } from "./gcal";
import { deleteEvent, insertEvent, listEvents, patchEvent } from "./gcalApi";
import { accessTokenFor, forgetGoogleToken, NeedsConsentError } from "./gcalAuth";
import type { GoogleAccount, ReminderChoice, Task } from "./types";

const DAY = 86_400_000;

/** How far either side of today an account is synced. Past events are kept in
    range so a deletion made in Google still reaches a task from last week. */
export const SYNC_PAST_DAYS = 30;
export const SYNC_FUTURE_DAYS = 180;

/** The calls a sync needs, injectable so the executor can be tested offline. */
export interface CalendarGateway {
  listEvents: (calendarId: string, timeMin: number, timeMax: number) => Promise<GoogleEvent[]>;
  insertEvent: (calendarId: string, body: GoogleEventBody) => Promise<GoogleEvent>;
  patchEvent: (calendarId: string, eventId: string, body: GoogleEventBody) => Promise<GoogleEvent>;
  deleteEvent: (calendarId: string, eventId: string) => Promise<void>;
}

export interface SyncCounts {
  created: number;
  updated: number;
  deleted: number;
  pulled: number;
  removed: number;
}

export interface AccountSyncResult {
  accountId: string;
  /** Brand-new tasks imported from Google — no local counterpart existed. */
  imports: Task[];
  /** Field-level changes to tasks that already exist here.

      Field-level and not whole tasks on purpose: a sync runs for seconds, and
      returning a task object as captured when it started would revert whatever
      the user edited while it was in flight. A push therefore writes back only
      the event link; a pull writes only the fields Google actually owns. */
  patches: TaskPatch[];
  /** Task ids whose event left the calendar. */
  deletes: string[];
  counts: SyncCounts;
  /** Per-event failures, already human-readable. */
  errors: string[];
}

const empty = (accountId: string): AccountSyncResult => ({
  accountId,
  imports: [],
  patches: [],
  deletes: [],
  counts: { created: 0, updated: 0, deleted: 0, pulled: 0, removed: 0 },
  errors: [],
});

/** An event Google no longer has is an event we no longer need to delete. */
function alreadyGone(err: unknown): boolean {
  const status = (err as { status?: number } | undefined)?.status;
  return status === 404 || status === 410;
}

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function syncAccountWith(
  gateway: CalendarGateway,
  account: GoogleAccount,
  tasks: readonly Task[],
  now: number,
  reminder?: ReminderChoice,
): Promise<AccountSyncResult> {
  const result = empty(account.id);
  if (!account.enabled) return result;

  const windowStart = now - SYNC_PAST_DAYS * DAY;
  const windowEnd = now + SYNC_FUTURE_DAYS * DAY;
  // The first call is where a cached-but-revoked token shows itself: a 401
  // (token dead) or 403 (access withdrawn) is a re-auth problem, not a
  // per-event one, so it leaves the generic-error bucket and lands in the
  // "reconnect" one the caller routes to the logo badge.
  let events: GoogleEvent[];
  try {
    events = await gateway.listEvents(account.calendarId, windowStart, windowEnd);
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status === 401 || status === 403) throw new NeedsConsentError(account.email);
    throw err;
  }
  const plan = planCalendarSync({ tasks, events, account, now, reminder, windowStart, windowEnd });

  // A push sends the local task OUT; the only thing that changes here is the
  // link, so that is all that is written back. Touching any other field would
  // mean posting stale content over a concurrent edit.
  for (const { task, body } of plan.creates) {
    try {
      const created = await gateway.insertEvent(account.calendarId, body);
      result.patches.push({ id: task.id, fields: { googleEvent: linkFor(account, created, now) } });
      result.counts.created++;
    } catch (err) {
      result.errors.push(`“${task.title}” could not be added to Google Calendar: ${describe(err)}`);
    }
  }

  for (const { task, eventId, body } of plan.updates) {
    try {
      const patched = await gateway.patchEvent(account.calendarId, eventId, body);
      result.patches.push({
        id: task.id,
        fields: { googleEvent: linkFor(account, { id: eventId, updated: patched.updated }, now) },
      });
      result.counts.updated++;
    } catch (err) {
      result.errors.push(`“${task.title}” could not be updated in Google Calendar: ${describe(err)}`);
    }
  }

  for (const eventId of plan.deletes) {
    try {
      await gateway.deleteEvent(account.calendarId, eventId);
      result.counts.deleted++;
    } catch (err) {
      if (alreadyGone(err)) result.counts.deleted++;
      else result.errors.push(`An event could not be removed from Google Calendar: ${describe(err)}`);
    }
  }

  result.imports.push(...plan.localImports);
  result.patches.push(...plan.localPatches);
  result.counts.pulled = plan.localImports.length + plan.localPatches.length;
  result.deletes = plan.localDeletes;
  result.counts.removed = plan.localDeletes.length;
  return result;
}

/** One pass: resolve a token silently and sync the account over the wire. */
async function syncOnce(
  clientId: string,
  account: GoogleAccount,
  tasks: readonly Task[],
  now: number,
  reminder?: ReminderChoice,
): Promise<AccountSyncResult> {
  const token = await accessTokenFor(clientId, account, { silent: true });
  const gateway: CalendarGateway = {
    listEvents: (calendarId, timeMin, timeMax) => listEvents(token, calendarId, timeMin, timeMax),
    insertEvent: (calendarId, body) => insertEvent(token, calendarId, body),
    patchEvent: (calendarId, eventId, body) => patchEvent(token, calendarId, eventId, body),
    deleteEvent: (calendarId, eventId) => deleteEvent(token, calendarId, eventId),
  };
  return syncAccountWith(gateway, account, tasks, now, reminder);
}

/** The real thing. One clean retry on a consent failure: drop the token and
    force a fresh silent renewal, so the common "signed out in another tab"
    case (a live-looking cached token that 401s) recovers without a click. If
    it still fails, the NeedsConsentError propagates and the badge asks. */
export async function syncAccount(
  clientId: string,
  account: GoogleAccount,
  tasks: readonly Task[],
  now = Date.now(),
  reminder?: ReminderChoice,
): Promise<AccountSyncResult> {
  try {
    return await syncOnce(clientId, account, tasks, now, reminder);
  } catch (err) {
    if (!(err instanceof NeedsConsentError)) throw err;
    forgetGoogleToken(account.id);
    return syncOnce(clientId, account, tasks, now, reminder);
  }
}
