import { useState } from "react";
import { createVault, destroyVault, hasVault, NO_PASSPHRASE, openVault, restoreVaultFromNas, type VaultHandle } from "../lib/store";
import { defaultWebdavUrl } from "../lib/native/platform";
import { insideTauri } from "../lib/sync";
import { BP, Wordmark } from "../components/ui";
import { IEye, ILock } from "../components/Icons";

function strength(p: string): { score: 0 | 1 | 2 | 3; label: string } {
  let classes = 0;
  if (/[a-z]/.test(p)) classes++;
  if (/[A-Z]/.test(p)) classes++;
  if (/\d/.test(p)) classes++;
  if (/[^A-Za-z0-9]/.test(p)) classes++;
  if (p.length >= 14 && classes >= 3) return { score: 3, label: "Strong" };
  if (p.length >= 10 && classes >= 2) return { score: 2, label: "Okay" };
  if (p.length >= 6) return { score: 1, label: "Weak" };
  return { score: 0, label: "Too short" };
}

export function Unlock({ onUnlocked, onUseTeam }: { onUnlocked: (v: VaultHandle) => void; onUseTeam?: () => void }) {
  const [creating, setCreating] = useState(() => !hasVault());
  const [restoring, setRestoring] = useState(false);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  // "/webdav" is the desktop shell's same-origin proxy path — meaningless in
  // both Android shells. The Capacitor app knows the deployed NAS origin so
  // defaultWebdavUrl() fills the absolute address; the Tauri APK starts the
  // field empty and asks for the NAS's full https address instead.
  const [nas, setNas] = useState({ enabled: true, url: insideTauri() ? "" : defaultWebdavUrl(), username: "", password: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const st = strength(pass);
  const canCreate = restoring ? Boolean(pass && nas.username) : st.score >= 1 && pass === confirm;

  async function createPasswordless() {
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await createVault(NO_PASSPHRASE));
    } catch {
      setError("Could not create the vault.");
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (restoring) {
        onUnlocked(await restoreVaultFromNas({ ...nas, url: nas.url.trim(), username: nas.username.trim(), password: nas.password.trim() }, pass));
      } else {
        onUnlocked(creating ? await createVault(pass) : await openVault(pass));
      }
    } catch (err) {
      setError(
        restoring
          ? `Restore failed: ${err instanceof Error ? err.message : "check the NAS details and passphrase."}`
          : "Wrong passphrase — nothing was decrypted.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="glowTop" style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 20 }}>
      <form
        onSubmit={(e) => { e.preventDefault(); if (!busy && (creating ? canCreate : pass)) void submit(); }}
        style={{ width: 380, maxWidth: "100%" }}
      >
        <BP style={{ background: "var(--color-card)", padding: "34px 34px 30px", display: "flex", flexDirection: "column", gap: 14, boxShadow: "var(--shadow-lg)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", textAlign: "center", marginBottom: 6 }}>
            <Wordmark size={26} />
            <h3 style={{ fontSize: 22, margin: "8px 0 0" }}>
              {restoring ? "Restore from your NAS" : creating ? "Create a passphrase" : "Unlock LetsGo"}
            </h3>
            <p style={{ fontSize: 12.5, color: "var(--color-text-2)" }}>
              {restoring
                ? "Pulls your synced vault and unlocks it with the same passphrase you use elsewhere."
                : creating
                  ? "It encrypts everything you keep in LetsGo. There is no recovery if you forget it."
                  : "Your passphrase decrypts everything on this device."}
            </p>
          </div>

          {restoring && (
            <>
              <div className="field">
                <label htmlFor="nas-url">WebDAV URL</label>
                <input id="nas-url" className="input" placeholder="https://your-server/webdav" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={nas.url} onChange={(e) => setNas({ ...nas, url: e.target.value })} />
                {insideTauri() && (
                  <span style={{ fontSize: 11.5, color: "var(--color-text-3)" }}>
                    Use your server&rsquo;s full https address, and make sure this device can reach it on your network.
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label htmlFor="nas-user">NAS username</label>
                  <input id="nas-user" className="input" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={nas.username} onChange={(e) => setNas({ ...nas, username: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="nas-pass">NAS password</label>
                  <input id="nas-pass" type="password" className="input" autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={nas.password} onChange={(e) => setNas({ ...nas, password: e.target.value })} />
                </div>
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="pass">Passphrase</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--color-surface)", border: "1px solid var(--color-divider)", borderRadius: "var(--radius)", overflow: "hidden" }}>
              <input
                id="pass"
                type={show ? "text" : "password"}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoFocus
                className="input"
                style={{ border: "none", background: "none", flex: 1, letterSpacing: show ? undefined : 3 }}
              />
              <button type="button" className="btn btn-ghost btn-icon" style={{ width: 32, height: 32, color: "var(--color-text-2)" }} onClick={() => setShow(!show)} aria-label={show ? "Hide passphrase" : "Show passphrase"}>
                <IEye size={16} />
              </button>
            </div>
          </div>

          {creating && !restoring && (
            <>
              <div className="field">
                <label htmlFor="confirm">Confirm passphrase</label>
                <input id="confirm" type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input" style={{ letterSpacing: show ? undefined : 3 }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-text-2)" }}>
                {[1, 2, 3].map((i) => (
                  <span key={i} style={{ flex: 1, height: 3, background: st.score >= i ? "var(--color-accent)" : "var(--color-divider)" }} />
                ))}
                <span style={{ marginLeft: 4 }}>{pass ? st.label : ""}</span>
              </div>
              {confirm && confirm !== pass && <p style={{ fontSize: 12, color: "var(--prio-hi-text)" }}>Passphrases don't match yet.</p>}
            </>
          )}

          {error && <p style={{ fontSize: 12, color: "var(--prio-hi-text)" }}>{error}</p>}

          <button type="submit" className="btn btn-primary btn-block" style={{ height: 40 }} disabled={busy || (creating || restoring ? !canCreate : !pass)}>
            {busy ? "Working…" : restoring ? "Restore and unlock" : creating ? "Create and unlock" : "Unlock"}
          </button>

          {creating && !restoring && (
            <button type="button" className="btn btn-secondary btn-block" style={{ height: 36, fontSize: 12.5 }} disabled={busy} onClick={() => void createPasswordless()}>
              Skip — open without a passphrase
            </button>
          )}

          {creating && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12, color: "var(--accent-strong)" }}
              onClick={() => { setRestoring(!restoring); setError(null); }}
            >
              {restoring ? "Start fresh instead" : "Already synced to a NAS? Restore from it"}
            </button>
          )}

          <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, justifyContent: "center", color: "var(--color-text-2)" }}>
            <ILock size={13} />
            AES-256-GCM · PBKDF2 · encrypted at rest
          </p>

          {onUseTeam && (
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12, color: "var(--accent-strong)" }} onClick={onUseTeam}>
              Working with a team? Sign in to a team server
            </button>
          )}
        </BP>

        {!creating && (
          <p style={{ textAlign: "center", marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12, color: "var(--color-text-2)" }}
              onClick={() => {
                if (window.confirm("Erase all local LetsGo data and start over? This cannot be undone.")) {
                  destroyVault();
                  setCreating(true);
                  setPass("");
                  setConfirm("");
                  setError(null);
                }
              }}
            >
              Forgot it? Erase local data and start over
            </button>
          </p>
        )}
      </form>
    </div>
  );
}
