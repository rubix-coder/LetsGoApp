// @vitest-environment node
import { describe, expect, it } from "vitest";
import { acceptScan, EMPTY_SESSION, pendingIsbns, resolveScan, scanCounts, type ScanSession } from "./bookScan";

const ODYSSEY = "9780140449136";
const DUNE = "9780441013593";

/** Feeds barcodes in one after another, as the detect loop would. */
function scanAll(reads: [string, number][], format = "ean_13"): ScanSession {
  let session = EMPTY_SESSION;
  for (const [raw, at] of reads) session = acceptScan(session, raw, format, at).session;
  return session;
}

describe("acceptScan — dedupe", () => {
  it("accepts a book once and rejects the frames that follow", () => {
    // What one spine actually produces: the detector firing every frame.
    const reads: [string, number][] = Array.from({ length: 20 }, (_, i) => [ODYSSEY, 1000 + i * 25]);
    const session = scanAll(reads);
    expect(session.queue).toHaveLength(1);
    expect(session.queue[0].isbn13).toBe(ODYSSEY);
  });

  it("tells the caller why it rejected, so nothing beeps", () => {
    const first = acceptScan(EMPTY_SESSION, ODYSSEY, "ean_13", 1000);
    expect(first.accepted).toBe(true);
    const second = acceptScan(first.session, ODYSSEY, "ean_13", 1025);
    expect(second.accepted).toBe(false);
    expect(second.reason).toBe("duplicate");
    expect(second.isbn13).toBe(ODYSSEY);
  });

  it("is still a duplicate much later — the policy is permanent, not a time window", () => {
    const first = acceptScan(EMPTY_SESSION, ODYSSEY, "ean_13", 1000);
    const later = acceptScan(first.session, ODYSSEY, "ean_13", 1000 + 30_000);
    expect(later.accepted).toBe(false);
    expect(later.reason).toBe("duplicate");
  });

  it("keeps distinct books", () => {
    const session = scanAll([[ODYSSEY, 1000], [DUNE, 2000], [ODYSSEY, 3000]]);
    expect(session.queue.map((e) => e.isbn13)).toEqual([DUNE, ODYSSEY]);
  });

  it("dedupes across ISBN forms — the same book is the same book", () => {
    const first = acceptScan(EMPTY_SESSION, "0140449132", "", 1000);
    expect(first.accepted).toBe(true);
    expect(first.isbn13).toBe(ODYSSEY);
    expect(acceptScan(first.session, ODYSSEY, "ean_13", 2000).reason).toBe("duplicate");
  });
});

describe("acceptScan — what is not a book", () => {
  it("rejects a UPC-A off a boxed set", () => {
    const out = acceptScan(EMPTY_SESSION, "012345678905", "upc_a", 1000);
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe("not-a-book");
    expect(out.session.queue).toHaveLength(0);
  });

  it("rejects a magazine's 977 EAN", () => {
    expect(acceptScan(EMPTY_SESSION, "9771234567003", "ean_13", 1000).reason).toBe("not-a-book");
  });

  it("rejects a barcode with a broken checksum", () => {
    expect(acceptScan(EMPTY_SESSION, "9780140449137", "ean_13", 1000).reason).toBe("not-a-book");
  });

  it("leaves the session untouched on a rejection", () => {
    const session = scanAll([[ODYSSEY, 1000]]);
    const out = acceptScan(session, "012345678905", "upc_a", 2000);
    expect(out.session).toBe(session);
  });
});

describe("acceptScan — manual entry", () => {
  it("accepts a typed ISBN-10 and stores it as 13", () => {
    const out = acceptScan(EMPTY_SESSION, "0140449132", "", 1000);
    expect(out.accepted).toBe(true);
    expect(out.session.queue[0].isbn13).toBe(ODYSSEY);
  });

  it("accepts a typed ISBN with hyphens", () => {
    expect(acceptScan(EMPTY_SESSION, "978-0-14-044913-6", "", 1000).accepted).toBe(true);
  });

  it("rejects typed junk as invalid rather than not-a-book", () => {
    const out = acceptScan(EMPTY_SESSION, "12345", "", 1000);
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe("invalid");
  });
});

describe("resolveScan", () => {
  it("marks an entry resolved with its title", () => {
    const session = resolveScan(scanAll([[ODYSSEY, 1000]]), ODYSSEY, { state: "ok", title: "The Odyssey" });
    expect(session.queue[0]).toMatchObject({ state: "ok", title: "The Odyssey" });
  });

  it("keeps a miss in the queue — a miss is information", () => {
    const session = resolveScan(scanAll([[ODYSSEY, 1000]]), ODYSSEY, { state: "miss" });
    expect(session.queue).toHaveLength(1);
    expect(session.queue[0].state).toBe("miss");
  });

  it("touches only the entry named", () => {
    const session = resolveScan(scanAll([[ODYSSEY, 1000], [DUNE, 2000]]), ODYSSEY, { state: "ok" });
    expect(session.queue.find((e) => e.isbn13 === DUNE)!.state).toBe("pending");
  });

  it("ignores an isbn that is not in the queue", () => {
    const session = scanAll([[ODYSSEY, 1000]]);
    expect(resolveScan(session, DUNE, { state: "ok" }).queue).toHaveLength(1);
  });
});

describe("pendingIsbns", () => {
  it("returns only pending entries, oldest first", () => {
    let session = scanAll([[ODYSSEY, 1000], [DUNE, 2000]]);
    expect(pendingIsbns(session)).toEqual([ODYSSEY, DUNE]);
    session = resolveScan(session, ODYSSEY, { state: "ok" });
    expect(pendingIsbns(session)).toEqual([DUNE]);
  });

  it("is empty once everything resolved", () => {
    let session = scanAll([[ODYSSEY, 1000]]);
    session = resolveScan(session, ODYSSEY, { state: "miss" });
    expect(pendingIsbns(session)).toEqual([]);
  });
});

describe("scanCounts", () => {
  it("counts resolved against the rest", () => {
    let session = scanAll([[ODYSSEY, 1000], [DUNE, 2000]]);
    session = resolveScan(session, ODYSSEY, { state: "ok" });
    expect(scanCounts(session)).toEqual({ total: 2, ok: 1, dupes: 0, unresolved: 1 });
  });
});

describe("scanCounts — already-owned books", () => {
  it("counts a dupe as neither new nor needing attention", () => {
    /* Re-scanning a shelf you already catalogued must not report dozens of
       things to fix — that is the difference between a useful count and a
       wall of false alarms. */
    let s = acceptScan(EMPTY_SESSION, "9780441013593", "ean_13", 0).session;
    s = resolveScan(s, "9780441013593", { state: "dupe", title: "Dune" });
    expect(scanCounts(s)).toEqual({ total: 1, ok: 0, dupes: 1, unresolved: 0 });
  });

  it("keeps ok, dupe and pending apart", () => {
    let s = acceptScan(EMPTY_SESSION, "9780441013593", "ean_13", 0).session;
    s = acceptScan(s, "9780140449136", "ean_13", 1).session;
    s = acceptScan(s, "9780156012195", "ean_13", 2).session;
    s = resolveScan(s, "9780441013593", { state: "ok" });
    s = resolveScan(s, "9780140449136", { state: "dupe" });
    expect(scanCounts(s)).toEqual({ total: 3, ok: 1, dupes: 1, unresolved: 1 });
  });
});
