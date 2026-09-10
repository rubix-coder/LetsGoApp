# Plugins

Every major feature in LetsGo is a **plugin**: Todo, Timer, Notes, Mindmap,
Dashboard, Library and Habits. Users turn them on and off and reorder them;
developers add new ones by writing a screen and registering it.

There is no third-party plugin loader — plugins are compiled into the app.
Adding one means forking the repo and adding a screen, which is what this
document covers.

---

## For users: enabling and ordering

**Settings → Plugins.**

- **Toggle** a plugin off and it disappears from the sidebar, the mobile tab
  bar and settings. Its data is kept, not deleted — turning it back on
  restores everything.
- **Drag** the rows to reorder. That order drives the sidebar, the mobile tab
  bar and the settings list together, so what you arrange is what you get
  everywhere.
- **Todo is a core plugin** and cannot be disabled — it owns tasks, which the
  schedule, calendar and timers all read.

Your order and toggles live in the vault, so they follow you to any device you
sync to. If a synced vault mentions a plugin your build does not have, it is
ignored; if your build has one the vault never saw, it is appended at the end.
Nothing breaks in either direction.

---

## For developers: adding a plugin

Three steps. Say you are adding a "Journal" plugin.

### 1. Register it

`webapp/src/lib/types.ts` — add the id to `PluginId`, then add an entry to
`PLUGIN_META`:

```ts
export const PLUGIN_META: { id: PluginId; name: string; desc: string; core?: boolean }[] = [
  { id: "todo", name: "Todo", desc: "Board, schedule & calendar", core: true },
  // …
  { id: "journal", name: "Journal", desc: "A daily writing space" },
];
```

`PLUGIN_META` is the single source of truth. The sidebar, the mobile tab bar
and the settings list all read it, so one entry lights up all three. Mark
`core: true` only if the app genuinely cannot function without it — it removes
the user's ability to turn it off.

**Append, don't insert.** Existing users have a stored order; a new plugin is
appended for them automatically. Reordering `PLUGIN_META` only changes the
default for people who have never dragged a row.

### 2. Build the screen

Add `webapp/src/screens/journal/JournalScreen.tsx`. Use the shared primitives
in `webapp/src/components/ui.tsx` and the design tokens in
`webapp/src/theme.css` rather than ad hoc styles — that is what keeps a new
screen looking native to the app in both light and dark themes.

Then route it in `webapp/src/shell/AppShell.tsx` alongside the other screens.

### 3. Store your data

State lives in the app store (`webapp/src/lib/`), which is serialized into the
**encrypted vault**. Two rules:

- **Add fields, never repurpose them.** A vault written by a newer build gets
  opened by an older one; unknown fields must be survivable.
- **Default every field.** A vault written before your plugin existed has no
  key for it, so read defensively (`state.journal ?? []`).

### Test it

```sh
pnpm test        # add tests beside the code, *.test.ts
pnpm dev
```

Follow the house style in `CONTRIBUTING.md`: a failing test first, surgical
diffs, and a CHANGELOG entry with a version bump.

---

## What a plugin may not do

- **No network calls on the action path.** Anything remote must be optional,
  time-bounded, and degrade to local-only on failure. The app must stay fully
  usable offline with no server configured — that is the product's core
  promise, not a nice-to-have.
- **No plaintext off the device.** Anything synced goes through the encrypted
  vault.
- **No telemetry.** Not optional, not opt-in, not anonymous.
