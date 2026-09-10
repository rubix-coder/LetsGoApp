// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cardDetailText, detailLinesFor, plainPreview, timeBadge } from "./taskCardMeta";
import type { Task } from "./types";

function task(patch: Partial<Task> = {}): Task {
  return { id: "t", title: "T", status: "pending", priority: 2, tags: [], createdAt: 0, loggedMin: 0, ...patch };
}

describe("detailLinesFor", () => {
  /* The short blocks that make up most of a day must be untouched — this
     feature is about the empty space in a TALL block, and a 30-minute card
     has none to give. */
  it("gives a short card nothing", () => {
    expect(detailLinesFor(26)).toBe(0);   // the minimum card height
    expect(detailLinesFor(40)).toBe(0);
  });

  it("starts showing detail once a line genuinely fits", () => {
    // 10 padding + 16 title + 13 meta = 39 reserved; 13 more buys one line.
    expect(detailLinesFor(51)).toBe(0);
    expect(detailLinesFor(52)).toBe(1);
  });

  it("grows with the block — a two-hour card is mostly detail", () => {
    // Two hours at the desktop default of 54px/hour.
    expect(detailLinesFor(108 - 2)).toBe(5);
  });

  it("stops before a card becomes a document", () => {
    expect(detailLinesFor(10_000)).toBe(12);
  });

  /* Pinned against the real zoom levels, because "it must not look messy on a
     15- or 30-minute task" is the requirement, not a nicety. Card height is
     max(26, minutes/60 * hourH - 2).

     Note the rule is about PIXELS, not minutes: zoomed right in, a 45-minute
     block really is a tall rectangle with room to spare, and refusing it
     detail there would be the same mistake in the other direction. What must
     never happen is text crammed into a card too short to hold it. */
  it.each([
    ["15 min", 15], ["30 min", 30],
  ])("shows nothing on a %s card at any zoom", (_label, minutes) => {
    for (const hourH of [30, 40, 54, 60, 80, 100]) {
      const height = Math.max(26, (minutes / 60) * hourH - 2);
      expect(detailLinesFor(height)).toBe(0);
    }
  });

  it("only opens up once a block is comfortably an hour at normal zoom", () => {
    expect(detailLinesFor(Math.max(26, 54 - 2))).toBe(1);
  });

  it("gives a line only to cards that can actually hold one, at every zoom", () => {
    for (const hourH of [30, 40, 54, 60, 80, 100]) {
      for (const minutes of [15, 30, 45, 60, 90, 120]) {
        const height = Math.max(26, (minutes / 60) * hourH - 2);
        // The invariant: text is offered only when the pixels are there for
        // it, and what is offered always fits inside the card.
        const lines = detailLinesFor(height);
        if (lines > 0) expect(height).toBeGreaterThanOrEqual(52);
        expect(39 + lines * 13).toBeLessThanOrEqual(Math.max(39, height));
      }
    }
  });

  /* A card with a lineage tag grows 18px of body padding on hover. Budgeting
     for it costs a line and buys text that never moves under the pointer. */
  it("reserves space a card can lose while being looked at", () => {
    expect(detailLinesFor(108, 0)).toBe(5);
    expect(detailLinesFor(108, 18)).toBe(3);
  });

  it("never returns a negative line count for a degenerate height", () => {
    expect(detailLinesFor(0)).toBe(0);
    expect(detailLinesFor(-50)).toBe(0);
  });
});

describe("plainPreview", () => {
  it("keeps line structure, so a checklist still reads as a checklist", () => {
    expect(plainPreview("- Warm up\n- Two Sum\n- Valid Anagram"))
      .toBe("• Warm up\n• Two Sum\n• Valid Anagram");
  });

  it("keeps numbered lists numbered", () => {
    expect(plainPreview("1. First\n2) Second")).toBe("1. First\n2. Second");
  });

  it("drops blank lines — vertical space is the scarce thing here", () => {
    expect(plainPreview("One\n\n\nTwo")).toBe("One\nTwo");
  });

  it("strips the markers a full renderer would have consumed", () => {
    expect(plainPreview("## Block 4")).toBe("Block 4");
    expect(plainPreview("**bold** and _italic_ and ~~gone~~")).toBe("bold and italic and gone");
    expect(plainPreview("run `pnpm test` now")).toBe("run pnpm test now");
    expect(plainPreview("> quoted")).toBe("quoted");
  });

  it("shows a wikilink's text rather than its brackets", () => {
    expect(plainPreview("see [[DSA Plan]]")).toBe("see DSA Plan");
    expect(plainPreview("see [[DSA Plan|the plan]]")).toBe("see the plan");
    expect(plainPreview("see [the plan](https://x.example)")).toBe("see the plan");
  });

  it("drops a horizontal rule, which is a device with no text", () => {
    expect(plainPreview("One\n---\nTwo")).toBe("One\nTwo");
  });

  it("is empty for empty input rather than throwing", () => {
    expect(plainPreview("")).toBe("");
    expect(plainPreview("\n\n")).toBe("");
  });
});

describe("cardDetailText", () => {
  it("uses the description when that is all there is", () => {
    expect(cardDetailText(task({ description: "Ch 5 Arrays" }))).toBe("Ch 5 Arrays");
  });

  it("uses the comment when that is all there is", () => {
    expect(cardDetailText(task({ comment: "waiting on Priya" }))).toBe("waiting on Priya");
  });

  /* The scratch line is the newer, more situational of the two, and it is
     what changes the decision about whether to start now. */
  it("leads with the comment when a task carries both", () => {
    expect(cardDetailText(task({ comment: "blocked by the API key", description: "Ch 5 Arrays" })))
      .toBe("blocked by the API key\nCh 5 Arrays");
  });

  it("is empty when the task carries neither, and for whitespace-only text", () => {
    expect(cardDetailText(task())).toBe("");
    expect(cardDetailText(task({ description: "   \n  " }))).toBe("");
  });
});

describe("timeBadge", () => {
  it("says nothing at all for a task with no estimate and no time logged", () => {
    expect(timeBadge(task(), 0)).toBeNull();
  });

  it("shows a bare estimate before any work has started", () => {
    expect(timeBadge(task({ estimateMin: 60 }), 0)).toMatchObject({
      text: "~1h", frac: 0, over: false, started: false,
    });
  });

  /* The badge sits inline on the title row of a card that may be a seventh of
     a screen wide, so a whole number of hours drops fmtMin's alignment
     padding: those three characters are the difference between a readable
     title and an ellipsis. */
  it("drops the padded minutes for a whole number of hours", () => {
    expect(timeBadge(task({ estimateMin: 120 }), 0)!.text).toBe("~2h");
    expect(timeBadge(task({ estimateMin: 90 }), 0)!.text).toBe("~1h 30m");
    expect(timeBadge(task({ estimateMin: 45 }), 0)!.text).toBe("~45m");
  });

  it("shows elapsed against estimate once the clock has run", () => {
    expect(timeBadge(task({ estimateMin: 60 }), 25)).toMatchObject({
      text: "25m / 1h", over: false, started: true,
    });
    expect(timeBadge(task({ estimateMin: 60 }), 25)!.frac).toBeCloseTo(25 / 60);
  });

  it("flags an overrun without letting the fill spill past its own edge", () => {
    const badge = timeBadge(task({ estimateMin: 30 }), 45)!;
    expect(badge.text).toBe("45m / 30m");
    expect(badge.over).toBe(true);
    expect(badge.frac).toBe(1);
  });

  it("shows elapsed alone when the task was never estimated", () => {
    expect(timeBadge(task(), 12)).toMatchObject({ text: "12m", frac: null, started: true });
  });

  it("rounds to the minute — a card is glanced at, not read", () => {
    expect(timeBadge(task(), 12.4)!.text).toBe("12m");
    expect(timeBadge(task(), 12.6)!.text).toBe("13m");
  });

  it("treats a sub-minute run as not started, so a fresh click adds no noise", () => {
    expect(timeBadge(task(), 0.2)).toBeNull();
  });
});
