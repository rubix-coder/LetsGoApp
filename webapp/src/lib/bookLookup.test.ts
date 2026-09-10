// @vitest-environment node
import { describe, expect, it } from "vitest";
import { newBook } from "./books";
import {
  bookFromLookup, lookupIsbn, mapGoogleBooks, mapOpenLibrary, mapOpenLibrarySearch,
  autoResolveBook, mergeLookupIntoBook, parseYear, resolveSummary, searchTitles,
  type BookGateway, type LookupResult,
} from "./bookLookup";

const ISBN = "9780140449136";

const OL_HIT = {
  [`ISBN:${ISBN}`]: {
    title: "The Odyssey",
    authors: [{ name: "Homer" }, { name: "Robert Fagles" }],
    publishers: [{ name: "Penguin Classics" }],
    publish_date: "November 30, 1999",
    number_of_pages: 560,
    identifiers: { isbn_10: ["0140449132"], isbn_13: [ISBN] },
    subjects: [{ name: "Epic poetry, Greek" }, { name: "Odysseus" }],
    cover: { medium: "https://covers.openlibrary.org/b/id/1-M.jpg" },
  },
};

const GOOGLE_HIT = {
  totalItems: 1,
  items: [{
    volumeInfo: {
      title: "The Odyssey",
      authors: ["Homer"],
      publisher: "Penguin",
      publishedDate: "1999-11-30",
      pageCount: 560,
      industryIdentifiers: [
        { type: "ISBN_13", identifier: ISBN },
        { type: "ISBN_10", identifier: "0140449132" },
      ],
      imageLinks: { thumbnail: "http://books.google.com/x.jpg?edge=curl&zoom=1" },
    },
  }],
};

function gateway(open: unknown, google: unknown, titles: unknown = { docs: [] }): BookGateway {
  return {
    openLibrary: async () => open,
    googleBooks: async () => google,
    searchTitleOpenLibrary: async () => titles,
    searchTitleGoogle: async () => ({ totalItems: 0 }),
  };
}

describe("parseYear", () => {
  it("digs a year out of every shape these feeds use", () => {
    expect(parseYear("1999")).toBe(1999);
    expect(parseYear("November 30, 1999")).toBe(1999);
    expect(parseYear("1999-11-30")).toBe(1999);
    expect(parseYear("c1999")).toBe(1999);
  });

  it("is undefined for nothing usable", () => {
    expect(parseYear(undefined)).toBeUndefined();
    expect(parseYear("")).toBeUndefined();
    expect(parseYear("n.d.")).toBeUndefined();
  });
});

describe("mapOpenLibrary", () => {
  it("maps the record", () => {
    const r = mapOpenLibrary(OL_HIT, ISBN)!;
    expect(r).toMatchObject({
      title: "The Odyssey", publisher: "Penguin Classics", publishedYear: 1999,
      pageCount: 560, isbn13: ISBN, isbn10: "0140449132", provider: "openlibrary",
    });
    expect(r.authors).toEqual(["Homer", "Robert Fagles"]);
  });

  it("returns null on a miss — Open Library answers 200 with {}", () => {
    expect(mapOpenLibrary({}, ISBN)).toBeNull();
  });

  it("returns null when the payload is for a different ISBN", () => {
    expect(mapOpenLibrary(OL_HIT, "9780441013593")).toBeNull();
  });

  it("survives junk", () => {
    for (const bad of [null, undefined, "", 42, []]) {
      expect(mapOpenLibrary(bad, ISBN)).toBeNull();
    }
  });

  it("does not turn subjects into tags", () => {
    // Dozens of LoC headings per book would bury the handful a person chose.
    expect(JSON.stringify(mapOpenLibrary(OL_HIT, ISBN))).not.toContain("Epic poetry");
  });

  it("copes with a record missing everything optional", () => {
    const r = mapOpenLibrary({ [`ISBN:${ISBN}`]: { title: "Bare" } }, ISBN)!;
    expect(r.title).toBe("Bare");
    expect(r.authors).toEqual([]);
    expect(r.publishedYear).toBeUndefined();
  });
});

describe("mapGoogleBooks", () => {
  it("maps the volume", () => {
    const r = mapGoogleBooks(GOOGLE_HIT, ISBN)!;
    expect(r).toMatchObject({ title: "The Odyssey", publisher: "Penguin", publishedYear: 1999, provider: "google" });
    expect(r.isbn10).toBe("0140449132");
  });

  it("upgrades the cover URL to https — mixed content kills it silently", () => {
    expect(mapGoogleBooks(GOOGLE_HIT, ISBN)!.coverUrl).toMatch(/^https:/);
  });

  it("strips the fake page-curl artefact", () => {
    expect(mapGoogleBooks(GOOGLE_HIT, ISBN)!.coverUrl).not.toContain("edge=curl");
  });

  it("returns null when Google has nothing", () => {
    expect(mapGoogleBooks({ totalItems: 0, items: [] }, ISBN)).toBeNull();
    expect(mapGoogleBooks({}, ISBN)).toBeNull();
  });
});

describe("lookupIsbn", () => {
  it("uses Open Library and never calls Google on a hit", async () => {
    let googleCalls = 0;
    const gw: BookGateway = {
      ...gateway(OL_HIT, GOOGLE_HIT),
      googleBooks: async () => { googleCalls++; return GOOGLE_HIT; },
    };
    const out = await lookupIsbn(ISBN, gw);
    expect(out.kind).toBe("found");
    expect(out.kind === "found" && out.result.provider).toBe("openlibrary");
    expect(googleCalls).toBe(0);
  });

  it("falls back to Google when Open Library misses", async () => {
    const out = await lookupIsbn(ISBN, gateway({}, GOOGLE_HIT));
    expect(out.kind === "found" && out.result.provider).toBe("google");
  });

  it("still tries Google when Open Library throws", async () => {
    const gw: BookGateway = {
      ...gateway({}, GOOGLE_HIT),
      openLibrary: async () => { throw new Error("network"); },
    };
    expect((await lookupIsbn(ISBN, gw)).kind).toBe("found");
  });

  it("reports not-found only when a provider actually answered", async () => {
    const out = await lookupIsbn(ISBN, gateway({}, { totalItems: 0 }));
    expect(out.kind).toBe("not-found");
  });

  /* The bug this guards: Google's unkeyed endpoint shares one daily quota
     across every anonymous caller, and its 429 body carries no totalItems.
     Reading that as zero results told people holding a real book that it did
     not exist. */
  it("reports unavailable — not not-found — when Google is rate-limiting and OL is down", async () => {
    const gw: BookGateway = {
      ...gateway({}, {}),
      openLibrary: async () => { throw new Error("offline"); },
      googleBooks: async () => ({ error: { code: 429, message: "Quota exceeded" } }),
    };
    const out = await lookupIsbn(ISBN, gw);
    expect(out.kind).toBe("unavailable");
    expect(out.kind === "unavailable" && out.reason).toMatch(/quota exhausted|rate-limit/i);
  });

  it("reports unavailable when neither provider can be reached", async () => {
    const dead: BookGateway = {
      ...gateway({}, {}),
      openLibrary: async () => { throw new Error("down"); },
      googleBooks: async () => { throw new Error("down"); },
    };
    expect((await lookupIsbn(ISBN, dead)).kind).toBe("unavailable");
  });

  /* Ruling a book out takes both providers.

     Open Library answers a miss with HTTP 200 and `{}`, so it "replies" on
     virtually every lookup. Treating that as sufficient hid a rate-limited
     Google Books completely: the app said "not in any database" having asked
     one database. The two outcomes demand opposite actions from the user —
     type it in by hand, or go fix your API key. */
  it("will not rule a book out when Google was rate-limited", async () => {
    const gw = gateway({}, { error: { code: 429 } });
    const out = await lookupIsbn(ISBN, gw);
    expect(out.kind).toBe("unavailable");
  });

  it("will not rule a book out when Google threw", async () => {
    const gw: BookGateway = {
      ...gateway({}, {}),
      googleBooks: async () => { throw new Error("offline"); },
    };
    expect((await lookupIsbn(ISBN, gw)).kind).toBe("unavailable");
  });

  it("will not rule a book out when Open Library threw", async () => {
    const gw: BookGateway = {
      ...gateway({}, { totalItems: 0 }),
      openLibrary: async () => { throw new Error("offline"); },
    };
    expect((await lookupIsbn(ISBN, gw)).kind).toBe("unavailable");
  });

  it("names the provider that went missing, so the user can act on it", async () => {
    const gw = gateway({}, { error: { code: 429 } });
    const out = await lookupIsbn(ISBN, gw);
    expect(out.kind === "unavailable" && out.reason).toMatch(/Google/i);
  });

  it("DOES rule a book out once both providers answered and neither had it", async () => {
    const out = await lookupIsbn(ISBN, gateway({}, { totalItems: 0 }));
    expect(out.kind).toBe("not-found");
  });
});

describe("title search — the rescue path for unindexed ISBNs", () => {
  const OL_SEARCH = {
    numFound: 2,
    docs: [
      { title: "Data Structures and Algorithms in Python", author_name: ["Michael T. Goodrich"], first_publish_year: 2012, cover_i: 123, isbn: ["9781118290279"] },
      { title: "Data Structures and Algorithms in Python", author_name: ["WILEY INDIA"], first_publish_year: 2016 },
    ],
  };

  it("maps Open Library search docs", () => {
    const hits = mapOpenLibrarySearch(OL_SEARCH);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ title: "Data Structures and Algorithms in Python", publishedYear: 2012, provider: "openlibrary" });
    expect(hits[0].authors).toEqual(["Michael T. Goodrich"]);
  });

  it("keeps a cover-id URL, which cannot be rebuilt from an ISBN", () => {
    expect(mapOpenLibrarySearch(OL_SEARCH)[0].coverUrl).toBe("https://covers.openlibrary.org/b/id/123-M.jpg");
    expect(mapOpenLibrarySearch(OL_SEARCH)[1].coverUrl).toBeUndefined();
  });

  it("prefers Open Library, which is not subject to Google's shared quota", async () => {
    let googleCalls = 0;
    const gw: BookGateway = {
      ...gateway({}, {}, OL_SEARCH),
      searchTitleGoogle: async () => { googleCalls++; return GOOGLE_HIT; },
    };
    const hits = await searchTitles("data structures", gw);
    expect(hits).toHaveLength(2);
    expect(googleCalls).toBe(0);
  });

  it("falls back to Google when Open Library finds nothing", async () => {
    const gw: BookGateway = {
      ...gateway({}, {}, { docs: [] }),
      searchTitleGoogle: async () => GOOGLE_HIT,
    };
    const hits = await searchTitles("the odyssey", gw);
    expect(hits).toHaveLength(1);
    expect(hits[0].provider).toBe("google");
  });

  it("ignores a query too short to be meaningful", async () => {
    expect(await searchTitles(" a ", gateway({}, {}, OL_SEARCH))).toEqual([]);
  });

  it("returns nothing rather than throwing when both searches fail", async () => {
    const gw: BookGateway = {
      ...gateway({}, {}),
      searchTitleOpenLibrary: async () => { throw new Error("down"); },
      searchTitleGoogle: async () => { throw new Error("down"); },
    };
    expect(await searchTitles("anything", gw)).toEqual([]);
  });
});

describe("bookFromLookup", () => {
  it("builds a book and records the provider", () => {
    const book = bookFromLookup(mapOpenLibrary(OL_HIT, ISBN)!);
    expect(book.title).toBe("The Odyssey");
    expect(book.lookup?.provider).toBe("openlibrary");
  });

  /* Open Library's bibkeys payload returns cover-ID URLs
     (/b/id/14935910-M.jpg), not ISBN URLs, so they are NOT rebuildable from
     the ISBN and have to be kept. An earlier version discarded every Open
     Library cover on the assumption they were all derivable; that only worked
     because /b/isbn/<isbn>-M.jpg happens to redirect to the same image. */
  it("keeps a cover-ID URL, which cannot be rebuilt from the ISBN", () => {
    expect(bookFromLookup(mapOpenLibrary(OL_HIT, ISBN)!).coverUrl)
      .toBe("https://covers.openlibrary.org/b/id/1-M.jpg");
  });

  it("drops an ISBN-shaped cover URL, which coverUrlFor can rebuild", () => {
    const derivable = { ...mapOpenLibrary(OL_HIT, ISBN)!, coverUrl: `https://covers.openlibrary.org/b/isbn/${ISBN}-M.jpg` };
    expect(bookFromLookup(derivable).coverUrl).toBeUndefined();
  });

  it("does store a Google cover, which is not derivable", () => {
    expect(bookFromLookup(mapGoogleBooks(GOOGLE_HIT, ISBN)!).coverUrl).toMatch(/^https:/);
  });
});

describe("mergeLookupIntoBook", () => {
  const result: LookupResult = mapOpenLibrary(OL_HIT, ISBN)!;

  it("replaces a scan placeholder title, which is the ISBN itself", () => {
    const scanned = newBook({ isbn13: ISBN, title: ISBN });
    expect(mergeLookupIntoBook(scanned, result).title).toBe("The Odyssey");
  });

  it("never overwrites a title a person typed", () => {
    const mine = newBook({ isbn13: ISBN, title: "Dad's copy" });
    expect(mergeLookupIntoBook(mine, result).title).toBe("Dad's copy");
  });

  it("leaves everything the user curated alone", () => {
    const mine = newBook({
      isbn13: ISBN, title: ISBN, status: "read", rating: 3,
      notes: "mine", shelf: "Bedside", tags: ["favourite"],
    });
    const merged = mergeLookupIntoBook(mine, result);
    expect(merged).toMatchObject({ status: "read", rating: 3, notes: "mine", shelf: "Bedside" });
    expect(merged.tags).toEqual(["favourite"]);
  });

  it("fills the gaps that are actually empty", () => {
    const merged = mergeLookupIntoBook(newBook({ isbn13: ISBN, title: ISBN }), result);
    expect(merged.publisher).toBe("Penguin Classics");
    expect(merged.pageCount).toBe(560);
    expect(merged.authors).toEqual(["Homer", "Robert Fagles"]);
  });

  it("keeps the book's id, so nothing pointing at it breaks", () => {
    const scanned = newBook({ id: "b-keep", isbn13: ISBN, title: ISBN });
    expect(mergeLookupIntoBook(scanned, result).id).toBe("b-keep");
  });
});

describe("Google cover URL cleanup — edge=curl arrives in both positions", () => {
  const withLinks = (thumbnail: string) => ({
    totalItems: 1,
    items: [{ volumeInfo: { title: "T", imageLinks: { thumbnail } } }],
  });

  it("strips it as the first parameter", () => {
    expect(mapGoogleBooks(withLinks("http://x/y.jpg?edge=curl&zoom=1"), ISBN)!.coverUrl)
      .toBe("https://x/y.jpg?zoom=1");
  });

  it("strips it as a later parameter", () => {
    expect(mapGoogleBooks(withLinks("http://x/y.jpg?zoom=1&edge=curl"), ISBN)!.coverUrl)
      .toBe("https://x/y.jpg?zoom=1");
  });

  it("strips it when it is the only parameter, leaving no dangling ?", () => {
    expect(mapGoogleBooks(withLinks("http://x/y.jpg?edge=curl"), ISBN)!.coverUrl)
      .toBe("https://x/y.jpg");
  });

  it("leaves a clean URL alone", () => {
    expect(mapGoogleBooks(withLinks("https://x/y.jpg?zoom=1"), ISBN)!.coverUrl)
      .toBe("https://x/y.jpg?zoom=1");
  });
});

describe("autoResolveBook — the strategy switch is the app's job, not the user's", () => {
  const olEmpty = {};
  const gbZero = { totalItems: 0 };
  const olSearchHit = {
    docs: [{
      title: "Clean Code",
      author_name: ["Robert C. Martin"],
      first_publish_year: 2008,
      isbn: ["9780132350884"],
      number_of_pages_median: 464,
    }],
  };
  const gw = (over: Partial<BookGateway>): BookGateway => ({
    openLibrary: async () => olEmpty,
    googleBooks: async () => gbZero,
    searchTitleOpenLibrary: async () => ({ docs: [] }),
    searchTitleGoogle: async () => gbZero,
    ...over,
  });

  it("fills straight from the ISBN when a database knows it", async () => {
    const out = await autoResolveBook(newBook({ isbn13: ISBN, title: ISBN }), gw({ openLibrary: async () => OL_HIT }));
    expect(out.kind).toBe("filled");
    expect(out.kind === "filled" && out.book.title).toBe("The Odyssey");
  });

  it("falls back to a title search when the ISBN is in neither database", async () => {
    const book = newBook({ isbn13: "9788131705490", title: "Clean Code" });
    const out = await autoResolveBook(book, gw({ searchTitleOpenLibrary: async () => olSearchHit }));
    expect(out.kind).toBe("filled");
    expect(out.kind === "filled" && out.book.pageCount).toBe(464);
    expect(out.kind === "filled" && out.book.authors).toEqual(["Robert C. Martin"]);
  });

  it("refuses a title hit that is clearly a different book", async () => {
    const book = newBook({ isbn13: "9788131705490", title: "Clean Code" });
    const wrong = { docs: [{ title: "Cooking for Two", author_name: ["A. Chef"] }] };
    const out = await autoResolveBook(book, gw({ searchTitleOpenLibrary: async () => wrong }));
    expect(out.kind).toBe("manual");
  });

  it("goes straight to manual for a scan placeholder — an ISBN is not a searchable title", async () => {
    let searched = false;
    const book = newBook({ isbn13: ISBN, title: ISBN });
    const out = await autoResolveBook(book, gw({ searchTitleOpenLibrary: async () => { searched = true; return { docs: [] }; } }));
    expect(out.kind).toBe("manual");
    expect(searched).toBe(false);
  });

  it("flags an auth problem when Google answers with its quota envelope", async () => {
    const out = await autoResolveBook(
      newBook({ isbn13: ISBN, title: ISBN }),
      gw({ openLibrary: async () => { throw new Error("down"); }, googleBooks: async () => ({ error: { code: 429 } }) }),
    );
    expect(out.kind).toBe("unavailable");
    expect(out.kind === "unavailable" && out.auth).toBe(true);
  });

  it("flags an auth problem when Google throws a 403", async () => {
    const forbidden = Object.assign(new Error("GET → 403"), { status: 403 });
    const out = await autoResolveBook(
      newBook({ isbn13: ISBN, title: ISBN }),
      gw({ openLibrary: async () => { throw new Error("down"); }, googleBooks: async () => { throw forbidden; } }),
    );
    expect(out.kind).toBe("unavailable");
    expect(out.kind === "unavailable" && out.auth).toBe(true);
  });

  it("a plain network fault is NOT an auth problem", async () => {
    const dead = Object.assign(new Error("network error"), { status: 0 });
    const out = await autoResolveBook(
      newBook({ isbn13: ISBN, title: ISBN }),
      gw({ openLibrary: async () => { throw dead; }, googleBooks: async () => { throw dead; } }),
    );
    expect(out.kind).toBe("unavailable");
    expect(out.kind === "unavailable" && out.auth).toBe(false);
  });
});

describe("resolveSummary — the shelf says what happened, settings say why", () => {
  it("reports a clean run", () => {
    expect(resolveSummary({ filled: 3, notFound: 0, unavailable: 0 })).toBe("Filled 3");
  });

  it("names genuinely-absent books as such — absence is not an error", () => {
    expect(resolveSummary({ filled: 0, notFound: 3, unavailable: 0 }))
      .toBe("Filled 0 · 3 not in the databases — add manually!");
  });

  it("points fetch errors at the place with details", () => {
    expect(resolveSummary({ filled: 1, notFound: 0, unavailable: 2 }))
      .toBe("Filled 1 · error fetching 2 — details in Settings → Library");
  });

  it("handles the singular", () => {
    expect(resolveSummary({ filled: 0, notFound: 1, unavailable: 1 }))
      .toBe("Filled 0 · 1 not in the databases — add manually! · error fetching 1 — details in Settings → Library");
  });
});
