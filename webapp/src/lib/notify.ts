/* Timer notifications. On the web they fire through the service worker when
   possible so backgrounded/minimized (installed-PWA) sessions still get the
   banner. A fully closed browser cannot be woken without a push server — on
   reopen, checkMissed() delivers the completion that happened offline.

   The Android WebView has no Notification API at all, so the native app routes
   everything through @capacitor/local-notifications instead — including
   *scheduled* banners (notifyAt), which the OS delivers even while the app is
   suspended and its JS timers are frozen. */

import { isNative } from "./native/platform";

export function registerSw(): void {
  if (isNative) return; // no SW in the WebView shell; notifications are native
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* http:// dev without SW support is fine — page notifications still work */
    });
  }
}

/** LocalNotifications wants integer ids; tags hash to a stable 31-bit int. */
function tagId(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

export async function ensurePermission(): Promise<boolean> {
  if (isNative) {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const st = await LocalNotifications.checkPermissions();
    if (st.display === "granted") return true;
    if (st.display === "denied") return false;
    return (await LocalNotifications.requestPermissions()).display === "granted";
  }
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

export async function notify(title: string, body: string, tag = "letsgo-timer"): Promise<void> {
  if (isNative) {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    if ((await LocalNotifications.checkPermissions()).display !== "granted") return;
    await LocalNotifications.schedule({ notifications: [{ id: tagId(tag), title, body }] });
    return;
  }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (reg?.active) {
    reg.active.postMessage({ type: "notify", title, body, tag });
  } else {
    new Notification(title, { body, tag });
  }
}

/** Native only: hand the banner to the OS for a future instant, so it rings
    even if Android has frozen the WebView's timers by then. Web callers keep
    their setTimeout path and get `false` back. */
export async function notifyAt(at: number, title: string, body: string, tag: string): Promise<boolean> {
  if (!isNative) return false;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  if ((await LocalNotifications.checkPermissions()).display !== "granted") return false;
  await LocalNotifications.schedule({
    notifications: [{ id: tagId(tag), title, body, schedule: { at: new Date(at), allowWhileIdle: true } }],
  });
  return true;
}

/** Cancel a pending notifyAt (timer paused, rescheduled, or finished early). */
export async function cancelNotifyAt(tag: string): Promise<void> {
  if (!isNative) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.cancel({ notifications: [{ id: tagId(tag) }] }).catch(() => undefined);
}
