/* Markdown ⇄ tasks, ported from the desktop app (src-tauri/src/todo/
   markdown_task_parser.rs + time_block_parser.rs) so files move between the
   two apps unchanged. Every bullet (`-`/`*`/`+` + space) is a task, with an
   optional `[ ]`/`[x]` checkbox; indentation nests (4 spaces per level, tab
   = 4). Non-bullet lines are ignored so prose never explodes into tasks.
   `[block]label [HHMM:HHMM][nX]` bullets are blocked-time placeholders. */

import type { AppState, Repeat, Task, TaskStatus, TimeBlock } from "./types";
import { at, startOfDay } from "./dates";
import { formatTaskMeta, newMdKey, parseTaskMeta, type TaskMeta } from "./taskMeta";
import { occurrenceStatusOf } from "./occurrence";

export interface ParsedMdTask {
  title: string;
  /** Kept for callers that only care about done-ness; `status` is the full read. */
  alreadyCompleted: boolean;
  /** The state the checkbox states, or undefined for a bullet with no box at
      all — which says nothing about status and must leave it alone. */
  status?: TaskStatus;
  /** Fields the line's token tail states. Empty object when it states none. */
  meta: TaskMeta;
  /** Joined `>` continuation lines belonging to this task, if any. */
  description?: string;
  /** Index into the returned array of the nearest less-indented task above. */
  parentIndex?: number;
  /** Zero-based line in the source text. Lets a caller rewrite exactly this
      line and leave every other byte of the document alone. */
  line: number;
}

/** Checkbox glyph → status. `[ ]`/`[x]` are the historic pair; `[/]` and `[-]`
    extend it to the two states the app has always had but markdown could not
    say. Anything else is not a box and stays in the title, as before. */
const BOX_STATUS: Record<string, TaskStatus> = {
  "[ ]": "pending",
  "[/]": "in_progress",
  "[x]": "done",
  "[X]": "done",
  "[-]": "skipped",
};

const STATUS_BOX: Record<TaskStatus, string> = {
  pending: "[ ]",
  in_progress: "[/]",
  // Markdown has no "paused" glyph — it round-trips as in-progress. The app is
  // the source of truth for the hold state.
  paused: "[/]",
  done: "[x]",
  skipped: "[-]",
};

function leadingIndentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4;
    else break;
  }
  return width;
}

/** `[label](url)` → `label`; lone `[...]` or `(...)` stay untouched. */
export function stripMarkdownLinkSyntax(text: string): string {
  let result = "";
  let rest = text;
  for (;;) {
    const bracketStart = rest.indexOf("[");
    if (bracketStart === -1) break;
    result += rest.slice(0, bracketStart);
    const afterOpen = rest.slice(bracketStart + 1);
    const bracketEnd = afterOpen.indexOf("]");
    if (bracketEnd === -1 || afterOpen[bracketEnd + 1] !== "(") {
      result += "[";
      rest = afterOpen;
      continue;
    }
    const label = afterOpen.slice(0, bracketEnd);
    const afterLabel = afterOpen.slice(bracketEnd + 2);
    const parenEnd = afterLabel.indexOf(")");
    if (parenEnd === -1) {
      result += "[";
      rest = afterOpen;
      continue;
    }
    result += label;
    rest = afterLabel.slice(parenEnd + 1);
  }
  return result + rest;
}

export function parseMarkdownTasks(markdownText: string): ParsedMdTask[] {
  const tasks: ParsedMdTask[] = [];
  const ancestry: { indent: number; index: number }[] = [];
  /** Which task a `>` line belongs to: the last one seen. Attribution is by
      ADJACENCY, not indent depth, because the note editor dedents an indented
      `>` line back to column 0 — keying on indentation would silently orphan
      every description it reformatted. Blank lines stay transparent. */
  let lastTaskIndex: number | undefined;
  const descriptions = new Map<number, string[]>();

  const sourceLines = markdownText.split("\n");
  for (let lineNumber = 0; lineNumber < sourceLines.length; lineNumber++) {
    const line = sourceLines[lineNumber];
    const indent = leadingIndentWidth(line);
    const trimmed = line.trimStart();

    if (!/^[-*+] /.test(trimmed)) {
      // A `>` line continues the description of the task above it.
      const quote = /^>[ \t]?(.*)$/.exec(trimmed);
      if (quote && lastTaskIndex !== undefined) {
        const lines = descriptions.get(lastTaskIndex) ?? [];
        lines.push(quote[1]);
        descriptions.set(lastTaskIndex, lines);
      } else if (trimmed !== "" && !quote) {
        // Real prose ends the run; a later `>` must not reattach across it.
        lastTaskIndex = undefined;
      }
      continue;
    }

    const afterBullet = trimmed.slice(2);
    const marker = afterBullet.slice(0, 3);
    const status = BOX_STATUS[marker];
    // Metadata comes off BEFORE the link stripper, so `[label](url)` collapsing
    // can never chew a token, and the visible title keeps its old semantics.
    const body = status === undefined ? afterBullet.trim() : afterBullet.slice(3).trim();
    const { title: bareTitle, meta } = parseTaskMeta(body);
    const title = stripMarkdownLinkSyntax(bareTitle);
    if (!title) continue;

    while (ancestry.length && ancestry[ancestry.length - 1].indent >= indent) ancestry.pop();
    const parentIndex = ancestry.length ? ancestry[ancestry.length - 1].index : undefined;
    tasks.push({ title, alreadyCompleted: status === "done", status, meta, parentIndex, line: lineNumber });
    ancestry.push({ indent, index: tasks.length - 1 });
    lastTaskIndex = tasks.length - 1;
  }

  for (const [index, lines] of descriptions) {
    const text = lines.join("\n").trim();
    if (text) tasks[index].description = text;
  }
  return tasks;
}

/* ————— [block] syntax ————— */

export interface ParsedTimeBlock {
  label: string;
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  repeat?: Repeat;
}

function parseHhmm(digits: string): number | undefined {
  if (!/^\d{4}$/.test(digits)) return undefined;
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2));
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

function splitBracketGroup(text: string): [string, string] | undefined {
  if (!text.startsWith("[")) return undefined;
  const close = text.indexOf("]", 1);
  if (close === -1) return undefined;
  return [text.slice(1, close), text.slice(close + 1)];
}

/** `None`/undefined on any near-miss, so a plain title never half-applies. */
export function parseTimeBlock(title: string): ParsedTimeBlock | undefined {
  const trimmed = title.trim();
  if (trimmed.length < 7 || trimmed.slice(0, 7).toLowerCase() !== "[block]") return undefined;
  const rest = trimmed.slice(7).trim();

  const timeOpen = rest.indexOf("[");
  if (timeOpen === -1) return undefined;
  const label = rest.slice(0, timeOpen).trim();
  if (!label) return undefined;

  const timeGroup = splitBracketGroup(rest.slice(timeOpen));
  if (!timeGroup) return undefined;
  const [timeRange, afterTimeRaw] = timeGroup;
  const colon = timeRange.indexOf(":");
  if (colon === -1) return undefined;
  const startMinuteOfDay = parseHhmm(timeRange.slice(0, colon));
  const endMinuteOfDay = parseHhmm(timeRange.slice(colon + 1));
  if (startMinuteOfDay === undefined || endMinuteOfDay === undefined || endMinuteOfDay <= startMinuteOfDay) return undefined;

  const afterTime = afterTimeRaw.trim();
  let repeat: ParsedTimeBlock["repeat"];
  if (afterTime) {
    const repeatGroup = splitBracketGroup(afterTime);
    if (!repeatGroup || repeatGroup[1].trim()) return undefined;
    const spec = repeatGroup[0];
    const unitCh = spec.slice(-1).toUpperCase();
    const interval = Number(spec.slice(0, -1));
    if (!Number.isInteger(interval) || interval < 1) return undefined;
    const unit = unitCh === "D" ? "daily" : unitCh === "W" ? "weekly" : unitCh === "M" ? "monthly" : unitCh === "Y" ? "yearly" : undefined;
    if (!unit) return undefined;
    repeat = { interval, unit };
  }

  return { label, startMinuteOfDay, endMinuteOfDay, repeat };
}

/** Whether a repeat anchored at `anchor` has an occurrence on the given
    local day. Without a repeat rule only the anchor day matches. */
export function repeatOccursOn(anchor: number, repeat: Repeat | undefined, dayStart: number): boolean {
  const anchorDay = startOfDay(anchor);
  if (dayStart < anchorDay) return false;
  if (!repeat) return dayStart === anchorDay;
  const dayDiff = Math.round((dayStart - anchorDay) / 86_400_000);
  const { interval, unit } = repeat;
  if (unit === "daily") return dayDiff % interval === 0;
  if (unit === "weekly") return dayDiff % (7 * interval) === 0;
  // Monthly and yearly walk the calendar identically — a year is just a
  // 12-month stride — so both land on the same day-of-month test. Note the
  // consequence, unchanged from the monthly rule that was already here: a
  // 29 Feb birthday has no occurrence in a common year, exactly as a
  // monthly routine anchored on the 31st skips February.
  const monthStride = unit === "yearly" ? interval * 12 : interval;
  const a = new Date(anchorDay);
  const d = new Date(dayStart);
  if (a.getDate() !== d.getDate()) return false;
  const monthDiff = (d.getFullYear() - a.getFullYear()) * 12 + (d.getMonth() - a.getMonth());
  return monthDiff >= 0 && monthDiff % monthStride === 0;
}

/** Whether a repeat anchored at `anchor` has any occurrence on a local day
    that overlaps the inclusive millisecond range `[from, to]`. Walks whole
    local days, so the range is only ever as wide as the caller's window
    (the task window caps each side at a year). Returns false for an empty
    or inverted range. */
export function repeatOccursInRange(
  anchor: number,
  repeat: Repeat | undefined,
  from: number,
  to: number,
): boolean {
  if (to < from) return false;
  const DAY = 86_400_000;
  const anchorDay = startOfDay(anchor);
  let day = Math.max(anchorDay, startOfDay(from));
  const lastDay = startOfDay(to);
  for (; day <= lastDay; day += DAY) {
    if (repeatOccursOn(anchor, repeat, day)) return true;
  }
  return false;
}

/** Whether a (possibly repeating) block occurs on the given local day. */
export function blockOccursOn(block: TimeBlock, dayStart: number): boolean {
  return repeatOccursOn(block.start, block.repeat, dayStart);
}

/** A block's concrete slot on a given day (start ms + minutes). */
export function blockSlotOn(block: TimeBlock, dayStart: number): { start: number; durationMin: number } {
  const minuteOfDay = (block.start - startOfDay(block.start)) / 60_000;
  return { start: dayStart + minuteOfDay * 60_000, durationMin: block.durationMin };
}

export function parsedBlockToTimeBlock(parsed: ParsedTimeBlock, source?: string): TimeBlock {
  const today = startOfDay(Date.now());
  return {
    id: `b-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    title: parsed.label,
    start: at(today, 0, parsed.startMinuteOfDay),
    durationMin: parsed.endMinuteOfDay - parsed.startMinuteOfDay,
    repeat: parsed.repeat,
    source,
  };
}

/* ————— keeping a note's markdown in step with its tasks ————— */

/** What a task's line should say. Keeps the original indentation and bullet
    character so only the meaningful part of the line changes. */
export function rewriteTaskLine(
  line: string,
  task: Task,
  key: string,
  after: readonly string[],
  now = Date.now(),
): string {
  const shape = /^(\s*)([-*+]) /.exec(line);
  if (!shape) return line;
  const meta = formatTaskMeta(task, { id: key, after: after.length ? [...after] : undefined });
  return `${shape[1]}${shape[2]} ${taskBox(task, now)} ${task.title}${meta}`;
}

/** Make a note's body agree with the tasks it owns.

    This is the app → note direction: edit a task anywhere — the board, the list,
    a drag on the schedule, the editor, the day-start re-plan — and its line in
    the note is rewritten to match. It is also how `@id` first gets into a note,
    since stamping is just a rewrite of a line that had no key yet.

    `resolve` says which task (if any) a parsed line belongs to, so the same
    walker serves both callers: the importer resolves by its own line→task map,
    everything else resolves by key. Lines it cannot resolve — prose, time
    blocks, tasks from another note — are left untouched, and the body is
    returned by reference when nothing changed, so React sees no update. */
export function reconcileNoteBody(
  body: string,
  resolve: (entry: ParsedMdTask) => { task: Task; key: string; after?: readonly string[] } | undefined,
  now = Date.now(),
): string {
  const entries = parseMarkdownTasks(body);
  if (!entries.length) return body;
  const lines = body.split("\n");
  let changed = false;

  for (const entry of entries) {
    // A `[block]` line is a time block, not a task — never rewrite it.
    if (parseTimeBlock(entry.title)) continue;
    const hit = resolve(entry);
    if (!hit) continue;
    const rebuilt = rewriteTaskLine(lines[entry.line], hit.task, hit.key, hit.after ?? [], now);
    if (rebuilt !== lines[entry.line]) {
      lines[entry.line] = rebuilt;
      changed = true;
    }
  }
  return changed ? lines.join("\n") : body;
}

/* ————— export: tasks → markdown ————— */

/** The box a task exports as. A routine's `status` is the untouched template, so
    its box has to come from TODAY's occurrence or ticking one in a note would
    read back as a change to every day at once. */
export function taskBox(task: Task, now = Date.now()): string {
  return STATUS_BOX[task.repeat ? occurrenceStatusOf(task, now) : task.status];
}

/** Every field the editor can set, written back out. Deliberately NOT round
    tripped: `createdAt`, `completedAt` (derived from status), `loggedMin` (owned
    by the timer's session log), `googleEvent`, and a routine's `occurrenceStatus`
    beyond today's box. */
export function tasksToMarkdown(state: AppState, now = Date.now()): string {
  const lines: string[] = ["# LetsGo todos", ""];
  const children = (id: string) => state.tasks.filter((t) => t.parentId === id);
  const byId = new Map(state.tasks.map((t) => [t.id, t]));

  // Keys are minted for anything unstamped so the file is self-identifying and
  // re-importing it matches by id instead of by title.
  const taken = new Set(state.tasks.map((t) => t.mdKey).filter(Boolean) as string[]);
  const keyOf = new Map<string, string>();
  for (const task of state.tasks) {
    const key = task.mdKey ?? newMdKey(taken);
    taken.add(key);
    keyOf.set(task.id, key);
  }

  const emit = (task: Task, depth: number) => {
    const pad = "    ".repeat(depth);
    // Dependencies reference the task's TEXT, never a key — nobody should have
    // to read a generated id to understand their own note.
    const after = (task.dependsOn ?? []).map((id) => byId.get(id)?.title).filter(Boolean) as string[];
    lines.push(`${pad}- ${taskBox(task, now)} ${task.title}${formatTaskMeta(task, { id: keyOf.get(task.id)!, after })}`);
    if (task.description?.trim()) {
      for (const line of task.description.trim().split("\n")) lines.push(`${pad}  > ${line}`);
    }
    for (const child of children(task.id)) emit(child, depth + 1);
  };

  for (const task of state.tasks.filter((t) => !t.parentId)) emit(task, 0);
  if (state.blocks.length) lines.push("");
  for (const block of state.blocks) {
    const minuteOfDay = (block.start - startOfDay(block.start)) / 60_000;
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}`;
    const repeat = block.repeat ? `[${block.repeat.interval}${block.repeat.unit[0].toUpperCase()}]` : "";
    lines.push(`- [block]${block.title} [${hhmm(minuteOfDay)}:${hhmm(minuteOfDay + block.durationMin)}]${repeat}`);
  }
  return lines.join("\n") + "\n";
}
