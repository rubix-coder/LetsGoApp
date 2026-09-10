/* WebDAV sync: the encrypted vault blob (never plaintext) PUT/GET to a WebDAV
   share you host. Designed around the failure that got sync removed from an
   earlier desktop build: every call here is off the action path, aborts after
   a hard timeout, and any error just leaves the app local-only. */

import { CapacitorHttp } from "@capacitor/core";
import type { VaultPayload } from "./crypto";
import { isNative, resolveNasUrl } from "./native/platform";

export interface SyncConfig {
  enabled: boolean;
  /** WebDAV base — "/webdav" when served same-origin, or an absolute
      "https://host/webdav". The vault lives at <url>/letsgo-web/vault.json. */
  url: string;
  username: string;
  password: string;
}

/** Vault blob + sync lineage. `stamp` is the IDENTITY of one particular save —
    the only field sync decisions are allowed to compare.

    `rev` used to play that role and could not: every device increments its own
    copy (`rev + 1` on each local save), so two devices that edit independently
    land on the SAME rev with DIFFERENT content. Comparing revs then reads
    "same number → same content" and both sides settle into a permanent
    divergence while each reports a clean sync. `stamp` is unique per save per
    device, so equal stamps really do mean equal bytes. `rev` survives as a
    human-readable save counter and `savedAt` as the wall clock that breaks
    genuine conflicts; neither decides anything on its own. */
export interface SyncedPayload extends VaultPayload {
  rev: number;
  savedAt: number;
  device: string;
  /** Absent on vaults written before stamped lineage — see `payloadStamp`. */
  stamp?: string;
}

/** Identity of a save. Pre-stamp blobs fall back to the (device, rev, savedAt)
    triple, which is device-scoped and so cannot collide across devices the way
    a bare rev does. */
export function payloadStamp(p: SyncedPayload): string {
  return p.stamp ?? `${p.device}:${p.rev}:${p.savedAt}`;
}

export function newStamp(device: string): string {
  return `${device}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const TIMEOUT_MS = 8000;

/** True when running inside the Tauri wrapper (the Tauri-built Android APK). */
export function insideTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Pick the fetch for this request. In the browser and the Electron shell
    that's the platform fetch (same-origin "/webdav" rides the shell's NAS
    proxy). Inside the Tauri APK the webview's fetch enforces CORS the NAS
    never answers and no /webdav proxy exists — so absolute URLs go through
    Tauri's HTTP plugin, which fetches from Rust and is CORS-exempt. The
    import is dynamic: non-Tauri sessions never load the plugin chunk.
    (The Capacitor shell never reaches this — davFetch branches to the
    native http stack first.) */
async function resolveFetch(url: string): Promise<typeof fetch> {
  if (!insideTauri() || url.startsWith("/")) return fetch;
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  return tauriFetch as typeof fetch;
}

function headers(cfg: SyncConfig): Record<string, string> {
  return { Authorization: `Basic ${btoa(`${cfg.username}:${cfg.password}`)}` };
}

function fileUrl(cfg: SyncConfig): string {
  return `${cfg.url.replace(/\/$/, "")}/letsgo-web/vault.json`;
}

function dirUrl(cfg: SyncConfig): string {
  return `${cfg.url.replace(/\/$/, "")}/letsgo-web/`; // MKCOL wants the trailing slash
}

/** The slice of Response every transport can honor. */
interface DavResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
}

async function davFetch(url: string, init: { method: string; body?: string; headers?: Record<string, string>; cache?: RequestCache }, cfg: SyncConfig): Promise<DavResponse> {
  // Native shell: the app runs on Capacitor's local origin, so "/webdav" is
  // re-anchored onto the NAS, and the request goes through the NATIVE http
  // stack — no CORS preflight the NAS was never configured for, and no
  // WebView Basic-auth popup either.
  if (isNative) {
    const res = await CapacitorHttp.request({
      url: resolveNasUrl(url),
      method: init.method,
      headers: { ...headers(cfg), ...init.headers },
      data: init.body,
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
    });
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      text: async () => (typeof res.data === "string" ? res.data : JSON.stringify(res.data)),
    };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // credentials:"omit" — on a 401 + WWW-Authenticate the browser otherwise
    // raises its NATIVE Basic-auth popup over the app (re-appearing with
    // every sync retry while the stored password is wrong — the "5 second
    // credential loop"). Auth rides our explicit Authorization header,
    // which the credentials mode does not affect.
    const doFetch = await resolveFetch(url);
    return await doFetch(url, { ...init, headers: { ...headers(cfg), ...init.headers }, signal: ctrl.signal, credentials: "omit" });
  } finally {
    clearTimeout(t);
  }
}

/** undefined = no remote vault yet. Throws on auth/network trouble. */
export async function pullRemote(cfg: SyncConfig): Promise<SyncedPayload | undefined> {
  const res = await davFetch(fileUrl(cfg), { method: "GET", cache: "no-store" }, cfg);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`GET ${res.status}`);
  const body = await res.text();
  // A same-origin "/webdav" URL with no proxy behind it (e.g. the Android
  // app) falls through to the SPA and answers 200 with index.html — surface
  // that as a wrong-URL problem, not "Unexpected token '<'".
  if (body.trimStart().startsWith("<")) {
    throw new Error(
      "that URL answered with a webpage, not the vault. Use the full WebDAV address of your NAS (https://…/webdav) — the bare \"/webdav\" shortcut only works in the desktop shell.",
    );
  }
  return JSON.parse(body) as SyncedPayload;
}

export async function pushRemote(cfg: SyncConfig, payload: SyncedPayload): Promise<void> {
  // MKCOL the folder; 405 = already exists (nginx quirk the desktop learned).
  // Android's native http stack refuses custom verbs outright (HttpURLConnection
  // whitelist), so there a failed MKCOL is advisory — the folder almost always
  // exists already, and when it truly doesn't the PUT below reports it.
  try {
    const mk = await davFetch(dirUrl(cfg), { method: "MKCOL" }, cfg);
    if (!mk.ok && mk.status !== 405 && mk.status !== 301) throw new Error(`MKCOL ${mk.status}`);
  } catch (err) {
    if (!isNative) throw err;
  }
  const res = await davFetch(fileUrl(cfg), {
    method: "PUT",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  }, cfg);
  if (!res.ok) throw new Error(`PUT ${res.status}`);
}

export type SyncPlan =
  | { action: "noop" }
  | { action: "push" }
  | { action: "pull"; remote: SyncedPayload }
  /** Both sides advanced since the last sync — LWW; loser gets stashed. */
  | { action: "conflict"; winner: "local" | "remote"; remote: SyncedPayload };

/** Pure decision: compare the remote blob against ours by save IDENTITY.
    `syncedStamp` is the stamp both sides agreed on at the last successful sync
    (null when this device has never synced).

    Whichever side still carries `syncedStamp` is the side that has not moved,
    so the other one is the one to propagate. When NEITHER carries it both
    edited since the last agreement and it is a true conflict — resolved
    last-write-wins on `savedAt`, with the loser stashed by the caller. */
export function decideSync(
  remote: SyncedPayload | undefined,
  local: SyncedPayload,
  syncedStamp: string | null,
): SyncPlan {
  if (!remote) return { action: "push" };
  const remoteStamp = payloadStamp(remote);
  const localStamp = payloadStamp(local);
  // Byte-identical saves — nothing to do regardless of what the revs say.
  if (remoteStamp === localStamp) return { action: "noop" };
  if (remoteStamp === syncedStamp) return { action: "push" };
  if (localStamp === syncedStamp) return { action: "pull", remote };
  return { action: "conflict", winner: remote.savedAt > local.savedAt ? "remote" : "local", remote };
}

/** Stable per-browser device name for the blob's `device` field. */
export function deviceName(): string {
  const KEY = "letsgo.device";
  let name = localStorage.getItem(KEY);
  if (!name) {
    name = `web-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(KEY, name);
  }
  return name;
}
