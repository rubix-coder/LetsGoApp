/* Binds a surface's panel arrangement to the vault.

   Layouts live in `settings.panelLayouts[surface]`, so they ride the existing
   encrypted vault and its NAS/team sync like every other preference — the
   dashboard you build on the desktop app is the dashboard you get in the
   browser. Nothing here is a new persistence mechanism.

   The saved value is always run through resolveLayout before use, never
   trusted as-is: panels come and go with plugins and data, and a stale entry
   must never decide what renders. */

import { useCallback } from "react";
import { useStore } from "./store";
import { isDefaultLayout, resolveLayout, type PanelDef, type PanelSpan } from "./panelLayout";

export interface PanelLayoutHandle {
  layout: PanelSpan[];
  setLayout: (next: PanelSpan[]) => void;
  /** Forget this surface's arrangement and fall back to the shipped one. */
  reset: () => void;
  /** True while the surface still looks the way it ships — the Reset
      affordance is noise until something has actually been moved. */
  isDefault: boolean;
}

export function usePanelLayout(
  surface: string,
  defs: readonly PanelDef[],
  cols: number,
): PanelLayoutHandle {
  const { state, dispatch } = useStore();
  const saved = state.settings.panelLayouts?.[surface];
  const layout = resolveLayout(defs, saved, cols);

  const setLayout = useCallback((next: PanelSpan[]) => {
    dispatch({
      type: "setSettings",
      patch: { panelLayouts: { ...state.settings.panelLayouts, [surface]: next } },
    });
  }, [dispatch, state.settings.panelLayouts, surface]);

  const reset = useCallback(() => {
    const rest = { ...state.settings.panelLayouts };
    // Delete rather than write the default back: a surface with no saved
    // layout keeps following its shipped one as panels are added later.
    delete rest[surface];
    dispatch({ type: "setSettings", patch: { panelLayouts: rest } });
  }, [dispatch, state.settings.panelLayouts, surface]);

  return { layout, setLayout, reset, isDefault: isDefaultLayout(layout, defs, cols) };
}
