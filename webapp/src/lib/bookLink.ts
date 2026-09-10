/* Adding a book from a link — the way a wishlist actually gets filled.

   Someone sends you an Amazon link, or you find a book on a publisher's page,
   and what you want is the book on your wishlist, not a form to fill in. This
   module turns a pasted URL into a Book record.

   The ladder, cheapest rung first:

     1. Read a code straight out of the link. An Amazon book ASIN usually IS
        the ISBN-10 (`/dp/0140449132`), and retailer URLs often carry a bare
        ISBN-13. When one is there, the free databases answer and no Claude
        key is needed at all — which is the common case for the commonest
        link, and costs nothing.
     2. Ask Claude to fetch the page (server-side `web_fetch`), falling back
        to a web search when the retailer blocks the fetcher — which Amazon
        very often does.
     3. Feed whatever the model found back through the free databases, so the
        stored record has trusted metadata and a stable cover rather than the
        model's recollection.

   Trust model matches `bookWebRescue`: the answer is mapped into an ordinary
   LookupResult, structurally validated (ISBN checksum, year sanity), and
   stamped provider "web" so the record is flagged as worth re-checking. A
   dead end is reported as "manual" rather than guessed at — the caller then
   offers the user the keyboard, which is always the honest last rung. */

import { newBook } from "./books";
import { toIsbn13 } from "./isbn";
import { isValidIsbn10, isValidIsbn13 } from "./isbn";
import {
  bestTitleMatch, bookFromLookup, lookupIsbn, mergeLookupIntoBook, searchTitles,
  type BookGateway, type LookupResult,
} from "./bookLookup";
import { extractJson, textFromMessage } from "./coverVision";
import type { Book } from "./types";

/** The network half, injectable so the ladder is testable offline. */
export interface BookLinkGateway {
  /** Sends the prompt to a model equipped with web fetch and web search.
      `url` is passed separately so the gateway can scope the fetch tool to
      that host. Resolves with the raw Messages API response body. */
  read: (prompt: string, url: string) => Promise<unknown>;
}

export type BookLinkOutcome =
  | { kind: "filled"; book: Book }
  /** A link, and a real page, but nothing about a book on it. */
  | { kind: "not-a-book" }
  /** Everything was tried and nothing was confirmed — offer the keyboard. */
  | { kind: "manual" }
  /** Not a link at all; nothing was spent finding that out. */
  | { kind: "unusable"; reason: string }
  | { kind: "unavailable"; reason: string; auth: boolean };

/* ————— the link itself ————— */

/** Query parameters that identify the BOOK rather than the referrer.

    Everything else is dropped, which is what makes two shares of the same
    book normalise to the same string: Amazon in particular appends a
    different `ref`/`qid`/`tag` tail to every share of the same product. */
const IDENTIFYING_PARAMS = new Set(["id", "isbn", "pid", "ean", "sku", "asin", "q", "workid"]);

/** A pasted link, or null when the text is not one.

    Accepts a bare host ("amazon.in/dp/…"), because that is what half of all
    pasted links look like once a messaging app has finished with them, and
    refuses any scheme but http(s) — a wishlist must never be a way to talk
    the app into opening `file://` or `javascript:`. */
export function normalizeBookUrl(raw: string): string | null {
  const text = raw.trim();
  // Whitespace anywhere means prose, not a link. Checked before parsing
  // because "The Odyssey by Homer" is otherwise a valid relative reference.
  if (!text || /\s/.test(text)) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // A host with no dot is not a public site — it is a typed word that
  // happened to survive parsing.
  if (!url.hostname.includes(".")) return null;

  // Amazon hangs a `/ref=…` breadcrumb off the end of the path; it names the
  // search that got you there, never the book.
  url.pathname = url.pathname.replace(/\/ref=[^/]*\/?$/, "");

  for (const key of [...url.searchParams.keys()]) {
    if (!IDENTIFYING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  // `toString()` would otherwise leave a bare "?" behind.
  const query = url.searchParams.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}

/** Whether to treat what the user typed as a link or as a title. Cheap, and
    used on every keystroke, so it must not throw. */
export function looksLikeUrl(raw: string): boolean {
  return normalizeBookUrl(raw) !== null;
}

const RETAILERS: [RegExp, string][] = [
  [/(^|\.)amazon\.|(^|\.)amzn\./, "Amazon"],
  [/(^|\.)flipkart\./, "Flipkart"],
  [/(^|\.)goodreads\./, "Goodreads"],
  [/(^|\.)openlibrary\.org$/, "Open Library"],
  [/(^|\.)books\.google\./, "Google Books"],
  [/(^|\.)barnesandnoble\./, "Barnes & Noble"],
  [/(^|\.)bookshop\.org$/, "Bookshop.org"],
  [/(^|\.)waterstones\./, "Waterstones"],
  [/(^|\.)abebooks\./, "AbeBooks"],
  [/(^|\.)kobo\./, "Kobo"],
  [/(^|\.)crossword\.in$/, "Crossword"],
];

/** What to call the place a link points at, for one line of UI.

    Falls back to the bare hostname rather than "a website" — for the small
    independents this app is often pointed at, the domain IS the shop's name
    and is more informative than any generic wording. */
export function retailerName(rawUrl: string): string {
  const normalized = normalizeBookUrl(rawUrl);
  if (!normalized) return "the web";
  const host = new URL(normalized).hostname.replace(/^www\./, "");
  for (const [pattern, name] of RETAILERS) if (pattern.test(host)) return name;
  return host;
}

/** An ISBN read straight out of the link, when there is one.

    Two shapes carry it in practice: an Amazon product code (`/dp/…`,
    `/gp/product/…`), which for books is the ISBN-10 itself, and a bare
    ISBN-13 dropped anywhere in the path or query by nearly every other
    retailer. Both are checksum-verified before being believed — a ten-digit
    run that is not an ISBN is Amazon's own id (`B08…`) or a random product
    number, and inventing an ISBN from one would poison the dedupe key every
    other part of the library trusts. */
export function codeFromBookUrl(rawUrl: string): { isbn13?: string; isbn10?: string } {
  const normalized = normalizeBookUrl(rawUrl);
  if (!normalized) return {};
  const url = new URL(normalized);
  const haystack = `${url.pathname}${url.search}`;

  // ISBN-13 first: it is unambiguous, and needs no conversion.
  for (const candidate of haystack.match(/\d{13}/g) ?? []) {
    if (isValidIsbn13(candidate)) return { isbn13: candidate };
  }

  for (const candidate of haystack.match(/[0-9][0-9Xx]{9}/g) ?? []) {
    const isbn10 = candidate.toUpperCase();
    if (!isValidIsbn10(isbn10)) continue;
    const isbn13 = toIsbn13(isbn10);
    if (isbn13) return { isbn13, isbn10 };
  }
  return {};
}

/* ————— asking Claude ————— */

export function bookLinkPrompt(url: string, code: { isbn13?: string }): string {
  return [
    `Identify the book sold or described at this URL: ${url}`,
    ``,
    `First fetch that page. Many retailers — Amazon especially — block`,
    `automated fetches; if the fetch fails or returns no usable content,`,
    `search the web for the book that URL refers to instead (the product`,
    `code and any words in the path are strong hints).`,
    code.isbn13 ? `The link appears to contain ISBN-13 ${code.isbn13} — confirm it.` : ``,
    ``,
    `Reply with ONLY a JSON object, no prose:`,
    `{"found": boolean, "notABook": boolean, "title": string, "authors": string[],`,
    ` "publisher": string, "publishedYear": number, "pageCount": number, "isbn13": string}`,
    ``,
    `Set "found" to true only when a source actually describes this specific`,
    `book. Omit any field you could not confirm — never guess, especially the`,
    `ISBN and the page count. If the link is to something that is not a book`,
    `at all, reply {"found": false, "notABook": true}. If it is a book but`,
    `nothing reliable turns up, reply {"found": false}.`,
  ].filter((line) => line !== "").join("\n");
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The model's object → an ordinary LookupResult.

    `"not-a-book"` is distinguished from `null` because the two need different
    words in the UI: one means "that link is a kettle", the other means "I
    could not confirm this — type it in". */
export function mapLinkedBook(json: unknown): LookupResult | "not-a-book" | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  if (o.notABook === true) return "not-a-book";
  if (o.found !== true) return null;

  const title = cleanString(o.title);
  if (!title) return null;

  const rawIsbn = cleanString(o.isbn13);
  const isbn13 = rawIsbn ? toIsbn13(rawIsbn) ?? undefined : undefined;
  const year = typeof o.publishedYear === "number" && Number.isFinite(o.publishedYear)
    ? Math.trunc(o.publishedYear)
    : undefined;
  const pages = typeof o.pageCount === "number" && Number.isFinite(o.pageCount) && o.pageCount > 0
    ? Math.trunc(o.pageCount)
    : undefined;

  return {
    title,
    authors: Array.isArray(o.authors)
      ? o.authors.map(cleanString).filter((a): a is string => !!a)
      : [],
    publisher: cleanString(o.publisher),
    publishedYear: year && year > 1400 && year < 2200 ? year : undefined,
    pageCount: pages,
    isbn13,
    provider: "web",
  };
}

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}
const AUTH_STATUSES = new Set([401, 403, 429]);

/** A pasted link → a wishlist book, or an honest reason why not.

    Every returned book is `status: "wishlist"` and carries `sourceUrl`, so
    the record remembers where it was found and can be reopened there while
    standing in a shop. */
export async function resolveBookFromLink(
  rawUrl: string,
  claude: BookLinkGateway,
  books: BookGateway,
): Promise<BookLinkOutcome> {
  const url = normalizeBookUrl(rawUrl);
  if (!url) return { kind: "unusable", reason: "That doesn't look like a link." };

  const code = codeFromBookUrl(url);
  const base = (patch: Partial<Book> = {}): Book => newBook({
    status: "wishlist",
    sourceUrl: url,
    source: `link:${retailerName(url)}`,
    isbn13: code.isbn13,
    isbn10: code.isbn10,
    ...patch,
  });

  /* Rung 1 — the link told us the ISBN, so the free databases can answer.
     No Claude key required, no request billed. A miss here is not fatal:
     the ladder simply continues. */
  if (code.isbn13) {
    const outcome = await lookupIsbn(code.isbn13, books);
    if (outcome.kind === "found") {
      return { kind: "filled", book: mergeLookupIntoBook(base(), outcome.result) };
    }
  }

  /* Rung 2 — ask the model to read the page. */
  let raw: unknown;
  try {
    raw = await claude.read(bookLinkPrompt(url, code), url);
  } catch (err) {
    return {
      kind: "unavailable",
      reason: `Claude: ${err instanceof Error ? err.message : "request failed"}`,
      auth: AUTH_STATUSES.has(statusOf(err) ?? -1),
    };
  }

  const text = textFromMessage(raw);
  const mapped = text === null ? null : mapLinkedBook(extractJson(text));
  if (mapped === "not-a-book") return { kind: "not-a-book" };
  if (!mapped) return { kind: "manual" };

  /* Rung 3 — enrichment. The model's title unlocks the free databases, whose
     metadata and covers are trusted over the model's own; the model then
     fills only what they still lack. searchTitles swallows its own errors,
     so a database outage degrades to the model's answer rather than failing
     the whole paste. */
  const probe = { ...base(), title: mapped.title };
  const dbHit = bestTitleMatch(probe, await searchTitles(mapped.title, books));
  const book = dbHit
    ? mergeLookupIntoBook(mergeLookupIntoBook(base(), dbHit), mapped)
    : mergeLookupIntoBook(base(), mapped);
  return { kind: "filled", book };
}

/** A wishlist book from a title alone — the keyboard rung, used when the
    link path fails or the user never had a link in the first place. */
export function wishlistBookFromLookup(result: LookupResult, sourceUrl?: string): Book {
  return bookFromLookup(result, {
    status: "wishlist",
    sourceUrl,
    source: sourceUrl ? `link:${retailerName(sourceUrl)}` : "wishlist",
  });
}

/** Moving a book from "I want this" onto the shelf.

    `addedAt` is deliberately left alone — it records when you first wanted
    the book, and the gap between that and `acquiredAt` is the only thing a
    wishlist has to say once the book is bought. */
export function markAsBought(book: Book, at = Date.now()): Book {
  return { ...book, status: "unread", acquiredAt: at };
}
