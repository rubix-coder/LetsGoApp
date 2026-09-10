/* A grid of panels the user can rearrange and resize.

   Used by the Dashboard and the Events list so both surfaces behave
   identically: grab a panel's handle to move it, drag its bottom-right grip
   to change how many columns and rows it covers. The arithmetic lives in
   lib/panelLayout.ts; this file is the interaction.

   Why a handle rather than dragging the whole card: dashboard panels are full
   of buttons — the donut legend, "Open planner", habit ticks — and making the
   card itself draggable turns every one of those into a coin flip between a
   click and a drag. The handle and the resize grip stay invisible until the
   panel is hovered or something inside it is focused, so an untouched
   dashboard looks exactly as it did before.

   Touch gets the same two gestures through lib/touchDrag (long-press to move)
   and plain pointer events on the grip, because mobile browsers never fire
   HTML5 drag events from a finger. */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  dropSide,
  movePanel,
  resizePanel,
  spanFromDrag,
  type PanelDef,
  type PanelSpan,
} from "../lib/panelLayout";
import { beginTouchDrag, hitData } from "../lib/touchDrag";
import { IGrab } from "./Icons";

/** Drag payload key. Distinct from the board's "text/task-id" so a task
    dragged from the planner can never be read as a panel. */
const PANEL_MIME = "text/panel-id";

export interface PanelGridProps {
  /** What each panel is and how big it wants to be. Render order comes from
      `layout`, not from this list. */
  defs: readonly PanelDef[];
  layout: readonly PanelSpan[];
  onLayoutChange: (next: PanelSpan[]) => void;
  /** Panel body by id. A panel whose id has no entry renders empty. */
  children: (id: string) => ReactNode;
  cols: number;
  /** Height of one grid row, in pixels. */
  rowHeight: number;
  gap?: number;
  /** Turn the gestures off — the mobile shell stacks panels and has no room
      for a two-dimensional grid. */
  locked?: boolean;
  ariaLabel: string;
}

interface DropHint {
  targetId: string;
  place: "before" | "after";
}

export function PanelGrid({
  defs, layout, onLayoutChange, children, cols, rowHeight, gap = 16, locked, ariaLabel,
}: PanelGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);
  // The panel whose grip is being dragged, and the footprint it started from.
  const [resizing, setResizing] = useState<{ id: string; w: number; h: number } | null>(null);
  // Measured once per resize: one column's width including its gap.
  const cellRef = useRef({ width: 0, height: 0 });

  const defById = new Map(defs.map((d) => [d.id, d]));

  const measureCell = useCallback(() => {
    const width = gridRef.current?.getBoundingClientRect().width ?? 0;
    cellRef.current = {
      // A grid of `cols` tracks has `cols - 1` gaps between them.
      width: cols > 0 ? (width - gap * (cols - 1)) / cols + gap : 0,
      height: rowHeight + gap,
    };
  }, [cols, gap, rowHeight]);

  useLayoutEffect(measureCell, [measureCell]);

  function commitMove(id: string, targetId: string, place: "before" | "after") {
    onLayoutChange(movePanel(layout, id, targetId, place));
  }

  function endDrag() {
    setDragId(null);
    setHint(null);
  }

  function arm(panel: HTMLElement | null) {
    panel?.setAttribute("draggable", "true");
  }

  function disarm(panel: HTMLElement | null) {
    panel?.removeAttribute("draggable");
  }

  /** Resolve a drop from viewport coordinates — the touch path has no
      dragover to tell it which panel it is over. */
  function dropAt(id: string, x: number, y: number) {
    const target = hitData(x, y, "data-panel-id");
    if (!target || target.value === id) return;
    const rect = target.el.getBoundingClientRect();
    commitMove(id, target.value, dropSide(x, rect));
  }

  function startResize(e: React.PointerEvent, span: PanelSpan) {
    e.preventDefault();
    e.stopPropagation();
    measureCell();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { w: span.w, h: span.h };
    setResizing({ id: span.id, ...start });
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    let latest = start;
    const onMove = (ev: PointerEvent) => {
      const next = spanFromDrag(start, ev.clientX - startX, ev.clientY - startY, cellRef.current);
      if (next.w === latest.w && next.h === latest.h) return;
      latest = next;
      // Live, not on release: a resize you cannot see until you let go is a
      // guess, and every guess costs another drag.
      onLayoutChange(resizePanel(layout, defs, span.id, next.w, next.h, cols));
      setResizing({ id: span.id, ...next });
    };
    const onUp = () => {
      setResizing(null);
      target.releasePointerCapture?.(e.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  /** Keyboard equivalents, so the layout is not mouse-only: arrows move the
      panel among its siblings, shift+arrows resize it. */
  function onHandleKey(e: React.KeyboardEvent, span: PanelSpan, index: number) {
    const def = defById.get(span.id);
    if (!def) return;
    const step = (dw: number, dh: number) => {
      e.preventDefault();
      onLayoutChange(resizePanel(layout, defs, span.id, span.w + dw, span.h + dh, cols));
    };
    const shift = (delta: number) => {
      const neighbour = layout[index + delta];
      if (!neighbour) return;
      e.preventDefault();
      commitMove(span.id, neighbour.id, delta < 0 ? "before" : "after");
    };
    if (e.key === "ArrowLeft") return e.shiftKey ? step(-1, 0) : shift(-1);
    if (e.key === "ArrowRight") return e.shiftKey ? step(1, 0) : shift(1);
    if (e.key === "ArrowUp") return e.shiftKey ? step(0, -1) : shift(-1);
    if (e.key === "ArrowDown") return e.shiftKey ? step(0, 1) : shift(1);
  }

  return (
    <div
      ref={gridRef}
      className="panel-grid"
      role="list"
      aria-label={ariaLabel}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: `${rowHeight}px`,
        gap,
      }}
    >
      {layout.map((span, index) => {
        const def = defById.get(span.id);
        if (!def) return null;
        const isDragging = dragId === span.id;
        const isResizing = resizing?.id === span.id;
        return (
          <div
            key={span.id}
            role="listitem"
            data-panel-id={span.id}
            className="panel"
            data-dragging={isDragging ? "true" : undefined}
            data-resizing={isResizing ? "true" : undefined}
            data-drop={hint?.targetId === span.id ? hint.place : undefined}
            style={{ gridColumn: `span ${span.w}`, gridRow: `span ${span.h}` }}
            onDragStart={(e) => {
              e.dataTransfer.setData(PANEL_MIME, span.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={(e) => { disarm(e.currentTarget); endDrag(); }}
            onDragOver={(e) => {
              if (!dragId || dragId === span.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const place = dropSide(e.clientX, e.currentTarget.getBoundingClientRect());
              if (hint?.targetId !== span.id || hint.place !== place) setHint({ targetId: span.id, place });
            }}
            onDragLeave={(e) => {
              // Only when the pointer truly left this panel — moving over a
              // child fires dragleave on the parent too.
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setHint((h) => (h?.targetId === span.id ? null : h));
              }
            }}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(PANEL_MIME) || dragId;
              if (!id || id === span.id) return endDrag();
              e.preventDefault();
              commitMove(id, span.id, dropSide(e.clientX, e.currentTarget.getBoundingClientRect()));
              endDrag();
            }}
          >
            {children(span.id)}
            {!locked && (
              <>
                <button
                  type="button"
                  className="panel-handle"
                  aria-label={`Move ${def.title}. Arrow keys reorder, shift with arrow keys resizes.`}
                  title={`Drag to move ${def.title}`}
                  // `draggable` is set on the PANEL, imperatively, the moment
                  // the handle is pressed — not through React state. The
                  // browser reads the attribute when the gesture begins, and
                  // a state round-trip is not guaranteed to have landed by
                  // then. Leaving it permanently on is not an option either:
                  // a draggable container kills text selection inside it, and
                  // makes every button in the card a drag target.
                  onPointerDown={(e) => {
                    const panel = (e.currentTarget as HTMLElement).closest<HTMLElement>(".panel");
                    if (e.pointerType === "mouse") {
                      arm(panel);
                      setDragId(span.id);
                      return;
                    }
                    beginTouchDrag(e, {
                      label: def.title,
                      onStart: () => setDragId(span.id),
                      onDrop: (x, y) => dropAt(span.id, x, y),
                      onEnd: endDrag,
                    });
                  }}
                  // A press that never became a drag must not leave the panel
                  // armed, or the next click-drag of selected text picks it up.
                  onPointerUp={(e) => {
                    disarm((e.currentTarget as HTMLElement).closest<HTMLElement>(".panel"));
                    if (!hint) setDragId(null);
                  }}
                  onKeyDown={(e) => onHandleKey(e, span, index)}
                >
                  <IGrab size={14} />
                </button>
                <span
                  className="panel-grip"
                  role="separator"
                  aria-label={`Resize ${def.title}`}
                  aria-orientation="horizontal"
                  onPointerDown={(e) => startResize(e, span)}
                />
                {isResizing && <span className="panel-size">{span.w} × {span.h}</span>}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
