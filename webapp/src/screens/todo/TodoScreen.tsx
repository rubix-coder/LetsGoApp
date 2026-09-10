import { useEffect, useRef, useState } from "react";
import { rootTasks, useStore } from "../../lib/store";
import { nav, useMobile, useRoute } from "../../lib/router";
import { useEditor } from "../../App";
import { tasksToMarkdown } from "../../lib/mdTasks";
import { saveTextFile } from "../../lib/download";
import { searchTaskTree } from "../../lib/taskSearch";
import { rememberTodoView, resolveTodoView } from "../../lib/todoView";
import { filterTaskWindow, taskWindowOf, windowLabel } from "../../lib/taskWindow";
import { Seg } from "../../components/ui";
import { IDownload, IFilter, IPlus, ISearch, IUpload, IX } from "../../components/Icons";
import { MobileHeader } from "../../shell/AppShell";
import { Kanban } from "./Kanban";
import { Eisenhower, Gantt, ListView } from "./boardViews";
import { Schedule } from "./Schedule";
import { Calendar } from "./Calendar";
import { Events } from "./Events";

export function TodoScreen() {
  const { state, dispatch, readOnly } = useStore();
  const route = useRoute();
  const mobile = useMobile();
  const { openTask } = useEditor();
  const [search, setSearch] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  function showFlash(text: string) {
    setFlash(text);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 4500);
  }

  async function importFile(file: File) {
    const text = await file.text();
    // Route by extension, falling back to a content sniff for calendars saved
    // without an .ics suffix. iCal carries dates/priority/tags/status; plain
    // markdown bullets do not — so they take different importers.
    const isIcal = /\.(ics|ical|ifb)$/i.test(file.name) || /^BEGIN:VCALENDAR/im.test(text.slice(0, 256));
    if (isIcal) {
      dispatch({ type: "importIcal", text, sourceName: file.name });
      showFlash(`Imported calendar "${file.name}" — re-importing it updates and removes to match.`);
    } else {
      dispatch({ type: "importMarkdown", text, sourceName: file.name });
      showFlash(`Imported "${file.name}" — re-importing the same file updates and removes to match it.`);
    }
  }

  function exportMd() {
    void saveTextFile("letsgo-todos.md", "text/markdown", tasksToMarkdown(state));
    showFlash("Exported letsgo-todos.md");
  }

  const importExportButtons = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.txt,.ics,.ical,text/markdown,text/plain,text/calendar"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }}
      />
      <button className="btn btn-icon btn-secondary" onClick={() => fileRef.current?.click()} title="Import markdown or iCal (.ics) as todos" aria-label="Import markdown or iCal as todos">
        <IUpload size={16} strokeWidth={1.6} />
      </button>
      <button className="btn btn-icon btn-secondary" onClick={exportMd} title="Export todos as markdown" aria-label="Export todos as markdown">
        <IDownload size={16} strokeWidth={1.6} />
      </button>
    </>
  );

  /* A bare "/todo" — which is where every sidebar tab, mobile tab and landing
     redirect points — resolves through the user's Settings → Plugins choice
     instead of hard-landing on the Kanban board. Resolved rather than
     redirected on purpose: a nav() here would push a history entry, so Back
     out of Todo would bounce straight back into it. */
  const [defaultSub, defaultBoard] = resolveTodoView(state.settings.todoDefaultView);
  const sub = route[1] ?? defaultSub;
  const boardView = route[2] ?? (route[1] ? "kanban" : defaultBoard);

  // Feeds the "Last used view" setting. Effect, not render, so it records what
  // the user settled on rather than every route the render pass considered.
  useEffect(() => { rememberTodoView(route); }, [route.join("/")]);

  // How much of the plan the board shows at all (lib/taskWindow.ts). Applied
  // BEFORE search, so a query searches what the board is showing rather than
  // pulling a task back out of a window the user closed. Schedule and Calendar
  // are their own date axis and are left alone.
  const shown = taskWindowOf(state.settings);
  const { roots, ids: windowIds } = filterTaskWindow(rootTasks(state), state.tasks, shown, Date.now());
  const hiddenCount = rootTasks(state).length - roots.length;

  const open = roots.filter((t) => t.status !== "done" && t.status !== "skipped").length;
  const active = roots.filter((t) => t.status === "in_progress").length;

  // Search sees the whole subtree (lib/taskSearch.ts) — a root stays visible
  // when any nested subtask matches, which is where imported schedules live.
  const { roots: visible, ids: searchIds } = searchTaskTree(roots, state.tasks, search ?? "");
  // Gantt walks the tree itself, so it needs the INTERSECTION of both filters.
  const visibleIds = searchIds && windowIds
    ? new Set([...searchIds].filter((id) => windowIds.has(id)))
    : searchIds ?? windowIds;

  const searchBox = search !== null && (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--color-accent)", background: "var(--color-surface)", padding: "0 4px 0 8px" }}>
      <input
        autoFocus
        value={search}
        placeholder="Search title or #tag"
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") setSearch(null); }}
        style={{ border: "none", background: "none", fontSize: 13, width: 150, color: "var(--color-text)" }}
      />
      <button className="btn btn-ghost btn-icon" style={{ width: 24, height: 24, color: "var(--color-text-2)" }} onClick={() => setSearch(null)} aria-label="Close search">
        <IX size={13} />
      </button>
    </span>
  );

  const body =
    sub === "schedule" ? <Schedule /> :
    sub === "calendar" ? <Calendar /> :
    sub === "events" ? <Events /> :
    boardView === "eisenhower" ? <Eisenhower tasks={visible} /> :
    boardView === "gantt" ? <Gantt visibleIds={visibleIds} /> :
    boardView === "list" ? <ListView tasks={visible} /> :
    <Kanban tasks={visible} />;

  // Schedule/Calendar/Events don't consume the filter — showing a search box
  // there that silently does nothing is how "search is broken" gets reported.
  const searchable = sub !== "schedule" && sub !== "calendar" && sub !== "events";

  const dropProps = {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); },
    onDrop: (e: React.DragEvent) => {
      const file = [...e.dataTransfer.files].find((f) => /\.(md|markdown|txt|ics|ical|ifb)$/i.test(f.name));
      if (file) { e.preventDefault(); void importFile(file); }
    },
  };

  const flashLine = flash && (
    <p style={{ margin: 0, padding: "6px 22px", fontSize: 12, color: "var(--accent-strong)", borderBottom: "1px solid var(--color-divider)", background: "var(--accent-soft)" }}>
      {flash}
    </p>
  );

  if (mobile) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }} {...dropProps}>
        <MobileHeader
          title={sub === "schedule" ? "Schedule" : sub === "calendar" ? "Calendar" : sub === "events" ? "Events" : "Todo"}
          right={
            <>
              {importExportButtons}
              {searchable && (searchBox || (
                <button className="btn btn-icon btn-secondary" onClick={() => setSearch("")} aria-label="Search">
                  <ISearch size={17} />
                </button>
              ))}
            </>
          }
        />
        {flashLine}
        {/* Same switcher components as desktop (Seg + Seg ink) so the two
            form factors share one visual language — the previous ad-hoc
            bordered/ink chips diverged from both desktop rows. */}
        <div style={{ display: "flex", padding: "0 16px 10px", overflowX: "auto" }}>
          <Seg
            small
            ariaLabel="Todo view"
            items={[{ id: "board", label: "Board" }, { id: "schedule", label: "Schedule" }, { id: "calendar", label: "Calendar" }, { id: "events", label: "Events" }]}
            active={sub}
            onSelect={(id) => nav(`/todo/${id}`)}
          />
        </div>
        {/* Board lenses — the same Kanban/Eisenhower/Gantt/List views as
            desktop; they were unreachable on mobile with no switcher. */}
        {sub === "board" && (
          <div style={{ display: "flex", padding: "0 16px 10px", overflowX: "auto" }}>
            <Seg
              small
              ink
              ariaLabel="Board lens"
              items={[
                { id: "kanban", label: "Kanban" },
                { id: "eisenhower", label: "Eisenhower" },
                { id: "gantt", label: "Gantt" },
                { id: "list", label: "List" },
              ]}
              active={boardView}
              onSelect={(id) => nav(`/todo/board/${id}`)}
            />
          </div>
        )}
        {body}
        {!readOnly && (
          <button className="btn btn-primary fab" onClick={() => openTask(null)} aria-label="Add task">
            <IPlus size={22} strokeWidth={1.8} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }} {...dropProps}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 22px", borderBottom: "1px solid var(--color-divider)" }}>
        <Seg
          ariaLabel="Todo view"
          items={[{ id: "board", label: "Board" }, { id: "schedule", label: "Schedule" }, { id: "calendar", label: "Calendar" }, { id: "events", label: "Events" }]}
          active={sub}
          onSelect={(id) => nav(`/todo/${id}`)}
        />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {importExportButtons}
          {searchable && (searchBox || (
            <button className="btn btn-icon btn-secondary" onClick={() => setSearch("")} aria-label="Search">
              <ISearch size={17} />
            </button>
          ))}
          {/* Events carries its own "Add event" in its toolbar — two primary
              buttons side by side would read as a choice the user has to make. */}
          {!readOnly && sub !== "events" && (
            <button className="btn btn-primary" onClick={() => openTask(null)}>
              <IPlus size={16} strokeWidth={1.6} />
              Add task
            </button>
          )}
        </div>
      </div>
      {flashLine}

      {sub === "board" && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 22px", borderBottom: "1px solid var(--color-divider)" }}>
          <Seg
            ariaLabel="Board lens"
            ink
            items={[
              { id: "kanban", label: "Kanban" },
              { id: "eisenhower", label: "Eisenhower" },
              { id: "gantt", label: "Gantt" },
              { id: "list", label: "List" },
            ]}
            active={boardView}
            onSelect={(id) => nav(`/todo/board/${id}`)}
          />
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-text-2)", display: "flex", alignItems: "center", gap: 6 }}>
            <IFilter size={15} />
            {open} tasks · {active} in progress
            {hiddenCount > 0 && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "2px 7px", color: "var(--color-text-3)" }}
                title={`Showing ${windowLabel(shown)}. Change it in Settings → Schedule.`}
                onClick={() => nav("/settings/schedule")}
              >
                {hiddenCount} outside {windowLabel(shown)}
              </button>
            )}
          </span>
        </div>
      )}

      {body}
    </div>
  );
}
