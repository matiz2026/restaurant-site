// Password hashing and the staff session cookie.
// Iterations stay modest so a login fits the Workers free-plan CPU budget (10 ms).
// The stored hash records its own iteration count, so older hashes still verify.

export const HASH_ITERATIONS = 20_000;
const SESSION_MS = 1000 * 60 * 60 * 24 * 14;
const SESSION_SKEW_MS = 1000 * 60 * 60 * 24 * 30;
export const SESSION_COOKIE = "matiz_session";

// Used when the username does not exist, so the response takes a similar amount of time.
const DUMMY_HASH =
  "pbkdf2-sha256$20000$0f418b9ac60e702b8be087a812dd39e1$3ba64c16a50626cd3b5abf7f592886935c28169dbfcd76966b9f78be3eada8fc";

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, HASH_ITERATIONS);
  return `pbkdf2-sha256$${HASH_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, roundsText, saltHex, hashHex] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !saltHex || !hashHex) return false;
  const rounds = Number(roundsText);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 200_000) return false;
  const salt = hexToBytes(saltHex);
  if (!salt) return false;
  const actual = await pbkdf2(password, salt, rounds);
  return fixedTimeEqual(bytesToHex(actual), hashHex.toLowerCase());
}

export async function dummyVerify(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
}

async function fixedTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: BufferSource, b: BufferSource) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(leftHash, rightHash);
  }
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

interface SessionPayload {
  u: string;
  exp: number;
}

export async function createSessionCookie(username: string, secret: string, secure: boolean): Promise<string> {
  const payload: SessionPayload = { u: username, exp: Date.now() + SESSION_MS };
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = await sign(secret, body);
  const token = `${body}.${signature}`;
  const secureFlag = secure ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_MS / 1000)}${secureFlag}`;
}

export function clearSessionCookie(secure: boolean): string {
  const secureFlag = secure ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureFlag}`;
}

export async function readSessionUsername(request: Request, secret: string): Promise<string | null> {
  if (secret.length < 32) return null;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const separator = token.indexOf(".");
  if (separator <= 0) return null;
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = await sign(secret, body);
  if (!(await fixedTimeEqual(signature, expected))) return null;
  let payload: SessionPayload;
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(body));
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.u !== "string" || typeof record.exp !== "number") return null;
    payload = { u: record.u, exp: record.exp };
  } catch {
    return null;
  }
  if (!payload.u || payload.exp < Date.now() || payload.exp > Date.now() + SESSION_SKEW_MS) return null;
  return payload.u;
}

export function requestIsSecure(request: Request): boolean {
  const url = new URL(request.url);
  if (url.protocol === "https:") return true;
  const forwarded = request.headers.get("x-forwarded-proto");
  return forwarded?.split(",")[0]?.trim() === "https";
}

async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
