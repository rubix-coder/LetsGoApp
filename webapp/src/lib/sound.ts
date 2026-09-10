/* Notification chimes via the Web Audio API — no bundled audio asset, so it
   works fully offline and adds nothing to the download. One shared
   AudioContext, created lazily on the first play (which follows a user
   gesture: unlock, sign-in, or a timer the user started — satisfying the
   browser autoplay policy). Every failure is swallowed: a blocked or
   unsupported context just means no sound, never a thrown error, and the OS
   banner still fires. */

export type Chime = "login" | "complete" | "timer" | "scan" | "scanFail" | "beeps" | "gong" | "marimba";

/** The alert sounds a user can pick for timer / check-in notifications
    (Settings → Security → Alert sound). Each maps to a `Chime` pattern. */
export type AlertSound = "chime" | "beeps" | "gong" | "marimba";

export const ALERT_SOUNDS: readonly { id: AlertSound; label: string; chime: Chime }[] = [
  { id: "chime", label: "Chime", chime: "timer" },
  { id: "beeps", label: "Beep beep beep", chime: "beeps" },
  { id: "gong", label: "Gong", chime: "gong" },
  { id: "marimba", label: "Marimba", chime: "marimba" },
];

/** The chime pattern for the user's chosen alert sound; falls back to the
    original three-tone chime. */
export function alertChime(choice: AlertSound | undefined): Chime {
  return ALERT_SOUNDS.find((s) => s.id === choice)?.chime ?? "timer";
}

let ctx: AudioContext | undefined;

function audio(): AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return undefined;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/** One partial of a chime: frequency, start offset, and optionally its own
    length / peak gain / oscillator shape (defaults suit the short UI blips). */
interface Partial {
  f: number;
  t: number;
  /** seconds; default 0.22 */
  d?: number;
  /** peak gain; default 0.14 */
  g?: number;
  type?: OscillatorType;
}

/** A single note: a tone with a fast attack and exponential fade so it never
    clicks. */
function note(ac: AudioContext, p: Partial): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = p.type ?? "sine";
  osc.frequency.value = p.f;
  const dur = p.d ?? 0.22;
  const t0 = ac.currentTime + p.t;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(p.g ?? 0.14, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Distinct shapes so each event is recognisable by ear. */
const PATTERNS: Record<Chime, Partial[]> = {
  login: [{ f: 523.25, t: 0 }, { f: 783.99, t: 0.10 }],                       // C5 → G5, a gentle rise
  complete: [{ f: 659.25, t: 0 }, { f: 987.77, t: 0.09 }],                    // E5 → B5, a bright ding
  timer: [{ f: 880, t: 0 }, { f: 880, t: 0.16 }, { f: 1174.66, t: 0.32 }],    // A5 · A5 · D6, alerting
  // Scanning is rapid-fire, so the accept has to be one very short blip —
  // anything longer overlaps the next book. The failure is low and doubled
  // so the two are never confused while looking at the shelf, not the phone.
  scan: [{ f: 1318.51, t: 0 }],                                               // E6, a single tick
  scanFail: [{ f: 220, t: 0 }, { f: 196, t: 0.08 }],                          // A3 → G3, a low buzz
  // Three even square-wave pulses — the unmistakable "your time is up" beep.
  beeps: [
    { f: 784, t: 0, d: 0.13, g: 0.13, type: "square" },
    { f: 784, t: 0.24, d: 0.13, g: 0.13, type: "square" },
    { f: 784, t: 0.48, d: 0.2, g: 0.13, type: "square" },
  ],
  // A struck bowl: a low fundamental with inharmonic partials and a long,
  // gentle decay — a meditation-bell end to a session.
  gong: [
    { f: 82.4, t: 0, d: 3.2, g: 0.2 },
    { f: 130.8, t: 0.01, d: 2.6, g: 0.11 },
    { f: 196, t: 0.02, d: 2.0, g: 0.07 },
    { f: 277.2, t: 0.03, d: 1.5, g: 0.045 },
    { f: 415.3, t: 0.05, d: 1.0, g: 0.03 },
  ],
  // Warm and wooden: a note with a quiet octave above it, then a fifth up —
  // present without being sharp.
  marimba: [
    { f: 659.25, t: 0, d: 0.45, g: 0.14, type: "triangle" },
    { f: 1318.5, t: 0, d: 0.28, g: 0.04, type: "triangle" },
    { f: 987.77, t: 0.14, d: 0.6, g: 0.12, type: "triangle" },
  ],
};

export function playChime(kind: Chime): void {
  try {
    const ac = audio();
    if (!ac) return;
    if (ac.state === "suspended") void ac.resume();
    for (const p of PATTERNS[kind]) note(ac, p);
  } catch {
    /* no audio available — silent is fine */
  }
}
