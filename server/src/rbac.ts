/* Role resolution + the access matrix. A workspace admin implicitly has owner
   power over every project in that workspace, so effective role is the higher of
   the direct project role and the workspace-derived one. */

import type { DB } from "./store.ts";
import { projectById, projectMemberRole, workspaceRole } from "./store.ts";
import { PROJECT_ROLE_RANK, type ProjectRole } from "./types.ts";

export interface Access {
  project: { id: string; workspace_id: string; name: string; created_at: number };
  role: ProjectRole;
}

/** Effective project role for a user, or undefined if they cannot see it at all
    (not a member and not a workspace admin) — the tenant-isolation gate. */
export function effectiveProjectRole(db: DB, projectId: string, userId: string): Access | undefined {
  const project = projectById(db, projectId);
  if (!project) return undefined;
  const direct = projectMemberRole(db, projectId, userId);
  const wsAdmin = workspaceRole(db, project.workspace_id, userId) === "admin";
  if (!direct && !wsAdmin) return undefined;
  const role: ProjectRole = wsAdmin && (!direct || PROJECT_ROLE_RANK[direct] < PROJECT_ROLE_RANK.owner) ? "owner" : direct!;
  return { project, role };
}

export function atLeast(role: ProjectRole, min: ProjectRole): boolean {
  return PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK[min];
}
