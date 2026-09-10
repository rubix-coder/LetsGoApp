// @vitest-environment node
import { describe, expect, it } from "vitest";
import { newBook } from "./books";
import {
  authorSortKey, bookFacets, EMPTY_QUERY, filterBooks, fold, groupBooks, matchesBook,
  sortBooks, unresolvedBooks,
} from "./bookFilter";
import type { Book } from "./types";
import type { BookQuery as Q } from "./bookFilter";

const odyssey = newBook({
  id: "b1", title: "The Odyssey", authors: ["Homer"], isbn13: "9780140449136", isbn10: "0140449132",
  status: "read", rating: 5, shelf: "Living room", tags: ["classics", "poetry"],
  addedAt: 300, finishedAt: 900, publishedYear: 1999,
});
const jane = newBook({
  id: "b2", title: "Jane Eyre", authors: ["Charlotte Brontë"], status: "reading",
  shelf: "Bedside", tags: ["classics"], addedAt: 200, publishedYear: 1847,
});
const dune = newBook({
  id: "b3", title: "Dune", authors: ["Frank Herbert"], status: "unread",
  shelf: "Living room", tags: ["sci-fi"], addedAt: 100, rating: 4, publishedYear: 1965,
});
const all = [odyssey, jane, dune];

const q = (patch: Partial<Q> = {}): Q => ({ ...EMPTY_QUERY, ...patch });

describe("fold", () => {
  it("strips diacritics so plain typing finds accented names", () => {
    expect(fold("Brontë")).toBe("bronte");
    expect(fold("García Márquez")).toBe("garcia marquez");
  });
});

describe("matchesBook — text", () => {
  it("hits the title", () => {
    expect(matchesBook(odyssey, q({ text: "odys" }))).toBe(true);
  });

  it("hits any author, not just the first", () => {
    const co = newBook({ title: "X", authors: ["Homer", "Robert Fagles"] });
    expect(matchesBook(co, q({ text: "fagles" }))).toBe(true);
  });

  it("finds an accented author from unaccented typing", () => {
    expect(matchesBook(jane, q({ text: "bronte" }))).toBe(true);
  });

  it("hits both ISBN forms", () => {
    expect(matchesBook(odyssey, q({ text: "9780140449136" }))).toBe(true);
    expect(matchesBook(odyssey, q({ text: "0140449132" }))).toBe(true);
  });

  it("matches a hyphenated ISBN against the bare stored digits", () => {
    expect(matchesBook(odyssey, q({ text: "978-0-14-044913-6" }))).toBe(true);
  });

  it("hits shelf and tags", () => {
    expect(matchesBook(odyssey, q({ text: "living" }))).toBe(true);
    expect(matchesBook(dune, q({ text: "sci-fi" }))).toBe(true);
  });

  it("misses what it should", () => {
    expect(matchesBook(dune, q({ text: "odyssey" }))).toBe(false);
  });

  it("ignores surrounding whitespace", () => {
    expect(matchesBook(dune, q({ text: "  dune  " }))).toBe(true);
  });
});

describe("matchesBook — facets", () => {
  it("filters by status", () => {
    expect(filterBooks(all, q({ status: "read" })).map((b) => b.id)).toEqual(["b1"]);
  });

  it("ORs within the tag facet", () => {
    expect(filterBooks(all, q({ tags: ["sci-fi", "poetry"] })).map((b) => b.id).sort()).toEqual(["b1", "b3"]);
  });

  it("ANDs across facets", () => {
    // "classics" matches two books; the Bedside shelf narrows it to one.
    expect(filterBooks(all, q({ tags: ["classics"], shelves: ["Bedside"] })).map((b) => b.id)).toEqual(["b2"]);
  });

  it("combines text with facets", () => {
    expect(filterBooks(all, q({ text: "e", status: "unread" })).map((b) => b.id)).toEqual(["b3"]);
  });

  it("returns everything for the empty query", () => {
    expect(filterBooks(all, EMPTY_QUERY)).toHaveLength(3);
  });
});

describe("sortBooks", () => {
  it("defaults to newest added first", () => {
    expect(sortBooks(all, "added").map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("sorts by title", () => {
    expect(sortBooks(all, "title").map((b) => b.title)).toEqual(["Dune", "Jane Eyre", "The Odyssey"]);
  });

  it("sorts by surname", () => {
    expect(sortBooks(all, "author").map((b) => b.id)).toEqual(["b2", "b3", "b1"]);
  });

  it("puts unrated last rather than treating it as zero stars", () => {
    const ids = sortBooks(all, "rating").map((b) => b.id);
    expect(ids).toEqual(["b1", "b3", "b2"]);
    expect(ids[ids.length - 1]).toBe("b2");
  });

  it("puts unfinished last", () => {
    expect(sortBooks(all, "finished").map((b) => b.id)[0]).toBe("b1");
    expect(sortBooks(all, "finished").map((b) => b.id).slice(1).sort()).toEqual(["b2", "b3"]);
  });

  it("breaks ties on title so the grid never reshuffles", () => {
    const a = newBook({ id: "x", title: "Beta", addedAt: 50 });
    const b = newBook({ id: "y", title: "Alpha", addedAt: 50 });
    expect(sortBooks([a, b], "added").map((x) => x.title)).toEqual(["Alpha", "Beta"]);
    expect(sortBooks([b, a], "added").map((x) => x.title)).toEqual(["Alpha", "Beta"]);
  });

  it("does not mutate its input", () => {
    const input = [...all];
    sortBooks(input, "title");
    expect(input.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
  });
});

describe("authorSortKey", () => {
  it("puts the surname first", () => {
    expect(authorSortKey(["Frank Herbert"])).toBe("herbert, frank");
  });

  it("keeps a lowercase particle with the surname", () => {
    expect(authorSortKey(["Ursula K. Le Guin"])).toBe("le guin, ursula k.");
    expect(authorSortKey(["Simone de Beauvoir"])).toBe("de beauvoir, simone");
  });

  it("handles a mononym", () => {
    expect(authorSortKey(["Homer"])).toBe("homer");
  });

  it("does not treat a suffix as the surname", () => {
    expect(authorSortKey(["Martin Luther King Jr."])).toBe("king jr., martin luther");
  });

  it("sorts an unknown author last", () => {
    const known = authorSortKey(["Zadie Smith"]);
    expect(authorSortKey([]) > known).toBe(true);
  });
});

describe("bookFacets", () => {
  it("dedupes, sorts and counts", () => {
    const facets = bookFacets(all);
    expect(facets.tags).toEqual(["classics", "poetry", "sci-fi"]);
    expect(facets.shelves).toEqual(["Bedside", "Living room"]);
    expect(facets.counts).toEqual({ wishlist: 0, unread: 1, reading: 1, read: 1, dnf: 0 });
  });

  it("is empty-safe", () => {
    expect(bookFacets([])).toEqual({ tags: [], shelves: [], counts: { wishlist: 0, unread: 0, reading: 0, read: 0, dnf: 0 } });
  });
});

describe("wishlist filtering", () => {
  const shelf = [
    newBook({ title: "Owned", status: "unread" }),
    newBook({ title: "Wanted", status: "wishlist" }),
    newBook({ title: "Also wanted", status: "wishlist" }),
  ];

  it("shows only what is not owned yet", () => {
    const wanted = filterBooks(shelf, { ...EMPTY_QUERY, status: "wishlist" });
    expect(wanted.map((b) => b.title)).toEqual(["Also wanted", "Wanted"]);
  });

  it("counts the wishlist as its own facet", () => {
    expect(bookFacets(shelf).counts.wishlist).toBe(2);
  });

  /* Grouped by status, the wishlist sits at the end: it is the one group
     that is not on a shelf at all, so it must not push the books you own
     off the first screen. */
  it("groups the wishlist last, behind everything owned", () => {
    const grouped = groupBooks(filterBooks(shelf, EMPTY_QUERY), "status");
    expect(grouped[grouped.length - 1].label).toBe("Wishlist");
  });
});

describe("unresolvedBooks", () => {
  it("finds scans whose title is still their ISBN", () => {
    const bare: Book = newBook({ isbn13: "9780140449136", title: "9780140449136" });
    expect(unresolvedBooks([odyssey, bare]).map((b) => b.id)).toEqual([bare.id]);
  });

  it("ignores hand-added books with no ISBN", () => {
    expect(unresolvedBooks([newBook({ title: "Handwritten journal" })])).toEqual([]);
  });
});

describe("groupBooks", () => {
  const mk = (patch: Partial<Book>) => newBook({ title: "T", ...patch });

  it("returns one unlabelled group when grouping is off", () => {
    const out = groupBooks([mk({ title: "A" }), mk({ title: "B" })], "none");
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("");
    expect(out[0].books).toHaveLength(2);
  });

  it("groups by author, sorted by surname", () => {
    const out = groupBooks(
      [mk({ authors: ["Iain Banks"] }), mk({ authors: ["Ursula K. Le Guin"] })],
      "author",
    );
    expect(out.map((g) => g.label)).toEqual(["Iain Banks", "Ursula K. Le Guin"]);
  });

  it("puts unknown authors last, never first", () => {
    const out = groupBooks([mk({ authors: [] }), mk({ authors: ["Iain Banks"] })], "author");
    expect(out.map((g) => g.label)).toEqual(["Iain Banks", "Unknown author"]);
  });

  it("orders years newest first, with unknown last", () => {
    const out = groupBooks(
      [mk({ publishedYear: 1990 }), mk({}), mk({ publishedYear: 2020 })],
      "year",
    );
    expect(out.map((g) => g.label)).toEqual(["2020", "1990", "Year unknown"]);
  });

  it("orders years numerically, not as strings", () => {
    // Zero-padding is what stops "999" sorting above "1990".
    const out = groupBooks([mk({ publishedYear: 999 }), mk({ publishedYear: 1990 })], "year");
    expect(out.map((g) => g.label)).toEqual(["1990", "999"]);
  });

  it("groups titles by initial, folding accents", () => {
    const out = groupBooks([mk({ title: "Émile" }), mk({ title: "Anna" })], "title");
    expect(out.map((g) => g.label)).toEqual(["A", "E"]);
  });

  it("buckets non-letter initials under #", () => {
    const out = groupBooks([mk({ title: "1984" }), mk({ title: "Anna" })], "title");
    expect(out.map((g) => g.label)).toEqual(["#", "A"]);
  });

  it("orders status by reading order, not alphabetically", () => {
    const out = groupBooks(
      [mk({ status: "dnf" }), mk({ status: "read" }), mk({ status: "reading" }), mk({ status: "unread" })],
      "status",
    );
    expect(out.map((g) => g.label)).toEqual(["Reading", "Unread", "Read", "Did not finish"]);
  });

  it("groups by publisher with unknown last", () => {
    const out = groupBooks([mk({}), mk({ publisher: "Ace" })], "publisher");
    expect(out.map((g) => g.label)).toEqual(["Ace", "Unknown publisher"]);
  });

  it("keeps every book exactly once", () => {
    const books = [mk({ title: "A" }), mk({ title: "B" }), mk({ title: "C", authors: ["X"] })];
    const out = groupBooks(books, "author");
    expect(out.flatMap((g) => g.books)).toHaveLength(3);
  });

  it("preserves the caller's sort order within a group", () => {
    // Grouping and sorting compose; grouping must not re-sort.
    const books = [mk({ title: "Zoe", authors: ["A B"] }), mk({ title: "Adam", authors: ["A B"] })];
    expect(groupBooks(books, "author")[0].books.map((b) => b.title)).toEqual(["Zoe", "Adam"]);
  });
});
