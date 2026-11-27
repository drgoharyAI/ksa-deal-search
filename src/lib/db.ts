import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncT } from "node:sqlite";

/**
 * Local SQLite store for search history and price alerts (node:sqlite, no native dependency).
 * Nothing touches the file system at import time: the path is resolved and the file opened on
 * the first getDb() call. File: DEAL_SEARCH_DB, else %LOCALAPPDATA%\deal-search\data.db, else
 * ~/.local/share/deal-search/data.db (os.homedir fallback).
 */
export type Db = DatabaseSyncT;

export function dbPath(env: Record<string, string | undefined> = process.env): string {
  if (env.DEAL_SEARCH_DB?.trim()) return path.resolve(env.DEAL_SEARCH_DB.trim());
  const base = env.LOCALAPPDATA?.trim() || path.join(os.homedir(), ".local", "share");
  return path.join(base, "deal-search", "data.db");
}

type SqliteModule = typeof import("node:sqlite");

/**
 * Loads node:sqlite. Some Node versions print an ExperimentalWarning for it; only that one
 * warning is dropped, every other warning still goes through.
 */
function loadSqlite(): SqliteModule {
  const orig = process.emitWarning;
  process.emitWarning = function (this: unknown, warning: string | Error, ...rest: unknown[]) {
    const msg = typeof warning === "string" ? warning : warning?.message;
    const type = typeof rest[0] === "string" ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
    const name = typeof warning === "object" ? warning?.name : undefined;
    if ((type === "ExperimentalWarning" || name === "ExperimentalWarning") && /sqlite/i.test(msg ?? "")) return;
    return (orig as (...a: unknown[]) => void).call(process, warning, ...rest);
  } as typeof process.emitWarning;
  try {
    return process.getBuiltinModule("node:sqlite") as SqliteModule;
  } finally {
    process.emitWarning = orig;
  }
}

/** Ordered schema migrations; each runs once, in a transaction, and bumps schema_version. */
const MIGRATIONS: string[] = [
  `CREATE TABLE searches (
     id INTEGER PRIMARY KEY,
     at INTEGER NOT NULL,
     query TEXT NOT NULL,
     sites TEXT NOT NULL,
     sort TEXT NOT NULL,
     filters TEXT NOT NULL,
     resultCount INTEGER NOT NULL,
     cheapest TEXT
   );
   CREATE INDEX searches_at ON searches(at);
   CREATE TABLE watches (
     id INTEGER PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('product', 'search')),
     site TEXT,
     productId TEXT,
     query TEXT NOT NULL,
     sites TEXT NOT NULL,
     target REAL NOT NULL,
     status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
     lastFiredPrice REAL,
     title TEXT,
     url TEXT,
     image TEXT,
     currency TEXT NOT NULL DEFAULT 'SAR',
     createdAt INTEGER NOT NULL,
     lastCheckedAt INTEGER,
     lastPrice REAL,
     lastCheckStatus TEXT
   );
   CREATE TABLE price_points (
     id INTEGER PRIMARY KEY,
     watchId INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
     at INTEGER NOT NULL,
     price REAL NOT NULL,
     url TEXT,
     title TEXT
   );
   CREATE INDEX price_points_watch ON price_points(watchId, at);
   CREATE TABLE alert_events (
     id INTEGER PRIMARY KEY,
     watchId INTEGER REFERENCES watches(id) ON DELETE SET NULL,
     at INTEGER NOT NULL,
     title TEXT NOT NULL,
     site TEXT NOT NULL,
     oldPrice REAL,
     newPrice REAL NOT NULL,
     target REAL NOT NULL,
     currency TEXT NOT NULL DEFAULT 'SAR',
     url TEXT,
     sent INTEGER NOT NULL DEFAULT 0,
     seen INTEGER NOT NULL DEFAULT 0
   );`,
  // 2: price observations from every search (deal badges and trends, src/lib/insights.ts).
  `CREATE TABLE observations (
     id INTEGER PRIMARY KEY,
     site TEXT NOT NULL,
     productId TEXT NOT NULL,
     price REAL NOT NULL,
     origPrice REAL,
     at INTEGER NOT NULL
   );
   CREATE INDEX observations_item ON observations(site, productId, at);
   CREATE INDEX observations_at ON observations(at);`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(db: Db): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  let version = row?.version ?? 0;
  while (version < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]);
      version += 1;
      db.prepare("UPDATE schema_version SET version = ?").run(version);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

/** Opens (creating the folder and file if needed) and migrates a database file. */
export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 3000");
  migrate(db);
  return db;
}

const g = globalThis as unknown as { __dealSearchDb?: Db; __dealSearchDbSchema?: number };

/**
 * The app's database, opened on first use and shared across hot reloads. A handle opened by
 * older code (a hot reload that added a migration) is migrated before use.
 */
export function getDb(): Db {
  if (!g.__dealSearchDb) g.__dealSearchDb = openDb(dbPath());
  else if (g.__dealSearchDbSchema !== SCHEMA_VERSION) migrate(g.__dealSearchDb);
  g.__dealSearchDbSchema = SCHEMA_VERSION;
  return g.__dealSearchDb;
}
