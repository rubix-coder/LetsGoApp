import { useEffect, useRef, useState } from "react";
import { DEFAULT_BREAK_MINUTES, destroyVault, NO_PASSPHRASE, openVault, rootTasks, unlockMode, useStore } from "../lib/store";
import { appMode, setAppMode } from "../lib/appMode";
import { hydrateState } from "../lib/migrate";
import { nav, useMobile, useRoute } from "../lib/router";
import { ensurePermission } from "../lib/notify";
import { saveTextFile } from "../lib/download";
import { type AccentChoice, type AppState, type BoardSort, type ClockFace, type GoogleAccount, type NoteTemplate, type PluginId, type ThemeChoice } from "../lib/types";
import { emptyGoogleSettings, useGoogleSync } from "../lib/googleSync";
import { accessTokenFor, revokeGoogleAccount, signInToGoogle } from "../lib/gcalAuth";
import { listCalendars, type GoogleCalendarSummary } from "../lib/gcalApi";
import { ReminderPicker } from "../components/ReminderPicker";
import { RANGE_OPTIONS, taskWindowOf, windowLabel } from "../lib/taskWindow";
import { fmtDateTime } from "../lib/dates";
import { availableTemplates, NOTE_TEMPLATES, starterCustomTemplate } from "../lib/noteTemplates";
import { orderedPlugins } from "../lib/plugins";
import { TODO_VIEWS } from "../lib/todoView";
import { claudeKey, googleBooksKey, maskKey, setClaudeKey, setGoogleBooksKey } from "../lib/apiKeys";
import { bookApiIssue, clearBookApiIssue, lastResolveReport } from "../lib/bookApiHealth";
import { beginTouchDrag, hitData } from "../lib/touchDrag";
import { ALERT_SOUNDS, alertChime, playChime } from "../lib/sound";
import { BP, Seg, Toggle } from "../components/ui";
import { SHELL_VERSION_LABEL } from "../shell/AppShell";
import { ClockDisplay, CLOCK_FACES } from "../components/ClockFace";
import { TimeField } from "../components/TimeField";
import {
  IAppearance, IBack, IBook, ICalendar, IChevronR, IClock, IDashboard, IDatabase, IGrab, IHabit, IInfo, ILock, IMindmap,
  INotes, IPlus, IPluginGrid, ITimer, ITodo,
} from "../components/Icons";

const SECTIONS = [
  { id: "plugins", name: "Plugins", icon: IPluginGrid },
  { id: "library", name: "Library", icon: IBook },
  { id: "appearance", name: "Appearance", icon: IAppearance },
  { id: "schedule", name: "Schedule", icon: IClock },
  { id: "google", name: "Google Calendar", icon: ICalendar },
  { id: "account", name: "Account & team", icon: IGrab },
  { id: "security", name: "Security", icon: ILock },
  { id: "data", name: "Data & backup", icon: IDatabase },
  { id: "about", name: "About", icon: IInfo },
] as const;

/* Two panes are local-vault only. Security is the passphrase pane, meaningless
   once you are signed in to a team server. Google Calendar is personal by
   nature: its settings would otherwise live in the SHARED project document,
   putting every connected account's address in front of the whole team and
   pointing everyone's sync at one person's calendar. */
function visibleSections() {
  const local = appMode() === "local";
  return SECTIONS.filter((s) => (s.id !== "security" && s.id !== "google") || local);
}

const PLUGIN_ICON: Record<PluginId, (p: { size?: number }) => JSX.Element> = {
  todo: ITodo, timer: ITimer, notes: INotes, mindmap: IMindmap, dashboard: IDashboard, library: IBook, habits: IHabit,
};

export function SettingsScreen() {
  const route = useRoute();
  const mobile = useMobile();
  const section = route[1] ?? (mobile ? "" : "plugins");

  const body =
    section === "plugins" ? <Plugins /> :
    section === "library" ? <Library /> :
    section === "appearance" ? <Appearance /> :
    section === "schedule" ? <Schedule /> :
    section === "google" ? <GoogleCalendar /> :
    section === "account" ? <AccountTeam /> :
    section === "security" ? <Security /> :
    section === "data" ? <DataBackup /> :
    section === "about" ? <About /> : null;

  if (mobile) {
    if (!section) {
      return (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 16px 10px" }}><h3 style={{ fontSize: 23 }}>Settings</h3></div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {visibleSections().map((s) => (
              <button key={s.id} className="navrow" style={{ padding: "13px 16px", borderBottom: "1px solid var(--color-divider-soft)" }} onClick={() => nav(`/settings/${s.id}`)}>
                <s.icon size={17} />
                <span style={{ flex: 1 }}>{s.name}</span>
                <IChevronR size={14} />
              </button>
            ))}
          </div>
        </div>
      );
    }
    const meta = SECTIONS.find((s) => s.id === section);
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--color-divider)" }}>
          <button className="btn btn-icon btn-ghost" style={{ width: 30, height: 30, color: "var(--color-text-2)" }} onClick={() => nav("/settings")} aria-label="Back to settings">
            <IBack size={17} strokeWidth={1.6} />
          </button>
          <span style={{ fontSize: 18, fontWeight: 500 }}>{meta?.name}</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{body}</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div style={{ width: 210, flex: "none", borderRight: "1px solid var(--color-divider)", padding: "18px 0", display: "flex", flexDirection: "column" }}>
        <h3 style={{ fontSize: 22, margin: "0 0 14px", padding: "0 20px" }}>Settings</h3>
        {visibleSections().map((s) => (
          <button key={s.id} className={`navrow ${section === s.id ? "active" : ""}`} style={{ padding: "9px 20px", gap: 10 }} onClick={() => nav(`/settings/${s.id}`)}>
            <s.icon size={17} />
            {s.name}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>{body}</div>
    </div>
  );
}

function Pane({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  const mobile = useMobile();
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      {!mobile && (
        <div style={{ padding: "18px 26px", borderBottom: "1px solid var(--color-divider)" }}>
          <h3 style={{ fontSize: 24 }}>{title}</h3>
          {sub && <p style={{ fontSize: 13, margin: "4px 0 0", color: "var(--color-text-2)" }}>{sub}</p>}
        </div>
      )}
      <div style={{ padding: mobile ? 16 : "22px 26px", display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>{children}</div>
    </div>
  );
}

function ToggleRow({ title, sub, on, onChange }: { title: string; sub: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderTop: "1px solid var(--color-divider)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--color-text-2)" }}>{sub}</div>
      </div>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  );
}

/* ————— Plugins ————— */

function Plugins() {
  const { state, dispatch } = useStore();
  // Which row is being dragged, and which one it would displace. The dragged
  // id is a ref because it must survive the drag without re-rendering; the
  // hovered id is state because it is drawn.
  const dragId = useRef<PluginId | null>(null);
  const [overId, setOverId] = useState<PluginId | null>(null);
  const enabledCount = Object.values(state.settings.plugins).filter(Boolean).length;
  const activeTasks = rootTasks(state).filter((t) => t.status !== "done" && t.status !== "skipped").length;
  const landing = state.settings.landingView || "todo";
  const landingRoot = landing.split("/")[0];
  const setLanding = (id: string) => dispatch({ type: "setSettings", patch: { landingView: id } });
  const todoView = state.settings.todoDefaultView || "last";

  const detail: Record<PluginId, string> = {
    todo: `Board, schedule & calendar · ${activeTasks} active tasks`,
    timer: "Pomodoro, countdown & focus mode",
    notes: `Nested markdown notebooks · ${state.notes.length} notes`,
    mindmap: "Pan / zoom board of linked nodes",
    dashboard: "Status, time tracked & what's next",
    library: `Scan, shelve & track your books · ${state.books.length} books`,
    habits: `Daily habits, streaks & consistency · ${state.habits.filter((h) => !h.archivedAt).length} habits`,
  };

  const ordered = orderedPlugins(state.settings.pluginOrder);

  return (
    <Pane title="Plugins" sub="Drag a row by its grip to reorder the tabs. Enabled plugins appear in the sidebar; the ‣ radio picks which one opens on launch. Todo also picks which of its views it opens on — every time, not just at launch. Disable to hide without losing data.">
      {ordered.map((p) => {
        const Icon = PLUGIN_ICON[p.id];
        const on = state.settings.plugins[p.id];
        const lastOne = on && enabledCount === 1;
        const isLanding = on && landingRoot === p.id;
        return (
          <BP
            key={p.id}
            data-plugin-row={p.id}
            /* The grip was decorative until now: it showed cursor:grab with no
               drag behaviour behind it. Both input paths are wired here —
               HTML5 drag for a mouse, long-press for touch, which never fires
               drag events at all. */
            draggable
            onDragStart={(e) => { dragId.current = p.id; e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => { dragId.current = null; setOverId(null); }}
            onDragOver={(e) => {
              if (dragId.current && dragId.current !== p.id) { e.preventDefault(); setOverId(p.id); }
            }}
            onDragLeave={() => setOverId((cur) => (cur === p.id ? null : cur))}
            onDrop={(e) => {
              const from = dragId.current;
              if (from && from !== p.id) {
                e.preventDefault();
                dispatch({ type: "reorderPlugin", id: from, targetId: p.id });
              }
              dragId.current = null; setOverId(null);
            }}
            onPointerDown={(e) => beginTouchDrag(e, {
              label: p.name,
              onDrop: (x, y) => {
                const hit = hitData(x, y, "data-plugin-row");
                if (hit && hit.value !== p.id) {
                  dispatch({ type: "reorderPlugin", id: p.id, targetId: hit.value as PluginId });
                }
              },
            })}
            style={{
              background: "var(--color-card)", padding: "15px 18px", display: "flex",
              alignItems: "center", gap: 16, opacity: on ? 1 : 0.6,
              // The insertion point, shown on the row being displaced.
              boxShadow: overId === p.id ? "inset 0 3px 0 0 var(--color-accent)" : undefined,
            }}
          >
            <span style={{ color: "var(--color-text-3)", cursor: "grab", display: "flex", touchAction: "none" }} title="Drag to reorder the tabs"><IGrab size={15} /></span>
            <span style={{ width: 38, height: 38, border: `1px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`, display: "grid", placeItems: "center", color: on ? "var(--accent-strong)" : "var(--color-text-3)", flex: "none" }}>
              <Icon size={20} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 15, fontWeight: 500 }}>{p.name}</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--color-text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {on ? detail[p.id] : "Disabled — hidden from the sidebar"}
              </span>
              {/* Todo is the one plugin with sub-views, and it opens on this one
                  every time you come back to the tab — not just on launch, which
                  is why the select is no longer tied to the Launch radio. */}
              {p.id === "todo" && on && (
                <select
                  className="input"
                  aria-label="Default Todo view"
                  value={TODO_VIEWS.some((o) => o.id === todoView) ? todoView : "last"}
                  onChange={(e) => dispatch({ type: "setSettings", patch: { todoDefaultView: e.target.value } })}
                  style={{ marginTop: 8, fontSize: 12, height: 30, maxWidth: 230 }}
                >
                  {TODO_VIEWS.map((o) => <option key={o.id} value={o.id}>Opens on: {o.label}</option>)}
                </select>
              )}
              {p.id === "notes" && on && <NotesTemplateSettings />}
            </span>
            {p.core && <span className="tag tag-neutral">core</span>}
            <label
              title={on ? `Open ${p.name} when LetsGo starts` : "Enable the plugin to land on it"}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontSize: 10, color: isLanding ? "var(--accent-strong)" : "var(--color-text-3)", cursor: on ? "pointer" : "default", flex: "none" }}
            >
              <input
                type="radio"
                name="lg-landing"
                checked={isLanding}
                disabled={!on}
                onChange={() => setLanding(p.id)}
                aria-label={`Open ${p.name} on launch`}
              />
              Launch
            </label>
            <Toggle
              on={on}
              label={`${p.name} plugin`}
              onChange={() => { if (!lastOne) dispatch({ type: "togglePlugin", id: p.id }); }}
            />
          </BP>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 12, border: "1px dashed var(--color-divider)", color: "var(--color-text-2)", fontSize: 13, justifyContent: "center" }}>
        <IPlus size={15} strokeWidth={1.6} />
        Browse plugin catalog — arrives with the plugin API
      </div>
    </Pane>
  );
}

/* ————— Appearance ————— */

/* Swatches show each accent's light/dark pair on a diagonal, mirroring the
   System theme card. Hexes match the [data-accent] blocks in theme.css. */
const ACCENTS: { id: AccentChoice; label: string; light: string; dark: string }[] = [
  { id: "violet", label: "Violet", light: "#7c5cf4", dark: "#a78bfa" },
  { id: "blue", label: "Ocean", light: "#3e63dd", dark: "#8ea6f4" },
  { id: "teal", label: "Teal", light: "#0e8276", dark: "#6cccc0" },
  { id: "ember", label: "Ember", light: "#c05621", dark: "#ff9d6b" },
  { id: "rose", label: "Rose", light: "#b23d64", dark: "#ef94b4" },
];

function Appearance() {
  const { state, dispatch } = useStore();
  const s = state.settings;
  const set = (patch: Partial<typeof s>) => dispatch({ type: "setSettings", patch });

  const themeCard = (id: ThemeChoice, label: string, preview: React.ReactNode) => {
    const active = s.theme === id;
    return (
      <button key={id} onClick={() => set({ theme: id })} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
        <span className="blueprint" style={{ width: "100%", height: 56, display: "block", overflow: "hidden", borderColor: active ? "var(--color-accent)" : undefined, outline: active ? "1px solid var(--color-accent)" : undefined }}>
          {preview}
        </span>
        <span style={{ fontSize: 12, color: active ? "var(--accent-strong)" : "var(--color-text)", fontWeight: active ? 600 : 400 }}>{label}</span>
      </button>
    );
  };

  const faceCard = (id: ClockFace, label: string) => {
    const active = (s.clockFace ?? "matrix") === id;
    return (
      <button key={id} onClick={() => set({ clockFace: id })} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
        <span className="blueprint" style={{ width: "100%", height: 58, display: "grid", placeItems: "center", overflow: "hidden", borderColor: active ? "var(--color-accent)" : undefined, outline: active ? "1px solid var(--color-accent)" : undefined }}>
          <ClockDisplay face={id} text="12:34" size={id === "analog" ? 46 : 92} color="var(--color-accent)" label={`${label} preview`} />
        </span>
        <span style={{ fontSize: 12, color: active ? "var(--accent-strong)" : "var(--color-text)", fontWeight: active ? 600 : 400 }}>{label}</span>
      </button>
    );
  };

  return (
    <Pane title="Appearance" sub="Theme, density and how much the status colors speak.">
      <div className="field">
        <label>Theme</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
          {themeCard("light", "Light", <span style={{ display: "block", height: "100%", background: "#eeeef3" }}><span style={{ display: "block", height: 14, background: "#7c5cf4" }} /><span style={{ display: "block", height: 5, width: "70%", background: "#7c5cf4", opacity: 0.4, margin: 6, borderRadius: 99 }} /></span>)}
          {themeCard("dark", "Dark", <span style={{ display: "block", height: "100%", background: "#0b0d16" }}><span style={{ display: "block", height: 14, background: "#a78bfa" }} /><span style={{ display: "block", height: 5, width: "70%", background: "#a78bfa", opacity: 0.5, margin: 6, borderRadius: 99 }} /></span>)}
          {themeCard("system", "System", <span style={{ display: "block", height: "100%", background: "linear-gradient(135deg, #eeeef3 50%, #0b0d16 50%)" }} />)}
          {themeCard("thermal", "Thermal", <span style={{ display: "block", height: "100%", background: "#faf8f1" }}><span style={{ display: "block", height: 14, background: "#1c1a15" }} /><span style={{ display: "block", width: "70%", borderTop: "1px dashed #1c1a15", margin: "7px 6px 0" }} /><span style={{ display: "block", height: 5, width: "50%", background: "#1c1a15", margin: 6 }} /></span>)}
          {themeCard("eink", "E-ink", <span style={{ display: "block", height: "100%", background: "#f2f0eb" }}><span style={{ display: "block", height: 14, background: "#16171a" }} /><span style={{ display: "block", height: 4, width: "76%", background: "#4a4d52", margin: "7px 6px 0" }} /><span style={{ display: "block", height: 4, width: "58%", background: "#9a9da2", margin: "4px 6px 0" }} /><span style={{ display: "block", height: 4, width: "68%", background: "#9a9da2", margin: "4px 6px 0" }} /></span>)}
        </div>
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Accent</label>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {ACCENTS.map((a) => {
            const active = (s.accent ?? "violet") === a.id;
            return (
              <button
                key={a.id}
                onClick={() => set({ accent: a.id })}
                aria-label={`${a.label} accent`}
                aria-pressed={active}
                title={a.label}
                style={{
                  width: 30, height: 30, borderRadius: "50%", cursor: "pointer", padding: 0,
                  background: `linear-gradient(135deg, ${a.light} 50%, ${a.dark} 50%)`,
                  border: "2px solid var(--color-bg)",
                  outline: active ? "2px solid var(--color-accent)" : "1px solid var(--color-divider)",
                  outlineOffset: 2,
                }}
              />
            );
          })}
          <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>
            {ACCENTS.find((a) => a.id === (s.accent ?? "violet"))?.label}
          </span>
        </div>
        {(s.theme === "thermal" || s.theme === "eink") && (
          <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>
            {s.theme === "thermal"
              ? "Thermal prints in a single ink — the accent applies in Light and Dark."
              : "E-ink has no colour to spend — the accent applies in Light and Dark."}
          </span>
        )}
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Clock face</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 10 }}>
          {CLOCK_FACES.map((f) => faceCard(f.id, f.label))}
        </div>
        <p style={{ fontSize: 11, color: "var(--color-text-3)", margin: "6px 0 0" }}>
          The face used for the focus timer and quick-timer readouts.
        </p>
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Week starts on</label>
        <Seg
          ariaLabel="Week starts on"
          items={[{ id: "0", label: "Sunday" }, { id: "1", label: "Monday" }, { id: "6", label: "Saturday" }]}
          active={String(s.weekStart)}
          onSelect={(id) => set({ weekStart: Number(id) as 0 | 1 | 6 })}
        />
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Clock</label>
        <Seg
          ariaLabel="Clock format"
          items={[{ id: "24", label: "24-hour" }, { id: "12", label: "12-hour" }]}
          active={s.hourFormat ?? "24"}
          onSelect={(id) => set({ hourFormat: id as "24" | "12" })}
        />
        <p style={{ fontSize: 11, color: "var(--color-text-3)", margin: "4px 0 0" }}>
          Applies to every time shown or typed in the app — time fields accept either style ("14:30" or "2:30 pm").
        </p>
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Density</label>
        <Seg
          ariaLabel="Density"
          items={[{ id: "compact", label: "Compact" }, { id: "cozy", label: "Cozy" }, { id: "roomy", label: "Roomy" }]}
          active={s.density}
          onSelect={(id) => set({ density: id as typeof s.density })}
        />
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Board sort</label>
        <Seg
          ariaLabel="Default Kanban card order"
          items={[
            { id: "manual", label: "Manual" },
            { id: "priority", label: "Priority" },
            { id: "deadline", label: "Deadline" },
            { id: "start", label: "Start time" },
          ]}
          active={s.boardSort ?? "manual"}
          onSelect={(id) => set({ boardSort: id as BoardSort })}
        />
        <p style={{ fontSize: 11, color: "var(--color-text-3)", margin: "4px 0 0" }}>
          The default order for the Kanban board. Each device's own sort control on the board overrides this locally.
        </p>
      </div>
      <div style={{ marginTop: 8 }}>
        <ToggleRow title="Status colors" sub="Tint tasks by status across the app" on={s.statusColors} onChange={(v) => set({ statusColors: v })} />
        <ToggleRow title="Reduce motion" sub="Minimize transitions" on={s.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />
      </div>
    </Pane>
  );
}

/* ————— Schedule ————— */

/** Which layout new pages start from — the default, whether to be asked every
    time instead, and the user's own layout. Lives with the Notes plugin row
    because that is where the default already lived; the "apply to this page"
    half of the feature is in the note editor, where the page is. */
function NotesTemplateSettings() {
  const { state, dispatch } = useStore();
  const s = state.settings;
  const set = (patch: Partial<typeof s>) => dispatch({ type: "setSettings", patch });
  const custom = s.customNoteTemplate;
  const [editing, setEditing] = useState(false);
  const options = availableTemplates(custom);

  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, maxWidth: 420 }}>
      <select
        className="input"
        aria-label="Template for new notes"
        title={NOTE_TEMPLATES.find((t) => t.id === (s.noteTemplate ?? "blank"))?.desc}
        value={options.some((t) => t.id === s.noteTemplate) ? s.noteTemplate : "blank"}
        onChange={(e) => set({ noteTemplate: e.target.value as NoteTemplate })}
        style={{ fontSize: 12, height: 30, maxWidth: 260 }}
      >
        {options.map((t) => <option key={t.id} value={t.id}>New note: {t.label}</option>)}
      </select>

      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--color-text-2)", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={!!s.askNoteTemplate}
          onChange={(e) => set({ askNoteTemplate: e.target.checked })}
          style={{ accentColor: "var(--color-accent)" }}
        />
        Ask which layout every time a page is created
      </label>

      {editing ? (
        <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            className="input"
            aria-label="Custom layout title"
            placeholder="Page title"
            value={custom?.title ?? ""}
            onChange={(e) => set({ customNoteTemplate: { title: e.target.value, body: custom?.body ?? "" } })}
            style={{ fontSize: 12, height: 30 }}
          />
          <textarea
            className="input"
            aria-label="Custom layout body"
            rows={9}
            value={custom?.body ?? ""}
            onChange={(e) => set({ customNoteTemplate: { title: custom?.title ?? "", body: e.target.value } })}
            style={{ fontSize: 12, fontFamily: "var(--font-mono)", lineHeight: 1.5, resize: "vertical" }}
          />
          <span style={{ fontSize: 11, color: "var(--color-text-3)" }}>
            Plain markdown. <code>{"{{title}}"}</code> and <code>{"{{date}}"}</code> are filled in when a page is
            created from it.
          </span>
          <span style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: "3px 9px" }} onClick={() => setEditing(false)}>Done</button>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "3px 9px", color: "var(--prio-hi-text)" }}
              onClick={() => {
                set({ customNoteTemplate: undefined, ...(s.noteTemplate === "custom" ? { noteTemplate: "blank" as NoteTemplate } : {}) });
                setEditing(false);
              }}
            >
              Delete my layout
            </button>
          </span>
        </span>
      ) : (
        <button
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: "3px 9px", alignSelf: "flex-start" }}
          onClick={() => {
            if (!custom) set({ customNoteTemplate: starterCustomTemplate() });
            setEditing(true);
          }}
        >
          {custom ? "Edit my layout" : "Write my own layout"}
        </button>
      )}
    </span>
  );
}

/** How much of the plan the board views show. Two spans, back and ahead, both
    defaulting to "Everything" — the app showed the whole vault before this
    existed, and an upgrade must never make work vanish on its own. */
function TaskWindowField() {
  const { state, dispatch } = useStore();
  const shown = taskWindowOf(state.settings);

  const set = (patch: Partial<typeof shown>) =>
    dispatch({ type: "setSettings", patch: { taskWindow: { ...shown, ...patch } } });

  const row = (
    label: string,
    hint: string,
    value: number | null,
    onPick: (days: number | null) => void,
  ) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
      <span className="cap">{label}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {RANGE_OPTIONS.map((o) => {
          const active = value === o.days;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o.days)}
              aria-pressed={active}
              style={{
                border: `1px solid ${active ? "var(--color-accent)" : "var(--color-divider)"}`,
                background: active ? "var(--accent-wash)" : "var(--color-surface)",
                color: active ? "var(--accent-strong)" : "var(--color-text-2)",
                fontWeight: active ? 600 : 400,
                borderRadius: "var(--radius-sm, 6px)", cursor: "pointer",
                fontSize: 12, padding: "4px 9px", fontFamily: "var(--font-body)",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 11, color: "var(--color-text-3)" }}>{hint}</span>
    </div>
  );

  return (
    <div className="field">
      <label>How much to show</label>
      <p style={{ fontSize: 12, color: "var(--color-text-2)", margin: "0 0 2px" }}>
        The Board, List, Eisenhower and Gantt views show everything by default, which turns into a year of finished
        work in one column. Narrow them here. Schedule and Calendar are unaffected — they are their own date axis.
      </p>
      {row("Past", "Tasks scheduled, due or finished before this drop off the boards.", shown.pastDays, (days) => set({ pastDays: days }))}
      {row("Future", "Tasks scheduled or due beyond this drop off the boards.", shown.futureDays, (days) => set({ futureDays: days }))}
      <p style={{ fontSize: 11, color: "var(--color-text-3)", margin: "8px 0 0" }}>
        Currently showing <strong style={{ color: "var(--color-text-2)" }}>{windowLabel(shown)}</strong>. Undated tasks
        are always shown, a routine appears when it has an occurrence in range, and a project stays visible while any task inside it does.
      </p>
    </div>
  );
}

function Schedule() {
  const { state, dispatch } = useStore();
  const wh = state.settings.workHours;
  const set = (patch: Partial<typeof wh>) => dispatch({ type: "setSettings", patch: { workHours: { ...wh, ...patch } } });
  const invalid = wh.endMin <= wh.startMin;
  const breakMin = state.settings.breakMin ?? DEFAULT_BREAK_MINUTES;
  const nudge = state.settings.statusNudge ?? { enabled: true, everyMin: 25 };
  const autoPauseMin = state.settings.autoPauseMin ?? 10;

  return (
    <Pane title="Schedule" sub="Confine auto-scheduling to your working day. A task that would run past the end time rolls to the next day's start, and the rest reflow after it.">
      <TaskWindowField />
      <ToggleRow
        title="Schedule reminders"
        sub="Prompt to start a task when its scheduled time arrives, and to extend or finish it when the scheduled end passes"
        on={state.settings.scheduleReminders !== false}
        onChange={(v) => dispatch({ type: "setSettings", patch: { scheduleReminders: v } })}
      />
      <ToggleRow
        title="Status check-ins"
        sub={`While a task is in progress, ping every ${nudge.everyMin} min so you keep its status honest`}
        on={nudge.enabled}
        onChange={(v) => dispatch({ type: "setSettings", patch: { statusNudge: { ...nudge, enabled: v } } })}
      />
      <div className="field" style={{ marginTop: 8, opacity: nudge.enabled ? 1 : 0.5 }}>
        <label htmlFor="nudge-min">Check in every</label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            id="nudge-min"
            type="number"
            min={5}
            max={120}
            step={5}
            value={nudge.everyMin}
            style={{ width: 90 }}
            onChange={(e) => {
              const n = Number(e.target.value);
              dispatch({ type: "setSettings", patch: { statusNudge: { ...nudge, everyMin: Number.isFinite(n) ? Math.min(120, Math.max(5, Math.round(n))) : 25 } } });
            }}
          />
          <span style={{ color: "var(--color-text-2)", fontSize: 13 }}>minutes</span>
        </div>
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="autopause-min">Auto-pause when away</label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            id="autopause-min"
            type="number"
            min={0}
            max={120}
            step={1}
            value={autoPauseMin}
            style={{ width: 90 }}
            onChange={(e) => {
              const n = Number(e.target.value);
              dispatch({ type: "setSettings", patch: { autoPauseMin: Number.isFinite(n) ? Math.min(120, Math.max(0, Math.round(n))) : 0 } });
            }}
          />
          <span style={{ color: "var(--color-text-2)", fontSize: 13 }}>minutes</span>
        </div>
        <p style={{ fontSize: 12, color: "var(--color-text-2)", margin: "6px 0 0" }}>
          If the focus timer runs this long with no interaction, it pauses itself and logs the idle span as a break instead of worked time. Set 0 to never auto-pause.
        </p>
      </div>
      <ToggleRow
        title="Ask when the day starts"
        sub="On the first open of each day, ask what time you are really starting and re-pack that day's unlocked tasks from there"
        on={state.settings.dayStartPrompt !== false}
        onChange={(v) => dispatch({ type: "setSettings", patch: { dayStartPrompt: v } })}
      />
      <ToggleRow
        title="Work hours"
        sub="Only auto-assign tasks inside the window below"
        on={wh.enabled}
        onChange={(v) => set({ enabled: v })}
      />
      <div className="field" style={{ marginTop: 8, opacity: wh.enabled ? 1 : 0.5 }}>
        <label>Working window</label>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TimeField ariaLabel="Work hours start" width={130} fontSize={14} disabled={!wh.enabled} minutes={wh.startMin} onChange={(m) => set({ startMin: m })} />
          <span style={{ color: "var(--color-text-2)", fontSize: 13 }}>to</span>
          <TimeField ariaLabel="Work hours end" width={130} fontSize={14} disabled={!wh.enabled} minutes={wh.endMin} onChange={(m) => set({ endMin: m })} />
        </div>
        {wh.enabled && invalid && (
          <p style={{ fontSize: 12, color: "var(--prio-hi-text)", margin: "6px 0 0" }}>
            The end time must be after the start time — scheduling packs edge-to-edge until it is.
          </p>
        )}
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="break-min">Break between tasks</label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            id="break-min"
            type="number"
            min={0}
            max={120}
            step={1}
            value={breakMin}
            style={{ width: 90 }}
            onChange={(e) => {
              const n = Number(e.target.value);
              dispatch({ type: "setSettings", patch: { breakMin: Number.isFinite(n) ? Math.min(120, Math.max(0, Math.round(n))) : 0 } });
            }}
          />
          <span style={{ color: "var(--color-text-2)", fontSize: 13 }}>minutes</span>
        </div>
        <p style={{ fontSize: 12, color: "var(--color-text-2)", margin: "6px 0 0" }}>
          Breathing room the auto-packer leaves between any two consecutive tasks, dependent or not. Set 0 to pack edge-to-edge.
        </p>
      </div>
    </Pane>
  );
}

/* ————— Google Calendar ————— */

/** Every account is its own OAuth run, so several can be connected at once —
    work and personal calendars side by side, each syncing independently. */
function GoogleCalendar() {
  const { state, dispatch, readOnly } = useStore();
  const { status, syncNow, reconnect } = useGoogleSync();
  const mobile = useMobile();
  const google = state.settings.google ?? emptyGoogleSettings();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<Record<string, GoogleCalendarSummary[]>>({});

  const patch = (next: Partial<typeof google>) =>
    dispatch({ type: "setSettings", patch: { google: { ...google, ...next } } });

  const loadCalendars = async (account: GoogleAccount) => {
    try {
      // Both callers are user gestures (just signed in, or focused the
      // calendar picker), so a popup here is expected and permitted.
      const token = await accessTokenFor(google.clientId, account, { allowPrompt: true });
      const found = await listCalendars(token);
      setCalendars((c) => ({ ...c, [account.id]: found }));
    } catch { /* the picker just stays on the stored id */ }
  };

  const addAccount = async () => {
    setError(null);
    setBusy("add");
    try {
      const who = await signInToGoogle(google.clientId.trim());
      const existing = google.accounts.find((a) => a.id === who.id);
      const account: GoogleAccount = existing ?? {
        id: who.id, email: who.email, calendarId: "primary", enabled: true,
      };
      patch({
        clientId: google.clientId.trim(),
        accounts: existing
          ? google.accounts.map((a) => (a.id === who.id ? { ...a, email: who.email, enabled: true } : a))
          : [...google.accounts, account],
      });
      void loadCalendars(account);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect that account.");
    } finally {
      setBusy(null);
    }
  };

  const removeAccount = async (account: GoogleAccount) => {
    await revokeGoogleAccount(account.id);
    patch({ accounts: google.accounts.filter((a) => a.id !== account.id) });
  };

  const setAccount = (id: string, next: Partial<GoogleAccount>) =>
    patch({ accounts: google.accounts.map((a) => (a.id === id ? { ...a, ...next } : a)) });

  const statusLine =
    status.state === "syncing" ? "Syncing…" :
    status.state === "reconnect" ? `Google needs you to sign in again: ${status.needsConsent?.join(", ")}` :
    status.state === "error" ? (status.detail ?? "Sync failed") :
    status.state === "ok" && status.counts
      ? `Last sync ${fmtDateTime(status.at ?? Date.now())} — ${status.counts.created} added, ${status.counts.updated} updated, ${status.counts.pulled} imported, ${status.counts.deleted + status.counts.removed} removed`
      : "";

  return (
    <Pane
      title="Google Calendar"
      sub="Scheduled tasks appear as calendar events and edits flow both ways. Connect as many accounts as you like — each syncs with one calendar of its own."
    >
      <div className="field">
        <label htmlFor="g-client">OAuth client ID</label>
        <input
          id="g-client"
          className="input"
          placeholder="1234567890-abcdefg.apps.googleusercontent.com"
          value={google.clientId}
          disabled={readOnly}
          onChange={(e) => patch({ clientId: e.target.value })}
        />
        <p style={{ fontSize: 12, color: "var(--color-text-2)", margin: "6px 0 0" }}>
          Create a <strong>Web application</strong> OAuth client in the Google Cloud console, enable the Google Calendar
          API, and add this page’s address to its <em>Authorized JavaScript origins</em>. The origin must be{" "}
          <strong>HTTPS</strong> (or <code>http://localhost</code>) — Google rejects plain-HTTP origins, so a LAN
          hostname needs a certificate. Nothing secret is stored: the browser holds a short-lived access token — kept
          in local storage so it survives a restart, renewed silently while your Google session is alive — and it
          never enters the vault.
        </p>
      </div>

      {!google.clientId.trim() ? (
        <p style={{ fontSize: 13, color: "var(--color-text-2)" }}>Add a client ID to connect an account.</p>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {google.accounts.map((account) => {
              const options = calendars[account.id];
              return (
                <BP key={account.id} style={{ background: "var(--color-bg)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <ICalendar size={14} />
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {account.email}
                    </span>
                    <Toggle on={account.enabled} onChange={(v) => setAccount(account.id, { enabled: v })} label={`Sync ${account.email}`} />
                  </div>
                  {/* Phone: the calendar picker gets the full width and the
                      actions sit on their own row with real tap targets.
                      Desktop keeps it all on one line. */}
                  <div style={{ display: "flex", alignItems: mobile ? "stretch" : "center", gap: 8, flexWrap: "wrap", flexDirection: mobile ? "column" : "row" }}>
                    <label htmlFor={`cal-${account.id}`} style={{ fontSize: 12, color: "var(--color-text-2)", flex: "none" }}>Calendar</label>
                    <select
                      id={`cal-${account.id}`}
                      className="input"
                      style={{ fontSize: 13, flex: mobile ? undefined : "1 1 180px", maxWidth: mobile ? "100%" : 260, width: mobile ? "100%" : undefined }}
                      value={account.calendarId}
                      disabled={readOnly}
                      onFocus={() => { if (!options) void loadCalendars(account); }}
                      onChange={(e) => {
                        const picked = options?.find((c) => c.id === e.target.value);
                        setAccount(account.id, { calendarId: e.target.value, calendarName: picked?.summary });
                      }}
                    >
                      {!options && <option value={account.calendarId}>{account.calendarName ?? "Primary calendar"}</option>}
                      {options?.map((c) => <option key={c.id} value={c.id}>{c.summary}{c.primary ? " (primary)" : ""}</option>)}
                    </select>
                    <span style={{ fontSize: 12, color: "var(--color-text-3)", flex: mobile ? "none" : 1 }}>
                      {account.lastSyncAt ? `synced ${fmtDateTime(account.lastSyncAt)}` : "never synced"}
                    </span>
                    <div style={{ display: "flex", gap: 8, flex: "none" }}>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 12, padding: mobile ? "0 12px" : "3px 10px", height: mobile ? 38 : undefined, flex: mobile ? 1 : undefined }}
                        disabled={readOnly || status.state === "syncing"}
                        onClick={() => syncNow(account.id)}
                      >
                        Sync now
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: mobile ? "0 12px" : "3px 10px", height: mobile ? 38 : undefined, flex: mobile ? 1 : undefined, color: "var(--prio-hi-text)" }}
                        disabled={readOnly}
                        onClick={() => void removeAccount(account)}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                </BP>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="btn btn-secondary"
              style={mobile ? { height: 42, flex: 1 } : undefined}
              disabled={readOnly || busy === "add"}
              onClick={() => void addAccount()}
            >
              <IPlus size={13} /> {busy === "add" ? "Waiting for Google…" : "Add a Google account"}
            </button>
            {google.accounts.length > 0 && (
              <button
                className="btn btn-primary"
                style={mobile ? { height: 42, flex: 1 } : undefined}
                disabled={readOnly || status.state === "syncing"}
                onClick={() => syncNow()}
              >
                Sync all
              </button>
            )}
          </div>

          {error && <p style={{ fontSize: 12, color: "var(--prio-hi-text)", margin: 0 }}>{error}</p>}
          {statusLine && (
            <p style={{ fontSize: 12, margin: 0, color: status.state === "error" || status.state === "reconnect" ? "var(--prio-hi-text)" : "var(--color-text-2)" }}>
              {statusLine}
            </p>
          )}
          {status.state === "reconnect" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 12, alignSelf: "flex-start", padding: mobile ? "0 14px" : "4px 12px", height: mobile ? 38 : undefined }}
                disabled={readOnly}
                onClick={() => reconnect()}
              >
                Reconnect Google
              </button>
              <p style={{ fontSize: 11.5, color: "var(--color-text-3)", margin: 0, lineHeight: 1.5 }}>
                Renewing without a popup needs cookies for <code>accounts.google.com</code>. On Firefox with strict
                tracking protection, allow them under Settings → Privacy&nbsp;&amp;&nbsp;Security → Cookies and Site
                Data → Manage&nbsp;Exceptions.
              </p>
            </div>
          )}

          <ToggleRow
            title="Sync automatically"
            sub="On open, when the tab regains focus, and every five minutes — otherwise only when you press Sync"
            on={google.autoSync}
            onChange={(v) => patch({ autoSync: v })}
          />

          <div className="field">
            <label>Reminder</label>
            <p style={{ fontSize: 12, color: "var(--color-text-2)", margin: "0 0 8px" }}>
              How long before an event Google pops its notification. “Calendar default” is whatever that calendar is
              already set to (30 minutes unless you changed it in Google). Any task can override this in its editor.
            </p>
            <ReminderPicker
              value={google.reminderMinutes}
              onChange={(v) => patch({ reminderMinutes: v ?? "default" })}
              disabled={readOnly}
            />
          </div>
        </>
      )}

      <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12, fontSize: 12, color: "var(--color-text-2)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--color-text)" }}>What syncs.</strong> Any task with a scheduled time, subtasks
        included — a nested task carries its parent chain in the event description. Parent tasks are not sent
        separately: their window is just the span of their children, so sending both would double every tree.
        Events you create in Google come back as tasks; all-day events (birthdays, holidays) arrive as dated events
        rather than blocks, so they never bury the timeline, and they are written back as all-day events too. Events
        Google itself owns — contact birthdays, Gmail bookings, focus time — are read-only, so they are pulled in and
        never written to. Deleting on either side deletes on the other. When the same task changed in both
        places, the most recent edit wins — except for a <ILock size={11} style={{ verticalAlign: -1 }} /> locked task,
        which always wins and is written back to the calendar.
      </div>
    </Pane>
  );
}

/* ————— Security ————— */

const PROJECT_ROLE_LABEL: Record<string, string> = {
  owner: "Owner", co_admin: "Co-admin", editor: "Editor", viewer: "Viewer",
};

/* Account & team: in team mode, shows who you are signed in as and the current
   project/role, with quick sign-out / switch-project / drop-to-local actions.
   In local mode, it is the doorway into team mode. Switching mode reloads so the
   top-level App gate re-reads it. */
function AccountTeam() {
  const { team, readOnly, lock, switchProject, sync } = useStore();

  if (team) {
    return (
      <Pane title="Account & team" sub="You are signed in to a team server; projects sync live for everyone with access.">
        <BP style={{ background: "var(--color-bg)", padding: 16, display: "flex", flexDirection: "column", gap: 8, maxWidth: 460 }}>
          <Row label="Signed in as" value={team.user.username} />
          <Row label="Project" value={team.projectName} />
          <Row label="Your role" value={`${PROJECT_ROLE_LABEL[team.role] ?? team.role}${readOnly ? " · read only" : ""}`} />
          <Row label="Sync" value={sync.state === "syncing" ? "saving…" : sync.state === "error" ? (sync.detail ?? "error") : "up to date"} />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button className="btn btn-secondary" onClick={switchProject}>Switch project</button>
            <button className="btn btn-secondary" onClick={lock}>Sign out</button>
          </div>
        </BP>
        <BP style={{ background: "var(--color-bg)", padding: 16, marginTop: 12, maxWidth: 460 }}>
          <p style={{ fontSize: 12.5, color: "var(--color-text-2)", margin: "0 0 10px" }}>
            Prefer to work offline on just this device? Switch to the private local vault. Your team data stays on the server.
          </p>
          <button className="btn btn-ghost" style={{ color: "var(--accent-strong)" }} onClick={() => { setAppMode("local"); location.reload(); }}>
            Use the local vault instead
          </button>
        </BP>
      </Pane>
    );
  }

  return (
    <Pane title="Account & team" sub="Share projects with teammates, each with their own role.">
      <BP style={{ background: "var(--color-bg)", padding: 16, maxWidth: 460 }}>
        <p style={{ fontSize: 12.5, color: "var(--color-text-2)", margin: "0 0 12px" }}>
          You are using LetsGo privately on this device. Sign in to a team server to collaborate on shared projects with
          viewer, editor, and admin roles. Your local data stays here until you import it into a project.
        </p>
        <button className="btn btn-primary" onClick={() => { setAppMode("team"); location.reload(); }}>
          Sign in to a team server
        </button>
      </BP>
    </Pane>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 13 }}>
      <span style={{ width: 110, flex: "none", color: "var(--color-text-2)" }}>{label}</span>
      <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

function Security() {
  const { state, dispatch, lock, rekey } = useStore();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(unlockMode());

  // Re-encrypt the vault under `target` (empty string = passwordless). In
  // passphrase mode the current one is verified first.
  async function apply(target: string) {
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "passphrase") await openVault(current);
      await rekey(target);
      setMode(unlockMode());
      setCurrent(""); setNext(""); setConfirm("");
      setMsg({ ok: true, text: target === NO_PASSPHRASE ? "Passphrase removed — the app now opens without one." : "Vault re-encrypted under the new passphrase." });
    } catch {
      setMsg({ ok: false, text: "Current passphrase is wrong — nothing changed." });
    }
    setBusy(false);
  }

  return (
    <Pane title="Security" sub="The vault is AES-256-GCM encrypted at rest; the key never leaves this device.">
      <ToggleRow
        title="Timer notifications"
        sub="OS banner when a pomodoro or countdown finishes — works while the app or installed PWA is open, even in the background"
        on={state.settings.notifications}
        onChange={async (v) => {
          if (v && !(await ensurePermission())) {
            setMsg({ ok: false, text: "The browser blocked notifications — allow them in site settings first." });
            return;
          }
          dispatch({ type: "setSettings", patch: { notifications: v } });
        }}
      />

      <ToggleRow
        title="Notification sounds"
        sub="Play a short chime when a timer finishes, a task is completed, or you unlock LetsGo — no browser permission needed"
        on={state.settings.sounds}
        onChange={(v) => dispatch({ type: "setSettings", patch: { sounds: v } })}
      />

      <div className="field" style={{ marginTop: 8, opacity: state.settings.sounds ? 1 : 0.5 }}>
        <label htmlFor="alert-sound">Alert sound</label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select
            id="alert-sound"
            className="input"
            style={{ maxWidth: 220 }}
            value={state.settings.alertSound ?? "chime"}
            onChange={(e) => {
              const alertSound = e.target.value as (typeof ALERT_SOUNDS)[number]["id"];
              dispatch({ type: "setSettings", patch: { alertSound } });
              playChime(alertChime(alertSound));
            }}
          >
            {ALERT_SOUNDS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: "4px 12px" }}
            onClick={() => playChime(alertChime(state.settings.alertSound))}
          >
            Preview
          </button>
        </div>
        <p style={{ fontSize: 11, color: "var(--color-text-3)", margin: "6px 0 0" }}>
          Played when a timer finishes or a status check-in fires. Task-done and unlock sounds are unchanged.
        </p>
      </div>

      {mode === "none" ? (
        <div className="field" style={{ marginTop: 10 }}>
          <label>Passphrase</label>
          <p style={{ fontSize: 12.5, color: "var(--color-text-2)", margin: "0 0 8px" }}>
            This device opens LetsGo without a passphrase. Set one to be asked for it on unlock.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, maxWidth: 380 }}>
            <input type="password" className="input" placeholder="New passphrase" value={next} onChange={(e) => setNext(e.target.value)} aria-label="New passphrase" />
            <input type="password" className="input" placeholder="Confirm new passphrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Confirm new passphrase" />
            <button className="btn btn-primary" disabled={busy || next.length < 6 || next !== confirm} onClick={() => void apply(next)}>
              {busy ? "Re-encrypting…" : "Set a passphrase"}
            </button>
          </div>
        </div>
      ) : (
        <div className="field" style={{ marginTop: 10 }}>
          <label>Passphrase</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, maxWidth: 380 }}>
            <input type="password" className="input" placeholder="Current passphrase" value={current} onChange={(e) => setCurrent(e.target.value)} aria-label="Current passphrase" />
            <input type="password" className="input" placeholder="New passphrase" value={next} onChange={(e) => setNext(e.target.value)} aria-label="New passphrase" />
            <input type="password" className="input" placeholder="Confirm new passphrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Confirm new passphrase" />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || !current || next.length < 6 || next !== confirm} onClick={() => void apply(next)}>
                {busy ? "Working…" : "Change passphrase"}
              </button>
              <button className="btn btn-secondary" disabled={busy || !current} onClick={() => void apply(NO_PASSPHRASE)} title="Open without a passphrase from now on">
                Remove
              </button>
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--color-text-3)", margin: "6px 0 0" }}>
            Remove opens instantly next time — data stays encrypted at rest, but anyone with this device can open it.
          </p>
        </div>
      )}

      {msg && <p style={{ fontSize: 12, color: msg.ok ? "var(--st-done)" : "var(--prio-hi-text)" }}>{msg.text}</p>}

      {mode === "passphrase" && (
        <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 14, marginTop: 6 }}>
          <button className="btn btn-secondary" onClick={lock}>
            <ILock size={15} />
            Lock now
          </button>
        </div>
      )}
    </Pane>
  );
}

/* ————— Data & backup ————— */

function DataBackup() {
  const { state, dispatch, sync, syncNow } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const cfg = state.settings.sync;
  const setCfg = (patch: Partial<typeof cfg>) => dispatch({ type: "setSettings", patch: { sync: { ...cfg, ...patch } } });
  /* Connection fields are edited as a LOCAL draft and committed on blur.
     Writing every keystroke into settings scheduled a sync retry with the
     half-typed password — each 401 popped the browser's native Basic-auth
     dialog over the form every few seconds, stealing focus mid-type. */
  const [draft, setDraft] = useState({ url: cfg.url, username: cfg.username, password: cfg.password });
  useEffect(() => { setDraft({ url: cfg.url, username: cfg.username, password: cfg.password }); }, [cfg.url, cfg.username, cfg.password]);
  const commitDraft = () => {
    const trimmed = { url: draft.url.trim(), username: draft.username.trim(), password: draft.password.trim() };
    if (trimmed.url !== cfg.url || trimmed.username !== cfg.username || trimmed.password !== cfg.password) setCfg(trimmed);
  };
  const conflict = localStorage.getItem("letsgo.conflict");

  const syncLabel =
    sync.state === "off" ? "off" :
    sync.state === "syncing" ? "syncing…" :
    sync.state === "ok" ? `synced ${sync.at ? new Date(sync.at).toLocaleTimeString() : ""}` :
    `error — ${sync.detail ?? "unreachable"} (local-only until it recovers)`;

  function exportJson() {
    void saveTextFile(
      `letsgo-export-${new Date().toISOString().slice(0, 10)}.json`,
      "application/json",
      JSON.stringify(state, null, 2),
    );
  }

  async function importJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as AppState;
      if (!Array.isArray(parsed.tasks) || !parsed.settings) throw new Error("shape");
      // An export taken before a field existed arrives without it — hydrate
      // rather than trusting the file, or the screens that read it will throw.
      dispatch({ type: "importState", state: hydrateState(parsed) });
      setMsg("Import complete — everything replaced with the file's contents.");
    } catch {
      setMsg("That file doesn't look like a LetsGo export.");
    }
  }

  return (
    <Pane title="Data & backup" sub="Everything lives in this browser's storage, encrypted. Exports are plain JSON — store them somewhere safe.">
      <ToggleRow
        title="Sync with the NAS"
        sub="Pushes the encrypted vault to your WebDAV share after every change; other devices pick it up on focus and every 25 s. The NAS never sees plaintext."
        on={cfg.enabled}
        onChange={(v) => setCfg({ enabled: v })}
      />
      {cfg.enabled && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
          <div className="field">
            <label htmlFor="sy-url">WebDAV URL</label>
            <input id="sy-url" className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} onBlur={commitDraft} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field">
              <label htmlFor="sy-user">NAS username</label>
              <input id="sy-user" className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} onBlur={commitDraft} />
            </div>
            <div className="field">
              <label htmlFor="sy-pass">NAS password</label>
              <input id="sy-pass" type="password" className="input" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} onBlur={commitDraft} />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn btn-secondary" onClick={syncNow}>Sync now</button>
            <span style={{ fontSize: 12, color: sync.state === "error" ? "var(--prio-hi-text)" : "var(--color-text-2)" }}>{syncLabel}</span>
          </div>
          {conflict && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--color-text-2)", border: "1px dashed var(--color-divider)", padding: "8px 10px" }}>
              A conflicting copy was overwritten during sync.
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, color: "var(--accent-strong)", padding: "2px 6px" }}
                onClick={() => void saveTextFile("letsgo-conflict-vault.json", "application/json", conflict)}
              >
                Download it (encrypted)
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--color-text-2)", padding: "2px 6px" }} onClick={() => { localStorage.removeItem("letsgo.conflict"); setMsg("Conflict copy discarded."); }}>
                Discard
              </button>
            </div>
          )}
        </div>
      )}
      <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 14, marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-secondary" onClick={exportJson}>Export JSON</button>
        <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>Import JSON…</button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ""; }} />
      </div>
      {msg && <p style={{ fontSize: 12, color: "var(--color-text-2)" }}>{msg}</p>}
      <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 14, marginTop: 6 }}>
        <div className="cap" style={{ marginBottom: 10 }}>Danger zone</div>
        {confirmErase ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn btn-secondary" style={{ color: "var(--prio-hi-text)", borderColor: "var(--prio-hi-border)" }} onClick={() => { destroyVault(); window.location.reload(); }}>
              Yes, erase everything
            </button>
            <button className="btn btn-ghost" style={{ color: "var(--color-text-2)" }} onClick={() => setConfirmErase(false)}>Keep my data</button>
          </div>
        ) : (
          <button className="btn btn-secondary" onClick={() => setConfirmErase(true)}>Erase vault and start over…</button>
        )}
      </div>
    </Pane>
  );
}

/* ————— About ————— */

function About() {
  return (
    <Pane title="About">
      <BP style={{ background: "var(--color-card)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="wm" style={{ fontSize: 24 }}>LET&rsquo;S GO<span className="cv">&#9656;&#9656;</span></span>
        <span style={{ fontSize: 13, color: "var(--color-text-2)" }}>{SHELL_VERSION_LABEL} — the plugin planner, redrawn for the browser and the phone.</span>
      </BP>
      <p style={{ fontSize: 13, color: "var(--color-text-2)", lineHeight: 1.6 }}>
        Drawn in the <strong>Industry</strong> wireframe language: steel-blue on a technical ground, square corners,
        hairline frames with registration marks. Local-first — the encrypted vault never leaves this device.
        Companion to the LetsGo desktop app (Tauri).
      </p>
    </Pane>
  );
}

/** Keys for the two optional services the Library can use.

    Both are stored per-device in localStorage, never in the vault — see
    lib/apiKeys.ts for why. That is stated on screen too, because a user
    typing a billable credential deserves to know where it goes. */
function Library() {
  const [google, setGoogle] = useState(googleBooksKey());
  const [claude, setClaude] = useState(claudeKey());
  const [showGoogle, setShowGoogle] = useState(false);
  const [showClaude, setShowClaude] = useState(false);
  const [note, setNote] = useState("");
  /* The shelf never explains a key problem (there the answer is always "add
     it manually") — it lands here instead, where it is actually fixable. */
  const [issue, setIssue] = useState(bookApiIssue());
  const report = lastResolveReport();

  function saveGoogle(value: string) {
    setGoogle(value);
    setGoogleBooksKey(value);
    clearBookApiIssue();
    setIssue("");
    setNote(value.trim() ? "Google Books key saved on this device." : "Google Books key removed.");
  }
  function saveClaude(value: string) {
    setClaude(value);
    setClaudeKey(value);
    setNote(value.trim() ? "Claude key saved on this device." : "Claude key removed.");
  }

  return (
    <Pane
      title="Library"
      sub="Optional keys that make book lookup work better. Both are stored on this device only — they are never written into the vault, so they do not sync and are not in your JSON export."
    >
      {issue && (
        <BP style={{ background: "var(--prio1-bg)", padding: "12px 16px", display: "flex", gap: 8, alignItems: "flex-start" }} role="alert">
          <span aria-hidden style={{ flex: "none" }}>⚠</span>
          <span style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--prio1-fg)" }}>
            <strong>Book lookups are failing on this device:</strong> {issue}
          </span>
        </BP>
      )}
      {report && (
        <BP style={{ background: "var(--color-card)", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Last lookup run</div>
          <div style={{ fontSize: 12, color: "var(--color-text-2)" }}>
            {new Date(report.at).toLocaleString()} — filled {report.filled}
            {report.webFilled ? ` (${report.webFilled} via Claude web search)` : ""} · not in the databases {report.notFound} · fetch errors {report.unavailable}
          </div>
          {report.reasons.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--color-text-2)", display: "flex", flexDirection: "column", gap: 2 }}>
              {report.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          ) : (
            <div style={{ fontSize: 12, color: "var(--color-text-3)" }}>
              No API errors in this run — both databases answered. Books that stayed unfilled are genuinely absent
              from Open Library and Google Books (common for regional reprints); add their details manually or use
              the cover-photo scan.
            </div>
          )}
        </BP>
      )}
      <BP style={{ background: "var(--color-card)", padding: "15px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Google Books API key</div>
          <div style={{ fontSize: 12, color: "var(--color-text-2)", marginTop: 2 }}>
            Without a key, Google Books shares one daily quota across everyone on your network — so it
            usually answers <strong>429 for every book</strong>, not just rare ones, leaving Open Library
            as your only source. A free key gives this app its own 1,000 lookups a day.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="input"
            type={showGoogle ? "text" : "password"}
            value={google}
            autoComplete="off"
            spellCheck={false}
            placeholder="AIza…"
            aria-label="Google Books API key"
            onChange={(e) => saveGoogle(e.target.value)}
            style={{ flex: 1, minWidth: 190, height: 32, fontSize: 13, fontFamily: "var(--font-mono)" }}
          />
          <button className="btn btn-secondary" style={{ padding: "5px 10px", fontSize: 12 }}
            onClick={() => setShowGoogle((v) => !v)}>
            {showGoogle ? "Hide" : "Show"}
          </button>
        </div>
        <a
          href="https://console.cloud.google.com/apis/credentials"
          target="_blank"
          rel="noreferrer noopener"
          style={{ fontSize: 12, color: "var(--accent-strong)" }}
        >
          Create one in Google Cloud Console → Credentials (enable the Books API)
        </a>
      </BP>

      <BP style={{ background: "var(--color-card)", padding: "15px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Claude API key</div>
          <div style={{ fontSize: 12, color: "var(--color-text-2)", marginTop: 2 }}>
            Lets the scanner fall back to photographing a cover when no database has the ISBN — the only
            route that reaches regional editions that were never indexed. Uses Claude Opus 5 and is
            billed to your own Anthropic account at roughly a cent per cover, so a few hundred books is
            a few dollars. Leave it empty to keep the feature off.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="input"
            type={showClaude ? "text" : "password"}
            value={claude}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            aria-label="Claude API key"
            onChange={(e) => saveClaude(e.target.value)}
            style={{ flex: 1, minWidth: 190, height: 32, fontSize: 13, fontFamily: "var(--font-mono)" }}
          />
          <button className="btn btn-secondary" style={{ padding: "5px 10px", fontSize: 12 }}
            onClick={() => setShowClaude((v) => !v)}>
            {showClaude ? "Hide" : "Show"}
          </button>
        </div>
        <span style={{ fontSize: 11.5, color: "var(--color-text-2)" }}>
          {claude ? `Stored on this device: ${maskKey(claude)}` : "Not set — cover recognition is off."}
        </span>
      </BP>

      {note && <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>{note}</span>}
    </Pane>
  );
}
