/* Client-side game engine for OFFLINE play.
 *
 * The server (src/server/game.ts) validates moves against the bomb's
 * seed-derived solution and stores state in SQLite. Offline play has no
 * server, so this module reproduces that exact logic against an in-memory
 * GameState. Both peers run this independently from the same seed; because
 * generation + validation are deterministic, the Defuser's local bomb and
 * the Expert's local manual always agree. No network, no sync.
 *
 * Every `apply*` function returns a NEW GameState (immutable update) plus
 * the same `{ correct, lost, solved }` result shape the server fns return,
 * so the UI can play the right sound and react identically. */
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
  generateWireSeqModule,
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
  getWhoSolution,
  wireSeqShouldCut,
} from "./generator";
import {
  MORSE_FREQS,
  PASSWORD_COLS,
  PASSWORD_LETTERS_PER_COL,
  compWireKey,
} from "./types";
import type {
  GameState,
  Module,
  ModuleType,
  ModuleState,
  PlayerRole,
  Direction,
  MazeCell,
  MemoryPress,
  WireModuleConfig,
  ButtonModuleConfig,
  SymbolsModuleConfig,
  SimonModuleConfig,
  MazeModuleConfig,
  MemoryModuleConfig,
  MorseModuleConfig,
  PasswordModuleConfig,
  ComplicatedWiresModuleConfig,
  WhosOnFirstModuleConfig,
  WireSeqModuleConfig,
} from "./types";
import type { OfflineMatch } from "./offlineCode";

const MAX_STRIKES = 3;

/* Per-instance seed derivation — copied verbatim from src/server/game.ts
   so an offline bomb is byte-identical to the online one for the same
   seed + module list. */
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
  return (baseSeed + TYPE_SEED_SALT[type] + instanceIdx * 7919) >>> 0;
}

function spawnModules(seed: number, moduleTypes: ModuleType[]): Module[] {
  const seenCount: Record<ModuleType, number> = {
    wire: 0, button: 0, symbols: 0, simon: 0,
    maze: 0, memory: 0, morse: 0, password: 0, compWires: 0, whoFirst: 0, wireSeq: 0,
  };
  const symbolsCount = moduleTypes.filter((t) => t === "symbols").length;
  const sharedSymbolsColumns =
    symbolsCount > 0 ? generateSymbolsColumns(seed) : null;

  const modules: Module[] = [];
  let pos = 0;
  for (const type of moduleTypes) {
    const i = seenCount[type]++;
    const iseed = instanceSeed(seed, type, i);
    let config: Module["config"];
    if (type === "wire") {
      config = generateWireModule(seed);
    } else if (type === "button") {
      config = generateButtonModule(seed);
    } else if (type === "symbols") {
      config = generateSymbolsModule(iseed, sharedSymbolsColumns!);
    } else if (type === "simon") {
      config = generateSimonModule(seed, iseed);
    } else if (type === "maze") {
      config = generateMazeModule(seed, iseed);
    } else if (type === "memory") {
      config = generateMemoryModule(seed, iseed);
    } else if (type === "morse") {
      config = generateMorseModule(seed, iseed);
    } else if (type === "password") {
      config = generatePasswordModule(seed);
    } else if (type === "compWires") {
      config = generateComplicatedWiresModule(seed, iseed);
    } else if (type === "whoFirst") {
      config = generateWhosOnFirstModule(seed, iseed);
    } else if (type === "wireSeq") {
      config = generateWireSeqModule(seed, iseed);
    } else {
      continue;
    }
    modules.push({
      id: `m${pos}`,
      gameId: "offline",
      type,
      position: pos,
      config,
      state: {},
      solved: false,
      struck: false,
    });
    pos++;
  }
  return modules;
}

/* Build a fresh, ARMED offline game from a match + the role this device
   is playing. status starts "active" with the timer running — offline has
   no lobby gating, so arming and starting are the same moment. */
export function createOfflineGame(
  match: OfflineMatch,
  role: PlayerRole,
  gameId = "offline"
): GameState {
  const serial = generateSerialNumber(match.seed);
  const modules = spawnModules(match.seed, match.moduleTypes);
  const now = Math.floor(Date.now() / 1000);
  return {
    game: {
      id: gameId,
      seed: match.seed,
      serial,
      status: "active",
      timerSeconds: match.timerSeconds,
      startedAt: now,
      strikes: 0,
      maxStrikes: MAX_STRIKES,
      createdAt: now,
      preset: match.preset,
      moduleTypes: match.moduleTypes,
    },
    players: [{ role, joinedAt: now, username: null, isMe: true }],
    modules,
    timeRemaining: match.timerSeconds,
    myRole: role,
  };
}

// ---- internal immutable helpers ----

type Result = { correct?: boolean; lost?: boolean; solved?: boolean };
type Outcome = { state: GameState; result: Result };

function batteryCount(state: GameState): number {
  const btn = state.modules.find((m) => m.type === "button");
  return btn ? (btn.config as ButtonModuleConfig).batteryCount ?? 0 : 0;
}

/* Recompute strikes / status after a module change. Mirrors the server's
   applyStrike + checkAllSolved: a strike that hits maxStrikes loses; all
   modules solved wins. */
function settle(
  state: GameState,
  modules: Module[],
  struck: boolean
): GameState {
  let strikes = state.game.strikes + (struck ? 1 : 0);
  let status = state.game.status;
  if (struck && strikes >= state.game.maxStrikes) {
    status = "lost";
  } else if (modules.every((m) => m.solved)) {
    status = "won";
  }
  return {
    ...state,
    game: { ...state.game, strikes, status },
    modules,
  };
}

/* Apply a state/solved/struck patch to one module by id and settle the
   game. `struck` drives the strike + loss logic. */
function patch(
  state: GameState,
  moduleId: string,
  next: { state?: ModuleState; solved?: boolean; struck?: boolean }
): GameState {
  const modules = state.modules.map((m) =>
    m.id === moduleId
      ? {
          ...m,
          state: next.state ?? m.state,
          solved: next.solved ?? m.solved,
          struck: next.struck ?? m.struck,
        }
      : m
  );
  return settle(state, modules, next.struck === true);
}

function find(state: GameState, moduleId: string): Module | undefined {
  return state.modules.find((m) => m.id === moduleId);
}

/* Guard: only act on a live game + an unsolved module. */
function playable(state: GameState, moduleId: string): Module | null {
  if (state.game.status !== "active") return null;
  const mod = find(state, moduleId);
  if (!mod || mod.solved) return null;
  return mod;
}

const noop = (state: GameState): Outcome => ({ state, result: { correct: undefined } });

// ---- actions (ports of the server fns in src/server/game.ts) ----

export function applyCutWire(
  state: GameState,
  moduleId: string,
  slotIndex: number
): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  const config = mod.config as WireModuleConfig;
  if (!config.slots[slotIndex]) return noop(state);

  const correct = getWireSolution(config, state.game.serial);
  const cutWires = [...(mod.state.cutWires ?? []), slotIndex];
  if (slotIndex === correct) {
    return {
      state: patch(state, moduleId, { state: { ...mod.state, cutWires }, solved: true }),
      result: { correct: true },
    };
  }
  const next = patch(state, moduleId, {
    state: { ...mod.state, cutWires },
    struck: true,
  });
  return { state: next, result: { correct: false, lost: next.game.status === "lost" } };
}

export function applyTapButton(state: GameState, moduleId: string): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  const config = mod.config as ButtonModuleConfig;
  if (getButtonAction(config) === "tap") {
    return {
      state: patch(state, moduleId, { solved: true }),
      result: { correct: true },
    };
  }
  const next = patch(state, moduleId, { struck: true });
  return { state: next, result: { correct: false, lost: next.game.status === "lost" } };
}

export function applyStartHold(state: GameState, moduleId: string): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  return {
    state: patch(state, moduleId, { state: { ...mod.state, isHolding: true } }),
    result: {},
  };
}

export function applyReleaseHold(
  state: GameState,
  moduleId: string,
  releasedAt: number
): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  const config = mod.config as ButtonModuleConfig;
  const correct = checkReleaseTiming(config, releasedAt);
  const baseState = { ...mod.state, isHolding: false };
  if (correct) {
    return {
      state: patch(state, moduleId, { state: baseState, solved: true }),
      result: { correct: true },
    };
  }
  const next = patch(state, moduleId, { state: baseState, struck: true });
  return { state: next, result: { correct: false, lost: next.game.status === "lost" } };
}

export function applyPressSymbol(
  state: GameState,
  moduleId: string,
  symbolId: string
): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  const config = mod.config as SymbolsModuleConfig;
  const solution = getSymbolsSolution(config);
  const pressedIds: string[] = mod.state.pressedIds ?? [];
  const expectedNext = solution[pressedIds.length];
  if (symbolId === expectedNext) {
    const newPressed = [...pressedIds, symbolId];
    const solved = newPressed.length === solution.length;
    return {
      state: patch(state, moduleId, {
        state: { ...mod.state, pressedIds: newPressed },
        solved,
      }),
      result: { correct: true, solved },
    };
  }
  const next = patch(state, moduleId, {
    state: { ...mod.state, pressedIds: [] },
    struck: true,
  });
  return { state: next, result: { correct: false, lost: next.game.status === "lost" } };
}

export function applyPressSimon(
  state: GameState,
  moduleId: string,
  color: string
): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  const config = mod.config as SimonModuleConfig;
  const pressed = mod.state.simonPressed ?? 0;
  const expected = getSimonExpected(
    config,
    state.game.serial,
    state.game.strikes,
    pressed
  );
  if (color === expected) {
    const next = pressed + 1;
    const solved = next === config.sequence.length;
    return {
      state: patch(state, moduleId, {
        state: { ...mod.state, simonPressed: next },
        solved,
      }),
      result: { correct: true, solved },
    };
  }
  const next = patch(state, moduleId, {
    state: { ...mod.state, simonPressed: 0 },
    struck: true,
  });
  return { state: next, result: { correct: false, lost: next.game.status === "lost" } };
}

export function applyMoveMaze(
  state: GameState,
  moduleId: string,
  direction: Direction
): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  const config = mod.config as MazeModuleConfig;
  const active = config.pool[config.activeIndex];
  const current: MazeCell = mod.state.mazePos ?? config.start;
  const trail: MazeCell[] = mod.state.mazeTrail ?? [config.start];
  const nextCell = tryMazeMove(active.walls, current, direction);
  if (!nextCell) {
    const next = patch(state, moduleId, { struck: true });
    return { state: next, result: { correct: false, lost: next.game.status === "lost" } };
  }
  const newTrail = [...trail, nextCell];
  const reachedGoal = nextCell.x === config.goal.x && nextCell.y === config.goal.y;
  return {
    state: patch(state, moduleId, {
      state: { ...mod.state, mazePos: nextCell, mazeTrail: newTrail },
      solved: reachedGoal,
      struck: false,
    }),
    result: { correct: true, solved: reachedGoal },
  };
}

export function applyPressMemory(
  state: GameState,
  moduleId: string,
  position: number
): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  const config = mod.config as MemoryModuleConfig;
  const history: MemoryPress[] = mod.state.memoryHistory ?? [];
  const stageIdx = history.length;
  if (stageIdx >= config.stages.length) return noop(state);
  const stage = config.stages[stageIdx];
  const expected = getMemoryExpected(config, stageIdx, history);
  if (position === expected) {
    const press: MemoryPress = {
      position,
      label: stage.labels[position - 1],
    };
    const newHistory = [...history, press];
    const solved = newHistory.length === config.stages.length;
    return {
      state: patch(state, moduleId, {
        state: { ...mod.state, memoryHistory: newHistory },
        solved,
      }),
      result: { correct: true, solved },
    };
  }
  const next = patch(state, moduleId, {
    state: { ...mod.state, memoryHistory: [] },
    struck: true,
  });
  return { state: next, result: { correct: false, lost: next.game.status === "lost" } };
}

export function applyDialMorse(
  state: GameState,
  moduleId: string,
  freqIndex: number
): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  if (freqIndex < 0 || freqIndex >= MORSE_FREQS.length) return noop(state);
  return {
    state: patch(state, moduleId, {
      state: { ...mod.state, morseFreqIndex: freqIndex },
    }),
    result: {},
  };
}

export function applyTransmitMorse(state: GameState, moduleId: string): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  const config = mod.config as MorseModuleConfig;
  const current = mod.state.morseFreqIndex ?? 0;
  const expected = getMorseSolutionFreqIndex(config);
  if (current === expected) {
    return {
      state: patch(state, moduleId, { solved: true, struck: false }),
      result: { correct: true, solved: true },
    };
  }
  const next = patch(state, moduleId, { struck: true });
  return { state: next, result: { correct: false, lost: next.game.status === "lost" } };
}

export function applyCyclePassword(
  state: GameState,
  moduleId: string,
  col: number,
  delta: number
): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  if (col < 0 || col >= PASSWORD_COLS) return noop(state);
  const dials = mod.state.passwordDials ?? new Array(PASSWORD_COLS).fill(0);
  const cur = dials[col] ?? 0;
  const nextVal =
    (cur + delta + PASSWORD_LETTERS_PER_COL) % PASSWORD_LETTERS_PER_COL;
  const newDials = [...dials];
  newDials[col] = nextVal;
  return {
    state: patch(state, moduleId, {
      state: { ...mod.state, passwordDials: newDials },
    }),
    result: {},
  };
}

export function applySubmitPassword(state: GameState, moduleId: string): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  const config = mod.config as PasswordModuleConfig;
  const dials = mod.state.passwordDials ?? new Array(PASSWORD_COLS).fill(0);
  const attempt = config.columns.map((col, i) => col[dials[i] ?? 0]).join("");
  if (passwordIsCorrect(config, attempt)) {
    return {
      state: patch(state, moduleId, { solved: true, struck: false }),
      result: { correct: true, solved: true },
    };
  }
  const next = patch(state, moduleId, { struck: true });
  return { state: next, result: { correct: false, lost: next.game.status === "lost" } };
}

export function applyCutCompWire(
  state: GameState,
  moduleId: string,
  slotIndex: number
): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  const config = mod.config as ComplicatedWiresModuleConfig;
  const wire = config.wires[slotIndex];
  if (!wire) return noop(state);
  const cut = mod.state.cutCompWires ?? [];
  if (cut.includes(slotIndex)) return noop(state);

  const batteries = batteryCount(state);
  const outcome = config.table[compWireKey(wire)];
  const shouldCut = compWireShouldCut(outcome, state.game.serial, batteries);
  const nextCut = [...cut, slotIndex];

  if (shouldCut) {
    const shouldCutSet = new Set<number>();
    for (let i = 0; i < config.wires.length; i++) {
      const o = config.table[compWireKey(config.wires[i])];
      if (compWireShouldCut(o, state.game.serial, batteries)) shouldCutSet.add(i);
    }
    const allDone = [...shouldCutSet].every((i) => nextCut.includes(i));
    return {
      state: patch(state, moduleId, {
        state: { ...mod.state, cutCompWires: nextCut },
        solved: allDone,
      }),
      result: { correct: true, solved: allDone },
    };
  }
  const next = patch(state, moduleId, {
    state: { ...mod.state, cutCompWires: nextCut },
    struck: true,
  });
  return { state: next, result: { correct: false, lost: next.game.status === "lost" } };
}

export function applyPressWhoFirst(
  state: GameState,
  moduleId: string,
  word: string
): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  const config = mod.config as WhosOnFirstModuleConfig;
  const stageIdx = mod.state.whoStage ?? 0;
  const expected = getWhoSolution(config, stageIdx);
  if (word === expected) {
    const nextStage = stageIdx + 1;
    const solved = nextStage >= config.stages.length;
    return {
      state: patch(state, moduleId, {
        state: { ...mod.state, whoStage: nextStage },
        solved,
      }),
      result: { correct: true, solved },
    };
  }
  const next = patch(state, moduleId, {
    state: { ...mod.state, whoStage: 0 },
    struck: true,
  });
  return { state: next, result: { correct: false, lost: next.game.status === "lost" } };
}

export function applyCutWireSeq(
  state: GameState,
  moduleId: string,
  slotIndex: number
): Outcome {
  const mod = playable(state, moduleId);
  if (!mod) return noop(state);
  const config = mod.config as WireSeqModuleConfig;
  if (!config.wires[slotIndex]) return noop(state);
  const cut = mod.state.cutWireSeqs ?? [];
  if (cut.includes(slotIndex)) return noop(state);

  const shouldCut = wireSeqShouldCut(config, slotIndex);
  const nextCut = [...cut, slotIndex];
  if (shouldCut) {
    const allDone = config.wires.every((_, i) =>
      wireSeqShouldCut(config, i) ? nextCut.includes(i) : true
    );
    return {
      state: patch(state, moduleId, {
        state: { ...mod.state, cutWireSeqs: nextCut },
        solved: allDone,
      }),
      result: { correct: true, solved: allDone },
    };
  }
  const next = patch(state, moduleId, {
    state: { ...mod.state, cutWireSeqs: nextCut },
    struck: true,
  });
  return { state: next, result: { correct: false, lost: next.game.status === "lost" } };
}

/* Flip an active game to lost — used by the timer-expiry tick and the
   "pull the plug" button. Idempotent on terminal games. */
export function applyTimeout(state: GameState): GameState {
  if (state.game.status !== "active") return state;
  return { ...state, game: { ...state.game, status: "lost" } };
}

export function applyGiveUp(state: GameState): GameState {
  if (state.game.status !== "active" && state.game.status !== "waiting") {
    return state;
  }
  return { ...state, game: { ...state.game, status: "lost" } };
}
