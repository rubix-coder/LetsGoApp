/* The Timer screen's Log tab: sessions folded into days.

   A session is either worked time (`kind: "focus"`, or absent for rows written
   before the field existed) or a logged break (`kind: "pause"` — a manual pause
   or an auto-pause after stepping away). The dashboard counts only focus
   minutes; this view shows both so the gap between "elapsed" and "worked" is
   visible rather than silently absorbed. */

import { sameDay } from "./dates";
import type { Session } from "./types";

/** A session's kind, treating the pre-field default as worked time. Mirrors the
    helper in lib/store so callers that only need the log need not import it. */
export function sessionKind(s: Pick<Session, "kind">): "focus" | "pause" {
  return s.kind ?? "focus";
}

export interface LoggedDay {
  /** Epoch ms of any session that ran that calendar day (the first one seen). */
  day: number;
  focusMin: number;
  pauseMin: number;
  /** The day's sessions, newest first. */
  rows: Session[];
}

/** Group sessions into calendar days, newest day first and newest session first
    within a day, with per-day worked / paused totals. */
export function groupSessionsByDay(sessions: readonly Session[]): LoggedDay[] {
  const byNewest = [...sessions].sort((a, b) => b.startedAt - a.startedAt);
  const days: LoggedDay[] = [];
  for (const s of byNewest) {
    let day = days.find((d) => sameDay(d.day, s.startedAt));
    if (!day) {
      day = { day: s.startedAt, focusMin: 0, pauseMin: 0, rows: [] };
      days.push(day);
    }
    day.rows.push(s);
    if (sessionKind(s) === "pause") day.pauseMin += s.minutes;
    else day.focusMin += s.minutes;
  }
  return days;
}
