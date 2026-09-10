/* Turning the shelf into a document you can keep.

   One generator serves both outputs: HTML is the string written to a file,
   and PDF is that same string handed to the browser's print dialogue. There
   is no PDF library here and there should not be — every browser already has
   a competent PDF writer behind Ctrl+P, and shipping a second one would cost
   more than the whole Library feature.

   Pure string-building on purpose, so the escaping and the grouping are
   testable without a DOM. */

import { bookDisplayAuthor, readingFraction } from "./books";
import { groupBooks, type BookGroup } from "./bookFilter";
import { BOOK_STATUS_LABEL, type Book } from "./types";

/** Titles, authors and publishers come from third-party APIs and from CSV
    files the user did not write. Interpolating those into a document
    unescaped is a script-injection hole, so nothing reaches the output
    without passing through here. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ExportOptions {
  /** Heading on the document itself. */
  title: string;
  group: BookGroup;
  /** Passed in rather than read from the clock, so the output is a pure
      function of its inputs and can be asserted on. */
  generatedAt: Date;
  /** True when the list is a filtered subset, so the document can say so
      instead of quietly claiming to be the whole library. */
  filtered?: boolean;
}

function statusChip(book: Book): string {
  const label = escapeHtml(BOOK_STATUS_LABEL[book.status]);
  return `<span class="chip chip-${book.status}">${label}</span>`;
}

function bookRow(book: Book): string {
  const fraction = readingFraction(book);
  const bookmark = book.currentPage !== undefined
    ? `p.${book.currentPage}${book.pageCount ? ` / ${book.pageCount}` : ""}${
        fraction !== null ? ` (${Math.round(fraction * 100)}%)` : ""
      }`
    : "";
  const details = [
    book.publisher,
    book.publishedYear ? String(book.publishedYear) : "",
    book.isbn13 ? `ISBN ${book.isbn13}` : "",
    book.shelf,
  ].filter(Boolean).map((d) => escapeHtml(String(d))).join(" · ");

  return `<tr>
  <td class="t">
    <span class="title">${escapeHtml(book.title || "Untitled")}</span>
    <span class="author">${escapeHtml(bookDisplayAuthor(book))}</span>
    ${details ? `<span class="meta">${details}</span>` : ""}
  </td>
  <td class="s">${statusChip(book)}</td>
  <td class="p">${escapeHtml(bookmark)}</td>
  <td class="r">${book.rating !== undefined ? "★".repeat(book.rating) : ""}</td>
</tr>`;
}

/** A complete, standalone HTML document — no external stylesheet, no font
    request, nothing to fetch. It has to survive being saved to disk, emailed,
    and opened years later on a machine with no network. */
export function booksToHtml(books: readonly Book[], opts: ExportOptions): string {
  const groups = groupBooks(books, opts.group);
  const stamp = opts.generatedAt.toISOString().slice(0, 10);

  const sections = groups.map((g) => {
    const heading = g.label
      ? `<h2>${escapeHtml(g.label)} <span class="n">${g.books.length}</span></h2>`
      : "";
    return `${heading}
<table>
<thead><tr><th>Book</th><th>Status</th><th>Bookmark</th><th>Rating</th></tr></thead>
<tbody>
${g.books.map(bookRow).join("\n")}
</tbody>
</table>`;
  }).join("\n");

  const empty = `<p class="empty">No books matched.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>
  /* System fonts only: a webfont would need a network request the saved file
     cannot rely on, and would silently fall back mid-print. */
  :root { --ink: #1a1a1f; --dim: #5c5c6b; --line: #d8d8e0; --accent: #a3282a; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 28px 48px;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink); background: #fff; max-width: 1000px; margin-inline: auto;
  }
  header { border-bottom: 2px solid var(--ink); padding-bottom: 12px; margin-bottom: 22px; }
  h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: -0.02em; }
  .sub { color: var(--dim); font-size: 12.5px; }
  h2 {
    margin: 26px 0 8px; font-size: 15px; letter-spacing: -0.01em;
    padding-bottom: 5px; border-bottom: 1px solid var(--line);
  }
  h2 .n { color: var(--dim); font-weight: 400; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--dim); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--line);
  }
  td { padding: 7px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  .t { width: 62%; }
  .title { display: block; font-weight: 600; }
  .author, .meta { display: block; color: var(--dim); font-size: 12px; }
  .meta { font-size: 11px; }
  .p { font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 12px; color: var(--accent); }
  .r { white-space: nowrap; color: var(--accent); }
  .s { white-space: nowrap; }
  .chip {
    display: inline-block; padding: 1px 7px; border-radius: 999px;
    font-size: 11px; border: 1px solid var(--line); color: var(--dim);
  }
  .chip-reading { border-color: var(--accent); color: var(--accent); }
  .chip-wishlist { border-style: dashed; }
  .chip-read { border-color: #2e7d5b; color: #2e7d5b; }
  .empty { color: var(--dim); }
  footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid var(--line); color: var(--dim); font-size: 11px; }
  @media print {
    body { padding: 0; max-width: none; font-size: 11.5px; }
    /* A heading stranded at the foot of a page, and split rows, are the two
       things that make a printed catalogue hard to read. */
    h2 { break-after: avoid; page-break-after: avoid; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    thead { display: table-header-group; }
  }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(opts.title)}</h1>
  <div class="sub">
    ${books.length} ${books.length === 1 ? "book" : "books"}${opts.filtered ? " (filtered selection)" : ""} · ${escapeHtml(stamp)}
  </div>
</header>
${books.length === 0 ? empty : sections}
<footer>Exported from LetsGo · ${escapeHtml(stamp)}</footer>
</body>
</html>`;
}
