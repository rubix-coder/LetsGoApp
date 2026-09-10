// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ALERT_SOUNDS, alertChime } from "./sound";

describe("alertChime", () => {
  it("maps every alert-sound choice to a defined pattern", () => {
    for (const a of ALERT_SOUNDS) expect(alertChime(a.id)).toBe(a.chime);
  });

  it("falls back to the chime for an absent or unknown choice", () => {
    expect(alertChime(undefined)).toBe("timer");
    expect(alertChime("nope" as never)).toBe("timer");
  });
});
