// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decideSync, payloadStamp, newStamp, type SyncedPayload } from "./sync";

const blob = (
  stamp: string,
  { rev = 1, savedAt = 0, device = "other" } = {},
): SyncedPayload => ({ salt: "s", iv: "i", ct: "c", rev, savedAt, device, stamp });

describe("payloadStamp", () => {
  it("falls back to a DEVICE-SCOPED triple for pre-stamp blobs", () => {
    const legacyA = { salt: "s", iv: "i", ct: "c", rev: 11, savedAt: 500, device: "phone" };
    const legacyB = { salt: "s", iv: "i", ct: "c", rev: 11, savedAt: 500, device: "desktop" };
    // Same rev, different writer — must NOT read as the same save.
    expect(payloadStamp(legacyA)).not.toBe(payloadStamp(legacyB));
  });

  it("mints unique stamps", () => {
    expect(newStamp("dev")).not.toBe(newStamp("dev"));
  });
});

describe("decideSync", () => {
  it("no remote vault yet → push ours", () => {
    expect(decideSync(undefined, blob("a"), null).action).toBe("push");
  });

  it("identical save on both sides → noop", () => {
    expect(decideSync(blob("a"), blob("a"), "a").action).toBe("noop");
    // …even if this device has no record of ever syncing.
    expect(decideSync(blob("a"), blob("a"), null).action).toBe("noop");
  });

  it("only we moved → push", () => {
    expect(decideSync(blob("agreed"), blob("local-new"), "agreed").action).toBe("push");
  });

  it("only they moved → fast-forward pull", () => {
    expect(decideSync(blob("remote-new"), blob("agreed"), "agreed").action).toBe("pull");
  });

  it("both moved → conflict, newer wall-clock wins", () => {
    expect(decideSync(blob("r", { savedAt: 2000 }), blob("l", { savedAt: 1000 }), "agreed"))
      .toMatchObject({ action: "conflict", winner: "remote" });
    expect(decideSync(blob("r", { savedAt: 1000 }), blob("l", { savedAt: 2000 }), "agreed"))
      .toMatchObject({ action: "conflict", winner: "local" });
  });

  // The bug this lineage scheme exists to kill: two devices edit offline and
  // independently increment to the SAME rev. Rev comparison called that "already
  // in sync" on one side and "we're ahead, push" on the other, so the phone kept
  // its copy forever, the desktop overwrote the shared one, and BOTH reported a
  // clean sync. Distinct stamps make it the conflict it always was.
  it("same rev on both devices with different content is NOT treated as synced", () => {
    const phoneEdit = blob("phone-11", { rev: 11, savedAt: 2000, device: "phone" });
    const desktopEdit = blob("desktop-11", { rev: 11, savedAt: 1000, device: "desktop" });

    // Desktop's view: it had agreed at rev 10, then both sides moved to rev 11.
    const onDesktop = decideSync(phoneEdit, desktopEdit, "agreed-10");
    expect(onDesktop).toMatchObject({ action: "conflict", winner: "remote" });

    // Phone's view: it pushed rev 11, so the remote IS its own save → noop is
    // correct here, and it keeps the data the desktop must now adopt.
    expect(decideSync(phoneEdit, phoneEdit, "phone-11").action).toBe("noop");
  });

  it("a device that never synced adopts the newer side rather than silently keeping its own", () => {
    const remoteNewer = blob("r", { savedAt: 9000 });
    const localOlder = blob("l", { savedAt: 1000 });
    expect(decideSync(remoteNewer, localOlder, null)).toMatchObject({ action: "conflict", winner: "remote" });
  });
});
