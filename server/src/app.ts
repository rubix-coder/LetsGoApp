/* Tiny HTTP layer over node:http — routing, JSON, cookies, and the RBAC-guarded
   API. No framework: the whole surface is small and dependency-free. */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import {
  addWorkspaceMember, consumeInvite, countUsers, createInvite, createProject, createSession,
  createUser, createWorkspace, deleteSession, getDoc, inviteByToken, openDb, projectById,
  projectMembers, projectsForUser, putDoc, removeProjectMember, sessionUser, setProjectMember,
  userByUsername, workspaceRole, workspacesForUser, type DB,
} from "./store.ts";
import { clearCookie, hashPassword, readCookie, SESSION_COOKIE, SESSION_TTL_MS, sessionCookie, verifyPassword } from "./auth.ts";
import { atLeast, effectiveProjectRole } from "./rbac.ts";
import { PROJECT_ROLE_RANK, type ProjectRole, type User } from "./types.ts";

export interface AppOpts { db?: DB; allowSignup?: boolean; secureCookies?: boolean; }

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string): never => { throw new HttpError(status, message); };

interface Ctx {
  db: DB;
  user: User | undefined;
  params: Record<string, string>;
  body: any;
  opts: Required<Omit<AppOpts, "db">>;
}
type Result = { status?: number; body?: unknown; cookie?: string } | void;
interface Route { method: string; parts: string[]; fn: (c: Ctx) => Promise<Result> | Result; }

const seg = (path: string) => path.split("/").filter(Boolean);
function match(route: Route, method: string, parts: string[]): Record<string, string> | null {
  if (route.method !== method || route.parts.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const r = route.parts[i];
    if (r.startsWith(":")) params[r.slice(1)] = decodeURIComponent(parts[i]);
    else if (r !== parts[i]) return null;
  }
  return params;
}

const requireUser = (c: Ctx): User => c.user ?? fail(401, "not signed in");
function requireAccess(c: Ctx, projectId: string, min: ProjectRole) {
  const u = requireUser(c);
  const access = effectiveProjectRole(c.db, projectId, u.id);
  // 404 (not 403) when the caller can't see the project at all — don't leak existence.
  if (!access) fail(404, "not found");
  if (!atLeast(access!.role, min)) fail(403, `requires ${min}`);
  return { user: u, ...access! };
}

/* ————— routes ————— */

const routes: { method: string; path: string; fn: (c: Ctx) => Promise<Result> | Result }[] = [
  { method: "POST", path: "/api/auth/signup", fn: (c) => {
    const first = countUsers(c.db) === 0;
    // A valid invite token is as good as open signup: the link came from a
    // project co_admin/owner, so the account may be created while public
    // signup stays closed — and it lands directly in the inviting project.
    const inviteToken = typeof c.body?.invite === "string" ? c.body.invite : undefined;
    const inv = inviteToken ? inviteByToken(c.db, inviteToken) : undefined;
    if (!first && !c.opts.allowSignup && !inv) fail(403, "signups are disabled");
    const { username, password, email } = c.body ?? {};
    if (typeof username !== "string" || username.length < 3 || typeof password !== "string" || password.length < 8) fail(400, "username (3+) and password (8+) required");
    if (userByUsername(c.db, username)) fail(409, "username taken");
    const user = createUser(c.db, username, hashPassword(password), email);
    if (inv) {
      const project = projectById(c.db, inv.project_id);
      if (project) {
        if (!workspaceRole(c.db, project.workspace_id, user.id)) addWorkspaceMember(c.db, project.workspace_id, user.id, "member");
        setProjectMember(c.db, inv.project_id, user.id, inv.role);
        consumeInvite(c.db, inv.id);
      }
    }
    const sid = createSession(c.db, user.id, SESSION_TTL_MS);
    return { body: user, cookie: sessionCookie(sid, c.opts.secureCookies) };
  } },

  { method: "POST", path: "/api/auth/login", fn: (c) => {
    const { username, password } = c.body ?? {};
    const row = typeof username === "string" ? userByUsername(c.db, username) : undefined;
    if (!row || typeof password !== "string" || !verifyPassword(password, row.password_hash)) fail(401, "invalid credentials");
    const sid = createSession(c.db, row!.id, SESSION_TTL_MS);
    return { body: { id: row!.id, username: row!.username, email: row!.email, created_at: row!.created_at }, cookie: sessionCookie(sid, c.opts.secureCookies) };
  } },

  { method: "POST", path: "/api/auth/logout", fn: (c) => {
    const sid = c.params.__sid;
    if (sid) deleteSession(c.db, sid);
    return { body: { ok: true }, cookie: clearCookie(c.opts.secureCookies) };
  } },

  { method: "GET", path: "/api/auth/me", fn: (c) => ({ body: requireUser(c) }) },

  { method: "GET", path: "/api/workspaces", fn: (c) => ({ body: workspacesForUser(c.db, requireUser(c).id) }) },

  { method: "POST", path: "/api/workspaces", fn: (c) => {
    const u = requireUser(c);
    const name = String(c.body?.name ?? "").trim();
    if (!name) fail(400, "name required");
    return { body: createWorkspace(c.db, name, u.id) };
  } },

  { method: "GET", path: "/api/workspaces/:wid/projects", fn: (c) => {
    const u = requireUser(c);
    if (!workspaceRole(c.db, c.params.wid, u.id)) fail(404, "not found");
    return { body: projectsForUser(c.db, c.params.wid, u.id) };
  } },

  { method: "POST", path: "/api/workspaces/:wid/projects", fn: (c) => {
    const u = requireUser(c);
    if (!workspaceRole(c.db, c.params.wid, u.id)) fail(404, "not found");
    const name = String(c.body?.name ?? "").trim();
    if (!name) fail(400, "name required");
    return { body: createProject(c.db, c.params.wid, name, u.id) };
  } },

  { method: "GET", path: "/api/projects/:id", fn: (c) => {
    const a = requireAccess(c, c.params.id, "viewer");
    return { body: { ...a.project, role: a.role } };
  } },

  { method: "GET", path: "/api/projects/:id/members", fn: (c) => {
    requireAccess(c, c.params.id, "viewer");
    return { body: projectMembers(c.db, c.params.id) };
  } },

  { method: "POST", path: "/api/projects/:id/invites", fn: (c) => {
    const a = requireAccess(c, c.params.id, "co_admin");
    const role = (c.body?.role ?? "editor") as ProjectRole;
    if (!(role in PROJECT_ROLE_RANK)) fail(400, "bad role");
    if (PROJECT_ROLE_RANK[role] > PROJECT_ROLE_RANK[a.role]) fail(403, "cannot invite above your own role");
    return { body: createInvite(c.db, c.params.id, role, a.user.id, 7 * 86_400_000) };
  } },

  { method: "POST", path: "/api/invites/:token/accept", fn: (c) => {
    const u = requireUser(c);
    const inv = inviteByToken(c.db, c.params.token);
    if (!inv) fail(404, "invite invalid or expired");
    const project = projectById(c.db, inv!.project_id);
    if (!project) fail(404, "project no longer exists");
    // Grant workspace membership too, so the project is reachable from the
    // invitee's workspace list (a project invite implies workspace access).
    if (!workspaceRole(c.db, project!.workspace_id, u.id)) addWorkspaceMember(c.db, project!.workspace_id, u.id, "member");
    setProjectMember(c.db, inv!.project_id, u.id, inv!.role);
    consumeInvite(c.db, inv!.id);
    return { body: { project_id: inv!.project_id, role: inv!.role } };
  } },

  { method: "PATCH", path: "/api/projects/:id/members/:userId", fn: (c) => {
    const a = requireAccess(c, c.params.id, "co_admin");
    const role = c.body?.role as ProjectRole;
    if (!(role in PROJECT_ROLE_RANK)) fail(400, "bad role");
    if (PROJECT_ROLE_RANK[role] > PROJECT_ROLE_RANK[a.role]) fail(403, "cannot assign above your own role");
    setProjectMember(c.db, c.params.id, c.params.userId, role);
    return { body: { ok: true } };
  } },

  { method: "DELETE", path: "/api/projects/:id/members/:userId", fn: (c) => {
    const a = requireAccess(c, c.params.id, "co_admin");
    const target = projectMembers(c.db, c.params.id).find((m) => m.user_id === c.params.userId);
    if (target?.role === "owner") fail(403, "cannot remove the owner");
    if (a.user.id === c.params.userId) fail(400, "cannot remove yourself here");
    removeProjectMember(c.db, c.params.id, c.params.userId);
    return { body: { ok: true } };
  } },

  { method: "GET", path: "/api/projects/:id/doc", fn: (c) => {
    requireAccess(c, c.params.id, "viewer");
    const doc = getDoc(c.db, c.params.id);
    if (!doc) fail(404, "no doc");
    return { body: doc };
  } },

  { method: "PUT", path: "/api/projects/:id/doc", fn: (c) => {
    const a = requireAccess(c, c.params.id, "editor");
    const { baseRev, data } = c.body ?? {};
    if (typeof baseRev !== "number") fail(400, "baseRev required");
    const rev = putDoc(c.db, c.params.id, baseRev, data, a.user.id);
    if (rev === null) return { status: 409, body: { conflict: true, current: getDoc(c.db, c.params.id) } };
    return { body: { rev } };
  } },
];

const compiled: Route[] = routes.map((r) => ({ method: r.method, parts: seg(r.path), fn: r.fn }));

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (ch: Buffer) => { size += ch.length; if (size > 8 * 1024 * 1024) { reject(new HttpError(413, "body too large")); req.destroy(); } else chunks.push(ch); });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, "invalid JSON")); }
    });
    req.on("error", reject);
  });
}

export function createApp(opts: AppOpts = {}) {
  const db = opts.db ?? openDb(process.env.DB_PATH || ":memory:");
  const resolved: Required<Omit<AppOpts, "db">> = {
    allowSignup: opts.allowSignup ?? process.env.ALLOW_SIGNUP === "true",
    secureCookies: opts.secureCookies ?? process.env.NODE_ENV === "production",
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, body: unknown, cookie?: string) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (cookie) headers["set-cookie"] = cookie;
      res.writeHead(status, headers);
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = seg(url.pathname);
      const sid = readCookie(req.headers.cookie, SESSION_COOKIE);
      const user = sid ? sessionUser(db, sid) : undefined;
      const needsBody = req.method === "POST" || req.method === "PUT" || req.method === "PATCH";
      const body = needsBody ? await readBody(req) : undefined;

      for (const route of compiled) {
        const params = match(route, req.method ?? "GET", parts);
        if (!params) continue;
        if (sid) params.__sid = sid;
        const result = (await route.fn({ db, user, params, body, opts: resolved })) ?? {};
        return send(result.status ?? 200, result.body, result.cookie);
      }
      send(404, { error: "not found" });
    } catch (err) {
      if (err instanceof HttpError) return send(err.status, { error: err.message });
      // eslint-disable-next-line no-console
      console.error(err);
      send(500, { error: "internal error" });
    }
  }

  return { db, handle, listen: (port: number): Server => createServer(handle).listen(port) };
}
