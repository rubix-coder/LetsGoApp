/* Backend-less Google auth: the token now survives a browser restart (moved
   from sessionStorage to localStorage, dead tokens still pruned on load), and a
   failed silent renewal buys a cooldown so a dead Google session can't make
   every background sync hammer GIS. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CID = "client-1";
const account = { id: "acc1", email: "me@gmail.com" };
const STORE_KEY = "letsgo.googleTokens";

/** Stand in for the GIS token client. "grant" resolves a fresh unique token;
    "deny" fails the callback the way an expired session does. */
function stubGis(mode: "grant" | "deny") {
  let n = 0;
  const initTokenClient = vi.fn((cfg: { callback: (r: unknown) => void }) => ({
    requestAccessToken: () =>
      mode === "grant"
        ? cfg.callback({ access_token: `tok-${++n}`, expires_in: 3600 })
        : cfg.callback({ error: "access_denied" }),
  }));
  (window as unknown as { google: unknown }).google = {
    accounts: { oauth2: { initTokenClient, revoke: vi.fn() } },
  };
  return initTokenClient;
}

async function freshModule() {
  vi.resetModules();
  return import("./gcalAuth");
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // identify() calls the userinfo endpoint — always the account we asked for.
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ sub: "acc1", email: "me@gmail.com" }),
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { google?: unknown }).google;
});

describe("gcalAuth token persistence", () => {
  it("writes a renewed token to localStorage so it survives a restart", async () => {
    const mod = await freshModule();
    stubGis("grant");
    const token = await mod.accessTokenFor(CID, account, { silent: true });

    expect(token).toMatch(/^tok-/);
    const stored = JSON.parse(localStorage.getItem(STORE_KEY)!);
    expect(stored.acc1.accessToken).toBe(token);
  });

  it("restores a still-live token from localStorage without calling Google", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      acc1: { accessToken: "still-good", expiresAt: Date.now() + 600_000 },
    }));
    const mod = await freshModule();
    const init = stubGis("grant");

    expect(await mod.accessTokenFor(CID, account, { silent: true })).toBe("still-good");
    expect(init).not.toHaveBeenCalled();
  });

  it("discards an expired token and renews instead", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      acc1: { accessToken: "stale", expiresAt: Date.now() - 1_000 },
    }));
    const mod = await freshModule();
    stubGis("grant");

    const token = await mod.accessTokenFor(CID, account, { silent: true });
    expect(token).not.toBe("stale");
    expect(token).toMatch(/^tok-/);
  });

  it("adopts a token left in sessionStorage by a pre-upgrade session", async () => {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({
      acc1: { accessToken: "from-session", expiresAt: Date.now() + 600_000 },
    }));
    const mod = await freshModule();
    const init = stubGis("grant");

    expect(await mod.accessTokenFor(CID, account, { silent: true })).toBe("from-session");
    expect(init).not.toHaveBeenCalled();
    // and it is re-persisted to localStorage, so the next restart finds it there
    expect(JSON.parse(localStorage.getItem(STORE_KEY)!).acc1.accessToken).toBe("from-session");
  });
});

describe("gcalAuth silent-renewal cooldown", () => {
  it("stops hitting Google for the cooldown after a silent failure", async () => {
    const mod = await freshModule();
    const init = stubGis("deny");

    await expect(mod.accessTokenFor(CID, account, { silent: true })).rejects.toBeInstanceOf(mod.NeedsConsentError);
    await expect(mod.accessTokenFor(CID, account, { silent: true })).rejects.toBeInstanceOf(mod.NeedsConsentError);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("forgetGoogleToken clears the cooldown so a later attempt runs", async () => {
    const mod = await freshModule();
    const denied = stubGis("deny");
    await expect(mod.accessTokenFor(CID, account, { silent: true })).rejects.toBeInstanceOf(mod.NeedsConsentError);
    expect(denied).toHaveBeenCalledTimes(1);

    mod.forgetGoogleToken("acc1");
    const granted = stubGis("grant");
    expect(await mod.accessTokenFor(CID, account, { silent: true })).toMatch(/^tok-/);
    expect(granted).toHaveBeenCalledTimes(1);
  });

  it("a background caller with neither flag never touches GIS", async () => {
    const mod = await freshModule();
    const init = stubGis("grant");
    await expect(mod.accessTokenFor(CID, account)).rejects.toBeInstanceOf(mod.NeedsConsentError);
    expect(init).not.toHaveBeenCalled();
  });
});
