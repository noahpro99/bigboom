import { createServerFn } from "@tanstack/react-start";
import { nanoid } from "nanoid";
import { getDb } from "../lib/db";

export interface PublicUser {
  id: string;
  username: string;
  createdAt: number;
}

/* Username rules — lowercase letters/digits/underscores, 3-20 chars.
   Display can be mixed-case but uniqueness is COLLATE NOCASE. */
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const PASSWORD_MIN = 6;

function row2user(row: { id: string; username: string; created_at: number } | null): PublicUser | null {
  if (!row) return null;
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

export const signup = createServerFn({ method: "POST" })
  .validator(
    (data: { sessionId: string; username: string; password: string }) => data
  )
  .handler(async ({ data }) => {
    const username = data.username.trim();
    if (!USERNAME_RE.test(username)) {
      return {
        ok: false as const,
        error: "Username must be 3-20 letters, numbers, or underscores.",
      };
    }
    if (data.password.length < PASSWORD_MIN) {
      return {
        ok: false as const,
        error: `Password must be at least ${PASSWORD_MIN} characters.`,
      };
    }
    const db = getDb();
    const existing = db
      .query("SELECT 1 FROM users WHERE username = ?")
      .get(username);
    if (existing) {
      return { ok: false as const, error: "That username is taken." };
    }

    const id = nanoid();
    const hash = await Bun.password.hash(data.password, {
      algorithm: "bcrypt",
      cost: 10,
    });
    db.run(
      "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
      [id, username, hash]
    );
    /* Link the current browser-tab session to the new user (UPSERT in case
       this tab was previously logged in to someone else). */
    db.run(
      `INSERT INTO user_sessions (session_id, user_id) VALUES (?, ?)
       ON CONFLICT(session_id) DO UPDATE SET user_id = excluded.user_id`,
      [data.sessionId, id]
    );

    const row = db
      .query("SELECT id, username, created_at FROM users WHERE id = ?")
      .get(id) as { id: string; username: string; created_at: number };
    return { ok: true as const, user: row2user(row) };
  });

export const login = createServerFn({ method: "POST" })
  .validator(
    (data: { sessionId: string; username: string; password: string }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const row = db
      .query(
        "SELECT id, username, password_hash, created_at FROM users WHERE username = ?"
      )
      .get(data.username.trim()) as
      | {
          id: string;
          username: string;
          password_hash: string;
          created_at: number;
        }
      | null;
    if (!row) {
      return { ok: false as const, error: "No account with that username." };
    }
    const ok = await Bun.password.verify(data.password, row.password_hash);
    if (!ok) {
      return { ok: false as const, error: "Incorrect password." };
    }
    db.run(
      `INSERT INTO user_sessions (session_id, user_id) VALUES (?, ?)
       ON CONFLICT(session_id) DO UPDATE SET user_id = excluded.user_id`,
      [data.sessionId, row.id]
    );
    return {
      ok: true as const,
      user: row2user(row),
    };
  });

export const logout = createServerFn({ method: "POST" })
  .validator((data: { sessionId: string }) => data)
  .handler(async ({ data }) => {
    const db = getDb();
    db.run("DELETE FROM user_sessions WHERE session_id = ?", [data.sessionId]);
    return { ok: true as const };
  });

export const getCurrentUser = createServerFn({ method: "GET" })
  .validator((data: { sessionId: string }) => data)
  .handler(async ({ data }): Promise<PublicUser | null> => {
    const db = getDb();
    const row = db
      .query(
        `SELECT u.id, u.username, u.created_at
         FROM user_sessions us
         JOIN users u ON u.id = us.user_id
         WHERE us.session_id = ?`
      )
      .get(data.sessionId) as
      | { id: string; username: string; created_at: number }
      | null;
    return row2user(row);
  });
