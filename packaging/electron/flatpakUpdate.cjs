/* Flatpak self-update for the desktop shell.

   Owns the Python agent (flatpak-update-agent.py), which holds the one
   long-lived D-Bus connection the update portal requires, and turns its
   line-JSON into a small state the local server can hand the webapp:

     { supported, available, restartOnly, progress }

   Two distinct situations both surface as "available":
   - remote-commit is ahead → there is something to download. Update() does it.
   - local-commit is ahead of running-commit → the update was ALREADY deployed
     underneath a running app, which is what Flatpak does every time it lands
     an update while the app is open. Nothing to download; the app just has to
     restart. `restartOnly` says which one it is so the button can be honest.

   Everything here is inert outside a Flatpak: the deb and the browser build
   get supported:false and keep the plain "Reload" path. */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/** The portal only exists inside a Flatpak sandbox. FLATPAK_ID alone can be
    inherited by a child of a sandboxed process, so check the marker file the
    runtime actually mounts. */
function isFlatpak() {
  return !!process.env.FLATPAK_ID && fs.existsSync("/.flatpak-info");
}

/* zypak-wrapper starts the shell with an LD_PRELOAD that intercepts
   Chromium's sandbox syscalls (packaging/flatpak/letsgo-launcher), and
   Electron exports its own loader vars. A plain python3 child inheriting any
   of that either crashes or silently misbehaves, so the agent gets a
   deliberately boring environment. */
const STRIPPED_ENV = [
  "LD_PRELOAD", "LD_LIBRARY_PATH", "ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE",
  "CHROME_DESKTOP", "GDK_BACKEND",
];

function agentEnv(base) {
  const env = { ...base };
  for (const key of STRIPPED_ENV) delete env[key];
  for (const key of Object.keys(env)) if (key.startsWith("ZYPAK_")) delete env[key];
  return env;
}

/** How long an Update() may run before we stop waiting on it. The portal
    downloads an OSTree delta — slow on a bad link, but a button that spins
    forever is worse than one that reports a timeout. */
const APPLY_TIMEOUT_MS = 10 * 60_000;

function createFlatpakUpdater(opts = {}) {
  const agentPath = opts.agentPath ?? path.join(__dirname, "flatpak-update-agent.py");
  // Overridable so the protocol can be exercised against a stand-in agent
  // (test-flatpak-update.cjs) — there is no D-Bus portal to talk to in CI.
  const interpreter = opts.interpreter ?? "python3";
  const enabled = opts.enabled ?? isFlatpak();
  // The OSTree repo this app was installed from. Given to the agent so it can
  // read the published commit directly instead of waiting up to half an hour
  // for the portal's own poll.
  const repoUrl = opts.repoUrl;
  const log = opts.log ?? (() => {});

  let child = null;
  let ready = false;
  let available = null; // { running, local, remote, restartOnly }
  let progress = null; // { percent, status, message }
  let waiters = [];

  function settle(result) {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve(result);
  }

  function onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type === "ready") { ready = true; return; }
    if (msg.type === "available") {
      const source = msg.source ?? "portal";
      available = {
        running: msg.running ?? null,
        local: msg.local ?? null,
        remote: msg.remote ?? null,
        // Only the portal can see whether the new commit is already deployed.
        // A repo sighting must never downgrade an answer the portal gave.
        restartOnly: source === "portal" ? !!msg.restartOnly : (available?.restartOnly ?? false),
        source,
      };
      log(`update available via ${source} (restartOnly=${available.restartOnly})`);
      return;
    }
    if (msg.type === "progress") {
      progress = { percent: msg.percent ?? 0, status: msg.status ?? "running", message: msg.message ?? null };
      // "empty" means the portal found nothing to install — for the
      // already-deployed case that is success, not failure.
      if (progress.status === "done" || progress.status === "empty") settle({ ok: true });
      else if (progress.status === "failed") settle({ ok: false, error: progress.message ?? "update failed" });
      return;
    }
    if (msg.type === "error") {
      log(`agent error: ${msg.message}`);
      settle({ ok: false, error: msg.message });
    }
  }

  function start() {
    if (!enabled || child) return;
    if (!fs.existsSync(agentPath)) { log(`agent missing at ${agentPath}`); return; }
    try {
      child = spawn(interpreter, repoUrl ? [agentPath, repoUrl] : [agentPath], {
        stdio: ["pipe", "pipe", "pipe"],
        env: agentEnv(opts.env ?? process.env),
      });
    } catch (e) {
      log(`agent spawn failed: ${e.message}`);
      return;
    }
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let cut;
      while ((cut = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 1);
        if (line.trim()) onLine(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => log(`agent stderr: ${String(chunk).trim()}`));
    child.on("exit", (code) => {
      log(`agent exited (${code})`);
      child = null;
      ready = false;
      settle({ ok: false, error: "update agent stopped" });
    });
  }

  function status() {
    return {
      supported: enabled && !!child && ready,
      available: !!available,
      restartOnly: available ? available.restartOnly : false,
      progress,
    };
  }

  /** Install the pending update, resolving { ok } when the portal is done.

      ALWAYS asks the portal, even when the flag came in as restartOnly. That
      used to short-circuit — "already deployed, so just relaunch" — and it
      was wrong in the one way that matters: when the portal's restartOnly was
      not actually true, the button installed nothing, relaunched into the
      same build, and looked like the update had silently failed. Update() is
      cheap when there is genuinely nothing to pull (it answers "empty"), so
      the shortcut bought nothing and cost correctness. */
  function apply() {
    if (!child || !ready) return Promise.resolve({ ok: false, error: "self-update unavailable" });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        settle({ ok: false, error: "update timed out" });
      }, APPLY_TIMEOUT_MS);
      waiters.push((result) => { clearTimeout(timer); resolve(result); });
      try {
        child.stdin.write("update\n");
      } catch (e) {
        settle({ ok: false, error: e.message });
      }
    });
  }

  function stop() {
    if (!child) return;
    try { child.stdin.write("quit\n"); } catch { /* already gone */ }
    const dying = child;
    child = null;
    setTimeout(() => { try { dying.kill(); } catch { /* already gone */ } }, 1500);
  }

  return { start, status, apply, stop };
}

module.exports = { createFlatpakUpdater, isFlatpak, agentEnv };
