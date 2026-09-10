/* Pure task-tree helpers shared by the board views. Leaves are the atomic tasks
   that carry a real, user-set status (a parent's is derived), so they alone
   decide which Kanban columns a parent card is split into.

   Every helper reads a ChildIndex — a parentId → children map built once with
   childIndex() — instead of rescanning the whole task array per call, so a full
   board render costs O(N) rather than O(N²). */

import type { Task, TaskStatus } from "./types";

/** parentId → its child tasks. Childless tasks are simply absent as keys, so
    `!idx.has(id)` is the leaf test. Entries always hold at least one child. */
export type ChildIndex = Map<string, Task[]>;

export function childIndex(all: readonly Task[]): ChildIndex {
  const idx: ChildIndex = new Map();
  for (const t of all) {
    if (t.parentId === undefined) continue;
    const kids = idx.get(t.parentId);
    if (kids) kids.push(t);
    else idx.set(t.parentId, [t]);
  }
  return idx;
}

export const isLeaf = (idx: ChildIndex, id: string): boolean => !idx.has(id);

/** Does a leaf's status put it in this board column? Paused folds into the
    In-progress lane (the board stays four columns). */
function inColumn(leafStatus: TaskStatus, column: TaskStatus): boolean {
  if (column === "in_progress") return leafStatus === "in_progress" || leafStatus === "paused";
  return leafStatus === column;
}

/** Does the subtree rooted at `task` contain a LEAF in this board column? */
export function branchMatches(idx: ChildIndex, task: Task, status: TaskStatus): boolean {
  const kids = idx.get(task.id);
  if (!kids) return inColumn(task.status, status);
  return kids.some((k) => branchMatches(idx, k, status));
}

/** How many leaf descendants of `task` (or `task` itself, if a leaf) are in this
    board column. */
export function countMatching(idx: ChildIndex, task: Task, status: TaskStatus): number {
  const kids = idx.get(task.id);
  if (!kids) return inColumn(task.status, status) ? 1 : 0;
  return kids.reduce((n, k) => n + countMatching(idx, k, status), 0);
}

/** Most-recent completion among a subtree's done leaves — orders split cards in
    the LIFO Done column the same way leaf cards are ordered. */
export function latestCompleted(idx: ChildIndex, task: Task): number {
  const kids = idx.get(task.id);
  if (!kids) return task.completedAt ?? 0;
  return kids.reduce((m, k) => Math.max(m, latestCompleted(idx, k)), 0);
}

/** `rootId` plus every descendant under it. Replaces the old per-module subtree
    scans (store.descendantIds, estimate.subtreeIds) with one indexed walk. */
export function subtreeIds(idx: ChildIndex, rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  const stack = [...(idx.get(rootId) ?? [])];
  while (stack.length) {
    const t = stack.pop()!;
    if (ids.has(t.id)) continue;
    ids.add(t.id);
    const kids = idx.get(t.id);
    if (kids) stack.push(...kids);
  }
  return ids;
}

/** True when `rootId` and every task under it have no `scheduledAt` — the tree
    is not on the timeline at all, so the whole thing can still be packed from a
    single anchor (a parent dropped on the grid, or a start time set on the
    first leaf). */
export function treeUnscheduled(idx: ChildIndex, byId: Map<string, Task>, rootId: string): boolean {
  for (const id of subtreeIds(idx, rootId)) {
    if (byId.get(id)?.scheduledAt !== undefined) return false;
  }
  return true;
}
