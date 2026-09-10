/* Google sign-in for a static, backend-less web app.

   The webapp is served as plain files off the NAS — there is nowhere to keep a
   client secret, so this uses Google Identity Services' **token client**: the
   browser asks Google directly for an access token, Google hands one back, and
   it expires in about an hour. Nothing long-lived is ever issued, which is why
   no credential is written into the vault; tokens live in memory, mirrored to
   localStorage so a still-live (<1h) token survives a browser restart. A dead
   token is always pruned on load, so nothing stale is ever trusted and the
   token still never enters the encrypted vault.

   Multi-account falls out of this naturally: each sign-in is its own token
   client run with `prompt: "select_account"`, and every token is filed under the
   Google account id it came back for. Renewals are silent (`prompt: ""`,
   `login_hint`) while that account's Google session is alive; when it is not,
   the caller gets NeedsConsentError and the UI asks for a click. A silent
   renewal that fails buys a cooldown (SILENT_COOLDOWN_MS) so a truly dead
   session cannot make every background sync hammer GIS.

   REQUIREMENT — Google only accepts HTTPS JavaScript origins (plus
   http://localhost for development). Serving this app over plain HTTP on a LAN
   hostname cannot be registered as an authorized origin. See DEPLOY.md. */

import { isNative } from "./native/platform";

const GSI_SRC = "https://accounts.google.com/gsi/client";
const USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo";
const TOKEN_STORE_KEY = "letsgo.googleTokens";

/** After a silent renewal fails for an account, background sync stops asking
    GIS for it until this passes — otherwise a dead Google session means a
    renewal attempt (and, in some browsers, a popup flash) on every sync tick.
    Cleared by any successful token and by forgetGoogleToken. */
const SILENT_COOLDOWN_MS = 10 * 60_000;
const silentCooldown = new Map<string, number>();

/** Read/write events, read the calendar list, and learn which account said yes. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
].join(" ");

/** Google's session is gone, consent was withdrawn, or Google refused outright
    — either way the user has to act. `reason` carries Google's own wording;
    it is kept separate from `email` so the two can never be confused for one
    another in the message the user reads. */
export class NeedsConsentError extends Error {
  constructor(public email?: string, reason?: string) {
    super(NeedsConsentError.describe(email, reason));
  }

  private static describe(email?: string, reason?: string): string {
    // By far the most common first-run failure: the app is still in "Testing"
    // on the OAuth consent screen and this address is not a registered tester.
    // Google's own text for it ("access_denied") explains nothing, so name the
    // console page that actually fixes it.
    if (reason === "access_denied") {
      return `Google refused${email ? ` for ${email}` : ""}: while the OAuth app is in Testing, only accounts listed under `
        + "Google Auth Platform → Audience → Test users may connect. Add the address there, or publish the app.";
    }
    const who = email ? ` for ${email}` : "";
    return reason ? `Sign in to Google again${who} — ${reason}` : `Sign in to Google again${who}`;
  }
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string; login_hint?: string }) => void;
  callback: (response: TokenResponse) => void;
  error_callback?: (error: { type?: string; message?: string }) => void;
}

interface GoogleOAuthGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        prompt?: string;
        login_hint?: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string; message?: string }) => void;
      }) => TokenClient;
      revoke: (token: string, done?: () => void) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleOAuthGlobal;
  }
}

/* ————— token cache ————— */

interface CachedToken {
  accessToken: string;
  /** Epoch ms. Treated as expired a minute early, so a request never races it. */
  expiresAt: number;
}

const tokens = new Map<string, CachedToken>();
let restored = false;

function restoreTokens(): void {
  if (restored) return;
  restored = true;
  try {
    // localStorage now; sessionStorage only as a one-time fallback so a token
    // written by a pre-0.48 session (which cached in sessionStorage) is adopted
    // rather than dropped on the upgrade.
    const raw = localStorage.getItem(TOKEN_STORE_KEY) ?? sessionStorage.getItem(TOKEN_STORE_KEY);
    if (!raw) return;
    for (const [id, token] of Object.entries(JSON.parse(raw) as Record<string, CachedToken>)) {
      if (token?.accessToken && token.expiresAt > Date.now()) tokens.set(id, token);
    }
    if (tokens.size) persistTokens();
  } catch { /* a corrupt cache just means signing in again */ }
}

function persistTokens(): void {
  try {
    localStorage.setItem(TOKEN_STORE_KEY, JSON.stringify(Object.fromEntries(tokens)));
  } catch { /* private mode: in-memory only, which still works for this tab */ }
}

export function forgetGoogleToken(accountId: string): void {
  if (isNative) {
    void import("./native/googleAuth").then((m) => m.nativeForget(accountId));
    return;
  }
  restoreTokens();
  tokens.delete(accountId);
  silentCooldown.delete(accountId);
  persistTokens();
}

/* ————— the GSI script ————— */

let scriptPromise: Promise<void> | undefined;

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => {
      scriptPromise = undefined; // a transient network failure may recover
      reject(new Error("Could not load Google sign-in — check the connection and that this origin is HTTPS."));
    });
    if (!existing) {
      script.src = GSI_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return scriptPromise;
}

/** One token request. GSI is callback-based, so this wraps a single run. */
async function requestToken(clientId: string, prompt: string, loginHint?: string): Promise<CachedToken> {
  await loadGsi();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google sign-in did not initialise.");

  return new Promise<CachedToken>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new NeedsConsentError(loginHint, response.error ?? response.error_description));
          return;
        }
        resolve({
          accessToken: response.access_token,
          expiresAt: Date.now() + Math.max(0, (response.expires_in ?? 3600) - 60) * 1000,
        });
      },
      error_callback: (error) => reject(new NeedsConsentError(loginHint, error.type ?? error.message)),
    });
    client.requestAccessToken({ prompt, login_hint: loginHint });
  });
}

/** Who a token belongs to. `sub` is Google's stable account id — the address
    can change, the subject cannot, so accounts are keyed on it. */
async function identify(accessToken: string): Promise<{ id: string; email: string }> {
  const res = await fetch(USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Could not read the Google profile (${res.status}).`);
  const profile = (await res.json()) as { sub?: string; email?: string };
  const email = profile.email ?? "";
  const id = profile.sub ?? email;
  if (!id) throw new Error("Google did not return an account id.");
  return { id, email };
}

/** Interactive sign-in: always offers the account chooser, so a second, third
    or fourth account can be added without signing the first one out. */
export async function signInToGoogle(clientId: string): Promise<{ id: string; email: string }> {
  // The native shell cannot run GSI (popup-based, origin-checked) — it runs
  // Google's installed-app PKCE flow in a Custom Tab instead. Same contract.
  if (isNative) return (await import("./native/googleAuth")).nativeSignIn(clientId);
  const token = await requestToken(clientId, "select_account");
  const who = await identify(token.accessToken);
  restoreTokens();
  tokens.set(who.id, token);
  persistTokens();
  return who;
}

/** One GIS renewal for an account we already know, plus the wrong-account
    guard. `prompt` is "" for the hidden-iframe silent path and "select_account"
    for the interactive fallback — the call Google makes is otherwise identical,
    so the silent sync loop and the reconnect click share this. Returns the
    resolved identity so a changed primary email can be written back. */
async function renewToken(
  clientId: string,
  account: { id: string; email: string },
  prompt: "" | "select_account" = "",
): Promise<{ id: string; email: string }> {
  const fresh = await requestToken(clientId, prompt, account.email);
  const who = await identify(fresh.accessToken);
  // A renewal can land on a DIFFERENT Google account when the browser session
  // moved on. Handing that token to the wrong calendar would quietly sync one
  // account's tasks into another's, so refuse it.
  if (who.id !== account.id) {
    tokens.delete(account.id);
    persistTokens();
    throw new NeedsConsentError(account.email);
  }
  tokens.set(account.id, fresh);
  persistTokens();
  silentCooldown.delete(account.id);
  return who;
}

/** A usable token for an account: the cached one while it lives, then a renewal
    if the caller allows one.
    - `allowPrompt` (a user gesture): interactive renewal, a popup is fine.
    - `silent` (background sync): try GIS's hidden-iframe renewal, but never
      force a popup and never hammer GIS — one failure buys a cooldown, after
      which the caller just gets NeedsConsentError and the UI asks for a click.
    - neither: throw NeedsConsentError immediately. */
export async function accessTokenFor(
  clientId: string,
  account: { id: string; email: string },
  opts: { allowPrompt?: boolean; silent?: boolean } = {},
): Promise<string> {
  if (isNative) return (await import("./native/googleAuth")).nativeAccessTokenFor(clientId, account, opts);
  restoreTokens();
  const cached = tokens.get(account.id);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  if (opts.allowPrompt) {
    await renewToken(clientId, account);
    return tokens.get(account.id)!.accessToken;
  }

  if (opts.silent) {
    const failedAt = silentCooldown.get(account.id);
    if (failedAt !== undefined && Date.now() - failedAt < SILENT_COOLDOWN_MS) {
      throw new NeedsConsentError(account.email);
    }
    try {
      await renewToken(clientId, account);
      return tokens.get(account.id)!.accessToken;
    } catch (err) {
      silentCooldown.set(account.id, Date.now());
      throw err instanceof NeedsConsentError ? err : new NeedsConsentError(account.email);
    }
  }

  throw new NeedsConsentError(account.email);
}

/** Interactive re-consent for an account already known to us — the LetsGo-logo
    click and the Settings "reconnect" button. Popups expected. Falls back from
    the silent hint to the full account chooser when the session is truly gone,
    which is exactly what "reconnect me" should surface. Returns the resolved
    identity so a changed primary email can be written back. */
export async function reconnectGoogleAccount(
  clientId: string,
  account: { id: string; email: string },
): Promise<{ id: string; email: string }> {
  if (isNative) {
    await (await import("./native/googleAuth")).nativeAccessTokenFor(clientId, account, { allowPrompt: true });
    return { id: account.id, email: account.email };
  }
  try {
    return await renewToken(clientId, account);
  } catch (err) {
    if (!(err instanceof NeedsConsentError)) throw err;
    return renewToken(clientId, account, "select_account");
  }
}

/** Sign an account out of this browser: drop the token and tell Google. */
export async function revokeGoogleAccount(accountId: string): Promise<void> {
  if (isNative) return (await import("./native/googleAuth")).nativeRevoke(accountId);
  restoreTokens();
  const token = tokens.get(accountId);
  forgetGoogleToken(accountId);
  if (!token) return;
  try {
    await loadGsi();
    window.google?.accounts.oauth2.revoke(token.accessToken);
  } catch { /* the local token is already gone, which is what matters here */ }
}
