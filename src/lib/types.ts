export type WireColor = "red" | "blue" | "yellow" | "white" | "black";
export type ButtonColor = "red" | "blue" | "yellow" | "white";
export type ButtonLabel = "ABORT" | "DETONATE" | "HOLD" | "PRESS";
export type StripColor = "red" | "blue" | "yellow" | "white";
export type GameStatus = "waiting" | "active" | "won" | "lost";
export type PlayerRole = "defuser" | "expert";
export type ModuleType = "wire" | "button" | "symbols";

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
  releaseDigitPosition: "ones" | "tens" | "hundreds";
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
}

export interface Module {
  id: string;
  gameId: string;
  type: ModuleType;
  position: number;
  config: WireModuleConfig | ButtonModuleConfig | SymbolsModuleConfig;
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
  | { type: "symbolColumns"; columns: GeneratedSymbol[][] };
