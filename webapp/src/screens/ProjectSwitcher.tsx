import { useEffect, useState } from "react";
import {
  api, type ApiDoc, type ApiMember, type ApiProject, type ApiUser, type ApiWorkspace, type ProjectRole,
} from "../lib/api";
import { hasVault, NO_PASSPHRASE, openVault, unlockMode } from "../lib/store";
import { PENDING_INVITE_KEY } from "../lib/appMode";
import { BP, Wordmark } from "../components/ui";

const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: "Owner", co_admin: "Co-admin", editor: "Editor", viewer: "Viewer",
};

export interface TeamSession { user: ApiUser; project: ApiProject; doc: ApiDoc }

/* After sign-in: pick a project to open. Also the place to spin up a new
   workspace (a fresh, isolated tenant) or project, manage who can see each
   project, and — for co_admins/owners — invite teammates. */
export function ProjectSwitcher({
  user, onPick, onSignOut, onExitTeam,
}: {
  user: ApiUser;
  onPick: (s: TeamSession) => void;
  onSignOut: () => void;
  onExitTeam: () => void;
}) {
  const [workspaces, setWorkspaces] = useState<ApiWorkspace[]>();
  const [projects, setProjects] = useState<Record<string, ApiProject[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newWs, setNewWs] = useState("");
  const [invCode, setInvCode] = useState("");
  const [manage, setManage] = useState<string | null>(null);

  async function reload() {
    setError(null);
    try {
      const ws = await api.workspaces();
      const entries = await Promise.all(ws.map(async (w) => [w.id, await api.projects(w.id)] as const));
      setWorkspaces(ws);
      setProjects(Object.fromEntries(entries));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your workspaces.");
      setWorkspaces([]);
    }
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  // An invite link opened by someone who already had an account: the token is
  // still pending (signup would have consumed it) — accept it now that we
  // have a session, then show the refreshed project list.
  useEffect(() => {
    const token = localStorage.getItem(PENDING_INVITE_KEY);
    if (!token) return;
    localStorage.removeItem(PENDING_INVITE_KEY);
    void api.acceptInvite(token).then(() => reload()).catch((err) => {
      setError(err instanceof Error ? `Invite: ${err.message}` : "That invite is invalid or expired.");
    });
    // eslint-disable-next-line
  }, []);

  async function open(project: ApiProject) {
    setBusy(true);
    setError(null);
    try {
      onPick({ user, project, doc: await api.getDoc(project.id) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that project.");
      setBusy(false);
    }
  }

  async function createWorkspace() {
    if (!newWs.trim()) return;
    setBusy(true);
    try { await api.createWorkspace(newWs.trim()); setNewWs(""); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : "Create failed."); }
    finally { setBusy(false); }
  }

  async function acceptInvite() {
    if (!invCode.trim()) return;
    setBusy(true);
    setError(null);
    try { await api.acceptInvite(invCode.trim()); setInvCode(""); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : "That invite code is invalid or expired."); }
    finally { setBusy(false); }
  }

  return (
    <div className="gridbg" style={{ minHeight: "100%", padding: "28px 20px", backgroundSize: "40px 40px", overflowY: "auto" }}>
      <div style={{ width: 560, maxWidth: "100%", margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <Wordmark size={22} />
          <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--color-text-2)" }}>
            {user.username}
          </span>
          <button className="btn btn-secondary" style={{ padding: "5px 10px", fontSize: 12 }} onClick={onSignOut}>Sign out</button>
        </div>

        <h3 style={{ fontSize: 20, margin: "0 0 4px" }}>Your projects</h3>
        <p style={{ fontSize: 12.5, color: "var(--color-text-2)", margin: "0 0 16px" }}>
          Pick a project to open, or start a new workspace for a separate team.
        </p>

        {error && <p style={{ fontSize: 12.5, color: "var(--prio-hi-text)" }}>{error}</p>}
        {!workspaces && <p style={{ fontSize: 13, color: "var(--color-text-2)" }}>Loading…</p>}

        {workspaces?.map((w) => (
          <BP key={w.id} style={{ background: "var(--color-bg)", padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{w.name}</span>
              {w.role === "admin" && <span className="tag tag-accent" style={{ padding: "1px 6px" }}>Admin</span>}
            </div>

            {(projects[w.id] ?? []).map((p) => (
              <div key={p.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--color-divider)" }}>
                  <button className="btn btn-ghost" style={{ padding: 0, fontSize: 14, fontWeight: 500 }} disabled={busy} onClick={() => void open(p)}>
                    {p.name}
                  </button>
                  <span style={{ fontSize: 11, color: "var(--color-text-3)" }}>{ROLE_LABEL[p.role ?? "viewer"]}</span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    {api.canManage(p.role) && (
                      <button className="btn btn-secondary" style={{ padding: "4px 9px", fontSize: 12 }} onClick={() => setManage(manage === p.id ? null : p.id)}>
                        {manage === p.id ? "Close" : "Manage"}
                      </button>
                    )}
                    <button className="btn btn-primary" style={{ padding: "4px 11px", fontSize: 12 }} disabled={busy} onClick={() => void open(p)}>Open</button>
                  </span>
                </div>
                {manage === p.id && <ManagePanel project={p} meId={user.id} />}
              </div>
            ))}

            <NewProject workspaceId={w.id} onCreated={reload} onError={setError} />
          </BP>
        ))}

        {workspaces && (
          <BP style={{ background: "var(--color-bg)", padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>New workspace</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" style={{ flex: 1 }} placeholder="e.g. Design team" value={newWs} onChange={(e) => setNewWs(e.target.value)} />
              <button className="btn btn-primary" disabled={busy || !newWs.trim()} onClick={() => void createWorkspace()}>Create</button>
            </div>
          </BP>
        )}

        {workspaces && (
          <BP style={{ background: "var(--color-bg)", padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Have an invite code?</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" style={{ flex: 1 }} placeholder="Paste invite code" value={invCode} onChange={(e) => setInvCode(e.target.value)} />
              <button className="btn btn-secondary" disabled={busy || !invCode.trim()} onClick={() => void acceptInvite()}>Join</button>
            </div>
          </BP>
        )}

        <p style={{ textAlign: "center", marginTop: 8 }}>
          <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--color-text-2)" }} onClick={onExitTeam}>
            Leave team mode — use the local vault on this device
          </button>
        </p>
      </div>
    </div>
  );
}

/* Create a project in a workspace, optionally seeding it from this device's
   local vault (only offered for a passwordless vault, so no passphrase prompt
   is ever needed — the write goes up as rev 0 → 1). */
function NewProject({ workspaceId, onCreated, onError }: { workspaceId: string; onCreated: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState("");
  const [seed, setSeed] = useState(false);
  const [busy, setBusy] = useState(false);
  const canImport = hasVault() && unlockMode() === "none";

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const p = await api.createProject(workspaceId, name.trim());
      if (seed && canImport) {
        const handle = await openVault(NO_PASSPHRASE);
        await api.putDoc(p.id, 0, handle.state);
      }
      setName("");
      setSeed(false);
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not create the project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 10, marginTop: 4 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" style={{ flex: 1 }} placeholder="New project name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-secondary" disabled={busy || !name.trim()} onClick={() => void create()}>Add project</button>
      </div>
      {canImport && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--color-text-2)", marginTop: 7 }}>
          <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
          Start from this device&rsquo;s local data
        </label>
      )}
    </div>
  );
}

/* Member list + role changes + invite, shown to owners/co_admins. */
function ManagePanel({ project, meId }: { project: ApiProject; meId: string }) {
  const [members, setMembers] = useState<ApiMember[]>();
  const [inviteRole, setInviteRole] = useState<ProjectRole>("editor");
  const [invite, setInvite] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Owner is not reassignable through this panel, so it never appears as a choice.
  const assignable: ProjectRole[] = ["viewer", "editor", "co_admin"];

  async function reload() {
    try { setMembers(await api.members(project.id)); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load members."); }
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [project.id]);

  async function setRole(userId: string, role: ProjectRole) {
    try { await api.setMemberRole(project.id, userId, role); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : "Update failed."); }
  }
  async function remove(userId: string) {
    try { await api.removeMember(project.id, userId); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : "Remove failed."); }
  }
  async function makeInvite() {
    setError(null);
    try {
      const { token } = await api.invite(project.id, inviteRole);
      setInvite(token);
    } catch (err) { setError(err instanceof Error ? err.message : "Invite failed."); }
  }

  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-divider)", padding: 12, marginBottom: 8, fontSize: 12.5 }}>
      {error && <p style={{ color: "var(--prio-hi-text)", margin: "0 0 8px" }}>{error}</p>}
      {members?.map((m) => (
        <div key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
          <span style={{ flex: 1 }}>{m.username}{m.user_id === meId ? " (you)" : ""}</span>
          {m.role === "owner" ? (
            <span style={{ fontSize: 11, color: "var(--color-text-3)" }}>Owner</span>
          ) : (
            <>
              <select className="input" style={{ padding: "2px 6px", width: "auto" }} value={m.role} onChange={(e) => void setRole(m.user_id, e.target.value as ProjectRole)}>
                {assignable.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              {m.user_id !== meId && (
                <button className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 11, color: "var(--prio-hi-text)" }} onClick={() => void remove(m.user_id)}>Remove</button>
              )}
            </>
          )}
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--color-divider)" }}>
        <span style={{ color: "var(--color-text-2)" }}>Invite as</span>
        <select className="input" style={{ padding: "2px 6px", width: "auto" }} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as ProjectRole)}>
          {assignable.filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => void makeInvite()}>Create invite link</button>
      </div>
      {invite && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "var(--color-text-2)", marginBottom: 3 }}>
            Share this link (valid 7 days) — it works even if they don&rsquo;t have an account yet:
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              className="input"
              style={{ fontSize: 11.5, flex: 1, minWidth: 0 }}
              readOnly
              value={`${window.location.origin}${window.location.pathname}?invite=${invite}`}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              className="btn btn-secondary"
              style={{ padding: "4px 10px", fontSize: 12, flex: "none" }}
              onClick={() => {
                const link = `${window.location.origin}${window.location.pathname}?invite=${invite}`;
                void navigator.clipboard?.writeText(link).catch(() => undefined);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
