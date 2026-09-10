// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractJson, identifyCover, mapVision, textFromMessage, type VisionGateway } from "./coverVision";

/** A Messages API response carrying `text` as its only content block. */
const reply = (text: string) => ({
  id: "msg_1", type: "message", role: "assistant",
  content: [{ type: "text", text }],
});

describe("textFromMessage", () => {
  it("reads the assistant's text", () => {
    expect(textFromMessage(reply("hello"))).toBe("hello");
  });

  it("joins multiple text blocks", () => {
    expect(textFromMessage({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("ab");
  });

  it("ignores non-text blocks rather than crashing", () => {
    expect(textFromMessage({ content: [{ type: "thinking" }, { type: "text", text: "x" }] })).toBe("x");
  });

  it("returns null for shapes that are not a message", () => {
    expect(textFromMessage(null)).toBe(null);
    expect(textFromMessage({})).toBe(null);
    expect(textFromMessage({ content: "not an array" })).toBe(null);
    expect(textFromMessage({ content: [] })).toBe(null);
  });
});

describe("extractJson", () => {
  it("parses a bare object", () => {
    expect(extractJson('{"title":"Dune"}')).toEqual({ title: "Dune" });
  });

  it("unwraps a fenced block", () => {
    expect(extractJson('```json\n{"title":"Dune"}\n```')).toEqual({ title: "Dune" });
    expect(extractJson('```\n{"title":"Dune"}\n```')).toEqual({ title: "Dune" });
  });

  it("survives a sentence of preamble", () => {
    expect(extractJson('Here is the book:\n{"title":"Dune"}')).toEqual({ title: "Dune" });
  });

  it("returns null for unparseable text", () => {
    expect(extractJson("I could not read this cover.")).toBe(null);
    expect(extractJson('{"title": broken')).toBe(null);
    expect(extractJson("")).toBe(null);
  });
});

describe("mapVision", () => {
  it("maps a full answer", () => {
    const out = mapVision({
      title: "Dune", authors: ["Frank Herbert"], publisher: "Ace",
      publishedYear: 1965, isbn13: "9780441013593", confidence: "high",
    });
    expect(out.kind).toBe("found");
    expect(out.result).toMatchObject({
      title: "Dune", authors: ["Frank Herbert"], publisher: "Ace",
      publishedYear: 1965, isbn13: "9780441013593", provider: "vision",
    });
    expect(out.lowConfidence).toBe(false);
  });

  it("flags a low-confidence read", () => {
    expect(mapVision({ title: "Dune", confidence: "low" }).lowConfidence).toBe(true);
  });

  it("recognises a photo that is not a book", () => {
    expect(mapVision({ notABook: true }).kind).toBe("not-a-book");
  });

  it("rejects an answer with no title", () => {
    expect(mapVision({ authors: ["X"] }).kind).toBe("unreadable");
    expect(mapVision({ title: "   " }).kind).toBe("unreadable");
  });

  it("discards an invented ISBN that fails its checksum", () => {
    /* The prompt forbids guessing, but the checksum is what enforces it — a
       wrong ISBN would silently attach this record to a different book. */
    const out = mapVision({ title: "Dune", isbn13: "9780441013594" });
    expect(out.result?.isbn13).toBe(undefined);
    expect(out.result?.title).toBe("Dune");
  });

  it("keeps a valid ISBN and normalises a hyphenated one", () => {
    expect(mapVision({ title: "D", isbn13: "978-0-441-01359-3" }).result?.isbn13).toBe("9780441013593");
  });

  it("drops an implausible year rather than storing it", () => {
    expect(mapVision({ title: "D", publishedYear: 12 }).result?.publishedYear).toBe(undefined);
    expect(mapVision({ title: "D", publishedYear: 1965 }).result?.publishedYear).toBe(1965);
  });

  it("ignores a year that came back as a string", () => {
    expect(mapVision({ title: "D", publishedYear: "1965" }).result?.publishedYear).toBe(undefined);
  });

  it("filters junk out of the authors array", () => {
    expect(mapVision({ title: "D", authors: ["A", "", null, 7, "  "] }).result?.authors).toEqual(["A"]);
  });

  it("copes with authors that are not an array at all", () => {
    expect(mapVision({ title: "D", authors: "Frank Herbert" }).result?.authors).toEqual([]);
  });

  it("treats a null or non-object reply as unreadable", () => {
    expect(mapVision(null).kind).toBe("unreadable");
    expect(mapVision("nope").kind).toBe("unreadable");
  });
});

describe("identifyCover", () => {
  const gatewayReturning = (value: unknown): VisionGateway => ({ identify: async () => value });

  it("round-trips a good answer", async () => {
    const out = await identifyCover("x", "image/jpeg", gatewayReturning(reply('{"title":"Dune"}')));
    expect(out.kind).toBe("found");
    expect(out.result?.title).toBe("Dune");
  });

  it("reports a network failure as unreadable rather than throwing", async () => {
    const gateway: VisionGateway = { identify: async () => { throw new Error("offline"); } };
    const out = await identifyCover("x", "image/jpeg", gateway);
    expect(out.kind).toBe("unreadable");
    expect(out.reason).toBe("offline");
  });

  it("reports a reply with no text block", async () => {
    const out = await identifyCover("x", "image/jpeg", gatewayReturning({ content: [] }));
    expect(out.kind).toBe("unreadable");
  });

  it("reports prose that carries no JSON", async () => {
    const out = await identifyCover("x", "image/jpeg", gatewayReturning(reply("I cannot tell.")));
    expect(out.kind).toBe("unreadable");
  });
});
