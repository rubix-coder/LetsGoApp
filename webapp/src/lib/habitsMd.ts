/* Habits ⇄ markdown, in the spirit of mdTasks.ts: a plain file a human can
   read, edit and re-import, with the ledger as one dated line per day.

   # Habits

   ## 🌅 Wake up by 6
   - days: daily
   - 2026-08-07: 1

   Re-imports reconcile by habit NAME (mergeImportedHabits): the ledger merges
   day-wise (max wins, so a re-import never erases ticks recorded meanwhile),
   schedule/target/emoji follow the file, identity and createdAt stay. */

import type { Habit } from "./types";

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function habitsToMarkdown(habits: readonly Habit[]): string {
  const out: string[] = ["# Habits", ""];
  for (const h of habits) {
    out.push(`## ${h.emoji ? `${h.emoji} ` : ""}${h.name}`);
    out.push(`- days: ${!h.days || h.days.length === 0 ? "daily" : h.days.map((d) => DAY_NAMES[d]).join(" ")}`);
    if ((h.timesPerDay ?? 1) > 1) out.push(`- times: ${h.timesPerDay}`);
    for (const day of Object.keys(h.log).sort().reverse()) out.push(`- ${day}: ${h.log[day]}`);
    out.push("");
  }
  return out.join("\n");
}

const LOG_LINE = /^-\s+(\d{4}-\d{2}-\d{2}):\s*(\d+)\s*$/;
const EMOJI_LEAD = /^(\S+)\s+(.+)$/u;

function splitEmoji(heading: string): { emoji?: string; name: string } {
  const m = EMOJI_LEAD.exec(heading);
  // "Contains a pictograph" rather than "is one" — many emoji are sequences
  // (skin tones, ZWJ) that a single-codepoint test would reject.
  if (m && /\p{Extended_Pictographic}/u.test(m[1])) return { emoji: m[1], name: m[2].trim() };
  return { name: heading.trim() };
}

/** Habits out of a markdown file. Ids are fresh — merge with
    mergeImportedHabits to reconcile against what already exists. */
export function parseHabitsMarkdown(text: string): Habit[] {
  const habits: Habit[] = [];
  let current: Habit | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      current = { id: `md-${habits.length}-${Date.now().toString(36)}`, ...splitEmoji(heading[1]), createdAt: Date.now(), log: {} };
      habits.push(current);
      continue;
    }
    if (!current) continue;
    const log = LOG_LINE.exec(line);
    if (log) {
      current.log[log[1]] = Number(log[2]);
      continue;
    }
    const days = /^-\s+days:\s*(.+)$/i.exec(line);
    if (days) {
      const tokens = days[1].trim().toLowerCase();
      if (tokens !== "daily" && tokens !== "every day") {
        const nums = tokens.split(/[\s,]+/).map((t) => DAY_NAMES.indexOf(t.slice(0, 3) as (typeof DAY_NAMES)[number])).filter((n) => n >= 0);
        if (nums.length > 0) current.days = [...new Set(nums)].sort();
      }
      continue;
    }
    const times = /^-\s+times:\s*(\d+)$/i.exec(line);
    if (times) {
      const n = Number(times[1]);
      if (n > 1) current.timesPerDay = n;
    }
  }
  return habits;
}

/** Fold imported habits into the existing list. Name is the join key
    (case-insensitive); a matched habit keeps its id/createdAt, takes the
    file's schedule/target/emoji, and unions the ledger day-wise by max. */
export function mergeImportedHabits(existing: readonly Habit[], imported: readonly Habit[], source?: string): Habit[] {
  const out = [...existing];
  for (const imp of imported) {
    const i = out.findIndex((h) => h.name.trim().toLowerCase() === imp.name.trim().toLowerCase());
    if (i < 0) {
      out.push(source ? { ...imp, source } : imp);
      continue;
    }
    const prev = out[i];
    const log = { ...prev.log };
    for (const [day, n] of Object.entries(imp.log)) log[day] = Math.max(log[day] ?? 0, n);
    out[i] = {
      ...prev,
      emoji: imp.emoji ?? prev.emoji,
      days: imp.days,
      timesPerDay: imp.timesPerDay,
      source: source ?? prev.source,
      log,
    };
  }
  return out;
}
