import { Database } from "bun:sqlite";
import { join } from "path";

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;

  const dbPath = process.env.DB_PATH ?? join(process.cwd(), "bigboom.db");
  _db = new Database(dbPath, { create: true });
  _db.exec("PRAGMA journal_mode=WAL;");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      seed INTEGER NOT NULL,
      serial_number TEXT NOT NULL,
      status TEXT DEFAULT 'waiting',
      timer_seconds INTEGER DEFAULT 300,
      started_at INTEGER,
      strikes INTEGER DEFAULT 0,
      max_strikes INTEGER DEFAULT 3,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS game_players (
      game_id TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (game_id, role)
    );

    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      type TEXT NOT NULL,
      position INTEGER NOT NULL,
      config_json TEXT NOT NULL,
      state_json TEXT DEFAULT '{}',
      solved INTEGER DEFAULT 0,
      struck INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS exchanges (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      module_id TEXT NOT NULL,
      step TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  return _db;
}
