# Contributing to LetsGo

Thanks for taking an interest. LetsGo is a local-first productivity app; the
guiding constraint is that **the app must stay fully usable with no server, no
account and no network**. Please keep that true in anything you add.

## Getting set up

```bash
pnpm install
pnpm dev             # the app at http://localhost:5173
pnpm test            # Vitest (webapp + server)
pnpm build           # static bundle -> webapp/dist/
pnpm test:shell      # builds, then smoke-tests the desktop shell
```

Build the Flatpak (needs the freedesktop 24.08 runtimes — see the README):

```bash
packaging/flatpak/build-flatpak.sh
```

## Ground rules

- **Failing test first.** Every behavior change lands with a test that fails
  before the change and passes after.
- **Surgical diffs.** Change what the task needs; leave unrelated code alone.
- **Self-explanatory naming.** Prefer a longer honest name over a comment.
- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:` …).
- **Bump the version and add a CHANGELOG entry** for any behavior change.
  `webapp/package.json` carries the version the Flatpak is built from; the
  desktop shell's version is synced from it by `build-flatpak.sh`.

## No secrets, ever

This repo ships no credentials, and it should stay that way:

- No API keys, OAuth client IDs, tokens or passwords in tracked files.
- No personal hostnames, tailnet names, LAN IPs or home directory paths.
- No real user data. Exported vaults (`letsgo-export-*.json`) contain
  credentials and personal content — they are git-ignored; keep it that way.

If you add a config knob, give it an **empty default** and document the env var.

## Adding a feature

Every major feature is a plugin. See [`docs/PLUGINS.md`](docs/PLUGINS.md) for
how to register one, where its screen goes, and the rules its data must follow.

## UI work

The design system is the source of truth: read `webapp/src/theme.css` before
writing UI code, and use the existing tokens rather than ad hoc values.
Transitions stay transform/opacity/box-shadow only, under 250 ms, and must
respect `prefers-reduced-motion`.

## License

By contributing you agree that your work is licensed under the
**AGPL-3.0-or-later**, the same license as the project.
