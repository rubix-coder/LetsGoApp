/* LetsGo desktop shell: the webapp, byte-identical, in a Chromium window.
   No IPC, no preload — the app IS the web bundle, served from a local
   same-origin server (server.cjs) that also proxies /api to the NAS team
   backend and, inside a Flatpak, exposes /__shell/update so the webapp can
   offer "Restart & update" without knowing Electron exists.

   Chromium (not WebKitGTK) is the point: service-worker notifications,
   WebCrypto, camera barcode scanning and Google sign-in behave exactly as
   they do in the browser the webapp was built against. */

const { app, BrowserWindow, dialog, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createServer } = require("./server.cjs");
const { createFlatpakUpdater } = require("./flatpakUpdate.cjs");

// Announce the desktop-entry name as the Wayland app-id: GNOME matches it
// against <app-id>.desktop to pick the dock/taskbar icon — without it the
// window shows a generic icon. (X11 gets WM_CLASS from the executable name,
// which already matches, plus the BrowserWindow icon below.)
//
// The name differs per package, and it must match the .desktop FILENAME:
// the deb ships letsgo-webapp.desktop, the Flatpak ships
// io.github.rubix_coder.LetsGoApp.desktop. FLATPAK_ID is set by the runtime inside the
// sandbox, so it doubles as both the detector and the correct value.
app.commandLine.appendSwitch(
  "wayland-app-id",
  process.env.FLATPAK_ID || "letsgo-webapp",
);

const PORT = 8637; // fixed: the vault + cookies live on this origin — changing it "loses" data
// No default backend: LetsGo is local-first and works fully offline with an
// empty nasUrl. Point this at your own self-hosted server (see server/README.md)
// via config.json ("nasUrl") or the LETSGO_NAS_URL env var to enable sync.
const DEFAULT_NAS_URL = "";
const APP_URL = `http://localhost:${PORT}/`;

/** config.json lives in userData (~/.config/LetsGoWeb). Env wins, then the
    file; the file is seeded on first run so it's discoverable/editable. */
function loadConfig() {
  const file = path.join(app.getPath("userData"), "config.json");
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch {
    cfg = { nasUrl: DEFAULT_NAS_URL };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
    } catch { /* read-only home is survivable */ }
  }
  const nasUrl = process.env.LETSGO_NAS_URL || cfg.nasUrl || DEFAULT_NAS_URL;
  return {
    nasUrl,
    // The OTA repo published beside the webapp (packaging/flatpak/README.md).
    // Overridable for a NAS that serves it elsewhere.
    flatpakRepoUrl:
      process.env.LETSGO_FLATPAK_REPO ||
      cfg.flatpakRepoUrl ||
      (nasUrl ? `${nasUrl.replace(/\/$/, "")}/flatpak/` : ""),
  };
}

function webappRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "webapp")
    : path.join(__dirname, "..", "..", "webapp", "dist");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#111113",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });

  // Links out of the app (book pages, OAuth popups excepted below) open in
  // the system browser; the window itself never leaves the local origin.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL) || url.startsWith("https://accounts.google.com/")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(APP_URL) && !url.startsWith("https://accounts.google.com/")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  if (process.env.LETSGO_SMOKE_SHOT) {
    // Verification mode: render hidden, screenshot, exit. Never shows a window.
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.LETSGO_SMOKE_SHOT, img.toPNG());
          console.log(`SMOKE_OK ${process.env.LETSGO_SMOKE_SHOT}`);
        } catch (e) {
          console.error("SMOKE_FAIL", e);
        }
        app.exit(0);
      }, 3000);
    });
  } else {
    win.once("ready-to-show", () => win.show());
  }

  win.loadURL(APP_URL);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    // Full webapp parity: grant the web permissions the browser would prompt
    // for — notifications (timer alerts via the service worker) and media
    // (camera ISBN scanning). Everything else stays denied.
    const GRANTED = new Set(["notifications", "media", "clipboard-sanitized-write", "fullscreen"]);
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(GRANTED.has(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => GRANTED.has(permission));

    const { nasUrl, flatpakRepoUrl } = loadConfig();

    // Flatpak self-update. Inert outside a Flatpak; inside one it watches the
    // portal and lets the webapp install + relaunch on the user's say-so,
    // which is the only way a running app picks up a deployment that landed
    // underneath it.
    const updater = createFlatpakUpdater({
      // Shipped as an extraResource, never inside app.asar — python3 cannot
      // read an archive Electron's patched fs makes look like a directory.
      agentPath: app.isPackaged
        ? path.join(process.resourcesPath, "flatpak-update-agent.py")
        : path.join(__dirname, "flatpak-update-agent.py"),
      repoUrl: flatpakRepoUrl,
      log: (m) => console.log(`[update] ${m}`),
    });
    updater.start();
    app.on("before-quit", () => updater.stop());
    app.on("will-quit", () => updater.stop());

    const server = createServer({
      root: webappRoot(),
      nasUrl,
      shellUpdate: {
        status: () => updater.status(),
        apply: async () => {
          const result = await updater.apply();
          if (!result.ok) return result;
          // Answer the fetch BEFORE tearing the window down, or the click
          // looks like it failed. relaunch() queues the new instance for
          // after this one exits. app.exit() skips before-quit, so the agent
          // is stopped here explicitly rather than left behind.
          setTimeout(() => { updater.stop(); app.relaunch(); app.exit(0); }, 400);
          return result;
        },
      },
    });
    server.once("error", (e) => {
      if (e.code === "EADDRINUSE") {
        // Another server already owns the port (e.g. the old 0.35 launcher).
        // It serves the same app, so just open the window onto it.
        createWindow();
      } else {
        dialog.showErrorBox("LetsGo", `Local server failed: ${e.message}`);
        app.exit(1);
      }
    });
    server.listen(PORT, "127.0.0.1", () => createWindow());

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => app.quit());
}
