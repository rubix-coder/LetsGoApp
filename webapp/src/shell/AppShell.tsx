import { useEffect, useRef, useState, type ReactNode } from "react";
import { childTasks, elapsedSec, rootTasks, useStore } from "../lib/store";
import { childIndex, treeUnscheduled } from "../lib/taskTree";
import { nav, useMobile, useRoute } from "../lib/router";
import { cancelNotifyAt, notify, notifyAt } from "../lib/notify";
import { isNative } from "../lib/native/platform";
import { useUpdateAvailable } from "../lib/updateCheck";
import { useShellUpdate } from "../lib/shellUpdate";
import { alertChime, playChime } from "../lib/sound";
import { type PluginId, type Task } from "../lib/types";
import { orderedPlugins } from "../lib/plugins";
import { BP, Wordmark } from "../components/ui";
import { useGoogleSync } from "../lib/googleSync";
import {
  IBack, IBook, IChevronR, IDashboard, IGear, IGrab, IHabit, IMindmap, INotes, ISun, ITimer, ITodo,
} from "../components/Icons";
import { TodoScreen } from "../screens/todo/TodoScreen";
import { TimerScreen } from "../screens/TimerScreen";
import { FocusMode } from "../screens/FocusMode";
import { NotesScreen } from "../screens/NotesScreen";
import { MindmapScreen } from "../screens/MindmapScreen";
import { DashboardScreen } from "../screens/DashboardScreen";
import { LibraryScreen } from "../screens/LibraryScreen";
import { HabitsScreen } from "../screens/HabitsScreen";
import { SettingsScreen } from "../screens/SettingsScreen";

/** "web 0.38.0" in a browser, "android 0.38.0" in the native shell. */
export const SHELL_VERSION_LABEL = `${isNative ? "android" : "web"} ${__APP_VERSION__}`;

const PLUGIN_ICON: Record<PluginId, (p: { size?: number }) => JSX.Element> = {
  todo: ITodo, timer: ITimer, notes: INotes, mindmap: IMindmap, dashboard: IDashboard, library: IBook, habits: IHabit,
};

// Every tab is flex:1 at 9.5px, so a seventh tab squeezes all of them —
// "Books" over "Library" for that reason alone.
const TAB_LABEL: Record<PluginId, string> = {
  todo: "Todo", timer: "Timer", notes: "Notes", mindmap: "Mindmap", dashboard: "Dash", library: "Books", habits: "Habits",
};

/* Fires the OS banner when a running pomodoro/countdown crosses zero —
   including catch-up right after the tab is reopened or refocused. */
function useTimerNotifier() {
  const { state } = useStore();
  const notified = useRef<string | null>(null);
  const { timer, settings } = state;

  useEffect(() => {
    if ((!settings.notifications && !settings.sounds) || timer.mode === "stopwatch" || !timer.runningSince) return;
    const task = state.tasks.find((t) => t.id === timer.taskId);
    const title = timer.mode === "pomodoro" ? "Pomodoro finished" : "Countdown finished";
    const body = task ? `${task.title} — time's up.` : "Time's up.";
    const tag = "letsgo-timer";
    const remainMs = (timer.targetSec - elapsedSec(timer)) * 1000;
    /* One alert per RUN, not per stretch of running.

       The mark used to be `runningSince`, which changes on every resume — so a
       run that had already rung and kept going gonged again, instantly, every
       time the away-guard paused it and you came back. The run outlives its
       pauses, so the mark is the task/mode/target it belongs to, cleared only
       when the clock is genuinely back before the target (a banked or reset
       run starting over). The `remainMs <= 0` fire below stays the catch-up
       path for a target crossed while the tab was asleep. */
    const runKey = `${timer.taskId ?? ""}|${timer.mode}|${timer.targetSec}`;
    if (remainMs > 0 && notified.current === runKey) notified.current = null;
    if (notified.current === runKey) return;
    // Native: the OS delivers the banner at the target instant even while the
    // app is suspended and this effect's timers are frozen — the in-page fire()
    // then only chimes. Web keeps the setTimeout + visibility catch-up path.
    const osScheduled = isNative && settings.notifications && remainMs > 0;
    if (osScheduled) void notifyAt(Date.now() + remainMs, title, body, tag);
    const fire = () => {
      notified.current = runKey;
      if (settings.notifications && !osScheduled) void notify(title, body);
      if (settings.sounds) playChime(alertChime(settings.alertSound));
    };
    if (remainMs <= 0) { fire(); return; }
    const h = setTimeout(fire, remainMs);
    const onVisible = () => {
      if (document.visibilityState === "visible" && elapsedSec(timer) >= timer.targetSec && notified.current !== runKey) fire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(h);
      document.removeEventListener("visibilitychange", onVisible);
      // Stopped/rescheduled before it rang — pull the pending OS banner too.
      if (osScheduled && notified.current !== runKey) void cancelNotifyAt(tag);
    };
  }, [timer, settings.notifications, settings.sounds, state.tasks]);
}

/* Same banner for quick timers: one setTimeout per running countdown, keyed on
   id+endsAt so a pause/resume re-arms cleanly and nothing rings twice. */
function useQuickTimerNotifier() {
  const { state } = useStore();
  const notified = useRef(new Set<string>());
  const { quickTimers, settings } = state;

  useEffect(() => {
    if (!settings.notifications && !settings.sounds) return;
    const handles: ReturnType<typeof setTimeout>[] = [];
    const scheduled: { tag: string; key: string }[] = [];
    for (const t of quickTimers) {
      if (t.endsAt === undefined) continue;
      const key = `${t.id}:${t.endsAt}`;
      if (notified.current.has(key)) continue;
      const tag = `letsgo-qt-${t.id}`;
      const remainMs = t.endsAt - Date.now();
      // Same split as the pomodoro notifier: native hands the banner to the OS
      // so a suspended app still rings; the setTimeout survives for the chime.
      const osScheduled = isNative && settings.notifications && remainMs > 0;
      if (osScheduled) {
        void notifyAt(t.endsAt, "Timer finished", `${t.label} — time's up.`, tag);
        scheduled.push({ tag, key });
      }
      const fire = () => {
        notified.current.add(key);
        if (settings.notifications && !osScheduled) void notify("Timer finished", `${t.label} — time's up.`, tag);
        if (settings.sounds) playChime(alertChime(settings.alertSound));
      };
      if (remainMs <= 0) fire();
      else handles.push(setTimeout(fire, remainMs));
    }
    return () => {
      handles.forEach(clearTimeout);
      // Paused/removed/re-armed before ringing — cancel the OS banner as well.
      for (const s of scheduled) if (!notified.current.has(s.key)) void cancelNotifyAt(s.tag);
    };
  }, [quickTimers, settings.notifications, settings.sounds]);
}

/* A short chime the moment any task first reaches "done" — via status change,
   board drag, the editor, or a bulk import (which rings once, not once per
   task). The done-set present at mount is remembered silently, so unlocking a
   vault that already holds finished tasks stays quiet. */
function useCompletionChime() {
  const { state } = useStore();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const done = new Set(state.tasks.filter((t) => t.status === "done").map((t) => t.id));
    const first = seen.current;
    seen.current = done;
    if (first === null) return;
    let grew = false;
    for (const id of done) if (!first.has(id)) { grew = true; break; }
    if (grew && state.settings.sounds) playChime("complete");
  }, [state.tasks, state.settings.sounds]);
}

/* Auto-pause the focus timer when it has run untouched past the away window, so
   stepping away without hitting pause doesn't bank hours that were never
   worked. The reducer freezes worked time at the last interaction instant and
   logs the idle span as a break; here we just watch for it. */
function useAwayGuard() {
  const { state, dispatch, readOnly } = useStore();
  const { timer, settings } = state;
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    const bump = () => { lastActivity.current = Date.now(); };
    const onVisible = () => { if (document.visibilityState === "visible") bump(); };
    window.addEventListener("pointerdown", bump, { passive: true });
    window.addEventListener("keydown", bump);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const awayMin = settings.autoPauseMin ?? 10;
  useEffect(() => {
    if (readOnly || awayMin <= 0 || !timer.runningSince) return;
    const check = () => {
      const idleMs = Date.now() - lastActivity.current;
      if (idleMs < awayMin * 60_000) return;
      dispatch({ type: "timerAutoPause", since: lastActivity.current });
      if (settings.sounds) playChime(alertChime(settings.alertSound));
      if (settings.notifications) void notify("Timer auto-paused", "You stepped away — the break is logged, resume when you're back.");
    };
    const h = setInterval(check, 20_000);
    return () => clearInterval(h);
  }, [readOnly, awayMin, timer.runningSince, settings.sounds, settings.notifications, dispatch]);
}

const PROJECT_ROLE_LABEL: Record<string, string> = {
  owner: "Owner", co_admin: "Co-admin", editor: "Editor", viewer: "Viewer",
};

/** Slim banner shown in team mode: which project you are in, your role, whether
    it is read-only, and a quick way back to the project switcher. */
function TeamBar() {
  const { team, readOnly, switchProject } = useStore();
  if (!team) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 14px", fontSize: 12, background: "var(--color-surface)", borderBottom: "1px solid var(--color-divider)", flex: "none" }}>
      <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team.projectName}</span>
      <span className="tag tag-neutral" style={{ padding: "1px 6px" }}>{PROJECT_ROLE_LABEL[team.role] ?? team.role}</span>
      {readOnly && <span className="tag" style={{ padding: "1px 6px", background: "var(--color-divider)", color: "var(--color-text-2)" }}>Read only</span>}
      <button className="btn btn-ghost" style={{ marginLeft: "auto", fontSize: 12, padding: "2px 8px" }} onClick={switchProject}>Switch project</button>
    </div>
  );
}

/** Shown when a newer version is waiting. Two sources, one bar:

    - The desktop shell (Flatpak) asks the update portal — an update there is
      installed and the app relaunched, because Flatpak deploys UNDER a
      running app and the running process keeps the old code until it exits.
      This one gets a Postpone, since a restart interrupts real work.
    - The browser/PWA compares the deployed entry hash with the running one
      and offers a reload; there is nothing to install, so no Postpone.

    The shell answer wins when both are present — reloading the webview would
    just reload the same bundled files. */
function UpdateBar() {
  const shell = useShellUpdate();
  const stale = useUpdateAvailable();

  if (shell.show) {
    const label = shell.restartOnly
      ? "An update is installed and waiting — restart LetsGo to use it."
      : "A newer version of LetsGo is ready to install.";
    return (
      <div role="status" style={BAR} >
        <span style={{ fontWeight: 600 }}>{shell.applying ? "Installing the update…" : label}</span>
        {shell.error && <span style={{ opacity: 0.85 }}>{shell.error}</span>}
        <button
          className="btn btn-ghost"
          style={{ ...BAR_BTN, marginLeft: "auto", fontWeight: 600 }}
          disabled={shell.applying}
          onClick={shell.apply}
        >
          {shell.restartOnly ? "Restart now" : "Restart & update"}
        </button>
        <button className="btn btn-ghost" style={BAR_BTN} disabled={shell.applying} onClick={shell.postpone}>
          Postpone
        </button>
      </div>
    );
  }

  if (!stale) return null;
  return (
    <div role="status" style={BAR}>
      <span style={{ fontWeight: 600 }}>A newer version of LetsGo is available.</span>
      <button className="btn btn-ghost" style={{ ...BAR_BTN, marginLeft: "auto" }} onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}

const BAR: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "5px 14px", fontSize: 12,
  background: "var(--accent-soft)", color: "var(--accent-strong)",
  borderBottom: "1px solid var(--color-divider)", flex: "none", flexWrap: "wrap",
};

const BAR_BTN: React.CSSProperties = { fontSize: 12, padding: "2px 8px", color: "var(--accent-strong)" };

/** Explains something the app rescheduled on your behalf — chiefly a late task
    pulled to the present, and whether a locked task pushed it further. Clears
    itself after a while so it never becomes permanent chrome. */
function NoticeBar() {
  const { state, dispatch } = useStore();
  const notice = state.notice;

  useEffect(() => {
    if (!notice) return;
    const h = setTimeout(() => dispatch({ type: "dismissNotice" }), 14_000);
    return () => clearTimeout(h);
  }, [notice?.id]);

  if (!notice) return null;
  const warn = notice.kind === "warn";
  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "flex-start", gap: 10, flex: "none",
        padding: "8px 14px", fontSize: 12.5, lineHeight: 1.45,
        background: warn ? "var(--prio-hi-bg, var(--color-surface))" : "var(--color-surface)",
        color: warn ? "var(--prio-hi-text, var(--color-text-1))" : "var(--color-text-1)",
        borderBottom: `1px solid ${warn ? "var(--prio-hi-border, var(--color-divider))" : "var(--color-divider)"}`,
      }}
    >
      <span aria-hidden style={{ flex: "none", marginTop: 1 }}>{warn ? "\u{1F512}" : "\u{1F551}"}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{notice.text}</span>
      <button
        className="btn btn-ghost"
        style={{ flex: "none", padding: "0 6px", fontSize: 15, lineHeight: 1.2, color: "inherit" }}
        aria-label="Dismiss"
        onClick={() => dispatch({ type: "dismissNotice" })}
      >
        &times;
      </button>
    </div>
  );
}

export function AppShell() {
  const { state } = useStore();
  const route = useRoute();
  const mobile = useMobile();
  useTimerNotifier();
  useQuickTimerNotifier();
  useCompletionChime();
  useAwayGuard();

  // A short chime once the shell mounts — i.e. right after a successful
  // unlock / sign-in. The unlock click is the user gesture that lets the
  // AudioContext start; a passwordless auto-unlock has no gesture, so that
  // first chime may be silently dropped by the browser (by design).
  useEffect(() => {
    if (state.settings.sounds) playChime("login");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enabled = orderedPlugins(state.settings.pluginOrder).filter((p) => state.settings.plugins[p.id]);
  const view = route[0] ?? "";
  const known = [...enabled.map((p) => p.id as string), "settings", "focus"];
  const landingView = state.settings.landingView || "";

  useEffect(() => {
    if (known.includes(view)) return;
    // A bare URL (empty hash) honors the user's chosen landing view — but only
    // if that plugin is still enabled; an unknown/typo route just falls back to
    // the first enabled plugin.
    const landingRoot = landingView.split("/")[0];
    const target = view === "" && enabled.some((p) => p.id === landingRoot) ? landingView : (enabled[0]?.id ?? "settings");
    nav(`/${target}`);
  }, [view, known.join(","), enabled.length, landingView]);

  if (view === "focus") return <FocusMode />;

  const screen =
    view === "todo" ? <TodoScreen /> :
    view === "timer" ? <TimerScreen /> :
    view === "notes" ? <NotesScreen /> :
    view === "mindmap" ? <MindmapScreen /> :
    view === "dashboard" ? <DashboardScreen /> :
    view === "library" ? <LibraryScreen /> :
    view === "habits" ? <HabitsScreen /> :
    view === "settings" ? <SettingsScreen /> : null;

  if (mobile) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <UpdateBar />
        <TeamBar />
        <NoticeBar />
        {/* overflow:hidden — without the clip, screens whose inner scroller
            mis-sizes bleed content underneath the tab bar. */}
        <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>{screen}</main>
        <nav className="tabbar" aria-label="Main">
          {enabled.map((p) => {
            const Icon = PLUGIN_ICON[p.id];
            return (
              <button key={p.id} className={view === p.id ? "active" : ""} onClick={() => nav(`/${p.id}`)}>
                <Icon size={21} />
                <span>{TAB_LABEL[p.id]}</span>
              </button>
            );
          })}
          <button className={view === "settings" ? "active" : ""} onClick={() => nav("/settings")} aria-label="Settings">
            <IGear size={21} />
            <span>Settings</span>
          </button>
        </nav>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <UpdateBar />
      <TeamBar />
      <NoticeBar />
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Sidebar view={view} />
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>{screen}</main>
      </div>
    </div>
  );
}

/** The wordmark, doubling as the app's sync control. Its badge carries the
    combined Google + NAS sync health (green syncing / amber needs-reconnect /
    red error) so it reads without opening Settings, and clicking it does the
    right next thing: reconnect Google when it needs consent, open Settings when
    Google isn't configured, otherwise sync everything now. */
function SyncLogo({ collapsed }: { collapsed?: boolean }) {
  const { state, sync, syncNow: syncVault } = useStore();
  const { status: g, syncNow: syncGoogle, reconnect } = useGoogleSync();
  const google = state.settings.google;
  const configured = !!google?.clientId && (google?.accounts.length ?? 0) > 0;
  const googleActive = configured && !!google?.accounts.some((a) => a.enabled);

  const tone: "default" | "syncing" | "attention" | "error" =
    sync.state === "error" || g.state === "error" ? "error"
      : sync.state === "syncing" || g.state === "syncing" ? "syncing"
        : g.state === "reconnect" ? "attention"
          : "default";

  const googleLine = !googleActive ? null
    : g.state === "reconnect" ? `Google: reconnect ${g.needsConsent?.join(", ") ?? ""}`.trim()
      : g.state === "error" ? `Google: ${g.detail ?? "sync error"}`
        : g.state === "syncing" ? "Google: syncing…"
          : g.state === "ok" ? "Google: up to date"
            : "Google: idle";
  const vaultLine =
    sync.state === "error" ? `Vault: ${sync.detail ?? "sync error"}`
      : sync.state === "syncing" ? "Vault: syncing…"
        : sync.state === "ok" ? "Vault: up to date"
          : "Vault: local only";
  const title = `${[googleLine, vaultLine].filter(Boolean).join(" · ")} — click to sync`;

  const onClick = () => {
    if (!configured) { nav("/settings/google"); return; }
    if (g.state === "reconnect" || (g.state === "error" && googleActive)) reconnect();
    else if (googleActive) syncGoogle();
    syncVault();
  };

  if (collapsed) {
    const ink = tone === "error" ? "var(--sync-bad)"
      : tone === "attention" ? "var(--sync-warn)"
        : tone === "syncing" ? "var(--sync-busy)"
          : "var(--color-accent)";
    return (
      <button
        className="wm-btn"
        title={title}
        aria-label={title}
        onClick={onClick}
        style={{ fontSize: 15, color: ink, marginBottom: 8, fontFamily: "var(--font-heading)", lineHeight: 1 }}
      >
        &#9656;&#9656;
      </button>
    );
  }
  return <Wordmark size={20} tone={tone} onClick={onClick} title={title} />;
}

function Sidebar({ view }: { view: string }) {
  const { state, dispatch } = useStore();
  const route = useRoute();
  const collapsed = state.settings.sidebarCollapsed;
  const enabled = orderedPlugins(state.settings.pluginOrder).filter((p) => state.settings.plugins[p.id]);
  const showTray = view === "todo" && route[1] === "schedule" && !collapsed;
  const dark = document.documentElement.dataset.theme === "dark";

  // The "Unscheduled · drag to grid" backlog: every pending, non-routine tree
  // that has nothing on the timeline yet. A parent row drags as the whole
  // subtree (Schedule's drop → packSubtree); expand it to drag one leaf at a
  // time. Roots start collapsed so a long backlog stays a short list.
  const [openTrees, setOpenTrees] = useState<Set<string>>(new Set());
  const trayIdx = childIndex(state.tasks);
  const trayById = new Map(state.tasks.map((t) => [t.id, t]));
  const leavesUnder = (id: string): Task[] =>
    childTasks(state, id).flatMap((c) => (trayIdx.has(c.id) ? leavesUnder(c.id) : [c]));
  interface TrayRow { task: Task; child: boolean; subCount: number }
  const trayRows: TrayRow[] = [];
  for (const root of rootTasks(state)) {
    if (root.status !== "pending" || root.repeat || !treeUnscheduled(trayIdx, trayById, root.id)) continue;
    const leaves = trayIdx.has(root.id) ? leavesUnder(root.id) : [];
    trayRows.push({ task: root, child: false, subCount: leaves.length });
    if (openTrees.has(root.id)) for (const leaf of leaves) trayRows.push({ task: leaf, child: true, subCount: 0 });
  }

  const toggleTheme = () => dispatch({ type: "setSettings", patch: { theme: dark ? "light" : "dark" } });
  const setCollapsed = (v: boolean) => dispatch({ type: "setSettings", patch: { sidebarCollapsed: v } });

  if (collapsed) {
    return (
      <nav
        aria-label="Main"
        style={{ width: 56, flex: "none", borderRight: "1px solid var(--color-divider)", display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 0", gap: 6 }}
      >
        <SyncLogo collapsed />

        {enabled.map((p) => {
          const Icon = PLUGIN_ICON[p.id];
          return (
            <button key={p.id} className={`railbtn ${view === p.id ? "active" : ""}`} title={p.name} onClick={() => nav(`/${p.id}`)}>
              <Icon size={19} />
            </button>
          );
        })}
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
          <button className={`railbtn ${view === "settings" ? "active" : ""}`} title="Settings" onClick={() => nav("/settings/plugins")}>
            <IGear size={18} />
          </button>
          <button className="railbtn" title="Expand sidebar" onClick={() => setCollapsed(false)}>
            <IChevronR size={16} />
          </button>
        </div>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Main"
      style={{ width: 212, flex: "none", borderRight: "1px solid var(--color-divider)", display: "flex", flexDirection: "column", padding: "16px 0" }}
    >
      <div style={{ padding: "0 18px 16px", display: "flex", flexDirection: "column", gap: 1 }}>
        <SyncLogo />
        <span style={{ fontSize: 10, color: "var(--color-text-3)" }}>{SHELL_VERSION_LABEL}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {enabled.map((p) => {
          const Icon = PLUGIN_ICON[p.id];
          return (
            <button key={p.id} className={`navrow ${view === p.id ? "active" : ""}`} onClick={() => nav(`/${p.id}`)}>
              <Icon size={19} />
              {p.name}
            </button>
          );
        })}
      </div>

      {showTray && trayRows.length > 0 && (
        <div style={{ marginTop: "auto", padding: "14px 18px 0", borderTop: "1px solid var(--color-divider)", minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div className="cap" style={{ marginBottom: 8, flex: "none" }}>Unscheduled · drag to grid</div>
          <div style={{ overflowY: "auto", maxHeight: "40vh", paddingRight: 2 }}>
            {trayRows.map(({ task: t, child, subCount }) => (
              <div
                key={t.id}
                style={{
                  display: "flex", alignItems: "center", gap: 6, marginBottom: 6,
                  marginLeft: child ? 14 : 0,
                }}
              >
                {subCount > 0 ? (
                  <button
                    onClick={() => setOpenTrees((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })}
                    aria-label={openTrees.has(t.id) ? `Collapse ${t.title}` : `Expand ${t.title}`}
                    aria-expanded={openTrees.has(t.id)}
                    style={{ flex: "none", border: "none", background: "none", cursor: "pointer", padding: 0, display: "flex", color: "var(--color-text-3)", transform: openTrees.has(t.id) ? "rotate(90deg)" : undefined }}
                  >
                    <IChevronR size={12} strokeWidth={2} />
                  </button>
                ) : child ? (
                  <span style={{ flex: "none", color: "var(--color-text-3)", fontSize: 11 }}>└</span>
                ) : (
                  <span style={{ flex: "none", color: "var(--color-text-3)" }}><IGrab size={13} /></span>
                )}
                <BP
                  style={{ flex: 1, minWidth: 0, background: "var(--color-card)", padding: "7px 9px", display: "flex", alignItems: "center", gap: 7, cursor: "grab" }}
                  draggable
                  onDragStart={(e: React.DragEvent) => e.dataTransfer.setData("text/task-id", t.id)}
                  title={subCount > 0 ? `${t.title} — drag to schedule all ${subCount} subtask${subCount === 1 ? "" : "s"}` : t.title}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                  {subCount > 0 && <span style={{ flex: "none", fontSize: 10, color: "var(--color-text-3)", fontFamily: "var(--font-mono)" }}>· {subCount}</span>}
                </BP>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: showTray && trayRows.length > 0 ? 12 : "auto", padding: "12px 18px 0", borderTop: "1px solid var(--color-divider)", display: "flex", alignItems: "center", justifyContent: "space-between", flex: "none" }}>
        <button className={`navrow ${view === "settings" ? "active" : ""}`} style={{ padding: 0, borderLeft: "none", width: "auto", fontSize: 13, gap: 9 }} onClick={() => nav("/settings/plugins")}>
          <IGear size={18} />
          Settings
        </button>
        <span style={{ display: "flex", gap: 4 }}>
          <button className="btn btn-icon btn-secondary" style={{ width: 30, height: 30 }} title={dark ? "Switch to light" : "Switch to dark"} onClick={toggleTheme}>
            <ISun size={17} />
          </button>
          <button className="btn btn-icon btn-secondary" style={{ width: 30, height: 30 }} title="Collapse sidebar" onClick={() => setCollapsed(true)}>
            <IBack size={15} />
          </button>
        </span>
      </div>
    </nav>
  );
}

/** Mobile screen header: small wordmark over the screen title, actions right. */
export function MobileHeader({ title, right }: { title: ReactNode; right?: ReactNode }) {
  // The screen name under the logo was redundant with the active tab-bar
  // label; the slot shows the app version instead — small, quiet, and sized
  // to the old title line so the header height (and everything below it)
  // doesn't shift.
  return (
    <div
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px 10px", gap: 10 }}
      aria-label={typeof title === "string" ? title : undefined}
    >
      <div style={{ minWidth: 0 }}>
        <div className="wm" style={{ fontSize: 15, lineHeight: 1 }}>
          LET&rsquo;S GO<span className="cv">&#9656;&#9656;</span>
        </div>
        <div style={{ height: 26, margin: "2px 0 0", display: "flex", alignItems: "center", font: "500 11px var(--font-mono)", color: "var(--color-text-3)" }}>
          {SHELL_VERSION_LABEL}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>{right}</div>
    </div>
  );
}
