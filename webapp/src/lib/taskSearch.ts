/* Task search that sees the whole tree.

   The original board filter tested ROOT titles only, so a search for any
   nested subtask — which is most tasks after a markdown/iCal import — found
   nothing and the feature read as broken. A root is now kept when ANY task in
   its subtree matches, and the matched subtrees' ids are returned so views
   that walk the tree themselves (Gantt) can honor the same filter. */

import type { Task } from "./types";
import { childIndex, subtreeIds } from "./taskTree";

/** Title or tag match. A query led by "#" targets tags alone (the search box
    advertises "#tag"); tags themselves are stored bare, so the "#" is ours to
    strip. */
export function taskMatches(t: Task, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  const tagOnly = query.startsWith("#");
  const q = tagOnly ? query.slice(1) : query;
  if (q === "") return false;
  if (!tagOnly && t.title.toLowerCase().includes(q)) return true;
  return t.tags.some((tag) => tag.toLowerCase().includes(q));
}

/** Filters `roots` to those whose subtree contains a match; `ids` is the union
    of kept subtrees (null = no filtering, empty query). */
export function searchTaskTree(
  roots: readonly Task[],
  all: readonly Task[],
  rawQuery: string,
): { roots: Task[]; ids: Set<string> | null } {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return { roots: [...roots], ids: null };

  const idx = childIndex(all);
  const matchedRoots: Task[] = [];
  const ids = new Set<string>();

  for (const root of roots) {
    const subtree = subtreeIds(idx, root.id);
    const byId = new Map(all.filter((t) => subtree.has(t.id)).map((t) => [t.id, t]));
    let hit = false;
    for (const id of subtree) {
      const t = byId.get(id);
      if (t && taskMatches(t, query)) { hit = true; break; }
    }
    if (!hit) continue;
    matchedRoots.push(root);
    for (const id of subtree) ids.add(id);
  }
  return { roots: matchedRoots, ids };
}
