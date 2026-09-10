/* Keeps the Android status bar in step with the app theme — the web build's
   static <meta theme-color> can't follow the dark/light flip, the native
   status bar can. Reads --color-bg after the dataset flip so accent variants
   and future palette changes stay a single source of truth (theme.css). */

import { isNative } from "./platform";

export function syncStatusBar(): void {
  if (!isNative) return;
  const dark = document.documentElement.dataset.theme === "dark";
  const bg =
    getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim() ||
    (dark ? "#0b0d16" : "#eeeef3");
  void import("@capacitor/status-bar")
    .then(({ StatusBar, Style }) => {
      void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
      void StatusBar.setBackgroundColor({ color: bg }).catch(() => undefined);
    })
    .catch(() => undefined);
}
