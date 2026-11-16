import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function openDatabase(filename) {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec("PRAGMA foreign_keys = ON");

  function statement(sql, params) {
    return {
      bind(...values) {
        return statement(sql, values);
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...params) };
      },
      async first() {
        return sqlite.prepare(sql).get(...params) ?? null;
      },
      async run() {
        const info = sqlite.prepare(sql).run(...params);
        return {
          meta: {
            changes: Number(info.changes),
            last_row_id: Number(info.lastInsertRowid),
          },
        };
      },
      _sql: sql,
      _params: params,
    };
  }

  return {
    sqlite,
    prepare(sql) {
      return statement(sql, []);
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        for (const entry of statements) {
          sqlite.prepare(entry._sql).run(...entry._params);
        }
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export function applyMigrations(database, directory) {
  database.sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const existing = database.sqlite.prepare("SELECT name FROM schema_migrations WHERE name = ?").get(file);
    if (existing) continue;
    const sql = readFileSync(join(directory, file), "utf8");
    database.sqlite.exec("BEGIN");
    try {
      database.sqlite.exec(sql);
      database.sqlite
        .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(file, new Date().toISOString());
      database.sqlite.exec("COMMIT");
    } catch (error) {
      database.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}
