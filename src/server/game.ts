import { createServerFn } from "@tanstack/react-start";
import { nanoid } from "nanoid";
import { getDb } from "../lib/db";
import {
  generateWireModule,
  generateButtonModule,
  generateSerialNumber,
  getWireSolution,
  getButtonAction,
  checkReleaseTiming,
} from "../lib/generator";
import type {
  GameState,
  Module,
  PlayerRole,
  ButtonModuleConfig,
  WireModuleConfig,
} from "../lib/types";

function shortId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

export const createGame = createServerFn({ method: "POST" }).handler(
  async () => {
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

    return { gameId, seed };
  }
);

// Atomically remove the old role and claim the new one. Used when a player
// changes role from the lobby.
export const switchRole = createServerFn({ method: "POST" })
  .validator(
    (data: {
      gameId: string;
      fromRole: PlayerRole;
      toRole: PlayerRole;
    }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    if (data.fromRole !== data.toRole) {
      db.run(
        "DELETE FROM game_players WHERE game_id = ? AND role = ?",
        [data.gameId, data.fromRole]
      );
    }
    db.run(
      "INSERT OR IGNORE INTO game_players (game_id, role) VALUES (?, ?)",
      [data.gameId, data.toRole]
    );
    return { ok: true };
  });

export const joinGame = createServerFn({ method: "POST" })
  .validator((data: { gameId: string; role: PlayerRole }) => data)
  .handler(async ({ data }) => {
    const db = getDb();
    const game = db
      .query("SELECT * FROM games WHERE id = ?")
      .get(data.gameId) as { status: string } | null;

    if (!game) return { ok: false as const, error: "Game not found" };
    if (game.status === "won" || game.status === "lost")
      return { ok: false as const, error: "Game is over" };

    db.run(
      "INSERT OR IGNORE INTO game_players (game_id, role) VALUES (?, ?)",
      [data.gameId, data.role]
    );
    return { ok: true as const };
  });

export const getGameState = createServerFn({ method: "GET" })
  .validator(
    (data: { gameId: string; role?: PlayerRole }) => data
  )
  .handler(async ({ data }): Promise<GameState | null> => {
    const db = getDb();

    // Heartbeat: re-claim the caller's current role on every poll so that a
    // role row deleted by the other player's switchRole gets restored as long
    // as someone is actively browsing that role's URL.
    if (data.role) {
      db.run(
        "INSERT OR IGNORE INTO game_players (game_id, role) VALUES (?, ?)",
        [data.gameId, data.role]
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
      .query("SELECT role, joined_at FROM game_players WHERE game_id = ?")
      .all(data.gameId) as { role: PlayerRole; joined_at: number }[];

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
      type: m.type as "wire" | "button",
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
      players: players.map((p) => ({ role: p.role, joinedAt: p.joined_at })),
      modules,
      timeRemaining,
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

    return { ok: true as const };
  });

export const startGame = createServerFn({ method: "POST" })
  .validator((data: { gameId: string }) => data)
  .handler(async ({ data }) => {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    db.run(
      "UPDATE games SET status = 'active', started_at = ? WHERE id = ? AND status = 'waiting'",
      [now, data.gameId]
    );
    return { ok: true };
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
    type: row.type as "wire" | "button",
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

// Defuser releases the held button — validate timing
export const releaseHold = createServerFn({ method: "POST" })
  .validator((data: { gameId: string; moduleId: string }) => data)
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };

    // If the button was supposed to be tapped (not held), holding then releasing is wrong
    const config = mod.config as ButtonModuleConfig;
    if (getButtonAction(config) === "tap") {
      db.run("UPDATE modules SET state_json = ?, struck = 1 WHERE id = ?", [
        JSON.stringify({ ...mod.state, isHolding: false }),
        data.moduleId,
      ]);
      const { lost } = applyStrike(data.gameId);
      return { ok: true, correct: false, lost };
    }

    // Determine current bomb timer
    const gameRow = db
      .query(
        "SELECT timer_seconds, started_at, status FROM games WHERE id = ?"
      )
      .get(data.gameId) as {
      timer_seconds: number;
      started_at: number | null;
      status: string;
    };
    let timeRemaining = gameRow.timer_seconds;
    if (gameRow.started_at && gameRow.status === "active") {
      const elapsed = Math.floor(Date.now() / 1000) - gameRow.started_at;
      timeRemaining = Math.max(0, gameRow.timer_seconds - elapsed);
    }

    const correct = checkReleaseTiming(config, timeRemaining);

    db.run("UPDATE modules SET state_json = ? WHERE id = ?", [
      JSON.stringify({ ...mod.state, isHolding: false }),
      data.moduleId,
    ]);

    if (correct) {
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
