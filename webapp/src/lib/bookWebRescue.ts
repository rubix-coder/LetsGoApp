/* The last rung of the resolve ladder: when a book is in neither Open
   Library nor Google Books (and its title search found nothing), ask Claude
   to find it on the open web — the Messages API's server-side web search
   tool runs the searches and the model answers with the bibliographic facts.

   Trust model matches the cover-photo path: the model's answer is mapped
   into an ordinary LookupResult, structurally validated (ISBN checksum, year
   sanity), guarded against wrong-book matches, and stamped provider "web" so
   the record is flagged as worth re-checking later. The cover is
   deliberately NOT taken from the web — a found title/ISBN is fed back
   through the free databases (stable covers, trusted metadata), and the
   model's answer only fills what they still lack. */

import type { Book } from "./types";
import { toIsbn13 } from "./isbn";
import {
  bestTitleMatch, mergeLookupIntoBook, searchTitles, titleQueryFor,
  type BookGateway, type LookupResult,
} from "./bookLookup";
import { extractJson, textFromMessage } from "./coverVision";

/** The whole network half, injectable so the ladder is testable offline. */
export interface WebRescueGateway {
  /** Sends the prompt to a web-search-equipped model; resolves with the raw
      Messages API response body. */
  search: (prompt: string) => Promise<unknown>;
}

export type WebRescueOutcome =
  | { kind: "filled"; book: Book }
  /** The web has nothing either — hand-entry really is the only path. */
  | { kind: "manual" }
  | { kind: "unavailable"; reason: string; auth: boolean };

export function webRescuePrompt(isbn13: string | undefined, title: string | null): string {
  const subject = [
    isbn13 ? `ISBN-13 ${isbn13}` : null,
    title ? `title "${title}"` : null,
  ].filter(Boolean).join(", ");
  return [
    `Search the web for the book with ${subject}. Regional and small-publisher`,
    `printings are expected — publisher pages, retailer listings, and library`,
    `records are all good sources.`,
    ``,
    `Reply with ONLY a JSON object, no prose:`,
    `{"found": boolean, "title": string, "authors": string[], "publisher": string,`,
    ` "publishedYear": number, "pageCount": number, "isbn13": string}`,
    ``,
    `Set "found" to true only when a source actually describes this specific`,
    `book. Omit any field you could not confirm — never guess, especially the`,
    `ISBN. If nothing reliable turns up, reply {"found": false}.`,
  ].join("\n");
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The model's object → an ordinary LookupResult, or null when it found
    nothing usable. Same validation posture as the vision path: a supplied
    ISBN must survive its own checksum, a year must be from publishing
    history — the prompt forbids guessing, the checks enforce it. */
export function mapWebRescue(json: unknown): LookupResult | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
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

/** Web search, then a database enrichment pass over what it found.

    Only called for books the whole database ladder already gave up on, so
    a "manual" here is final. Guards: a book with a real title refuses a web
    result whose title is plausibly a different book, and the book's own
    ISBN always survives the merge (mergeLookupIntoBook never overwrites). */
export async function webRescueBook(
  book: Book,
  claude: WebRescueGateway,
  books: BookGateway,
): Promise<WebRescueOutcome> {
  const ownTitle = titleQueryFor(book);
  let raw: unknown;
  try {
    raw = await claude.search(webRescuePrompt(book.isbn13, ownTitle));
  } catch (err) {
    return {
      kind: "unavailable",
      reason: `Claude web search: ${err instanceof Error ? err.message : "request failed"}`,
      auth: AUTH_STATUSES.has(statusOf(err) ?? -1),
    };
  }

  const text = textFromMessage(raw);
  const web = text === null ? null : mapWebRescue(extractJson(text));
  if (!web) return { kind: "manual" };
  if (ownTitle && !bestTitleMatch(book, [web])) return { kind: "manual" };

  /* Enrichment: the web's title unlocks the free databases (the stored title
     was unsearchable or already missed). A DB hit is preferred — trusted
     metadata and a stable cover — with the model's answer filling only what
     the databases still lack. searchTitles swallows its own errors. */
  const probe = { ...book, title: web.title };
  const dbHit = bestTitleMatch(probe, await searchTitles(web.title, books));
  const filled = dbHit
    ? mergeLookupIntoBook(mergeLookupIntoBook(book, dbHit), web)
    : mergeLookupIntoBook(book, web);
  return { kind: "filled", book: filled };
}
