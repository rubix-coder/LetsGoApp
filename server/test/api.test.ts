import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/store.ts";

/** A cookie-jar HTTP client so each test actor keeps its own session. */
function makeClient(base: string) {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
    const json = await res.json().catch(() => undefined);
    return { status: res.status, body: json as any };
  };
}

function boot(allowSignup: boolean): { server: Server; base: string } {
  const app = createApp({ db: openDb(":memory:"), allowSignup, secureCookies: false });
  const server = app.listen(0);
  const port = (server.address() as any).port;
  return { server, base: `http://127.0.0.1:${port}` };
}

describe("accounts, RBAC, tenant isolation and doc sync", () => {
  let server: Server, base: string;
  beforeAll(() => { ({ server, base } = boot(true)); });
  afterAll(() => { server.close(); });

  it("runs the full team flow with role enforcement", async () => {
    const owner = makeClient(base);
    const collab = makeClient(base);
    const outsider = makeClient(base);

    // Sign up three users.
    expect((await owner("POST", "/api/auth/signup", { username: "owner", password: "password1" })).status).toBe(200);
    expect((await collab("POST", "/api/auth/signup", { username: "collab", password: "password1" })).status).toBe(200);
    expect((await outsider("POST", "/api/auth/signup", { username: "outsider", password: "password1" })).status).toBe(200);

    // Owner makes a workspace + project (becomes ws admin + project owner).
    const ws = (await owner("POST", "/api/workspaces", { name: "Team" })).body;
    const proj = (await owner("POST", `/api/workspaces/${ws.id}/projects`, { name: "Roadmap" })).body;
    expect(proj.role).toBe("owner");

    // Outsider has their own isolated workspace/project.
    const ws2 = (await outsider("POST", "/api/workspaces", { name: "Solo" })).body;
    await outsider("POST", `/api/workspaces/${ws2.id}/projects`, { name: "Private" });

    // Tenant isolation: outsider cannot see the owner's project at all → 404.
    expect((await outsider("GET", `/api/projects/${proj.id}`)).status).toBe(404);
    expect((await outsider("GET", `/api/projects/${proj.id}/doc`)).status).toBe(404);

    // Invite collaborator as a viewer; they accept.
    const invite = (await owner("POST", `/api/projects/${proj.id}/invites`, { role: "viewer" })).body;
    expect((await collab("POST", `/api/invites/${invite.token}/accept`)).status).toBe(200);
    // Accepting grants workspace membership, so the project is reachable.
    const collabWorkspaces = (await collab("GET", "/api/workspaces")).body;
    expect(collabWorkspaces.map((w: any) => w.id)).toContain(ws.id);
    expect((await collab("GET", `/api/workspaces/${ws.id}/projects`)).body.map((p: any) => p.id)).toContain(proj.id);

    // Viewer can read the doc but not write it.
    const read = await collab("GET", `/api/projects/${proj.id}/doc`);
    expect(read.status).toBe(200);
    expect(read.body.rev).toBe(0);
    expect((await collab("PUT", `/api/projects/${proj.id}/doc`, { baseRev: 0, data: { tasks: [] } })).status).toBe(403);
    // Viewer cannot invite others.
    expect((await collab("POST", `/api/projects/${proj.id}/invites`, { role: "viewer" })).status).toBe(403);

    // Promote to editor → writes now succeed and bump the rev.
    expect((await owner("PATCH", `/api/projects/${proj.id}/members/${(await collab("GET", "/api/auth/me")).body.id}`, { role: "editor" })).status).toBe(200);
    const w1 = await collab("PUT", `/api/projects/${proj.id}/doc`, { baseRev: 0, data: { tasks: [{ id: "t1" }] } });
    expect(w1.status).toBe(200);
    expect(w1.body.rev).toBe(1);

    // Stale write → 409 with the current doc for the client to reconcile.
    const stale = await collab("PUT", `/api/projects/${proj.id}/doc`, { baseRev: 0, data: { tasks: [] } });
    expect(stale.status).toBe(409);
    expect(stale.body.current.rev).toBe(1);

    // Editor still cannot manage members (needs co_admin).
    expect((await collab("POST", `/api/projects/${proj.id}/invites`, { role: "viewer" })).status).toBe(403);

    // logout drops the session.
    await collab("POST", "/api/auth/logout");
    expect((await collab("GET", "/api/auth/me")).status).toBe(401);
  });
});

describe("signup gating and bad credentials", () => {
  let server: Server, base: string;
  beforeAll(() => { ({ server, base } = boot(false)); });
  afterAll(() => { server.close(); });

  it("allows the first user then blocks signups when disabled", async () => {
    const a = makeClient(base);
    const b = makeClient(base);
    expect((await a("POST", "/api/auth/signup", { username: "first", password: "password1" })).status).toBe(200);
    expect((await b("POST", "/api/auth/signup", { username: "second", password: "password1" })).status).toBe(403);
  });

  it("rejects short passwords and wrong credentials", async () => {
    // Password validation runs for the first (always-allowed) user, so use a
    // fresh signups-open instance for that check.
    const fresh = boot(true);
    const v = makeClient(fresh.base);
    expect((await v("POST", "/api/auth/signup", { username: "validuser", password: "short" })).status).toBe(400);
    fresh.server.close();

    const c = makeClient(base);
    expect((await c("POST", "/api/auth/login", { username: "first", password: "nope" })).status).toBe(401);
    expect((await c("POST", "/api/auth/login", { username: "first", password: "password1" })).status).toBe(200);
  });
});

describe("signup via invite while public signup is closed", () => {
  let server: Server, base: string;
  beforeAll(() => { ({ server, base } = boot(false)); });
  afterAll(() => { server.close(); });

  it("admits an invited account (and only an invited one) straight into the project", async () => {
    const admin = makeClient(base);
    const friend = makeClient(base);
    const stranger = makeClient(base);

    // Bootstrap: the very first account is always allowed.
    expect((await admin("POST", "/api/auth/signup", { username: "admin", password: "password1" })).status).toBe(200);
    // Signup is closed for everyone after that.
    expect((await stranger("POST", "/api/auth/signup", { username: "stranger", password: "password1" })).status).toBe(403);
    // A bogus invite does not open the door.
    expect((await stranger("POST", "/api/auth/signup", { username: "stranger", password: "password1", invite: "nope" })).status).toBe(403);

    const ws = (await admin("POST", "/api/workspaces", { name: "Team" })).body;
    const proj = (await admin("POST", `/api/workspaces/${ws.id}/projects`, { name: "Board" })).body;
    const { token } = (await admin("POST", `/api/projects/${proj.id}/invites`, { role: "editor" })).body;

    // A valid invite admits the account AND lands it in the project as editor.
    expect((await friend("POST", "/api/auth/signup", { username: "friend", password: "password1", invite: token })).status).toBe(200);
    const wsList = (await friend("GET", "/api/workspaces")).body;
    expect(wsList).toHaveLength(1);
    const projects = (await friend("GET", `/api/workspaces/${wsList[0].id}/projects`)).body;
    expect(projects[0].role).toBe("editor");

    // The invite is single-use: it cannot admit a second account.
    expect((await stranger("POST", "/api/auth/signup", { username: "stranger", password: "password1", invite: token })).status).toBe(403);
  });
});
