/* SQLite data layer over node:sqlite (DatabaseSync). All persistence lives here;
   routes never touch SQL directly. Tenant isolation is enforced by always
   scoping reads/writes through membership joins. */

import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { Member, Project, ProjectRole, User, Workspace, WorkspaceRole } from "./types.ts";

// node:sqlite is a newer built-in the bundler (Vite/esbuild in tests) won't
// externalize, so load it at runtime via require — a call it won't try to
// resolve — while keeping the compile-time type.
const sqlite = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
export type DB = InstanceType<typeof sqlite.DatabaseSync>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS project_docs (
  project_id TEXT PRIMARY KEY,
  rev INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

export function openDb(path = ":memory:"): DB {
  const db = new sqlite.DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

const uid = () => randomUUID();
const now = () => Date.now();

/* ————— users + sessions ————— */

export function createUser(db: DB, username: string, passwordHash: string, email?: string): User {
  const id = uid();
  const t = now();
  db.prepare("INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, username, email ?? null, passwordHash, t);
  return { id, username, email, created_at: t };
}

export function userByUsername(db: DB, username: string): (User & { password_hash: string }) | undefined {
  const r = db.prepare("SELECT id, username, email, password_hash, created_at FROM users WHERE username = ?").get(username) as any;
  return r ? { id: r.id, username: r.username, email: r.email ?? undefined, password_hash: r.password_hash, created_at: r.created_at } : undefined;
}

export function userById(db: DB, id: string): User | undefined {
  const r = db.prepare("SELECT id, username, email, created_at FROM users WHERE id = ?").get(id) as any;
  return r ? { id: r.id, username: r.username, email: r.email ?? undefined, created_at: r.created_at } : undefined;
}

export function countUsers(db: DB): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n as number;
}

export function createSession(db: DB, userId: string, ttlMs: number): string {
  const id = randomUUID() + randomUUID().replace(/-/g, "");
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(id, userId, now() + ttlMs);
  return id;
}

export function sessionUser(db: DB, sessionId: string): User | undefined {
  const r = db.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?").get(sessionId) as any;
  if (!r) return undefined;
  if (r.expires_at < now()) { db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId); return undefined; }
  return userById(db, r.user_id);
}

export function deleteSession(db: DB, sessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

/* ————— workspaces ————— */

export function createWorkspace(db: DB, name: string, ownerId: string): Workspace {
  const id = uid();
  const t = now();
  db.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").run(id, name, t);
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')").run(id, ownerId);
  return { id, name, created_at: t, role: "admin" };
}

export function workspacesForUser(db: DB, userId: string): Workspace[] {
  return (db.prepare(
    `SELECT w.id, w.name, w.created_at, m.role FROM workspaces w
     JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ?
     ORDER BY w.created_at`,
  ).all(userId) as any[]).map((r) => ({ id: r.id, name: r.name, created_at: r.created_at, role: r.role as WorkspaceRole }));
}

export function workspaceRole(db: DB, workspaceId: string, userId: string): WorkspaceRole | undefined {
  const r = db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(workspaceId, userId) as any;
  return r?.role as WorkspaceRole | undefined;
}

export function addWorkspaceMember(db: DB, workspaceId: string, userId: string, role: WorkspaceRole): void {
  db.prepare("INSERT OR REPLACE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(workspaceId, userId, role);
}

/* ————— projects + members ————— */

export function createProject(db: DB, workspaceId: string, name: string, ownerId: string): Project {
  const id = uid();
  const t = now();
  db.prepare("INSERT INTO projects (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)").run(id, workspaceId, name, t);
  db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')").run(id, ownerId);
  db.prepare("INSERT INTO project_docs (project_id, rev, data, updated_at, updated_by) VALUES (?, 0, '{}', ?, ?)").run(id, t, ownerId);
  return { id, workspace_id: workspaceId, name, created_at: t, role: "owner" };
}

export function projectById(db: DB, id: string): Project | undefined {
  const r = db.prepare("SELECT id, workspace_id, name, created_at FROM projects WHERE id = ?").get(id) as any;
  return r ? { id: r.id, workspace_id: r.workspace_id, name: r.name, created_at: r.created_at } : undefined;
}

export function projectsForUser(db: DB, workspaceId: string, userId: string): Project[] {
  // Projects the user is a direct member of, plus (for workspace admins) every
  // project in the workspace.
  const isAdmin = workspaceRole(db, workspaceId, userId) === "admin";
  const rows = isAdmin
    ? db.prepare(
        `SELECT p.id, p.workspace_id, p.name, p.created_at, pm.role
         FROM projects p LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
         WHERE p.workspace_id = ? ORDER BY p.created_at`,
      ).all(userId, workspaceId)
    : db.prepare(
        `SELECT p.id, p.workspace_id, p.name, p.created_at, pm.role
         FROM projects p JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
         WHERE p.workspace_id = ? ORDER BY p.created_at`,
      ).all(userId, workspaceId);
  return (rows as any[]).map((r) => ({
    id: r.id, workspace_id: r.workspace_id, name: r.name, created_at: r.created_at,
    role: (r.role as ProjectRole) ?? (isAdmin ? "co_admin" : undefined),
  }));
}

export function projectMemberRole(db: DB, projectId: string, userId: string): ProjectRole | undefined {
  const r = db.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?").get(projectId, userId) as any;
  return r?.role as ProjectRole | undefined;
}

export function setProjectMember(db: DB, projectId: string, userId: string, role: ProjectRole): void {
  db.prepare("INSERT OR REPLACE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)").run(projectId, userId, role);
}

export function removeProjectMember(db: DB, projectId: string, userId: string): void {
  db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(projectId, userId);
}

export function projectMembers(db: DB, projectId: string): Member[] {
  return (db.prepare(
    `SELECT pm.user_id, u.username, pm.role FROM project_members pm
     JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? ORDER BY pm.role`,
  ).all(projectId) as any[]).map((r) => ({ user_id: r.user_id, username: r.username, role: r.role as ProjectRole }));
}

/* ————— docs ————— */

export function getDoc(db: DB, projectId: string): { rev: number; data: unknown; updated_at: number; updated_by: string | null } | undefined {
  const r = db.prepare("SELECT rev, data, updated_at, updated_by FROM project_docs WHERE project_id = ?").get(projectId) as any;
  return r ? { rev: r.rev, data: JSON.parse(r.data), updated_at: r.updated_at, updated_by: r.updated_by } : undefined;
}

/** Optimistic write: succeeds only if baseRev matches the stored rev; returns
    the new rev, or null on a conflict (caller returns 409 with the current doc). */
export function putDoc(db: DB, projectId: string, baseRev: number, data: unknown, userId: string): number | null {
  const cur = db.prepare("SELECT rev FROM project_docs WHERE project_id = ?").get(projectId) as any;
  if (!cur || cur.rev !== baseRev) return null;
  const next = cur.rev + 1;
  db.prepare("UPDATE project_docs SET rev = ?, data = ?, updated_at = ?, updated_by = ? WHERE project_id = ?")
    .run(next, JSON.stringify(data), now(), userId, projectId);
  return next;
}

/* ————— invites ————— */

export function createInvite(db: DB, projectId: string, role: ProjectRole, createdBy: string, ttlMs: number): { id: string; token: string } {
  const id = uid();
  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  db.prepare("INSERT INTO invites (id, token, project_id, role, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, token, projectId, role, createdBy, now() + ttlMs);
  return { id, token };
}

export function inviteByToken(db: DB, token: string): { id: string; project_id: string; role: ProjectRole } | undefined {
  const r = db.prepare("SELECT id, project_id, role, expires_at FROM invites WHERE token = ?").get(token) as any;
  if (!r || r.expires_at < now()) return undefined;
  return { id: r.id, project_id: r.project_id, role: r.role as ProjectRole };
}

export function consumeInvite(db: DB, id: string): void {
  db.prepare("DELETE FROM invites WHERE id = ?").run(id);
}
