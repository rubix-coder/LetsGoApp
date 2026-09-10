import { describe, expect, it } from "vitest";
import {
  applyTemplateToNote,
  availableTemplates,
  buildNoteTemplate,
  isNoteEmpty,
  NOTE_TEMPLATES,
  starterCustomTemplate,
  type NoteTemplate,
} from "./noteTemplates";
import { parseBlocks, serializeBlocks } from "./noteBlocks";

/** A fixed instant so the daily template's date stamp is deterministic. */
const AT = new Date("2026-07-26T09:00:00").getTime();

describe("noteTemplates", () => {
  it("lists blank first — it is the default", () => {
    // The full roster is pinned in "the added templates" below; what matters
    // here is only that the fallback comes first in the picker.
    expect(NOTE_TEMPLATES[0].id).toBe<NoteTemplate>("blank");
    expect(NOTE_TEMPLATES.map((t) => t.id)).toContain<NoteTemplate>("daily");
  });

  it("blank reproduces the classic empty note", () => {
    const { title, body } = buildNoteTemplate("blank", AT);
    expect(title).toBe("Untitled");
    expect(body).toBe("# Untitled\n\n");
  });

  it("daily builds the 'Today' planner with every section from the reference", () => {
    const { title, body } = buildNoteTemplate("daily", AT);
    expect(title.startsWith("Today")).toBe(true);
    // The five labelled sections of the paper planner, in order.
    expect(body).toContain("## Checklist");
    expect(body).toContain("## Top 3 Priorities");
    expect(body).toContain("## For Tomorrow");
    expect(body).toContain("## Don't Forget");
    expect(body).toContain("## Notes");
    const checklist = body.indexOf("## Checklist");
    const priorities = body.indexOf("## Top 3 Priorities");
    const tomorrow = body.indexOf("## For Tomorrow");
    const forget = body.indexOf("## Don't Forget");
    const notes = body.indexOf("## Notes");
    expect(checklist).toBeLessThan(priorities);
    expect(priorities).toBeLessThan(tomorrow);
    expect(tomorrow).toBeLessThan(forget);
    expect(forget).toBeLessThan(notes);
  });

  it("daily seeds empty checkbox rows so the boxes render immediately", () => {
    const { body } = buildNoteTemplate("daily", AT);
    expect(body).toMatch(/- \[ \] /);
    // Exactly three priority slots, mirroring "Top 3".
    const prioBlock = body.slice(body.indexOf("## Top 3 Priorities"), body.indexOf("## For Tomorrow"));
    expect(prioBlock.match(/- \[ \]/g)?.length).toBe(3);
  });

  it("the daily title and the body heading agree, so the sidebar name matches", () => {
    const { title, body } = buildNoteTemplate("daily", AT);
    // NotesScreen derives the title from the first "# " line on later edits.
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    expect(heading).toBe(title);
  });

  it("the daily date stamp tracks the supplied instant", () => {
    const a = buildNoteTemplate("daily", new Date("2026-01-02T09:00:00").getTime());
    const b = buildNoteTemplate("daily", new Date("2026-12-31T09:00:00").getTime());
    expect(a.title).not.toBe(b.title);
  });

  it("falls back to blank for an unknown template id", () => {
    const { title, body } = buildNoteTemplate("mystery" as NoteTemplate, AT);
    expect(title).toBe("Untitled");
    expect(body).toBe("# Untitled\n\n");
  });
});

describe("the added templates", () => {
  const NOW = new Date(2026, 6, 30, 9, 0).getTime();

  it("offers every template with a label and a description", () => {
    expect(NOTE_TEMPLATES.map((t) => t.id)).toEqual(["blank", "daily", "habits", "journal", "scrapbook", "draw", "custom"]);
    for (const t of NOTE_TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.desc.length).toBeGreaterThan(0);
    }
  });

  it("builds a habit grid as a table the editor already round-trips", () => {
    const { title, body } = buildNoteTemplate("habits", NOW);
    expect(title).toContain("Habits");
    expect(body).toContain("| Habit | Mon | Tue | Wed | Thu | Fri | Sat | Sun |");
    expect(body).toContain("| --- |");
  });

  it("dates the journal and seeds its prompts", () => {
    const { title, body } = buildNoteTemplate("journal", NOW);
    expect(title).toContain("Journal");
    expect(body).toContain("## What went well");
    expect(body).toContain("- [ ] ");    // carry-forward is a real to-do
  });

  it("gives the scrapbook a stable title — it is not a dated page", () => {
    expect(buildNoteTemplate("scrapbook", NOW).title).toBe("Scrapbook");
  });

  it("seeds the drawing pad with an empty canvas block", () => {
    const { body } = buildNoteTemplate("draw", NOW);
    expect(body).toContain("```draw");
    expect(body).toContain('{"v":1,"strokes":[]}');
  });

  it("keeps a drawing block intact through the editor's round-trip", () => {
    // The whole reason strokes live in a fenced block: parse ∘ serialize must
    // return the JSON byte-for-byte or a sketch would be destroyed on any edit.
    const body = buildNoteTemplate("draw", NOW).body;
    const blocks = parseBlocks(body);
    const drawing = blocks.find((b) => b.type === "code" && b.meta === "draw")!;
    expect(drawing.text).toBe('{"v":1,"strokes":[]}');
    expect(serializeBlocks(blocks)).toContain('{"v":1,"strokes":[]}');
  });

  it("still falls back to blank for an unknown id", () => {
    expect(buildNoteTemplate("nope" as never, NOW).title).toBe("Untitled");
  });
});

/* Layouts applied AFTER a page exists, and a layout the user wrote themselves. */
describe("applyTemplateToNote", () => {
  it("replaces an empty page outright — title and all", () => {
    const out = applyTemplateToNote({ title: "Untitled", body: "# Untitled\n\n" }, "journal", AT);
    expect(out.title).toBe(buildNoteTemplate("journal", AT).title);
    expect(out.body).toBe(buildNoteTemplate("journal", AT).body);
  });

  it("never destroys a page that has content", () => {
    const note = { title: "Meeting log", body: "# Meeting log\n\nPriya wants the API doc by Friday.\n" };
    const out = applyTemplateToNote(note, "daily", AT);
    expect(out.title).toBe("Meeting log");
    expect(out.body).toContain("Priya wants the API doc by Friday.");
    expect(out.body).toContain("## Top 3 Priorities");
    // The layout's own H1 is dropped: the page already has a title.
    expect(out.body.match(/^# /gm)).toHaveLength(1);
  });

  it("treats a heading-only page as empty", () => {
    expect(isNoteEmpty("# Untitled\n\n")).toBe(true);
    expect(isNoteEmpty("# Untitled\n\nsomething\n")).toBe(false);
  });
});

describe("custom layout", () => {
  const custom = { title: "Standup {{date}}", body: "# {{title}}\n\n## Blockers\n- \n" };

  it("fills the title and date placeholders", () => {
    const { title, body } = buildNoteTemplate("custom", AT, custom);
    expect(title).toContain("Standup");
    expect(body).toContain(`# ${title}`);
    expect(body).toContain("## Blockers");
  });

  it("falls back to blank until one has been written", () => {
    expect(buildNoteTemplate("custom", AT).title).toBe("Untitled");
    expect(availableTemplates().map((t) => t.id)).not.toContain("custom");
    expect(availableTemplates(custom).map((t) => t.id)).toContain("custom");
  });

  it("offers a starter so the editor is never an empty box", () => {
    expect(starterCustomTemplate().body).toContain("{{title}}");
  });
});
