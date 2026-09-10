# LetsGo team backend

Optional server that turns LetsGo from a solo, local-first app into a
**multi-user, multi-workspace** one with accounts and per-project roles. The
webapp keeps working fully offline in "local vault" mode; "team" mode points it
at this server.

Built on **Node built-ins only** — `node:sqlite`, `node:crypto` (scrypt password
hashing), and the `http` server — run with `tsx`. No native modules, no compile
step, so it runs anywhere Node 22 does.

## Run (dev)

```sh
cd server
NODE_OPTIONS=--experimental-sqlite ALLOW_SIGNUP=true PORT=8787 npx tsx src/main.ts
# or, from a workspace with deps installed:  pnpm --filter letsgo-server dev
```

`node:sqlite` is behind `--experimental-sqlite` on Node 22 (already in the npm
scripts).

## Test

```sh
cd server && pnpm test          # vitest: auth, RBAC matrix, tenant isolation, sync conflict
```

## Deploy (self-host)

```sh
docker compose -f packaging/docker-compose.yml up -d --build
```

Data lives in the `letsgo-data` volume (`/data/letsgo.db`).

## Config (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | Listen port |
| `DB_PATH` | `:memory:` (dev) / `/data/letsgo.db` (docker) | SQLite file |
| `ALLOW_SIGNUP` | `false` | Open self-serve sign-up. The **first** account is always allowed so an admin can bootstrap; after that, new accounts need this on (or an invite). |
| `NODE_ENV` | — | `production` sets the `Secure` cookie flag (serve over HTTPS) |

## Model

- **users** → **workspaces** (the tenant boundary) → **projects** → a single
  `AppState` **document** per project, revved for optimistic sync.
- **Project roles**: `viewer` (read), `editor` (read + edit the doc),
  `co_admin` (+ manage members/invites), `owner` (full). A **workspace admin**
  has owner power over every project in the workspace.
- Accepting a project invite also grants workspace membership so the project is
  reachable.

## API (all JSON, session cookie auth)

- `POST /api/auth/signup` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`
- `GET|POST /api/workspaces` · `GET|POST /api/workspaces/:wid/projects`
- `GET /api/projects/:id` · `GET /api/projects/:id/members`
- `POST /api/projects/:id/invites` · `POST /api/invites/:token/accept`
- `PATCH|DELETE /api/projects/:id/members/:userId`
- `GET /api/projects/:id/doc` · `PUT /api/projects/:id/doc` (`{ baseRev, data }`; `409` with the current doc on a stale write)

Tenant isolation: a project you can't access returns `404`, never leaking its
existence.
