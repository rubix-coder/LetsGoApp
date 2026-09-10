/** Free-text durations for the timer box: "10s", "25m", "1h", "1h30m".
    A bare number still means minutes, so everything typed into the old
    number-only field keeps working. */

const UNIT_SECONDS: Readonly<Record<string, number>> = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
};

/** A day is the ceiling — past that it's a typo, not an intent. */
export const MAX_DURATION_SEC = 24 * 3600;

/** One `<amount><unit?>` chunk: "1h", "30 m", "25". Sticky, so the scan below
    can only ever advance over text it actually understood. */
const CHUNK = /(\d+(?:\.\d+)?)\s*([a-z]*)/y;

export const DURATION_HINT = "e.g. 10s, 25m, 1h30m — a plain number means minutes";

/** Seconds for a readable duration, or null when the text is empty or junk. */
export function parseDurationToSeconds(text: string): number | null {
  const norm = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (norm === "") return null;

  let total = 0;
  let chunks = 0;
  let sawBare = false;
  CHUNK.lastIndex = 0;

  while (CHUNK.lastIndex < norm.length) {
    const match = CHUNK.exec(norm);
    if (match === null) return null; // junk where an amount was expected
    const [, amount, unit] = match;
    if (unit === "") {
      sawBare = true;
      total += Number(amount) * UNIT_SECONDS.m;
    } else {
      const seconds = UNIT_SECONDS[unit];
      if (seconds === undefined) return null;
      total += Number(amount) * seconds;
    }
    chunks++;
    while (norm[CHUNK.lastIndex] === " ") CHUNK.lastIndex++;
  }

  // "1h 30" — the unit of the 30 is a guess, so refuse rather than assume.
  if (sawBare && chunks > 1) return null;

  const rounded = Math.round(total);
  if (rounded <= 0 || rounded > MAX_DURATION_SEC) return null;
  return rounded;
}

/** seconds → "10s" / "25m" / "1m 30s" / "1h 30m 15s" — the timer card label. */
export function fmtDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}
