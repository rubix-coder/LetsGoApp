// @vitest-environment node
/* The sigil token grammar that lets a note carry every task field.

   Two properties matter more than any individual token:
   1. A malformed token degrades to literal title text — never throws, never
      half-applies. The right-to-left scan simply stops.
   2. format ∘ parse is a fixpoint, so export → import loses nothing. */
import { describe, expect, it } from "vitest";
import {
  fmtMetaDate,
  fmtMetaDuration,
  formatTaskMeta,
  META_FIELDS,
  nextMetaHint,
  newMdKey,
  parseMetaDate,
  parseMetaDuration,
  parseTaskMeta,
  splitMetaTail,
} from "./taskMeta";
import type { Task } from "./types";

const at = (y: number, mo: number, d: number, h = 0, mi = 0): number => new Date(y, mo - 1, d, h, mi).getTime();

function task(patch: Partial<Task> & Pick<Task, "title">): Task {
  return { id: "t1", status: "pending", priority: 2, tags: [], createdAt: 0, loggedMin: 0, ...patch };
}

describe("parseTaskMeta — individual tokens", () => {
  it("reads a priority", () => {
    const { title, meta } = parseTaskMeta("Ship the pipeline !P0");
    expect(title).toBe("Ship the pipeline");
    expect(meta.priority).toBe(0);
  });

  it("accumulates tags in written order", () => {
    const { title, meta } = parseTaskMeta("Ship it #work #deep-focus #q3/planning");
    expect(title).toBe("Ship it");
    expect(meta.tags).toEqual(["work", "deep-focus", "q3/planning"]);
  });

  it("reads an estimate in every duration form", () => {
    expect(parseTaskMeta("A ~90m").meta.estimateMin).toBe(90);
    expect(parseTaskMeta("A ~2h").meta.estimateMin).toBe(120);
    expect(parseTaskMeta("A ~1h30m").meta.estimateMin).toBe(90);
    expect(parseTaskMeta("A ~45").meta.estimateMin).toBe(45);
  });

  it("reads a dated token whose value contains a space", () => {
    const { title, meta } = parseTaskMeta("Write it @start(2026-08-04 09:00)");
    expect(title).toBe("Write it");
    expect(meta.scheduledAt).toBe(at(2026, 8, 4, 9, 0));
  });

  it("reads a date-only value as local midnight", () => {
    expect(parseTaskMeta("A @due(2026-08-06)").meta.deadline).toBe(at(2026, 8, 6));
  });

  it("reads a repeat rule", () => {
    expect(parseTaskMeta("A @every(1d)").meta.repeat).toEqual({ interval: 1, unit: "daily" });
    expect(parseTaskMeta("A @every(2w)").meta.repeat).toEqual({ interval: 2, unit: "weekly" });
    expect(parseTaskMeta("A @every(3m)").meta.repeat).toEqual({ interval: 3, unit: "monthly" });
  });

  it("reads the bare lock token, and its explicit off form", () => {
    expect(parseTaskMeta("A @lock").meta.locked).toBe(true);
    expect(parseTaskMeta("A @lock(off)").meta.locked).toBe(false);
  });

  it("reads an id and dependency references", () => {
    const { title, meta } = parseTaskMeta("Wire it @after(Draft the schema) @id(c9m4)");
    expect(title).toBe("Wire it");
    expect(meta.id).toBe("c9m4");
    expect(meta.after).toEqual(["Draft the schema"]);
  });

  it("splits a comma-separated @after list", () => {
    expect(parseTaskMeta("A @after(Draft, Review)").meta.after).toEqual(["Draft", "Review"]);
  });

  it("reads a trailing comment", () => {
    const { title, meta } = parseTaskMeta("Ship it !P1 // waiting on Priya");
    expect(title).toBe("Ship it");
    expect(meta.priority).toBe(1);
    expect(meta.comment).toBe("waiting on Priya");
  });

  it("reads a full tail in one go", () => {
    const { title, meta } = parseTaskMeta(
      "Ship the export pipeline !P0 #work @start(2026-08-04 09:00) ~90m @lock @id(a7x2) // ask Priya",
    );
    expect(title).toBe("Ship the export pipeline");
    expect(meta).toMatchObject({
      priority: 0, tags: ["work"], estimateMin: 90,
      scheduledAt: at(2026, 8, 4, 9, 0), locked: true, id: "a7x2", comment: "ask Priya",
    });
  });
});

describe("parseTaskMeta — degrading safely", () => {
  it("stops at the first malformed token and leaves it in the title", () => {
    // The date is unreadable, so the scan stops there — !P0 to its RIGHT was
    // already consumed, @start stays as text.
    const { title, meta } = parseTaskMeta("Deploy @start(nope) !P0");
    expect(title).toBe("Deploy @start(nope)");
    expect(meta.priority).toBe(0);
    expect(meta.scheduledAt).toBeUndefined();
  });

  it("leaves an unknown @key(...) as literal text", () => {
    const { title, meta } = parseTaskMeta("Check the thing @frobnicate(x)");
    expect(title).toBe("Check the thing @frobnicate(x)");
    expect(meta).toEqual({});
  });

  it("never treats an issue number as a tag", () => {
    // The single most likely false positive; #tag must start with a letter.
    expect(parseTaskMeta("review PR #3").title).toBe("review PR #3");
    expect(parseTaskMeta("review PR #3").meta.tags).toBeUndefined();
    expect(parseTaskMeta("bug #42").title).toBe("bug #42");
  });

  it("lets backticks escape a token", () => {
    expect(parseTaskMeta("review PR `#work`").title).toBe("review PR `#work`");
  });

  it("does not mistake a URL for a comment", () => {
    const { title, meta } = parseTaskMeta("Read https://example.com/a//b");
    expect(title).toBe("Read https://example.com/a//b");
    expect(meta.comment).toBeUndefined();
  });

  it("ignores a token that is only part of a word", () => {
    expect(parseTaskMeta("email me@example.com").title).toBe("email me@example.com");
    expect(parseTaskMeta("cost is ~90m or so").title).toBe("cost is ~90m or so");
  });

  it("returns the whole string as the title when there is no tail", () => {
    const { title, meta, tail } = parseTaskMeta("Just a plain task");
    expect(title).toBe("Just a plain task");
    expect(meta).toEqual({});
    expect(tail).toBe("");
  });

  it("survives an empty title made only of tokens", () => {
    const { title, meta } = parseTaskMeta("!P0 #work");
    expect(title).toBe("");
    expect(meta.priority).toBe(0);
  });

  it("never throws, whatever it is handed", () => {
    const nasty = [
      "", "   ", "!P", "!P9", "#", "#!", "~", "~h", "~m", "@", "@start", "@start(", "@start()",
      "@every()", "@every(0d)", "@every(1y)", "@id()", "@after()", "//", "// ", "@lock(", "@lock(x)",
      "a ~~90m", "@start(2026-13-45)", "@start(2026-08-04 99:99)", "((((", "))))", "#a#b",
      "@start(2026-08-04 09:00) @start(2026-08-05 10:00)", "\\#work", "task\ttabbed !P1",
    ];
    for (const input of nasty) expect(() => parseTaskMeta(input)).not.toThrow();
  });

  it("rejects out-of-range dates and times rather than guessing", () => {
    expect(parseTaskMeta("A @due(2026-13-01)").meta.deadline).toBeUndefined();
    expect(parseTaskMeta("A @start(2026-08-04 25:00)").meta.scheduledAt).toBeUndefined();
  });

  it("takes the LAST of a repeated token, since the scan runs right to left", () => {
    expect(parseTaskMeta("A !P3 !P0").meta.priority).toBe(0);
  });
});

describe("splitMetaTail", () => {
  it("hands renderers the title and the raw tail separately", () => {
    const { text, tail } = splitMetaTail("Ship it !P0 #work @id(a7x2)");
    expect(text).toBe("Ship it");
    expect(tail).toBe("!P0 #work @id(a7x2)");
  });

  it("gives an empty tail when there is no metadata", () => {
    expect(splitMetaTail("Plain task")).toEqual({ text: "Plain task", tail: "" });
  });
});

describe("formatTaskMeta", () => {
  it("emits tokens in canonical order", () => {
    const t = task({
      title: "Ship it", priority: 0, tags: ["work", "q3"], estimateMin: 90,
      scheduledAt: at(2026, 8, 4, 9, 0), deadline: at(2026, 8, 6), locked: true,
      repeat: { interval: 1, unit: "weekly" }, comment: "ask Priya",
    });
    expect(formatTaskMeta(t, { id: "a7x2", after: ["Draft the schema"] })).toBe(
      " !P0 #work #q3 ~90m @start(2026-08-04 09:00) @due(2026-08-06) @every(1w) @lock" +
      " @after(Draft the schema) @id(a7x2) // ask Priya",
    );
  });

  it("omits the default priority so tails stay short", () => {
    expect(formatTaskMeta(task({ title: "A" }), { id: "k1" })).toBe(" @id(k1)");
  });

  it("writes a date-only value when the time is local midnight", () => {
    const t = task({ title: "A", deadline: at(2026, 8, 6) });
    expect(formatTaskMeta(t, { id: "k1" })).toContain("@due(2026-08-06)");
  });
});

describe("format ∘ parse is a fixpoint", () => {
  const cases: Task[] = [
    task({ title: "Bare task" }),
    task({ title: "Priority only", priority: 3 }),
    task({ title: "Tags only", tags: ["work", "deep-focus"] }),
    task({ title: "Estimate", estimateMin: 45 }),
    task({ title: "Scheduled", scheduledAt: at(2026, 8, 4, 9, 30) }),
    task({ title: "Midnight start", scheduledAt: at(2026, 8, 4) }),
    task({ title: "Deadline", deadline: at(2026, 12, 31, 23, 59) }),
    task({ title: "Routine", repeat: { interval: 2, unit: "monthly" }, scheduledAt: at(2026, 8, 4, 7, 0) }),
    task({ title: "Locked", locked: true }),
    task({ title: "Commented", comment: "waiting on the API key" }),
    task({
      title: "Everything at once", priority: 1, tags: ["a", "b"], estimateMin: 150,
      scheduledAt: at(2026, 8, 4, 9, 0), deadline: at(2026, 8, 10), locked: true,
      repeat: { interval: 3, unit: "daily" }, comment: "all of it",
    }),
  ];

  for (const original of cases) {
    it(`round-trips "${original.title}"`, () => {
      const line = original.title + formatTaskMeta(original, { id: "zz99" });
      const { title, meta } = parseTaskMeta(line);

      expect(title).toBe(original.title);
      expect(meta.id).toBe("zz99");
      expect(meta.priority ?? 2).toBe(original.priority);
      expect(meta.tags ?? []).toEqual(original.tags);
      expect(meta.estimateMin).toBe(original.estimateMin);
      expect(meta.scheduledAt).toBe(original.scheduledAt);
      expect(meta.deadline).toBe(original.deadline);
      expect(meta.repeat).toEqual(original.repeat);
      expect(meta.locked).toBe(original.locked);
      expect(meta.comment).toBe(original.comment);
    });
  }

  it("re-serialises to a byte-identical line", () => {
    const original = cases[cases.length - 1];
    const once = original.title + formatTaskMeta(original, { id: "zz99" });
    const { title, meta } = parseTaskMeta(once);
    const rebuilt = title + formatTaskMeta(
      { ...original, ...meta, tags: meta.tags ?? [] } as Task,
      { id: meta.id! },
    );
    expect(rebuilt).toBe(once);
  });
});

describe("nextMetaHint — guided entry", () => {
  const NOW = at(2026, 7, 30, 14, 22);

  it("offers priority first on a bare task line", () => {
    const hint = nextMetaHint("Ship the pipeline", [], NOW)!;
    expect(hint.field).toBe("priority");
    expect(hint.ghost).toBe("!P1");
  });

  it("stays quiet until the line has a title", () => {
    expect(nextMetaHint("", [], NOW)).toBeUndefined();
    expect(nextMetaHint("   ", [], NOW)).toBeUndefined();
  });

  it("walks past fields the line already states", () => {
    expect(nextMetaHint("Ship it !P0", [], NOW)!.field).toBe("tags");
    expect(nextMetaHint("Ship it !P0 #work", [], NOW)!.field).toBe("estimate");
    expect(nextMetaHint("Ship it !P0 #work ~90m", [], NOW)!.field).toBe("start");
  });

  it("walks past fields the user has skipped", () => {
    expect(nextMetaHint("Ship it", ["priority"], NOW)!.field).toBe("tags");
    expect(nextMetaHint("Ship it", ["priority", "tags", "estimate"], NOW)!.field).toBe("start");
  });

  it("runs out once everything is stated or skipped", () => {
    const all = ["priority", "tags", "estimate", "start", "due", "repeat", "lock", "comment"] as const;
    expect(nextMetaHint("Ship it", all, NOW)).toBeUndefined();
  });

  it("suggests today at 09:00 for a start, and today's date for a deadline", () => {
    expect(nextMetaHint("Ship it", ["priority", "tags", "estimate"], NOW)!.ghost)
      .toBe("@start(2026-07-30 09:00)");
    expect(nextMetaHint("Ship it", ["priority", "tags", "estimate", "start"], NOW)!.ghost)
      .toBe("@due(2026-07-30)");
  });

  it("inserts only the sigil where no default could be right", () => {
    const tags = nextMetaHint("Ship it", ["priority"], NOW)!;
    expect(tags.ghost).toBe("#tag");
    expect(tags.insert).toBe("#");           // never invents a tag name

    const comment = nextMetaHint("Ship it", ["priority", "tags", "estimate", "start", "due", "repeat", "lock"], NOW)!;
    expect(comment.insert).toBe("// ");
  });

  it("produces a canonical line when every suggestion is accepted in turn", () => {
    // Accepting suggestions blindly must build a line the parser reads back
    // exactly, in the same order formatTaskMeta would have written.
    let line = "Ship it";
    for (let step = 0; step < META_FIELDS.length; step++) {
      const hint = nextMetaHint(line, [], NOW);
      if (!hint) break;
      // "#" and "// " need a value typed; simulate the user doing so.
      const filled = hint.insert === "#" ? "#work" : hint.insert === "// " ? "// ask Priya" : hint.insert;
      line = `${line} ${filled}`;
    }
    const { title, meta } = parseTaskMeta(line);
    expect(title).toBe("Ship it");
    expect(meta).toMatchObject({
      priority: 1, tags: ["work"], estimateMin: 30,
      scheduledAt: at(2026, 7, 30, 9, 0), deadline: at(2026, 7, 30),
      repeat: { interval: 1, unit: "daily" }, locked: true, comment: "ask Priya",
    });
    expect(nextMetaHint(line, [], NOW)).toBeUndefined();
  });

  it("stops suggesting entirely once a comment is open", () => {
    // A comment runs to end of line, so an appended token would land INSIDE it.
    expect(nextMetaHint("Ship it // ", [], NOW)).toBeUndefined();
    expect(nextMetaHint("Ship it !P0 // waiting on Priya", [], NOW)).toBeUndefined();
  });

  it("still offers the comment last, when nothing else is left", () => {
    const before = ["priority", "tags", "estimate", "start", "due", "repeat", "lock"] as const;
    expect(nextMetaHint("Ship it ", before, NOW)!.field).toBe("comment");
  });

  it("does not offer @id — that is machine-written", () => {
    expect(META_FIELDS).not.toContain("id");
  });
});

describe("value helpers", () => {
  it("parses and formats durations symmetrically", () => {
    expect(fmtMetaDuration(90)).toBe("90m");
    expect(parseMetaDuration("90m")).toBe(90);
    expect(parseMetaDuration("1h30m")).toBe(90);
    expect(parseMetaDuration("2h")).toBe(120);
    expect(parseMetaDuration("45")).toBe(45);
    expect(parseMetaDuration("")).toBeUndefined();
    expect(parseMetaDuration("h")).toBeUndefined();
    expect(parseMetaDuration("-5m")).toBeUndefined();
  });

  it("parses and formats dates symmetrically", () => {
    expect(fmtMetaDate(at(2026, 8, 4))).toBe("2026-08-04");
    expect(fmtMetaDate(at(2026, 8, 4, 9, 5))).toBe("2026-08-04 09:05");
    expect(parseMetaDate("2026-08-04")).toBe(at(2026, 8, 4));
    expect(parseMetaDate("2026-08-04 09:05")).toBe(at(2026, 8, 4, 9, 5));
    expect(parseMetaDate("nope")).toBeUndefined();
  });

  it("mints short keys that avoid the ones already taken", () => {
    const taken = new Set(["aaaa", "bbbb"]);
    for (let i = 0; i < 200; i++) {
      const key = newMdKey(taken);
      expect(key).toMatch(/^[a-z0-9]{4}$/);
      expect(taken.has(key)).toBe(false);
      taken.add(key);
    }
  });
});

describe("trailing whitespace does not hide the metadata", () => {
  /* The reported bug. Guided entry only offers a suggestion on a line ending
     in a space — and the tokenizer was anchored hard to `$`, so that very
     space made the whole tail unparseable. The parser was therefore blind at
     exactly the moment the editor asked it what the line already stated, and
     the same field was offered and inserted again and again:

         "TEST "        → offers !P1  → accept → "TEST !P1"
         "TEST !P1 "    → offers !P1  AGAIN    → "TEST !P1 !P1"          */

  it("parses a token followed by one trailing space", () => {
    expect(parseTaskMeta("TEST !P1 ").meta.priority).toBe(1);
    expect(parseTaskMeta("TEST !P1 ").title).toBe("TEST");
  });

  it("parses a token followed by several spaces or a tab", () => {
    expect(parseTaskMeta("TEST !P1   ").meta.priority).toBe(1);
    expect(parseTaskMeta("TEST !P1\t").meta.priority).toBe(1);
  });

  it("parses a whole token tail that ends in a space", () => {
    const { title, meta } = parseTaskMeta("Ship it !P2 #work ~30m ");
    expect(title).toBe("Ship it");
    expect(meta.priority).toBe(2);
    expect(meta.tags).toEqual(["work"]);
    expect(meta.estimateMin).toBe(30);
  });

  it("keyed values survive a trailing space too", () => {
    expect(parseTaskMeta("Ship it @every(1d) ").meta.repeat).toBeTruthy();
    expect(parseTaskMeta("Ship it @lock ").meta.locked).toBe(true);
  });

  it("offers the NEXT field once one is stated, not the same one again", () => {
    const now = Date.now();
    expect(nextMetaHint("TEST ", [], now)!.ghost).toBe("!P1");
    // The line the editor actually holds right after accepting and typing a space.
    expect(nextMetaHint("TEST !P1 ", [], now)!.ghost).toBe("#tag");
    expect(nextMetaHint("TEST !P1 #work ", [], now)!.ghost).toBe("~30m");
  });

  it("never re-offers a field already on the line, however it was spaced", () => {
    const now = Date.now();
    for (const line of ["TEST !P1 ", "TEST !P1  ", "TEST !P1\t"]) {
      expect(nextMetaHint(line, [], now)!.field).not.toBe("priority");
    }
  });

  it("a title that merely ends in a space still gets the first suggestion", () => {
    expect(nextMetaHint("Buy milk ", [], Date.now())!.ghost).toBe("!P1");
  });

  it("does not swallow a trailing space into the title", () => {
    expect(parseTaskMeta("Buy milk ").title).toBe("Buy milk");
  });
});
