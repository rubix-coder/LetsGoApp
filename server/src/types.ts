/* API contract shared conceptually with the webapp client (webapp/src/lib/api.ts
   mirrors these). The project document `data` is the webapp's AppState, opaque to
   the server — stored and revved, never interpreted here. */

export type WorkspaceRole = "admin" | "member";
export type ProjectRole = "owner" | "co_admin" | "editor" | "viewer";

export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 1,
  editor: 2,
  co_admin: 3,
  owner: 4,
};

export interface User {
  id: string;
  username: string;
  email?: string;
  created_at: number;
}

export interface Workspace {
  id: string;
  name: string;
  created_at: number;
  /** The caller's workspace role, included on list/get responses. */
  role?: WorkspaceRole;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  created_at: number;
  /** The caller's effective project role. */
  role?: ProjectRole;
}

export interface Member {
  user_id: string;
  username: string;
  role: ProjectRole;
}

export interface DocResponse {
  rev: number;
  data: unknown;
  updated_at: number;
  updated_by: string | null;
}

/** PUT /projects/:id/doc body. `baseRev` is the rev the client last saw; the
    server accepts only if it still matches (optimistic concurrency). */
export interface DocPut {
  baseRev: number;
  data: unknown;
}
