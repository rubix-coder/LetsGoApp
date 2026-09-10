/* One place that runs Google Calendar syncs, shared by the automatic loop and
   the Sync now buttons in Settings, so both report the same status and can
   never run over the top of each other.

   Kept off the action path exactly like NAS sync: every run is fire-and-forget,
   failures leave the vault untouched and local-only, and an expired Google
   session surfaces as a "reconnect" status rather than a modal in the user's
   face. */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "./store";
import { syncAccount, type SyncCounts } from "./gcalSync";
import { NeedsConsentError, reconnectGoogleAccount } from "./gcalAuth";
import type { GoogleSettings } from "./types";

/** Automatic runs, while the tab is visible. */
const AUTO_INTERVAL_MS = 5 * 60_000;

export interface GoogleSyncStatus {
  state: "off" | "idle" | "syncing" | "ok" | "error" | "reconnect";
  at?: number;
  detail?: string;
  /** Accounts that need the user to sign in again. */
  needsConsent?: string[];
  counts?: SyncCounts;
}

interface GoogleSyncCtx {
  status: GoogleSyncStatus;
  /** Sync one account, or every enabled one when no id is given. */
  syncNow: (accountId?: string) => void;
  /** Interactive re-consent (popup expected) for one account or every enabled
      one, then a sync. For the logo click and the Settings reconnect button. */
  reconnect: (accountId?: string) => void;
}

const Ctx = createContext<GoogleSyncCtx | null>(null);

export function useGoogleSync(): GoogleSyncCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGoogleSync outside GoogleSyncProvider");
  return ctx;
}

const zero = (): SyncCounts => ({ created: 0, updated: 0, deleted: 0, pulled: 0, removed: 0 });

export function GoogleSyncProvider({ children }: { children: ReactNode }) {
  const { state, dispatch, readOnly: viewer, team } = useStore();
  // Personal integration: in team mode its settings would live in the shared
  // project document, so it is not offered there (Settings hides the pane too).
  const readOnly = viewer || team !== undefined;
  const [status, setStatus] = useState<GoogleSyncStatus>({ state: "off" });
  const busy = useRef(false);
  const reconnecting = useRef(false);
  /** When the last automatic/manual sync finished — debounces the visibility
      catch-up so an alt-tab flurry is still just one sync. */
  const lastRunRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const syncNow = useCallback((accountId?: string) => {
    void (async () => {
      const google = stateRef.current.settings.google;
      if (readOnly || !google?.clientId || busy.current) return;
      const targets = google.accounts.filter((a) => a.enabled && (!accountId || a.id === accountId));
      if (targets.length === 0) return;

      busy.current = true;
      setStatus({ state: "syncing" });
      const totals = zero();
      const problems: string[] = [];
      const needsConsent: string[] = [];

      for (const account of targets) {
        try {
          // Read the tasks fresh per account: an earlier account's pulls are
          // already committed and must be visible to the next one.
          const result = await syncAccount(google.clientId, account, stateRef.current.tasks, Date.now(), google.reminderMinutes);
          if (result.imports.length || result.patches.length || result.deletes.length) {
            dispatch({
              type: "googleSyncApplied",
              accountId: account.id,
              imports: result.imports,
              patches: result.patches,
              deletes: result.deletes,
              at: Date.now(),
            });
          }
          for (const key of Object.keys(totals) as (keyof SyncCounts)[]) totals[key] += result.counts[key];
          problems.push(...result.errors);
        } catch (err) {
          if (err instanceof NeedsConsentError) needsConsent.push(account.email);
          else problems.push(`${account.email}: ${err instanceof Error ? err.message : "sync failed"}`);
        }
      }

      busy.current = false;
      const at = Date.now();
      lastRunRef.current = at;
      if (needsConsent.length) {
        setStatus({ state: "reconnect", at, needsConsent, counts: totals, detail: problems[0] });
      } else if (problems.length) {
        setStatus({ state: "error", at, detail: problems[0], counts: totals });
      } else {
        setStatus({ state: "ok", at, counts: totals });
      }
    })();
  }, [dispatch, readOnly]);

  const reconnect = useCallback((accountId?: string) => {
    void (async () => {
      const google = stateRef.current.settings.google;
      if (readOnly || !google?.clientId || reconnecting.current) return;
      const targets = google.accounts.filter((a) => a.enabled && (!accountId || a.id === accountId));
      if (targets.length === 0) return;

      reconnecting.current = true;
      setStatus({ state: "syncing" });
      const renamed: Record<string, string> = {};
      for (const account of targets) {
        try {
          const who = await reconnectGoogleAccount(google.clientId, account);
          if (who.email && who.email !== account.email) renamed[account.id] = who.email;
        } catch { /* still broken — the sync below re-flags it as reconnect */ }
      }
      if (Object.keys(renamed).length) {
        const cur = stateRef.current.settings.google;
        if (cur) {
          dispatch({
            type: "setSettings",
            patch: {
              google: {
                ...cur,
                accounts: cur.accounts.map((a) => (renamed[a.id] ? { ...a, email: renamed[a.id] } : a)),
              },
            },
          });
        }
      }
      reconnecting.current = false;
      syncNow();
    })();
  }, [dispatch, readOnly, syncNow]);

  const google = state.settings.google;
  const auto = !!google?.autoSync && !!google.clientId && google.accounts.some((a) => a.enabled);

  // Sync on open, on a slow timer, and when the tab is brought back into view.
  // Deliberately not on every edit: a calendar round-trip per keystroke would
  // be both slow and rude to the API.
  useEffect(() => {
    if (!auto || readOnly) {
      // Manual "Sync now" still works with the automatic loop switched off; this
      // only resets the badge when the configuration itself changes.
      setStatus({ state: "off" });
      return;
    }
    syncNow();
    const poll = setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, AUTO_INTERVAL_MS);
    /* A visibility catch-up is safe again now that silent renewal uses the
       hidden-iframe path and never pops a window. Debounced against the last
       run so alt-tabbing back and forth is still a single sync. */
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRunRef.current >= 90_000) syncNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, readOnly]);

  return <Ctx.Provider value={{ status, syncNow, reconnect }}>{children}</Ctx.Provider>;
}

/** Empty settings for a vault that has never opened the integration. */
export function emptyGoogleSettings(): GoogleSettings {
  return { clientId: "", accounts: [], autoSync: true, reminderMinutes: "default" };
}
