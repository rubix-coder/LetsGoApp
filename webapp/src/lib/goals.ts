/* Goal tracking: a note tagged GOAL becomes a progress bar on the dashboard.

   Where the progress number comes from matters, because the app offers two
   ways to break a goal down and users pick one:

     1. "Send to Todo" turns a note's bullets into real tasks carrying
        `source = <note title>`. Those tasks then gain status, timer sessions
        and completion dates — the richest signal available.
     2. Checkbox blocks written straight into the note body, never sent
        anywhere.

   Linked tasks WIN when any exist, and checkboxes are the fallback. Summing
   both would double-count exactly the users who followed the intended
   workflow, since a sent bullet exists in both places. */

import type { AppState, Note, Task } from "./types";
import { parseBlocks } from "./noteBlocks";

/** The reserved tag, matched case-insensitively so "goal" and "Goal" work. */
export const GOAL_TAG = "goal";

export interface GoalProgress {
  /** The top-most tagged page — the goal's headline. */
  note: Note;
  done: number;
  total: number;
  /** 0–1; 0 when the goal has nothing to measure yet. */
  ratio: number;
  /** Which signal the numbers came from, so the UI can say so. */
  basis: "tasks" | "checkboxes";
  /** Pages counted, including the headline itself. */
  pageCount: number;
}

export function hasGoalTag(note: Note): boolean {
  return (note.tags ?? []).some((t) => t.trim().toLowerCase() === GOAL_TAG);
}

/** Every page at or under `rootId`, the headline first. */
function noteSubtree(notes: readonly Note[], rootId: string): Note[] {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of notes) {
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) { ids.add(n.id); grew = true; }
    }
  }
  return notes.filter((n) => ids.has(n.id));
}

/** True when a tagged page sits under another tagged page — the outer one is
    the goal, so the inner one must not be reported as a second goal. */
function hasTaggedAncestor(notes: readonly Note[], note: Note): boolean {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const seen = new Set<string>([note.id]);
  let cursor = note.parentId ? byId.get(note.parentId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    if (hasGoalTag(cursor)) return true;
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return false;
}

/** Leaf tasks only. A parent's status is derived from its children, so counting
    parents too would weight a branching plan differently from a flat one. */
function countTasks(tasks: readonly Task[], titles: Set<string>): { done: number; total: number } {
  const parentIds = new Set(tasks.map((t) => t.parentId).filter(Boolean) as string[]);
  const linked = tasks.filter((t) => t.source !== undefined && titles.has(t.source) && !parentIds.has(t.id));
  return {
    done: linked.filter((t) => t.status === "done").length,
    // A skipped task is a decision, not outstanding work — drop it from the
    // denominator so skipping the last item completes the goal instead of
    // capping it below 100%.
    total: linked.filter((t) => t.status !== "skipped").length,
  };
}

function countCheckboxes(notes: readonly Note[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const n of notes) {
    for (const b of parseBlocks(n.body)) {
      if (b.type === "todo") total++;
      else if (b.type === "todo-done") { total++; done++; }
    }
  }
  return { done, total };
}

/** Progress for every GOAL-tagged page, outermost tagged page per branch only,
    in the order the pages are stored. */
export function goalProgress(state: Pick<AppState, "notes" | "tasks">): GoalProgress[] {
  const goals = state.notes.filter((n) => hasGoalTag(n) && !hasTaggedAncestor(state.notes, n));
  return goals.map((note) => {
    const pages = noteSubtree(state.notes, note.id);
    const titles = new Set(pages.map((p) => p.title));
    const fromTasks = countTasks(state.tasks, titles);
    const counted = fromTasks.total > 0 ? fromTasks : countCheckboxes(pages);
    const basis: GoalProgress["basis"] = fromTasks.total > 0 ? "tasks" : "checkboxes";
    return {
      note,
      done: counted.done,
      total: counted.total,
      ratio: counted.total > 0 ? counted.done / counted.total : 0,
      basis,
      pageCount: pages.length,
    };
  });
}
