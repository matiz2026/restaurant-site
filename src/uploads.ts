import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export type ImageKind = "jpg" | "png" | "gif" | "webp";

const TYPES: Record<ImageKind, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

const FILE_NAME = /^[a-z0-9][a-z0-9.-]*\.(?:jpe?g|png|gif|webp)$/;

export function defaultUploadsDir(): string {
  try {
    const starts = [cwd()];
    const metaUrl = import.meta.url;
    if (typeof metaUrl === "string" && metaUrl.startsWith("file:")) {
      starts.push(dirname(decodeURIComponent(new URL(metaUrl).pathname)));
    }
    for (const start of starts) {
      let dir = resolve(start);
      for (let depth = 0; depth < 8; depth += 1) {
        if (safeExists(join(dir, "wrangler.jsonc")) && safeExists(join(dir, "public"))) {
          return join(dir, "public", "uploads");
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
  } catch {
    // The directory lookup can fail in a runtime without a real filesystem.
  }
  return join(cwd(), "public", "uploads");
}

export function imageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

const UPLOAD_WRITER = "http://127.0.0.1:4398/photos";

export async function savePhotoLocally(bytes: Uint8Array, secret: string): Promise<string | null> {
  try {
    const response = await fetch(UPLOAD_WRITER, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-upload-token": secret,
      },
      body: bytes,
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return null;
    const url = (payload as { url?: unknown }).url;
    if (typeof url !== "string" || !/^\/uploads\/[a-z0-9][a-z0-9.-]*\.(?:jpe?g|png|gif|webp)$/.test(url)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export async function savePhoto(dir: string, bytes: Uint8Array, kind: ImageKind): Promise<string> {
  const filename = `photo-${randomId()}.${kind === "jpg" ? "jpg" : kind}`;
  await mkdir(dir, { recursive: true });
  const file = resolve(dir, filename);
  if (!isInside(dir, file)) throw new Error("upload path escaped");
  await writeFile(file, bytes);
  return `/uploads/${filename}`;
}

export async function readPhoto(
  dir: string,
  pathname: string,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  const filename = pathname.startsWith("/uploads/") ? pathname.slice("/uploads/".length) : "";
  if (!FILE_NAME.test(filename)) return null;
  const file = resolve(dir, filename);
  if (!isInside(dir, file) || !existsSync(file)) return null;
  const bytes = new Uint8Array(await readFile(file));
  const kind = imageKind(bytes);
  if (!kind) return null;
  return { bytes, type: TYPES[kind] };
}

function isInside(root: string, file: string): boolean {
  const base = resolve(root);
  const target = resolve(file);
  return target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function cwd(): string {
  try {
    const proc = (globalThis as { process?: { cwd?: () => string } }).process;
    const dir = proc?.cwd?.();
    return dir || ".";
  } catch {
    return ".";
  }
}
