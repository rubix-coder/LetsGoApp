// Long-press touch dragging for surfaces built on the HTML5 drag-and-drop
// API, which mobile browsers never fire from touch input. Hold a card ~a
// third of a second without moving and a floating chip attaches to the
// finger; drop targets are resolved by the caller via elementFromPoint hit
// tests (there is no `dragover` on this path). Moving before the hold arms
// cancels silently, so normal scrolling always wins. Mouse pointers are
// ignored — desktop keeps its native drag behavior untouched.

const HOLD_MS = 350;
const SLOP_PX = 8;

export interface TouchDragOpts {
  /** Text on the floating chip under the finger. */
  label: string;
  /** Veto right before the hold arms (e.g. a second finger began a pinch). */
  canStart?: () => boolean;
  /** The hold armed and the drag began, at viewport (x, y). */
  onStart?: (x: number, y: number) => void;
  /** Every move while dragging (viewport coords). */
  onMove?: (x: number, y: number) => void;
  /** Finger lifted while dragging. */
  onDrop: (x: number, y: number) => void;
  /** Always runs last, after drop, cancel, or an unarmed release. */
  onEnd?: () => void;
}

/** Swallow the synthetic click a browser fires at the drag's source element
    right after the finger lifts — without this, dropping a card also "taps"
    it and opens the editor. */
function suppressNextClick(): void {
  const stop = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 400);
}

/** Wire a touch drag from a pointerdown. Compose it inside an existing
    onPointerDown handler, or spread `touchDragProps(opts)` when the element
    has none. */
export function beginTouchDrag(e: React.PointerEvent, opts: TouchDragOpts): void {
  if (e.pointerType !== "touch") return;
  const pointerId = e.pointerId;
  const sx = e.clientX, sy = e.clientY;
  let dragging = false;
  let ghost: HTMLDivElement | null = null;

  // Native scroll must stay blocked while dragging; touch-action can't do it
  // (it only applies before the gesture starts), so a non-passive touchmove
  // listener preventDefaults instead.
  const blockScroll = (ev: TouchEvent) => { if (dragging) ev.preventDefault(); };
  const blockMenu = (ev: Event) => ev.preventDefault(); // Android long-press context menu

  const timer = window.setTimeout(() => {
    if (opts.canStart && !opts.canStart()) { cleanup(); opts.onEnd?.(); return; }
    dragging = true;
    ghost = document.createElement("div");
    ghost.textContent = opts.label;
    Object.assign(ghost.style, {
      position: "fixed", left: `${sx}px`, top: `${sy}px`, transform: "translate(-50%, -130%)",
      zIndex: "999", pointerEvents: "none", maxWidth: "60vw",
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      background: "var(--color-card)", border: "1px solid var(--color-accent)",
      borderRadius: "8px", padding: "4px 10px", fontSize: "12px", fontWeight: "600",
      color: "var(--color-text)", boxShadow: "var(--shadow-md)",
    });
    document.body.appendChild(ghost);
    opts.onStart?.(sx, sy);
  }, HOLD_MS);

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    if (!dragging) {
      // Moved before the hold armed: this is a scroll, not a drag.
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > SLOP_PX) { cleanup(); opts.onEnd?.(); }
      return;
    }
    if (ghost) { ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`; }
    opts.onMove?.(ev.clientX, ev.clientY);
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const dropped = dragging;
    const x = ev.clientX, y = ev.clientY;
    cleanup();
    if (dropped) {
      suppressNextClick();
      opts.onDrop(x, y);
    }
    opts.onEnd?.();
  };
  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    cleanup();
    opts.onEnd?.();
  };

  function cleanup() {
    window.clearTimeout(timer);
    dragging = false;
    ghost?.remove();
    ghost = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("touchmove", blockScroll);
    window.removeEventListener("contextmenu", blockMenu);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("touchmove", blockScroll, { passive: false });
  window.addEventListener("contextmenu", blockMenu);
}

/** Spreadable `{ onPointerDown }` for elements with no pointerdown of their own. */
export function touchDragProps(opts: TouchDragOpts): { onPointerDown: (e: React.PointerEvent) => void } {
  return { onPointerDown: (e) => beginTouchDrag(e, opts) };
}

/** The element (or ancestor) under a viewport point carrying `attr`, e.g.
    `hitData(x, y, "data-kanban-col")` — the drop-target resolver for this
    drag path. */
export function hitData(x: number, y: number, attr: string): { el: HTMLElement; value: string } | null {
  const el = document.elementFromPoint(x, y)?.closest(`[${attr}]`) as HTMLElement | null;
  const value = el?.getAttribute(attr);
  return el && value !== null && value !== undefined ? { el, value } : null;
}
