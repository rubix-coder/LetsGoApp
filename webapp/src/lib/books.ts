/* Book model helpers.

   These live here rather than beside `newTask` in store.tsx so that the CSV
   importer, the lookup mapper and their node tests can mint books without
   pulling the React store into scope. */

import { fold } from "./bookFilter";
import type { Book } from "./types";

/* Books are minted in bursts — a CSV import creates hundreds inside a single
   millisecond — so the clock plus randomness that `newTask` uses is not
   enough on its own: 400 draws from a million-wide range collide about 8% of
   the time, and a collision means one book silently overwriting another
   through `upsertBook`. The counter makes ids unique within the process; the
   random part keeps two devices minting in the same millisecond apart, which
   matters because vaults sync. */
let mintCounter = 0;

export function newBook(patch: Partial<Book> = {}): Book {
  return {
    id: `b-${Date.now()}-${mintCounter++}-${Math.floor(Math.random() * 1e6)}`,
    title: "",
    authors: [],
    status: "unread",
    tags: [],
    addedAt: Date.now(),
    ...patch,
  };
}

export type CoverSize = "S" | "M" | "L";

/** Open Library serves covers straight off the ISBN, so a book normally needs
    no stored URL at all.

    `?default=false` is load-bearing: without it a book with no cover on file
    still answers 200, with a blank 1×1 GIF. `<img onError>` would never fire
    and the card would show an empty box instead of the tinted fallback. */
export function coverUrlFor(book: Book, size: CoverSize = "M"): string | undefined {
  if (book.coverUrl) return book.coverUrl;
  if (!book.isbn13) return undefined;
  return `https://covers.openlibrary.org/b/isbn/${book.isbn13}-${size}.jpg?default=false`;
}

/** A stable pseudo-random tint for books with no cover, so a shelf of
    fallbacks reads as a row of different spines rather than one grey block.
    Returns a `color-mix()` expression over the app's own tokens — never a
    hardcoded hex, per the theme rules. */
export function coverFallbackTint(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 100_000;
  // 12–34%: dark enough to separate from the card, light enough for the title
  // to stay legible over it in both themes.
  const mix = 12 + (hash % 23);
  return `color-mix(in srgb, var(--color-accent) ${mix}%, var(--color-surface))`;
}

/** "Homer" / "Homer & Fagles" / "Homer +2" — a card has one line for this. */
export function bookDisplayAuthor(book: Book): string {
  const [first, second] = book.authors;
  if (!first) return "Unknown author";
  if (book.authors.length === 1) return first;
  if (book.authors.length === 2) return `${first} & ${second}`;
  return `${first} +${book.authors.length - 1}`;
}

/** How far through the book the bookmark sits, as 0..1.

    `null` whenever the answer would be a guess: no bookmark placed, or no
    page count — which is the common case for the regional and small-press
    editions neither Open Library nor Google Books carries. */
export function readingFraction(book: Book): number | null {
  if (book.currentPage === undefined) return null;
  if (!book.pageCount || book.pageCount <= 0) return null;
  return Math.min(1, Math.max(0, book.currentPage / book.pageCount));
}

/** Reads a typed page number off the bookmark.

    Empty means "take the bookmark out", which is why the return is
    `undefined` rather than 0 — page 0 is a real, if odd, place to be, and
    conflating the two would make a bookmark impossible to remove. A page
    past the end is clamped rather than rejected: the page count comes from a
    third-party API and is wrong often enough that trusting it over the user
    would be the worse failure. */
export function clampPage(raw: string, pageCount?: number): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  const page = Math.max(0, Math.floor(parsed));
  if (pageCount && pageCount > 0) return Math.min(page, pageCount);
  return page;
}

/** What makes two records the same book.

    ISBN first — it is the whole point of scanning a barcode. Failing that,
    title plus lead author folded to ignore case, accents and punctuation,
    which is what CSV imports and hand-typed entries have to fall back on.

    `null` means "not enough to judge": an untitled record with no ISBN is not
    the same book as every other untitled record, so it must never be merged
    into one. Callers treat null as "always distinct". */
export function bookIdentity(book: Book): string | null {
  if (book.isbn13) return `i:${book.isbn13}`;
  // Trimmed, because fold() does not: a whitespace-only title is falsy to a
  // reader but truthy to JavaScript, and without this every such record would
  // share one identity and collapse into a single book.
  const title = fold(book.title).trim();
  if (!title) return null;
  return `t:${title}|${fold(book.authors[0] ?? "").trim()}`;
}

/** Folds `extra` into `base`, keeping everything the user curated.

    Used both when a re-scan lands on a book already on the shelf and when
    cleaning up duplicates that got in before that was prevented. The rule is
    the same one CSV import already follows: metadata fills gaps, and a value
    the user typed is never overwritten by one a machine produced. */
export function mergeDuplicate(base: Book, extra: Book): Book {
  return {
    ...base,
    authors: base.authors.length ? base.authors : extra.authors,
    isbn13: base.isbn13 ?? extra.isbn13,
    isbn10: base.isbn10 ?? extra.isbn10,
    publisher: base.publisher ?? extra.publisher,
    publishedYear: base.publishedYear ?? extra.publishedYear,
    pageCount: base.pageCount ?? extra.pageCount,
    coverUrl: base.coverUrl ?? extra.coverUrl,
    rating: base.rating ?? extra.rating,
    notes: base.notes ?? extra.notes,
    shelf: base.shelf ?? extra.shelf,
    startedAt: base.startedAt ?? extra.startedAt,
    finishedAt: base.finishedAt ?? extra.finishedAt,
    // The furthest-read bookmark wins: having read to page 200 in one record
    // and page 40 in its duplicate means you have read to page 200.
    currentPage: base.currentPage === undefined
      ? extra.currentPage
      : extra.currentPage === undefined
        ? base.currentPage
        : Math.max(base.currentPage, extra.currentPage),
    tags: base.tags.length ? base.tags : extra.tags,
    // A title that is just the ISBN is a placeholder from an unresolved scan,
    // so a real title from the duplicate beats it.
    title: base.title.trim() === base.isbn13 && extra.title.trim() !== extra.isbn13
      ? extra.title
      : base.title,
  };
}

/** Finds the book an incoming record would duplicate, or -1.

    Deliberately index-based: the reducer needs to write back into the same
    slot so the shelf does not reorder itself when a re-scan enriches a book. */
export function indexOfDuplicate(books: readonly Book[], candidate: Book): number {
  const key = bookIdentity(candidate);
  if (key === null) return -1;
  return books.findIndex((b) => b.id !== candidate.id && bookIdentity(b) === key);
}

/** Collapses books that are already duplicated in the shelf.

    Needed because duplicates could be created before the reducer started
    preventing them — a shelf scanned across two sessions has them, and no
    amount of fixing the write path removes what is already stored. Earliest
    record wins the identity so its id (and anything pointing at it) survives. */
export function dedupeBooks(books: readonly Book[]): { books: Book[]; removed: number } {
  const slotFor = new Map<string, number>();
  const out: Book[] = [];
  let removed = 0;

  for (const book of books) {
    const key = bookIdentity(book);
    if (key === null) { out.push(book); continue; }
    const slot = slotFor.get(key);
    if (slot === undefined) {
      slotFor.set(key, out.length);
      out.push(book);
    } else {
      out[slot] = mergeDuplicate(out[slot], book);
      removed++;
    }
  }
  return { books: out, removed };
}

/** How many records would disappear if the shelf were deduped — drives
    whether the clean-up offer is shown at all. */
export function duplicateCount(books: readonly Book[]): number {
  return dedupeBooks(books).removed;
}

export interface ReadingStats {
  /** Books you OWN. Wishlist entries are excluded — see `readingStats`. */
  total: number;
  read: number;
  reading: number;
  unread: number;
  dnf: number;
  /** 0–100, rounded. Share of the whole shelf, not of "finished or abandoned" —
      the question being answered is "how much of what I own have I read". */
  pctRead: number;
  pctReading: number;
  /** Pages confirmed read: the full length of finished books plus the
      bookmark in the ones under way. Only counts books whose length is
      known, which is why it is reported alongside `pagesKnownFor` rather
      than presented as a total anyone should trust on its own. */
  pagesRead: number;
  pagesKnownFor: number;
  /** Books you want but do not own. Reported alongside the shelf rather than
      inside it, so it can be shown without ever moving `pctRead`. */
  wishlist: number;
}

/** The shelf at a glance — owned, finished, under way.

    Deliberately counts DNF separately from read: abandoning a book is not
    finishing it, and rolling the two together would flatter the number the
    user is actually trying to move.

    Wishlist books are counted apart from every other number here, `total`
    included. They are not on the shelf, so "how much of what I own have I
    read" must not move when you add one — otherwise a good browsing session
    would look like a reading failure. */
export function readingStats(books: readonly Book[]): ReadingStats {
  let read = 0, reading = 0, unread = 0, dnf = 0, wishlist = 0;
  let pagesRead = 0, pagesKnownFor = 0;

  for (const b of books) {
    if (b.status === "wishlist") { wishlist++; continue; }
    if (b.status === "read") read++;
    else if (b.status === "reading") reading++;
    else if (b.status === "dnf") dnf++;
    else unread++;

    if (b.pageCount && b.pageCount > 0) {
      pagesKnownFor++;
      if (b.status === "read") pagesRead += b.pageCount;
      else if (b.currentPage !== undefined) pagesRead += Math.min(b.currentPage, b.pageCount);
    }
  }

  const total = books.length - wishlist;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
  return {
    total, read, reading, unread, dnf, wishlist,
    pctRead: pct(read),
    pctReading: pct(reading),
    pagesRead, pagesKnownFor,
  };
}
