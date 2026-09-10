// @vitest-environment node
/* Executing a sync plan: the calls it makes, the links it stamps back onto
   tasks, and its refusal to let one bad event abort the whole run. */
import { describe, expect, it, vi } from "vitest";
import { syncAccountWith, type CalendarGateway } from "./gcalSync";
import { NeedsConsentError } from "./gcalAuth";
import type { GoogleEvent, GoogleEventBody } from "./gcal";
import type { GoogleAccount, Task } from "./types";

const DAY0 = new Date(2026, 6, 20, 0, 0, 0, 0).getTime();
const at = (hour: number): number => DAY0 + hour * 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const account: GoogleAccount = { id: "acc1", email: "me@gmail.com", calendarId: "primary", enabled: true };

function task(patch: Partial<Task> & Pick<Task, "id">): Task {
  return { title: patch.id, status: "pending", priority: 2, tags: [], createdAt: 0, loggedMin: 0, ...patch };
}

/** What Google echoes back for a body we sent: the same event with the
    explicit `date: null` / `dateTime: null` clears dropped, since a stored
    event only ever carries one of the two. */
function echo(body: GoogleEventBody, rest: Partial<GoogleEvent> & Pick<GoogleEvent, "id">): GoogleEvent {
  const drop = (t: GoogleEventBody["start"]) =>
    Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null)) as GoogleEvent["start"];
  return { ...body, start: drop(body.start), end: drop(body.end), ...rest };
}

function gateway(over: Partial<CalendarGateway> = {}): CalendarGateway {
  return {
    listEvents: async () => [],
    insertEvent: async (_c: string, body: GoogleEventBody) =>
      echo(body, { id: `new-${body.extendedProperties.private.letsgoTaskId}`, updated: iso(at(12)) }),
    patchEvent: async (_c: string, eventId: string, body: GoogleEventBody) =>
      echo(body, { id: eventId, updated: iso(at(13)) }),
    deleteEvent: async () => undefined,
    ...over,
  };
}

const run = (gw: CalendarGateway, tasks: Task[]) => syncAccountWith(gw, account, tasks, at(12));

describe("syncAccountWith", () => {
  it("creates the event and stamps its id back onto the task", async () => {
    const t = task({ id: "t1", title: "Write spec", scheduledAt: at(9), estimateMin: 60 });
    const insertEvent = vi.fn(gateway().insertEvent);
    const result = await run(gateway({ insertEvent }), [t]);

    expect(insertEvent).toHaveBeenCalledTimes(1);
    expect(result.counts.created).toBe(1);
    const stamped = result.patches.find((p) => p.id === "t1")!;
    expect(stamped.fields.googleEvent).toMatchObject({ accountId: "acc1", calendarId: "primary", eventId: "new-t1" });
    expect(stamped.fields.googleEvent!.updated).toBe(iso(at(12)));
  });

  it("a PUSH writes back the link and nothing else, so a concurrent edit survives", async () => {
    // The bug this pins: a sync takes seconds, and it used to return the whole
    // task object as captured when it STARTED. Anything edited while it was in
    // flight was silently reverted to that snapshot when it landed — the user
    // retyped the same change three or four times before it stuck.
    const t = task({ id: "t1", title: "Old title", scheduledAt: at(9), estimateMin: 60 });
    const result = await run(gateway(), [t]);

    const patch = result.patches.find((p) => p.id === "t1")!;
    expect(Object.keys(patch.fields)).toEqual(["googleEvent"]);
    expect(patch.fields.title).toBeUndefined();
    expect(patch.fields.scheduledAt).toBeUndefined();
    expect(result.imports).toEqual([]);
  });

  it("patches a changed task and refreshes the stored stamp", async () => {
    const t = task({
      id: "t1", title: "Renamed", scheduledAt: at(9), estimateMin: 60,
      googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "ev1", updated: iso(at(8)) },
    });
    const remote: GoogleEvent = {
      id: "ev1", status: "confirmed", summary: "Old", updated: iso(at(8)),
      start: { dateTime: iso(at(9)) }, end: { dateTime: iso(at(10)) },
      extendedProperties: { private: { letsgoTaskId: "t1" } },
    };
    const result = await run(gateway({ listEvents: async () => [remote] }), [t]);

    expect(result.counts.updated).toBe(1);
    expect(result.patches[0].id).toBe("t1");
    expect(result.patches[0].fields.googleEvent!.updated).toBe(iso(at(13)));
    expect(Object.keys(result.patches[0].fields)).toEqual(["googleEvent"]);
  });

  it("deletes the event of a task that is gone, and reports it", async () => {
    const deleteEvent = vi.fn(async () => undefined);
    const remote: GoogleEvent = {
      id: "ev1", status: "confirmed", summary: "Orphan", updated: iso(at(8)),
      start: { dateTime: iso(at(9)) }, end: { dateTime: iso(at(10)) },
      extendedProperties: { private: { letsgoTaskId: "long-gone" } },
    };
    const result = await run(gateway({ listEvents: async () => [remote], deleteEvent }), []);

    expect(deleteEvent).toHaveBeenCalledWith("primary", "ev1");
    expect(result.counts.deleted).toBe(1);
  });

  it("passes pulled events and remote deletions through to the caller", async () => {
    const foreign: GoogleEvent = {
      id: "ev-x", status: "confirmed", summary: "Dentist", updated: iso(at(8)),
      start: { dateTime: iso(at(15)) }, end: { dateTime: iso(at(16)) },
    };
    const orphaned = task({
      id: "t-gone", scheduledAt: at(9), estimateMin: 60,
      googleEvent: { accountId: "acc1", calendarId: "primary", eventId: "vanished", updated: iso(at(8)) },
    });
    const result = await run(gateway({ listEvents: async () => [foreign] }), [orphaned]);

    expect(result.counts.pulled).toBe(1);
    expect(result.imports.some((t) => t.title === "Dentist")).toBe(true);
    expect(result.deletes).toEqual(["t-gone"]);
    expect(result.counts.removed).toBe(1);
  });

  it("keeps going when one event fails, and reports what broke", async () => {
    const a = task({ id: "a", title: "A", scheduledAt: at(9), estimateMin: 60 });
    const b = task({ id: "b", title: "B", scheduledAt: at(11), estimateMin: 60 });
    const insertEvent = vi.fn(async (_c: string, body: GoogleEventBody) => {
      if (body.summary === "A") throw new Error("boom");
      return echo(body, { id: "new-b", updated: iso(at(12)) });
    });
    const result = await run(gateway({ insertEvent }), [a, b]);

    expect(result.counts.created).toBe(1);
    expect(result.patches.map((p) => p.id)).toEqual(["b"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("A");
  });

  it("treats an already-deleted event as done, not as a failure", async () => {
    const remote: GoogleEvent = {
      id: "ev1", status: "confirmed", summary: "Orphan", updated: iso(at(8)),
      start: { dateTime: iso(at(9)) }, end: { dateTime: iso(at(10)) },
      extendedProperties: { private: { letsgoTaskId: "long-gone" } },
    };
    const deleteEvent = async () => { throw Object.assign(new Error("Not Found"), { status: 404 }); };
    const result = await run(gateway({ listEvents: async () => [remote], deleteEvent }), []);

    expect(result.errors).toHaveLength(0);
    expect(result.counts.deleted).toBe(1);
  });

  it("turns a 401/403 on the first call into a re-auth signal, not a generic error", async () => {
    const unauthorised = async () => { throw Object.assign(new Error("Invalid Credentials"), { status: 401 }); };
    await expect(run(gateway({ listEvents: unauthorised }), [])).rejects.toBeInstanceOf(NeedsConsentError);

    const forbidden = async () => { throw Object.assign(new Error("Forbidden"), { status: 403 }); };
    await expect(run(gateway({ listEvents: forbidden }), [])).rejects.toBeInstanceOf(NeedsConsentError);
  });

  it("lets any other listEvents failure through unchanged", async () => {
    const boom = async () => { throw Object.assign(new Error("network down"), { status: 0 }); };
    await expect(run(gateway({ listEvents: boom }), [])).rejects.toThrow("network down");
  });

  it("does nothing at all for a disabled account", async () => {
    const listEvents = vi.fn(async () => []);
    const result = await syncAccountWith(gateway({ listEvents }), { ...account, enabled: false }, [], at(12));
    expect(listEvents).not.toHaveBeenCalled();
    expect(result.patches).toEqual([]);
    expect(result.imports).toEqual([]);
  });
});
