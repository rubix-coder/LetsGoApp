// @vitest-environment node
import { describe, expect, it } from "vitest";
import { newBook } from "./books";
import { detectFlavor, mergeImportedBooks, parseBookCsv, parseCsv } from "./bookCsv";

const GOODREADS_HEADER =
  "Book Id,Title,Author,ISBN,ISBN13,My Rating,Publisher,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Exclusive Shelf,My Review";

describe("parseCsv — RFC 4180", () => {
  it("keeps a comma inside a quoted field", () => {
    expect(parseCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('a,"say ""hi""",c')).toEqual([["a", 'say "hi"', "c"]]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('a,"line1\nline2",c')).toEqual([["a", "line1\nline2", "c"]]);
  });

  it("handles CRLF endings", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("strips a UTF-8 BOM, which would otherwise poison the first header cell", () => {
    expect(parseCsv("﻿Title,Author\nDune,Herbert")[0][0]).toBe("Title");
  });

  it("produces no phantom row from a trailing newline", () => {
    expect(parseCsv("a,b\nc,d\n")).toHaveLength(2);
  });

  it("drops entirely blank lines", () => {
    expect(parseCsv("a,b\n\nc,d")).toHaveLength(2);
  });
});

describe("detectFlavor", () => {
  it("recognises each export", () => {
    expect(detectFlavor(GOODREADS_HEADER.split(","))).toBe("goodreads");
    expect(detectFlavor(["Title", "Authors", "ISBN/UID", "Read Status"])).toBe("storygraph");
    expect(detectFlavor(["Title", "Primary Author", "Collections"])).toBe("librarything");
    expect(detectFlavor(["Title", "Author"])).toBe("generic");
  });
});

describe("parseBookCsv — Goodreads", () => {
  const csv = [
    GOODREADS_HEADER,
    '1,The Odyssey,Homer,="0140449132",="9780140449136",5,Penguin,560,1999,2024/03/02,2023/01/05,"classics, owned, to-read",read,"Loved it"',
    '2,Dune,Frank Herbert,="",="",0,Ace,412,1965,,2024/02/01,sci-fi,currently-reading,',
  ].join("\n");

  it("unarmours the Excel-proofed ISBN and promotes it to 13", () => {
    const { books } = parseBookCsv(csv, "goodreads_library_export.csv");
    expect(books[0].isbn13).toBe("9780140449136");
    expect(books[0].isbn10).toBe("0140449132");
  });

  it("maps the core metadata", () => {
    const { books, flavor } = parseBookCsv(csv);
    expect(flavor).toBe("goodreads");
    expect(books[0]).toMatchObject({
      title: "The Odyssey", authors: ["Homer"], publisher: "Penguin",
      pageCount: 560, publishedYear: 1999, status: "read", rating: 5, notes: "Loved it",
    });
  });

  it("reads 0 as unrated, not as zero stars", () => {
    const { books } = parseBookCsv(csv);
    expect(books[1].rating).toBeUndefined();
  });

  it("maps the exclusive shelf to a status", () => {
    const { books } = parseBookCsv(csv);
    expect(books[1].status).toBe("reading");
  });

  it("drops the status token out of the tag list", () => {
    const { books } = parseBookCsv(csv);
    expect(books[0].tags).toEqual(["classics", "owned"]);
  });

  it("records the source file so a bad import can be found again", () => {
    const { books } = parseBookCsv(csv, "goodreads_library_export.csv");
    expect(books[0].source).toBe("csv:goodreads_library_export.csv");
  });

  it("only sets a finish date on books actually finished", () => {
    const { books } = parseBookCsv(csv);
    expect(books[0].finishedAt).toBeGreaterThan(0);
    expect(books[1].finishedAt).toBeUndefined();
  });

  it("skips a row with no title and counts it", () => {
    const withBlank = `${csv}\n3,,Nobody,="",="",0,,,,,,,to-read,`;
    const { books, skipped } = parseBookCsv(withBlank);
    expect(books).toHaveLength(2);
    expect(skipped).toBe(1);
  });
});

describe("parseBookCsv — StoryGraph and LibraryThing", () => {
  it("maps StoryGraph statuses and rounds a half star", () => {
    const csv = [
      "Title,Authors,ISBN/UID,Read Status,Star Rating,Tags,Last Date Read",
      "Piranesi,Susanna Clarke,9781526622426,did-not-finish,3.5,fantasy,",
    ].join("\n");
    const { books, flavor } = parseBookCsv(csv);
    expect(flavor).toBe("storygraph");
    expect(books[0].status).toBe("dnf");
    expect(books[0].rating).toBe(4);
    expect(books[0].tags).toEqual(["fantasy"]);
  });

  it("unarmours LibraryThing's bracketed ISBN and un-inverts the author", () => {
    const csv = [
      "Title,Primary Author,ISBN,Collections,Rating",
      'The Dispossessed,"Le Guin, Ursula K.",[006051275X],Your library,4',
    ].join("\n");
    const { books, flavor } = parseBookCsv(csv);
    expect(flavor).toBe("librarything");
    expect(books[0].isbn13).toBe("9780060512750");
    expect(books[0].authors).toEqual(["Ursula K. Le Guin"]);
  });
});

describe("mergeImportedBooks", () => {
  const odyssey = newBook({ id: "b1", title: "The Odyssey", authors: ["Homer"], isbn13: "9780140449136" });

  it("adds books that are new", () => {
    const dune = newBook({ title: "Dune", isbn13: "9780441013593" });
    const out = mergeImportedBooks([odyssey], [dune]);
    expect(out.added).toBe(1);
    expect(out.updated).toBe(0);
    expect(out.books).toHaveLength(2);
  });

  it("re-importing the same file adds nothing", () => {
    const csv = [GOODREADS_HEADER, '1,The Odyssey,Homer,="0140449132",="9780140449136",5,,,,,,,read,'].join("\n");
    const first = mergeImportedBooks([], parseBookCsv(csv).books);
    expect(first.added).toBe(1);
    const second = mergeImportedBooks(first.books, parseBookCsv(csv).books);
    expect(second.added).toBe(0);
    expect(second.updated).toBe(1);
    expect(second.books).toHaveLength(1);
  });

  it("dedupes on title and author when there is no ISBN", () => {
    const a = newBook({ title: "Handwritten", authors: ["Me"] });
    const b = newBook({ title: "handwritten", authors: ["me"] });
    expect(mergeImportedBooks([a], [b]).added).toBe(0);
  });

  it("keeps two different books that merely share a title", () => {
    const a = newBook({ title: "Ulysses", authors: ["James Joyce"] });
    const b = newBook({ title: "Ulysses", authors: ["Alfred Tennyson"] });
    expect(mergeImportedBooks([a], [b]).added).toBe(1);
  });

  it("never clobbers what the user curated", () => {
    const curated = newBook({
      id: "b1", title: "The Odyssey", isbn13: "9780140449136",
      rating: 2, notes: "my own note", shelf: "Bedside", tags: ["mine"],
    });
    const incoming = newBook({
      title: "The Odyssey", isbn13: "9780140449136",
      rating: 5, notes: "imported blurb", shelf: "Imported", tags: ["classics"], publisher: "Penguin",
    });
    const [merged] = mergeImportedBooks([curated], [incoming]).books;
    expect(merged.rating).toBe(2);
    expect(merged.notes).toBe("my own note");
    expect(merged.shelf).toBe("Bedside");
    expect(merged.tags).toEqual(["mine"]);
    // Gaps still get filled — that is the point of re-importing.
    expect(merged.publisher).toBe("Penguin");
  });

  it("keeps the existing id, so links to the book survive a re-import", () => {
    const incoming = newBook({ title: "The Odyssey", isbn13: "9780140449136" });
    expect(mergeImportedBooks([odyssey], [incoming]).books[0].id).toBe("b1");
  });
});
