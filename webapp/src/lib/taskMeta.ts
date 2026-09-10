/* The extended markdown task format: sigil tokens that let a note carry every
   field the task editor has.

       - [/] Wire the CSV writer !P0 #work ~2h @start(2026-08-04 09:00) @lock @id(c9m4) // ask Priya

   Both directions live here, deliberately. `parseTaskMeta` and `formatTaskMeta`
   are the only readers and writers of the grammar, so import and export cannot
   drift apart the way a separate parser and serialiser always eventually do.
   The module depends on `types` alone, because the note renderer needs
   `splitMetaTail` and must not pull in the markdown/time-block machinery.

   Two properties are load-bearing:

   1. **Malformed input degrades to text.** Tokens are scanned RIGHT TO LEFT from
      the end of the line and the scan stops at the first thing that is not a
      well-formed token; everything to its left stays title text, verbatim.
      Nothing throws and nothing half-applies — the same contract
      `parseTimeBlock` honours. A stray "review PR #3" or "email me@x.com" is
      therefore untouched, and a backtick or backslash in front of a sigil is an
      escape hatch that works for free (the boundary check fails).

   2. **format ∘ parse is a fixpoint**, so export → import loses nothing. Tokens
      come out in a fixed canonical order and dates print date-only when the
      time is exactly local midnight, so re-serialising is byte-identical. */

import type { Priority, Repeat, Task, TaskStatus } from "./types";

/** Priority a task gets by default; omitted from the tail to keep it short. */
const DEFAULT_PRIORITY: Priority = 2;

/** Every field optional: absent means "the markdown said nothing about this",
    which the importer treats as "leave whatever the task already has". */
export interface TaskMeta {
  id?: string;
  /** Titles of tasks this one starts after — text, never ids, so that no human
      ever has to read a generated key. Resolved against the same file. */
  after?: string[];
  priority?: Priority;
  tags?: string[];
  estimateMin?: number;
  scheduledAt?: number;
  deadline?: number;
  repeat?: Repeat;
  locked?: boolean;
  status?: TaskStatus;
  comment?: string;
}

/* ————— values ————— */

/** "90m" · "2h" · "1h30m" · "45" → minutes. Undefined on anything else. */
export function parseMetaDuration(text: string): number | undefined {
  const t = text.trim();
  let m = /^(\d+)h(\d+)m$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+)h$/.exec(t);
  if (m) return Number(m[1]) * 60;
  m = /^(\d+)m$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+)$/.exec(t);
  if (m) return Number(m[1]);
  return undefined;
}

export function fmtMetaDuration(minutes: number): string {
  return `${minutes}m`;
}

/** "2026-08-04" (local midnight) or "2026-08-04 09:00" (local wall clock).
    Rejects impossible dates outright rather than letting Date roll them over,
    so "2026-02-31" stays literal text instead of silently becoming March. */
export function parseMetaDate(text: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(text.trim());
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] ? Number(m[4]) : 0;
  const minute = m[5] ? Number(m[5]) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date.getTime();
}

export function fmtMetaDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return d.getHours() === 0 && d.getMinutes() === 0 ? date : `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseMetaRepeat(text: string): Repeat | undefined {
  const m = /^(\d+)\s*([dwmy])$/i.exec(text.trim());
  if (!m) return undefined;
  const interval = Number(m[1]);
  if (!Number.isInteger(interval) || interval < 1) return undefined;
  const letter = m[2].toLowerCase();
  // The formatter writes `unit[0]`, so d/w/m/y round-trips without a table.
  return { interval, unit: letter === "d" ? "daily" : letter === "w" ? "weekly" : letter === "y" ? "yearly" : "monthly" };
}

/* ————— parsing ————— */

/** One token, anchored to the end of the string and required to start at a word
    boundary. The boundary is what makes "email me@x.com" and "review PR #3"
    safe: the sigil there is mid-word, so nothing matches. */
const TOKEN_AT_END = new RegExp(
  "(^|[ \\t])("
  + "!P[0-3]"                                        // priority
  + "|#[A-Za-z_][A-Za-z0-9_/-]*"                     // tag — must start with a letter
  + "|~(?:\\d+h\\d+m|\\d+h|\\d+m|\\d+)"              // estimate
  + "|@lock(?:\\([^()]*\\))?"                        // lock, bare or @lock(off)
  + "|@(?:start|due|every|after|id)\\([^()]*\\)"      // keyed values, spaces allowed inside
  // Trailing whitespace does not end the metadata. Anchoring hard to `$` meant
  // a single trailing space made the WHOLE tail unparseable — and guided entry
  // only offers a suggestion on a line ending in a space, so the parser was
  // blind at exactly the moment the editor asked it what was already stated.
  // The result was the same field being offered and inserted over and over.
  + ")[ \\t]*$",
);

/** Apply one token. Returns false when the token's VALUE is unusable, which
    stops the scan and leaves it (and everything left of it) as title text. */
function applyToken(token: string, meta: TaskMeta, tags: string[], after: string[]): boolean {
  if (token.startsWith("!P")) {
    // Right-to-left scan, so the rightmost occurrence of a scalar wins.
    if (meta.priority === undefined) meta.priority = Number(token.slice(2)) as Priority;
    return true;
  }
  if (token.startsWith("#")) {
    tags.push(token.slice(1));
    return true;
  }
  if (token.startsWith("~")) {
    const minutes = parseMetaDuration(token.slice(1));
    if (minutes === undefined) return false;
    if (meta.estimateMin === undefined) meta.estimateMin = minutes;
    return true;
  }

  const open = token.indexOf("(");
  const key = open === -1 ? token.slice(1) : token.slice(1, open);
  const value = open === -1 ? "" : token.slice(open + 1, -1);

  switch (key) {
    case "lock": {
      const flag = value.trim().toLowerCase();
      if (flag && flag !== "off" && flag !== "on") return false;
      if (meta.locked === undefined) meta.locked = flag !== "off";
      return true;
    }
    case "start": {
      const ms = parseMetaDate(value);
      if (ms === undefined) return false;
      if (meta.scheduledAt === undefined) meta.scheduledAt = ms;
      return true;
    }
    case "due": {
      const ms = parseMetaDate(value);
      if (ms === undefined) return false;
      if (meta.deadline === undefined) meta.deadline = ms;
      return true;
    }
    case "every": {
      const repeat = parseMetaRepeat(value);
      if (!repeat) return false;
      if (meta.repeat === undefined) meta.repeat = repeat;
      return true;
    }
    case "id": {
      const id = value.trim();
      if (!/^[A-Za-z0-9]{2,12}$/.test(id)) return false;
      if (meta.id === undefined) meta.id = id.toLowerCase();
      return true;
    }
    case "after": {
      const refs = value.split(",").map((s) => s.trim()).filter(Boolean);
      if (!refs.length) return false;
      // Reversed here because the whole list is reversed once at the end.
      after.push(...refs.slice().reverse());
      return true;
    }
    default:
      return false;
  }
}

/** Split a task line's text into its title, the fields it states, and the raw
    tail those fields came from (for renderers that want to dim it). */
export function parseTaskMeta(text: string): { title: string; meta: TaskMeta; tail: string } {
  const meta: TaskMeta = {};
  let cut = text.length;

  // A comment swallows the rest of the line, so it is peeled off first. The
  // boundary requirement is what keeps "https://x.com/a//b" out of it.
  const comment = /(^|[ \t])\/\/[ \t]?(.*)$/.exec(text);
  if (comment) {
    const body = comment[2].trim();
    if (body) meta.comment = body;
    cut = comment.index;
  }

  let rest = text.slice(0, cut);
  const tags: string[] = [];
  const after: string[] = [];
  for (;;) {
    const match = TOKEN_AT_END.exec(rest);
    if (!match) break;
    if (!applyToken(match[2], meta, tags, after)) break;
    cut = match.index;
    rest = rest.slice(0, cut);
  }
  if (tags.length) meta.tags = tags.reverse();
  if (after.length) meta.after = after.reverse();

  return { title: text.slice(0, cut).trimEnd(), meta, tail: text.slice(cut).trim() };
}

/** The same tokenizer, without decoding — for renderers that only need to know
    where the title stops and the metadata starts. */
export function splitMetaTail(text: string): { text: string; tail: string } {
  const { title, tail } = parseTaskMeta(text);
  return { text: title, tail };
}

/* ————— serialising ————— */

/** The canonical token tail for a task, leading space included ("" when there
    is nothing to say). Fixed order, so a round trip is byte-stable. */
export function formatTaskMeta(task: Task, opts: { id: string; after?: string[] }): string {
  const parts: string[] = [];
  if (task.priority !== DEFAULT_PRIORITY) parts.push(`!P${task.priority}`);
  for (const tag of task.tags) parts.push(`#${tag}`);
  if (task.estimateMin !== undefined) parts.push(`~${fmtMetaDuration(task.estimateMin)}`);
  if (task.scheduledAt !== undefined) parts.push(`@start(${fmtMetaDate(task.scheduledAt)})`);
  if (task.deadline !== undefined) parts.push(`@due(${fmtMetaDate(task.deadline)})`);
  if (task.repeat) parts.push(`@every(${task.repeat.interval}${task.repeat.unit[0]})`);
  if (task.locked) parts.push("@lock");
  if (opts.after?.length) parts.push(`@after(${opts.after.join(", ")})`);
  parts.push(`@id(${opts.id})`);
  // Last by contract: a comment runs to the end of the line.
  if (task.comment?.trim()) parts.push(`// ${task.comment.trim()}`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

/* ————— guided entry ————— */

/** The fields the editor offers, in the order it offers them. Deliberately the
    same order `formatTaskMeta` writes, so a line built by accepting every
    suggestion is already in canonical form. `id` is absent: it is machine-written
    and never something to suggest. */
export const META_FIELDS = ["priority", "tags", "estimate", "start", "due", "repeat", "lock", "comment"] as const;
export type MetaField = (typeof META_FIELDS)[number];

export interface MetaHint {
  field: MetaField;
  /** Dim text shown after the line — what accepting would produce. */
  ghost: string;
  /** What to insert on accept (no leading space; the caller adds separators). */
  insert: string;
  /** Where to leave the caret, counted back from the end of `insert`. Non-zero
      for fields with no sensible default, so the user types straight into it. */
  caretFromEnd: number;
}

/** Is this field already stated on the line? */
function statedFields(meta: TaskMeta): Set<MetaField> {
  const stated = new Set<MetaField>();
  if (meta.priority !== undefined) stated.add("priority");
  if (meta.tags?.length) stated.add("tags");
  if (meta.estimateMin !== undefined) stated.add("estimate");
  if (meta.scheduledAt !== undefined) stated.add("start");
  if (meta.deadline !== undefined) stated.add("due");
  if (meta.repeat) stated.add("repeat");
  if (meta.locked !== undefined) stated.add("lock");
  if (meta.comment !== undefined) stated.add("comment");
  return stated;
}

function hintFor(field: MetaField, now: number): MetaHint {
  const today = new Date(now);
  today.setHours(9, 0, 0, 0);
  const dayOnly = new Date(now);
  dayOnly.setHours(0, 0, 0, 0);
  switch (field) {
    // No defensible default for a free-text value: insert the sigil and let the
    // user type, so accepting never puts a wrong value in the line.
    case "tags": return { field, ghost: "#tag", insert: "#", caretFromEnd: 0 };
    case "comment": return { field, ghost: "// note", insert: "// ", caretFromEnd: 0 };
    case "priority": return { field, ghost: "!P1", insert: "!P1", caretFromEnd: 0 };
    case "estimate": return { field, ghost: "~30m", insert: "~30m", caretFromEnd: 0 };
    case "start": return { field, ghost: `@start(${fmtMetaDate(today.getTime())})`, insert: `@start(${fmtMetaDate(today.getTime())})`, caretFromEnd: 0 };
    case "due": return { field, ghost: `@due(${fmtMetaDate(dayOnly.getTime())})`, insert: `@due(${fmtMetaDate(dayOnly.getTime())})`, caretFromEnd: 0 };
    case "repeat": return { field, ghost: "@every(1d)", insert: "@every(1d)", caretFromEnd: 0 };
    case "lock": return { field, ghost: "@lock", insert: "@lock", caretFromEnd: 0 };
  }
}

/** The next field to offer on a task line: the first in `META_FIELDS` that the
    line does not already state and the user has not skipped this session.
    Undefined when the line has no title yet, or there is nothing left to offer. */
export function nextMetaHint(text: string, skipped: readonly MetaField[], now: number): MetaHint | undefined {
  const { title, meta } = parseTaskMeta(text);
  if (!title.trim()) return undefined;
  // A comment runs to the end of the line, so once one is open there is nowhere
  // left to append a token — anything suggested would be swallowed by it.
  if (/(^|[ \t])\/\//.test(text)) return undefined;
  const stated = statedFields(meta);
  const declined = new Set(skipped);
  const field = META_FIELDS.find((f) => !stated.has(f) && !declined.has(f));
  return field ? hintFor(field, now) : undefined;
}

const KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A short, human-ignorable key for `@id(...)`. Four base-36 characters is
    ~1.7M combinations, and the caller's `taken` set makes a collision within
    one vault impossible rather than merely unlikely. */
export function newMdKey(taken: Set<string>): string {
  const mint = (length: number) => {
    let key = "";
    for (let i = 0; i < length; i++) key += KEY_ALPHABET[Math.floor(Math.random() * KEY_ALPHABET.length)];
    return key;
  };
  for (let attempt = 0; attempt < 500; attempt++) {
    const key = mint(4);
    if (!taken.has(key)) return key;
  }
  // Only reachable with a preposterous number of tasks; widen rather than collide.
  let key = mint(8);
  while (taken.has(key)) key = mint(8);
  return key;
}
