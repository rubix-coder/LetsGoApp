# Screenshots

These are the store-listing images referenced by
`packaging/flatpak/com.rubixcoder.letsgo.metainfo.xml.in`. Flathub will not
accept the app without at least one, and it loads them over HTTPS from
`raw.githubusercontent.com`, so they must stay committed at these paths.

| File | Shows | Theme |
| --- | --- | --- |
| `board.png` | Todo board, kanban lens | light |
| `schedule.png` | Day schedule, 3-day range | light |
| `timer.png` | Focus timer running, session log | light |
| `dashboard.png` | Day at a glance, focus hours | light |
| `mindmap-dark.png` | Mindmap built from tasks | dark |

All 1547x784 PNG, captured at the demo seed content a fresh vault creates —
**no real user data**. To retake: run `pnpm dev`, open a private window at
`http://localhost:5173`, choose "Skip — open without a passphrase" so the
vault seeds itself, and capture at roughly 1550x785.
