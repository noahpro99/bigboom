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
  generateComplicatedWiresModule,
  generateWhosOnFirstModule,
  getWhoSolution,
  generateWireSeqModule,
  wireSeqShouldCut,
  generateSerialNumber,
  getWireSolution,
  getButtonAction,
  getSymbolsSolution,
  getSimonExpected,
  tryMazeMove,
  getMemoryExpected,
  getMorseSolutionFreqIndex,
  passwordIsCorrect,
  checkReleaseTiming,
  compWireShouldCut,
} from "../lib/generator";
import type {
  GameState,
  Module,
  ModuleType,
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
  ComplicatedWiresModuleConfig,
  WhosOnFirstModuleConfig,
  WireSeqModuleConfig,
  Preset,
  GameConfig,
} from "../lib/types";
import {
  MORSE_FREQS,
  PASSWORD_COLS,
  PASSWORD_LETTERS_PER_COL,
  PRESET_CONFIGS,
  compWireKey,
  canonicalModuleSet,
  detectPreset,
} from "../lib/types";

function shortId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

const ACTIVE_SECONDS = 10;

/* Per-instance seed derivation. The MANUAL-visible content of each
   module type is always derived from the bomb's base `seed` (so the
   one manual page per type stays consistent across instances). The
   instance seed varies per-instance so duplicates aren't identical
   copies; what exactly differs is up to each generator. */
const TYPE_SEED_SALT: Record<ModuleType, number> = {
  wire: 0x10_0001,
  button: 0x20_0001,
  symbols: 0x30_0001,
  simon: 0x40_0001,
  maze: 0x50_0001,
  memory: 0x60_0001,
  morse: 0x70_0001,
  password: 0x80_0001,
  compWires: 0x90_0001,
  whoFirst: 0xa0_0001,
  wireSeq: 0xb0_0001,
};

function instanceSeed(
  baseSeed: number,
  type: ModuleType,
  instanceIdx: number
): number {
  // Mix base + type salt + instance index; unsigned 32-bit result for stability.
  return (baseSeed + TYPE_SEED_SALT[type] + instanceIdx * 7919) >>> 0;
}

/* Spawn the module rows for a game given its config. Walks the
   moduleTypes array preserving duplicates — N occurrences of the same
   type spawn N independent instances. Each instance gets a derived
   seed via `instanceSeed()`. The legacy "secret extra symbols when
   seed % 3 === 0" rule is gone; symbols count now comes purely from
   the moduleTypes array. */
function spawnModules(
  db: ReturnType<typeof getDb>,
  gameId: string,
  seed: number,
  moduleTypes: ModuleType[]
) {
  let pos = 0;
  const seenCount: Record<ModuleType, number> = {
    wire: 0, button: 0, symbols: 0, simon: 0,
    maze: 0, memory: 0, morse: 0, password: 0, compWires: 0, whoFirst: 0, wireSeq: 0,
  };
  /* Symbols share columns across all instances on the bomb (one manual
     page covers all). Only build the columns if there's at least one
     symbols instance, so empty games don't waste the work. */
  const symbolsCount = moduleTypes.filter((t) => t === "symbols").length;
  const sharedSymbolsColumns =
    symbolsCount > 0 ? generateSymbolsColumns(seed) : null;

  for (const type of moduleTypes) {
    const i = seenCount[type]++;
    const iseed = instanceSeed(seed, type, i);
    let configJson: string;
    /* For modules where (baseSeed, instanceSeed) is split properly,
       pass both — manual content stays keyed on baseSeed and only
       per-instance variation uses iseed. For modules where everything
       comes from one seed (wire/button/password), call with baseSeed
       so the manual page always matches. Multi-instance of those types
       therefore produces duplicate puzzles, but at least the manual
       can describe them. */
    if (type === "wire") {
      configJson = JSON.stringify(generateWireModule(seed));
    } else if (type === "button") {
      configJson = JSON.stringify(generateButtonModule(seed));
    } else if (type === "symbols") {
      /* Symbols already splits: sharedSymbolsColumns + per-instance
         activeSymbols. iseed picks distinct active sets per instance. */
      configJson = JSON.stringify(
        generateSymbolsModule(iseed, sharedSymbolsColumns!)
      );
    } else if (type === "simon") {
      configJson = JSON.stringify(generateSimonModule(seed, iseed));
    } else if (type === "maze") {
      configJson = JSON.stringify(generateMazeModule(seed, iseed));
    } else if (type === "memory") {
      configJson = JSON.stringify(generateMemoryModule(seed, iseed));
    } else if (type === "morse") {
      configJson = JSON.stringify(generateMorseModule(seed, iseed));
    } else if (type === "password") {
      configJson = JSON.stringify(generatePasswordModule(seed));
    } else if (type === "compWires") {
      configJson = JSON.stringify(
        generateComplicatedWiresModule(seed, iseed)
      );
    } else if (type === "whoFirst") {
      configJson = JSON.stringify(generateWhosOnFirstModule(seed, iseed));
    } else if (type === "wireSeq") {
      configJson = JSON.stringify(generateWireSeqModule(seed, iseed));
    } else {
      continue;
    }
    db.run(
      "INSERT INTO modules (id, game_id, type, position, config_json) VALUES (?, ?, ?, ?, ?)",
      [nanoid(), gameId, type, pos++, configJson]
    );
  }
}

/* Sanity-check and canonicalise a config from the wire. Timer is
   clamped to a sane range; per-type counts are clamped to [0, MAX].
   No module type is locked-on — a custom config can have zero of any
   type (and even zero total). Duplicates in moduleTypes are preserved. */
const MAX_PER_TYPE = 3;
function normalizeConfig(input: Partial<GameConfig>): GameConfig {
  const timerSeconds = Math.max(
    60,
    Math.min(1800, Math.floor(input.timerSeconds ?? 300))
  );
  const counts: Record<ModuleType, number> = {
    wire: 0, button: 0, symbols: 0, simon: 0,
    maze: 0, memory: 0, morse: 0, password: 0, compWires: 0, whoFirst: 0, wireSeq: 0,
  };
  for (const t of input.moduleTypes ?? []) {
    if (t in counts) counts[t]++;
  }
  for (const k of Object.keys(counts) as ModuleType[]) {
    counts[k] = Math.min(MAX_PER_TYPE, counts[k]);
  }
  const order: ModuleType[] = [
    "wire",
    "button",
    "symbols",
    "simon",
    "maze",
    "memory",
    "morse",
    "password",
    "compWires",
    "whoFirst",
    "wireSeq",
  ];
  const moduleTypes: ModuleType[] = [];
  for (const t of order) {
    for (let i = 0; i < counts[t]; i++) moduleTypes.push(t);
  }
  const preset = detectPreset({ timerSeconds, moduleTypes });
  return { preset, timerSeconds, moduleTypes };
}

/* Resolve a partial input into a full GameConfig. If a preset name is
   given, that preset wins. Otherwise normalize the raw timer+modules. */
function resolveConfig(input: {
  preset?: Preset;
  timerSeconds?: number;
  moduleTypes?: ModuleType[];
}): GameConfig {
  if (input.preset && input.preset !== "custom") {
    const base = PRESET_CONFIGS[input.preset];
    return {
      preset: base.preset,
      timerSeconds: base.timerSeconds,
      moduleTypes: [...base.moduleTypes],
    };
  }
  return normalizeConfig({
    timerSeconds: input.timerSeconds,
    moduleTypes: input.moduleTypes,
  });
}

export const createGame = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionId: string;
      preset?: Preset;
      timerSeconds?: number;
      moduleTypes?: ModuleType[];
    }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const gameId = shortId();
    const seed = Math.floor(Math.random() * 2_000_000_000);
    const serial = generateSerialNumber(seed);
    /* Default to "standard" if no preset and no override were sent. The
       lobby lets either player change it before the bomb is armed. */
    const hasOverride =
      data.preset != null ||
      data.timerSeconds != null ||
      (data.moduleTypes && data.moduleTypes.length > 0);
    const config = resolveConfig(
      hasOverride ? data : { preset: "standard" }
    );
    const moduleSet = canonicalModuleSet(config.moduleTypes);

    db.run(
      `INSERT INTO games
        (id, seed, serial_number, status, timer_seconds, preset, module_set)
       VALUES (?, ?, ?, 'waiting', ?, ?, ?)`,
      [gameId, seed, serial, config.timerSeconds, config.preset, moduleSet]
    );

    spawnModules(db, gameId, seed, config.moduleTypes);

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

/* Is another live session already claiming the defuser slot? Used to
   refuse a 2nd defuser claim so the bomb only ever has one operator. */
function defuserHeldBy(
  db: ReturnType<typeof getDb>,
  gameId: string,
  excludingSessionId: string
): boolean {
  const row = db
    .query(
      `SELECT 1 FROM game_players
       WHERE game_id = ? AND role = 'defuser' AND session_id != ?
       AND last_seen > unixepoch() - ?`
    )
    .get(gameId, excludingSessionId, ACTIVE_SECONDS);
  return row != null;
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
    /* Refuse 2nd defuser. If the slot is taken by someone else, bounce
       them to spectator — the client UI also gates this but the server
       is the source of truth. */
    if (
      data.toRole === "defuser" &&
      defuserHeldBy(db, data.gameId, data.sessionId)
    ) {
      upsertPlayer(db, data.gameId, data.sessionId, "spectator");
      return { ok: false as const, error: "Defuser slot already taken" };
    }
    upsertPlayer(db, data.gameId, data.sessionId, data.toRole);
    return { ok: true as const };
  });

// Visitor joins a game. If this session already has a role, keep it; otherwise
// assign whichever role is currently open (default: spectator).
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

    // First time this session has joined — pick whichever slot is open.
    // Defuser is single-claim; everyone else after the first gets expert
    // or spectator depending on whether expert is filled.
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
      : "spectator";

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
      preset: string;
      module_set: string;
    } | null;

    if (!gameRow) return null;

    /* One row per LIVE session in the room, with username if signed in.
       Lobby uses this to show who's here and what role they have. */
    const playerRows = db
      .query(
        `SELECT gp.session_id, gp.role, gp.last_seen, u.username
         FROM game_players gp
         LEFT JOIN user_sessions us ON us.session_id = gp.session_id
         LEFT JOIN users u ON u.id = us.user_id
         WHERE gp.game_id = ? AND gp.last_seen > unixepoch() - ?
         ORDER BY gp.last_seen DESC`
      )
      .all(data.gameId, ACTIVE_SECONDS) as {
      session_id: string;
      role: PlayerRole;
      last_seen: number;
      username: string | null;
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
      type: m.type as "wire" | "button" | "symbols" | "simon" | "maze" | "memory" | "morse" | "password" | "compWires" | "whoFirst" | "wireSeq",
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

    /* Derive moduleTypes from the canonical module_set so the lobby and
       end-of-game card can render the active configuration. */
    const moduleTypes = (gameRow.module_set || "")
      .split(",")
      .filter(Boolean) as ModuleType[];

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
        preset: gameRow.preset as Preset,
        moduleTypes,
      },
      players: playerRows.map((p) => ({
        role: p.role,
        joinedAt: p.last_seen,
        username: p.username ?? null,
        isMe: p.session_id === data.sessionId,
      })),
      modules,
      timeRemaining,
      myRole,
    };
  });

/* Update the bomb config while the room is still in lobby. Any player in
   the room can do this — coop / trust-based. Re-generates the bomb
   modules so the host can preview the new module set if they want, but
   the seed stays the same. Refused if the game is already active or terminal. */
export const updateGameConfig = createServerFn({ method: "POST" })
  .validator(
    (data: {
      gameId: string;
      preset?: Preset;
      timerSeconds?: number;
      moduleTypes?: ModuleType[];
    }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const row = db
      .query("SELECT seed, status FROM games WHERE id = ?")
      .get(data.gameId) as { seed: number; status: string } | null;
    if (!row) return { ok: false as const, error: "Game not found" };
    if (row.status !== "waiting") {
      return {
        ok: false as const,
        error: "Cannot change config after the bomb is armed",
      };
    }

    const config = resolveConfig(data);
    const moduleSet = canonicalModuleSet(config.moduleTypes);

    db.run(
      "UPDATE games SET timer_seconds = ?, preset = ?, module_set = ? WHERE id = ?",
      [config.timerSeconds, config.preset, moduleSet, data.gameId]
    );
    db.run("DELETE FROM modules WHERE game_id = ?", [data.gameId]);
    spawnModules(db, data.gameId, row.seed, config.moduleTypes);

    return { ok: true as const };
  });

// Re-arm the same room with a fresh bomb. Keeps the room code, player
// slots, AND the prior config — the same preset/module set is reused so
// stats stay comparable across replays in the same room.
export const restartGame = createServerFn({ method: "POST" })
  .validator((data: { gameId: string }) => data)
  .handler(async ({ data }) => {
    const db = getDb();
    const game = db
      .query(
        "SELECT id, preset, timer_seconds, module_set FROM games WHERE id = ?"
      )
      .get(data.gameId) as
      | {
          id: string;
          preset: Preset;
          timer_seconds: number;
          module_set: string;
        }
      | null;
    if (!game) return { ok: false as const, error: "Game not found" };

    const moduleTypes = (game.module_set || "")
      .split(",")
      .filter(Boolean) as ModuleType[];
    const config = resolveConfig({
      preset: game.preset,
      timerSeconds: game.timer_seconds,
      moduleTypes,
    });

    const newSeed = Math.floor(Math.random() * 2_000_000_000);
    const newSerial = generateSerialNumber(newSeed);

    db.run(
      `UPDATE games
       SET seed = ?, serial_number = ?, status = 'waiting',
           timer_seconds = ?, started_at = NULL, strikes = 0,
           preset = ?, module_set = ?
       WHERE id = ?`,
      [
        newSeed,
        newSerial,
        config.timerSeconds,
        config.preset,
        canonicalModuleSet(config.moduleTypes),
        data.gameId,
      ]
    );

    db.run("DELETE FROM modules WHERE game_id = ?", [data.gameId]);
    spawnModules(db, data.gameId, newSeed, config.moduleTypes);

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

    /* Refuse to arm a bomb with zero modules — there'd be nothing to
       defuse and the game would just tick down to a guaranteed loss.
       Custom configs are otherwise free to drop any module, but at
       least one has to remain. */
    const moduleCount = db
      .query("SELECT COUNT(*) AS cnt FROM modules WHERE game_id = ?")
      .get(data.gameId) as { cnt: number };
    if (moduleCount.cnt === 0) {
      return {
        ok: false as const,
        error: "Add at least one module before arming",
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
  if (lost) recordGameResult(gameId, "lost");
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
    recordGameResult(gameId, "won");
    return true;
  }
  return false;
}

/* Write a row to game_results when the game first enters a terminal
   state. Idempotent: the PRIMARY KEY on game_id and INSERT OR IGNORE
   make double-fire a no-op (which can happen if a strike + a final
   solve race each other). duration_ms is wall-clock between started_at
   and now; if for some reason started_at is null (e.g. never armed),
   it stays null. */
function recordGameResult(gameId: string, status: "won" | "lost") {
  const db = getDb();
  const row = db
    .query(
      "SELECT started_at, timer_seconds, preset, module_set FROM games WHERE id = ?"
    )
    .get(gameId) as
    | {
        started_at: number | null;
        timer_seconds: number;
        preset: string;
        module_set: string;
      }
    | null;
  if (!row) return;
  const now = Math.floor(Date.now() / 1000);
  /* Wall-clock since the bomb was armed. We CLAMP it to timer_seconds
     so the recorded duration matches what the player saw on the LED —
     for timer-expiry losses, checkTimer polls every 5s and can flip
     the status up to ~5s past the real expiry, which would otherwise
     log a duration of e.g. 5:03 for a 5:00 timer. */
  const elapsed = row.started_at !== null ? now - row.started_at : null;
  const durationMs =
    elapsed === null
      ? null
      : Math.max(0, Math.min(elapsed, row.timer_seconds)) * 1000;
  db.run(
    `INSERT OR IGNORE INTO game_results
       (game_id, preset, timer_seconds, module_set, status, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      gameId,
      row.preset,
      row.timer_seconds,
      row.module_set,
      status,
      durationMs,
    ]
  );
}

/* Histogram + percentile query for a given preset's WON games. Bin
   width is fixed at 5 s so the chart reads as integer seconds buckets;
   returned `bins` array gives counts per bin from 0 to timer_seconds.
   `percentile` is the requested duration's standing among wins (0-100,
   lower = faster). Returns null for custom games or empty datasets. */
export const getPresetDistribution = createServerFn({ method: "GET" })
  .validator(
    (data: { preset: Preset; mineDurationMs?: number | null }) => data
  )
  .handler(
    async ({
      data,
    }): Promise<
      | null
      | {
          preset: Preset;
          totalWins: number;
          totalLosses: number;
          binSeconds: number;
          bins: number[];
          minMs: number;
          maxMs: number;
          medianMs: number;
          /* Percentile of `mineDurationMs` among wins, lower = faster.
             null if mineDurationMs wasn't supplied or no comparable wins. */
          percentile: number | null;
        }
    > => {
      if (data.preset === "custom") return null;
      const db = getDb();
      const wins = db
        .query(
          "SELECT duration_ms FROM game_results WHERE preset = ? AND status = 'won' AND duration_ms IS NOT NULL"
        )
        .all(data.preset) as { duration_ms: number }[];
      const losses = db
        .query(
          "SELECT COUNT(*) as cnt FROM game_results WHERE preset = ? AND status = 'lost'"
        )
        .get(data.preset) as { cnt: number };
      if (wins.length === 0) {
        return {
          preset: data.preset,
          totalWins: 0,
          totalLosses: losses.cnt,
          binSeconds: 5,
          bins: [],
          minMs: 0,
          maxMs: 0,
          medianMs: 0,
          percentile: null,
        };
      }
      const sortedMs = wins.map((w) => w.duration_ms).sort((a, b) => a - b);
      const minMs = sortedMs[0];
      const maxMs = sortedMs[sortedMs.length - 1];
      const medianMs = sortedMs[Math.floor(sortedMs.length / 2)];

      const binSeconds = 5;
      const binWidthMs = binSeconds * 1000;
      const binCount = Math.max(1, Math.ceil(maxMs / binWidthMs) + 1);
      const bins = new Array<number>(binCount).fill(0);
      for (const ms of sortedMs) {
        const idx = Math.min(binCount - 1, Math.floor(ms / binWidthMs));
        bins[idx]++;
      }

      let percentile: number | null = null;
      if (typeof data.mineDurationMs === "number") {
        const m = data.mineDurationMs;
        /* count wins faster than (or equal to) mine — count <= gives
           the player credit for ties so their own row doesn't push them
           down a slot. */
        let faster = 0;
        for (const ms of sortedMs) {
          if (ms <= m) faster++;
          else break;
        }
        percentile = Math.round((faster / sortedMs.length) * 100);
      }

      return {
        preset: data.preset,
        totalWins: sortedMs.length,
        totalLosses: losses.cnt,
        binSeconds,
        bins,
        minMs,
        maxMs,
        medianMs,
        percentile,
      };
    }
  );

/* Look up a specific game's recorded result (duration + status) for the
   end-of-game overlay. Returns null if the game hasn't been recorded
   yet (terminal write should land just before the client polls, but
   the UI handles null gracefully). */
export const getGameResult = createServerFn({ method: "GET" })
  .validator((data: { gameId: string }) => data)
  .handler(
    async ({
      data,
    }): Promise<
      | null
      | {
          preset: Preset;
          status: "won" | "lost";
          durationMs: number | null;
        }
    > => {
      const db = getDb();
      const row = db
        .query(
          "SELECT preset, status, duration_ms FROM game_results WHERE game_id = ?"
        )
        .get(data.gameId) as
        | { preset: string; status: "won" | "lost"; duration_ms: number | null }
        | null;
      if (!row) return null;
      return {
        preset: row.preset as Preset,
        status: row.status,
        durationMs: row.duration_ms,
      };
    }
  );

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
    type: row.type as "wire" | "button" | "symbols" | "simon" | "maze" | "memory" | "morse" | "password" | "compWires" | "whoFirst" | "wireSeq",
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

// Defuser releases the held button. The client sends the literal
// integer they were SHOWING at the moment of release (`releasedAt`).
// The server applies the timing rule against THAT value — never against
// its own clock. This makes the result match exactly what the player
// saw: no skew, no off-by-one from network/poll latency, no flicker.
export const releaseHold = createServerFn({ method: "POST" })
  .validator(
    (data: { gameId: string; moduleId: string; releasedAt: number }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };

    db.run("UPDATE modules SET state_json = ? WHERE id = ?", [
      JSON.stringify({ ...mod.state, isHolding: false }),
      data.moduleId,
    ]);

    const config = mod.config as ButtonModuleConfig;
    const correct = checkReleaseTiming(config, data.releasedAt);

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

/* Defuser-or-Expert pulls the plug — mark the bomb lost so the
   game-over overlay fires for both players. Idempotent: if the game's
   already in a terminal state we just no-op. */
export const giveUpGame = createServerFn({ method: "POST" })
  .validator((data: { gameId: string }) => data)
  .handler(async ({ data }) => {
    const db = getDb();
    const row = db
      .query("SELECT status FROM games WHERE id = ?")
      .get(data.gameId) as { status: string } | null;
    if (!row) return { ok: false as const };
    if (row.status === "active" || row.status === "waiting") {
      db.run("UPDATE games SET status = 'lost' WHERE id = ?", [data.gameId]);
      recordGameResult(data.gameId, "lost");
    }
    return { ok: true as const };
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
      recordGameResult(data.gameId, "lost");
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

// Wire Sequences — defuser cuts a wire at a slot index. Each wire's
// "should cut" rule is its colour's table entry for its 1-indexed
// occurrence count (1st red wire / 2nd red wire / etc.) combined
// with its printed letter. Cut is recorded either way (wire visibly
// stays severed); wrong cut → strike. Module solves when every
// wire that SHOULD have been cut is cut.
export const cutWireSeq = createServerFn({ method: "POST" })
  .validator(
    (data: { gameId: string; moduleId: string; slotIndex: number }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };

    const config = mod.config as WireSeqModuleConfig;
    if (!config.wires[data.slotIndex]) return { ok: false };
    const cut = mod.state.cutWireSeqs ?? [];
    if (cut.includes(data.slotIndex)) return { ok: false };

    const shouldCut = wireSeqShouldCut(config, data.slotIndex);
    const nextCut = [...cut, data.slotIndex];

    if (shouldCut) {
      db.run("UPDATE modules SET state_json = ? WHERE id = ?", [
        JSON.stringify({ ...mod.state, cutWireSeqs: nextCut }),
        data.moduleId,
      ]);
      /* Are all required cuts now made? */
      const allDone = config.wires.every((_, i) => {
        if (!wireSeqShouldCut(config, i)) return true;
        return nextCut.includes(i);
      });
      if (allDone) {
        db.run("UPDATE modules SET solved = 1 WHERE id = ?", [data.moduleId]);
        checkAllSolved(data.gameId);
        return { ok: true, correct: true, solved: true };
      }
      return { ok: true, correct: true };
    }

    db.run("UPDATE modules SET state_json = ?, struck = 1 WHERE id = ?", [
      JSON.stringify({ ...mod.state, cutWireSeqs: nextCut }),
      data.moduleId,
    ]);
    const { lost } = applyStrike(data.gameId);
    return { ok: true, correct: false, lost };
  });

// Who's On First — defuser presses one of the six button words. The
// correct word is the first word in the priority list for the
// "key" (button at the display's lookup position) that appears on
// any visible button. Wrong press → strike + stage resets to 0.
// Right press → stage advances; module solves when all WHO_STAGES
// done.
export const pressWhoFirst = createServerFn({ method: "POST" })
  .validator(
    (data: { gameId: string; moduleId: string; word: string }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const mod = loadModule(data.moduleId);
    if (!mod || mod.solved) return { ok: false };
    const config = mod.config as WhosOnFirstModuleConfig;
    const stageIdx = mod.state.whoStage ?? 0;
    const expected = getWhoSolution(config, stageIdx);
    if (data.word === expected) {
      const nextStage = stageIdx + 1;
      const solved = nextStage >= config.stages.length;
      if (solved) {
        db.run(
          "UPDATE modules SET solved = 1, state_json = ? WHERE id = ?",
          [
            JSON.stringify({ ...mod.state, whoStage: nextStage }),
            data.moduleId,
          ]
        );
        checkAllSolved(data.gameId);
        return { ok: true, correct: true, solved: true };
      }
      db.run("UPDATE modules SET state_json = ? WHERE id = ?", [
        JSON.stringify({ ...mod.state, whoStage: nextStage }),
        data.moduleId,
      ]);
      return { ok: true, correct: true };
    }
    /* Wrong — strike + reset to stage 0. */
    db.run("UPDATE modules SET struck = 1, state_json = ? WHERE id = ?", [
      JSON.stringify({ ...mod.state, whoStage: 0 }),
      data.moduleId,
    ]);
    const { lost } = applyStrike(data.gameId);
    return { ok: true, correct: false, lost };
  });

// Complicated Wires — defuser cuts a wire at a specific slot. The
// rule for that wire comes from looking up its Venn flags in the
// per-bomb decision table, then applying the resolved outcome against
// the bomb's serial + battery count. Correct cut → record + check
// solved (all should-cut wires are now cut). Wrong cut → strike, but
// the cut still records so the wire visibly stays severed.
export const cutCompWire = createServerFn({ method: "POST" })
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

    const config = mod.config as ComplicatedWiresModuleConfig;
    const wire = config.wires[data.slotIndex];
    if (!wire) return { ok: false };
    const cut = mod.state.cutCompWires ?? [];
    if (cut.includes(data.slotIndex)) return { ok: false };

    /* Battery count comes from the bomb's Button module config (the
       only place it lives). If there isn't one, treat as zero. */
    const buttonRow = db
      .query(
        "SELECT config_json FROM modules WHERE game_id = ? AND type = 'button' LIMIT 1"
      )
      .get(data.gameId) as { config_json: string } | null;
    let batteryCount = 0;
    if (buttonRow) {
      const btnCfg = JSON.parse(buttonRow.config_json) as {
        batteryCount: number;
      };
      batteryCount = btnCfg.batteryCount ?? 0;
    }

    const outcome = config.table[compWireKey(wire)];
    const shouldCut = compWireShouldCut(
      outcome,
      gameRow.serial_number,
      batteryCount
    );
    const nextCut = [...cut, data.slotIndex];

    if (shouldCut) {
      /* Correct. Persist the cut. If every should-cut wire is now
         present, mark the module solved. */
      db.run("UPDATE modules SET state_json = ? WHERE id = ?", [
        JSON.stringify({ ...mod.state, cutCompWires: nextCut }),
        data.moduleId,
      ]);
      const shouldCutSet = new Set<number>();
      for (let i = 0; i < config.wires.length; i++) {
        const o = config.table[compWireKey(config.wires[i])];
        if (compWireShouldCut(o, gameRow.serial_number, batteryCount)) {
          shouldCutSet.add(i);
        }
      }
      const allDone = [...shouldCutSet].every((i) => nextCut.includes(i));
      if (allDone) {
        db.run("UPDATE modules SET solved = 1 WHERE id = ?", [data.moduleId]);
        checkAllSolved(data.gameId);
        return { ok: true, correct: true, solved: true };
      }
      return { ok: true, correct: true };
    }

    /* Wrong cut — record it (the wire visibly fades) and strike. */
    db.run("UPDATE modules SET state_json = ?, struck = 1 WHERE id = ?", [
      JSON.stringify({ ...mod.state, cutCompWires: nextCut }),
      data.moduleId,
    ]);
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

/* ── Best-effort tracking for offline-first games ─────────────────────
   The game itself runs entirely client-side from the seed (deterministic,
   instant, works with no connection). These two endpoints let the client
   OPTIMISTICALLY mirror a game's lifecycle to the server when it happens
   to be online — a lobby when it's armed, and the result when it ends.
   Because everything is seed-derived, (seed, config, result) is a COMPLETE
   record: the server can regenerate the whole bomb from it. Both are
   INSERT OR IGNORE / idempotent, and the client fires them fire-and-forget
   (see src/lib/sync.ts) so a failure or being offline never affects play. */
export const trackLobby = createServerFn({ method: "POST" })
  .validator(
    (data: {
      gameId: string;
      seed: number;
      serial: string;
      preset: Preset;
      timerSeconds: number;
      moduleSet: string;
    }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    db.run(
      `INSERT OR IGNORE INTO games
        (id, seed, serial_number, status, timer_seconds, preset, module_set)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      [
        data.gameId,
        data.seed,
        data.serial,
        Math.max(60, Math.min(1800, Math.floor(data.timerSeconds || 300))),
        data.preset,
        data.moduleSet,
      ]
    );
    return { ok: true as const };
  });

export const trackResult = createServerFn({ method: "POST" })
  .validator(
    (data: {
      gameId: string;
      preset: Preset;
      timerSeconds: number;
      moduleSet: string;
      status: "won" | "lost";
      durationMs: number | null;
    }) => data
  )
  .handler(async ({ data }) => {
    const db = getDb();
    db.run(
      `INSERT OR IGNORE INTO game_results
        (game_id, preset, timer_seconds, module_set, status, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.gameId,
        data.preset,
        data.timerSeconds,
        data.moduleSet,
        data.status,
        data.durationMs,
      ]
    );
    db.run("UPDATE games SET status = ? WHERE id = ? AND status = 'active'", [
      data.status,
      data.gameId,
    ]);
    return { ok: true as const };
  });
