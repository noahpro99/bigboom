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
  ManualPage,
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
  const batteryCount = 1 + Math.floor(rng() * 4);
  const indicatorLabel = pick(rng, indicatorLabels) as string;
  const indicatorLit = rng() > 0.5;

  // 2 immediate-release rules (color+label combos)
  const pairs = buttonColors.flatMap((c) =>
    buttonLabels.map((l) => ({ color: c, label: l }))
  );
  const releaseImmediatelyRules = pickN(rng, pairs, 2);

  // Battery hold rule
  const holdBatteryThreshold = 2 + Math.floor(rng() * 2); // 2 or 3
  const holdBatteryLabel = pick(rng, buttonLabels) as ButtonLabel;

  // Strip color → release timing rules
  const stripRules = stripColors.map((stripColor) => ({
    stripColor,
    releaseDigitPosition: pick(rng, [
      "ones",
      "tens",
      "hundreds",
    ] as const),
    releaseValue: Math.floor(rng() * 5), // 0-4
  }));

  // The color the LED strip will actually show during a hold
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

  const seconds = timerSecondsRemaining % 60;
  const minutes = Math.floor(timerSecondsRemaining / 60);
  const ones = seconds % 10;
  const tens = Math.floor(seconds / 10);
  const hundreds = minutes % 10;

  const target =
    rule.releaseDigitPosition === "ones"
      ? ones
      : rule.releaseDigitPosition === "tens"
      ? tens
      : hundreds;

  return target === rule.releaseValue;
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
): { position: string; value: number } {
  const rule = config.stripRules.find((r) => r.stripColor === stripColor);
  if (!rule)
    return { position: "ones", value: 1 };
  return { position: rule.releaseDigitPosition, value: rule.releaseValue };
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
        content: [
          {
            type: "table",
            headers: ["#", "Condition", "Cut"],
            rows: wireConfig.rules.map((r, i) => [
              String(i + 1),
              r.conditionText,
              r.cutText,
            ]),
          },
        ],
      },
    ],
  };

  const immediateRows = buttonConfig.releaseImmediatelyRules.map((r) => [
    r.color.toUpperCase(),
    r.label,
    "Press and immediately release",
  ]);

  const stripRows = buttonConfig.stripRules.map((r) => [
    r.stripColor.toUpperCase(),
    `Release when ${r.releaseDigitPosition} digit = ${r.releaseValue}`,
  ]);

  const buttonPage: ManualPage = {
    moduleType: "button",
    title: "BUTTON MODULE",
    sections: [
      {
        heading: "Tap or hold? — apply the first rule that matches",
        content: [
          {
            type: "table",
            headers: ["Color", "Label", "Action"],
            rows: [
              ...immediateRows,
              [
                "Any",
                "Any",
                `If ${buttonConfig.holdBatteryThreshold}+ batteries and label is ${buttonConfig.holdBatteryLabel}, HOLD`,
              ],
              ["Any", "Any", "Otherwise: tap (press and immediately release)"],
            ],
          },
        ],
      },
      {
        heading: "If holding — release timing by LED strip colour",
        content: [
          {
            type: "table",
            headers: ["Strip color", "Release when"],
            rows: stripRows,
          },
        ],
      },
    ],
  };

  return [wirePage, buttonPage];
}
