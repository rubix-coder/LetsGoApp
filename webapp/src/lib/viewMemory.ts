/* Remembering which view a screen was left on.

   Several screens switch between views with a `Seg` — the dashboard's range,
   the mindmap's lens, the timer's side panel, the notes editor's mode, the
   library's shelf tabs. Every one of them held that choice in plain component
   state, so it reset the moment you visited another tab and came back: the
   screen unmounts, the state goes with it. Todo had the same complaint through
   its route (lib/todoView.ts); this is the same fix for the screens whose
   views were never in the URL to begin with.

   Which view you like to look at a screen through is a property of the screen
   you are looking at it on, so this is localStorage rather than the synced
   vault — the same split the library layout and mindmap density already chose,
   and the reason a phone can sit in the list while the desktop sits on covers.

   Reads are validated against the views actually on offer, so a view renamed
   or dropped between releases falls back rather than rendering nothing, and
   both directions swallow a throwing localStorage — private-mode Safari
   throws on access, and the hand-rolled reads this replaces did it inside a
   `useState` initialiser, where a throw took the whole screen down. */

import { useState } from "react";

/** The stored view for `key`, or `fallback` if nothing usable is stored.
    `fallback` may be lazy for a default that has to measure something — the
    library's covers-or-list choice depends on the viewport. */
export function readStickyView<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T | (() => T),
): T {
  const fall = () => (typeof fallback === "function" ? fallback() : fallback);
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(key);
  } catch {
    return fall();
  }
  return allowed.includes(stored as T) ? (stored as T) : fall();
}

/** Records a view the user picked. Silent on failure: the cost is a screen
    that opens on its default next time, which is where it opened before. */
export function writeStickyView(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* nothing to do — the next read reports it as unset */
  }
}

/** `useState` for a view switcher, except the choice outlives the mount.
    Drop-in: `const [range, setRange] = useStickyView(KEY, RANGES, "week")`. */
export function useStickyView<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T | (() => T),
): [T, (next: T) => void] {
  const [view, setView] = useState<T>(() => readStickyView(key, allowed, fallback));
  return [view, (next: T) => { setView(next); writeStickyView(key, next); }];
}
