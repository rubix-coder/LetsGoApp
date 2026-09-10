/* Importing a shelf from Goodreads, StoryGraph or LibraryThing.

   Each service armours its ISBNs differently to stop Excel eating the leading
   zero — Goodreads writes `="0140449132"`, LibraryThing writes
   `[0140449132]` — and each spells reading status its own way. The column
   maps below are the whole point of this module; the CSV parser above them is
   ordinary RFC 4180. */

import { bookIdentity, newBook } from "./books";
import { toIsbn10, toIsbn13 } from "./isbn";
import { fold } from "./bookFilter";
import type { Book, BookStatus } from "./types";

/** RFC 4180: quoted fields may contain commas, newlines and `""` escapes. */
export function parseCsv(text: string): string[][] {
  // A BOM survives into the first header cell and breaks column matching.
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ",") { endField(); i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { endRow(); i++; continue; }
    field += c; i++;
  }
  // A trailing newline must not produce a phantom empty row.
  if (field !== "" || row.length > 0) endRow();
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export type CsvFlavor = "goodreads" | "storygraph" | "librarything" | "generic";

export function detectFlavor(header: readonly string[]): CsvFlavor {
  const cols = new Set(header.map((h) => fold(h.trim())));
  if (cols.has("exclusive shelf") || cols.has("bookshelves")) return "goodreads";
  if (cols.has("read status") || cols.has("isbn/uid")) return "storygraph";
  if (cols.has("primary author") || cols.has("collections")) return "librarything";
  return "generic";
}

/** Strips the armour each exporter wraps ISBNs in. */
function unarmour(raw: string): string {
  return raw.trim().replace(/^="?/, "").replace(/"$/, "").replace(/^\[|\]$/g, "").trim();
}

function pick(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = row[fold(name)];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return "";
}

function parseStatus(raw: string): BookStatus {
  const s = fold(raw).replace(/[_\s]+/g, "-");
  if (s === "read" || s === "finished") return "read";
  if (s === "currently-reading" || s === "reading") return "reading";
  if (s === "did-not-finish" || s === "dnf" || s === "abandoned") return "dnf";
  return "unread";
}

/** 0 means "unrated" in every one of these exports, not "zero stars".
    StoryGraph writes halves, which round to the nearest whole star. */
function parseRating(raw: string): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function parseDate(raw: string): number | undefined {
  if (!raw) return undefined;
  const t = Date.parse(raw.replace(/\//g, "-"));
  return Number.isFinite(t) ? t : undefined;
}

function parseYear(raw: string): number | undefined {
  const m = /(\d{4})/.exec(raw);
  return m ? Number(m[1]) : undefined;
}

function parseList(raw: string): string[] {
  return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

/** Goodreads puts the shelf that encodes status into `Bookshelves` too;
    keeping it would create tags named "to-read" beside the real ones. */
const STATUS_TOKENS = new Set(["to-read", "currently-reading", "read", "did-not-finish", "dnf"]);

export interface CsvImport {
  books: Book[];
  skipped: number;
  flavor: CsvFlavor;
}

export function parseBookCsv(text: string, sourceName?: string): CsvImport {
  const rows = parseCsv(text);
  if (rows.length < 2) return { books: [], skipped: 0, flavor: "generic" };

  const header = rows[0].map((h) => fold(h.trim()));
  const flavor = detectFlavor(rows[0]);
  const source = sourceName ? `csv:${sourceName}` : "csv";

  const books: Book[] = [];
  let skipped = 0;

  for (const cells of rows.slice(1)) {
    const row: Record<string, string> = {};
    header.forEach((name, idx) => { row[name] = cells[idx] ?? ""; });

    const title = pick(row, "Title", "Book Title");
    if (!title) { skipped++; continue; }

    const rawIsbn = unarmour(pick(row, "ISBN13", "ISBN/UID", "ISBN"));
    const isbn13 = toIsbn13(rawIsbn) ?? undefined;
    const isbn10 = isbn13 ? (toIsbn10(isbn13) ?? undefined) : undefined;

    const authorField = pick(row, "Author", "Authors", "Primary Author");
    // "Le Guin, Ursula K." — LibraryThing stores surname-first.
    const authors = authorField.includes(";") || authorField.includes(",")
      ? parseList(authorField.replace(/^([^,;]+),\s*([^,;]+)$/, "$2 $1"))
      : authorField ? [authorField] : [];

    const status = parseStatus(pick(row, "Exclusive Shelf", "Read Status", "Collections"));
    const tags = parseList(pick(row, "Bookshelves", "Tags"))
      .filter((t) => !STATUS_TOKENS.has(fold(t)));

    books.push(newBook({
      title,
      authors,
      isbn13,
      isbn10,
      publisher: pick(row, "Publisher") || undefined,
      publishedYear: parseYear(pick(row, "Original Publication Year", "Year Published", "Publication", "Date Published")),
      pageCount: Number(pick(row, "Number of Pages", "Pages")) || undefined,
      status,
      tags,
      rating: parseRating(pick(row, "My Rating", "Star Rating", "Rating")),
      startedAt: status === "unread" ? undefined : parseDate(pick(row, "Date Started")),
      finishedAt: status === "read" ? parseDate(pick(row, "Date Read", "Last Date Read")) : undefined,
      notes: pick(row, "My Review", "Review", "Comment") || undefined,
      addedAt: parseDate(pick(row, "Date Added", "Date Entered")) ?? Date.now(),
      source,
    }));
  }

  return { books, skipped, flavor };
}

/** Dedupe key: the ISBN when there is one, else title + first author folded.
    Two different books can share a title, so the author has to be in the key. */
export interface MergeResult {
  books: Book[];
  added: number;
  updated: number;
}

/** Re-importing the same export must not double the shelf, and must not undo
    edits made since the last import — so incoming values only fill fields the
    user has not set. */
export function mergeImportedBooks(existing: readonly Book[], incoming: readonly Book[]): MergeResult {
  const byKey = new Map<string, number>();
  existing.forEach((book, idx) => byKey.set(bookIdentity(book) ?? `#${idx}`, idx));

  const books = [...existing];
  let added = 0;
  let updated = 0;

  for (const next of incoming) {
    const key = bookIdentity(next);
    const idx = key === null ? undefined : byKey.get(key);
    if (idx === undefined) {
      if (key !== null) byKey.set(key, books.length);
      books.push(next);
      added++;
      continue;
    }
    const current = books[idx];
    books[idx] = {
      ...current,
      // Metadata fills gaps; anything the user curated stays theirs.
      authors: current.authors.length ? current.authors : next.authors,
      isbn13: current.isbn13 ?? next.isbn13,
      isbn10: current.isbn10 ?? next.isbn10,
      publisher: current.publisher ?? next.publisher,
      publishedYear: current.publishedYear ?? next.publishedYear,
      pageCount: current.pageCount ?? next.pageCount,
      rating: current.rating ?? next.rating,
      notes: current.notes ?? next.notes,
      shelf: current.shelf ?? next.shelf,
      startedAt: current.startedAt ?? next.startedAt,
      finishedAt: current.finishedAt ?? next.finishedAt,
      tags: current.tags.length ? current.tags : next.tags,
    };
    updated++;
  }

  return { books, added, updated };
}
