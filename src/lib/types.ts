export type WireColor = "red" | "blue" | "yellow" | "white" | "black";
export type ButtonColor = "red" | "blue" | "yellow" | "white";
export type ButtonLabel = "ABORT" | "DETONATE" | "HOLD" | "PRESS";
export type StripColor = "red" | "blue" | "yellow" | "white";
export type SimonColor = "red" | "blue" | "yellow" | "green";
export type Direction = "up" | "down" | "left" | "right";
export type GameStatus = "waiting" | "active" | "won" | "lost";
/* defuser → operates the bomb (max ONE per room — the server bounces
   2nd-claim attempts back to spectator). expert → reads the manual.
   spectator → joins the bomb view but cannot interact with any module. */
export type PlayerRole = "defuser" | "expert" | "spectator";
export type ModuleType =
  | "wire"
  | "button"
  | "symbols"
  | "simon"
  | "maze"
  | "memory"
  | "morse"
  | "password"
  | "compWires"
  | "whoFirst"
  | "wireSeq";

export type Preset = "quick" | "standard" | "hardcore" | "custom";

/* The configuration for a single bomb — selected by the host in the
   lobby. Custom games are excluded from the global distribution / future
   leaderboard since their buckets would be too fragmented to compare.
   wire + button are always present (the basics); the rest can be toggled. */
export interface GameConfig {
  preset: Preset;
  timerSeconds: number;
  /* The module types that will be spawned, in the order they should
     appear. Always begins with "wire" and "button". */
  moduleTypes: ModuleType[];
}

export const ALL_OPTIONAL_MODULES: ModuleType[] = [
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

export const PRESET_CONFIGS: Record<
  Exclude<Preset, "custom">,
  GameConfig
> = {
  quick: {
    preset: "quick",
    timerSeconds: 180,
    moduleTypes: ["wire", "button", "symbols", "simon"],
  },
  standard: {
    preset: "standard",
    timerSeconds: 300,
    moduleTypes: ["wire", "button", "symbols", "simon", "memory", "morse"],
  },
  hardcore: {
    preset: "hardcore",
    timerSeconds: 600,
    moduleTypes: [
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
    ],
  },
};

/* Canonical signature including instance counts: type repeated N times
   if the bomb has N of it. Sorted by type name then joined — so two
   configs with the same per-type counts always produce the same key,
   regardless of the order the host toggled things on. Used both as the
   stored module_set value on game_results and as the preset-detection
   key. */
export function canonicalModuleSet(types: ModuleType[]): string {
  return [...types].sort().join(",");
}

export const MAX_INSTANCES_PER_TYPE = 3;

/* Compute which named preset (if any) a config matches. Used to stamp
   `preset` on game_results — any deviation from the three presets is
   "custom" and excluded from histograms. Counts matter: 2 symbols
   modules counts as a different shape than 1 even with the same set
   of types. */
export function detectPreset(config: {
  timerSeconds: number;
  moduleTypes: ModuleType[];
}): Preset {
  const canon = canonicalModuleSet(config.moduleTypes);
  for (const name of ["quick", "standard", "hardcore"] as const) {
    const p = PRESET_CONFIGS[name];
    if (
      p.timerSeconds === config.timerSeconds &&
      canonicalModuleSet(p.moduleTypes) === canon
    ) {
      return name;
    }
  }
  return "custom";
}

/* Build a moduleTypes array from a (type → count) map, expanding into
   the canonical type order. */
export function moduleTypesFromCounts(
  counts: Partial<Record<ModuleType, number>>
): ModuleType[] {
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
  const out: ModuleType[] = [];
  for (const t of order) {
    const n = Math.max(0, Math.min(MAX_INSTANCES_PER_TYPE, counts[t] ?? 0));
    for (let i = 0; i < n; i++) out.push(t);
  }
  return out;
}

/* Inverse — used by the lobby UI to render +/- count pickers. */
export function moduleCounts(
  types: ModuleType[]
): Record<ModuleType, number> {
  const out: Record<ModuleType, number> = {
    wire: 0,
    button: 0,
    symbols: 0,
    simon: 0,
    maze: 0,
    memory: 0,
    morse: 0,
    password: 0,
    compWires: 0,
    whoFirst: 0,
    wireSeq: 0,
  };
  for (const t of types) out[t]++;
  return out;
}

/* Rough seconds-per-instance budget per module. Calibrated against the
   three named presets: Quick (4 mods) → ~3min, Standard (6) → ~5min,
   Hardcore (8) → ~8min. Used by the lobby Advanced UI to auto-suggest
   a timer whenever the module list changes; the host can still drag
   the slider to override afterwards. */
const PER_MODULE_SECONDS: Record<ModuleType, number> = {
  wire: 25,
  button: 30,
  symbols: 50,
  simon: 60,
  maze: 70,
  memory: 65,
  morse: 55,
  password: 50,
  compWires: 55,
  whoFirst: 70,
  wireSeq: 55,
};
const TIMER_BASELINE_SECONDS = 30;

/* Recommended timer for a given module list, clamped to the slider's
   valid range and rounded to the slider's 30s step so the suggested
   value lines up exactly with a tick. */
export function estimateTimerSeconds(types: ModuleType[]): number {
  let total = TIMER_BASELINE_SECONDS;
  for (const t of types) total += PER_MODULE_SECONDS[t] ?? 30;
  const rounded = Math.round(total / 30) * 30;
  return Math.max(60, Math.min(900, rounded));
}

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
  cutCompWires?: number[];       // complicated-wires module: which slots have been cut
  whoStage?: number;             // whos-on-first: current 0-indexed stage (0..WHO_STAGES-1)
  cutWireSeqs?: number[];        // wire-sequences module: which slot indices have been cut
}

// Complicated Wires — KTaNE-style Venn-diagram cut/skip puzzle.
// Each wire on the bomb has four optional flags: red colour, blue
// colour, a star next to the slot, and an LED above it. There are
// 2^4 = 16 combinations of those flags; each combination maps to one
// of five outcomes:
//   C — cut
//   D — don't cut
//   S — cut if the serial's last digit is odd
//   B — cut if the bomb has 2+ batteries
//   V — cut if the serial contains a vowel
//
// Procedural advance over KTaNE (which has ONE fixed Venn table for
// every bomb): the 16-cell table is freshly randomised per module
// from a seed, so the manual is unique each game.
export type CompWireOutcome = "C" | "D" | "S" | "B" | "V";

export interface CompWire {
  hasRed: boolean;
  hasBlue: boolean;
  hasStar: boolean;
  hasLED: boolean;
}

export interface ComplicatedWiresModuleConfig {
  /* 4-6 wires; their slot order is the cut order. */
  wires: CompWire[];
  /* 16-entry lookup keyed on the wire's flag combo. The key is a
     4-bit packed number — bit 0 = LED, bit 1 = star, bit 2 = blue,
     bit 3 = red — so `table[wire.flagsKey]` gives the outcome. */
  table: CompWireOutcome[];
}

/* Pack a wire's flags into the 0-15 table key. */
export function compWireKey(w: CompWire): number {
  return (
    (w.hasRed ? 8 : 0) |
    (w.hasBlue ? 4 : 0) |
    (w.hasStar ? 2 : 0) |
    (w.hasLED ? 1 : 0)
  );
}

// Who's On First — KTaNE cross-reference. The bomb shows a small
// "display" word + 6 button-words arranged 2×3. Procedure:
//   1. Look up the display word in the *position* table → tells you
//      which button position (1-6) to read.
//   2. Read the word printed on that button → that's a "key" word.
//   3. Look up the key word in the *priority* table → an ordered list.
//   4. Press the first word in that priority list that appears on
//      any of the 6 buttons.
//
// Solve 3 stages of this in a row to defuse. Wrong press → strike +
// stage resets to 1 with a fresh display + button set.
//
// Procedural advance over KTaNE: KTaNE has a fixed 28-entry display
// table and 28 priority lists baked into the manual; here both are
// freshly randomised per bomb from the seed, plus the wordlist itself
// is sampled from a bigger pool so the manual feels unique each game.
export const WHO_BUTTON_COUNT = 6;
export const WHO_STAGES = 3;
/* Length of each priority list in the manual — short enough to scan
   fast, long enough that the solution isn't always the same. */
export const WHO_PRIORITY_LEN = 10;

export interface WhoStage {
  /* Word shown on the small LED display this stage. */
  display: string;
  /* The six words printed on the buttons, in DOM order (1=top-left,
     2=top-right, 3=mid-left, …). */
  buttons: string[];
}

export interface WhosOnFirstModuleConfig {
  /* The per-bomb word pool — only words from this list appear on the
     display or buttons. Surfaced in the manual via the lookup tables
     below. */
  pool: string[];
  /* For each pool word: which button POSITION (1-6) to read when the
     display shows it. */
  displayPosTable: Record<string, number>;
  /* For each pool word: an ordered priority list of pool words. To
     resolve a stage, look up the word on the position the display
     pointed at, then press the first word from this list that's on
     any of the visible buttons. */
  priorityTable: Record<string, string[]>;
  /* Pre-generated stages — three of them. Generated at bomb-creation
     time so the same lookup tables always produce a valid solvable
     stage; the bomb just walks through them on solve. */
  stages: WhoStage[];
}

// Wire Sequences — KTaNE-style "long ladder of wires" puzzle.
// Each wire has a colour (red, blue, or black) and one of three target
// letters (A, B, or C) printed next to it. The rule for whether to cut
// it depends on the RUNNING OCCURRENCE COUNT of that colour: the 1st
// red wire follows one rule, the 2nd red wire another, etc. Up to 9
// of each colour in the module.
//
// Procedural advance over KTaNE: KTaNE's rule tables are fixed (the
// canonical manual has one table per colour). Here, every Wire
// Sequences module gets a freshly randomised set of three 9-row
// tables.
export type WireSeqColor = "red" | "blue" | "black";
export type WireSeqLetter = "A" | "B" | "C";

export interface WireSeqWire {
  color: WireSeqColor;
  letter: WireSeqLetter;
}

export interface WireSeqModuleConfig {
  wires: WireSeqWire[];
  /* Per colour: 9 rows, indexed by occurrence (1st-9th). Each row is
     a SET of letters: if the current wire's letter is in that row's
     set, cut it. Empty set = don't cut anything. */
  tables: Record<WireSeqColor, WireSeqLetter[][]>;
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
  // index y*MAZE_SIZE + x. Walls packed via MAZE_W_* bits. This is the
  // full ground truth; rendering filters by player ownership below.
  walls: number[];
  // Per-cell mask of which walls the DEFUSER sees on the bomb (~33%
  // of present walls). Stored as the same MAZE_W_* bit packing as
  // `walls`; render with `(walls[i] & defuserWalls[i])`. The Expert
  // sees the remaining walls in the manual: `walls[i] & ~defuserWalls[i]`.
  // For each shared edge both adjacent cells' bits are set consistently,
  // so the edge belongs to exactly one player.
  defuserWalls: number[];
  // Two cells with green identification markers — uniquely identify this
  // maze in the manual's pool.
  markers: [MazeCell, MazeCell];
}

/* Fraction of present walls assigned to the defuser; the remainder go
   to the expert. ~33% / ~67%. */
export const MAZE_DEFUSER_WALL_FRACTION = 1 / 3;

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

export const PASSWORD_DICT_SIZE = 8;

export interface PasswordModuleConfig {
  /* Per-column letter pool, uppercase. Length PASSWORD_LETTERS_PER_COL. */
  columns: string[][];
  /* The per-bomb dictionary the Expert sees — PASSWORD_DICT_SIZE words
     randomly sampled from the master pool. Always includes the target
     plus PASSWORD_DICT_SIZE-1 random decoys. */
  dictionary: string[];
  /* Subset of `dictionary` that can actually be spelled from `columns`
     — the Expert spots this by checking each word against the pools.
     Server accepts any of these on SUBMIT. */
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
  /* One rule per possible display value (1..4). The active rule for the
     stage is rulesByDisplay[display - 1]. The manual surfaces all four
     so the player can look up whatever display happens to appear. */
  rulesByDisplay: MemoryRule[];
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
    | PasswordModuleConfig
    | ComplicatedWiresModuleConfig
    | WhosOnFirstModuleConfig
    | WireSeqModuleConfig;
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
  /* The host's configuration choice. preset+moduleTypes determine which
     modules spawn on createGame/restartGame; surfaced here so the lobby
     can show + edit it pre-start, and so the GameOver overlay can fetch
     the right distribution bucket. */
  preset: Preset;
  moduleTypes: ModuleType[];
}

export interface GameState {
  game: Game;
  players: {
    role: PlayerRole;
    joinedAt: number;
    /* Display name when the session is signed in, otherwise null. */
    username: string | null;
    isMe: boolean;
  }[];
  modules: Module[];
  timeRemaining: number;
  myRole: PlayerRole | null;
}

export interface ManualPage {
  /* "cover" and "toc" are special front-matter pages with bespoke
     rendering. The rest are module references keyed on moduleType. */
  kind?: "cover" | "toc" | "module";
  moduleType?: ModuleType;
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
  | { type: "morseAlphabet" }
  | { type: "morseTable"; pool: MorseEntry[] }
  | { type: "passwordDict"; words: string[] }
  | { type: "compWireTable"; table: CompWireOutcome[] }
  | {
      type: "whoTables";
      pool: string[];
      displayPosTable: Record<string, number>;
      priorityTable: Record<string, string[]>;
    }
  | {
      type: "wireSeqTables";
      tables: Record<WireSeqColor, WireSeqLetter[][]>;
    };
