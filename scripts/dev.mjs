import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFallbackServer } from "./local-server.mjs";
import { startUploadWriter } from "./upload-writer.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4327;
const mode = process.argv.includes("--fallback") ? "fallback" : process.argv.includes("--worker") ? "worker" : "auto";

ensureSecret();
await startUploadWriter({ root });

if (mode === "fallback") {
  await startFallbackServer({ port });
} else {
  const started = await startWorker();
  if (!started && mode === "auto") {
    console.log("Wrangler did not start. Using the local SQLite fallback instead.");
    await startFallbackServer({ port });
  }
  if (!started && mode === "worker") process.exit(1);
}

function ensureSecret() {
  const file = join(root, ".dev.vars");
  if (existsSync(file)) return;
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, `SESSION_SECRET=${secret}\n`);
  console.log("Created .dev.vars with a local SESSION_SECRET.");
}

async function startWorker() {
  const wrangler = join(root, "node_modules", ".bin", "wrangler");
  const migrated = await run(wrangler, ["d1", "migrations", "apply", "matiz", "--local"], { CI: "true" });
  if (migrated.code !== 0) {
    console.error("Local D1 migrations did not apply.");
    return false;
  }
  const child = spawn(
    wrangler,
    [
      "dev",
      "--port",
      String(port),
      "--ip",
      "0.0.0.0",
      "--local",
      "--inspector-port",
      "9237",
      "--show-interactive-dev-session=false",
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let settled = false;
  const ready = new Promise((resolve) => {
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.on("exit", () => finish(false));
    const timer = setTimeout(() => finish(false), 90_000);
    const watch = () => {
      fetch(`http://127.0.0.1:${port}/`)
        .then((response) => {
          if (response.ok) {
            clearTimeout(timer);
            finish(true);
          }
        })
        .catch(() => {});
    };
    const poll = setInterval(() => {
      if (settled) {
        clearInterval(poll);
        return;
      }
      watch();
    }, 400);
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const ok = await ready;
  if (!ok) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    return false;
  }
  const stop = () => child.kill("SIGTERM");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise((resolve) => child.on("exit", resolve));
  return true;
}

function run(command, args, extraEnv) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.stdin.write("y\n");
    child.stdin.end();
    child.on("exit", (code) => resolve({ code: code ?? 1, output }));
  });
}
