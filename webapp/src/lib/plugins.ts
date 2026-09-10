/* The order plugins appear in — sidebar, mobile tab bar and settings alike.

   Kept out of the components because all three surfaces have to agree: a
   reorder that only moved the settings rows would be a lie, since the whole
   point is to arrange the tabs. */

import { PLUGIN_META, type PluginId } from "./types";

export type PluginMeta = (typeof PLUGIN_META)[number];

/** The stored order, repaired.

    A stored order is never trusted as complete. It is written by an older
    version of the app that did not know about plugins added since, and it
    survives in a vault synced from another device — so anything it omits is
    appended in the built-in order, and anything it names that no longer
    exists is dropped. Without that, adding a plugin would make it invisible
    to every user who had ever dragged a row. */
export function orderedPlugins(order: readonly PluginId[] | undefined): PluginMeta[] {
  if (!order || order.length === 0) return [...PLUGIN_META];

  const byId = new Map(PLUGIN_META.map((p) => [p.id, p]));
  const out: PluginMeta[] = [];
  const placed = new Set<PluginId>();

  for (const id of order) {
    const meta = byId.get(id);
    // Unknown id (a plugin removed since) or a duplicate — skip, don't throw.
    if (!meta || placed.has(id)) continue;
    out.push(meta);
    placed.add(id);
  }
  for (const meta of PLUGIN_META) {
    if (!placed.has(meta.id)) out.push(meta);
  }
  return out;
}

/** Moves `id` to sit where `targetId` currently is.

    Returns a complete list of every plugin id, so what gets stored is always
    self-repairing rather than a partial order that drifts. */
export function movePlugin(
  order: readonly PluginId[] | undefined,
  id: PluginId,
  targetId: PluginId,
): PluginId[] {
  const ids = orderedPlugins(order).map((p) => p.id);
  if (id === targetId) return ids;
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const [moved] = ids.splice(from, 1);
  const to = ids.indexOf(targetId);
  if (to < 0) return ids;
  ids.splice(to, 0, moved);
  return ids;
}
