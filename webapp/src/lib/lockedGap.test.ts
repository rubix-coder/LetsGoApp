// @vitest-environment node
/* A locked task is an immovable appointment. Nothing the auto-scheduler places
   may touch it, and "touch" is deliberately strict: a packed task must clear a
   locked one by the configured break on BOTH sides, so a 5-minute gap always
   separates them (never edge-to-edge, never overlapping). */
import { describe, expect, it } from "vitest";
import { lockedAnchors, packSubtree, placeAvoidingLocked, reflowFrom, type WorkWindow } from "./estimate";
import type { Task } from "./types";

const MIN = 60_000;
const DAY0 = new Date(2026, 6, 20, 0, 0, 0, 0).getTime(); // Mon 20 Jul 2026, local
const at = (hour: number, min = 0): number => DAY0 + hour * 3_600_000 + min * MIN;

function task(patch: Partial<Task> & Pick<Task, "id">): Task {
  return { title: patch.id, status: "pending", priority: 2, tags: [], createdAt: 0, loggedMin: 0, ...patch };
}

/** A locked 11:00–12:00 appointment. */
const standup = task({ id: "lock", title: "Standup", locked: true, scheduledAt: at(11), estimateMin: 60 });

describe("placeAvoidingLocked", () => {
  it("leaves a proposed slot alone when no locked task is near", () => {
    const p = placeAvoidingLocked(at(9), 30, [standup], 5);
    expect(p.start).toBe(at(9));
    expect(p.blockedBy).toBeUndefined();
  });

  it("pushes a slot that would overlap a locked task to after it plus the break", () => {
    const p = placeAvoidingLocked(at(11, 30), 30, [standup], 5);
    expect(p.start).toBe(at(12, 5));
    expect(p.blockedBy?.id).toBe("lock");
    expect(p.blockedUntil).toBe(at(12));
  });

  it("pushes a slot that would merely ABUT the locked start — the break is required before, too", () => {
    // 10:30 + 30m ends exactly at 11:00, the locked start: legal for a plain
    // packer, but it leaves no gap, so it moves after the lock instead.
    const p = placeAvoidingLocked(at(10, 30), 30, [standup], 5);
    expect(p.start).toBe(at(12, 5));
  });

  it("keeps a slot that already clears the locked start by the full break", () => {
    const p = placeAvoidingLocked(at(10, 25), 30, [standup], 5); // ends 10:55, 5m before 11:00
    expect(p.start).toBe(at(10, 25));
    expect(p.blockedBy).toBeUndefined();
  });

  it("keeps a slot that starts exactly one break after the locked end", () => {
    const p = placeAvoidingLocked(at(12, 5), 30, [standup], 5);
    expect(p.start).toBe(at(12, 5));
  });

  it("clears a CHAIN of locked tasks in one pass", () => {
    const second = task({ id: "lock2", title: "Review", locked: true, scheduledAt: at(12, 30), estimateMin: 30 });
    const p = placeAvoidingLocked(at(11, 30), 30, [standup, second], 5);
    expect(p.start).toBe(at(13, 5));
    expect(p.blockedBy?.id).toBe("lock2"); // reports the one that finally cleared
  });

  it("takes an anchor list that lockedAnchors has already filtered", () => {
    const finished = task({ id: "l3", locked: true, status: "done", scheduledAt: at(11), estimateMin: 60 });
    const skipped = task({ id: "l4", locked: true, status: "skipped", scheduledAt: at(11), estimateMin: 60 });
    const loose = task({ id: "l5", scheduledAt: at(11), estimateMin: 60 });
    const undated = task({ id: "l6", locked: true, estimateMin: 60 });
    const anchors = lockedAnchors([standup, finished, skipped, loose, undated]);
    expect(anchors.map((t) => t.id)).toEqual(["lock"]); // only the live, dated lock
    expect(placeAvoidingLocked(at(11), 30, anchors, 5).start).toBe(at(12, 5));
  });

  it("lockedAnchors can exclude the task being placed, so it never blocks itself", () => {
    expect(lockedAnchors([standup], "lock")).toEqual([]);
  });

  it("honours the work window while stepping past a lock", () => {
    const win: WorkWindow = { startMin: 9 * 60, endMin: 12 * 60 + 30 }; // closes 12:30
    // Pushed past the lock to 12:05, a 40m block would run to 12:45 — past
    // closing — so it rolls whole to the next day's opening.
    const p = placeAvoidingLocked(at(11, 30), 40, [standup], 5, win);
    expect(p.start).toBe(at(9) + 24 * 3_600_000);
  });

  it("respects a break of 0 — back-to-back with a locked task is then allowed", () => {
    const p = placeAvoidingLocked(at(11, 30), 30, [standup], 0);
    expect(p.start).toBe(at(12));
  });
});

describe("packSubtree with locked tasks in the way", () => {
  it("routes packed children around an unrelated locked appointment", () => {
    const root = task({ id: "root", scheduledAt: at(10) });
    const a = task({ id: "a", parentId: "root", estimateMin: 30 });
    const b = task({ id: "b", parentId: "root", estimateMin: 60 });
    const all = [root, a, b, standup];

    const packed = packSubtree(all, "root", at(10), undefined, 5);
    expect(packed.get("a")!.start).toBe(at(10));          // 10:00–10:30, clear
    // b would run 10:35–11:35 straight through the lock, so it lands after it.
    expect(packed.get("b")!.start).toBe(at(12, 5));
    expect(packed.get("root")).toEqual({ start: at(10), end: at(13, 5) });
  });

  it("treats a locked CHILD as a fixed anchor and flows its siblings around it", () => {
    const root = task({ id: "root", scheduledAt: at(9) });
    const first = task({ id: "first", parentId: "root", estimateMin: 30 });
    const pinned = task({ id: "pinned", parentId: "root", estimateMin: 60, locked: true, scheduledAt: at(14) });
    const last = task({ id: "last", parentId: "root", estimateMin: 30 });
    const packed = packSubtree([root, first, pinned, last], "root", at(9), undefined, 5);

    expect(packed.get("first")!.start).toBe(at(9));
    expect(packed.get("pinned")!.start).toBe(at(14));      // never moved
    expect(packed.get("last")!.start).toBe(at(15, 5));     // after the lock + break
  });
});

describe("reflowFrom with locked tasks in the way", () => {
  it("flows the tasks after a dropped leaf around a locked appointment", () => {
    const root = task({ id: "root", scheduledAt: at(9) });
    const a = task({ id: "a", parentId: "root", estimateMin: 30, scheduledAt: at(9) });
    const b = task({ id: "b", parentId: "root", estimateMin: 60, scheduledAt: at(9, 35) });
    const out = reflowFrom([root, a, b, standup], "a", at(10), undefined, 5)!;

    expect(out.find((t) => t.id === "a")!.scheduledAt).toBe(at(10)); // literal drop point
    expect(out.find((t) => t.id === "b")!.scheduledAt).toBe(at(12, 5));
  });

  it("snaps a leaf dropped ON a locked appointment clear of it", () => {
    const root = task({ id: "root", scheduledAt: at(9) });
    const a = task({ id: "a", parentId: "root", estimateMin: 30, scheduledAt: at(9) });
    const out = reflowFrom([root, a, standup], "a", at(11, 15), undefined, 5)!;
    expect(out.find((t) => t.id === "a")!.scheduledAt).toBe(at(12, 5));
  });
});
