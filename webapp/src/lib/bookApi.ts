/* The HTTP half of book lookup. Deliberately thin: no retry policy, no state
   beyond a memo, same shape as gcalApi.

   Both endpoints send `Access-Control-Allow-Origin: *` and work with no
   credential at all. Google Books optionally takes an API key, and in
   practice it needs one: the unkeyed endpoint shares a single daily quota
   across every anonymous caller from an IP, so it returns 429 for EVERY
   query — not just obscure books — once anyone has exhausted it. A key moves
   the app onto its own 1,000/day allowance. The key lives in localStorage
   (lib/apiKeys.ts), never in the vault. */

import { googleBooksKey } from "./apiKeys";
import type { BookGateway } from "./bookLookup";

/** 8 seconds, not gcalApi's 15. A scanner that stalls for fifteen seconds on
    every miss is unusable at the pace this is meant to run. */
const TIMEOUT_MS = 8_000;

export class BookApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "BookApiError";
  }
}

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new BookApiError(res.status, `GET ${url} → ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err instanceof BookApiError) throw err;
    // Timeouts and network faults collapse to 0, matching GoogleApiError.
    throw new BookApiError(0, err instanceof Error ? err.message : "network error");
  } finally {
    clearTimeout(timer);
  }
}

/* A re-scan, a re-render, or a "resolve unfilled" run over a shelf that was
   already healed should not hit the network again. Impure by design, which is
   exactly why it lives here rather than in the pure mapper. */
const memo = new Map<string, unknown>();

async function memoised(key: string, load: () => Promise<unknown>): Promise<unknown> {
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const value = await load();
  memo.set(key, value);
  return value;
}

/** Appends the key when there is one. `url` must already carry a query
    string — both callers build one. */
function withKey(url: string): string {
  const key = googleBooksKey();
  return key ? `${url}&key=${encodeURIComponent(key)}` : url;
}

/** Part of every Google memo key, so adding a key does not keep serving the
    429 that was cached while there wasn't one. */
function keyTag(): string {
  return googleBooksKey() ? "k" : "anon";
}

export const httpBookGateway: BookGateway = {
  openLibrary: (isbn13) =>
    memoised(`ol:${isbn13}`, () =>
      getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&format=json&jscmd=data`)),
  googleBooks: (isbn13) =>
    // A 429 here is the norm without a key: the unkeyed endpoint shares one
    // daily quota across every anonymous caller from the same IP. getJson
    // throws, and lookupIsbn turns that into "unavailable", never "not found".
    memoised(`gb:${keyTag()}:${isbn13}`, () =>
      getJson(withKey(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}`))),
  searchTitleOpenLibrary: (query) =>
    memoised(`olt:${query}`, () =>
      getJson(
        "https://openlibrary.org/search.json?title=" + encodeURIComponent(query) +
        "&limit=8&fields=title,author_name,first_publish_year,isbn,cover_i,publisher,number_of_pages_median",
      )),
  searchTitleGoogle: (query) =>
    memoised(`gbt:${keyTag()}:${query}`, () =>
      getJson(withKey(
        "https://www.googleapis.com/books/v1/volumes?q=" +
        encodeURIComponent("intitle:" + query) + "&maxResults=8",
      ))),
};

/** Human wording for the failures worth distinguishing. */
export function bookApiMessage(err: unknown): string {
  if (err instanceof BookApiError) {
    if (err.status === 429 || err.status === 403) {
      // Without a key this is not a transient blip: the shared anonymous
      // quota is exhausted for the whole IP and stays that way until it
      // resets, so "try again in a minute" would be a lie. Point at the fix.
      return googleBooksKey()
        ? "Google Books is rate-limiting — try again in a minute."
        : "Google Books has hit its shared anonymous limit. Add a free API key in Settings → Library to fix this.";
    }
    if (err.status === 0) return "Couldn't reach the book database — check your connection.";
    return `Lookup failed (${err.status}).`;
  }
  return "Lookup failed.";
}
