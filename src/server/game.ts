import { createServerFn } from "@tanstack/react-start";
import { nanoid } from "nanoid";
import { getDb } from "../lib/db";
import {
  generateWireModule,
  generateButtonModule,
  generateSymbolsModule,
  generateSymbolsColumns,
  generateSerialNumber,
  getWireSolution,
  getButtonAction,
  getSymbolsSolution,
} from "../lib/generator";
import type {
  GameState,
  Module,
  PlayerRole,
  ButtonModuleConfig,
  WireModuleConfig,
  SymbolsModuleConfig,
} from "../lib/types";

function shortId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

const ACTIVE_SECONDS = 10;

export const createGame = createServerFn({ method: "POST" })
  .validator((data: { sessionId: string }) => data)
  .handler(async ({ data }) => {
    const db = getDb();
    const gameId = shortId();
    const seed = Math.floor(Math.random() * 2_000_000_000);
    const serial = generateSerialNumber(seed);

    db.run(
      "INSERT INTO games (id, seed, serial_number, status, timer_seconds) VALUES (?, ?, ?, 'waiting', 300)",
      [gameId, seed, serial]
    );

    const wireConfig = generateWireModule(seed);
    const buttonConfig = generateButtonModule(seed);

    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'wire', 0, ?)",
      [nanoid(), gameId, JSON.stringify(wireConfig)]
    );
    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'button', 1, ?)",
      [nanoid(), gameId, JSON.stringify(buttonConfig)]
    );
    // All symbols modules on a bomb share the SAME columns (one manual page
    // covers all of them). Each module's activeSymbols are unique to it.
    const symbolCount = seed % 3 === 0 ? 2 : 1;
    if (symbolCount > 0) {
      const sharedColumns = generateSymbolsColumns(seed);
      for (let i = 0; i < symbolCount; i++) {
        db.run(
          "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'symbols', ?, ?)",
          [nanoid(), gameId, 2 + i, JSON.stringify(generateSymbolsModule(seed + i * 77777, sharedColumns))]
        );
      }
    }

    // Creator starts as Defuser.
    db.run(
      `INSERT INTO game_players (game_id, session_id, role, last_seen)
       VALUES (?, ?, 'defuser', unixepoch())`,
      [gameId, data.sessionId]
    );

    return { gameId, seed };
  });

// Set this session's role for the game and refresh last_seen. UPSERT keyed on
// (game_id, session_id) — each browser tab owns exactly one row.
function upsertPlayer(
  db: ReturnType<typeof getDb>,
  gameId: string,
  sessionId: string,
  role: PlayerRole
) {
  db.run(
    `INSERT INTO game_players (game_id, session_id, role, last_seen)
     VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(game_id, session_id) DO UPDATE SET role = excluded.role, last_seen = excluded.last_seen`,
    [gameId, sessionId, role]
  );
}

export const switchRole = createServerFn({ method: "POST" })
  .validator(
    (data: {
      gameId: string;
      sessionId: string;
      toRole: PlayerRole;
    }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    upsertPlayer(db, data.gameId, data.sessionId, data.toRole);
    return { ok: true };
  });

// Visitor joins a game. If this session already has a role, keep it; otherwise
// assign whichever role is currently open (default: expert).
export const joinGame = createServerFn({ method: "POST" })
  .validator(
    (data: { gameId: string; sessionId: string }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const game = db
      .query("SELECT * FROM games WHERE id = ?")
      .get(data.gameId) as { status: string } | null;

    if (!game) return { ok: false as const, error: "Game not found" };

    const existing = db
      .query(
        "SELECT role FROM game_players WHERE game_id = ? AND session_id = ?"
      )
      .get(data.gameId, data.sessionId) as { role: PlayerRole } | null;

    if (existing) {
      // Heartbeat — keep the role they already have
      db.run(
        "UPDATE game_players SET last_seen = unixepoch() WHERE game_id = ? AND session_id = ?",
        [data.gameId, data.sessionId]
      );
      return { ok: true as const, role: existing.role };
    }

    // First time this session has joined — pick whichever slot is open
    const activeRoles = db
      .query(
        "SELECT DISTINCT role FROM game_players WHERE game_id = ? AND last_seen > unixepoch() - ?"
      )
      .all(data.gameId, ACTIVE_SECONDS) as { role: PlayerRole }[];
    const hasDefuser = activeRoles.some((r) => r.role === "defuser");
    const hasExpert = activeRoles.some((r) => r.role === "expert");
    const assigned: PlayerRole = !hasDefuser
      ? "defuser"
      : !hasExpert
      ? "expert"
      : "expert";

    upsertPlayer(db, data.gameId, data.sessionId, assigned);
    return { ok: true as const, role: assigned };
  });

export const getGameState = createServerFn({ method: "GET" })
  .validator(
    (data: { gameId: string; sessionId?: string }) => data
  )
  .handler(async ({ data }): Promise<GameState | null> => {
    const db = getDb();

    // Heartbeat — only refresh THIS session's last_seen. We never touch the
    // role here, so an in-flight poll from a tab that has since switched
    // roles cannot revert the role row.
    if (data.sessionId) {
      db.run(
        "UPDATE game_players SET last_seen = unixepoch() WHERE game_id = ? AND session_id = ?",
        [data.gameId, data.sessionId]
      );
    }

    const gameRow = db
      .query("SELECT * FROM games WHERE id = ?")
      .get(data.gameId) as {
      id: string;
      seed: number;
      serial_number: string;
      status: string;
      timer_seconds: number;
      started_at: number | null;
      strikes: number;
      max_strikes: number;
      created_at: number;
    } | null;

    if (!gameRow) return null;

    const players = db
      .query(
        `SELECT DISTINCT role, MAX(last_seen) AS last_seen
         FROM game_players
         WHERE game_id = ? AND last_seen > unixepoch() - ?
         GROUP BY role`
      )
      .all(data.gameId, ACTIVE_SECONDS) as {
      role: PlayerRole;
      last_seen: number;
    }[];

    const moduleRows = db
      .query(
        "SELECT * FROM modules WHERE game_id = ? ORDER BY position ASC"
      )
      .all(data.gameId) as {
      id: string;
      game_id: string;
      type: string;
      position: number;
      config_json: string;
      state_json: string;
      solved: number;
      struck: number;
    }[];

    const modules: Module[] = moduleRows.map((m) => ({
      id: m.id,
      gameId: m.game_id,
      type: m.type as "wire" | "button" | "symbols",
      position: m.position,
      config: JSON.parse(m.config_json),
      state: JSON.parse(m.state_json),
      solved: m.solved === 1,
      struck: m.struck === 1,
    }));

    let timeRemaining = gameRow.timer_seconds;
    if (gameRow.started_at && gameRow.status === "active") {
      const elapsed = Math.floor(Date.now() / 1000) - gameRow.started_at;
      timeRemaining = Math.max(0, gameRow.timer_seconds - elapsed);
    }

    // Resolve this session's current role (if any)
    let myRole: PlayerRole | null = null;
    if (data.sessionId) {
      const mine = db
        .query(
          "SELECT role FROM game_players WHERE game_id = ? AND session_id = ?"
        )
        .get(data.gameId, data.sessionId) as { role: PlayerRole } | null;
      myRole = mine?.role ?? null;
    }

    return {
      game: {
        id: gameRow.id,
        seed: gameRow.seed,
        serial: gameRow.serial_number,
        status: gameRow.status as any,
        timerSeconds: gameRow.timer_seconds,
        startedAt: gameRow.started_at,
        strikes: gameRow.strikes,
        maxStrikes: gameRow.max_strikes,
        createdAt: gameRow.created_at,
      },
      players: players.map((p) => ({ role: p.role, joinedAt: p.last_seen })),
      modules,
      timeRemaining,
      myRole,
    };
  });

// Re-arm the same room with a fresh bomb. Keeps the room code and player slots,
// regenerates seed/serial/modules, resets timer and strikes.
export const restartGame = createServerFn({ method: "POST" })
  .validator((data: { gameId: string }) => data)
  .handler(async ({ data }) => {
    const db = getDb();
    const game = db
      .query("SELECT id FROM games WHERE id = ?")
      .get(data.gameId) as { id: string } | null;
    if (!game) return { ok: false as const, error: "Game not found" };

    const newSeed = Math.floor(Math.random() * 2_000_000_000);
    const newSerial = generateSerialNumber(newSeed);

    db.run(
      "UPDATE games SET seed = ?, serial_number = ?, status = 'waiting', timer_seconds = 300, started_at = NULL, strikes = 0 WHERE id = ?",
      [newSeed, newSerial, data.gameId]
    );

    db.run("DELETE FROM modules WHERE game_id = ?", [data.gameId]);

    const wireConfig = generateWireModule(newSeed);
    const buttonConfig = generateButtonModule(newSeed);

    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'wire', 0, ?)",
      [nanoid(), data.gameId, JSON.stringify(wireConfig)]
    );
    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'button', 1, ?)",
      [nanoid(), data.gameId, JSON.stringify(buttonConfig)]
    );
    const symbolCount = newSeed % 3 === 0 ? 2 : 1;
    if (symbolCount > 0) {
      const sharedColumns = generateSymbolsColumns(newSeed);
      for (let i = 0; i < symbolCount; i++) {
        db.run(
          "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'symbols', ?, ?)",
          [nanoid(), data.gameId, 2 + i, JSON.stringify(generateSymbolsModule(newSeed + i * 77777, sharedColumns))]
        );
      }
    }

    return { ok: true as const };
  });

export const startGame = createServerFn({ method: "POST" })
  .validator((data: { gameId: string }) => data)
  .handler(async ({ data }) => {
    const db = getDb();

    // Authoritative role check — refuse to start unless both roles are claimed.
    // The client UI also gates this, but the server is the source of truth.
    const roles = db
      .query(
        "SELECT DISTINCT role FROM game_players WHERE game_id = ? AND last_seen > unixepoch() - ?"
      )
      .all(data.gameId, ACTIVE_SECONDS) as { role: string }[];
    const hasDefuser = roles.some((r) => r.role === "defuser");
    const hasExpert = roles.some((r) => r.role === "expert");
    if (!hasDefuser || !hasExpert) {
      return {
        ok: false as const,
        error: "Need at least one Defuser and one Expert",
      };
    }

    const now = Math.floor(Date.now() / 1000);
    db.run(
      "UPDATE games SET status = 'active', started_at = ? WHERE id = ? AND status = 'waiting'",
      [now, data.gameId]
    );
    return { ok: true as const };
  });

function applyStrike(gameId: string): { strikes: number; lost: boolean } {
  const db = getDb();
  const row = db
    .query("SELECT strikes, max_strikes FROM games WHERE id = ?")
    .get(gameId) as { strikes: number; max_strikes: number };
  const newStrikes = row.strikes + 1;
  const lost = newStrikes >= row.max_strikes;
  db.run("UPDATE games SET strikes = ?, status = ? WHERE id = ?", [
    newStrikes,
    lost ? "lost" : "active",
    gameId,
  ]);
  return { strikes: newStrikes, lost };
}

function checkAllSolved(gameId: string): boolean {
  const db = getDb();
  const remaining = db
    .query(
      "SELECT COUNT(*) as cnt FROM modules WHERE game_id = ? AND solved = 0"
    )
    .get(gameId) as { cnt: number };
  if (remaining.cnt === 0) {
    db.run("UPDATE games SET status = 'won' WHERE id = ?", [gameId]);
    return true;
  }
  return false;
}

function loadModule(moduleId: string): Module | null {
  const db = getDb();
  const row = db
    .query("SELECT * FROM modules WHERE id = ?")
    .get(moduleId) as {
    id: string;
    game_id: string;
    type: string;
    position: number;
    config_json: string;
    state_json: string;
    solved: number;
    struck: number;
  } | null;
  if (!row) return null;
  return {
    id: row.id,
    gameId: row.game_id,
    type: row.type as "wire" | "button" | "symbols",
    position: row.position,
    config: JSON.parse(row.config_json),
    state: JSON.parse(row.state_json),
    solved: row.solved === 1,
    struck: row.struck === 1,
  };
}

// Defuser cuts a wire at a slot index — server validates against rules.
// Empty slots can't be cut; the UI disables them and the server rejects too.
export const cutWire = createServerFn({ method: "POST" })
  .validator(
    (data: { gameId: string; moduleId: string; slotIndex: number }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };

    const gameRow = db
      .query("SELECT serial_number FROM games WHERE id = ?")
      .get(data.gameId) as { serial_number: string } | null;
    if (!gameRow) return { ok: false };

    const config = mod.config as WireModuleConfig;
    // Guard: refuse to cut empty slots
    if (!config.slots[data.slotIndex]) return { ok: false };

    const correct = getWireSolution(config, gameRow.serial_number);
    const newState = {
      ...mod.state,
      cutWires: [...(mod.state.cutWires ?? []), data.slotIndex],
    };
    db.run("UPDATE modules SET state_json = ? WHERE id = ?", [
      JSON.stringify(newState),
      data.moduleId,
    ]);

    if (data.slotIndex === correct) {
      db.run("UPDATE modules SET solved = 1 WHERE id = ?", [data.moduleId]);
      checkAllSolved(data.gameId);
      return { ok: true, correct: true };
    } else {
      db.run("UPDATE modules SET struck = 1 WHERE id = ?", [data.moduleId]);
      const { lost } = applyStrike(data.gameId);
      return { ok: true, correct: false, lost };
    }
  });

// Defuser taps (press + release immediately)
export const tapButton = createServerFn({ method: "POST" })
  .validator((data: { gameId: string; moduleId: string }) => data)
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };

    const config = mod.config as ButtonModuleConfig;
    if (getButtonAction(config) === "tap") {
      db.run("UPDATE modules SET solved = 1 WHERE id = ?", [data.moduleId]);
      checkAllSolved(data.gameId);
      return { ok: true, correct: true };
    } else {
      db.run("UPDATE modules SET struck = 1 WHERE id = ?", [data.moduleId]);
      const { lost } = applyStrike(data.gameId);
      return { ok: true, correct: false, lost };
    }
  });

// Defuser starts holding the button — record state so LED shows
export const startHold = createServerFn({ method: "POST" })
  .validator((data: { moduleId: string }) => data)
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };
    db.run("UPDATE modules SET state_json = ? WHERE id = ?", [
      JSON.stringify({ ...mod.state, isHolding: true }),
      data.moduleId,
    ]);
    return { ok: true };
  });

// Defuser releases the held button. The client owns the verdict here — it
// knows the rule (it's in the module config) and the timer it just displayed
// to the user, so server-side timing checks only led to off-by-one latency
// strikes. We trust the client's `correct` boolean and just record it.
export const releaseHold = createServerFn({ method: "POST" })
  .validator(
    (data: { gameId: string; moduleId: string; correct: boolean }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };

    db.run("UPDATE modules SET state_json = ? WHERE id = ?", [
      JSON.stringify({ ...mod.state, isHolding: false }),
      data.moduleId,
    ]);

    if (data.correct) {
      db.run("UPDATE modules SET solved = 1 WHERE id = ?", [data.moduleId]);
      checkAllSolved(data.gameId);
      return { ok: true, correct: true };
    } else {
      db.run("UPDATE modules SET struck = 1 WHERE id = ?", [data.moduleId]);
      const { lost } = applyStrike(data.gameId);
      return { ok: true, correct: false, lost };
    }
  });

export const checkTimer = createServerFn({ method: "POST" })
  .validator((data: { gameId: string }) => data)
  .handler(async ({ data }) => {
    const db = getDb();
    const gameRow = db
      .query(
        "SELECT status, started_at, timer_seconds FROM games WHERE id = ?"
      )
      .get(data.gameId) as {
      status: string;
      started_at: number | null;
      timer_seconds: number;
    } | null;

    if (!gameRow || gameRow.status !== "active" || !gameRow.started_at)
      return { lost: false };

    const elapsed = Math.floor(Date.now() / 1000) - gameRow.started_at;
    if (elapsed >= gameRow.timer_seconds) {
      db.run("UPDATE games SET status = 'lost' WHERE id = ?", [data.gameId]);
      return { lost: true };
    }
    return { lost: false };
  });

// Defuser presses a symbol button. Validates against the required sequence
// (= solution derived from the column that contains the active symbols).
// Wrong press → strike + progress resets. Correct last press → solved.
export const pressSymbol = createServerFn({ method: "POST" })
  .validator(
    (data: { gameId: string; moduleId: string; symbolId: string }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };

    const config = mod.config as SymbolsModuleConfig;
    const solution = getSymbolsSolution(config);
    const pressedIds: string[] = mod.state.pressedIds ?? [];
    const expectedNext = solution[pressedIds.length];

    if (data.symbolId === expectedNext) {
      const newPressed = [...pressedIds, data.symbolId];
      const solved = newPressed.length === solution.length;
      db.run("UPDATE modules SET state_json = ? WHERE id = ?", [
        JSON.stringify({ ...mod.state, pressedIds: newPressed }),
        data.moduleId,
      ]);
      if (solved) {
        db.run("UPDATE modules SET solved = 1 WHERE id = ?", [data.moduleId]);
        checkAllSolved(data.gameId);
      }
      return { ok: true, correct: true, solved };
    } else {
      db.run("UPDATE modules SET state_json = ?, struck = 1 WHERE id = ?", [
        JSON.stringify({ ...mod.state, pressedIds: [] }),
        data.moduleId,
      ]);
      const { lost } = applyStrike(data.gameId);
      return { ok: true, correct: false, lost };
    }
  });
