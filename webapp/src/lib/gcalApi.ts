/* Google Calendar API v3, the five calls this integration needs.

   Deliberately thin: no retry policy, no caching, no state. Every call takes an
   access token the caller already resolved (gcalAuth.ts) and returns plain data
   the planner (gcal.ts) can reason about. Failures throw GoogleApiError with the
   status, which is how gcalSync tells "token expired, ask again" (401) apart
   from "that event is already gone" (404/410) and everything else. */

import { forPatch, type GoogleEvent, type GoogleEventBody } from "./gcal";

const BASE = "https://www.googleapis.com/calendar/v3";
const TIMEOUT_MS = 15_000;

export class GoogleApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (res.status === 204) return undefined as T;
    const json = await res.json().catch(() => undefined);
    if (!res.ok) {
      const detail = (json as { error?: { message?: string } } | undefined)?.error?.message;
      throw new GoogleApiError(res.status, detail ?? `${init.method ?? "GET"} ${path} → ${res.status}`);
    }
    return json as T;
  } catch (err) {
    if (err instanceof GoogleApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new GoogleApiError(0, "Google Calendar did not answer in time.");
    }
    throw new GoogleApiError(0, err instanceof Error ? err.message : "Network error");
  } finally {
    clearTimeout(timer);
  }
}

export interface GoogleCalendarSummary {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
}

/** The account's calendars, writable ones first — the picker's options. */
export async function listCalendars(token: string): Promise<GoogleCalendarSummary[]> {
  const res = await call<{ items?: GoogleCalendarSummary[] }>(token, "/users/me/calendarList?minAccessRole=writer&maxResults=250");
  return res.items ?? [];
}

/** Every event in the window, deleted ones included — a cancelled event is how
    a deletion made in Google reaches us. `singleEvents=false` keeps recurring
    events as their master, so a routine stays one task instead of exploding
    into an instance per occurrence. */
export async function listEvents(
  token: string,
  calendarId: string,
  timeMin: number,
  timeMax: number,
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      timeMin: new Date(timeMin).toISOString(),
      timeMax: new Date(timeMax).toISOString(),
      showDeleted: "true",
      singleEvents: "false",
      maxResults: "2500",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await call<{ items?: GoogleEvent[]; nextPageToken?: string }>(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    );
    events.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return events;
}

/** A create has nothing to clear, so the explicit `date: null` / `dateTime:
    null` a PATCH needs (see gcal.ts `GoogleEventBodyTime`) is dropped here
    rather than sent to an endpoint that has no use for it. */
function forInsert(body: GoogleEventBody): GoogleEventBody {
  const drop = <T extends object>(time: T): T =>
    Object.fromEntries(Object.entries(time).filter(([, v]) => v !== null)) as T;
  return { ...body, start: drop(body.start), end: drop(body.end) };
}

export function insertEvent(token: string, calendarId: string, body: GoogleEventBody): Promise<GoogleEvent> {
  return call<GoogleEvent>(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(forInsert(body)),
  });
}

/** Sent VERBATIM, nulls included: `events.patch` merges nested objects key by
    key, so the null in `start` is the only way to tell Google that an all-day
    event's `date` is gone now that a `dateTime` has arrived — and without it
    the event keeps both and every sync gets back 400 "Invalid start time". */
export function patchEvent(token: string, calendarId: string, eventId: string, body: GoogleEventBody): Promise<GoogleEvent> {
  return call<GoogleEvent>(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify(forPatch(body)),
  });
}

export function deleteEvent(token: string, calendarId: string, eventId: string): Promise<void> {
  return call<void>(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
}
