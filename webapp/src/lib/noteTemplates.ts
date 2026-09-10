import type { CustomNoteTemplate, NoteTemplate } from "./types";

export type { CustomNoteTemplate, NoteTemplate };

/* Starting content for a freshly created note. The template is a Settings
   choice (Settings → Plugins → Notes) that can also be asked for on every
   create, and applied to a page that already exists: "blank" keeps the classic
   empty page,
   "daily" seeds the paper-planner "Today" layout — a checklist, top-3
   priorities, a for-tomorrow list, a don't-forget list and a notes area. The
   body stays plain markdown, so export, Send-to-Todo and sync are unchanged —
   the checkboxes are ordinary `- [ ]` bullets the BlockEditor renders as
   to-dos. */

export const NOTE_TEMPLATES: { id: NoteTemplate; label: string; desc: string }[] = [
  { id: "blank", label: "Blank", desc: "A clean page — the classic default." },
  {
    id: "daily",
    label: "Daily planner",
    desc: "The “Today” layout: checklist, top 3 priorities, for tomorrow, don’t forget & notes.",
  },
  {
    id: "habits",
    label: "Habit tracker",
    desc: "A week grid to tick off daily habits, with room for a streak note.",
  },
  {
    id: "journal",
    label: "Journal",
    desc: "Dated entry with prompts: how the day went, what went well, what to carry forward.",
  },
  {
    id: "scrapbook",
    label: "Scrapbook",
    desc: "A place for clippings, links, images and quotes, loosely sectioned.",
  },
  {
    id: "draw",
    label: "Drawing pad",
    desc: "A canvas to sketch on with a stylus, finger or mouse — pen pressure supported.",
  },
  {
    id: "custom",
    label: "My layout",
    desc: "Your own starting page, written in Settings → Plugins → Notes.",
  },
];

/** The layouts to offer right now: the custom one is hidden until it has been
    written, since an empty "My layout" is just Blank with a confusing name. */
export function availableTemplates(custom?: CustomNoteTemplate): typeof NOTE_TEMPLATES {
  return NOTE_TEMPLATES.filter((t) => t.id !== "custom" || !!custom?.body.trim());
}

/** What a fresh custom layout starts from, so the Settings editor is never a
    blank box the user has to invent a format for. */
export function starterCustomTemplate(): CustomNoteTemplate {
  return {
    title: "My page",
    body: ["# {{title}}", "", "## What this is", "", "", "## Next steps", "- [ ] ", "", "## Notes", "", ""].join("\n"),
  };
}

/** An empty drawing surface. Strokes live as JSON inside a fenced ```draw block,
    which means the note body stays plain markdown and the drawing rides along
    with export, sync and the block editor's round-trip for free — fenced blocks
    are already preserved verbatim. */
export function emptyDrawingBlock(): string {
  return "```draw\n{\"v\":1,\"strokes\":[]}\n```";
}

/** Human date for the daily template's heading, e.g. "Saturday, Jul 26 2026".
    The device locale drives it, matching the rest of the app's date display. */
function dateStamp(now: number): string {
  return new Date(now).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function dailyBody(title: string): string {
  return [
    `# ${title}`,
    "",
    "## Checklist",
    "- [ ] ",
    "- [ ] ",
    "- [ ] ",
    "- [ ] ",
    "- [ ] ",
    "- [ ] ",
    "",
    "## Top 3 Priorities",
    "- [ ] ",
    "- [ ] ",
    "- [ ] ",
    "",
    "## For Tomorrow",
    "- [ ] ",
    "- [ ] ",
    "",
    "## Don't Forget",
    "- [ ] ",
    "- [ ] ",
    "",
    "---",
    "",
    "## Notes",
    "",
    "",
  ].join("\n");
}

/** Monday-first labels for the habit grid's week columns. */
const WEEK_COLUMNS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function habitsBody(title: string): string {
  // A GFM table, which the editor already parses and round-trips as one block.
  const row = (habit: string) => `| ${habit} | ${WEEK_COLUMNS.map(() => " ").join(" | ")} |`;
  return [
    `# ${title}`,
    "",
    "Tick a box each day. Keep the list short — three or four habits beats ten.",
    "",
    `| Habit | ${WEEK_COLUMNS.join(" | ")} |`,
    `| --- | ${WEEK_COLUMNS.map(() => "---").join(" | ")} |`,
    row(""),
    row(""),
    row(""),
    row(""),
    "",
    "## Streaks & notes",
    "",
    "",
    "## What got in the way",
    "",
    "",
  ].join("\n");
}

function journalBody(title: string): string {
  return [
    `# ${title}`,
    "",
    "## How today went",
    "",
    "",
    "## What went well",
    "- ",
    "",
    "## What I'd do differently",
    "- ",
    "",
    "## Carry forward",
    "- [ ] ",
    "",
    "---",
    "",
    "> One line to remember today by.",
    "",
  ].join("\n");
}

function scrapbookBody(title: string): string {
  return [
    `# ${title}`,
    "",
    "## Clippings",
    "",
    "> Paste a quote worth keeping.",
    "",
    "## Links",
    "- ",
    "",
    "## Images",
    "",
    "",
    "## Why I kept these",
    "",
    "",
  ].join("\n");
}

function drawBody(title: string): string {
  return [`# ${title}`, "", emptyDrawingBlock(), "", "## Notes", "", ""].join("\n");
}

/** The initial `{ title, body }` for a new note under the chosen template.
    `now` is injected (defaults to the wall clock) so the date stamp is testable
    and stable within a single creation. Unknown ids fall back to blank. */
export function buildNoteTemplate(
  template: NoteTemplate,
  now: number = Date.now(),
  custom?: CustomNoteTemplate,
): { title: string; body: string } {
  const stamped = (prefix: string) => `${prefix} — ${dateStamp(now)}`;
  switch (template) {
    case "custom": {
      // No custom layout written yet is not an error — it is Blank.
      if (!custom?.body.trim()) return { title: "Untitled", body: "# Untitled\n\n" };
      // Two placeholders, both optional: the page's own title and today's date.
      const title = (custom.title.trim() || "Untitled").replace(/\{\{\s*date\s*\}\}/gi, dateStamp(now));
      const body = custom.body
        .replace(/\{\{\s*date\s*\}\}/gi, dateStamp(now))
        .replace(/\{\{\s*title\s*\}\}/gi, title);
      return { title, body };
    }
    case "daily": {
      const title = stamped("Today");
      return { title, body: dailyBody(title) };
    }
    case "habits": {
      const title = stamped("Habits");
      return { title, body: habitsBody(title) };
    }
    case "journal": {
      const title = stamped("Journal");
      return { title, body: journalBody(title) };
    }
    case "scrapbook":
      return { title: "Scrapbook", body: scrapbookBody("Scrapbook") };
    case "draw": {
      const title = stamped("Sketch");
      return { title, body: drawBody(title) };
    }
    default:
      return { title: "Untitled", body: "# Untitled\n\n" };
  }
}


/** Is this page effectively empty — nothing but its own heading and blanks?
    The line a "change this page's layout" decision turns on. */
export function isNoteEmpty(body: string): boolean {
  return body
    .split("\n")
    .every((line) => line.trim() === "" || /^#{1,6}\s/.test(line.trim()) || line.trim() === "---");
}

/** Put a layout onto a page that already exists.

    Non-destructive by contract, because "change the layout" must never be a
    way to lose a week of notes: an empty page is REPLACED outright (title and
    all), and a page with content KEEPS everything and gets the layout's
    sections appended below a rule, with the layout's own H1 dropped — the page
    already has a title, and a second one would read as a second document. */
export function applyTemplateToNote(
  note: { title: string; body: string },
  template: NoteTemplate,
  now: number = Date.now(),
  custom?: CustomNoteTemplate,
): { title: string; body: string } {
  const fresh = buildNoteTemplate(template, now, custom);
  if (isNoteEmpty(note.body)) return fresh;

  const scaffold = fresh.body
    .split("\n")
    .filter((line, i, lines) => !(/^#\s/.test(line.trim()) && lines.slice(0, i).every((l) => l.trim() === "")))
    .join("\n")
    .trim();
  if (!scaffold) return { title: note.title, body: note.body };
  return { title: note.title, body: `${note.body.trimEnd()}\n\n---\n\n${scaffold}\n` };
}
