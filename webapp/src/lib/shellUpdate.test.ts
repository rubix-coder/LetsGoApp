// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  POSTPONE_MS,
  applyShellUpdate,
  clearPostpone,
  fetchShellUpdate,
  postponeUpdate,
  postponedUntil,
} from "./shellUpdate";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; type?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: () => init.type ?? "application/json" },
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchShellUpdate", () => {
  it("reads the shell's answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      supported: true, available: true, restartOnly: true, progress: null,
    })));
    expect(await fetchShellUpdate()).toEqual({
      supported: true, available: true, restartOnly: true, progress: null,
    });
  });

  it("is silent in a browser, where the route 404s", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, { ok: false, status: 404 })));
    expect(await fetchShellUpdate()).toBeNull();
  });

  it("is silent when the SPA fallback answers with index.html", async () => {
    // A dev server (and the shell's own static handler) serves index.html for
    // unknown paths — a 200 that is emphatically not an update report.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse("<!doctype html>", { type: "text/html" })));
    expect(await fetchShellUpdate()).toBeNull();
  });

  it("is silent when the answer is JSON but not an update report", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ hello: "world" })));
    expect(await fetchShellUpdate()).toBeNull();
  });

  it("is silent when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await fetchShellUpdate()).toBeNull();
  });
});

describe("applyShellUpdate", () => {
  it("posts and reports success", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await applyShellUpdate()).toEqual({ ok: true, error: undefined });
    expect(fetchMock).toHaveBeenCalledWith("/__shell/update", { method: "POST" });
  });

  it("passes the shell's own reason through on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(
      { ok: false, error: "Only the focused app is allowed to show a system access dialog" },
      { ok: false, status: 500 },
    )));
    const result = await applyShellUpdate();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/focused app/);
  });

  it("survives the window going away mid-request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network error"); }));
    expect(await applyShellUpdate()).toEqual({ ok: false, error: "network error" });
  });
});

describe("postpone", () => {
  it("holds for the postpone window and then lapses", () => {
    const now = 1_700_000_000_000;
    postponeUpdate(now);
    expect(postponedUntil(now)).toBe(now + POSTPONE_MS);
    expect(postponedUntil(now + POSTPONE_MS - 1)).toBe(now + POSTPONE_MS);
    expect(postponedUntil(now + POSTPONE_MS)).toBe(0);
  });

  it("reads as not postponed when nothing is stored", () => {
    expect(postponedUntil()).toBe(0);
  });

  it("clears on demand, so a restarted app is not still snoozed", () => {
    const now = 1_700_000_000_000;
    postponeUpdate(now);
    clearPostpone();
    expect(postponedUntil(now)).toBe(0);
  });

  it("treats junk in storage as not postponed", () => {
    localStorage.setItem("letsgo.update.postponedUntil", "soon-ish");
    expect(postponedUntil()).toBe(0);
  });
});
