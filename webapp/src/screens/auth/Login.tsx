import { useState } from "react";
import { api, ApiError, serverUrl, setServerUrl, type ApiUser } from "../../lib/api";
import { PENDING_INVITE_KEY } from "../../lib/appMode";
import { BP, Wordmark } from "../../components/ui";
import { ILock } from "../../components/Icons";

/* Team-mode entry: sign in (or sign up) against a LetsGo team server. The server
   URL is blank by default — same origin as the app, which is how the compose
   deploy serves web + api together — and can point at a separate host. */
export function Login({ onAuthed, onBack }: { onAuthed: (u: ApiUser) => void; onBack: () => void }) {
  // Arrived via an invite link → default to the create-account form (the
  // common case for an invitee) and pass the token through signup, which
  // joins the project server-side even while public signup is closed.
  const pendingInvite = localStorage.getItem(PENDING_INVITE_KEY);
  const [signup, setSignup] = useState(Boolean(pendingInvite));
  const [url, setUrl] = useState(serverUrl());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = Boolean(username.trim() && password) && (!signup || password.length >= 8);

  async function submit() {
    setBusy(true);
    setError(null);
    setServerUrl(url.trim());
    try {
      const u = signup
        ? await api.signup(username.trim(), password, email.trim() || undefined, pendingInvite ?? undefined)
        : await api.login(username.trim(), password);
      // Signup consumed the invite server-side; a plain sign-in keeps it
      // pending so the projects screen can accept it.
      if (signup && pendingInvite) localStorage.removeItem(PENDING_INVITE_KEY);
      onAuthed(u);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not reach the server. Check the URL and that it is running.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="gridbg" style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 20, backgroundSize: "40px 40px" }}>
      <form onSubmit={(e) => { e.preventDefault(); if (!busy && canSubmit) void submit(); }} style={{ width: 380, maxWidth: "100%" }}>
        <BP style={{ background: "var(--color-bg)", padding: "34px 34px 30px", display: "flex", flexDirection: "column", gap: 14, boxShadow: "var(--shadow-lg)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", textAlign: "center", marginBottom: 6 }}>
            <Wordmark size={26} />
            <h3 style={{ fontSize: 22, margin: "8px 0 0" }}>{signup ? "Create a team account" : "Sign in to your team"}</h3>
            <p style={{ fontSize: 12.5, color: "var(--color-text-2)" }}>
              Shared projects with roles, synced through your team server.
            </p>
          </div>

          {pendingInvite && (
            <p style={{ margin: 0, padding: "8px 11px", fontSize: 12.5, background: "var(--accent-soft)", color: "var(--accent-strong)", borderRadius: 8 }}>
              You&rsquo;ve been invited to a project — {signup ? "create your account and you'll join it automatically" : "sign in and you'll join it automatically"}.
            </p>
          )}

          <div className="field">
            <label htmlFor="srv">Server URL</label>
            <input id="srv" className="input" placeholder="same origin — leave blank" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="usr">Username</label>
            <input id="usr" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>

          {signup && (
            <div className="field">
              <label htmlFor="eml">Email (optional)</label>
              <input id="eml" type="email" className="input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          )}

          <div className="field">
            <label htmlFor="pwd">Password</label>
            <input id="pwd" type="password" className="input" autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
            {signup && <span style={{ fontSize: 11, color: "var(--color-text-2)" }}>At least 8 characters.</span>}
          </div>

          {error && <p style={{ fontSize: 12, color: "var(--prio-hi-text)" }}>{error}</p>}

          <button type="submit" className="btn btn-primary btn-block" style={{ height: 40 }} disabled={busy || !canSubmit}>
            {busy ? "Working…" : signup ? "Create account" : "Sign in"}
          </button>

          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, color: "var(--accent-strong)" }} onClick={() => { setSignup(!signup); setError(null); }}>
            {signup ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>

          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, color: "var(--color-text-2)" }} onClick={onBack}>
            Use LetsGo on this device only
          </button>

          <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, justifyContent: "center", color: "var(--color-text-2)" }}>
            <ILock size={13} />
            Session cookie · encrypted at rest on the server
          </p>
        </BP>
      </form>
    </div>
  );
}
