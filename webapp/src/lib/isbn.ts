/* ISBN validation and conversion.

   The scanner leans on this hardest: a shelf holds more than books, and a
   camera pointed at a spine will happily read the UPC on a boxed set or the
   ISSN on a magazine. Everything a barcode produces is filtered through
   `isBookBarcode` before it is allowed anywhere near the library. */

/** ISBN-10's check digit is mod 11, and the value 10 is written "X" — the
    single most commonly mishandled case in ISBN code. */
export function isbn10CheckDigit(first9: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(first9[i]);
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? "X" : String(check);
}

/** ISBN-13 is an EAN-13: mod 10 over alternating weights of 1 and 3. */
export function isbn13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

export function isValidIsbn10(raw: string): boolean {
  const s = raw.toUpperCase();
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  return isbn10CheckDigit(s.slice(0, 9)) === s[9];
}

export function isValidIsbn13(raw: string): boolean {
  if (!/^\d{13}$/.test(raw)) return false;
  return isbn13CheckDigit(raw.slice(0, 12)) === raw[12];
}

/** Strips the punctuation people and exports put in ISBNs, then validates.
    Returns the bare digits, or null if it is not an ISBN at all. */
export function normalizeIsbn(raw: string): string | null {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  if (isValidIsbn13(s) || isValidIsbn10(s)) return s;
  return null;
}

/** Everything is stored as ISBN-13, so this is the funnel every entry point
    goes through — scan, CSV, and manual typing alike. */
export function toIsbn13(raw: string): string | null {
  const s = normalizeIsbn(raw);
  if (!s) return null;
  if (s.length === 13) return s;
  const body = `978${s.slice(0, 9)}`;
  return body + isbn13CheckDigit(body);
}

/** Null for a 979-prefixed ISBN-13: that range has no ISBN-10 equivalent, and
    silently returning something would invent an identifier that does not exist. */
export function toIsbn10(raw: string): string | null {
  const s = normalizeIsbn(raw);
  if (!s) return null;
  if (s.length === 10) return s;
  if (!s.startsWith("978")) return null;
  const body = s.slice(3, 12);
  return body + isbn10CheckDigit(body);
}

/** Whether a barcode the camera read is a book at all.

    A bookshelf is full of things that scan: boxed sets carry a 12-digit UPC-A,
    magazines carry a 977-prefixed EAN (an ISSN), and books often carry a
    5-digit EAN-5 price add-on right beside the ISBN. Accepting any of them
    would put junk in the library that the user then has to find and delete. */
export function isBookBarcode(raw: string, format: string): boolean {
  if (format && !/^ean_13$/i.test(format)) return false;
  const s = raw.replace(/[\s-]/g, "");
  if (!/^\d{13}$/.test(s)) return false;
  if (!s.startsWith("978") && !s.startsWith("979")) return false;
  return isValidIsbn13(s);
}
