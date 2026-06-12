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
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      last_seen INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (game_id, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_game_players_game_role_seen
      ON game_players (game_id, role, last_seen);

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

    /* Account system — usernames are case-insensitive (NOCASE collation)
       so "Alice" and "alice" can't both register. password_hash is the
       Bun-bcrypt encoded string (Bun.password.hash). */
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    /* Maps a per-tab session_id (the same one used to claim a Defuser/
       Expert slot) to the signed-in user, if any. A session can be linked
       to at most one user; a user can be linked from many sessions
       (multiple tabs/devices). */
    CREATE TABLE IF NOT EXISTS user_sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
  `);

  return _db;
}
