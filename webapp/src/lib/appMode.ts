/* Which shell the app boots into: the private local-vault ("local", the default
   and the original single-user experience) or a signed-in team server ("team").
   Kept outside any vault/document so the App gate can read it before unlocking. */

const MODE_KEY = "letsgo.mode";

export type AppMode = "local" | "team";

export function appMode(): AppMode {
  return localStorage.getItem(MODE_KEY) === "team" ? "team" : "local";
}

export function setAppMode(mode: AppMode): void {
  localStorage.setItem(MODE_KEY, mode);
}

/* An invite token captured from a ?invite=<token> link, waiting for an
   authenticated session to accept it (signup consumes it server-side). */
export const PENDING_INVITE_KEY = "lg:pendingInvite";
