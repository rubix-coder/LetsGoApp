// @vitest-environment node
import { describe, expect, it } from "vitest";
import { newBook } from "./books";
import type { BookGateway } from "./bookLookup";
import { mapWebRescue, webRescueBook, type WebRescueGateway } from "./bookWebRescue";

const ISBN = "9788131705490"; // valid ISBN-13, the regional-reprint case

/** Wraps a model reply the way the Messages API does. */
const envelope = (text: string) => ({ content: [{ type: "text", text }] });

const foundJson = JSON.stringify({
  found: true,
  title: "Data Structures and Algorithms Made Easy",
  authors: ["Narasimha Karumanchi"],
  publisher: "CareerMonk",
  publishedYear: 2016,
  pageCount: 434,
  isbn13: ISBN,
});

const emptyBooks = (over: Partial<BookGateway> = {}): BookGateway => ({
  openLibrary: async () => ({}),
  googleBooks: async () => ({ totalItems: 0 }),
  searchTitleOpenLibrary: async () => ({ docs: [] }),
  searchTitleGoogle: async () => ({ totalItems: 0 }),
  ...over,
});

const claudeSaying = (reply: unknown): WebRescueGateway => ({
  search: async () => reply,
});

describe("mapWebRescue — the model's answer becomes an ordinary LookupResult", () => {
  it("maps a found reply, stamping the web provider", () => {
    const r = mapWebRescue(JSON.parse(foundJson));
    expect(r).not.toBeNull();
    expect(r!.title).toBe("Data Structures and Algorithms Made Easy");
    expect(r!.provider).toBe("web");
    expect(r!.pageCount).toBe(434);
  });

  it("returns null when the model says it found nothing", () => {
    expect(mapWebRescue({ found: false })).toBeNull();
  });

  it("returns null for junk", () => {
    expect(mapWebRescue(null)).toBeNull();
    expect(mapWebRescue("text")).toBeNull();
    expect(mapWebRescue({ found: true })).toBeNull(); // no title
  });

  it("drops a structurally invalid ISBN rather than storing a hallucination", () => {
    const r = mapWebRescue({ found: true, title: "T", isbn13: "9781234567890" });
    expect(r!.isbn13).toBeUndefined();
  });

  it("drops a year outside publishing history", () => {
    const r = mapWebRescue({ found: true, title: "T", publishedYear: 12 });
    expect(r!.publishedYear).toBeUndefined();
  });
});

describe("webRescueBook — the last rung of the resolve ladder", () => {
  it("fills a scan placeholder the databases had nothing for", async () => {
    const book = newBook({ id: "b-keep", isbn13: ISBN, title: ISBN });
    const out = await webRescueBook(book, claudeSaying(envelope(foundJson)), emptyBooks());
    expect(out.kind).toBe("filled");
    if (out.kind !== "filled") return;
    expect(out.book.id).toBe("b-keep");
    expect(out.book.title).toBe("Data Structures and Algorithms Made Easy");
    expect(out.book.isbn13).toBe(ISBN); // the book's own ISBN survives the merge
    expect(out.book.lookup?.provider).toBe("web");
  });

  it("enriches from the databases once the web supplies a searchable title", async () => {
    const book = newBook({ isbn13: ISBN, title: ISBN });
    const webReply = JSON.stringify({ found: true, title: "Clean Code" });
    const books = emptyBooks({
      searchTitleOpenLibrary: async () => ({
        docs: [{ title: "Clean Code", author_name: ["Robert C. Martin"], number_of_pages_median: 464 }],
      }),
    });
    const out = await webRescueBook(book, claudeSaying(envelope(webReply)), books);
    expect(out.kind).toBe("filled");
    if (out.kind !== "filled") return;
    expect(out.book.pageCount).toBe(464); // came from the DB hit, not the model
    expect(out.book.authors).toEqual(["Robert C. Martin"]);
  });

  it("refuses a web result that is clearly a different book", async () => {
    const book = newBook({ isbn13: ISBN, title: "Clean Code" });
    const wrong = JSON.stringify({ found: true, title: "Cooking for Two" });
    const out = await webRescueBook(book, claudeSaying(envelope(wrong)), emptyBooks());
    expect(out.kind).toBe("manual");
  });

  it("stays manual when the model found nothing", async () => {
    const book = newBook({ isbn13: ISBN, title: ISBN });
    const out = await webRescueBook(
      book, claudeSaying(envelope(JSON.stringify({ found: false }))), emptyBooks());
    expect(out.kind).toBe("manual");
  });

  it("a 401 from the Claude API is an auth problem", async () => {
    const forbidden = Object.assign(new Error("That Claude API key was rejected."), { status: 401 });
    const claude: WebRescueGateway = { search: async () => { throw forbidden; } };
    const out = await webRescueBook(newBook({ isbn13: ISBN, title: ISBN }), claude, emptyBooks());
    expect(out.kind).toBe("unavailable");
    expect(out.kind === "unavailable" && out.auth).toBe(true);
  });

  it("a network fault is not an auth problem", async () => {
    const dead = Object.assign(new Error("network error"), { status: 0 });
    const claude: WebRescueGateway = { search: async () => { throw dead; } };
    const out = await webRescueBook(newBook({ isbn13: ISBN, title: ISBN }), claude, emptyBooks());
    expect(out.kind).toBe("unavailable");
    expect(out.kind === "unavailable" && out.auth).toBe(false);
  });
});
