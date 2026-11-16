import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations, openDatabase } from "./sqlite-db.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function startFallbackServer({ port }) {
  const dataDir = join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  const database = openDatabase(join(dataDir, "local.sqlite"));
  applyMigrations(database, join(root, "migrations"));
  const sessionSecret = readSecret(join(root, ".dev.vars"));
  const { handleRequest } = await import("../src/app.ts");
  const assets = fileAssets(join(root, "public"));

  const server = createServer(async (incoming, outgoing) => {
    try {
      const host = incoming.headers.host || `127.0.0.1:${port}`;
      const request = await toWebRequest(incoming, host);
      const response = await handleRequest(request, {
        db: database,
        sessionSecret,
        assets,
        uploadsDir: join(root, "public", "uploads"),
      });
      await writeNodeResponse(outgoing, response);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "fallback_request_failed",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
      outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      outgoing.end("Something went wrong.");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve());
  });
  console.log(`Local fallback ready at http://127.0.0.1:${port}`);
  return server;
}

function fileAssets(publicDir) {
  const types = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  return {
    async fetch(request) {
      const name = new URL(request.url).pathname.slice(1);
      if (!/^[a-z0-9.-]+$/.test(name)) return new Response("Not found", { status: 404 });
      const extension = name.slice(name.lastIndexOf("."));
      const file = join(publicDir, name);
      if (!file.startsWith(publicDir) || !existsSync(file)) return new Response("Not found", { status: 404 });
      return new Response(readFileSync(file), {
        headers: {
          "content-type": types[extension] || "application/octet-stream",
          "cache-control": "no-cache",
        },
      });
    },
  };
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

function readBody(incoming) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(chunk));
    incoming.on("end", () => resolve(Buffer.concat(chunks)));
    incoming.on("error", reject);
  });
}

async function toWebRequest(incoming, host) {
  const method = incoming.method || "GET";
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else headers.set(key, value);
  }
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(incoming);
  return new Request(`http://${host}${incoming.url}`, { method, headers, body });
}

async function writeNodeResponse(outgoing, response) {
  const headers = [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    headers.push([key, value]);
  });
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  outgoing.writeHead(response.status, [...headers, ...cookies.map((cookie) => ["set-cookie", cookie])]);
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}
