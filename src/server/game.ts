import { createServerFn } from "@tanstack/react-start";
import { nanoid } from "nanoid";
import { getDb } from "../lib/db";
import {
  generateWireModule,
  generateButtonModule,
  generateSymbolsModule,
  generateSymbolsColumns,
  generateSimonModule,
  generateMazeModule,
  generateMemoryModule,
  generateMorseModule,
  generatePasswordModule,
  generateSerialNumber,
  getWireSolution,
  getButtonAction,
  getSymbolsSolution,
  getSimonExpected,
  tryMazeMove,
  getMemoryExpected,
  getMorseSolutionFreqIndex,
  passwordIsCorrect,
} from "../lib/generator";
import type {
  GameState,
  Module,
  PlayerRole,
  ButtonModuleConfig,
  WireModuleConfig,
  SymbolsModuleConfig,
  SimonModuleConfig,
  MazeModuleConfig,
  Direction,
  MazeCell,
  MemoryModuleConfig,
  MemoryPress,
  MorseModuleConfig,
  PasswordModuleConfig,
} from "../lib/types";
import {
  MORSE_FREQS,
  PASSWORD_COLS,
  PASSWORD_LETTERS_PER_COL,
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

    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'simon', ?, ?)",
      [nanoid(), gameId, 2 + symbolCount, JSON.stringify(generateSimonModule(seed))]
    );

    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'maze', ?, ?)",
      [nanoid(), gameId, 3 + symbolCount, JSON.stringify(generateMazeModule(seed))]
    );

    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'memory', ?, ?)",
      [nanoid(), gameId, 4 + symbolCount, JSON.stringify(generateMemoryModule(seed))]
    );

    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'morse', ?, ?)",
      [nanoid(), gameId, 5 + symbolCount, JSON.stringify(generateMorseModule(seed))]
    );

    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'password', ?, ?)",
      [nanoid(), gameId, 6 + symbolCount, JSON.stringify(generatePasswordModule(seed))]
    );

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
      type: m.type as "wire" | "button" | "symbols" | "simon" | "maze" | "memory" | "morse" | "password",
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

    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'simon', ?, ?)",
      [nanoid(), data.gameId, 2 + symbolCount, JSON.stringify(generateSimonModule(newSeed))]
    );

    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'maze', ?, ?)",
      [nanoid(), data.gameId, 3 + symbolCount, JSON.stringify(generateMazeModule(newSeed))]
    );

    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'memory', ?, ?)",
      [nanoid(), data.gameId, 4 + symbolCount, JSON.stringify(generateMemoryModule(newSeed))]
    );

    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'morse', ?, ?)",
      [nanoid(), data.gameId, 5 + symbolCount, JSON.stringify(generateMorseModule(newSeed))]
    );

    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, 'password', ?, ?)",
      [nanoid(), data.gameId, 6 + symbolCount, JSON.stringify(generatePasswordModule(newSeed))]
    );

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
    type: row.type as "wire" | "button" | "symbols" | "simon" | "maze" | "memory" | "morse" | "password",
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

// Password — cycle a single dial. Pure state update, no correctness
// check on individual rotations.
export const cyclePassword = createServerFn({ method: "POST" })
  .validator(
    (data: { moduleId: string; col: number; delta: number }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };
    if (data.col < 0 || data.col >= PASSWORD_COLS) return { ok: false };
    const dials = mod.state.passwordDials ?? new Array(PASSWORD_COLS).fill(0);
    const cur = dials[data.col] ?? 0;
    const next =
      (cur + data.delta + PASSWORD_LETTERS_PER_COL) % PASSWORD_LETTERS_PER_COL;
    const newDials = [...dials];
    newDials[data.col] = next;
    db.run("UPDATE modules SET state_json = ? WHERE id = ?", [
      JSON.stringify({ ...mod.state, passwordDials: newDials }),
      data.moduleId,
    ]);
    return { ok: true };
  });

export const submitPassword = createServerFn({ method: "POST" })
  .validator((data: { gameId: string; moduleId: string }) => data)
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };
    const config = mod.config as PasswordModuleConfig;
    const dials = mod.state.passwordDials ?? new Array(PASSWORD_COLS).fill(0);
    const attempt = config.columns
      .map((col, i) => col[dials[i] ?? 0])
      .join("");
    if (passwordIsCorrect(config, attempt)) {
      db.run("UPDATE modules SET solved = 1, struck = 0 WHERE id = ?", [
        data.moduleId,
      ]);
      checkAllSolved(data.gameId);
      return { ok: true, correct: true, solved: true };
    }
    db.run("UPDATE modules SET struck = 1 WHERE id = ?", [data.moduleId]);
    const { lost } = applyStrike(data.gameId);
    return { ok: true, correct: false, lost };
  });

// Morse — dial a frequency. The dial state is local to the module and
// doesn't punish wrong intermediate values, so we just persist the new
// index without any correctness check.
export const dialMorse = createServerFn({ method: "POST" })
  .validator(
    (data: { moduleId: string; freqIndex: number }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };
    if (data.freqIndex < 0 || data.freqIndex >= MORSE_FREQS.length) {
      return { ok: false };
    }
    db.run("UPDATE modules SET state_json = ? WHERE id = ?", [
      JSON.stringify({ ...mod.state, morseFreqIndex: data.freqIndex }),
      data.moduleId,
    ]);
    return { ok: true };
  });

// Morse — transmit. Validates the current frequency against the solution.
export const transmitMorse = createServerFn({ method: "POST" })
  .validator((data: { gameId: string; moduleId: string }) => data)
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };
    const config = mod.config as MorseModuleConfig;
    const current = mod.state.morseFreqIndex ?? 0;
    const expected = getMorseSolutionFreqIndex(config);
    if (current === expected) {
      db.run("UPDATE modules SET solved = 1, struck = 0 WHERE id = ?", [
        data.moduleId,
      ]);
      checkAllSolved(data.gameId);
      return { ok: true, correct: true, solved: true };
    }
    db.run("UPDATE modules SET struck = 1 WHERE id = ?", [data.moduleId]);
    const { lost } = applyStrike(data.gameId);
    return { ok: true, correct: false, lost };
  });

// Defuser presses one of the four memory buttons. Position 1..4. The
// expected position depends on the rule for the current stage, which may
// reference prior-stage history. Wrong press → strike + reset to stage 1
// (KTaNE-canonical behaviour).
export const pressMemory = createServerFn({ method: "POST" })
  .validator(
    (data: { gameId: string; moduleId: string; position: number }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };

    const config = mod.config as MemoryModuleConfig;
    const history: MemoryPress[] = mod.state.memoryHistory ?? [];
    const stageIdx = history.length;
    if (stageIdx >= config.stages.length) return { ok: false };

    const stage = config.stages[stageIdx];
    const expected = getMemoryExpected(config, stageIdx, history);

    if (data.position === expected) {
      const press: MemoryPress = {
        position: data.position,
        label: stage.labels[data.position - 1],
      };
      const newHistory = [...history, press];
      const solved = newHistory.length === config.stages.length;
      db.run("UPDATE modules SET state_json = ? WHERE id = ?", [
        JSON.stringify({ ...mod.state, memoryHistory: newHistory }),
        data.moduleId,
      ]);
      if (solved) {
        db.run("UPDATE modules SET solved = 1 WHERE id = ?", [data.moduleId]);
        checkAllSolved(data.gameId);
      }
      return { ok: true, correct: true, solved };
    } else {
      db.run("UPDATE modules SET state_json = ?, struck = 1 WHERE id = ?", [
        JSON.stringify({ ...mod.state, memoryHistory: [] }),
        data.moduleId,
      ]);
      const { lost } = applyStrike(data.gameId);
      return { ok: true, correct: false, lost };
    }
  });

// Defuser presses an arrow in the maze. The server validates against
// the active maze's walls — bumping into a wall is a strike. Reaching
// the goal cell solves the module.
export const moveMaze = createServerFn({ method: "POST" })
  .validator(
    (data: { gameId: string; moduleId: string; direction: Direction }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };

    const config = mod.config as MazeModuleConfig;
    const active = config.pool[config.activeIndex];
    const current: MazeCell = mod.state.mazePos ?? config.start;
    const trail: MazeCell[] = mod.state.mazeTrail ?? [config.start];

    const next = tryMazeMove(active.walls, current, data.direction);
    if (!next) {
      // Bumped a wall — strike, position unchanged.
      db.run("UPDATE modules SET struck = 1 WHERE id = ?", [data.moduleId]);
      const { lost } = applyStrike(data.gameId);
      return { ok: true, correct: false, lost };
    }

    const newTrail = [...trail, next];
    const reachedGoal = next.x === config.goal.x && next.y === config.goal.y;

    db.run("UPDATE modules SET state_json = ?, struck = 0 WHERE id = ?", [
      JSON.stringify({ ...mod.state, mazePos: next, mazeTrail: newTrail }),
      data.moduleId,
    ]);

    if (reachedGoal) {
      db.run("UPDATE modules SET solved = 1 WHERE id = ?", [data.moduleId]);
      checkAllSolved(data.gameId);
      return { ok: true, correct: true, solved: true };
    }
    return { ok: true, correct: true };
  });

// Defuser presses a Simon colour. The expected colour depends on
// (serial vowel, current strikes, how many flashes already pressed).
// Wrong press → strike and progress resets to 0.
export const pressSimon = createServerFn({ method: "POST" })
  .validator(
    (data: { gameId: string; moduleId: string; color: string }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };

    const gameRow = db
      .query("SELECT serial_number, strikes FROM games WHERE id = ?")
      .get(data.gameId) as { serial_number: string; strikes: number } | null;
    if (!gameRow) return { ok: false };

    const config = mod.config as SimonModuleConfig;
    const pressed = mod.state.simonPressed ?? 0;
    const expected = getSimonExpected(
      config,
      gameRow.serial_number,
      gameRow.strikes,
      pressed
    );

    if (data.color === expected) {
      const next = pressed + 1;
      const solved = next === config.sequence.length;
      db.run("UPDATE modules SET state_json = ? WHERE id = ?", [
        JSON.stringify({ ...mod.state, simonPressed: next }),
        data.moduleId,
      ]);
      if (solved) {
        db.run("UPDATE modules SET solved = 1 WHERE id = ?", [data.moduleId]);
        checkAllSolved(data.gameId);
      }
      return { ok: true, correct: true, solved };
    } else {
      db.run("UPDATE modules SET state_json = ?, struck = 1 WHERE id = ?", [
        JSON.stringify({ ...mod.state, simonPressed: 0 }),
        data.moduleId,
      ]);
      const { lost } = applyStrike(data.gameId);
      return { ok: true, correct: false, lost };
    }
  });
