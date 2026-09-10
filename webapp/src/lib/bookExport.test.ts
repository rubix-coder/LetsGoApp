// @vitest-environment node
import { describe, expect, it } from "vitest";
import { booksToHtml, escapeHtml } from "./bookExport";
import { newBook } from "./books";

const AT = new Date("2026-08-01T10:00:00Z");
const base = { title: "My Library", group: "none" as const, generatedAt: AT };

describe("escapeHtml", () => {
  it("neutralises tags and quotes", () => {
    expect(escapeHtml('<script>alert("x")</script>'))
      .toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("escapes ampersands first, so entities are not double-broken", () => {
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });
});

describe("booksToHtml", () => {
  it("produces a standalone document with no external requests", () => {
    const html = booksToHtml([newBook({ title: "Dune" })], base);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    // Nothing to fetch: the file has to work offline, years later.
    expect(html).not.toMatch(/<link[^>]+href|<script|https?:\/\//);
  });

  it("never lets a title inject markup", () => {
    // Titles come from third-party APIs and from CSV files the user did not
    // write, so this is the whole reason escaping exists.
    const html = booksToHtml([newBook({ title: '<img src=x onerror="alert(1)">' })], base);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("escapes author and publisher too", () => {
    const html = booksToHtml([newBook({ title: "T", authors: ["<b>A</b>"], publisher: "<i>P</i>" })], base);
    expect(html).not.toContain("<b>A</b>");
    expect(html).not.toContain("<i>P</i>");
  });

  it("reports the count and the date", () => {
    const html = booksToHtml([newBook({ title: "A" }), newBook({ title: "B" })], base);
    expect(html).toContain("2 books");
    expect(html).toContain("2026-08-01");
  });

  it("says so when the list is only part of the shelf", () => {
    const html = booksToHtml([newBook({ title: "A" })], { ...base, filtered: true });
    expect(html).toContain("filtered selection");
    expect(html).toContain("1 book");
  });

  it("handles an empty shelf without producing a broken table", () => {
    const html = booksToHtml([], base);
    expect(html).toContain("No books matched");
    expect(html).not.toContain("<tbody>\n\n</tbody>");
  });

  it("writes a heading per group when grouped", () => {
    const html = booksToHtml(
      [
        newBook({ title: "A", authors: ["Ursula K. Le Guin"] }),
        newBook({ title: "B", authors: ["Iain Banks"] }),
      ],
      { ...base, group: "author" },
    );
    expect(html).toContain("Ursula K. Le Guin");
    expect(html).toContain("Iain Banks");
    expect(html.match(/<h2>/g)).toHaveLength(2);
  });

  it("writes no headings when grouping is off", () => {
    const html = booksToHtml([newBook({ title: "A" })], base);
    expect(html).not.toContain("<h2>");
  });

  it("shows the bookmark with a percentage when the length is known", () => {
    const html = booksToHtml([newBook({ title: "A", currentPage: 50, pageCount: 200 })], base);
    expect(html).toContain("p.50 / 200 (25%)");
  });

  it("shows a bare page number when the length is not known", () => {
    const html = booksToHtml([newBook({ title: "A", currentPage: 50 })], base);
    expect(html).toContain("p.50");
    expect(html).not.toContain("%)");
  });

  it("renders a rating as stars and omits it when unrated", () => {
    expect(booksToHtml([newBook({ title: "A", rating: 3 })], base)).toContain("★★★");
    expect(booksToHtml([newBook({ title: "A" })], base)).not.toContain("★");
  });

  it("keeps print rules that stop rows splitting across pages", () => {
    // This is what makes the PDF path usable rather than merely possible.
    const html = booksToHtml([newBook({ title: "A" })], base);
    expect(html).toContain("@media print");
    expect(html).toContain("page-break-inside: avoid");
  });
});
