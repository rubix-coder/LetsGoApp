/* Platform seam for the Android (Capacitor) build. Everything the webapp does
   differently inside the native shell branches on `isNative` — the web build
   never takes those branches, so web behavior is untouched by the port. */

import { Capacitor } from "@capacitor/core";

export const isNative: boolean = Capacitor.isNativePlatform();

/* Origin of the self-hosted LetsGo server (see server/README.md). On the web
   the app is served from that origin already, so relative paths ("/webdav",
   "/api") just work; the native app is served from capacitor's local origin
   instead, so those paths must be re-anchored onto the server.

   There is no default — LetsGo is local-first and fully usable with no server
   at all. Set it at build time with VITE_LETSGO_SERVER_ORIGIN, or leave it
   empty and let each user enter their own server URL in Settings. */
export const NAS_ORIGIN: string =
  import.meta.env.VITE_LETSGO_SERVER_ORIGIN?.replace(/\/$/, "") ?? "";

/** Re-anchor a same-origin path onto the server for the native app. Absolute
    URLs pass through untouched — a vault synced from another device may carry
    either form, so this runs on every request, not just on defaults. With no
    server origin configured the path is returned as-is; nothing is reachable
    at it, which is the correct outcome for a local-only install. */
export function resolveNasUrl(url: string): string {
  if (!isNative || !NAS_ORIGIN) return url;
  return url.startsWith("/") ? NAS_ORIGIN + url : url;
}

/** What a fresh config's WebDAV URL should say. Empty on native with no
    configured server, so Settings shows a blank field to fill in rather than
    a URL that points nowhere. */
export function defaultWebdavUrl(): string {
  if (!isNative) return "/webdav";
  return NAS_ORIGIN ? `${NAS_ORIGIN}/webdav` : "";
}
