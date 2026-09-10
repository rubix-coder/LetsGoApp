/* Which Todo view you land on.

   Todo is the one plugin with sub-views, and its route carries them
   ("todo/board/gantt", "todo/schedule"). The sidebar/tab buttons navigate to
   the bare "/todo", so before this module every tab switch dropped you back on
   the Kanban board no matter which view you had been working in. The choice
   lives in Settings → Plugins: pin one view, or `last`, which restores
   whichever view you were last in.

   The remembered view is a per-device UI preference, not project data, so it
   sits in localStorage rather than the vault — a phone and a desktop can sit
   on different views, and switching views never dirties the synced document.
   The PIN, being a deliberate choice, is vault settings and syncs. */

const STORE_KEY = "lg:todoView";

/** `settings.todoDefaultView` value meaning "restore the last view I used". */
export const LAST_VIEW = "last";

/** Every destination the Todo switcher can reach, as landing routes. */
export const TODO_VIEWS: readonly { id: string; label: string }[] = [
  { id: LAST_VIEW, label: "Last used view" },
  { id: "todo/board/kanban", label: "Board · Kanban" },
  { id: "todo/board/eisenhower", label: "Board · Eisenhower" },
  { id: "todo/board/gantt", label: "Board · Gantt" },
  { id: "todo/board/list", label: "Board · List" },
  { id: "todo/schedule", label: "Schedule" },
  { id: "todo/calendar", label: "Calendar" },
  { id: "todo/events", label: "Events" },
];

const FALLBACK = "todo/board/kanban";

/** The sub-view and board lens a route resolves to: ["board", "kanban"]. The
    lens is meaningless for schedule/calendar/events and is left at its default
    there, exactly as the route itself leaves it out. */
export type TodoView = [sub: string, board: string];

function split(route: string): TodoView {
  const [, sub = "board", board = "kanban"] = route.split("/");
  return [sub, board];
}

function known(route: string): boolean {
  return TODO_VIEWS.some((v) => v.id === route && v.id !== LAST_VIEW);
}

/** Human label for a stored choice — used by the Settings summary line. */
export function todoViewLabel(route: string): string {
  return TODO_VIEWS.find((v) => v.id === route)?.label ?? todoViewLabel(FALLBACK);
}

function readLast(): string {
  try {
    return localStorage.getItem(STORE_KEY) ?? "";
  } catch {
    // Private-mode Safari throws rather than returning null. Nothing
    // remembered simply means the fallback view.
    return "";
  }
}

/** Records the Todo view now on screen, so `last` has something to restore.
    A bare "/todo" is the pre-resolution route, not a view the user picked, and
    is ignored — otherwise landing on Todo would overwrite what it restored. */
export function rememberTodoView(route: readonly string[]): void {
  if (route[0] !== "todo" || route.length < 2) return;
  const sub = route[1];
  const full = sub === "board" ? `todo/board/${route[2] ?? "kanban"}` : `todo/${sub}`;
  if (!known(full)) return;
  try {
    localStorage.setItem(STORE_KEY, full);
  } catch {
    /* nothing to do — `last` falls back to the Kanban board */
  }
}

/** The view a bare "/todo" should show, given the user's setting. Unknown
    routes — a view removed since the choice was stored — fall back to Kanban
    rather than rendering nothing. */
export function resolveTodoView(setting: string | undefined): TodoView {
  const pinned = setting ?? FALLBACK;
  if (pinned !== LAST_VIEW) return split(known(pinned) ? pinned : FALLBACK);
  const last = readLast();
  return split(known(last) ? last : FALLBACK);
}
