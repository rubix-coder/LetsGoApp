/* Turning an ISBN into book metadata.

   Open Library first (free, no key, good coverage of mainstream English
   publishing), Google Books as the fallback for what it misses. The mapping
   is pure and the network sits behind an injectable gateway, the same shape
   `CalendarGateway` uses in gcalSync — so every quirk below is tested without
   touching the network. */

import { newBook } from "./books";
import { toIsbn10 } from "./isbn";
import type { Book } from "./types";

export interface LookupResult {
  title: string;
  authors: string[];
  publisher?: string;
  publishedYear?: number;
  pageCount?: number;
  coverUrl?: string;
  isbn13?: string;
  isbn10?: string;
  /** "vision" means a model read it off a photograph, "web" that a model
      found it via web search, rather than a database answering — worth
      keeping, since those records are the ones most worth re-checking
      later. */
  provider: "openlibrary" | "google" | "vision" | "web";
}

export interface BookGateway {
  openLibrary: (isbn13: string) => Promise<unknown>;
  googleBooks: (isbn13: string) => Promise<unknown>;
  /** Free-text title search — the rescue path when an ISBN is unindexed.
      Open Library first: its search index is far broader than its ISBN index
      (it has the Wiley India reprints that `bibkeys` misses) and it is not
      subject to Google's shared anonymous quota. */
  searchTitleOpenLibrary: (query: string) => Promise<unknown>;
  searchTitleGoogle: (query: string) => Promise<unknown>;
}

/** Publication dates in these feeds are wildly inconsistent — "1999",
    "November 30, 1999", "1999-11-30", "c1999". Only the year is wanted. */
export function parseYear(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = /(\d{4})/.exec(raw);
  if (!m) return undefined;
  const year = Number(m[1]);
  return year >= 1000 && year <= 2999 ? year : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Open Library's `jscmd=data` payload, keyed by the bibkey that was asked for.

    A miss is HTTP 200 with `{}` — not a 404 — which is the single easiest
    thing to get wrong here and the reason the empty check comes first. */
export function mapOpenLibrary(json: unknown, isbn13: string): LookupResult | null {
  if (!json || typeof json !== "object") return null;
  const record = (json as Record<string, unknown>)[`ISBN:${isbn13}`];
  if (!record || typeof record !== "object") return null;
  const r = record as Record<string, unknown>;

  const title = str(r.title);
  if (!title) return null;

  const authors = Array.isArray(r.authors)
    ? r.authors.map((a) => str((a as Record<string, unknown>)?.name)).filter((s): s is string => !!s)
    : [];
  const publishers = Array.isArray(r.publishers) ? r.publishers : [];
  const identifiers = (r.identifiers ?? {}) as Record<string, unknown>;
  const cover = (r.cover ?? {}) as Record<string, unknown>;
  const pick = (list: unknown): string | undefined =>
    Array.isArray(list) ? str(list[0]) : undefined;

  return {
    title,
    authors,
    publisher: str((publishers[0] as Record<string, unknown>)?.name),
    publishedYear: parseYear(str(r.publish_date)),
    pageCount: num(r.number_of_pages),
    // Subjects are deliberately NOT mapped to tags: Open Library returns
    // dozens of Library-of-Congress headings per book, which would bury the
    // handful of tags a person actually chose.
    coverUrl: str(cover.medium),
    isbn13: pick(identifiers.isbn_13) ?? isbn13,
    isbn10: pick(identifiers.isbn_10),
    provider: "openlibrary",
  };
}

/** True when Google answered with an error envelope rather than results.

    This matters more than it looks: unkeyed Google Books has a per-day quota
    shared across all anonymous callers, and when it is exhausted the reply is
    `{error: {code: 429, ...}}` — which carries no `totalItems`. Reading that
    as "zero results" turns "we could not check" into "this book does not
    exist", which is exactly the wrong thing to tell someone holding the book. */
export function isGoogleError(json: unknown): boolean {
  return !!json && typeof json === "object" && "error" in (json as Record<string, unknown>);
}

export function mapGoogleBooks(json: unknown, isbn13: string): LookupResult | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  if (isGoogleError(j)) return null;
  if (num(j.totalItems) === 0) return null;
  const items = Array.isArray(j.items) ? j.items : [];
  const volume = (items[0] as Record<string, unknown>)?.volumeInfo as Record<string, unknown> | undefined;
  if (!volume) return null;

  const title = str(volume.title);
  if (!title) return null;

  const ids = Array.isArray(volume.industryIdentifiers) ? volume.industryIdentifiers : [];
  const idOf = (type: string): string | undefined => {
    for (const entry of ids) {
      const e = entry as Record<string, unknown>;
      if (e?.type === type) return str(e.identifier);
    }
    return undefined;
  };

  const links = (volume.imageLinks ?? {}) as Record<string, unknown>;
  let coverUrl = str(links.thumbnail) ?? str(links.smallThumbnail);
  // Google still hands out http: URLs, and mixed-content blocking kills every
  // cover silently. `edge=curl` draws a fake dog-ear on the image, and it can
  // arrive as either the first parameter or a later one — so the separator is
  // matched too, and any separator left dangling is cleaned up.
  if (coverUrl) {
    coverUrl = coverUrl
      .replace(/^http:/, "https:")
      .replace(/([?&])edge=curl&?/g, "$1")
      .replace(/[?&]$/, "");
  }

  return {
    title,
    authors: Array.isArray(volume.authors)
      ? volume.authors.map(str).filter((s): s is string => !!s)
      : [],
    publisher: str(volume.publisher),
    publishedYear: parseYear(str(volume.publishedDate)),
    pageCount: num(volume.pageCount),
    coverUrl,
    // "" is passed by title search, where there is no ISBN to fall back to.
    isbn13: idOf("ISBN_13") ?? (isbn13 || undefined),
    isbn10: idOf("ISBN_10"),
    provider: "google",
  };
}

/** What a lookup actually concluded.

    The distinction between "not-found" and "unavailable" is the whole point.
    A book genuinely absent from both databases needs the user to type its
    details; a lookup that failed because Google's anonymous quota is
    exhausted or the network dropped needs a retry, not typing. Collapsing
    both into `null` told people their book did not exist when the truth was
    that we never managed to ask. */
export type LookupOutcome =
  | { kind: "found"; result: LookupResult }
  | { kind: "not-found" }
  /** `auth`: the failure is a key/quota problem (401/403/429 or Google's
      error envelope) — fixable in Settings → Library, so worth flagging
      there rather than asking the user to parse a reason string. */
  | { kind: "unavailable"; reason: string; auth?: boolean };

/** HTTP status when a gateway error carries one (BookApiError does), without
    importing the class — the lookup layer stays network-agnostic. */
function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}
const AUTH_STATUSES = new Set([401, 403, 429]);

/** Open Library first, then Google. Each provider is asked independently so
    one being down never costs the other its turn — but if NEITHER produced a
    trustworthy answer, that is reported as unavailable rather than as a miss. */
export async function lookupIsbn(isbn13: string, gateway: BookGateway): Promise<LookupOutcome> {
  let openLibraryAnswered = false;
  let googleAnswered = false;
  let reason = "";
  let auth = false;

  try {
    const raw = await gateway.openLibrary(isbn13);
    openLibraryAnswered = true;
    const found = mapOpenLibrary(raw, isbn13);
    if (found) return { kind: "found", result: found };
  } catch (err) {
    reason = err instanceof Error ? err.message : "Open Library unreachable";
  }

  try {
    const raw = await gateway.googleBooks(isbn13);
    // An error envelope is NOT an answer — see isGoogleError.
    if (isGoogleError(raw)) {
      reason = "Google Books quota exhausted — add an API key in Settings → Library";
      auth = true;
    } else {
      googleAnswered = true;
      const found = mapGoogleBooks(raw, isbn13);
      if (found) return { kind: "found", result: found };
    }
  } catch (err) {
    if (AUTH_STATUSES.has(statusOf(err) ?? -1)) auth = true;
    if (!reason) reason = err instanceof Error ? err.message : "Google Books unreachable";
  }

  /* Ruling a book out takes BOTH providers, not either one.

     Open Library answers a miss with HTTP 200 and an empty object, so it
     "replies" on essentially every lookup a live network makes. Accepting
     that alone as proof meant a rate-limited or misconfigured Google Books
     was invisible: the app reported "not in any database" having actually
     asked one database. Since those two outcomes call for completely
     different actions from the user — type the details in by hand, versus
     fix your API key — reporting the wrong one wastes real work. */
  if (openLibraryAnswered && googleAnswered) return { kind: "not-found" };

  const missing = !googleAnswered ? "Google Books" : "Open Library";
  return {
    kind: "unavailable",
    reason: reason || `${missing} didn't answer, so this book can't be ruled out yet`,
    auth,
  };
}

/* ── Automatic resolve: ISBN first, then a title search — the strategy
   switch is the app's job, not advice to print at the user. ────────────── */

export type AutoResolveOutcome =
  | { kind: "filled"; book: Book }
  /** Both strategies exhausted with real answers — hand-entry is genuinely
      the only path left, and that is ALL the UI needs to say. */
  | { kind: "manual" }
  | { kind: "unavailable"; reason: string; auth: boolean };

const normalizeTitle = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A searchable title, or null. A scan record's title is its own ISBN — no
    words to search with, so the title strategy simply does not apply. */
export function titleQueryFor(book: Book): string | null {
  const t = book.title.trim();
  if (!t || t === book.isbn13 || /^\d{9,12}[\dxX]$/.test(t)) return null;
  return t;
}

/** First hit whose title plausibly IS this book — containment either way
    after normalization. Auto-applying a wrong book would be worse than
    leaving it unfilled, so no match means manual, never "closest". */
export function bestTitleMatch(book: Book, results: LookupResult[]): LookupResult | null {
  const want = normalizeTitle(book.title);
  if (want.length < 3) return null;
  for (const r of results) {
    const got = normalizeTitle(r.title);
    if (got.includes(want) || want.includes(got)) return r;
  }
  return null;
}

/** One line for the shelf. "Not in the databases" and "error fetching" are
    kept apart — absence needs typing, an error needs the details that live
    in Settings → Library (the last-run report recorded there). */
export function resolveSummary(c: { filled: number; notFound: number; unavailable: number }): string {
  const parts = [`Filled ${c.filled}`];
  if (c.notFound) parts.push(`${c.notFound} not in the databases — add manually!`);
  if (c.unavailable) parts.push(`error fetching ${c.unavailable} — details in Settings → Library`);
  return parts.join(" · ");
}

/** ISBN lookup, then an automatic title-search rescue. Fills what it can;
    reports `manual` only when both databases really answered and no
    plausible record exists — auth/network trouble stays `unavailable` so it
    can be flagged where it is fixable instead of counted as a miss. */
export async function autoResolveBook(book: Book, gateway: BookGateway): Promise<AutoResolveOutcome> {
  if (book.isbn13) {
    const outcome = await lookupIsbn(book.isbn13, gateway);
    if (outcome.kind === "found") return { kind: "filled", book: mergeLookupIntoBook(book, outcome.result) };
    if (outcome.kind === "unavailable") return { kind: "unavailable", reason: outcome.reason, auth: outcome.auth ?? false };
  }
  const q = titleQueryFor(book);
  if (!q) return { kind: "manual" };
  const match = bestTitleMatch(book, await searchTitles(q, gateway));
  return match ? { kind: "filled", book: mergeLookupIntoBook(book, match) } : { kind: "manual" };
}

/** Rescue path for books whose ISBN is in no database — India-only reprints
    and small regional publishers, where the WORK is well known but that
    printing's ISBN was never indexed. The user types a few words of the
    title and picks from the candidates, which beats typing every field. */
export function mapGoogleTitleSearch(json: unknown, limit = 6): LookupResult[] {
  if (!json || typeof json !== "object" || isGoogleError(json)) return [];
  const items = Array.isArray((json as Record<string, unknown>).items)
    ? ((json as Record<string, unknown>).items as unknown[])
    : [];
  const out: LookupResult[] = [];
  for (const item of items.slice(0, limit)) {
    const mapped = mapGoogleBooks({ totalItems: 1, items: [item] }, "");
    if (mapped) out.push(mapped);
  }
  return out;
}

/** Open Library's search.json — a flat doc list, unlike the bibkeys payload. */
export function mapOpenLibrarySearch(json: unknown, limit = 6): LookupResult[] {
  if (!json || typeof json !== "object") return [];
  const docs = Array.isArray((json as Record<string, unknown>).docs)
    ? ((json as Record<string, unknown>).docs as unknown[])
    : [];
  const out: LookupResult[] = [];
  for (const raw of docs.slice(0, limit)) {
    const d = raw as Record<string, unknown>;
    const title = str(d.title);
    if (!title) continue;
    const coverId = num(d.cover_i);
    const isbns = Array.isArray(d.isbn) ? (d.isbn as unknown[]).map(str).filter((s): s is string => !!s) : [];
    out.push({
      title,
      authors: Array.isArray(d.author_name)
        ? (d.author_name as unknown[]).map(str).filter((s): s is string => !!s)
        : [],
      publisher: Array.isArray(d.publisher) ? str((d.publisher as unknown[])[0]) : undefined,
      publishedYear: num(d.first_publish_year),
      pageCount: num(d.number_of_pages_median),
      // A search hit has a cover id, not an ISBN-derived URL, so it has to be
      // stored — coverUrlFor cannot rebuild this one.
      coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : undefined,
      isbn13: isbns.find((i) => i.length === 13),
      isbn10: isbns.find((i) => i.length === 10),
      provider: "openlibrary",
    });
  }
  return out;
}

/** Title search across both providers, Open Library first. */
export async function searchTitles(query: string, gateway: BookGateway): Promise<LookupResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const hits = mapOpenLibrarySearch(await gateway.searchTitleOpenLibrary(q));
    if (hits.length) return hits;
  } catch {
    // fall through to Google
  }
  try {
    return mapGoogleTitleSearch(await gateway.searchTitleGoogle(q));
  } catch {
    return [];
  }
}

/** Whether a cover URL can be rebuilt from the ISBN alone (see coverUrlFor).

    Open Library's `/b/isbn/...` form can, so storing it would be redundant.
    Its `/b/id/{cover_i}/...` search form and Google's thumbnails cannot, so
    those have to be kept or the cover is lost. Provider alone is not enough
    to tell them apart — Open Library produces both shapes. */
export function isDerivableCover(url: string | undefined): boolean {
  return !!url && url.includes("/b/isbn/");
}

export function bookFromLookup(result: LookupResult, patch: Partial<Book> = {}): Book {
  return newBook({
    title: result.title,
    authors: result.authors,
    isbn13: result.isbn13,
    isbn10: result.isbn10 ?? (result.isbn13 ? toIsbn10(result.isbn13) ?? undefined : undefined),
    publisher: result.publisher,
    publishedYear: result.publishedYear,
    pageCount: result.pageCount,
    // Kept only when it cannot be rebuilt from the ISBN (see isDerivableCover).
    coverUrl: isDerivableCover(result.coverUrl) ? undefined : result.coverUrl,
    lookup: { provider: result.provider, at: Date.now() },
    ...patch,
  });
}

/** Fills the gaps in a book without overwriting anything a person set.

    A scan record's title is its own ISBN, which counts as empty here — that
    is exactly what a later lookup is meant to replace. */
export function mergeLookupIntoBook(book: Book, result: LookupResult): Book {
  const titleIsPlaceholder = book.title.trim() === "" || book.title.trim() === book.isbn13;
  return {
    ...book,
    title: titleIsPlaceholder ? result.title : book.title,
    authors: book.authors.length ? book.authors : result.authors,
    isbn13: book.isbn13 ?? result.isbn13,
    isbn10: book.isbn10 ?? result.isbn10,
    publisher: book.publisher ?? result.publisher,
    publishedYear: book.publishedYear ?? result.publishedYear,
    pageCount: book.pageCount ?? result.pageCount,
    coverUrl: book.coverUrl ?? (isDerivableCover(result.coverUrl) ? undefined : result.coverUrl),
    lookup: { provider: result.provider, at: Date.now() },
  };
}
