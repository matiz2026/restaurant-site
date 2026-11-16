import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_PHOTO = 2_000_000;

export async function startUploadWriter({ root, port = 4398 } = {}) {
  const dir = join(root, "public", "uploads");
  const token = readSecret(join(root, ".dev.vars"));
  const server = createServer((request, response) => {
    void handle(request, response, dir, token);
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        console.log("Photo upload writer is already running.");
        resolveListen();
        return;
      }
      reject(error);
    });
    server.listen(port, "127.0.0.1", () => {
      console.log(`Photo upload writer ready at http://127.0.0.1:${port}`);
      resolveListen();
    });
  });
  return server;
}

async function handle(request, response, dir, token) {
  const remote = request.socket.remoteAddress || "";
  if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }
  if (!token || request.headers["x-upload-token"] !== token) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }
  if (request.method === "GET" && request.url.startsWith("/uploads/")) {
    await sendStored(response, dir, request.url.slice("/uploads/".length));
    return;
  }
  if (request.method !== "POST" || request.url !== "/photos") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_PHOTO) {
      response.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
      response.end("That photo is too large. Use one under 2 MB.");
      request.resume();
      return;
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const kind = imageKind(bytes);
  if (!kind) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Use a JPEG, PNG, WebP, or GIF.");
    return;
  }
  await mkdir(dir, { recursive: true });
  const filename = `photo-${randomBytes(12).toString("hex")}.${kind === "jpg" ? "jpg" : kind}`;
  const file = resolve(dir, filename);
  const base = resolve(dir);
  if (!file.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("That photo could not be saved.");
    return;
  }
  await writeFile(file, bytes);
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ url: `/uploads/${filename}` }));
}

async function sendStored(response, dir, filename) {
  if (!/^[a-z0-9][a-z0-9.-]*\.(?:jpe?g|png|gif|webp)$/.test(filename)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const file = resolve(dir, filename);
  const base = resolve(dir);
  if (!file.startsWith(base.endsWith(sep) ? base : `${base}${sep}`) || !existsSync(file)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const bytes = await readFile(file);
  const kind = imageKind(bytes);
  const types = { jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
  if (!kind) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": types[kind], "cache-control": "public, max-age=86400" });
  response.end(bytes);
}

function imageKind(bytes) {
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

function readSecret(file) {
  if (!existsSync(file)) return "";
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    if (trimmed.slice(0, separator).trim() === "SESSION_SECRET") return trimmed.slice(separator + 1).trim();
  }
  return "";
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  await startUploadWriter({ root });
}
