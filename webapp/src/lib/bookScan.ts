/* The scanner's pure half — everything except the camera.

   Keeping this here means the behaviour that actually decides whether
   rapid-fire scanning works (dedupe, filtering, queue state) is tested, while
   ScanMode.tsx is left with nothing but camera plumbing. */

import { isBookBarcode, toIsbn13 } from "./isbn";

/** "dupe" = the book was already on the shelf before this session started.
    Distinct from the within-session dedupe, which never reaches the queue:
    that one silences a barcode the camera is still pointed at, while this one
    is a fact the user needs to see when working through a stack. */
export type ScanState = "pending" | "ok" | "miss" | "error" | "dupe";

export interface ScanEntry {
  isbn13: string;
  at: number;
  state: ScanState;
  title?: string;
  error?: string;
}

export interface ScanSession {
  /** Newest first — the on-screen strip reads top-down. */
  queue: ScanEntry[];
  /** isbn13 → when it was first accepted. Doubles as the dedupe index. */
  seen: Record<string, number>;
}

export const EMPTY_SESSION: ScanSession = { queue: [], seen: {} };

export type RejectReason = "not-a-book" | "invalid" | "duplicate";

export interface ScanOutcome {
  session: ScanSession;
  accepted: boolean;
  isbn13?: string;
  reason?: RejectReason;
}

/** Offers a raw barcode read to the session.

    Dedupe is PERMANENT within a session, not time-windowed. `BarcodeDetector`
    fires the same value on every frame while the phone is held on one spine —
    twenty-plus reads a second — and nobody deliberately re-scans a book they
    already caught. A time window would let a slow shelf produce duplicates
    while a fast one did not, which is worse than either extreme.

    Pass `format: ""` for manual typing, which skips the barcode-format check
    but still requires a valid ISBN. */
export function acceptScan(session: ScanSession, raw: string, format: string, now: number): ScanOutcome {
  const typed = format === "";
  if (!typed && !isBookBarcode(raw, format)) {
    return { session, accepted: false, reason: "not-a-book" };
  }
  const isbn13 = toIsbn13(raw);
  if (!isbn13) return { session, accepted: false, reason: "invalid" };
  if (session.seen[isbn13] !== undefined) {
    return { session, accepted: false, isbn13, reason: "duplicate" };
  }
  const entry: ScanEntry = { isbn13, at: now, state: "pending" };
  return {
    session: { queue: [entry, ...session.queue], seen: { ...session.seen, [isbn13]: now } },
    accepted: true,
    isbn13,
  };
}

/** Records what the lookup came back with. The entry stays in the queue
    either way — a miss is information, not something to hide. */
export function resolveScan(session: ScanSession, isbn13: string, patch: Partial<ScanEntry>): ScanSession {
  return {
    ...session,
    queue: session.queue.map((e) => (e.isbn13 === isbn13 ? { ...e, ...patch } : e)),
  };
}

/** In scan order (oldest first), so the worker fills the shelf the way it was
    walked rather than backwards. */
export function pendingIsbns(session: ScanSession): string[] {
  return session.queue.filter((e) => e.state === "pending").map((e) => e.isbn13).reverse();
}

export function scanCounts(session: ScanSession): {
  total: number; ok: number; unresolved: number; dupes: number;
} {
  let ok = 0;
  let dupes = 0;
  for (const e of session.queue) {
    if (e.state === "ok") ok++;
    else if (e.state === "dupe") dupes++;
  }
  // Already-owned books are neither new nor a problem to fix, so they are
  // counted out of "unresolved" — otherwise re-scanning a shelf you already
  // catalogued would report dozens of things needing attention.
  return { total: session.queue.length, ok, dupes, unresolved: session.queue.length - ok - dupes };
}
