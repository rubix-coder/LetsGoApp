// @vitest-environment node
import { describe, expect, it } from "vitest";
import { boardStatus, isRunningLike, nextStatus } from "./status";

describe("nextStatus", () => {
  it("walks the 4-state cycle", () => {
    expect(nextStatus("in_progress")).toBe("done");
    expect(nextStatus("done")).toBe("skipped");
    expect(nextStatus("skipped")).toBe("pending");
    expect(nextStatus("pending")).toBe("in_progress");
  });

  it("resumes a paused task to in progress rather than cycling", () => {
    expect(nextStatus("paused")).toBe("in_progress");
  });
});

describe("boardStatus", () => {
  it("folds paused into the In-progress column, leaves the rest alone", () => {
    expect(boardStatus("paused")).toBe("in_progress");
    expect(boardStatus("pending")).toBe("pending");
    expect(boardStatus("done")).toBe("done");
    expect(boardStatus("skipped")).toBe("skipped");
  });
});

describe("isRunningLike", () => {
  it("is true for started work, active or on hold", () => {
    expect(isRunningLike("in_progress")).toBe(true);
    expect(isRunningLike("paused")).toBe(true);
    expect(isRunningLike("pending")).toBe(false);
    expect(isRunningLike("done")).toBe(false);
  });
});
