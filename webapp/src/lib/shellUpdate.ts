/* Desktop-shell updates (the Flatpak).

   The browser path in updateCheck.ts compares the deployed index.html's entry
   hash against the running one and offers a reload. That check is structurally
   blind in the desktop shell: it serves its OWN bundled index.html from
   localhost, so the comparison only ever sees itself. Meanwhile Flatpak
   deploys an update UNDER a running app and never touches the running
   process — which is exactly how an app sits on old code for hours while
   `flatpak info` cheerfully reports the new version.

   So the shell answers instead. packaging/electron/server.cjs serves
   /__shell/update on the same origin: GET reports what the Flatpak portal
   knows, POST installs it and relaunches. A browser or PWA 404s on that path
   and this hook stays silent — no platform sniffing, just "does the shell
   answer?". */

import { useCallback, useEffect, useState } from "react";

/** What the shell reports about a pending update. */
export interface ShellUpdate {
  /** The shell is present AND its portal agent is alive. */
  supported: boolean;
  available: boolean;
  /** The update is already on disk and only a restart is owed — nothing to
      download, so the button must not promise a download. */
  restartOnly: boolean;
  progress: { percent: number; status: string; message: string | null } | null;
}

const ENDPOINT = "/__shell/update";
const POLL_MS = 5 * 60_000;
/** How long "Later" holds its peace. Long enough not to nag, short enough
    that a day's work doesn't end on stale code. */
export const POSTPONE_MS = 4 * 60 * 60_000;
const POSTPONE_KEY = "letsgo.update.postponedUntil";

/** Read the postpone deadline. Any storage failure reads as "not postponed" —
    a private window must still be told about an update. */
export function postponedUntil(now = Date.now()): number {
  try {
    const raw = Number(localStorage.getItem(POSTPONE_KEY));
    return Number.isFinite(raw) && raw > now ? raw : 0;
  } catch {
    return 0;
  }
}

export function postponeUpdate(now = Date.now()): void {
  try { localStorage.setItem(POSTPONE_KEY, String(now + POSTPONE_MS)); } catch { /* nothing to do */ }
}

export function clearPostpone(): void {
  try { localStorage.removeItem(POSTPONE_KEY); } catch { /* nothing to do */ }
}

/** Ask the shell what it knows. Resolves null when there is no shell — a 404
    (browser), a non-JSON answer (a dev server's SPA fallback serving
    index.html), or an unreachable server. */
export async function fetchShellUpdate(): Promise<ShellUpdate | null> {
  try {
    const res = await fetch(ENDPOINT, { cache: "no-store" });
    if (!res.ok) return null;
    if (!res.headers.get("content-type")?.includes("application/json")) return null;
    const body = await res.json();
    if (!body || typeof body !== "object" || !("supported" in body)) return null;
    return {
      supported: !!body.supported,
      available: !!body.available,
      restartOnly: !!body.restartOnly,
      progress: body.progress ?? null,
    };
  } catch {
    return null;
  }
}

/** Install and restart. Resolves the shell's own answer so the caller can
    show the reason it failed rather than a generic sulk. */
export async function applyShellUpdate(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(ENDPOINT, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.ok !== false, error: body.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "the shell did not answer" };
  }
}

export interface ShellUpdateState {
  /** True when an update is pending and not currently postponed. */
  show: boolean;
  restartOnly: boolean;
  applying: boolean;
  error: string | null;
  apply: () => void;
  postpone: () => void;
}

/** Polls the shell and drives the update bar. Silent everywhere but the
    desktop app. */
export function useShellUpdate(): ShellUpdateState {
  const [update, setUpdate] = useState<ShellUpdate | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snoozedUntil, setSnoozedUntil] = useState(() => postponedUntil());

  useEffect(() => {
    let cancelled = false;
    let tick: ReturnType<typeof setInterval> | undefined;

    // A postpone expires while the app sits open; re-reading it on focus is
    // what brings the bar back without a reload.
    function onFocus() {
      setSnoozedUntil(postponedUntil());
      void check();
    }

    function stopPolling() {
      clearInterval(tick);
      window.removeEventListener("focus", onFocus);
    }

    async function check() {
      const next = await fetchShellUpdate();
      if (cancelled) return;
      setUpdate(next);
      // Nothing answered: this is a browser, a PWA or the Android build.
      // Stop, rather than ask a NAS that will never say yes every 5 minutes.
      if (next === null) stopPolling();
    }

    void check();
    tick = setInterval(() => void check(), POLL_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, []);

  const apply = useCallback(() => {
    setApplying(true);
    setError(null);
    void applyShellUpdate().then((result) => {
      if (result.ok) {
        // The shell is relaunching; clearing the postpone means the fresh
        // instance does not inherit a snooze for an update it already has.
        clearPostpone();
        return; // window is about to go away — leave the spinner up
      }
      setApplying(false);
      setError(result.error ?? "The update could not be installed.");
    });
  }, []);

  const postpone = useCallback(() => {
    postponeUpdate();
    setSnoozedUntil(postponedUntil());
  }, []);

  const pending = !!update?.supported && !!update.available;
  return {
    show: pending && (applying || snoozedUntil === 0),
    restartOnly: !!update?.restartOnly,
    applying,
    error,
    apply,
    postpone,
  };
}
