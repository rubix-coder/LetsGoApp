import { beforeEach, describe, expect, it, vi } from "vitest";
import { readStickyView, writeStickyView } from "./viewMemory";

const TABS = ["today", "log"] as const;

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe("readStickyView", () => {
  it("returns the fallback when nothing is stored", () => {
    expect(readStickyView("lg:x", TABS, "today")).toBe("today");
  });

  it("returns a stored choice", () => {
    writeStickyView("lg:x", "log");
    expect(readStickyView("lg:x", TABS, "today")).toBe("log");
  });

  it("ignores a stored value that is no longer an offered view", () => {
    localStorage.setItem("lg:x", "archive");
    expect(readStickyView("lg:x", TABS, "today")).toBe("today");
  });

  it("keys are independent — one screen's choice never leaks into another's", () => {
    writeStickyView("lg:a", "log");
    expect(readStickyView("lg:b", TABS, "today")).toBe("today");
  });

  it("takes a lazy fallback, for defaults that depend on the viewport", () => {
    expect(readStickyView("lg:x", TABS, () => "log")).toBe("log");
  });

  it("prefers a stored choice over the lazy fallback, which is never called", () => {
    writeStickyView("lg:x", "today");
    const fallback = vi.fn(() => "log" as const);
    expect(readStickyView("lg:x", TABS, fallback)).toBe("today");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back when localStorage throws, as it does in private-mode Safari", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    });
    // The crash this replaces: the old hand-rolled reads ran inside a useState
    // initialiser, so a throw here took the whole screen down.
    expect(() => readStickyView("lg:x", TABS, "today")).not.toThrow();
    expect(readStickyView("lg:x", TABS, "today")).toBe("today");
    expect(() => writeStickyView("lg:x", "log")).not.toThrow();
  });
});
