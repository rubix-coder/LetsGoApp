/* Google sign-in for the native shell.

   GSI's token client (lib/gcalAuth.ts) is popup-based and origin-checked —
   both dead ends inside a WebView. The native app runs the OAuth flow the way
   Google specifies for installed apps instead: authorization-code + PKCE in a
   Custom Tab, redirecting back via the reverse-client-ID custom scheme, code
   exchanged at the token endpoint with no client secret (Android client type).

   One genuine improvement falls out: installed-app clients get REFRESH tokens,
   so renewals here are truly silent — no popup ever, unlike the web's GSI
   "silent" renewal. The refresh-token map lives under a letsgo.* localStorage
   key, which the persistMirror makes durable app data.

   Setup this needs (see webapp/ANDROID.md): an Android-type OAuth client for
   package com.rubixcoder.letsgo + signing SHA-1, its client id entered in
   Settings → Google Calendar, and the reverse-client-ID scheme filled into
   `googleOauthScheme` in android/app/build.gradle. */

import { CapacitorHttp } from "@capacitor/core";
import { GOOGLE_SCOPES, NeedsConsentError } from "../gcalAuth";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo";
const REFRESH_KEY = "letsgo.googleRefresh";
const AUTH_TIMEOUT_MS = 5 * 60_000;

/* ————— redirect scheme ————— */

/** Google's canonical installed-app redirect: the client id, reversed, as the
    scheme. "123-abc.apps.googleusercontent.com" →
    "com.googleusercontent.apps.123-abc:/oauth2redirect". A non-Google-shaped
    id falls back to the package scheme (also in the manifest). */
export function redirectUriFor(clientId: string): string {
  const m = /^(.+)\.apps\.googleusercontent\.com$/.exec(clientId.trim());
  const scheme = m ? `com.googleusercontent.apps.${m[1]}` : "com.rubixcoder.letsgo";
  return `${scheme}:/oauth2redirect`;
}

/* ————— PKCE bits ————— */

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(byteLen: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLen)));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/* ————— token + refresh caches ————— */

interface NativeToken {
  accessToken: string;
  /** Epoch ms, a minute early so a request never races expiry. */
  expiresAt: number;
}

const tokens = new Map<string, NativeToken>();

function refreshMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(REFRESH_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function setRefresh(accountId: string, token: string | null): void {
  const map = refreshMap();
  if (token === null) delete map[accountId];
  else map[accountId] = token;
  localStorage.setItem(REFRESH_KEY, JSON.stringify(map));
}

/* ————— the wire calls ————— */

interface TokenGrant {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(fields: Record<string, string>): Promise<TokenGrant> {
  // Native http: the token endpoint has no CORS contract with our origin.
  const res = await CapacitorHttp.request({
    url: TOKEN_URL,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: new URLSearchParams(fields).toString(),
  });
  const data: unknown = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  return (data ?? {}) as TokenGrant;
}

function cacheGrant(accountId: string, grant: TokenGrant): NativeToken {
  const token: NativeToken = {
    accessToken: grant.access_token!,
    expiresAt: Date.now() + Math.max(0, (grant.expires_in ?? 3600) - 60) * 1000,
  };
  tokens.set(accountId, token);
  if (grant.refresh_token) setRefresh(accountId, grant.refresh_token);
  return token;
}

async function identify(accessToken: string): Promise<{ id: string; email: string }> {
  const res = await CapacitorHttp.request({
    url: USERINFO,
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`Could not read the Google profile (${res.status}).`);
  const profile = (typeof res.data === "string" ? JSON.parse(res.data) : res.data) as { sub?: string; email?: string };
  const email = profile.email ?? "";
  const id = profile.sub ?? email;
  if (!id) throw new Error("Google did not return an account id.");
  return { id, email };
}

/* ————— the Custom Tab round-trip ————— */

async function authorize(clientId: string, opts: { prompt?: string; loginHint?: string }): Promise<{ code: string; verifier: string; redirectUri: string }> {
  const { App } = await import("@capacitor/app");
  const { Browser } = await import("@capacitor/browser");

  const verifier = randomString(48);
  const state = randomString(16);
  const redirectUri = redirectUriFor(clientId);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256",
    state,
  });
  if (opts.prompt) params.set("prompt", opts.prompt);
  if (opts.loginHint) params.set("login_hint", opts.loginHint);

  const code = await new Promise<string>((resolve, reject) => {
    let cleanup = () => {};
    const timer = setTimeout(() => {
      cleanup();
      reject(new NeedsConsentError(opts.loginHint, "the sign-in window was abandoned"));
    }, AUTH_TIMEOUT_MS);

    const listener = App.addListener("appUrlOpen", ({ url }) => {
      if (!url.split("?")[0].endsWith("/oauth2redirect")) return;
      cleanup();
      // Android Custom Tabs may or may not implement close(); the intent has
      // already brought the app back to front either way.
      void Browser.close().catch(() => undefined);
      const query = new URLSearchParams(url.split("?")[1] ?? "");
      if (query.get("state") !== state) {
        reject(new NeedsConsentError(opts.loginHint, "state mismatch"));
        return;
      }
      const err = query.get("error");
      const got = query.get("code");
      if (err || !got) reject(new NeedsConsentError(opts.loginHint, err ?? "Google returned no code"));
      else resolve(got);
    });
    cleanup = () => {
      clearTimeout(timer);
      void listener.then((h) => h.remove()).catch(() => undefined);
    };

    void listener
      .then(() => Browser.open({ url: `${AUTH_URL}?${params.toString()}` }))
      .catch((e) => {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });

  return { code, verifier, redirectUri };
}

async function interactiveGrant(clientId: string, opts: { prompt?: string; loginHint?: string }): Promise<{ who: { id: string; email: string }; grant: TokenGrant }> {
  const { code, verifier, redirectUri } = await authorize(clientId, opts);
  const grant = await tokenRequest({
    client_id: clientId,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (!grant.access_token) throw new NeedsConsentError(opts.loginHint, grant.error_description ?? grant.error ?? "token exchange failed");
  const who = await identify(grant.access_token);
  return { who, grant };
}

/* ————— API mirrored by lib/gcalAuth.ts ————— */

export async function nativeSignIn(clientId: string): Promise<{ id: string; email: string }> {
  const { who, grant } = await interactiveGrant(clientId, { prompt: "select_account" });
  cacheGrant(who.id, grant);
  return who;
}

export async function nativeAccessTokenFor(
  clientId: string,
  account: { id: string; email: string },
  opts: { allowPrompt?: boolean; silent?: boolean } = {},
): Promise<string> {
  const cached = tokens.get(account.id);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  // Truly silent renewal — the whole reason this flow keeps refresh tokens. The
  // `silent` opt needs no special handling here: the refresh-token attempt
  // below already runs unconditionally, and without one a non-`allowPrompt`
  // caller (silent included) falls through to NeedsConsentError.
  const refresh = refreshMap()[account.id];
  if (refresh) {
    const grant = await tokenRequest({ client_id: clientId, refresh_token: refresh, grant_type: "refresh_token" });
    if (grant.access_token) return cacheGrant(account.id, grant).accessToken;
    setRefresh(account.id, null); // revoked or expired — fall through to a real sign-in
  }

  if (!opts.allowPrompt) throw new NeedsConsentError(account.email);

  const { who, grant } = await interactiveGrant(clientId, { loginHint: account.email });
  // Same guard as the web path: a renewal that lands on a DIFFERENT Google
  // account must not leak one account's token into another's calendar.
  if (who.id !== account.id) {
    tokens.delete(account.id);
    throw new NeedsConsentError(account.email);
  }
  cacheGrant(account.id, grant);
  return grant.access_token!;
}

export function nativeForget(accountId: string): void {
  tokens.delete(accountId);
  setRefresh(accountId, null);
}

export async function nativeRevoke(accountId: string): Promise<void> {
  const refresh = refreshMap()[accountId];
  const cached = tokens.get(accountId);
  nativeForget(accountId);
  const token = refresh ?? cached?.accessToken;
  if (!token) return;
  await CapacitorHttp.request({
    url: REVOKE_URL,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: new URLSearchParams({ token }).toString(),
  }).catch(() => undefined);
}
