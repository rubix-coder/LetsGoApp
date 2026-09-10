/* Detects when the deployed build has moved on from the one this tab is
   running. An installed PWA (or a tab that never closes) can sit on a stale
   bundle for weeks — new note features then render as their raw markdown on
   that device while every fresh browser shows them properly, which reads as
   cross-device data corruption to the user.

   Vite stamps a content hash into the entry script's filename, so "the
   deployed index.html names a different entry than the one in this document"
   is exactly "a new build was deployed". The dev server's unhashed
   /src/main.tsx entry never matches the pattern, so the check is silent in
   development. */

import { useEffect, useState } from "react";
import { isNative } from "./native/platform";

/** The hashed module entry a built index.html loads, or null when there is
    none (dev server, non-built page). */
export function entryScriptOf(html: string): string | null {
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/type\s*=\s*"module"/i.test(tag)) continue;
    const src = /src\s*=\s*"([^"]+)"/i.exec(tag)?.[1];
    if (src && /\/assets\/.+\.js$/.test(src)) return src;
  }
  return null;
}

const CHECK_EVERY_MS = 30 * 60_000;
const MIN_GAP_MS = 60_000; // focus/visibility events arrive in bursts

/** True once a newer deploy is detected; checks on focus and on a slow tick. */
export function useUpdateAvailable(): boolean {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    // The native shell serves its own bundled index.html — the comparison would
    // only ever see itself. App updates arrive as APKs, not deploys.
    if (isNative) return;
    const current = document
      .querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')
      ?.getAttribute("src");
    if (!current) return; // dev server — nothing to compare against

    let lastCheck = 0;
    let cancelled = false;

    async function check() {
      if (Date.now() - lastCheck < MIN_GAP_MS) return;
      lastCheck = Date.now();
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}index.html`, { cache: "no-store" });
        if (!res.ok) return;
        const deployed = entryScriptOf(await res.text());
        if (!cancelled && deployed && deployed !== current) setStale(true);
      } catch { /* offline — the next focus tries again */ }
    }

    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const tick = setInterval(() => void check(), CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(tick);
    };
  }, []);

  return stale;
}
