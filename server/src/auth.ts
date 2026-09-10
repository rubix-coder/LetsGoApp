/* Password hashing (scrypt) and session cookie handling — Node crypto only. */

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const N = 16384, r = 8, p = 1, KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const got = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N, r, p });
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export const SESSION_COOKIE = "letsgo_sid";
export const SESSION_TTL_MS = 30 * 86_400_000; // 30 days

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function sessionCookie(sid: string, secure: boolean): string {
  const flags = ["HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${SESSION_TTL_MS / 1000}`];
  if (secure) flags.push("Secure");
  return `${SESSION_COOKIE}=${sid}; ${flags.join("; ")}`;
}

export function clearCookie(secure: boolean): string {
  const flags = ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (secure) flags.push("Secure");
  return `${SESSION_COOKIE}=; ${flags.join("; ")}`;
}
