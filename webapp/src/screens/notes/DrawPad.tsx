import { useEffect, useRef, useState } from "react";
import { IReset, ITrash } from "../../components/Icons";

/* A sketch surface embedded in a note.

   Strokes are stored as JSON inside a fenced ```draw block, so the note body
   stays plain markdown: export, NAS sync, the team document and the block
   editor's parse/serialise round-trip all carry a drawing without knowing what
   it is. Fenced blocks are already preserved verbatim, which is why this needed
   no parser change at all.

   Input is PointerEvents, so a stylus, a finger and a mouse all land in the
   same handler. A pen additionally reports `pressure`, which drives line width
   — that is the whole reason to prefer pointer over mouse/touch events here.
   Devices that report no pressure send a constant 0.5, so the line simply comes
   out even.

   The canvas has a FIXED logical size and is scaled to the available width, so
   a sketch drawn on a phone opens at the same proportions on a desktop instead
   of reflowing into a different picture. */

const LOGICAL_W = 1400;
const LOGICAL_H = 900;

/** Flat [x, y, pressure, x, y, pressure, …] — a third the JSON of an array of
    objects, which matters when the whole vault lives in localStorage. */
interface Stroke {
  /** Colour; ignored for an eraser stroke. */
  c: string;
  /** Base width in logical pixels. */
  s: number;
  /** 1 = eraser (composited out rather than painted). */
  e?: 1;
  p: number[];
}

interface DrawDoc {
  v: 1;
  /** Paper style; absent = plain. Travels in the JSON so a drawing keeps its
      ruling wherever the note is opened. */
  bg?: "plain" | "grid" | "dots" | "lines" | "checks";
  strokes: Stroke[];
}

const PAPERS = [
  { id: "plain", label: "Plain" },
  { id: "grid", label: "Grid" },
  { id: "dots", label: "Dotted" },
  { id: "lines", label: "Ruled" },
  { id: "checks", label: "Checked" },
] as const;
type Paper = (typeof PAPERS)[number]["id"];

const EMPTY: DrawDoc = { v: 1, strokes: [] };

function parseDoc(text: string): DrawDoc {
  try {
    const parsed = JSON.parse(text) as DrawDoc;
    if (parsed && Array.isArray(parsed.strokes)) {
      const bg = PAPERS.some((paper) => paper.id === parsed.bg) ? parsed.bg : undefined;
      return { v: 1, bg, strokes: parsed.strokes };
    }
  } catch { /* a corrupt block starts a fresh drawing rather than throwing */ }
  return EMPTY;
}

/** Coordinates are rounded to whole logical pixels: at 1400×900 that is far
    finer than any pen is accurate, and it roughly halves the stored size. */
function serialise(doc: DrawDoc): string {
  return JSON.stringify({
    v: 1,
    ...(doc.bg && doc.bg !== "plain" ? { bg: doc.bg } : {}),
    strokes: doc.strokes.map((s) => ({ ...s, p: s.p.map((n, i) => (i % 3 === 2 ? Math.round(n * 100) / 100 : Math.round(n))) })),
  });
}

/* The default pen is "ink": painted with the live --color-text so it stays
   legible on light AND dark paper. Legacy drawings stored the light-mode text
   hex literally — LEGACY_INK maps those strokes onto the same behaviour
   (pixel-identical in light mode, readable instead of invisible in dark). */
const INK = "ink";
const LEGACY_INK = "#17171f";
const COLORS = [INK, "#7c5cf4", "#22a06b", "#eea23c", "#ec5f77"];
const SIZES = [2, 4, 8, 16];

export function DrawPad({ data, onChange, readOnly }: {
  data: string;
  onChange: (json: string) => void;
  readOnly?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<DrawDoc>(() => parseDoc(data));
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [erasing, setErasing] = useState(false);
  /** The stroke in progress; kept in a ref so a move never re-renders React. */
  const live = useRef<Stroke | null>(null);
  const drawnAt = useRef(data);

  // Adopt an external change (note switch, sync pull), never our own writes.
  useEffect(() => {
    if (data !== drawnAt.current) { setDoc(parseDoc(data)); drawnAt.current = data; }
  }, [data]);

  function paint(ctx: CanvasRenderingContext2D, stroke: Stroke, ink: string) {
    const { p } = stroke;
    if (p.length < 3) return;
    ctx.save();
    ctx.globalCompositeOperation = stroke.e ? "destination-out" : "source-over";
    ctx.strokeStyle = stroke.c === INK || stroke.c === LEGACY_INK ? ink : stroke.c;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // One path per segment so pressure can vary the width along the stroke.
    for (let i = 3; i < p.length; i += 3) {
      const pressure = (p[i + 2] + p[i - 1]) / 2;
      ctx.lineWidth = Math.max(0.5, stroke.s * (0.35 + pressure * 1.3));
      ctx.beginPath();
      ctx.moveTo(p[i - 3], p[i - 2]);
      ctx.lineTo(p[i], p[i + 1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  function redraw() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = canvas.width / LOGICAL_W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const ink = getComputedStyle(canvas).getPropertyValue("--color-text").trim() || LEGACY_INK;
    for (const stroke of doc.strokes) paint(ctx, stroke, ink);
    if (live.current) paint(ctx, live.current, ink);
  }

  // Size the backing store to the element's real pixels so lines stay crisp on
  // a HiDPI screen, and re-render whenever the drawing or the box changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const fit = () => {
      const width = wrap.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round((width * LOGICAL_H / LOGICAL_W) * dpr);
      canvas.style.height = `${Math.round(width * LOGICAL_H / LOGICAL_W)}px`;
      redraw();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  /** Element coordinates → the fixed logical space the strokes are stored in. */
  function toLogical(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * LOGICAL_W,
      ((e.clientY - rect.top) / rect.height) * LOGICAL_H,
    ];
  }

  function pressureOf(e: React.PointerEvent): number {
    // A mouse reports 0.5 while down and 0 otherwise; a finger usually 0 or 1.
    // Only a pen gives a real curve, so everything else is pinned to a
    // mid-value and draws an even line.
    return e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (readOnly || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toLogical(e);
    live.current = { c: color, s: size, e: erasing ? 1 : undefined, p: [x, y, pressureOf(e)] };
    redraw();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!live.current) return;
    // Coalesced events recover the points the browser batched away, which is
    // what keeps a fast stylus stroke smooth rather than faceted.
    const points = typeof e.nativeEvent.getCoalescedEvents === "function"
      ? e.nativeEvent.getCoalescedEvents()
      : [e.nativeEvent];
    const rect = e.currentTarget.getBoundingClientRect();
    for (const point of points) {
      live.current.p.push(
        ((point.clientX - rect.left) / rect.width) * LOGICAL_W,
        ((point.clientY - rect.top) / rect.height) * LOGICAL_H,
        point.pointerType === "pen" && point.pressure > 0 ? point.pressure : 0.5,
      );
    }
    redraw();
  }

  function endStroke() {
    const stroke = live.current;
    live.current = null;
    if (!stroke || stroke.p.length < 6) { redraw(); return; }   // a tap is not a stroke
    commit({ v: 1, bg: doc.bg, strokes: [...doc.strokes, stroke] });
  }

  function commit(next: DrawDoc) {
    const json = serialise(next);
    drawnAt.current = json;
    setDoc(next);
    onChange(json);
  }

  const undo = () => commit({ v: 1, bg: doc.bg, strokes: doc.strokes.slice(0, -1) });
  const clear = () => commit({ v: 1, bg: doc.bg, strokes: [] }); // clearing empties the page, not the paper choice
  const setPaper = (bg: Paper) => commit({ v: 1, bg: bg === "plain" ? undefined : bg, strokes: doc.strokes });

  return (
    <div className="drawpad" ref={wrapRef}>
      {!readOnly && (
        <div className="drawpad-bar">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => { setColor(c); setErasing(false); }}
              aria-label={c === INK ? "Ink (follows the theme's text color)" : `Ink ${c}`}
              aria-pressed={!erasing && color === c}
              className="drawpad-swatch"
              style={{ background: c === INK ? "var(--color-text)" : c, outline: !erasing && color === c ? "2px solid var(--color-accent)" : undefined }}
            />
          ))}
          <span className="drawpad-sep" />
          {SIZES.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              aria-label={`Line width ${s}`}
              aria-pressed={size === s}
              className="drawpad-size"
              style={{ borderColor: size === s ? "var(--color-accent)" : undefined }}
            >
              <span style={{ width: Math.min(14, s + 2), height: Math.min(14, s + 2), background: "currentColor", borderRadius: "50%" }} />
            </button>
          ))}
          <span className="drawpad-sep" />
          <button
            onClick={() => setErasing(!erasing)}
            aria-pressed={erasing}
            className="drawpad-btn"
            style={{ color: erasing ? "var(--color-accent)" : undefined }}
          >
            Eraser
          </button>
          <button onClick={undo} className="drawpad-btn" disabled={!doc.strokes.length} aria-label="Undo last stroke" title="Undo last stroke">
            <IReset size={13} />
          </button>
          <button onClick={clear} className="drawpad-btn" disabled={!doc.strokes.length} aria-label="Clear the drawing" title="Clear the drawing">
            <ITrash size={13} />
          </button>
          <span className="drawpad-sep" />
          {PAPERS.map((paper) => (
            <button
              key={paper.id}
              onClick={() => setPaper(paper.id)}
              aria-label={`${paper.label} paper`}
              aria-pressed={(doc.bg ?? "plain") === paper.id}
              title={`${paper.label} paper`}
              className="drawpad-paper"
              data-paper={paper.id}
              style={{ outline: (doc.bg ?? "plain") === paper.id ? "2px solid var(--color-accent)" : undefined }}
            />
          ))}
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-text-3)" }}>
            {doc.strokes.length ? `${doc.strokes.length} stroke${doc.strokes.length === 1 ? "" : "s"}` : "Draw with a pen, finger or mouse"}
          </span>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="drawpad-canvas"
        data-paper={doc.bg ?? "plain"}
        style={{ cursor: readOnly ? "default" : "crosshair", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onPointerLeave={() => { if (live.current) endStroke(); }}
      />
    </div>
  );
}
