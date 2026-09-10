import { describe, expect, it, vi } from "vitest";
import {
  bookLinkPrompt, codeFromBookUrl, looksLikeUrl, mapLinkedBook,
  normalizeBookUrl, resolveBookFromLink, retailerName,
} from "./bookLink";
import type { BookGateway } from "./bookLookup";

/* A gateway that answers "nothing found" for everything, so a test only has
   to stub the calls it actually cares about. */
const emptyBooks: BookGateway = {
  openLibrary: async () => ({}),
  googleBooks: async () => ({ totalItems: 0 }),
  searchTitleOpenLibrary: async () => ({ docs: [] }),
  searchTitleGoogle: async () => ({ totalItems: 0 }),
};

/** Wraps model text the way the Messages API returns it. */
const reply = (text: string) => ({ content: [{ type: "text", text }] });

describe("normalizeBookUrl", () => {
  it("keeps an ordinary https link", () => {
    expect(normalizeBookUrl("https://www.amazon.in/dp/0140449132"))
      .toBe("https://www.amazon.in/dp/0140449132");
  });

  it("assumes https for a bare host, which is what a pasted link often is", () => {
    expect(normalizeBookUrl("amazon.in/dp/0140449132"))
      .toBe("https://amazon.in/dp/0140449132");
  });

  it("trims the whitespace a share sheet leaves around a link", () => {
    expect(normalizeBookUrl("  https://amzn.eu/d/abc123  ")).toBe("https://amzn.eu/d/abc123");
  });

  it("drops the tracking tail so two shares of one book are one link", () => {
    expect(normalizeBookUrl("https://www.amazon.in/Odyssey/dp/0140449132/ref=sr_1_3?tag=x&qid=99"))
      .toBe("https://www.amazon.in/Odyssey/dp/0140449132");
  });

  it("keeps a query that identifies the book rather than the referrer", () => {
    expect(normalizeBookUrl("https://books.google.com/books?id=abc123&tag=spam"))
      .toBe("https://books.google.com/books?id=abc123");
  });

  it("refuses anything that is not a web link", () => {
    expect(normalizeBookUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeBookUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeBookUrl("The Odyssey by Homer")).toBeNull();
    expect(normalizeBookUrl("")).toBeNull();
  });
});

describe("looksLikeUrl", () => {
  it("tells a pasted link from a typed title", () => {
    expect(looksLikeUrl("https://amazon.in/dp/0140449132")).toBe(true);
    expect(looksLikeUrl("amazon.in/dp/0140449132")).toBe(true);
    expect(looksLikeUrl("The Odyssey")).toBe(false);
    // A title with a dot in it must not read as a hostname.
    expect(looksLikeUrl("Vol. 2 of the collected works")).toBe(false);
  });
});

describe("retailerName", () => {
  it("names the shops worth naming back to the user", () => {
    expect(retailerName("https://www.amazon.in/dp/0140449132")).toBe("Amazon");
    expect(retailerName("https://amzn.eu/d/abc")).toBe("Amazon");
    expect(retailerName("https://www.flipkart.com/x/p/y")).toBe("Flipkart");
    expect(retailerName("https://www.goodreads.com/book/show/1381")).toBe("Goodreads");
    expect(retailerName("https://openlibrary.org/works/OL1M")).toBe("Open Library");
  });

  it("falls back to the bare host for a shop it does not know", () => {
    expect(retailerName("https://www.blossombookhouse.in/product/x")).toBe("blossombookhouse.in");
  });
});

describe("codeFromBookUrl", () => {
  /* The whole point: an Amazon book ASIN usually IS the ISBN-10, so the free
     databases can answer before Claude is ever called. */
  it("reads an ISBN out of an Amazon /dp/ path", () => {
    expect(codeFromBookUrl("https://www.amazon.in/Odyssey/dp/0140449132")).toEqual({
      isbn13: "9780140449136",
      isbn10: "0140449132",
    });
  });

  it("reads the same code out of the older /gp/product/ path", () => {
    expect(codeFromBookUrl("https://www.amazon.com/gp/product/0140449132")).toEqual({
      isbn13: "9780140449136",
      isbn10: "0140449132",
    });
  });

  it("finds a bare ISBN-13 anywhere in the link", () => {
    expect(codeFromBookUrl("https://www.flipkart.com/odyssey/p/itm?pid=9780140449136"))
      .toEqual({ isbn13: "9780140449136" });
  });

  it("returns nothing for a non-ISBN ASIN, rather than a wrong ISBN", () => {
    // B0… ASINs are Amazon's own ids and have no ISBN meaning at all.
    expect(codeFromBookUrl("https://www.amazon.in/dp/B08XYZ1234")).toEqual({});
    expect(codeFromBookUrl("https://amzn.eu/d/abc123")).toEqual({});
  });

  it("ignores a ten-digit run that fails its check digit", () => {
    expect(codeFromBookUrl("https://www.amazon.in/dp/0140449131")).toEqual({});
  });
});

describe("bookLinkPrompt", () => {
  it("carries the link, and orders search only as a fallback", () => {
    const prompt = bookLinkPrompt("https://www.amazon.in/dp/0140449132", {});
    expect(prompt).toContain("https://www.amazon.in/dp/0140449132");
    expect(prompt.toLowerCase()).toContain("fetch");
    expect(prompt.toLowerCase()).toContain("search");
    // The invented-answer guard has to be in the prompt, not only in the map.
    expect(prompt.toLowerCase()).toContain("never guess");
  });

  it("hands over an ISBN read from the link, so the model can confirm it", () => {
    expect(bookLinkPrompt("https://x/dp/0140449132", { isbn13: "9780140449136" }))
      .toContain("9780140449136");
  });
});

describe("mapLinkedBook", () => {
  it("maps a confirmed page into a lookup result", () => {
    expect(mapLinkedBook({
      found: true,
      title: "The Odyssey",
      authors: ["Homer"],
      publisher: "Penguin",
      publishedYear: 1996,
      pageCount: 541,
      isbn13: "9780140449136",
    })).toEqual({
      title: "The Odyssey",
      authors: ["Homer"],
      publisher: "Penguin",
      publishedYear: 1996,
      pageCount: 541,
      isbn13: "9780140449136",
      provider: "web",
    });
  });

  it("refuses a page the model could not confirm", () => {
    expect(mapLinkedBook({ found: false })).toBeNull();
    expect(mapLinkedBook({ found: true })).toBeNull();
    expect(mapLinkedBook(null)).toBeNull();
    expect(mapLinkedBook("nonsense")).toBeNull();
  });

  /** Narrows off the "not-a-book" sentinel so a field can be read. */
  const asResult = (json: unknown) => {
    const mapped = mapLinkedBook(json);
    expect(mapped).not.toBe("not-a-book");
    return mapped === "not-a-book" ? null : mapped;
  };

  it("drops an ISBN that fails its own checksum rather than storing it", () => {
    expect(asResult({ found: true, title: "X", isbn13: "9780140449999" })?.isbn13).toBeUndefined();
  });

  it("drops a year outside publishing history", () => {
    expect(asResult({ found: true, title: "X", publishedYear: 12 })?.publishedYear).toBeUndefined();
  });

  it("reports a link that is not a book page at all", () => {
    expect(mapLinkedBook({ found: false, notABook: true })).toBe("not-a-book");
  });
});

describe("resolveBookFromLink", () => {
  it("rejects something that is not a link before spending a request", async () => {
    const claude = { read: vi.fn() };
    const outcome = await resolveBookFromLink("just some words", claude, emptyBooks);
    expect(outcome.kind).toBe("unusable");
    expect(claude.read).not.toHaveBeenCalled();
  });

  /* The free path. An Amazon /dp/ ISBN answers from Open Library, so no
     Claude key is needed and no API call is spent for the commonest link. */
  it("answers from the free databases when the link carries an ISBN", async () => {
    const claude = { read: vi.fn() };
    const books: BookGateway = {
      ...emptyBooks,
      openLibrary: async () => ({
        "ISBN:9780140449136": {
          title: "The Odyssey",
          authors: [{ name: "Homer" }],
          number_of_pages: 541,
        },
      }),
    };

    const outcome = await resolveBookFromLink("https://amazon.in/dp/0140449132", claude, books);
    expect(outcome.kind).toBe("filled");
    if (outcome.kind !== "filled") return;
    expect(outcome.book.title).toBe("The Odyssey");
    expect(outcome.book.isbn13).toBe("9780140449136");
    expect(outcome.book.status).toBe("wishlist");
    expect(outcome.book.sourceUrl).toBe("https://amazon.in/dp/0140449132");
    expect(claude.read).not.toHaveBeenCalled();
  });

  it("asks Claude when the link carries no usable code", async () => {
    const claude = {
      read: vi.fn(async () => reply(JSON.stringify({
        found: true, title: "Ikigai", authors: ["Héctor García"], publishedYear: 2016,
      }))),
    };

    const outcome = await resolveBookFromLink("https://amzn.eu/d/abc123", claude, emptyBooks);
    expect(claude.read).toHaveBeenCalledOnce();
    expect(outcome.kind).toBe("filled");
    if (outcome.kind !== "filled") return;
    expect(outcome.book.title).toBe("Ikigai");
    expect(outcome.book.status).toBe("wishlist");
    expect(outcome.book.lookup?.provider).toBe("web");
  });

  it("prefers the free databases' metadata over the model's own", async () => {
    const claude = {
      read: async () => reply(JSON.stringify({ found: true, title: "The Odyssey", authors: [] })),
    };
    const books: BookGateway = {
      ...emptyBooks,
      searchTitleOpenLibrary: async () => ({
        docs: [{
          title: "The Odyssey",
          author_name: ["Homer"],
          first_publish_year: 1996,
          isbn: ["0140449132"],
        }],
      }),
    };

    const outcome = await resolveBookFromLink("https://amzn.eu/d/abc", claude, books);
    expect(outcome.kind).toBe("filled");
    if (outcome.kind !== "filled") return;
    // The model gave no author; the database did, and it must survive.
    expect(outcome.book.authors).toEqual(["Homer"]);
  });

  it("says so when the page is not a book", async () => {
    const claude = {
      read: async () => reply(JSON.stringify({ found: false, notABook: true })),
    };
    const outcome = await resolveBookFromLink("https://example.com/kettle", claude, emptyBooks);
    expect(outcome.kind).toBe("not-a-book");
  });

  it("reports a dead end as manual, so the dialog can offer typing instead", async () => {
    const claude = { read: async () => reply(JSON.stringify({ found: false })) };
    const outcome = await resolveBookFromLink("https://amzn.eu/d/abc", claude, emptyBooks);
    expect(outcome.kind).toBe("manual");
  });

  it("reports an unreadable reply as manual rather than crashing", async () => {
    const claude = { read: async () => reply("I could not open that page.") };
    const outcome = await resolveBookFromLink("https://amzn.eu/d/abc", claude, emptyBooks);
    expect(outcome.kind).toBe("manual");
  });

  it("separates a key/quota failure from a genuine miss", async () => {
    const claude = {
      read: async () => { throw Object.assign(new Error("credit balance too low"), { status: 400 }); },
    };
    const outcome = await resolveBookFromLink("https://amzn.eu/d/abc", claude, emptyBooks);
    expect(outcome.kind).toBe("unavailable");
    if (outcome.kind !== "unavailable") return;
    expect(outcome.reason).toContain("credit balance too low");
    expect(outcome.auth).toBe(false);
  });

  it("flags an auth failure so Settings can surface it", async () => {
    const claude = {
      read: async () => { throw Object.assign(new Error("invalid key"), { status: 401 }); },
    };
    const outcome = await resolveBookFromLink("https://amzn.eu/d/abc", claude, emptyBooks);
    expect(outcome.kind === "unavailable" && outcome.auth).toBe(true);
  });
});
