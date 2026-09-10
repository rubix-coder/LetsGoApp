import { useEffect, useRef, useState } from "react";
import { useStore } from "../../lib/store";
import { nav } from "../../lib/router";
import { playChime } from "../../lib/sound";
import { newBook } from "../../lib/books";
import { markAsBought } from "../../lib/bookLink";
import { httpBookGateway } from "../../lib/bookApi";
import { claudeApiMessage, hasClaudeKey, httpVisionGateway, toJpegBase64 } from "../../lib/claudeApi";
import { identifyCover } from "../../lib/coverVision";
import { lookupIsbn, mergeLookupIntoBook } from "../../lib/bookLookup";
import {
  acceptScan, EMPTY_SESSION, resolveScan, scanCounts, type ScanSession,
} from "../../lib/bookScan";
import { IBack, ICamera } from "../../components/Icons";
import { createBarcodeDetector, type DetectorSource } from "../../lib/barcodeDetector";

/** Roughly 15 detections a second. Faster wins nothing — the camera does not
    deliver new information that quickly — and it starves the main thread. */
const DETECT_INTERVAL_MS = 66;

type CameraState =
  | { kind: "starting" }
  | { kind: "running" }
  | { kind: "unavailable"; message: string };

/** Rapid-fire barcode capture: point, beep, next.

    The design decision that matters is that a book is committed to the vault
    the moment its barcode is accepted, BEFORE any lookup. Scanning a shelf in
    a basement with no signal still produces a complete shelf — the records
    just carry their ISBN as the title until "Resolve" heals them later. There
    is no queue to lose, and nothing to reconcile if the tab is closed. */
/** What a scan is FOR.

    "shelf" files what it reads as a book you own; "wishlist" files it as one
    you want, which is the mode you use standing in a shop deciding later.
    Everything else about the scanner — the camera, the decoder, the dedupe —
    is identical, so this is a single prop rather than a second screen. */
export type ScanIntent = "shelf" | "wishlist";

export function ScanMode({ intent = "shelf" }: { intent?: ScanIntent } = {}) {
  const wishlisting = intent === "wishlist";
  const { state, dispatch } = useStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<CameraState>({ kind: "starting" });
  const [session, setSession] = useState<ScanSession>(EMPTY_SESSION);
  const [typed, setTyped] = useState("");
  const [flash, setFlash] = useState(false);
  const [decoder, setDecoder] = useState<DetectorSource | null>(null);
  /* Camera controls, only offered when the hardware actually reports them —
     `getCapabilities` is absent on Firefox and torch/zoom are missing on most
     desktop webcams, and a dead toggle is worse than no toggle. */
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [canTorch, setCanTorch] = useState(false);
  const [zoom, setZoom] = useState<{ min: number; max: number; step: number; value: number } | null>(null);
  /* "Nothing has decoded for a while." Rejected reads are deliberately silent
     — the camera is pointed at nothing in particular most of the time — but
     that makes a barcode which genuinely will not read look identical to not
     aiming properly. After a stretch of nothing, say so and point at the
     manual field. */
  const [stuck, setStuck] = useState(false);

  // The detect loop must never re-render React — at 15Hz it would thrash the
  // tree constantly. Everything it touches lives in a ref (the same
  // discipline DrawPad uses for in-progress strokes); state is written only
  // when a scan is actually accepted, a few times a second at most.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const soundsRef = useRef(state.settings.sounds);
  soundsRef.current = state.settings.sounds;
  // The detect loop runs off refs, so the shelf it checks against must be one
  // too — a stale closure here would miss books added earlier in the session.
  const booksRef = useRef(state.books);
  booksRef.current = state.books;
  const wishlistingRef = useRef(wishlisting);
  wishlistingRef.current = wishlisting;
  const lastAcceptRef = useRef(Date.now());

  /** Commits the book, then fills it in behind the scenes.

      A book already on the shelf is reported rather than added again. The
      session's own dedupe only covers barcodes seen since the scanner opened,
      so without this a shelf catalogued across two sittings gained a second
      copy of everything re-scanned. */
  function capture(isbn13: string) {
    const owned = booksRef.current.find((b) => b.isbn13 === isbn13);
    const unresolvedOwned = owned && owned.title.trim() === owned.isbn13;

    if (owned && !unresolvedOwned) {
      /* Scanning a wishlist book while cataloguing the shelf means you bought
         it — which is the moment the wishlist exists to end. Reporting it as
         a duplicate instead would leave it stuck on the wanted list forever,
         and the one action that clears it is the one you just performed. */
      if (!wishlistingRef.current && owned.status === "wishlist") {
        dispatch({ type: "upsertBook", book: markAsBought(owned) });
        setSession((s) => resolveScan(s, isbn13, { state: "ok", title: owned.title }));
        return;
      }
      setSession((s) => resolveScan(s, isbn13, { state: "dupe", title: owned.title }));
      return;
    }

    // Either brand new, or owned but still titled by its ISBN — in which case
    // the lookup is worth running again, against the record already there so
    // the reducer updates it rather than adding another.
    const book = owned ?? newBook({
      isbn13,
      title: isbn13,
      status: wishlistingRef.current ? "wishlist" : "unread",
      source: wishlistingRef.current ? "scan:wishlist" : "scan",
    });
    dispatch({ type: "upsertBook", book });

    void (async () => {
      try {
        const outcome = await lookupIsbn(isbn13, httpBookGateway);
        if (outcome.kind === "found") {
          dispatch({ type: "upsertBook", book: mergeLookupIntoBook(book, outcome.result) });
          setSession((s) => resolveScan(s, isbn13, { state: "ok", title: outcome.result.title }));
        } else if (outcome.kind === "not-found") {
          // Genuinely absent from both databases — common for India-only
          // reprints and small regional publishers. The book stays; the user
          // finishes it by title search or by hand.
          setSession((s) => resolveScan(s, isbn13, { state: "miss" }));
        } else {
          setSession((s) => resolveScan(s, isbn13, { state: "error", error: outcome.reason }));
        }
      } catch (err) {
        setSession((s) => resolveScan(s, isbn13, {
          state: "error",
          error: err instanceof Error ? err.message : "lookup failed",
        }));
      }
    })();
  }

  /** The single funnel for a barcode, wherever it came from. */
  function offer(raw: string, format: string) {
    const outcome = acceptScan(sessionRef.current, raw, format, Date.now());
    if (!outcome.accepted) {
      // Deliberately silent. A rejected read is the normal state while the
      // camera is pointed at nothing in particular; beeping at it would mean
      // beeping continuously.
      return outcome.reason;
    }
    setSession(outcome.session);
    setStuck(false);
    lastAcceptRef.current = Date.now();
    if (soundsRef.current) playChime("scan");
    navigator.vibrate?.(30);
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    capture(outcome.isbn13!);
    return undefined;
  }

  /* Reading the cover instead of the barcode. For the books that have no
     barcode at all — older and academic editions often don't — and for the
     ones whose barcode is too damaged or glossy to decode. Creates a record
     straight from what the model reads, with no ISBN. */
  const [reading, setReading] = useState(false);
  const [visionNote, setVisionNote] = useState("");

  async function identifyFromFrame() {
    const video = videoRef.current;
    if (!video || camera.kind !== "running") return;
    setReading(true);
    setVisionNote("");
    try {
      const base64 = await toJpegBase64(video, video.videoWidth, video.videoHeight);
      const outcome = await identifyCover(base64, "image/jpeg", httpVisionGateway);

      if (outcome.kind === "not-a-book") {
        setVisionNote("That doesn't look like a book — fill the cover in the frame.");
      } else if (outcome.kind !== "found" || !outcome.result) {
        setVisionNote(outcome.reason ?? "Couldn't read that cover.");
      } else {
        const result = outcome.result;
        // Straight onto the shelf, like an accepted barcode. The reducer
        // merges it if the book is already there, so photographing something
        // twice cannot duplicate it either.
        const book = newBook({
          title: result.title,
          authors: result.authors,
          publisher: result.publisher,
          publishedYear: result.publishedYear,
          isbn13: result.isbn13,
          status: wishlisting ? "wishlist" : "unread",
          source: wishlisting ? "photo:wishlist" : "photo",
          lookup: { provider: "vision", at: Date.now() },
        });
        dispatch({ type: "upsertBook", book });
        lastAcceptRef.current = Date.now();
        setStuck(false);
        if (soundsRef.current) playChime("scan");
        navigator.vibrate?.(30);
        setVisionNote(
          outcome.lowConfidence
            ? `Added "${result.title}" — the model wasn't confident, so check it in the library.`
            : `Added "${result.title}".`,
        );
      }
    } catch (err) {
      setVisionNote(claudeApiMessage(err));
    } finally {
      setReading(false);
    }
  }

  /** Torch and zoom go through applyConstraints; both are best-effort, since
      a device can advertise a capability and still refuse the constraint. */
  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setCanTorch(false); // advertised but not actually settable
    }
  }

  async function applyZoom(value: number) {
    const track = trackRef.current;
    if (!track || !zoom) return;
    setZoom({ ...zoom, value });
    try {
      await track.applyConstraints({ advanced: [{ zoom: value }] });
    } catch {
      setZoom(null);
    }
  }

  /* Tap the preview to refocus. Continuous autofocus hunts on a glossy cover
     held close, and a single point of interest settles it. Silently ignored
     where unsupported, which is most desktops. */
  async function focusAt(e: React.MouseEvent<HTMLDivElement>) {
    const track = trackRef.current;
    if (!track) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    try {
      await track.applyConstraints({
        advanced: [{ focusMode: "single-shot", pointsOfInterest: [{ x, y }] }],
      });
    } catch {
      /* not supported here */
    }
  }

  // Watchdog for "this barcode will not read". Only runs while the camera is
  // live, and only says anything after a stretch with nothing accepted.
  useEffect(() => {
    if (camera.kind !== "running") return;
    const id = window.setInterval(() => {
      setStuck(Date.now() - lastAcceptRef.current > 9_000);
    }, 1_500);
    return () => window.clearInterval(id);
  }, [camera.kind]);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;
    let inFlight = false;
    let lastDetect = 0;

    async function start() {
      // Undefined mediaDevices means an insecure origin, which is its own
      // problem and deserves its own wording — it is not a permission issue.
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera({ kind: "unavailable", message: "The camera needs a secure (HTTPS) connection." });
        return;
      }
      // Native where available (Chrome/Android), WASM ponyfill everywhere
      // else. Firefox and Safari take the second path.
      const handle = await createBarcodeDetector();
      if (!handle) {
        setCamera({ kind: "unavailable", message: "This browser can't read barcodes. Type ISBNs below instead." });
        return;
      }
      if (stopped) return;
      setDecoder(handle.source);

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // 1080p is not cosmetic: EAN-13 at arm's length degrades badly at 720p.
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            focusMode: "continuous",
          } as MediaTrackConstraints,
          audio: false,
        });
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        setCamera({
          kind: "unavailable",
          message:
            name === "NotAllowedError" ? "Camera permission was declined — allow it from the address bar, or type ISBNs below."
            : name === "NotFoundError" ? "No camera found on this device."
            : name === "NotReadableError" ? "The camera is already in use by another app."
            : "The camera could not be started.",
        });
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setCamera({ kind: "running" });

      const track = stream.getVideoTracks()[0];
      trackRef.current = track ?? null;
      // Capabilities are read once the track is live; before that they are
      // empty even on hardware that has them.
      const caps: MediaTrackCapabilities = track?.getCapabilities?.() ?? {};
      if (caps.torch) setCanTorch(true);
      if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        const settings: MediaTrackSettings = track?.getSettings?.() ?? {};
        setZoom({
          min: caps.zoom.min,
          max: caps.zoom.max,
          step: caps.zoom.step && caps.zoom.step > 0 ? caps.zoom.step : (caps.zoom.max - caps.zoom.min) / 20,
          value: settings.zoom ?? caps.zoom.min,
        });
      }

      const detector = handle.detector;
      const tick = async (now: number) => {
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        if (document.visibilityState !== "visible") return;
        if (inFlight || now - lastDetect < DETECT_INTERVAL_MS) return;
        lastDetect = now;
        inFlight = true;
        try {
          // A <video> is a CanvasImageSource, so there is no need to copy the
          // frame through a canvas first.
          for (const found of await detector.detect(video)) offer(found.rawValue, found.format);
        } catch {
          // A transient decode failure is normal; the next frame retries.
        } finally {
          inFlight = false;
        }
      };
      raf = requestAnimationFrame(tick);
    }

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      // Without this the camera indicator stays lit after leaving the screen.
      stream?.getTracks().forEach((t) => t.stop());
    };
    // Mounted once: the loop reads everything it needs through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = scanCounts(session);

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    const reason = offer(typed.trim(), "");
    if (reason === undefined || reason === "duplicate") setTyped("");
    if (reason && soundsRef.current) playChime("scanFail");
    if (reason) navigator.vibrate?.([40, 60, 40]);
  }

  return (
    // Forced dark locally, as FocusMode does: light chrome around a camera
    // preview is genuinely unpleasant, and the reticle needs a dark ground.
    <div data-theme="dark" style={{
      position: "fixed", inset: 0, zIndex: 40, background: "var(--color-bg)",
      color: "var(--color-text)", display: "flex", flexDirection: "column",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
        <button
          className="cap"
          onClick={() => nav("/library")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--color-text-2)", cursor: "pointer" }}
        >
          <IBack size={16} strokeWidth={1.6} /> Done
        </button>
        {wishlisting && (
          <span className="tag tag-neutral" style={{ padding: "1px 6px", fontSize: 10 }}>
            adding to wishlist
          </span>
        )}
        {decoder === "wasm" && (
          <span className="tag tag-neutral" style={{ padding: "1px 6px", fontSize: 10 }}>
            software decoder
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-text-2)" }}>
          <strong style={{ color: "var(--color-text)", fontFamily: "var(--font-heading)" }}>{counts.total}</strong> scanned
          {counts.unresolved > 0 && ` · ${counts.unresolved} filling in`}
          {counts.dupes > 0 && ` · ${counts.dupes} already owned`}
        </span>
      </div>

      <div
        onClick={focusAt}
        style={{ position: "relative", flex: 1, minHeight: 0, background: "#000", overflow: "hidden" }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover", display: camera.kind === "running" ? "block" : "none" }}
        />

        {camera.kind === "running" && (
          <div aria-hidden style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: "76%", maxWidth: 420, aspectRatio: "2 / 1",
            border: `2px solid ${flash ? "var(--st-done)" : "rgba(255,255,255,0.55)"}`,
            borderRadius: "var(--radius-card)",
            // Colour only, so the reduced-motion kill-switch in theme.css
            // neutralises it for free.
            transition: "border-color 140ms ease",
          }} />
        )}

        {/* Torch and zoom, offered only where the hardware reports them. */}
        {camera.kind === "running" && (canTorch || zoom) && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute", left: 12, right: 12, bottom: 12, zIndex: 2,
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            {canTorch && (
              <button
                onClick={() => void toggleTorch()}
                aria-pressed={torchOn}
                aria-label="Torch"
                style={{
                  flex: "none", width: 40, height: 40, borderRadius: "50%", cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.35)", fontSize: 17,
                  background: torchOn ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.45)",
                  color: torchOn ? "#111" : "#fff",
                }}
              >
                {/* A glossy cover under indoor light is the single most common
                    reason a barcode will not decode. */}
                ☀
              </button>
            )}
            {zoom && (
              <input
                type="range"
                aria-label="Zoom"
                min={zoom.min}
                max={zoom.max}
                step={zoom.step}
                value={zoom.value}
                onChange={(e) => void applyZoom(Number(e.target.value))}
                style={{ flex: 1, accentColor: "var(--color-accent)" }}
              />
            )}
          </div>
        )}

        {/* Nothing has decoded for a while — say so, rather than leaving the
            user unsure whether they are aiming badly or it simply cannot be
            read. */}
        {camera.kind === "running" && stuck && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute", left: 12, right: 12, top: 12, zIndex: 2,
              padding: "9px 12px", borderRadius: "var(--radius)",
              background: "rgba(0,0,0,0.62)", color: "#fff", fontSize: 12.5, lineHeight: 1.45,
            }}
          >
            Not reading? Tap the picture to refocus{canTorch ? ", try the torch," : ""} or type the
            ISBN below — it is printed under the barcode.
            {hasClaudeKey() && (
              <>
                {" "}
                <button
                  onClick={() => void identifyFromFrame()}
                  disabled={reading}
                  style={{
                    marginTop: 7, display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "5px 10px", borderRadius: "var(--radius-sm)", cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.4)", background: "transparent",
                    color: "#fff", font: "inherit", fontSize: 12,
                  }}
                >
                  <ICamera size={13} /> {reading ? "Reading the cover…" : "Read the cover instead"}
                </button>
              </>
            )}
          </div>
        )}

        {camera.kind !== "running" && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24 }}>
            <p style={{ margin: 0, maxWidth: 320, textAlign: "center", fontSize: 13, color: "var(--color-text-2)" }}>
              {camera.kind === "starting" ? "Starting the camera…" : camera.message}
            </p>
          </div>
        )}
      </div>

      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8, maxHeight: "38%", overflowY: "auto" }}>
        {/* Always present, not only as a fallback: it is how a missed spine
            gets typed without leaving the screen — and it makes a USB or
            Bluetooth barcode wedge work with no extra code, since those just
            type digits and press Enter. */}
        <form onSubmit={submitTyped} style={{ display: "flex", gap: 6 }}>
          <input
            className="input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="Type or scan an ISBN"
            aria-label="Enter an ISBN"
            style={{ flex: 1, height: 34, fontSize: 13 }}
          />
          <button className="btn btn-primary" type="submit" disabled={!typed.trim()}>Add</button>
        </form>

        {visionNote && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-2)" }}>{visionNote}</p>
        )}

        {session.queue.slice(0, 6).map((entry) => (
          <div key={entry.isbn13} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5 }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", flex: "none",
              background: entry.state === "ok" ? "var(--st-done)"
                : entry.state === "pending" ? "var(--st-progress)"
                : entry.state === "dupe" ? "var(--color-text-3)"
                : "var(--st-skipped)",
            }} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {entry.title ?? entry.isbn13}
            </span>
            {entry.state !== "ok" && (
              <span style={{ fontSize: 10.5, color: "var(--color-text-3)", fontFamily: "var(--font-mono)" }}>
                {entry.state === "pending" ? "…" : entry.state === "dupe" ? "already have it" : "not found"}
              </span>
            )}
          </div>
        ))}

        {session.queue.length === 0 && camera.kind === "running" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-3)", textAlign: "center" }}>
            Point at a barcode on the back of a book.
          </p>
        )}
      </div>
    </div>
  );
}
