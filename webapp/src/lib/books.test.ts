// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  bookDisplayAuthor, bookIdentity, clampPage, coverFallbackTint, coverUrlFor,
  dedupeBooks, duplicateCount, indexOfDuplicate, mergeDuplicate, newBook,
  readingFraction, readingStats,
} from "./books";

describe("newBook", () => {
  it("mints a usable book with sane defaults", () => {
    const book = newBook();
    expect(book.id).toMatch(/^b-\d+-\d+-\d+$/);
    expect(book.status).toBe("unread");
    expect(book.authors).toEqual([]);
    expect(book.tags).toEqual([]);
    expect(book.addedAt).toBeGreaterThan(0);
  });

  it("lets the patch win over every default", () => {
    const book = newBook({ title: "The Odyssey", status: "read", rating: 5 });
    expect(book.title).toBe("The Odyssey");
    expect(book.status).toBe("read");
    expect(book.rating).toBe(5);
  });

  /* A CSV import mints hundreds of books inside one millisecond. Relying on
     the clock plus randomness alone collides ~8% of the time at 400 books
     (birthday paradox over a million-wide range) — and a collision means
     upsertBook overwriting a different book. This is the regression guard. */
  it("gives distinct ids across a rapid burst — a CSV import mints hundreds at once", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newBook().id));
    expect(ids.size).toBe(5000);
  });
});

describe("coverUrlFor", () => {
  it("derives the URL from the ISBN so nothing needs storing", () => {
    const url = coverUrlFor(newBook({ isbn13: "9780140449136" }), "M");
    expect(url).toBe("https://covers.openlibrary.org/b/isbn/9780140449136-M.jpg?default=false");
  });

  it("always asks for default=false, so a missing cover 404s instead of returning a blank GIF", () => {
    expect(coverUrlFor(newBook({ isbn13: "9780140449136" }))).toContain("?default=false");
  });

  it("honours the requested size", () => {
    expect(coverUrlFor(newBook({ isbn13: "9780140449136" }), "L")).toContain("-L.jpg");
    expect(coverUrlFor(newBook({ isbn13: "9780140449136" }), "S")).toContain("-S.jpg");
  });

  it("prefers a stored URL — that is the only reason to store one", () => {
    const book = newBook({ isbn13: "9780140449136", coverUrl: "https://books.google.com/x.jpg" });
    expect(coverUrlFor(book)).toBe("https://books.google.com/x.jpg");
  });

  it("is undefined with neither an ISBN nor a stored URL", () => {
    expect(coverUrlFor(newBook({ title: "Hand-added" }))).toBeUndefined();
  });
});

describe("coverFallbackTint", () => {
  it("is stable for the same seed, so a card does not change colour on rerender", () => {
    expect(coverFallbackTint("The Odyssey")).toBe(coverFallbackTint("The Odyssey"));
  });

  it("separates different books", () => {
    const tints = new Set(["Dune", "Ulysses", "Beloved", "Hamlet"].map(coverFallbackTint));
    expect(tints.size).toBeGreaterThan(1);
  });

  it("emits a token-based color-mix, never a raw hex", () => {
    const tint = coverFallbackTint("Dune");
    expect(tint).toContain("var(--color-accent)");
    expect(tint).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("survives an empty seed", () => {
    expect(coverFallbackTint("")).toContain("color-mix");
  });
});

describe("bookDisplayAuthor", () => {
  it("names one, joins two, and counts the rest", () => {
    expect(bookDisplayAuthor(newBook({ authors: ["Homer"] }))).toBe("Homer");
    expect(bookDisplayAuthor(newBook({ authors: ["Homer", "Fagles"] }))).toBe("Homer & Fagles");
    expect(bookDisplayAuthor(newBook({ authors: ["Homer", "Fagles", "Knox"] }))).toBe("Homer +2");
  });

  it("says so when the author is unknown", () => {
    expect(bookDisplayAuthor(newBook({ authors: [] }))).toBe("Unknown author");
  });
});

describe("readingFraction", () => {
  const base = newBook({ title: "T" });

  it("is null with no bookmark placed", () => {
    expect(readingFraction({ ...base, pageCount: 300 })).toBe(null);
  });

  it("is null when the page count is unknown", () => {
    // The common case for regional editions — no bar rather than a wrong one.
    expect(readingFraction({ ...base, currentPage: 40 })).toBe(null);
  });

  it("is 0 at page 0, not null", () => {
    expect(readingFraction({ ...base, currentPage: 0, pageCount: 200 })).toBe(0);
  });

  it("reports the fraction read", () => {
    expect(readingFraction({ ...base, currentPage: 50, pageCount: 200 })).toBe(0.25);
  });

  it("never exceeds 1 when the page count is wrong", () => {
    expect(readingFraction({ ...base, currentPage: 400, pageCount: 200 })).toBe(1);
  });

  it("treats a zero page count as unknown, not a division by zero", () => {
    expect(readingFraction({ ...base, currentPage: 10, pageCount: 0 })).toBe(null);
  });
});

describe("clampPage", () => {
  it("takes the bookmark out on an empty field", () => {
    expect(clampPage("")).toBe(undefined);
    expect(clampPage("   ")).toBe(undefined);
  });

  it("keeps page 0 as a real page rather than folding it into 'unset'", () => {
    expect(clampPage("0")).toBe(0);
  });

  it("parses a plain number", () => {
    expect(clampPage("137")).toBe(137);
  });

  it("floors a fraction and rejects negatives", () => {
    expect(clampPage("42.9")).toBe(42);
    expect(clampPage("-5")).toBe(0);
  });

  it("clamps to the page count when one is known", () => {
    expect(clampPage("999", 300)).toBe(300);
  });

  it("trusts the user when no page count is known", () => {
    expect(clampPage("999")).toBe(999);
  });

  it("ignores a page count of zero rather than clamping everything to 0", () => {
    expect(clampPage("50", 0)).toBe(50);
  });

  it("returns undefined for junk rather than NaN", () => {
    expect(clampPage("abc")).toBe(undefined);
  });
});

describe("bookIdentity", () => {
  it("keys on the ISBN when there is one", () => {
    const a = newBook({ title: "Dune", isbn13: "9780441013593" });
    const b = newBook({ title: "DUNE (movie tie-in)", isbn13: "9780441013593" });
    // Different printings of the same ISBN are the same physical book.
    expect(bookIdentity(a)).toBe(bookIdentity(b));
  });

  it("falls back to title and lead author, ignoring case and accents", () => {
    const a = newBook({ title: "Cien años de soledad", authors: ["Gabriel García Márquez"] });
    const b = newBook({ title: "cien anos de soledad", authors: ["Gabriel Garcia Marquez"] });
    expect(bookIdentity(a)).toBe(bookIdentity(b));
  });

  it("separates same-title books by different authors", () => {
    const a = newBook({ title: "Ulysses", authors: ["James Joyce"] });
    const b = newBook({ title: "Ulysses", authors: ["Alfred Tennyson"] });
    expect(bookIdentity(a)).not.toBe(bookIdentity(b));
  });

  it("is null when there is nothing to key on", () => {
    // Otherwise every untitled record would merge into a single book.
    expect(bookIdentity(newBook({ title: "" }))).toBe(null);
    expect(bookIdentity(newBook({ title: "   " }))).toBe(null);
  });
});

describe("dedupeBooks", () => {
  it("leaves a shelf with no duplicates alone", () => {
    const books = [newBook({ title: "A" }), newBook({ title: "B" })];
    const out = dedupeBooks(books);
    expect(out.removed).toBe(0);
    expect(out.books).toHaveLength(2);
  });

  it("collapses the same ISBN scanned in two sessions", () => {
    const first = newBook({ isbn13: "9780441013593", title: "Dune", status: "read" });
    const second = newBook({ isbn13: "9780441013593", title: "9780441013593" });
    const out = dedupeBooks([first, second]);
    expect(out.removed).toBe(1);
    expect(out.books).toHaveLength(1);
    // The earliest record wins its identity, so its id survives.
    expect(out.books[0].id).toBe(first.id);
    expect(out.books[0].status).toBe("read");
  });

  it("prefers a real title over an ISBN placeholder", () => {
    const placeholder = newBook({ isbn13: "9780441013593", title: "9780441013593" });
    const real = newBook({ isbn13: "9780441013593", title: "Dune" });
    expect(dedupeBooks([placeholder, real]).books[0].title).toBe("Dune");
  });

  it("keeps the furthest-read bookmark", () => {
    const a = newBook({ isbn13: "9780441013593", title: "Dune", currentPage: 200 });
    const b = newBook({ isbn13: "9780441013593", title: "Dune", currentPage: 40 });
    expect(dedupeBooks([a, b]).books[0].currentPage).toBe(200);
    expect(dedupeBooks([b, a]).books[0].currentPage).toBe(200);
  });

  it("never merges untitled ISBN-less records together", () => {
    const books = [newBook({ title: "" }), newBook({ title: "" }), newBook({ title: "" })];
    expect(dedupeBooks(books).removed).toBe(0);
  });

  it("collapses three copies into one", () => {
    const mk = () => newBook({ isbn13: "9780441013593", title: "Dune" });
    const out = dedupeBooks([mk(), mk(), mk()]);
    expect(out.removed).toBe(2);
    expect(out.books).toHaveLength(1);
  });

  it("preserves shelf order for everything it keeps", () => {
    const a = newBook({ title: "Alpha" });
    const dup = newBook({ title: "Alpha" });
    const c = newBook({ title: "Charlie" });
    expect(dedupeBooks([a, c, dup]).books.map((b) => b.title)).toEqual(["Alpha", "Charlie"]);
  });

  it("duplicateCount agrees with what dedupe would remove", () => {
    const mk = () => newBook({ isbn13: "9780441013593", title: "Dune" });
    expect(duplicateCount([mk(), mk(), newBook({ title: "Other" })])).toBe(1);
  });
});

describe("mergeDuplicate", () => {
  it("fills gaps without overwriting what the user curated", () => {
    const mine = newBook({ title: "Dune", rating: 5, notes: "mine", shelf: "Study" });
    const other = newBook({ title: "Dune", rating: 2, notes: "theirs", shelf: "Attic", publisher: "Ace" });
    const merged = mergeDuplicate(mine, other);
    expect(merged.rating).toBe(5);
    expect(merged.notes).toBe("mine");
    expect(merged.shelf).toBe("Study");
    // ...but a field the user never set is worth taking.
    expect(merged.publisher).toBe("Ace");
  });
});

describe("indexOfDuplicate", () => {
  it("finds a match by ISBN and ignores the record itself", () => {
    const existing = newBook({ isbn13: "9780441013593", title: "Dune" });
    const incoming = newBook({ isbn13: "9780441013593", title: "9780441013593" });
    expect(indexOfDuplicate([existing], incoming)).toBe(0);
    // Saving an edit to a book must not find that same book as its own dupe.
    expect(indexOfDuplicate([existing], existing)).toBe(-1);
  });

  it("returns -1 when there is nothing to key on", () => {
    expect(indexOfDuplicate([newBook({ title: "" })], newBook({ title: "" }))).toBe(-1);
  });
});

describe("readingStats", () => {
  it("is all zeroes for an empty shelf, without dividing by zero", () => {
    const s = readingStats([]);
    expect(s.total).toBe(0);
    expect(s.pctRead).toBe(0);
  });

  it("counts each status and the share read", () => {
    const s = readingStats([
      newBook({ title: "a", status: "read" }),
      newBook({ title: "b", status: "read" }),
      newBook({ title: "c", status: "reading" }),
      newBook({ title: "d", status: "unread" }),
    ]);
    expect(s).toMatchObject({ total: 4, read: 2, reading: 1, unread: 1, dnf: 0, pctRead: 50, pctReading: 25 });
  });

  it("counts abandoned books separately from read ones", () => {
    // Rolling DNF into "read" would flatter the number the user is moving.
    const s = readingStats([
      newBook({ title: "a", status: "read" }),
      newBook({ title: "b", status: "dnf" }),
    ]);
    expect(s.read).toBe(1);
    expect(s.dnf).toBe(1);
    expect(s.pctRead).toBe(50);
  });

  it("counts a finished book's full length, and a bookmark mid-book", () => {
    const s = readingStats([
      newBook({ title: "a", status: "read", pageCount: 300 }),
      newBook({ title: "b", status: "reading", pageCount: 400, currentPage: 100 }),
    ]);
    expect(s.pagesRead).toBe(400);
    expect(s.pagesKnownFor).toBe(2);
  });

  it("ignores books with no page count rather than guessing", () => {
    const s = readingStats([
      newBook({ title: "a", status: "read" }),
      newBook({ title: "b", status: "read", pageCount: 200 }),
    ]);
    expect(s.pagesRead).toBe(200);
    expect(s.pagesKnownFor).toBe(1);
  });

  it("clamps a bookmark past the end", () => {
    const s = readingStats([newBook({ title: "a", status: "reading", pageCount: 100, currentPage: 999 })]);
    expect(s.pagesRead).toBe(100);
  });

  /* A wishlist book is one you do NOT own. Counting it as unread would mean
     every book you ever wanted dragged down "how much of my shelf have I
     read", which is the one number the card exists to show. */
  it("keeps wishlist books out of the shelf totals", () => {
    const s = readingStats([
      newBook({ title: "a", status: "read" }),
      newBook({ title: "b", status: "wishlist" }),
      newBook({ title: "c", status: "wishlist" }),
    ]);
    expect(s.total).toBe(1);
    expect(s.unread).toBe(0);
    expect(s.pctRead).toBe(100);
    expect(s.wishlist).toBe(2);
  });

  it("does not count pages of a book that is not on the shelf yet", () => {
    const s = readingStats([newBook({ title: "a", status: "wishlist", pageCount: 300 })]);
    expect(s.pagesKnownFor).toBe(0);
    expect(s.pagesRead).toBe(0);
  });

  it("is all zeroes for a shelf that is only a wishlist", () => {
    const s = readingStats([newBook({ title: "a", status: "wishlist" })]);
    expect(s.total).toBe(0);
    expect(s.pctRead).toBe(0);
    expect(s.wishlist).toBe(1);
  });
});
