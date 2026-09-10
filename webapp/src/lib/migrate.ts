/* Bringing a persisted state up to the shape the current code expects.

   There is no schema version anywhere in the vault (sync.ts's `rev` is a save
   counter, not a schema marker), so migration is structural: fill what is
   missing, keep what is there. That rule was previously spelled out three
   times as duplicated `??=` lines at each load path; this module is the one
   place it now lives, which is also how the JSON-import path finally gets it. */

import { seedState } from "./seed";
import { LAST_VIEW } from "./todoView";
import type { AppState, Task } from "./types";

/** Tasks used to feed exactly one habit (`habitId`); they now feed any number
    (`habitIds`). An older vault's single id is carried across and the dead
    field dropped, so nothing anywhere has to read both shapes. */
function migrateTaskHabits(tasks: readonly Task[]): Task[] {
  // Returned by identity when there is nothing to migrate, which is every load
  // after the first: hydrateState is a no-op on an already-current state, and
  // handing back a fresh array would invalidate memoisation on every unlock.
  if (!tasks.some((t) => (t as Task & { habitId?: string }).habitId !== undefined)) {
    return tasks as Task[];
  }
  return tasks.map((task) => {
    const legacy = (task as Task & { habitId?: string }).habitId;
    if (legacy === undefined) return task;
    const { habitId: _dropped, ...rest } = task as Task & { habitId?: string };
    // An already-migrated list wins: it is the newer of the two writers.
    return rest.habitIds ? rest : { ...rest, habitIds: [legacy] };
  });
}

/** Normalises a state decrypted from a vault, pulled from the NAS, adopted
    from a team doc, or read out of a JSON export.

    `settings.plugins` is merged DEEPLY, unlike the rest of settings. The
    shallow spread means an older vault's `plugins` object replaces the seed's
    wholesale, so a newly-added plugin id arrives `undefined` and the plugin
    silently never appears. Merging the seed's defaults underneath fixes that
    for every future plugin, while an id the user explicitly switched off
    stays off — `false` is not `undefined`. */
export function hydrateState(raw: AppState): AppState {
  const seed = seedState();
  const settings = {
    ...seed.settings,
    ...raw.settings,
    plugins: { ...seed.settings.plugins, ...(raw.settings?.plugins ?? {}) },
  };
  /* Todo's landing sub-view used to be spelled into `landingView`
     ("todo/board/gantt"), which only had an effect on launch. It is now
     `todoDefaultView`, honoured by every route into Todo, so an older vault's
     choice is moved across and `landingView` left as the plain plugin id it is
     for every other plugin. Only when the newer field is still at its default
     — a user who has since picked a view keeps it. */
  if (settings.landingView?.startsWith("todo/")) {
    if (settings.todoDefaultView === LAST_VIEW) settings.todoDefaultView = settings.landingView;
    settings.landingView = "todo";
  }
  return {
    ...raw,
    settings,
    tasks: migrateTaskHabits(raw.tasks ?? []),
    sessions: raw.sessions ?? [],
    timer: raw.timer ?? seed.timer,
    quickTimers: raw.quickTimers ?? [],
    books: raw.books ?? [],
    habits: raw.habits ?? [],
  };
}
