/* Movable, resizable panels — the model behind the Dashboard and the Events
   list letting you build your own view.

   Deliberately a SPAN model, not free x/y placement. Each panel keeps an
   order and a footprint in grid cells (`w` columns × `h` rows) and the CSS
   grid auto-places them in that order. Side-by-side, full-width rows and
   mixed sizes all fall out of it, and three problems never arise: no
   collision solving, no gaps to compact away, and no absolute coordinates
   that stop meaning anything when the window narrows or the column count
   drops on a smaller screen. Reordering is the same operation the plugin
   sidebar already uses; only the footprint is new.

   Layouts are self-repairing (`resolveLayout`), which matters because the set
   of panels moves under a saved layout: dashboard cards come and go with the
   plugins that feed them, and an Events section exists only while it holds
   events. A saved layout is therefore treated as a preference, never as the
   list of what to render — unknown ids are dropped and unmentioned panels are
   appended with their defaults, so a new panel can never be invisible. */

/** What a surface declares about one panel: its identity and how big it wants
    to be before the user says otherwise. */
export interface PanelDef {
  id: string;
  /** Shown on the drag handle's tooltip and to screen readers. */
  title: string;
  /** Default footprint, in grid cells. */
  w: number;
  h: number;
  /** Smallest the user may drag it — a donut at 1×1 is unreadable. */
  minW?: number;
  minH?: number;
}

/** One panel's saved footprint. Order in the array IS the layout order. */
export interface PanelSpan {
  id: string;
  w: number;
  h: number;
}

/** Tallest a panel may be dragged. Beyond this a "panel" is a page, and the
    grid stops being scannable. */
export const MAX_PANEL_H = 6;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** A def's own floor, never below 1 and never above its default. */
export function minWidthOf(def: PanelDef): number {
  return clamp(def.minW ?? 1, 1, def.w);
}

export function minHeightOf(def: PanelDef): number {
  return clamp(def.minH ?? 1, 1, def.h);
}

/** The layout a surface has before anyone touches it. */
export function defaultLayout(defs: readonly PanelDef[], cols: number): PanelSpan[] {
  return defs.map((def) => ({
    id: def.id,
    w: clamp(def.w, minWidthOf(def), Math.max(1, cols)),
    h: clamp(def.h, minHeightOf(def), MAX_PANEL_H),
  }));
}

/** Merge a saved layout with the panels that actually exist right now.

    - entries for panels that are gone are dropped
    - panels the layout never heard of are appended at their default size
    - every footprint is clamped to the current column count, so a layout
      saved on a wide screen still renders on a narrow one */
export function resolveLayout(
  defs: readonly PanelDef[],
  saved: readonly PanelSpan[] | undefined,
  cols: number,
): PanelSpan[] {
  const columns = Math.max(1, cols);
  const byId = new Map(defs.map((def) => [def.id, def]));
  const seen = new Set<string>();
  const resolved: PanelSpan[] = [];

  for (const span of saved ?? []) {
    const def = byId.get(span.id);
    if (!def || seen.has(span.id)) continue;
    seen.add(span.id);
    resolved.push({
      id: span.id,
      w: clamp(Math.round(span.w) || def.w, minWidthOf(def), columns),
      h: clamp(Math.round(span.h) || def.h, minHeightOf(def), MAX_PANEL_H),
    });
  }

  for (const def of defs) {
    if (seen.has(def.id)) continue;
    resolved.push({
      id: def.id,
      w: clamp(def.w, minWidthOf(def), columns),
      h: clamp(def.h, minHeightOf(def), MAX_PANEL_H),
    });
  }

  return resolved;
}

/** Move `id` to sit immediately before or after `targetId`. Dropping a panel
    on itself, or on a target that isn't there, leaves the layout alone. */
export function movePanel(
  layout: readonly PanelSpan[],
  id: string,
  targetId: string,
  place: "before" | "after",
): PanelSpan[] {
  if (id === targetId) return [...layout];
  const from = layout.findIndex((p) => p.id === id);
  const target = layout.findIndex((p) => p.id === targetId);
  if (from < 0 || target < 0) return [...layout];

  const next = [...layout];
  const [moved] = next.splice(from, 1);
  // Recompute after the removal — the target's index shifts when the panel
  // being moved sat before it.
  const at = next.findIndex((p) => p.id === targetId);
  next.splice(place === "before" ? at : at + 1, 0, moved);
  return next;
}

/** Set a panel's footprint, clamped to its own minimum and the grid. */
export function resizePanel(
  layout: readonly PanelSpan[],
  defs: readonly PanelDef[],
  id: string,
  w: number,
  h: number,
  cols: number,
): PanelSpan[] {
  const def = defs.find((d) => d.id === id);
  if (!def) return [...layout];
  const columns = Math.max(1, cols);
  return layout.map((panel) =>
    panel.id === id
      ? {
        id: panel.id,
        w: clamp(Math.round(w), minWidthOf(def), columns),
        h: clamp(Math.round(h), minHeightOf(def), MAX_PANEL_H),
      }
      : panel);
}

/** True when the layout is exactly what the surface ships with — drives
    whether a "Reset layout" affordance is worth showing at all. */
export function isDefaultLayout(
  layout: readonly PanelSpan[],
  defs: readonly PanelDef[],
  cols: number,
): boolean {
  const base = defaultLayout(defs, cols);
  if (layout.length !== base.length) return false;
  return layout.every((panel, i) =>
    panel.id === base[i].id && panel.w === base[i].w && panel.h === base[i].h);
}

/** Which side of `targetId` a pointer at `x` is asking for. Panels are laid
    out left-to-right, so the horizontal midpoint is the only question — using
    the vertical one as well made a drag across a tall panel flip sides
    depending on how high the cursor happened to be. */
export function dropSide(x: number, rect: { left: number; width: number }): "before" | "after" {
  return x < rect.left + rect.width / 2 ? "before" : "after";
}

/** Footprint after dragging a resize grip by (dx, dy) pixels, in whole cells.
    `cell` is the on-screen size of one grid cell including its gap. */
export function spanFromDrag(
  start: { w: number; h: number },
  dx: number,
  dy: number,
  cell: { width: number; height: number },
): { w: number; h: number } {
  const stepX = cell.width > 0 ? Math.round(dx / cell.width) : 0;
  const stepY = cell.height > 0 ? Math.round(dy / cell.height) : 0;
  return { w: start.w + stepX, h: start.h + stepY };
}
