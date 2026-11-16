import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "../src/auth.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const bytes = randomBytes(12);
let body = "";
for (const byte of bytes) body += alphabet[byte % alphabet.length];
const password = `Matiz-${body}`;
const hash = await hashPassword(password);
const updatedAt = new Date().toISOString();
const sql = `UPDATE admin_users SET password_hash = '${hash}', updated_at = '${updatedAt}' WHERE username = 'matiz'`;

let updated = false;
const fallbackFile = join(root, "data", "local.sqlite");
if (existsSync(fallbackFile)) {
  const database = new DatabaseSync(fallbackFile);
  const info = database.prepare(sql).run();
  database.close();
  if (Number(info.changes) > 0) {
    updated = true;
    console.log("Updated the local fallback database.");
  }
}

const wrangler = join(root, "node_modules", ".bin", "wrangler");
const worker = spawn(wrangler, ["d1", "execute", "matiz", "--local", "--command", sql], {
  cwd: root,
  env: { ...process.env, CI: "true" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
worker.stdout.on("data", (chunk) => {
  output += chunk;
});
worker.stderr.on("data", (chunk) => {
  output += chunk;
});
const code = await new Promise((resolve) => worker.on("exit", resolve));
if (code === 0 && !/error/i.test(output)) {
  updated = true;
  console.log("Updated the local Wrangler D1 database.");
} else {
  console.log("The local Wrangler D1 database was not updated. Start the site once if you have not yet.");
}

if (!updated) {
  console.error("No local staff login was updated. Run npm run dev once, then try again.");
  process.exit(1);
}

console.log("New admin password for username matiz:");
console.log(password);
