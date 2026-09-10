/* Durable storage for the native app.

   The vault lives in localStorage (lib/store.tsx), which on Android belongs to
   the WebView — quota-managed, evictable under storage pressure, and wiped by
   "Clear app data" flows that keep native storage. navigator.storage.persist()
   is a no-op there. So every letsgo.* / lg: key is mirrored into Capacitor
   Preferences (SharedPreferences — real app data), and on boot, a WebView that
   lost its localStorage is refilled from the mirror before React mounts. The
   app itself keeps reading/writing localStorage synchronously, unchanged. */

import { Preferences } from "@capacitor/preferences";

const MIRRORED = /^(letsgo\.|lg:)/;

/** Boot-time restore: if the WebView lost the vault, refill every mirrored key.
    Runs before the first render — hasVault()/unlockMode() read synchronously. */
export async function restoreMirroredStorage(): Promise<void> {
  if (localStorage.getItem("letsgo.vault") !== null) return; // storage survived
  try {
    const { keys } = await Preferences.keys();
    for (const key of keys) {
      if (!MIRRORED.test(key) || localStorage.getItem(key) !== null) continue;
      const { value } = await Preferences.get({ key });
      if (value !== null) localStorage.setItem(key, value);
    }
  } catch {
    /* No mirror yet (first run) — nothing to restore. */
  }
}

/** Mirror every subsequent localStorage write. Same-window writes fire no
    "storage" event, so the Storage prototype is wrapped instead. */
export function startStorageMirror(): void {
  const mirror = (store: Storage, key: string, value: string | null) => {
    if (store !== window.localStorage || !MIRRORED.test(key)) return;
    if (value === null) void Preferences.remove({ key }).catch(() => undefined);
    else void Preferences.set({ key, value }).catch(() => undefined);
  };

  const { setItem, removeItem, clear } = Storage.prototype;
  Storage.prototype.setItem = function (key: string, value: string) {
    setItem.call(this, key, value);
    mirror(this, key, value);
  };
  Storage.prototype.removeItem = function (key: string) {
    removeItem.call(this, key);
    mirror(this, key, null);
  };
  Storage.prototype.clear = function () {
    if (this === window.localStorage) {
      for (let i = 0; i < this.length; i++) {
        const key = this.key(i);
        if (key) mirror(this, key, null);
      }
    }
    clear.call(this);
  };
}
