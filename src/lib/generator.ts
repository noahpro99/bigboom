import type {
  WireModuleConfig,
  WireRule,
  WireCondition,
  AtomicWireCondition,
  Slot,
  ButtonModuleConfig,
  WireColor,
  ButtonColor,
  ButtonLabel,
  StripColor,
  SymbolsModuleConfig,
  GeneratedSymbol,
  ManualPage,
  SimonColor,
  SimonModuleConfig,
  MazeModuleConfig,
  MazeData,
  MazeCell,
  Direction,
  MemoryModuleConfig,
  MemoryStageConfig,
  MemoryRule,
  MemoryPress,
  MorseModuleConfig,
  MorseEntry,
  PasswordModuleConfig,
} from "./types";
import {
  MAZE_SIZE,
  MAZE_POOL,
  MAZE_W_N,
  MAZE_W_E,
  MAZE_W_S,
  MAZE_W_W,
  MEMORY_STAGES,
  MEMORY_SLOTS,
  MORSE_FREQS,
  MORSE_POOL_SIZE,
  PASSWORD_COLS,
  PASSWORD_LETTERS_PER_COL,
} from "./types";

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function pickN<T>(rng: () => number, arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => rng() - 0.5);
  return shuffled.slice(0, n);
}

const ALL_COLORS: WireColor[] = ["red", "blue", "yellow", "white", "black"];

// ---- Condition evaluation ----

function isSerialDigitOdd(serial: string): boolean {
  return getSerialLastDigit(serial) % 2 === 1;
}

function filledWires(slots: Slot[]): { color: WireColor }[] {
  return slots.filter((s): s is { color: WireColor } => s !== null);
}

export function evaluateWireCondition(
  cond: WireCondition,
  slots: Slot[],
  serial: string
): boolean {
  const wires = filledWires(slots);
  switch (cond.type) {
    case "serialOdd":
      return isSerialDigitOdd(serial);
    case "serialEven":
      return !isSerialDigitOdd(serial);
    case "wireCountEq":
      return wires.length === cond.n;
    case "wireCountGte":
      return wires.length >= cond.n;
    case "wireCountLte":
      return wires.length <= cond.n;
    case "wireCountGt":
      return wires.length > cond.n;
    case "wireCountLt":
      return wires.length < cond.n;
    case "wireCountOdd":
      return wires.length % 2 === 1;
    case "wireCountEven":
      return wires.length % 2 === 0;
    case "colorCountEq":
      return wires.filter((w) => w.color === cond.color).length === cond.n;
    case "colorCountGte":
      return wires.filter((w) => w.color === cond.color).length >= cond.n;
    case "noWiresOfColor":
      return wires.every((w) => w.color !== cond.color);
    case "lastWireIs": {
      if (wires.length === 0) return false;
      return wires[wires.length - 1].color === cond.color;
    }
    case "firstWireIs": {
      if (wires.length === 0) return false;
      return wires[0].color === cond.color;
    }
    case "slotIs": {
      const idx = cond.position - 1;
      if (idx < 0 || idx >= slots.length) return false;
      const s = slots[idx];
      return s !== null && s.color === cond.color;
    }
    case "slotIsEmpty": {
      const idx = cond.position - 1;
      if (idx < 0 || idx >= slots.length) return false;
      return slots[idx] === null;
    }
    case "and":
      return (
        evaluateWireCondition(cond.left, slots, serial) &&
        evaluateWireCondition(cond.right, slots, serial)
      );
    case "or":
      return (
        evaluateWireCondition(cond.left, slots, serial) ||
        evaluateWireCondition(cond.right, slots, serial)
      );
    case "xor": {
      const l = evaluateWireCondition(cond.left, slots, serial);
      const r = evaluateWireCondition(cond.right, slots, serial);
      return l !== r;
    }
    case "nand":
      return !(
        evaluateWireCondition(cond.left, slots, serial) &&
        evaluateWireCondition(cond.right, slots, serial)
      );
    case "nor":
      return !(
        evaluateWireCondition(cond.left, slots, serial) ||
        evaluateWireCondition(cond.right, slots, serial)
      );
    case "not":
      return !evaluateWireCondition(cond.inner, slots, serial);
    case "otherwise":
      return true;
  }
}

// ---- Condition text ----

export function wireConditionText(cond: WireCondition): string {
  switch (cond.type) {
    case "serialOdd":
      return "the serial number's last digit is ODD";
    case "serialEven":
      return "the serial number's last digit is EVEN";
    case "wireCountEq":
      return `there are exactly ${cond.n} wires`;
    case "wireCountGte":
      return `there are ${cond.n} or more wires`;
    case "wireCountLte":
      return `there are ${cond.n} or fewer wires`;
    case "wireCountGt":
      return `there are more than ${cond.n} wires`;
    case "wireCountLt":
      return `there are fewer than ${cond.n} wires`;
    case "wireCountOdd":
      return "the number of wires is ODD";
    case "wireCountEven":
      return "the number of wires is EVEN";
    case "colorCountEq":
      return `there are exactly ${cond.n} ${cond.color.toUpperCase()} wire${
        cond.n === 1 ? "" : "s"
      }`;
    case "colorCountGte":
      return `there are ${cond.n} or more ${cond.color.toUpperCase()} wires`;
    case "noWiresOfColor":
      return `there are no ${cond.color.toUpperCase()} wires`;
    case "lastWireIs":
      return `the last wire is ${cond.color.toUpperCase()}`;
    case "firstWireIs":
      return `the first wire is ${cond.color.toUpperCase()}`;
    case "slotIs":
      return `position ${cond.position} holds a ${cond.color.toUpperCase()} wire`;
    case "slotIsEmpty":
      return `position ${cond.position} is empty`;
    case "and":
      return `(${wireConditionText(cond.left)}) AND (${wireConditionText(
        cond.right
      )})`;
    case "or":
      return `(${wireConditionText(cond.left)}) OR (${wireConditionText(
        cond.right
      )})`;
    case "xor":
      return `EXACTLY ONE of: (${wireConditionText(
        cond.left
      )}), (${wireConditionText(cond.right)})`;
    case "nand":
      return `NOT BOTH: (${wireConditionText(cond.left)}) and (${wireConditionText(
        cond.right
      )})`;
    case "nor":
      return `NEITHER (${wireConditionText(cond.left)}) NOR (${wireConditionText(
        cond.right
      )})`;
    case "not":
      return `NOT (${wireConditionText(cond.inner)})`;
    case "otherwise":
      return "none of the above apply";
  }
}

// ---- Random atomic generation ----

function randomAtomic(
  rng: () => number,
  slots: Slot[]
): AtomicWireCondition {
  const wires = filledWires(slots);
  const wireCount = wires.length;
  const slotCount = slots.length;
  const kinds = [
    "serialOdd",
    "serialEven",
    "wireCountEq",
    "wireCountGte",
    "wireCountLte",
    "wireCountGt",
    "wireCountLt",
    "wireCountOdd",
    "wireCountEven",
    "colorCountEq",
    "colorCountGte",
    "noWiresOfColor",
    "lastWireIs",
    "firstWireIs",
    "slotIs",
    "slotIs",
    "slotIsEmpty",
  ] as const;
  const kind = pick(rng, kinds as any) as AtomicWireCondition["type"];

  switch (kind) {
    case "serialOdd":
    case "serialEven":
    case "wireCountOdd":
    case "wireCountEven":
      return { type: kind };
    case "wireCountEq":
    case "wireCountGte":
    case "wireCountLte":
    case "wireCountGt":
    case "wireCountLt": {
      const offset = Math.floor(rng() * 5) - 2;
      const n = Math.max(1, Math.min(slotCount, wireCount + offset));
      return { type: kind, n };
    }
    case "colorCountEq":
    case "colorCountGte": {
      const color = pick(rng, ALL_COLORS);
      const actual = wires.filter((w) => w.color === color).length;
      const offset = Math.floor(rng() * 3) - 1;
      const n = Math.max(
        kind === "colorCountGte" ? 1 : 0,
        actual + offset
      );
      return { type: kind, color, n };
    }
    case "noWiresOfColor":
    case "lastWireIs":
    case "firstWireIs":
      return { type: kind, color: pick(rng, ALL_COLORS) };
    case "slotIs": {
      const position = 1 + Math.floor(rng() * slotCount);
      return { type: "slotIs", position, color: pick(rng, ALL_COLORS) };
    }
    case "slotIsEmpty": {
      const position = 1 + Math.floor(rng() * slotCount);
      return { type: "slotIsEmpty", position };
    }
  }
}

// ---- Compound condition generation ----

function randomCondition(
  rng: () => number,
  slots: Slot[],
  depth = 0
): WireCondition {
  if (depth === 0 && rng() < 0.4) {
    const op = pick(rng, ["and", "or", "xor", "nand", "nor", "not"] as const);
    if (op === "not") {
      return { type: "not", inner: randomAtomic(rng, slots) };
    }
    return {
      type: op,
      left: randomAtomic(rng, slots),
      right: randomAtomic(rng, slots),
    };
  }
  return randomAtomic(rng, slots);
}

function generateConditionWithTruth(
  rng: () => number,
  slots: Slot[],
  serial: string,
  desiredTruth: boolean
): WireCondition {
  for (let i = 0; i < 40; i++) {
    const c = randomCondition(rng, slots);
    if (evaluateWireCondition(c, slots, serial) === desiredTruth) return c;
  }
  const wireCount = filledWires(slots).length;
  return desiredTruth
    ? { type: "wireCountEq", n: wireCount }
    : { type: "wireCountEq", n: wireCount === slots.length ? 0 : wireCount + 1 };
}

function pickFilledSlotIndex(rng: () => number, slots: Slot[]): number {
  const filled: number[] = [];
  for (let i = 0; i < slots.length; i++) if (slots[i] !== null) filled.push(i);
  return filled[Math.floor(rng() * filled.length)];
}

// Counts how many wires (filled slots) sit at or before this slot index.
// Returns the 1-indexed wire number (wire #1 = topmost wire, etc.).
function slotToWireNumber(slots: Slot[], slotIndex: number): number {
  let count = 0;
  for (let i = 0; i <= slotIndex; i++) {
    if (slots[i] !== null) count++;
  }
  return count;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Random per-rule addressing: either "the Nth wire" (counting wires only)
// or "the wire in position N" (counting all slots).
function describeCutTarget(
  rng: () => number,
  slots: Slot[],
  slotIndex: number
): string {
  if (rng() < 0.5) {
    return `the ${ordinal(slotToWireNumber(slots, slotIndex))} wire`;
  }
  return `the wire in position ${slotIndex + 1}`;
}

export function generateWireModule(seed: number): WireModuleConfig {
  const rng = mulberry32(seed);
  const serial = generateSerialNumber(seed);

  // Slot count > wire count, both random.
  // slotCount in [5, 7]; wireCount in [3, slotCount - 1] so at least one is empty.
  const slotCount = 5 + Math.floor(rng() * 3);
  const wireCount = 3 + Math.floor(rng() * Math.min(3, slotCount - 3));

  // Pick which slot indices get wires.
  const allIndices = Array.from({ length: slotCount }, (_, i) => i);
  const shuffledIndices = [...allIndices].sort(() => rng() - 0.5);
  const filledIndices = new Set(shuffledIndices.slice(0, wireCount));

  const slots: Slot[] = Array.from({ length: slotCount }, (_, i) =>
    filledIndices.has(i) ? { color: pick(rng, ALL_COLORS) as WireColor } : null
  );

  // Build 4 rules: 3 conditioned + 1 otherwise. Winning rule at a random
  // position; preceding rules forced false; following rules unconstrained.
  const conditionedSlots = 3;
  const winningIdx = Math.floor(rng() * conditionedSlots);

  const rules: WireRule[] = [];
  for (let i = 0; i < conditionedSlots; i++) {
    let cond: WireCondition;
    if (i < winningIdx) {
      cond = generateConditionWithTruth(rng, slots, serial, false);
    } else if (i === winningIdx) {
      cond = generateConditionWithTruth(rng, slots, serial, true);
    } else {
      cond = randomCondition(rng, slots);
    }
    const cutIndex = pickFilledSlotIndex(rng, slots);
    rules.push({
      condition: cond,
      conditionText: wireConditionText(cond),
      cutIndex,
      cutText: describeCutTarget(rng, slots, cutIndex),
    });
  }

  const otherwiseCut = pickFilledSlotIndex(rng, slots);
  rules.push({
    condition: { type: "otherwise" },
    conditionText: wireConditionText({ type: "otherwise" }),
    cutIndex: otherwiseCut,
    cutText: describeCutTarget(rng, slots, otherwiseCut),
  });

  return {
    slots,
    rules,
  };
}

export function generateButtonModule(seed: number): ButtonModuleConfig {
  const rng = mulberry32(seed + 9999);

  const buttonColors: ButtonColor[] = ["red", "blue", "yellow", "white"];
  const buttonLabels: ButtonLabel[] = ["ABORT", "DETONATE", "HOLD", "PRESS"];
  const indicatorLabels = ["CAR", "FRK", "CLR", "IND", "MSA", "BOB"];
  const stripColors: StripColor[] = ["red", "blue", "yellow", "white"];

  const color = pick(rng, buttonColors) as ButtonColor;
  const label = pick(rng, buttonLabels) as ButtonLabel;
  const indicatorLabel = pick(rng, indicatorLabels) as string;
  const indicatorLit = rng() > 0.5;

  // Pick which rule of the manual should be the one that fires. Uniform
  // distribution so the answer isn't always the fall-through "Otherwise".
  // 0 = immediate rule slot #1 matches
  // 1 = immediate rule slot #2 matches
  // 2 = battery hold rule matches
  // 3 = otherwise (none match)
  const winningRule = Math.floor(rng() * 4);

  // Pick batteryCount + hold rule so the hold rule matches iff winningRule === 2
  let batteryCount: number;
  let holdBatteryThreshold: number;
  let holdBatteryLabel: ButtonLabel;

  if (winningRule === 2) {
    // Hold rule MUST fire: batteryCount >= threshold AND label = button.label
    batteryCount = 2 + Math.floor(rng() * 3); // 2..4
    holdBatteryThreshold =
      2 + Math.floor(rng() * Math.min(2, batteryCount - 1)); // 2..min(3, bc)
    holdBatteryLabel = label;
  } else {
    // Hold rule MUST NOT fire: either too few batteries OR wrong label.
    batteryCount = 1 + Math.floor(rng() * 4); // 1..4
    holdBatteryThreshold = 2 + Math.floor(rng() * 2); // 2 or 3
    if (batteryCount < holdBatteryThreshold) {
      // already won't match on count; label can be anything
      holdBatteryLabel = pick(rng, buttonLabels) as ButtonLabel;
    } else {
      // count would match → force label mismatch
      holdBatteryLabel = pick(
        rng,
        buttonLabels.filter((l) => l !== label)
      ) as ButtonLabel;
    }
  }

  // Generate the two immediate-tap rules. The winning slot (if 0 or 1) gets
  // the actual button's (color, label); the other slot and any non-winning
  // slots get pairs that DO NOT match the button.
  const allPairs: ButtonImmediateRule[] = buttonColors.flatMap((c) =>
    buttonLabels.map((l) => ({ color: c, label: l }))
  );
  const matchingPair: ButtonImmediateRule = { color, label };
  const nonMatching = allPairs.filter(
    (p) => !(p.color === color && p.label === label)
  );

  let releaseImmediatelyRules: ButtonImmediateRule[];
  if (winningRule === 0) {
    releaseImmediatelyRules = [matchingPair, pick(rng, nonMatching)];
  } else if (winningRule === 1) {
    releaseImmediatelyRules = [pick(rng, nonMatching), matchingPair];
  } else {
    // 2 or 3 — neither immediate rule should match
    releaseImmediatelyRules = pickN(rng, nonMatching, 2);
  }

  // Strip rules are observed only during hold — independent of which rule
  // wins. Always reference the timer's ONES digit so the wait is at most 10s.
  const stripRules = stripColors.map((stripColor) => ({
    stripColor,
    releaseValue: Math.floor(rng() * 10), // 0..9
  }));

  const actualStripColor = pick(rng, stripColors) as StripColor;

  return {
    color,
    label,
    batteryCount,
    indicatorLabel,
    indicatorLit,
    releaseImmediatelyRules,
    holdBatteryThreshold,
    holdBatteryLabel,
    stripRules,
    actualStripColor,
  };
}

export function checkReleaseTiming(
  config: ButtonModuleConfig,
  timerSecondsRemaining: number
): boolean {
  const rule = config.stripRules.find(
    (r) => r.stripColor === config.actualStripColor
  );
  if (!rule) return false;
  const ones = timerSecondsRemaining % 10;
  return ones === rule.releaseValue;
}

export function generateSerialNumber(seed: number): string {
  const rng = mulberry32(seed + 1234);
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "0123456789";
  const mixed = letters + digits;
  // KTANE-style: ensure the last character is always a digit so "last digit" is well-defined.
  const chars: string[] = Array.from(
    { length: 5 },
    () => mixed[Math.floor(rng() * mixed.length)]
  );
  chars.push(digits[Math.floor(rng() * digits.length)]);
  return chars.join("");
}

export function getSerialLastDigit(serial: string): number {
  for (let i = serial.length - 1; i >= 0; i--) {
    if (/\d/.test(serial[i])) return parseInt(serial[i], 10);
  }
  return 0;
}

export function getWireSolution(
  config: WireModuleConfig,
  serial: string
): number {
  for (const rule of config.rules) {
    if (evaluateWireCondition(rule.condition, config.slots, serial)) {
      return rule.cutIndex;
    }
  }
  return 0;
}

// Walk the same rule list the manual shows, in order. First match wins.
export function getButtonAction(
  config: ButtonModuleConfig
): "tap" | "hold" {
  // Rules 1..N: specific colour+label combos → tap
  if (
    config.releaseImmediatelyRules.some(
      (r) => r.color === config.color && r.label === config.label
    )
  ) {
    return "tap";
  }
  // Battery+label hold rule
  if (
    config.batteryCount >= config.holdBatteryThreshold &&
    config.label === config.holdBatteryLabel
  ) {
    return "hold";
  }
  // Otherwise — tap
  return "tap";
}

export function getStripReleaseTiming(
  config: ButtonModuleConfig,
  stripColor: StripColor
): { value: number } {
  const rule = config.stripRules.find((r) => r.stripColor === stripColor);
  return { value: rule?.releaseValue ?? 0 };
}

// Generate manual pages from the same configs
export function generateManualPages(seed: number): ManualPage[] {
  const wireConfig = generateWireModule(seed);
  const buttonConfig = generateButtonModule(seed);

  const wirePage: ManualPage = {
    moduleType: "wire",
    title: "WIRE CUTTING MODULE",
    sections: [
      {
        heading: "Rules — apply the first one that matches",
        content: wireConfig.rules.map((r) => ({
          type: "rule" as const,
          condition: r.conditionText,
          action: `cut ${r.cutText}`,
        })),
      },
    ],
  };

  const immediateRules = buttonConfig.releaseImmediatelyRules.map((r) => ({
    type: "rule" as const,
    condition: `the button is ${r.color.toUpperCase()} and labelled ${r.label}`,
    action: "tap (press and immediately release)",
  }));
  const holdRule = {
    type: "rule" as const,
    condition: `the bomb has ${buttonConfig.holdBatteryThreshold} or more batteries and the button is labelled ${buttonConfig.holdBatteryLabel}`,
    action: "hold the button down",
  };
  const otherwiseRule = {
    type: "rule" as const,
    condition: "none of the above apply",
    action: "tap (press and immediately release)",
  };

  const stripRules = buttonConfig.stripRules.map((r) => ({
    type: "rule" as const,
    condition: `the LED strip is ${r.stripColor.toUpperCase()}`,
    action: `release when the timer's last digit is ${r.releaseValue}`,
  }));

  const buttonPage: ManualPage = {
    moduleType: "button",
    title: "BUTTON MODULE",
    sections: [
      {
        heading: "Tap or hold? — apply the first rule that matches",
        content: [...immediateRules, holdRule, otherwiseRule],
      },
      {
        heading: "If holding, release timing by LED strip colour",
        content: stripRules,
      },
    ],
  };

  // One symbols-module entry per bomb, regardless of how many symbols
  // modules the bomb has. They all share the same column reference.
  const sharedColumns = generateSymbolsColumns(seed);
  const symbolsPage: ManualPage = {
    moduleType: 'symbols' as const,
    title: 'SYMBOLS MODULE',
    sections: [
      {
        heading:
          'Find the column that contains all four symbols on the bomb. Press them in the order they appear in that column, top to bottom.',
        content: [
          { type: 'symbolColumns' as const, columns: sharedColumns },
        ],
      },
    ],
  };

  const mazePool = generateMazePool(seed);
  const mazePage: ManualPage = {
    moduleType: "maze",
    title: "MAZE MODULE",
    sections: [
      {
        heading: "Procedure",
        content: [
          {
            type: "paragraph",
            text:
              "The bomb shows two green circle markers, a white circle (your current position), and a red triangle (the goal). Find the maze in this manual whose two green markers are in the same cells as the ones on the bomb. Navigate from the white circle to the red triangle using the arrow buttons; you cannot cross the walls shown in this maze. A wall collision counts as a strike.",
          },
        ],
      },
      {
        heading: "Maze pool",
        content: [{ type: "mazeGrid", pool: mazePool }],
      },
    ],
  };

  const passwordConfig = generatePasswordModule(seed);
  const passwordPage: ManualPage = {
    moduleType: "password",
    title: "PASSWORD MODULE",
    sections: [
      {
        heading: "Procedure",
        content: [
          {
            type: "paragraph",
            text:
              "Five letter dials, each cycling through six letters. Exactly one (or sometimes two) of the words in the dictionary below can be spelled using the available letters. Spell that word and press SUBMIT. The dictionary is fixed for this manual; the per-column letters are reproduced for reference.",
          },
        ],
      },
      {
        heading: "Dictionary · letter pools",
        content: [
          {
            type: "passwordDict",
            words: PASSWORD_DICTIONARY,
            columns: passwordConfig.columns,
          },
        ],
      },
    ],
  };

  const morseConfig = generateMorseModule(seed);
  const morsePage: ManualPage = {
    moduleType: "morse",
    title: "MORSE CODE MODULE",
    sections: [
      {
        heading: "Procedure",
        content: [
          {
            type: "paragraph",
            text:
              "The module flashes one English word in Morse code on a single LED. Decode the word. Look it up in the table below to find the response frequency (MHz). Tune the dial to that frequency and press TX. A wrong transmission is a strike.",
          },
        ],
      },
      {
        heading: "Word ↔ frequency table",
        content: [{ type: "morseTable", pool: morseConfig.pool }],
      },
    ],
  };

  const memoryConfig = generateMemoryModule(seed);
  const memoryPage: ManualPage = {
    moduleType: "memory",
    title: "MEMORY MODULE",
    sections: [
      {
        heading: "Procedure",
        content: [
          {
            type: "paragraph",
            text:
              "Five stages. Each stage a number flashes on the display and four buttons appear, each carrying a label. Apply the rule for the current stage to determine which button to press. Wrong press resets you to stage 1. The buttons are re-labelled between stages — keep track of which position and which label you pressed each stage; later stages may refer back to them.",
          },
        ],
      },
      {
        heading: "Stage rules",
        content: [
          { type: "memoryStages", stages: memoryConfig.stages },
        ],
      },
    ],
  };

  const simonConfig = generateSimonModule(seed);
  const simonPage: ManualPage = {
    moduleType: "simon",
    title: "SIMON MODULE",
    sections: [
      {
        heading: "Procedure",
        content: [
          {
            type: "paragraph",
            text:
              "The bomb flashes a sequence of coloured lights. For each flash, look up the colour in the row matching the bomb's current strikes and whether its serial number contains a vowel — press the colour shown. A wrong press resets your progress for this module.",
          },
        ],
      },
      {
        heading: "Substitution — find your row, then your column",
        content: [
          { type: "simonTable", tables: simonConfig.tables },
        ],
      },
    ],
  };

  // Shuffle page order per bomb so the Expert can't memorize section
  // positions across rounds.
  const orderRng = mulberry32(seed + 31337);
  const all: ManualPage[] = [
    wirePage,
    buttonPage,
    symbolsPage,
    simonPage,
    mazePage,
    memoryPage,
    morsePage,
    passwordPage,
  ];
  return [...all].sort(() => orderRng() - 0.5);
}

// ---- Symbol generation ----

type Point = [number, number];

function fmt(n: number): string {
  return n.toFixed(1);
}

function catmullRomPath(pts: Point[]): string {
  if (pts.length < 2) return '';
  const n = pts.length;
  let d = `M ${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${fmt(cp1x)} ${fmt(cp1y)},${fmt(cp2x)} ${fmt(cp2y)},${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function generateGlyphPaths(rng: () => number): string[] {
  const paths: string[] = [];
  const style = Math.floor(rng() * 5);
  const numMain = 3 + Math.floor(rng() * 3);
  const mainPts: Point[] = [];
  for (let i = 0; i < numMain; i++) {
    const t = i / (numMain - 1);
    let x: number, y: number;
    if (style === 0) {
      x = 18 + t * 64 + (rng() - 0.5) * 22; y = 25 + rng() * 50;
    } else if (style === 1) {
      x = 30 + rng() * 40; y = 18 + t * 64 + (rng() - 0.5) * 22;
    } else if (style === 2) {
      x = 18 + t * 64 + (rng() - 0.5) * 16; y = 18 + t * 64 + (rng() - 0.5) * 16;
    } else if (style === 3) {
      x = 18 + t * 64 + (rng() - 0.5) * 16; y = 82 - t * 64 + (rng() - 0.5) * 16;
    } else {
      x = 18 + rng() * 64; y = 18 + rng() * 64;
    }
    mainPts.push([clamp(x, 10, 90), clamp(y, 10, 90)]);
  }
  paths.push(catmullRomPath(mainPts));

  if (rng() > 0.25) {
    const anchor = mainPts[Math.floor(rng() * mainPts.length)];
    const numSec = 2 + Math.floor(rng() * 2);
    const secPts: Point[] = [
      [clamp(anchor[0] + (rng() - 0.5) * 6, 10, 90), clamp(anchor[1] + (rng() - 0.5) * 6, 10, 90)],
    ];
    for (let i = 1; i < numSec; i++) {
      secPts.push([clamp(18 + rng() * 64, 10, 90), clamp(18 + rng() * 64, 10, 90)]);
    }
    paths.push(catmullRomPath(secPts));
  }

  if (rng() > 0.45) {
    const cx = 22 + rng() * 56, cy = 22 + rng() * 56;
    const rx = 7 + rng() * 16, ry = 6 + rng() * 14;
    const rot = Math.round((rng() - 0.5) * 70);
    if (rng() > 0.5) {
      paths.push(`M ${fmt(cx - rx)} ${fmt(cy)} A ${fmt(rx)} ${fmt(ry)} ${rot} 1 1 ${fmt(cx + rx)} ${fmt(cy)} A ${fmt(rx)} ${fmt(ry)} ${rot} 1 1 ${fmt(cx - rx)} ${fmt(cy)} Z`);
    } else {
      const a0 = rng() * Math.PI * 2, sweep = 0.8 + rng() * 1.5, a1 = a0 + sweep;
      const sx = cx + rx * Math.cos(a0), sy = cy + ry * Math.sin(a0);
      const ex = cx + rx * Math.cos(a1), ey = cy + ry * Math.sin(a1);
      paths.push(`M ${fmt(sx)} ${fmt(sy)} A ${fmt(rx)} ${fmt(ry)} ${rot} ${sweep > Math.PI ? 1 : 0} 1 ${fmt(ex)} ${fmt(ey)}`);
    }
  }

  const numDots = Math.floor(rng() * 3);
  for (let i = 0; i < numDots; i++) {
    const dx = 18 + rng() * 64, dy = 18 + rng() * 64, r = 1.8 + rng() * 2.8;
    paths.push(`M ${fmt(dx)} ${fmt(dy)} m ${fmt(-r)} 0 a ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(r * 2)} 0 a ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-r * 2)} 0`);
  }

  if (rng() > 0.65) {
    const tx = 22 + rng() * 56, ty = 22 + rng() * 56, arm = 4 + rng() * 6;
    paths.push(`M ${fmt(tx - arm)} ${fmt(ty)} L ${fmt(tx + arm)} ${fmt(ty)}`);
    paths.push(`M ${fmt(tx)} ${fmt(ty - arm)} L ${fmt(tx)} ${fmt(ty + arm)}`);
  }

  return paths;
}

// Generate the SHARED column layout that every symbols module on a bomb sees
// in the manual. One bomb → one column layout → one manual page (even if the
// bomb has multiple symbols modules with different actives).
export function generateSymbolsColumns(seed: number): GeneratedSymbol[][] {
  const rng = mulberry32(seed + 55555);

  const columnCount = 6 + Math.floor(rng() * 3); // 6..8
  const COLUMN_HEIGHT = 7;
  const columnSizes = Array.from({ length: columnCount }, () => COLUMN_HEIGHT);

  // Pool of unique glyphs. Columns repeat symbols across columns so the
  // expert can't match a single symbol to a single column.
  const poolSize = 18 + Math.floor(rng() * 6); // 18..23
  const pool: GeneratedSymbol[] = Array.from({ length: poolSize }, (_, i) => ({
    id: `${seed}-${i}`,
    paths: generateGlyphPaths(rng),
  }));

  return columnSizes.map((size) => {
    return [...pool].sort(() => rng() - 0.5).slice(0, size);
  });
}

// Pick the 4 active symbols for a single symbols-module instance from a
// shared column layout. Uses rejection sampling so exactly one column
// contains all 4 actives (the "winner"). Multiple modules can use the same
// columns and each one will have its own uniquely-identifying winner.
export function generateSymbolsModule(
  seed: number,
  sharedColumns?: GeneratedSymbol[][]
): SymbolsModuleConfig {
  const columns = sharedColumns ?? generateSymbolsColumns(seed);
  const rng = mulberry32(seed + 99119);

  for (let attempt = 0; attempt < 60; attempt++) {
    const winnerIdx = Math.floor(rng() * columns.length);
    const winner = columns[winnerIdx];
    if (winner.length < 4) continue;
    const actives = [...winner].sort(() => rng() - 0.5).slice(0, 4);
    const activeIds = new Set(actives.map((s) => s.id));

    // Validate uniqueness — no OTHER column may also contain all 4
    let unique = true;
    for (let i = 0; i < columns.length && unique; i++) {
      if (i === winnerIdx) continue;
      let hits = 0;
      for (const s of columns[i]) if (activeIds.has(s.id)) hits++;
      if (hits === 4) unique = false;
    }
    if (unique) {
      return {
        columns,
        activeSymbols: [...actives].sort(() => rng() - 0.5),
      };
    }
  }

  // Fallback (extremely unlikely): just take the first column's first 4.
  const winner = columns[0];
  const actives = winner.slice(0, 4);
  return { columns, activeSymbols: [...actives].sort(() => rng() - 0.5) };
}

// Solution = the 4 active symbols ordered by their position in the column
// that contains all of them (top → bottom). Skipping over the column's other
// symbols that aren't on the bomb.
// ---- Simon ----

export const SIMON_COLORS: SimonColor[] = ["red", "blue", "yellow", "green"];

export function serialHasVowel(serial: string): boolean {
  return /[AEIOU]/i.test(serial);
}

/* The substitution table is a 6-cell grid keyed by (strikes, vowel).
   Each cell is a permutation of the 4 colours — never the identity, so
   the puzzle always requires a substitution. Adjacent cells differ in
   at least one mapping, so the manual reads as 6 distinct rules
   rather than near-duplicates. */
function pickPermutation(rng: () => number): Record<SimonColor, SimonColor> {
  // Reject the identity permutation; with 4 colours there are 24 perms,
  // 9 of which are derangements (no fixed points) — we don't require a
  // full derangement, just not-identity, which gives 23 options.
  while (true) {
    const shuffled = [...SIMON_COLORS].sort(() => rng() - 0.5);
    const identical = shuffled.every((c, i) => c === SIMON_COLORS[i]);
    if (!identical) {
      const map = {} as Record<SimonColor, SimonColor>;
      SIMON_COLORS.forEach((c, i) => {
        map[c] = shuffled[i];
      });
      return map;
    }
  }
}

export function generateSimonModule(seed: number): SimonModuleConfig {
  const rng = mulberry32(seed + 0x517d_0a55);
  const length = 3 + Math.floor(rng() * 3); // 3..5
  const sequence: SimonColor[] = Array.from({ length }, () => pick(rng, SIMON_COLORS));
  const tables: SimonModuleConfig["tables"] = [];
  for (let i = 0; i < 6; i++) {
    tables.push(pickPermutation(rng));
  }
  return { sequence, tables };
}

/* index into `tables` for the given game state. */
export function getSimonTableIndex(serial: string, strikes: number): number {
  const s = Math.max(0, Math.min(2, strikes));
  return s * 2 + (serialHasVowel(serial) ? 1 : 0);
}

/* What colour to press for the i-th flash given the current strike count. */
export function getSimonExpected(
  config: SimonModuleConfig,
  serial: string,
  strikes: number,
  pressIdx: number
): SimonColor {
  const cell = config.tables[getSimonTableIndex(serial, strikes)];
  return cell[config.sequence[pressIdx]];
}

// ---- Maze ----

function cellIdx(x: number, y: number): number {
  return y * MAZE_SIZE + x;
}

/* Standard randomized-DFS maze carver. Starts with all walls present and
   knocks down walls along a DFS spanning tree, giving a perfect maze
   (every cell reachable, no loops). */
function generateMazeData(rng: () => number): number[] {
  const walls = new Array<number>(MAZE_SIZE * MAZE_SIZE).fill(
    MAZE_W_N | MAZE_W_E | MAZE_W_S | MAZE_W_W
  );
  const visited = new Array<boolean>(MAZE_SIZE * MAZE_SIZE).fill(false);

  const stack: Array<[number, number]> = [];
  const startX = Math.floor(rng() * MAZE_SIZE);
  const startY = Math.floor(rng() * MAZE_SIZE);
  visited[cellIdx(startX, startY)] = true;
  stack.push([startX, startY]);

  while (stack.length > 0) {
    const [x, y] = stack[stack.length - 1];
    const neighbours: Array<{ nx: number; ny: number; wHere: number; wThere: number }> = [];
    if (y > 0 && !visited[cellIdx(x, y - 1)])
      neighbours.push({ nx: x, ny: y - 1, wHere: MAZE_W_N, wThere: MAZE_W_S });
    if (x < MAZE_SIZE - 1 && !visited[cellIdx(x + 1, y)])
      neighbours.push({ nx: x + 1, ny: y, wHere: MAZE_W_E, wThere: MAZE_W_W });
    if (y < MAZE_SIZE - 1 && !visited[cellIdx(x, y + 1)])
      neighbours.push({ nx: x, ny: y + 1, wHere: MAZE_W_S, wThere: MAZE_W_N });
    if (x > 0 && !visited[cellIdx(x - 1, y)])
      neighbours.push({ nx: x - 1, ny: y, wHere: MAZE_W_W, wThere: MAZE_W_E });

    if (neighbours.length === 0) {
      stack.pop();
      continue;
    }
    const n = neighbours[Math.floor(rng() * neighbours.length)];
    walls[cellIdx(x, y)] &= ~n.wHere;
    walls[cellIdx(n.nx, n.ny)] &= ~n.wThere;
    visited[cellIdx(n.nx, n.ny)] = true;
    stack.push([n.nx, n.ny]);
  }

  /* Add a few random extra openings — turns the perfect maze into a
     maze with a small handful of loops, which makes routing more
     interesting and prevents the always-one-path obvious solve. */
  const extras = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < extras; i++) {
    const x = Math.floor(rng() * MAZE_SIZE);
    const y = Math.floor(rng() * MAZE_SIZE);
    const dir = Math.floor(rng() * 4);
    if (dir === 0 && y > 0) {
      walls[cellIdx(x, y)] &= ~MAZE_W_N;
      walls[cellIdx(x, y - 1)] &= ~MAZE_W_S;
    } else if (dir === 1 && x < MAZE_SIZE - 1) {
      walls[cellIdx(x, y)] &= ~MAZE_W_E;
      walls[cellIdx(x + 1, y)] &= ~MAZE_W_W;
    } else if (dir === 2 && y < MAZE_SIZE - 1) {
      walls[cellIdx(x, y)] &= ~MAZE_W_S;
      walls[cellIdx(x, y + 1)] &= ~MAZE_W_N;
    } else if (dir === 3 && x > 0) {
      walls[cellIdx(x, y)] &= ~MAZE_W_W;
      walls[cellIdx(x - 1, y)] &= ~MAZE_W_E;
    }
  }
  return walls;
}

/* Generate the maze pool — all mazes deterministic from the seed so
   the manual matches the bomb. Marker pairs are forced unique across
   the pool (the markers are how the player identifies which maze). */
export function generateMazePool(seed: number): MazeData[] {
  const baseRng = mulberry32(seed + 0x4d4147ed);
  const pool: MazeData[] = [];
  const usedPairs = new Set<string>();

  for (let i = 0; i < MAZE_POOL; i++) {
    const mazeRng = mulberry32(seed + 0x4d415a45 + i * 991);
    const walls = generateMazeData(mazeRng);

    // Place two markers in distinct cells. Reroll if the pair has been used.
    let markers: [MazeCell, MazeCell] | null = null;
    for (let attempt = 0; attempt < 80 && !markers; attempt++) {
      const a: MazeCell = {
        x: Math.floor(baseRng() * MAZE_SIZE),
        y: Math.floor(baseRng() * MAZE_SIZE),
      };
      const b: MazeCell = {
        x: Math.floor(baseRng() * MAZE_SIZE),
        y: Math.floor(baseRng() * MAZE_SIZE),
      };
      if (a.x === b.x && a.y === b.y) continue;
      // Canonical ordering for the dedupe key.
      const [p, q] = (a.y * MAZE_SIZE + a.x) < (b.y * MAZE_SIZE + b.x) ? [a, b] : [b, a];
      const key = `${p.x},${p.y}|${q.x},${q.y}`;
      if (usedPairs.has(key)) continue;
      usedPairs.add(key);
      markers = [p, q];
    }
    if (!markers) {
      // Fallback — should never trigger at MAZE_POOL=9 with 36 cells.
      markers = [{ x: i, y: 0 }, { x: i, y: MAZE_SIZE - 1 }];
    }
    pool.push({ walls, markers });
  }
  return pool;
}

/* BFS over the maze graph to find a path; returns the distance map or
   `null` for unreachable. Used to pick a start/goal pair that requires
   a non-trivial route. */
function mazeBfs(maze: MazeData, from: MazeCell): number[] {
  const dist = new Array<number>(MAZE_SIZE * MAZE_SIZE).fill(-1);
  dist[cellIdx(from.x, from.y)] = 0;
  const queue: MazeCell[] = [from];
  let head = 0;
  while (head < queue.length) {
    const c = queue[head++];
    const w = maze.walls[cellIdx(c.x, c.y)];
    const here = dist[cellIdx(c.x, c.y)];
    const tryStep = (nx: number, ny: number, wallBit: number) => {
      if (nx < 0 || ny < 0 || nx >= MAZE_SIZE || ny >= MAZE_SIZE) return;
      if (w & wallBit) return;
      const idx = cellIdx(nx, ny);
      if (dist[idx] !== -1) return;
      dist[idx] = here + 1;
      queue.push({ x: nx, y: ny });
    };
    tryStep(c.x, c.y - 1, MAZE_W_N);
    tryStep(c.x + 1, c.y, MAZE_W_E);
    tryStep(c.x, c.y + 1, MAZE_W_S);
    tryStep(c.x - 1, c.y, MAZE_W_W);
  }
  return dist;
}

export function generateMazeModule(seed: number): MazeModuleConfig {
  const rng = mulberry32(seed + 0x4d415a01);
  const pool = generateMazePool(seed);
  const activeIndex = Math.floor(rng() * pool.length);
  const active = pool[activeIndex];

  // Choose start and goal with a non-trivial Manhattan separation, then
  // verify they're connected (with extra openings they should be — but
  // BFS confirms either way).
  let start: MazeCell;
  let goal: MazeCell;
  for (let attempt = 0; ; attempt++) {
    start = {
      x: Math.floor(rng() * MAZE_SIZE),
      y: Math.floor(rng() * MAZE_SIZE),
    };
    goal = {
      x: Math.floor(rng() * MAZE_SIZE),
      y: Math.floor(rng() * MAZE_SIZE),
    };
    const manhattan = Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y);
    if (manhattan < 5 && attempt < 30) continue;
    const dist = mazeBfs(active, start);
    if (dist[cellIdx(goal.x, goal.y)] >= 4) break;
    if (attempt > 60) break;
  }

  return { pool, activeIndex, start, goal };
}

/* Validate a single move. Returns the new cell if the move is legal
   (no wall in the way and within bounds), else null. */
export function tryMazeMove(
  walls: number[],
  from: MazeCell,
  dir: Direction
): MazeCell | null {
  const idx = cellIdx(from.x, from.y);
  const w = walls[idx];
  switch (dir) {
    case "up":
      if (from.y <= 0 || (w & MAZE_W_N)) return null;
      return { x: from.x, y: from.y - 1 };
    case "right":
      if (from.x >= MAZE_SIZE - 1 || (w & MAZE_W_E)) return null;
      return { x: from.x + 1, y: from.y };
    case "down":
      if (from.y >= MAZE_SIZE - 1 || (w & MAZE_W_S)) return null;
      return { x: from.x, y: from.y + 1 };
    case "left":
      if (from.x <= 0 || (w & MAZE_W_W)) return null;
      return { x: from.x - 1, y: from.y };
  }
}

// ---- Memory ----

function shuffleArray<T>(rng: () => number, arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function generateMemoryModule(seed: number): MemoryModuleConfig {
  const rng = mulberry32(seed + 0x4d454d_01);
  const stages: MemoryStageConfig[] = [];

  for (let s = 0; s < MEMORY_STAGES; s++) {
    const labels = shuffleArray(rng, [1, 2, 3, 4]);
    const display = 1 + Math.floor(rng() * MEMORY_SLOTS);

    // Pick a rule. First stage cannot reference history; later stages
    // are biased toward referencing prior stages to give the module
    // its characteristic "memory" feel.
    let rule: MemoryRule;
    if (s === 0) {
      // Stage 1 — only "press position N", "press label N", or "press the displayed position".
      const r = rng();
      if (r < 0.4) rule = { type: "pos", value: 1 + Math.floor(rng() * 4) };
      else if (r < 0.8) rule = { type: "label", value: 1 + Math.floor(rng() * 4) };
      else rule = { type: "display" };
    } else {
      // Later stages — favour history references.
      const r = rng();
      if (r < 0.45) {
        rule = { type: "samePos", stage: Math.floor(rng() * s) };
      } else if (r < 0.8) {
        rule = { type: "sameLabel", stage: Math.floor(rng() * s) };
      } else if (r < 0.9) {
        rule = { type: "pos", value: 1 + Math.floor(rng() * 4) };
      } else {
        rule = { type: "label", value: 1 + Math.floor(rng() * 4) };
      }
    }

    stages.push({ labels, display, rule });
  }

  return { stages };
}

/* Given the rule and the player's confirmed history, what is the
   expected button position (1..4) for the current stage? */
export function getMemoryExpected(
  config: MemoryModuleConfig,
  stageIdx: number,
  history: MemoryPress[]
): number {
  const stage = config.stages[stageIdx];
  const labels = stage.labels;
  switch (stage.rule.type) {
    case "pos":
      return stage.rule.value;
    case "label": {
      const pos = labels.indexOf(stage.rule.value) + 1;
      return pos > 0 ? pos : 1;
    }
    case "samePos":
      return history[stage.rule.stage]?.position ?? 1;
    case "sameLabel": {
      const lbl = history[stage.rule.stage]?.label ?? 1;
      const pos = labels.indexOf(lbl) + 1;
      return pos > 0 ? pos : 1;
    }
    case "display":
      return stage.display;
  }
}

/* Human-readable text for the manual. Uses ordinals for positions. */
const ORDINALS = ["1st", "2nd", "3rd", "4th"];
export function memoryRuleText(rule: MemoryRule): string {
  switch (rule.type) {
    case "pos":
      return `press the button in the ${ORDINALS[rule.value - 1]} position`;
    case "label":
      return `press the button labelled ${rule.value}`;
    case "samePos":
      return `press the button in the same position as the one you pressed in stage ${rule.stage + 1}`;
    case "sameLabel":
      return `press the button with the same label as the one you pressed in stage ${rule.stage + 1}`;
    case "display":
      return `press the button in the position equal to the displayed number`;
  }
}

// ---- Morse ----

export const MORSE: Record<string, string> = {
  A: ".-",   B: "-...", C: "-.-.", D: "-..",  E: ".",
  F: "..-.", G: "--.",  H: "....", I: "..",   J: ".---",
  K: "-.-",  L: ".-..", M: "--",   N: "-.",   O: "---",
  P: ".--.", Q: "--.-", R: ".-.",  S: "...",  T: "-",
  U: "..-",  V: "...-", W: ".--",  X: "-..-", Y: "-.--",
  Z: "--..",
};

/* Wordlist for the morse module. All 5–6 letter words built from the
   basic morse alphabet, so every character has a defined encoding.
   Kept reasonably distinct (different starting/ending characters,
   varied morse-rhythm signatures) so flashing-light decoding stays
   tractable. */
const MORSE_WORDS = [
  "SHELL", "HALLS", "SLICK", "TRICK", "BOXES", "LEAKS", "STROB", "BISTR",
  "FLICK", "BOMBS", "BREAK", "BRICK", "STEAK", "STING", "VECTO", "BEATS",
  "CRANE", "DRIFT", "EAGER", "FROST", "GLINT", "HONEY", "INDEX", "JUMPS",
  "KNIFE", "LEMON", "MAPLE", "NORTH", "OASIS", "PIANO", "QUILT", "RAVEN",
  "SHORE", "TIGER", "URBAN", "VAULT", "WHEAT", "YIELD", "ZEBRA", "ALPHA",
  "BRAVO", "DELTA", "ECHO",  "FOXY",  "GULF",  "HOTEL", "JULY",  "KILO",
  "MIKE",  "NOVA",  "OSCAR", "QUARK", "ROVER", "SIGMA", "TANGO", "UMBRA",
  "VIRAL", "WIRED", "XENON", "ZONES",
];

export function encodeMorse(word: string): string[] {
  return word
    .toUpperCase()
    .split("")
    .map((ch) => MORSE[ch] ?? "");
}

export function generateMorseModule(seed: number): MorseModuleConfig {
  const rng = mulberry32(seed + 0x4d4f_5253);

  // Pick MORSE_POOL_SIZE distinct words.
  const words = shuffleArray(rng, MORSE_WORDS).slice(0, MORSE_POOL_SIZE);
  // Assign each word a distinct frequency index from MORSE_FREQS.
  const freqIndices = shuffleArray(
    rng,
    Array.from({ length: MORSE_FREQS.length }, (_, i) => i)
  ).slice(0, MORSE_POOL_SIZE);

  const pool: MorseEntry[] = words.map((word, i) => ({
    word,
    freqIndex: freqIndices[i],
  }));

  // Sort the pool by word so the manual is easy to scan.
  pool.sort((a, b) => a.word.localeCompare(b.word));

  const activeIndex = Math.floor(rng() * pool.length);
  return { pool, activeIndex };
}

export function getMorseSolutionFreqIndex(config: MorseModuleConfig): number {
  return config.pool[config.activeIndex].freqIndex;
}

export function formatMorseFreq(freqIndex: number): string {
  return MORSE_FREQS[freqIndex].toFixed(3);
}

// ---- Password ----

const PASSWORD_WORDLIST = [
  "ABOUT", "AFTER", "AGAIN", "BELOW", "COULD", "EVERY", "FIRST", "FOUND",
  "GREAT", "HOUSE", "LARGE", "LEARN", "NEVER", "OTHER", "PLACE", "PLANT",
  "POINT", "RIGHT", "SMALL", "SOUND", "SPELL", "STILL", "STUDY", "THEIR",
  "THERE", "THESE", "THING", "THINK", "THREE", "WATER", "WHERE", "WHICH",
  "WORLD", "WOULD", "WRITE", "BLACK", "BRING", "CARRY", "CLEAN", "DRINK",
  "EARTH", "ENJOY", "FRESH", "GLASS", "HAPPY", "LIGHT", "MUSIC", "NIGHT",
  "OCEAN", "PAPER", "QUEST", "RIVER", "SHARP", "TRAIN", "UNDER", "VOICE",
];

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function generatePasswordModule(seed: number): PasswordModuleConfig {
  const rng = mulberry32(seed + 0x70_5357_4444);
  const target = pick(rng, PASSWORD_WORDLIST);

  // Build per-column letter pools. Each column must include the target's
  // letter at that index. Fill the rest with random letters from the
  // alphabet, ensuring no duplicates within a column.
  const columns: string[][] = [];
  for (let col = 0; col < PASSWORD_COLS; col++) {
    const required = target[col];
    const pool = new Set<string>([required]);
    while (pool.size < PASSWORD_LETTERS_PER_COL) {
      pool.add(ALPHABET[Math.floor(rng() * ALPHABET.length)]);
    }
    columns.push(shuffleArray(rng, Array.from(pool)));
  }

  // Find every word in the wordlist that can be spelled from these
  // columns — the server accepts any of them, and the manual surfaces
  // the list (with the spellable ones highlighted? no — the puzzle
  // is the player FINDING the spellable ones, so just show the full
  // dictionary). We compute the accepted set for the server.
  const accepted: string[] = [];
  for (const word of PASSWORD_WORDLIST) {
    let ok = true;
    for (let i = 0; i < PASSWORD_COLS; i++) {
      if (!columns[i].includes(word[i])) {
        ok = false;
        break;
      }
    }
    if (ok) accepted.push(word);
  }

  return { columns, acceptedWords: accepted };
}

export function passwordIsCorrect(
  config: PasswordModuleConfig,
  attempt: string
): boolean {
  return config.acceptedWords.includes(attempt.toUpperCase());
}

/* The dictionary surfaced in the manual — full wordlist, *not* the
   per-bomb accepted set. The puzzle is for the player to identify
   which words are spellable from the dial letters. */
export const PASSWORD_DICTIONARY = PASSWORD_WORDLIST;

export function getSymbolsSolution(config: SymbolsModuleConfig): string[] {
  const activeIds = new Set(config.activeSymbols.map((s) => s.id));
  for (const col of config.columns) {
    let hits = 0;
    for (const s of col) if (activeIds.has(s.id)) hits++;
    if (hits === activeIds.size) {
      return col.filter((s) => activeIds.has(s.id)).map((s) => s.id);
    }
  }
  // Fallback — shouldn't happen since active is drawn from a column.
  return config.activeSymbols.map((s) => s.id);
}
