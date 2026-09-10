/* API keys, deliberately kept out of the vault.

   `GoogleAccount` in types.ts states the rule plainly — "the synced vault
   never carries a credential" — and that holds here too. A key written into
   `AppState` would be encrypted at rest, but it would also be pushed to the
   NAS, pulled onto every other device, and included in the plain-JSON export
   from Settings. None of that is appropriate for a credential.

   localStorage rather than sessionStorage, which is where the Google OAuth
   tokens live: those expire in an hour and are re-obtainable silently, while
   these are typed by hand and must survive a reload. The cost is entering
   them once per device, which is the honest trade. */

const GOOGLE_BOOKS_KEY = "lg:googleBooksKey";
const CLAUDE_KEY = "lg:claudeKey";

function read(key: string): string {
  try {
    return localStorage.getItem(key)?.trim() ?? "";
  } catch {
    // Private-mode Safari throws on localStorage access rather than returning
    // null. No key simply means the feature is off.
    return "";
  }
}

function write(key: string, value: string): void {
  try {
    const trimmed = value.trim();
    if (trimmed) localStorage.setItem(key, trimmed);
    else localStorage.removeItem(key);
  } catch {
    /* nothing to do — the caller's next read reports it as unset */
  }
}

/** Google Books. A browser key, meant to be referrer-restricted rather than
    secret, but still a credential and still not vault material. */
export function googleBooksKey(): string { return read(GOOGLE_BOOKS_KEY); }
export function setGoogleBooksKey(value: string): void { write(GOOGLE_BOOKS_KEY, value); }

/** Anthropic. This one IS secret — it bills the user's account — so it never
    leaves the device it was typed on. */
export function claudeKey(): string { return read(CLAUDE_KEY); }
export function setClaudeKey(value: string): void { write(CLAUDE_KEY, value); }

/** Shows only enough to confirm which key is stored, never the whole thing.
    Settings has to be safe to screen-share. */
export function maskKey(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
