/* Identifying a book from a photograph of its cover.

   The last resort, and the only one that reaches the books nothing else can.
   A regional edition whose ISBN was never registered with Open Library or
   Google Books is invisible to every free database at any price tier — but
   the title and author are printed on the front of it, which is exactly what
   a vision model is good at reading.

   Split the usual way: the prompt, the parsing and the merge live here and
   are tested; the HTTP call lives in claudeApi.ts and is not. */

import type { LookupResult } from "./bookLookup";
import { toIsbn13 } from "./isbn";

/** Long edge of the JPEG sent to the model.

    A cover only has to be legible, not archival. 1200px reads small print on
    a paperback spine while keeping one image near ~1,600 tokens — at four
    hundred books the difference between this and a full-resolution frame is
    the difference between a few dollars and a few tens of dollars. */
export const MAX_IMAGE_EDGE = 1200;

export const VISION_PROMPT = `You are looking at a photograph of a book — usually the front cover, sometimes the title page or the copyright page.

Identify the book and reply with ONLY a JSON object, no prose and no code fences:

{"title": string, "authors": string[], "publisher": string|null, "publishedYear": number|null, "isbn13": string|null, "confidence": "high"|"low"}

Rules:
- "title" is the book's actual title, without any series name, edition note or tagline.
- "authors" are people, never the publisher or an imprint. Use the order printed on the cover.
- Set "isbn13" only if you can actually READ the digits in the image. Never guess or reconstruct one — a wrong ISBN is worse than none, because it silently attaches this record to a different book.
- "publishedYear" is the year of THIS edition if it is printed, otherwise null. Do not infer it.
- Use "low" confidence if the image is blurred, cropped, at a steep angle, or you are unsure of the title.
- If the image is not a book at all, reply exactly: {"notABook": true}`;

/** The subset of the Messages API this needs. Kept narrow so the gateway can
    be faked in tests without modelling the whole API. */
export interface VisionGateway {
  identify(imageBase64: string, mediaType: string): Promise<unknown>;
}

export interface VisionOutcome {
  kind: "found" | "not-a-book" | "unreadable";
  result?: LookupResult;
  /** Set when the model flagged its own answer as shaky — the UI shows the
      fields for checking rather than applying them silently. */
  lowConfidence?: boolean;
  reason?: string;
}

/** Digs the assistant's text out of a Messages API response.

    Defensive because this is parsing someone else's JSON over a network: any
    shape that is not what we expect becomes null rather than an exception. */
export function textFromMessage(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const content = (json as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "object" && block !== null) {
      const b = block as { type?: unknown; text?: unknown };
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    }
  }
  return parts.length > 0 ? parts.join("") : null;
}

/** Pulls the JSON object out of the reply.

    Models are asked for bare JSON and usually comply, but a stray ```json
    fence or a sentence of preamble is common enough that failing on it would
    make the feature flaky for no reason. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Turns the model's object into the same LookupResult the ISBN path
    produces, so everything downstream is unchanged. */
export function mapVision(json: unknown): VisionOutcome {
  if (typeof json !== "object" || json === null) {
    return { kind: "unreadable", reason: "The model's reply could not be read." };
  }
  const o = json as Record<string, unknown>;
  if (o.notABook === true) return { kind: "not-a-book" };

  const title = cleanString(o.title);
  if (!title) return { kind: "unreadable", reason: "No title could be read from the photo." };

  const authors = Array.isArray(o.authors)
    ? o.authors.map(cleanString).filter((a): a is string => !!a)
    : [];

  // A model-supplied ISBN is only trusted if it is structurally valid. The
  // prompt forbids guessing, but a checksum is what actually enforces it.
  const rawIsbn = cleanString(o.isbn13);
  const isbn13 = rawIsbn ? toIsbn13(rawIsbn) ?? undefined : undefined;

  const year = typeof o.publishedYear === "number" && Number.isFinite(o.publishedYear)
    ? Math.trunc(o.publishedYear)
    : undefined;

  return {
    kind: "found",
    lowConfidence: o.confidence === "low",
    result: {
      title,
      authors,
      publisher: cleanString(o.publisher),
      // A year outside living publishing history is a misread, not a fact.
      publishedYear: year && year > 1400 && year < 2200 ? year : undefined,
      isbn13,
      provider: "vision",
    },
  };
}

/** The whole round trip, gateway-injected so it is testable offline. */
export async function identifyCover(
  imageBase64: string,
  mediaType: string,
  gateway: VisionGateway,
): Promise<VisionOutcome> {
  let raw: unknown;
  try {
    raw = await gateway.identify(imageBase64, mediaType);
  } catch (err) {
    return { kind: "unreadable", reason: err instanceof Error ? err.message : "The request failed." };
  }
  const text = textFromMessage(raw);
  if (text === null) return { kind: "unreadable", reason: "The model returned no text." };
  return mapVision(extractJson(text));
}
