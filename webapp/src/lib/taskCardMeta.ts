/* What a scheduled card can show in the space it actually has.

   A two-hour block on the Schedule is a big empty rectangle carrying a title
   and a time range, so the details you need in order to START the work — the
   description you wrote when planning it — live one click away in the editor.
   That is a click you make at the exact moment you were about to begin.

   The rules here decide how much of that write-up fits, and format the
   elapsed/estimate badge that sits alongside it. Kept pure and out of the
   component so the geometry is testable without a DOM: "does a 30-minute card
   show a description" is a question with one right answer, and it should not
   need a browser to ask. */

import { fmtMin } from "./dates";
import type { Task } from "./types";

/* The card's own layout, in pixels. These MUST track the styles in
   screens/todo/Schedule.tsx, which sets both rows to an EXPLICIT height so
   the two cannot drift: the first cut budgeted 13px for a meta row that the
   time badge silently grew to 16px, and every one-hour card sliced its
   description in half. The numbers are asserted by the layout, not assumed. */
const CARD_PADDING_Y = 10;   // 5px top + 5px bottom
const TITLE_ROW = 16;        // status square, title, priority, time badge
const META_ROW = 13;         // 10px text: the time range
const DETAIL_LINE = 13;      // 10.5px text at a 13px line-height

/** Beyond this a block is tall enough that more text stops being a glance and
    starts being a document. Sleep and other multi-hour blocks hit it. */
const MAX_DETAIL_LINES = 12;

/** How many description lines fit on a card `heightPx` tall, after the title
    and time rows have taken their share. Zero means "no room" — the short
    blocks that make up most of a day are unchanged.

    `reservedPx` is space the card can lose while the user is looking at it: a
    card carrying a lineage tag grows an 18px body padding on hover
    (`.lineageHost:hover .lineageBody`), and a clamp that ignored that would
    slice its own last line in half exactly when the pointer is on it. Budget
    for the worst case so the text never moves. */
export function detailLinesFor(heightPx: number, reservedPx = 0): number {
  const free = heightPx - CARD_PADDING_Y - TITLE_ROW - META_ROW - reservedPx;
  if (free < DETAIL_LINE) return 0;
  return Math.min(MAX_DETAIL_LINES, Math.floor(free / DETAIL_LINE));
}

/** Markdown flattened to something readable in a 10px clamped block.

    Line structure is KEPT — a description written as a checklist has to still
    look like a checklist at a glance, which is the whole point of putting it
    on the card — while the markers that only make sense in a full renderer
    are dropped. Blank lines go too: vertical space is the scarce resource
    here, and a clamp that spends a line on emptiness wastes the feature. */
export function plainPreview(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .map((line) =>
      line
        // [[Wikilink|shown]] → shown; [[Wikilink]] → Wikilink
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, shown) => shown ?? target)
        // [text](url) → text
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^\s{0,3}#{1,6}\s+/, "")           // headings
        .replace(/^\s{0,3}>\s?/, "")                // block quotes
        .replace(/^(\s*)[-*+]\s+/, "$1• ")          // bullets keep a marker
        .replace(/^(\s*)(\d+)[.)]\s+/, "$1$2. ")    // numbered lists keep theirs
        .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")      // code spans
        .replace(/(\*\*|__)(.*?)\1/g, "$2")         // bold
        .replace(/(\*|_)(.*?)\1/g, "$2")            // italic
        .replace(/~~(.*?)~~/g, "$1")                // strikethrough
        .replace(/\s+$/, ""),
    )
    // A rule is a visual device with no text; it reads as a stray "---".
    .filter((line) => line.trim() !== "" && !/^\s*([-*_])\1{2,}\s*$/.test(line))
    .join("\n");
}

/** The single line of detail a card shows, and where it came from.

    `description` is the write-up; `comment` is the running scratch line
    ("waiting on Priya"). The comment wins when both exist: it is the newer,
    more situational of the two, and it is what changes the decision about
    whether to start now. */
export function cardDetailText(task: Task): string {
  const comment = task.comment?.trim();
  const description = task.description?.trim();
  if (comment && description) return plainPreview(`${comment}\n${description}`);
  return plainPreview(comment || description || "");
}

/** Elapsed against estimate, ready to render.

    `frac` drives the pill's fill; it is null when there is nothing to fill
    against (no estimate), and clamped to 1 when over — an overrun is shown by
    `over`, not by a bar spilling past its own edge. */
export interface TimeBadge {
  text: string;
  frac: number | null;
  over: boolean;
  /** True once any time has been logged, which is what makes the badge worth
      colouring rather than leaving as quiet grey chrome. */
  started: boolean;
}

/** Minutes at their shortest still-unambiguous width.

    `fmtMin` pads to "2h 00m" so a column of durations aligns; this badge sits
    inline on the title row of a card that may be a seventh of a screen wide,
    where those three characters are the difference between a readable title
    and an ellipsis. A whole number of hours drops the minutes. */
function compactMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m >= 60 && m % 60 === 0) return `${m / 60}h`;
  return fmtMin(m);
}

/** "25m / 1h", "~1h", "25m" — or null when the task carries neither.

    Rounded to the minute deliberately: a schedule card is glanced at, and a
    seconds-precise number invites reading rather than glancing. */
export function timeBadge(task: Task, elapsedMin: number): TimeBadge | null {
  const estimate = task.estimateMin;
  const elapsed = Math.max(0, Math.round(elapsedMin));
  const started = elapsed > 0;

  if (!estimate && !started) return null;
  if (!estimate) return { text: compactMin(elapsed), frac: null, over: false, started };
  if (!started) return { text: `~${compactMin(estimate)}`, frac: 0, over: false, started };

  return {
    text: `${compactMin(elapsed)} / ${compactMin(estimate)}`,
    frac: Math.min(1, elapsed / estimate),
    over: elapsed > estimate,
    started,
  };
}
