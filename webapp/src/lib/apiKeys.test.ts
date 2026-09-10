// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { claudeKey, googleBooksKey, maskKey, setClaudeKey, setGoogleBooksKey } from "./apiKeys";

// A node environment has no localStorage; a Map-backed stand-in is enough to
// assert the read/write/trim contract.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
});

describe("api keys", () => {
  it("round-trips each key independently", () => {
    setGoogleBooksKey("AIzaGOOGLE");
    setClaudeKey("sk-ant-CLAUDE");
    expect(googleBooksKey()).toBe("AIzaGOOGLE");
    expect(claudeKey()).toBe("sk-ant-CLAUDE");
  });

  it("is empty when nothing is stored", () => {
    expect(googleBooksKey()).toBe("");
    expect(claudeKey()).toBe("");
  });

  it("trims what is typed, since a pasted key often carries whitespace", () => {
    setGoogleBooksKey("  AIzaX  ");
    expect(googleBooksKey()).toBe("AIzaX");
  });

  it("clearing the field removes the key rather than storing blanks", () => {
    setClaudeKey("sk-ant-X");
    setClaudeKey("   ");
    expect(claudeKey()).toBe("");
    expect(localStorage.getItem("lg:claudeKey")).toBe(null);
  });

  it("survives localStorage throwing, as it does in private-mode Safari", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    });
    expect(() => setClaudeKey("x")).not.toThrow();
    // No key simply means the feature stays off.
    expect(claudeKey()).toBe("");
  });
});

describe("maskKey", () => {
  it("shows only the ends of a long key", () => {
    expect(maskKey("sk-ant-abcdefghijkl")).toBe("sk-a…ijkl");
  });

  it("hides a short key entirely rather than revealing most of it", () => {
    expect(maskKey("short")).toBe("••••");
  });

  it("is empty for no key", () => {
    expect(maskKey("")).toBe("");
  });
});
