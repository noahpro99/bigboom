export type WireColor = "red" | "blue" | "yellow" | "white" | "black";
export type ButtonColor = "red" | "blue" | "yellow" | "white";
export type ButtonLabel = "ABORT" | "DETONATE" | "HOLD" | "PRESS";
export type StripColor = "red" | "blue" | "yellow" | "white";
export type SimonColor = "red" | "blue" | "yellow" | "green";
export type Direction = "up" | "down" | "left" | "right";
export type GameStatus = "waiting" | "active" | "won" | "lost";
export type PlayerRole = "defuser" | "expert";
export type ModuleType =
  | "wire"
  | "button"
  | "symbols"
  | "simon"
  | "maze"
  | "memory"
  | "morse"
  | "password";

// A slot is a position on the wire module. It either holds a coloured wire or
// is empty. Slots count from position 1 at the top.
export type Slot = { color: WireColor } | null;

// Conditions form a tree — leaves are atoms (facts about the bomb), internal
// nodes are logical operators that combine sub-conditions.
//
// Wire-counting atoms always refer to the *actual* wires present (filled
// slots). "First wire" / "last wire" mean the first/last filled slot.
// Position-based atoms (slotIs, slotIsEmpty) address a specific slot index.
export type AtomicWireCondition =
  | { type: "serialOdd" }
  | { type: "serialEven" }
  | { type: "wireCountEq"; n: number }
  | { type: "wireCountGte"; n: number }
  | { type: "wireCountLte"; n: number }
  | { type: "wireCountGt"; n: number }
  | { type: "wireCountLt"; n: number }
  | { type: "wireCountOdd" }
  | { type: "wireCountEven" }
  | { type: "colorCountEq"; color: WireColor; n: number }
  | { type: "colorCountGte"; color: WireColor; n: number }
  | { type: "noWiresOfColor"; color: WireColor }
  | { type: "lastWireIs"; color: WireColor }
  | { type: "firstWireIs"; color: WireColor }
  | { type: "slotIs"; position: number; color: WireColor } // 1-indexed
  | { type: "slotIsEmpty"; position: number };

export type CompoundWireCondition =
  | { type: "and"; left: WireCondition; right: WireCondition }
  | { type: "or"; left: WireCondition; right: WireCondition }
  | { type: "xor"; left: WireCondition; right: WireCondition }
  | { type: "nand"; left: WireCondition; right: WireCondition }
  | { type: "nor"; left: WireCondition; right: WireCondition }
  | { type: "not"; inner: WireCondition };

export type WireCondition =
  | AtomicWireCondition
  | CompoundWireCondition
  | { type: "otherwise" };

export interface WireRule {
  condition: WireCondition;
  conditionText: string; // human-readable rendering for the manual
  cutIndex: number; // slot index — server uses this to validate the cut
  cutText: string; // manual display, e.g. "the 3rd wire" or "the wire in position 5"
}

export interface WireModuleConfig {
  slots: Slot[]; // total positions; null entries are empty slots
  rules: WireRule[];
}

export interface ButtonImmediateRule {
  color: ButtonColor;
  label: ButtonLabel;
}

export interface StripRule {
  stripColor: StripColor;
  // The timer's ONES digit (0–9). The hold puzzle resolves in <10 seconds.
  releaseValue: number;
}

// One procedurally-generated glyph.
// paths are SVG path `d` strings drawn inside a 0 0 100 100 viewBox.
export interface GeneratedSymbol {
  id: string;      // stable identifier used for client/server validation
  paths: string[]; // SVG path strings (drawn at viewBox 0..100)
}

export interface SymbolsModuleConfig {
  // 4-8 columns of symbols. Every symbol is globally unique, so the 4 active
  // ones uniquely identify which column they came from.
  columns: GeneratedSymbol[][];
  // Exactly 4 symbols shown on the bomb, in the (random) visual order they
  // appear on the device. They all live in exactly one of `columns`.
  activeSymbols: GeneratedSymbol[];
}

export interface ButtonModuleConfig {
  color: ButtonColor;
  label: ButtonLabel;
  batteryCount: number;
  indicatorLabel: string;
  indicatorLit: boolean;
  releaseImmediatelyRules: ButtonImmediateRule[];
  holdBatteryThreshold: number;
  holdBatteryLabel: ButtonLabel;
  stripRules: StripRule[];
  actualStripColor: StripColor;
}

export interface ModuleState {
  cutWires?: number[];
  isHolding?: boolean;
  solved?: boolean;
  pressedIds?: string[]; // symbols module: ids correctly pressed so far (in order)
  simonPressed?: number; // simon module: how many flashes correctly pressed
  mazePos?: MazeCell;    // maze module: current cell (defaults to config.start)
  mazeTrail?: MazeCell[]; // maze module: cells visited so far (for trail display)
  memoryHistory?: MemoryPress[]; // memory module: presses recorded per solved stage
  morseFreqIndex?: number;       // morse module: currently-dialled frequency index
  passwordDials?: number[];      // password module: per-column letter index (0..LETTERS-1)
}

// Maze — a 6x6 grid of cells with walls between cells. Walls are stored
// as bitsets per cell: each cell has up to 4 walls, packed into the low
// 4 bits in N/E/S/W order. (Wall presence is symmetric: if cell A has
// wall on its east side, cell B = A+(1,0) also has wall on its west.
// The generator maintains this invariant.)
//
// MORE procedural than the KTaNE original (which has 9 hard-coded mazes
// — the same ones in every game): we generate the whole maze pool from
// the seed via randomized DFS, plus the per-maze marker pair, start, and
// goal. Player matches the 2 green markers on the bomb to the matching
// maze in the manual, then traces a path from white (current) to red (goal).
export const MAZE_SIZE = 6;
export const MAZE_POOL = 9;
export const MAZE_W_N = 1;
export const MAZE_W_E = 2;
export const MAZE_W_S = 4;
export const MAZE_W_W = 8;

export interface MazeCell {
  x: number; // 0..MAZE_SIZE-1
  y: number; // 0..MAZE_SIZE-1
}

export interface MazeData {
  // Flat array of length MAZE_SIZE*MAZE_SIZE — walls for cell (x,y) at
  // index y*MAZE_SIZE + x. Walls packed via MAZE_W_* bits.
  walls: number[];
  // Two cells with green identification markers — uniquely identify this
  // maze in the manual's pool.
  markers: [MazeCell, MazeCell];
}

export interface MazeModuleConfig {
  // The whole pool. The expert finds the maze whose `markers` match
  // what's drawn on the bomb. All mazes share the same generator seed
  // so the pool is reproducible from the game seed.
  pool: MazeData[];
  // Which entry in `pool` is the active maze for this module.
  activeIndex: number;
  // Where the player starts (white circle) and where they need to reach
  // (red triangle). Both are cells in the active maze.
  start: MazeCell;
  goal: MazeCell;
}

// Password — 5 letter dials. Each dial cycles through 6 candidate
// letters; only one combination spells a word from a per-bomb
// dictionary. Press SUBMIT once spelled.
//
// Procedural advance over KTaNE: KTaNE has 35 fixed words and a fixed
// per-column letter draw algorithm. Here, both the dictionary subset
// and the per-column decoy letters come from the seed, so the manual's
// word list is unique per bomb.
export const PASSWORD_COLS = 5;
export const PASSWORD_LETTERS_PER_COL = 6;

export interface PasswordModuleConfig {
  /* Per-column letter pool, uppercase. Length PASSWORD_LETTERS_PER_COL. */
  columns: string[][];
  /* Words from the per-bomb dictionary that can actually be spelled
     from `columns` (uppercase). The defuser sees no list — this is
     surfaced only on the manual. Server accepts any of these. */
  acceptedWords: string[];
}

// Morse Code — a single light flashes a 5-letter word in Morse on
// repeat. The defuser has a frequency dial (3.500–3.600 MHz, 5 kHz
// steps) and a transmit button. Word↔frequency map and the active
// word are seed-derived; the whole pool of (word, frequency) pairs
// shows up in the manual.
//
// Procedural advance over KTaNE: KTaNE has a hard-coded list of 16
// words/frequencies that's identical every game. Here the per-bomb
// pool is sampled from a larger dictionary, the frequency assignments
// are randomised, and the active word is too.
export const MORSE_FREQS = [
  3.505, 3.510, 3.515, 3.520, 3.525, 3.530, 3.535, 3.540, 3.545,
  3.550, 3.555, 3.560, 3.565, 3.570, 3.575, 3.580, 3.585, 3.590,
  3.595, 3.600,
];
export const MORSE_POOL_SIZE = 16;

export interface MorseEntry {
  word: string;     // upper-case 5–6 letters
  freqIndex: number; // index into MORSE_FREQS
}

export interface MorseModuleConfig {
  // Active word — that's what the bomb's light is flashing.
  activeIndex: number; // index into `pool`
  pool: MorseEntry[];  // MORSE_POOL_SIZE entries — manual table
}

// Memory — five-stage module. Each stage shows a "display" number and
// four buttons labelled 1-4 (the labels are PERMUTED per stage — the
// position of "1" moves between stages). The rule for what to press is
// keyed on the stage and may reference prior stages, e.g. "press the
// same position you pressed in stage 2" or "press the button labelled 3".
//
// Procedural advance over the KTaNE original: in KTaNE the rule table
// is fixed; here, the rules — including which prior-stage references
// they use — are picked from the seed. The manual lists exactly the
// rules in play for this bomb, no memorisation between games.
export const MEMORY_STAGES = 5;
export const MEMORY_SLOTS = 4;

export type MemoryRule =
  | { type: "pos"; value: number }   // press position N (1..4)
  | { type: "label"; value: number } // press button labelled N
  | { type: "samePos"; stage: number }   // press same position as stage K (0-indexed, < current)
  | { type: "sameLabel"; stage: number } // press same label as stage K
  | { type: "display" };             // press position equal to the displayed number

export interface MemoryStageConfig {
  /* The label permutation for this stage — labels[i] is the label at
     position i+1. labels is always a permutation of [1,2,3,4]. */
  labels: number[];
  /* The number shown on the display this stage. */
  display: number;
  /* The rule to apply this stage. */
  rule: MemoryRule;
}

export interface MemoryModuleConfig {
  stages: MemoryStageConfig[]; // length MEMORY_STAGES
}

export interface MemoryPress {
  position: number; // 1..4
  label: number;    // 1..4
}

// Simon — a flash sequence the bomb cycles through, plus a per-game
// substitution lookup. The mapping table is procedural (different every
// bomb) so the manual is never the same twice — a level above the KTaNE
// original, where the same 6 mappings appear in every game.
//
// To resolve "what to press next": find the cell in `tables` for your
// current (serial has vowel, strikes) state, then look up the next
// flashed colour in that cell's mapping. There are 6 cells:
//   index = strikes * 2 + (serialHasVowel ? 1 : 0)
// strikes is clamped to [0, 2].
export interface SimonModuleConfig {
  sequence: SimonColor[]; // 3–5 colours, the flashed sequence
  tables: Array<Record<SimonColor, SimonColor>>; // length 6
}

export interface Module {
  id: string;
  gameId: string;
  type: ModuleType;
  position: number;
  config:
    | WireModuleConfig
    | ButtonModuleConfig
    | SymbolsModuleConfig
    | SimonModuleConfig
    | MazeModuleConfig
    | MemoryModuleConfig
    | MorseModuleConfig
    | PasswordModuleConfig;
  state: ModuleState;
  solved: boolean;
  struck: boolean;
}

export interface Game {
  id: string;
  seed: number;
  serial: string;
  status: GameStatus;
  timerSeconds: number;
  startedAt: number | null;
  strikes: number;
  maxStrikes: number;
  createdAt: number;
}

export interface GameState {
  game: Game;
  players: { role: PlayerRole; joinedAt: number }[];
  modules: Module[];
  timeRemaining: number;
  myRole: PlayerRole | null;
}

export interface ManualPage {
  moduleType: ModuleType;
  title: string;
  sections: ManualSection[];
}

export interface ManualSection {
  heading: string;
  content: ManualContent[];
}

export type ManualContent =
  | { type: "paragraph"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "rule"; condition: string; action: string }
  | { type: "symbolColumns"; columns: GeneratedSymbol[][] }
  | { type: "simonTable"; tables: Array<Record<SimonColor, SimonColor>> }
  | { type: "mazeGrid"; pool: MazeData[] }
  | { type: "memoryStages"; stages: MemoryStageConfig[] }
  | { type: "morseTable"; pool: MorseEntry[] }
  | { type: "passwordDict"; words: string[]; columns: string[][] };
