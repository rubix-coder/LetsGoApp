// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decryptJson, deriveKey, encryptJson, payloadSalt, randomBytes } from "./crypto";

describe("vault crypto", () => {
  it("round-trips a JSON value under the derived key", async () => {
    const salt = randomBytes(16);
    const key = await deriveKey("correct horse battery", salt);
    const value = { tasks: [{ id: "t1", title: "Draft Q3 roadmap" }], n: 42 };
    const payload = await encryptJson(key, salt, value);
    expect(payloadSalt(payload)).toEqual(salt);
    await expect(decryptJson(key, payload)).resolves.toEqual(value);
  });

  it("rejects a wrong passphrase (GCM auth failure)", async () => {
    const salt = randomBytes(16);
    const good = await deriveKey("right", salt);
    const bad = await deriveKey("wrong", salt);
    const payload = await encryptJson(good, salt, { secret: true });
    await expect(decryptJson(bad, payload)).rejects.toThrow();
  });

  it("produces a fresh IV per encryption", async () => {
    const salt = randomBytes(16);
    const key = await deriveKey("pass", salt);
    const a = await encryptJson(key, salt, "x");
    const b = await encryptJson(key, salt, "x");
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ct).not.toEqual(b.ct);
  });
});
