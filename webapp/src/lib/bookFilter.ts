/* Search, filter, sort and facets for the library grid.

   Kept out of the screen so 400 books' worth of matching behaviour is
   testable, and so the toolbar component stays presentation only. */

import { normalizeIsbn } from "./isbn";
import { BOOK_STATUS_LABEL, type Book, type BookStatus } from "./types";

export type BookSort = "added" | "title" | "author" | "rating" | "finished" | "year";

export interface BookQuery {
  text: string;
  status: BookStatus | "all";
  tags: string[];
  shelves: string[];
  sort: BookSort;
}

export const EMPTY_QUERY: BookQuery = { text: "", status: "all", tags: [], shelves: [], sort: "added" };

/** Lower-cased and stripped of diacritics, so searching "bronte" finds
    "Brontë" and "garcia" finds "García". */
export function fold(s: string): string {
  // U+0300-U+036F is the combining-marks block NFD splits accents into.
  // Escaped rather than written literally so the source stays readable.
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Surname-first key for sorting: "Ursula K. Le Guin" → "le guin, ursula".

    A heuristic, and knowingly imperfect — multi-word surnames and mononyms
    are guesses. It sorts a shelf the way a reader expects far more often than
    raw string order does, which is the bar it has to clear. */
export function authorSortKey(authors: string[]): string {
  const first = authors[0];
  if (!first) return "￿"; // unknown authors sort last, not first
  const parts = fold(first).trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? "";
  // Trailing particles ("jr", "iii") are not the surname.
  const tail = parts[parts.length - 1];
  const surnameStart = /^(jr|sr|i{1,3}|iv)\.?$/.test(tail) ? parts.length - 2 : parts.length - 1;
  // "Le Guin", "van Gogh", "de Beauvoir" — a lowercase particle belongs to
  // the surname rather than the given names.
  let start = surnameStart;
  while (start > 1 && /^(le|la|de|del|della|van|von|der|den|di|da|dos|el|al|bin|ibn|mac|mc|st)\.?$/.test(parts[start - 1])) {
    start--;
  }
  const surname = parts.slice(start).join(" ");
  const given = parts.slice(0, start).join(" ");
  return given ? `${surname}, ${given}` : surname;
}

export function matchesBook(book: Book, query: BookQuery): boolean {
  if (query.status !== "all" && book.status !== query.status) return false;
  // Facets AND across each other, OR within themselves — a book must carry
  // one of the selected tags AND sit on one of the selected shelves.
  if (query.tags.length && !query.tags.some((t) => book.tags.includes(t))) return false;
  if (query.shelves.length && !query.shelves.includes(book.shelf ?? "")) return false;

  const text = query.text.trim();
  if (!text) return true;

  // An ISBN typed with hyphens should still match the bare stored digits.
  const asIsbn = normalizeIsbn(text);
  if (asIsbn && (book.isbn13 === asIsbn || book.isbn10 === asIsbn)) return true;

  const needle = fold(text);
  if (fold(book.title).includes(needle)) return true;
  if (book.authors.some((a) => fold(a).includes(needle))) return true;
  if (book.isbn13?.includes(needle) || book.isbn10?.toLowerCase().includes(needle)) return true;
  if (book.shelf && fold(book.shelf).includes(needle)) return true;
  return book.tags.some((t) => fold(t).includes(needle));
}

/** `undefined` always sorts last regardless of direction — an unrated book is
    not a zero-star book, and an unfinished one is not finished in 1970. */
function nullsLast(a: number | undefined, b: number | undefined, compare: (x: number, y: number) => number): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return compare(a, b);
}

export function sortBooks(list: readonly Book[], sort: BookSort): Book[] {
  const byTitle = (a: Book, b: Book) => fold(a.title).localeCompare(fold(b.title));
  const sorted = [...list];
  sorted.sort((a, b) => {
    let primary = 0;
    switch (sort) {
      case "added": primary = b.addedAt - a.addedAt; break;
      case "title": primary = byTitle(a, b); break;
      case "author": primary = authorSortKey(a.authors).localeCompare(authorSortKey(b.authors)); break;
      case "rating": primary = nullsLast(a.rating, b.rating, (x, y) => y - x); break;
      case "finished": primary = nullsLast(a.finishedAt, b.finishedAt, (x, y) => y - x); break;
      case "year": primary = nullsLast(a.publishedYear, b.publishedYear, (x, y) => y - x); break;
    }
    // Every sort breaks ties the same way, so the grid never reshuffles
    // between renders of the same data.
    return primary !== 0 ? primary : byTitle(a, b);
  });
  return sorted;
}

export function filterBooks(books: readonly Book[], query: BookQuery): Book[] {
  return sortBooks(books.filter((b) => matchesBook(b, query)), query.sort);
}

export function bookFacets(books: readonly Book[]): {
  tags: string[];
  shelves: string[];
  counts: Record<BookStatus, number>;
} {
  const tags = new Set<string>();
  const shelves = new Set<string>();
  const counts: Record<BookStatus, number> = { wishlist: 0, unread: 0, reading: 0, read: 0, dnf: 0 };
  for (const book of books) {
    for (const tag of book.tags) tags.add(tag);
    if (book.shelf) shelves.add(book.shelf);
    counts[book.status]++;
  }
  const alpha = (a: string, b: string) => fold(a).localeCompare(fold(b));
  return { tags: [...tags].sort(alpha), shelves: [...shelves].sort(alpha), counts };
}

/** Books a scan captured but no lookup ever filled in — their title is still
    the ISBN. These are what the toolbar's "Resolve" action heals. */
export function unresolvedBooks(books: readonly Book[]): Book[] {
  return books.filter((b) => !!b.isbn13 && b.title.trim() === b.isbn13);
}

/* ————— grouping ————— */

export type BookGroup = "none" | "author" | "publisher" | "year" | "title" | "status";

export const BOOK_GROUPS: { id: BookGroup; label: string }[] = [
  { id: "none", label: "No grouping" },
  { id: "author", label: "Author" },
  { id: "publisher", label: "Publisher" },
  { id: "year", label: "Year published" },
  { id: "title", label: "Title (A–Z)" },
  { id: "status", label: "Reading status" },
];

export interface BookGrouping {
  key: string;
  label: string;
  books: Book[];
}

/** Sorts every unknown bucket last regardless of grouping.

    A shelf of a few hundred physical books always has records missing a
    publisher or a year, and an "Unknown" heading at the very top would push
    the real content off the first screen. */
const UNKNOWN = "￿";

/** Which bucket a book belongs to: the raw sort key, plus what to print. */
function groupOf(book: Book, group: BookGroup): { key: string; label: string } {
  switch (group) {
    case "author": {
      const name = book.authors[0]?.trim();
      return name
        ? { key: authorSortKey(book.authors), label: name }
        : { key: UNKNOWN, label: "Unknown author" };
    }
    case "publisher": {
      const name = book.publisher?.trim();
      return name ? { key: fold(name), label: name } : { key: UNKNOWN, label: "Unknown publisher" };
    }
    case "year": {
      const year = book.publishedYear;
      // Padded so string ordering matches numeric ordering, then reversed at
      // sort time so the newest year heads the list.
      return year ? { key: String(year).padStart(6, "0"), label: String(year) } : { key: UNKNOWN, label: "Year unknown" };
    }
    case "title": {
      const initial = fold(book.title).charAt(0);
      if (!initial) return { key: UNKNOWN, label: "Untitled" };
      // Digits and scripts without a Latin initial share one bucket rather
      // than each getting a heading of its own.
      return /[a-z]/.test(initial)
        ? { key: initial, label: initial.toUpperCase() }
        : { key: "0", label: "#" };
    }
    case "status": {
      const order = STATUS_ORDER.indexOf(book.status);
      return { key: String(order), label: BOOK_STATUS_LABEL[book.status] };
    }
    default:
      return { key: "", label: "" };
  }
}

/** Reading order, not alphabetical: what you are on now, then what is queued,
    then what is behind you — and last of all what you do not own yet, since
    the wishlist is the only group that is not a shelf. */
const STATUS_ORDER: BookStatus[] = ["reading", "unread", "read", "dnf", "wishlist"];

/** Splits an already-filtered, already-sorted list into headed sections.

    Order WITHIN each group is whatever the caller's sort produced, so
    grouping and sorting compose instead of fighting: "group by author, sort
    by year" reads exactly as it says. */
export function groupBooks(books: readonly Book[], group: BookGroup): BookGrouping[] {
  if (group === "none") return [{ key: "", label: "", books: [...books] }];

  const buckets = new Map<string, BookGrouping>();
  for (const book of books) {
    const { key, label } = groupOf(book, group);
    const bucket = buckets.get(key);
    if (bucket) bucket.books.push(book);
    else buckets.set(key, { key, label, books: [book] });
  }

  const out = [...buckets.values()];
  out.sort((a, b) => {
    // Unknown always last, whichever direction the rest runs in.
    if (a.key === UNKNOWN) return 1;
    if (b.key === UNKNOWN) return -1;
    // Newest year first; everything else reads A→Z.
    return group === "year" ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key);
  });
  return out;
}
