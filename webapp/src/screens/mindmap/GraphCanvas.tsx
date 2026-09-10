import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMobile } from "../../lib/router";
import { beginTouchDrag, hitData } from "../../lib/touchDrag";
import { NODE_H, NODE_W, type Graph, type GraphNode } from "../../lib/notesGraph";
import { Corners } from "../../components/ui";
import { IFile, IFolder, IMindmap, IMinus, IPlus, ITodo } from "../../components/Icons";

const KIND_ICON = { folder: IFolder, note: IFile, task: ITodo, topic: IMindmap } as const;
const SIZE_SCALE = { sm: 0.92, md: 1, lg: 1.12 } as const;

/** Reusable pan/zoom graph surface for every "from notes" lens. Nodes and edges
    are pre-laid-out by notesGraph builders; this only renders + handles gesture,
    selection, focus/search dimming, drag-to-reparent and a minimap. */
export function GraphCanvas({
  graph, selectedId, focusId, dimmed, onSelect, onOpen, onReparent,
}: {
  graph: Graph;
  selectedId: string | null;
  focusId: string | null;
  /** Node ids to fade (search/filter misses). Empty = show all fully. */
  dimmed: Set<string>;
  onSelect: (id: string | null) => void;
  onOpen: (node: GraphNode) => void;
  /** Notes lens only: dropped `from` onto `to`. */
  onReparent?: (fromId: string, toId: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const mobile = useMobile();
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const drag = useRef<string | null>(null);
  const gesture = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  // Touch pinch-zoom state: live positions of every touch pointer, plus the
  // zoom/pan/midpoint captured when the second finger lands. Tracked in the
  // CAPTURE phase so a finger that starts on a node (which stops propagation
  // for its own tap/drag handling) still joins the pinch.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; z0: number; mx: number; my: number; px: number; py: number } | null>(null);

  // Fit the whole graph into view whenever the graph identity changes.
  const fit = () => {
    const el = wrap.current;
    if (!el) return;
    const vw = el.clientWidth, vh = el.clientHeight;
    const z = Math.min(1.1, Math.max(0.3, Math.min(vw / graph.width, vh / graph.height) * 0.94));
    setZoom(z);
    setPan({ x: (vw - graph.width * z) / 2, y: Math.max(16, (vh - graph.height * z) / 2) });
  };
  useLayoutEffect(fit, [graph]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      setZoom((z) => {
        const nz = Math.min(2.2, Math.max(0.25, z * (e.deltaY < 0 ? 1.1 : 0.9)));
        setPan((p) => ({ x: px - ((px - p.x) / z) * nz, y: py - ((py - p.y) / z) * nz }));
        return nz;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    // A press that starts on a control (zoom/fit buttons, node buttons,
    // the outline note picker…) must stay a click: capturing it here
    // retargets the pointerup at the canvas and the click never lands —
    // the controls read as dead buttons.
    if ((e.target as HTMLElement).closest("button, select, input, textarea, a")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
  }
  function onMove(e: React.PointerEvent) {
    if (pinch.current) return; // two fingers own the gesture
    const g = gesture.current;
    if (g) setPan({ x: g.ox + (e.clientX - g.sx), y: g.oy + (e.clientY - g.sy) });
  }
  const endPan = () => { gesture.current = null; };

  function onTouchDown(e: React.PointerEvent) {
    if (e.pointerType !== "touch") return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      const rect = wrap.current!.getBoundingClientRect();
      pinch.current = {
        d0: Math.hypot(a.x - b.x, a.y - b.y), z0: zoom,
        mx: (a.x + b.x) / 2 - rect.left, my: (a.y + b.y) / 2 - rect.top,
        px: pan.x, py: pan.y,
      };
      gesture.current = null;
    }
  }
  function onTouchMove(e: React.PointerEvent) {
    if (!touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (!p || touches.current.size < 2) return;
    const [a, b] = [...touches.current.values()];
    const nz = Math.min(2.2, Math.max(0.25, p.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / p.d0)));
    const rect = wrap.current!.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - rect.left, my = (a.y + b.y) / 2 - rect.top;
    // Keep the graph point under the fingers' original midpoint anchored to
    // their current midpoint, so the pinch zooms around the fingers.
    setZoom(nz);
    setPan({ x: mx - ((p.mx - p.px) / p.z0) * nz, y: my - ((p.my - p.py) / p.z0) * nz });
  }
  function onTouchUp(e: React.PointerEvent) {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
  }

  const center = (n: GraphNode) => ({ x: n.x + NODE_W / 2, y: n.y + NODE_H / 2 });
  const inFocus = (id: string) => !focusId || focusId === id || graph.edges.some((e) => (e.from === focusId && e.to === id) || (e.to === focusId && e.from === id));

  // Auto-zoom onto the highlighted sub-graph: while search/filters dim part of
  // the graph or a node holds focus, keep the surviving nodes fitted in view;
  // once the highlight clears, fall back to the whole-graph fit.
  const fitTo = (nodes: GraphNode[]) => {
    const el = wrap.current;
    if (!el || nodes.length === 0) return;
    const minX = Math.min(...nodes.map((n) => n.x));
    const maxX = Math.max(...nodes.map((n) => n.x + NODE_W));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxY = Math.max(...nodes.map((n) => n.y + NODE_H));
    const vw = el.clientWidth, vh = el.clientHeight;
    const z = Math.min(1.1, Math.max(0.3, Math.min(vw / (maxX - minX + 120), vh / (maxY - minY + 120))));
    setZoom(z);
    setPan({ x: (vw - (maxX - minX) * z) / 2 - minX * z, y: (vh - (maxY - minY) * z) / 2 - minY * z });
  };
  useLayoutEffect(() => {
    const visible = graph.nodes.filter((n) => !dimmed.has(n.id) && inFocus(n.id));
    if (visible.length > 0 && visible.length < graph.nodes.length) fitTo(visible);
    else if (dimmed.size === 0 && !focusId) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, dimmed, focusId]);

  return (
    <div
      ref={wrap}
      className="dotbg graphcanvas"
      style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", touchAction: "none", cursor: gesture.current ? "grabbing" : "grab" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onPointerDownCapture={onTouchDown}
      onPointerMoveCapture={onTouchMove}
      onPointerUpCapture={onTouchUp}
      onPointerCancelCapture={onTouchUp}
      onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "svg") onSelect(null); }}
    >
      <div style={{ position: "absolute", inset: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
        <svg width={graph.width} height={graph.height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
          {graph.edges.map((e) => {
            const a = graph.nodes.find((n) => n.id === e.from);
            const b = graph.nodes.find((n) => n.id === e.to);
            if (!a || !b) return null;
            const ca = center(a), cb = center(b);
            const mx = (ca.x + cb.x) / 2;
            const faded = dimmed.has(e.from) || dimmed.has(e.to) || (!inFocus(e.from) && !inFocus(e.to));
            return (
              <path
                key={e.id}
                d={`M${ca.x},${ca.y} C${mx},${ca.y} ${mx},${cb.y} ${cb.x},${cb.y}`}
                fill="none"
                stroke={e.kind === "link" ? "var(--accent-mid)" : "color-mix(in srgb, var(--color-accent) 45%, transparent)"}
                // The whole canvas is CSS-scaled by `zoom`, so a fixed stroke
                // renders at 1.4×zoom on screen — at a phone's fit zoom
                // (clamped 0.3) that's a translucent half-pixel hairline, i.e.
                // invisible links. Dividing by zoom keeps edges (and the dash
                // rhythm) at a constant on-screen weight at every zoom.
                strokeWidth={1.4 / zoom}
                strokeDasharray={e.kind === "link" ? `${4 / zoom} ${4 / zoom}` : undefined}
                opacity={faded ? 0.12 : e.kind === "link" ? 0.6 : 0.9}
              />
            );
          })}
        </svg>

        {graph.nodes.map((n) => {
          const Icon = KIND_ICON[n.kind];
          const faded = dimmed.has(n.id) || !inFocus(n.id);
          const selected = selectedId === n.id;
          const scale = SIZE_SCALE[n.size];
          return (
            <div
              key={n.id}
              className="blueprint graphnode"
              data-graph-node={n.id}
              draggable={!!onReparent && n.kind === "note"}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (!onReparent || n.kind !== "note") return;
                // Touch reparent: long-press a note node, drop it on another
                // node. A second finger means a pinch — the hold aborts.
                beginTouchDrag(e, {
                  label: n.label,
                  canStart: () => touches.current.size < 2,
                  onStart: () => { drag.current = n.id; },
                  onMove: (mx, my) => {
                    const hit = hitData(mx, my, "data-graph-node");
                    setDropTarget(hit && hit.value !== n.id ? hit.value : null);
                  },
                  onDrop: (mx, my) => {
                    const hit = hitData(mx, my, "data-graph-node");
                    if (hit && hit.value !== n.id) onReparent(n.id, hit.value);
                  },
                  onEnd: () => { drag.current = null; setDropTarget(null); },
                });
              }}
              onDragStart={(e) => { drag.current = n.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", n.id); }}
              onDragEnd={() => { drag.current = null; setDropTarget(null); }}
              onDragOver={(e) => { if (onReparent && drag.current && drag.current !== n.id) { e.preventDefault(); setDropTarget(n.id); } }}
              onDrop={(e) => { e.preventDefault(); if (onReparent && drag.current && drag.current !== n.id) onReparent(drag.current, n.id); setDropTarget(null); }}
              onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
              onDoubleClick={(e) => { e.stopPropagation(); onOpen(n); }}
              style={{
                position: "absolute", left: n.x, top: n.y, width: NODE_W, minHeight: NODE_H,
                transform: `scale(${scale})`, transformOrigin: "left center",
                display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                background: selected ? "var(--accent-soft)" : "var(--color-card)",
                borderColor: selected ? "var(--color-accent)" : dropTarget === n.id ? "var(--accent-mid)" : undefined,
                outline: dropTarget === n.id ? "1.5px dashed var(--accent-mid)" : undefined,
                boxShadow: selected ? "var(--shadow-sm)" : undefined,
                opacity: faded ? 0.28 : n.heat !== undefined ? 0.72 + n.heat * 0.28 : 1,
                cursor: "pointer", userSelect: "none",
              }}
              title={n.label}
            >
              <Corners />
              <span style={{ flex: "none", display: "flex", color: n.accent }}><Icon size={15} /></span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</span>
                {n.meta && <span style={{ fontSize: 10, color: "var(--color-text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.meta}</span>}
              </span>
              {n.ring !== undefined && <Ring frac={n.ring} />}
              {n.flags.map((f) => <FlagDot key={f} flag={f} />)}
              {n.badge !== undefined && (
                // Amber stays light in both themes, so the count needs a fixed
                // dark ink — --on-accent is white in light mode and washed out here.
                <span style={{ flex: "none", minWidth: 16, height: 16, padding: "0 4px", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#17171f", background: "var(--st-pending)", borderRadius: 8 }}>
                  {n.badge}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <Controls zoom={zoom} onZoom={(d) => setZoom((z) => Math.min(2.2, Math.max(0.25, +(z + d).toFixed(2))))} onFit={fit} />
      {/* The 150×100 minimap covered a third of a phone-width canvas. */}
      {!mobile && <Minimap graph={graph} pan={pan} zoom={zoom} wrap={wrap} />}
    </div>
  );
}

function Ring({ frac }: { frac: number }) {
  const r = 6, c = 2 * Math.PI * r;
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" style={{ flex: "none" }} aria-label={`${Math.round(frac * 100)}% done`}>
      <circle cx={8} cy={8} r={r} fill="none" stroke="var(--color-divider)" strokeWidth={2} />
      <circle cx={8} cy={8} r={r} fill="none" stroke="var(--st-done)" strokeWidth={2} strokeDasharray={`${frac * c} ${c}`} transform="rotate(-90 8 8)" strokeLinecap="round" />
    </svg>
  );
}

const FLAG_META: Record<string, { color: string; title: string }> = {
  hub: { color: "var(--color-accent)", title: "Hub — many links" },
  orphan: { color: "var(--color-text-3)", title: "Orphan — unlinked" },
  stale: { color: "var(--st-skipped)", title: "Stale — untouched 30+ days" },
  due: { color: "var(--prio-hi-text)", title: "A linked task is due soon" },
};
function FlagDot({ flag }: { flag: string }) {
  const m = FLAG_META[flag];
  return <span title={m.title} style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: m.color }} />;
}

function Controls({ zoom, onZoom, onFit }: { zoom: number; onZoom: (d: number) => void; onFit: () => void }) {
  return (
    <div style={{ position: "absolute", left: 14, bottom: 14, display: "flex", flexDirection: "column", gap: 4 }}>
      <button className="btn btn-icon btn-secondary" style={{ width: 30, height: 30, background: "var(--color-bg)" }} onClick={() => onZoom(0.1)} aria-label="Zoom in"><IPlus size={15} strokeWidth={1.6} /></button>
      <button className="btn btn-icon btn-secondary" style={{ width: 30, height: 30, background: "var(--color-bg)" }} onClick={() => onZoom(-0.1)} aria-label="Zoom out"><IMinus size={15} strokeWidth={1.6} /></button>
      <button className="btn btn-secondary" style={{ width: 30, height: 30, padding: 0, fontSize: 10, background: "var(--color-bg)" }} onClick={onFit} aria-label="Fit to view" title="Fit to view">fit</button>
      <span style={{ fontSize: 10, color: "var(--color-text-3)", textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
    </div>
  );
}

/** Scaled overview with a viewport rectangle. */
function Minimap({ graph, pan, zoom, wrap }: { graph: Graph; pan: { x: number; y: number }; zoom: number; wrap: React.RefObject<HTMLDivElement> }) {
  const W = 150, H = 100;
  const s = Math.min(W / graph.width, H / graph.height);
  const vw = wrap.current?.clientWidth ?? 800, vh = wrap.current?.clientHeight ?? 600;
  const view = { x: (-pan.x / zoom) * s, y: (-pan.y / zoom) * s, w: (vw / zoom) * s, h: (vh / zoom) * s };
  return (
    <div style={{ position: "absolute", right: 14, bottom: 14, width: W, height: H, background: "var(--color-bg)", border: "1px solid var(--color-divider)", borderRadius: "var(--radius)", overflow: "hidden", pointerEvents: "none" }}>
      <svg width={W} height={H}>
        {graph.nodes.map((n) => <rect key={n.id} x={n.x * s} y={n.y * s} width={Math.max(2, NODE_W * s)} height={Math.max(1.5, NODE_H * s)} fill="color-mix(in srgb, var(--color-accent) 45%, transparent)" />)}
        <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="none" stroke="var(--color-accent)" strokeWidth={1} />
      </svg>
    </div>
  );
}
