// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isBookBarcode, isValidIsbn10, isValidIsbn13, isbn10CheckDigit, isbn13CheckDigit,
  normalizeIsbn, toIsbn10, toIsbn13,
} from "./isbn";

describe("check digits", () => {
  it("computes the ISBN-10 digit", () => {
    expect(isbn10CheckDigit("014044913")).toBe("2");
  });

  it("writes a check value of 10 as X", () => {
    expect(isbn10CheckDigit("080442957")).toBe("X");
  });

  it("computes the ISBN-13 digit", () => {
    expect(isbn13CheckDigit("978014044913")).toBe("6");
  });
});

describe("validation", () => {
  it("accepts real ISBNs", () => {
    expect(isValidIsbn13("9780140449136")).toBe(true);
    expect(isValidIsbn10("0140449132")).toBe(true);
    expect(isValidIsbn10("080442957X")).toBe(true);
  });

  it("rejects a single-digit typo", () => {
    expect(isValidIsbn13("9780140449137")).toBe(false);
    expect(isValidIsbn10("0140449133")).toBe(false);
  });

  it("rejects wrong lengths and non-digits", () => {
    for (const bad of ["", "978014044913", "97801404491366", "abcdefghij", "978-0-14"]) {
      expect(isValidIsbn13(bad)).toBe(false);
      expect(isValidIsbn10(bad)).toBe(false);
    }
  });

  it("only allows X in the final position", () => {
    expect(isValidIsbn10("X140449132")).toBe(false);
  });
});

describe("normalizeIsbn", () => {
  it("strips the punctuation exports and humans add", () => {
    expect(normalizeIsbn("978-0-14-044913-6")).toBe("9780140449136");
    expect(normalizeIsbn("  978 0140449136 ")).toBe("9780140449136");
    expect(normalizeIsbn("0-14-044913-2")).toBe("0140449132");
  });

  it("upper-cases a lowercase x check digit", () => {
    expect(normalizeIsbn("080442957x")).toBe("080442957X");
  });

  it("is null for anything that is not an ISBN", () => {
    for (const bad of ["", "hello", "1234567890123", "12345678901"]) {
      expect(normalizeIsbn(bad)).toBeNull();
    }
  });
});

describe("conversion", () => {
  it("round-trips ISBN-10 → 13 → 10", () => {
    const thirteen = toIsbn13("0140449132");
    expect(thirteen).toBe("9780140449136");
    expect(toIsbn10(thirteen!)).toBe("0140449132");
  });

  it("preserves an X check digit through the round trip", () => {
    const thirteen = toIsbn13("080442957X");
    expect(isValidIsbn13(thirteen!)).toBe(true);
    expect(toIsbn10(thirteen!)).toBe("080442957X");
  });

  it("passes an ISBN-13 through unchanged", () => {
    expect(toIsbn13("9780140449136")).toBe("9780140449136");
  });

  it("converts a hyphenated input", () => {
    expect(toIsbn13("0-14-044913-2")).toBe("9780140449136");
  });

  it("has no ISBN-10 for a 979-prefixed ISBN-13 — that range has none", () => {
    expect(isValidIsbn13("9791234567896")).toBe(true);
    expect(toIsbn10("9791234567896")).toBeNull();
  });

  it("is null for junk", () => {
    expect(toIsbn13("nope")).toBeNull();
    expect(toIsbn10("nope")).toBeNull();
  });
});

describe("isBookBarcode — a shelf holds more than books", () => {
  it("accepts a 978 and a 979 EAN-13", () => {
    expect(isBookBarcode("9780140449136", "ean_13")).toBe(true);
    expect(isBookBarcode("9791234567896", "ean_13")).toBe(true);
  });

  it("rejects a 12-digit UPC-A — boxed sets carry these", () => {
    expect(isBookBarcode("012345678905", "upc_a")).toBe(false);
  });

  it("rejects a 977-prefixed EAN — that is a magazine's ISSN", () => {
    // Valid EAN-13 checksum, wrong prefix: the check digit alone cannot
    // distinguish a magazine from a book, which is why the prefix is tested.
    expect(isBookBarcode("9771234567003", "ean_13")).toBe(false);
  });

  it("rejects an EAN-5 price add-on printed beside the ISBN", () => {
    expect(isBookBarcode("52999", "ean_13")).toBe(false);
  });

  it("rejects a QR code even when it contains a valid ISBN", () => {
    expect(isBookBarcode("9780140449136", "qr_code")).toBe(false);
  });

  it("rejects a 978 barcode whose checksum is wrong", () => {
    expect(isBookBarcode("9780140449137", "ean_13")).toBe(false);
  });
});
