/* Typed client for the optional team backend (server/). Mirrors its API
   contract. Cookies carry the session, so every request sends credentials; the
   base URL is same-origin by default (the compose deploy serves web + api on one
   origin) and overridable for a separate host. Used only in "team" mode — local
   vault mode never touches this. */

import { CapacitorHttp } from "@capacitor/core";
import { isNative, NAS_ORIGIN } from "./native/platform";

export type WorkspaceRole = "admin" | "member";
export type ProjectRole = "owner" | "co_admin" | "editor" | "viewer";

export interface ApiUser { id: string; username: string; email?: string; created_at: number }
export interface ApiWorkspace { id: string; name: string; created_at: number; role?: WorkspaceRole }
export interface ApiProject { id: string; workspace_id: string; name: string; created_at: number; role?: ProjectRole }
export interface ApiMember { user_id: string; username: string; role: ProjectRole }
export interface ApiDoc { rev: number; data: unknown; updated_at: number; updated_by: string | null }

const BASE_KEY = "letsgo.serverUrl";

export function serverUrl(): string {
  const stored = localStorage.getItem(BASE_KEY) ?? "";
  // Same-origin is meaningless inside the native shell (its origin is the app
  // bundle) — an unset base defaults to the NAS the deployed webapp lives on.
  if (isNative && stored === "") return NAS_ORIGIN;
  return stored;
}
export function setServerUrl(url: string): void {
  localStorage.setItem(BASE_KEY, url.replace(/\/$/, ""));
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** A stale-write conflict (HTTP 409) carries the server's current doc so the
    caller can reconcile — the doc-sync equivalent of the vault's rev conflict. */
export class ConflictError extends Error {
  constructor(public current: ApiDoc) { super("conflict"); }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let status: number;
  let ok: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  if (isNative) {
    // Native http stack: the session cookie rides Android's CookieManager, so
    // the server's Secure first-party cookie works without any CORS support —
    // the same trust model as the same-origin web deploy.
    const res = await CapacitorHttp.request({
      url: serverUrl() + path,
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      data: body !== undefined ? body : undefined,
    });
    status = res.status;
    ok = status >= 200 && status < 300;
    json = typeof res.data === "string" ? (() => { try { return JSON.parse(res.data); } catch { return undefined; } })() : res.data;
  } else {
    const res = await fetch(serverUrl() + path, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    ok = res.ok;
    json = await res.json().catch(() => undefined);
  }
  if (status === 409 && json?.conflict) throw new ConflictError(json.current as ApiDoc);
  if (!ok) throw new ApiError(status, json?.error ?? `${method} ${path} → ${status}`);
  return json as T;
}

export const api = {
  // auth
  signup: (username: string, password: string, email?: string, invite?: string) => req<ApiUser>("POST", "/api/auth/signup", { username, password, email, invite }),
  login: (username: string, password: string) => req<ApiUser>("POST", "/api/auth/login", { username, password }),
  logout: () => req<{ ok: true }>("POST", "/api/auth/logout"),
  me: () => req<ApiUser>("GET", "/api/auth/me"),

  // workspaces + projects
  workspaces: () => req<ApiWorkspace[]>("GET", "/api/workspaces"),
  createWorkspace: (name: string) => req<ApiWorkspace>("POST", "/api/workspaces", { name }),
  projects: (workspaceId: string) => req<ApiProject[]>("GET", `/api/workspaces/${workspaceId}/projects`),
  createProject: (workspaceId: string, name: string) => req<ApiProject>("POST", `/api/workspaces/${workspaceId}/projects`, { name }),
  project: (id: string) => req<ApiProject>("GET", `/api/projects/${id}`),

  // members + invites
  members: (projectId: string) => req<ApiMember[]>("GET", `/api/projects/${projectId}/members`),
  invite: (projectId: string, role: ProjectRole) => req<{ id: string; token: string }>("POST", `/api/projects/${projectId}/invites`, { role }),
  acceptInvite: (token: string) => req<{ project_id: string; role: ProjectRole }>("POST", `/api/invites/${token}/accept`),
  setMemberRole: (projectId: string, userId: string, role: ProjectRole) => req<{ ok: true }>("PATCH", `/api/projects/${projectId}/members/${userId}`, { role }),
  removeMember: (projectId: string, userId: string) => req<{ ok: true }>("DELETE", `/api/projects/${projectId}/members/${userId}`),

  // doc sync
  getDoc: (projectId: string) => req<ApiDoc>("GET", `/api/projects/${projectId}/doc`),
  putDoc: (projectId: string, baseRev: number, data: unknown) => req<{ rev: number }>("PUT", `/api/projects/${projectId}/doc`, { baseRev, data }),

  canEdit: (role?: ProjectRole) => role === "owner" || role === "co_admin" || role === "editor",
  canManage: (role?: ProjectRole) => role === "owner" || role === "co_admin",
};
