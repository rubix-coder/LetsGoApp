/* Vault crypto: PBKDF2-SHA256 → AES-256-GCM via WebCrypto.
   (The desktop app uses Argon2id + SQLCipher; PBKDF2 is the strongest KDF
   available natively in browsers without shipping WASM.) */

const ITERATIONS = 310_000;

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface VaultPayload {
  salt: string;
  iv: string;
  ct: string;
}

export async function encryptJson(key: CryptoKey, salt: Uint8Array, value: unknown): Promise<VaultPayload> {
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext);
  return { salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

/** Throws on a wrong key (GCM auth failure). */
export async function decryptJson<T>(key: CryptoKey, payload: VaultPayload): Promise<T> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(payload.iv) as BufferSource },
    key,
    fromB64(payload.ct) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

export function payloadSalt(payload: VaultPayload): Uint8Array {
  return fromB64(payload.salt);
}
