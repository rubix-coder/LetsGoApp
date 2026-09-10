/* One-time native setup, awaited in main.tsx before React mounts. Only ever
   imported (dynamically) when running inside the Capacitor shell. */

import { App as CapApp } from "@capacitor/app";
import { restoreMirroredStorage, startStorageMirror } from "./persistMirror";

export async function initNative(): Promise<void> {
  await restoreMirroredStorage();
  startStorageMirror();

  /* Hardware back: the app is a hash router, so back pops hash history until
     there is none left, then backgrounds the app (Android convention) instead
     of killing it mid-edit. */
  void CapApp.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) history.back();
    else void CapApp.minimizeApp();
  });
}
