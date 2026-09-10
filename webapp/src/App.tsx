import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { hasVault, NO_PASSPHRASE, openVault, StoreProvider, TeamStoreProvider, unlockMode, useStore, type VaultHandle } from "./lib/store";
import { appMode, PENDING_INVITE_KEY, setAppMode, type AppMode } from "./lib/appMode";
import { api, type ApiUser } from "./lib/api";
import { Unlock } from "./screens/Unlock";
import { Login } from "./screens/auth/Login";
import { ProjectSwitcher, type TeamSession } from "./screens/ProjectSwitcher";
import { AppShell } from "./shell/AppShell";
import { TaskEditor } from "./screens/todo/TaskEditor";
import { ScheduleAlerts } from "./screens/ScheduleAlerts";
import { StatusNudge } from "./screens/StatusNudge";
import { DayStartPrompt } from "./screens/DayStartPrompt";
import { GoogleSyncProvider } from "./lib/googleSync";
import { syncStatusBar } from "./lib/native/chrome";

/* Invite links look like  https://host/?invite=<token>#/  — capture the token
   before anything renders, stash it, and boot straight into team mode so the
   Login/ProjectSwitcher flow can consume it (signup accepts it server-side;
   an existing signed-in account accepts it on the projects screen). */
function captureInviteLink(): boolean {
  const token = new URLSearchParams(window.location.search).get("invite");
  if (!token) return false;
  localStorage.setItem(PENDING_INVITE_KEY, token);
  // Strip the query so refreshes/bookmarks don't re-trigger; keep the hash route.
  window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  return true;
}

/* Top-level gate: boot into the local vault or a signed-in team server. The
   choice persists in localStorage; each mode can hand off to the other. */
export function App() {
  const [mode, setMode] = useState<AppMode>(() => {
    if (captureInviteLink()) { setAppMode("team"); return "team"; }
    return appMode();
  });
  const go = (m: AppMode) => { setAppMode(m); setMode(m); };
  return mode === "team"
    ? <TeamGate onExitTeam={() => go("local")} />
    : <LocalApp onUseTeam={() => go("team")} />;
}

/* The original single-user experience: encrypted local vault, optional WebDAV. */
function LocalApp({ onUseTeam }: { onUseTeam: () => void }) {
  const [vault, setVault] = useState<VaultHandle | null>(null);
  // A passwordless vault opens automatically — no Unlock prompt.
  const [autoUnlocking, setAutoUnlocking] = useState(() => hasVault() && unlockMode() === "none");
  useEffect(() => {
    if (!autoUnlocking) return;
    openVault(NO_PASSPHRASE).then(setVault).catch(() => undefined).finally(() => setAutoUnlocking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!vault) return autoUnlocking ? <div className="gridbg" style={{ minHeight: "100%" }} /> : <Unlock onUnlocked={setVault} onUseTeam={onUseTeam} />;
  return (
    <StoreProvider vault={vault} onLock={() => setVault(null)}>
      <Themed>
        <GoogleSyncProvider>
          <EditorProvider>
            <AppShell />
          </EditorProvider>
        </GoogleSyncProvider>
      </Themed>
    </StoreProvider>
  );
}

/* Team mode: check the session, sign in if needed, pick a project, then run the
   same app shell over an authenticated per-project document. */
function TeamGate({ onExitTeam }: { onExitTeam: () => void }) {
  const [user, setUser] = useState<ApiUser | null | undefined>(undefined);
  const [session, setSession] = useState<TeamSession | null>(null);
  // `?? null`: if the API base is misrouted (e.g. dev server answering /api
  // with index.html), req() can resolve undefined — which would strand this
  // gate on its loading placeholder forever. Treat it as signed-out instead.
  useEffect(() => { api.me().then((u) => setUser(u ?? null)).catch(() => setUser(null)); }, []);
  const signOut = () => { void api.logout().catch(() => undefined).finally(() => { setSession(null); setUser(null); }); };

  if (user === undefined) return <div className="gridbg" style={{ minHeight: "100%" }} />;
  if (!user) return <Login onAuthed={setUser} onBack={onExitTeam} />;
  if (!session) return <ProjectSwitcher user={user} onPick={setSession} onSignOut={signOut} onExitTeam={onExitTeam} />;
  return (
    <TeamStoreProvider session={session} onSignOut={signOut} onSwitchProject={() => setSession(null)}>
      <Themed>
        <GoogleSyncProvider>
          <EditorProvider>
            <AppShell />
          </EditorProvider>
        </GoogleSyncProvider>
      </Themed>
    </TeamStoreProvider>
  );
}

/* Resolve the theme choice onto <html data-theme> so tokens flip globally. */
function Themed({ children }: { children: ReactNode }) {
  const { state } = useStore();
  const { theme, accent, reduceMotion } = state.settings;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      // Thermal and E-ink are explicit choices only — "system" resolves
      // dark/light, and neither paper theme has an OS analogue to resolve to.
      document.documentElement.dataset.theme =
        theme === "thermal" || theme === "eink"
          ? theme
          : theme === "dark" || (theme === "system" && mq.matches)
            ? "dark"
            : "light";
      syncStatusBar();
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.accent = accent ?? "violet";
    syncStatusBar();
  }, [accent]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(reduceMotion);
  }, [reduceMotion]);

  return <>{children}</>;
}

/* Task editor is reachable from every surface (board, list, schedule,
   calendar, dashboard, FAB), so it lives at the app root. */
interface EditorCtx {
  /** Open the editor: a task id to edit, or null for a new task. */
  openTask: (id: string | null, presets?: { scheduledAt?: number; parentId?: string }) => void;
}

const Editor = createContext<EditorCtx | null>(null);

export function useEditor(): EditorCtx {
  const ctx = useContext(Editor);
  if (!ctx) throw new Error("useEditor outside EditorProvider");
  return ctx;
}

function EditorProvider({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState<{ id: string | null; presets?: { scheduledAt?: number; parentId?: string } } | null>(null);
  return (
    <Editor.Provider value={{ openTask: (id, presets) => setEditing({ id, presets }) }}>
      {children}
      <DayStartPrompt />
      <ScheduleAlerts />
      <StatusNudge />
      {editing && <TaskEditor taskId={editing.id} presets={editing.presets} onClose={() => setEditing(null)} />}
    </Editor.Provider>
  );
}
