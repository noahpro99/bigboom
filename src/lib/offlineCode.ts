/* Offline match share codes.
 *
 * An offline match is fully determined by its seed plus its bomb config
 * (timer + module counts) — the serial number and every puzzle/solution
 * is derived from the seed, so two devices that share this code generate
 * the IDENTICAL bomb with no server and no sync. The Defuser validates
 * locally, the Expert renders the manual locally, and they talk in person.
 *
 * The code is compact + URL-safe so it fits comfortably in a QR and is
 * still typeable by hand:
 *
 *   bb1.<seed36>.<timer36>.<counts>
 *
 * where <counts> is one digit (0-3) per module type in MODULE_ORDER. */
import type { GameConfig, ModuleType, Preset } from "./types";
import {
  MAX_INSTANCES_PER_TYPE,
  detectPreset,
  moduleCounts,
  moduleTypesFromCounts,
} from "./types";

/* Canonical module order — must stay in sync with the order used by the
   server's normalizeConfig so a code round-trips to the same bomb. */
export const MODULE_ORDER: ModuleType[] = [
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

const PREFIX = "bb1";

export interface OfflineMatch {
  seed: number;
  timerSeconds: number;
  moduleTypes: ModuleType[];
  preset: Preset;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000);
}

/* Clamp + canonicalise a loose config into a real OfflineMatch. Mirrors
   the server's normalizeConfig so online and offline bombs agree. */
export function normalizeMatch(input: {
  seed: number;
  timerSeconds: number;
  moduleTypes: ModuleType[];
}): OfflineMatch {
  const seed = input.seed >>> 0;
  const timerSeconds = Math.max(
    60,
    Math.min(1800, Math.floor(input.timerSeconds || 300))
  );
  const counts = moduleCounts(input.moduleTypes);
  const moduleTypes = moduleTypesFromCounts(counts);
  const preset = detectPreset({ timerSeconds, moduleTypes });
  return { seed, timerSeconds, moduleTypes, preset };
}

export function matchFromConfig(seed: number, config: GameConfig): OfflineMatch {
  return normalizeMatch({
    seed,
    timerSeconds: config.timerSeconds,
    moduleTypes: config.moduleTypes,
  });
}

/* Encode a match into a share code. */
export function encodeMatch(match: OfflineMatch): string {
  const counts = moduleCounts(match.moduleTypes);
  const countStr = MODULE_ORDER.map((t) =>
    String(Math.max(0, Math.min(MAX_INSTANCES_PER_TYPE, counts[t])))
  ).join("");
  const seed36 = (match.seed >>> 0).toString(36);
  const timer36 = Math.floor(match.timerSeconds).toString(36);
  return [PREFIX, seed36, timer36, countStr].join(".");
}

/* Decode a share code back into a match. Returns null if it isn't a
   well-formed bb1 code. Tolerates surrounding whitespace, a leading
   URL (so a scanned `https://…/offline?join=<code>` link works), and
   case. */
export function decodeMatch(raw: string): OfflineMatch | null {
  if (!raw) return null;
  let text = raw.trim();

  // Pull the code out of a URL if one was scanned/pasted.
  const fromUrl = extractCodeFromUrl(text);
  if (fromUrl) text = fromUrl;

  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const [prefix, seed36, timer36, countStr] = parts;
  if (prefix.toLowerCase() !== PREFIX) return null;

  const seed = parseInt(seed36, 36);
  const timer = parseInt(timer36, 36);
  if (!Number.isFinite(seed) || !Number.isFinite(timer)) return null;
  if (!/^[0-3]{11}$/.test(countStr)) return null;

  const counts: Partial<Record<ModuleType, number>> = {};
  MODULE_ORDER.forEach((t, i) => {
    counts[t] = Number(countStr[i]);
  });

  return normalizeMatch({
    seed,
    timerSeconds: timer,
    moduleTypes: moduleTypesFromCounts(counts),
  });
}

/* Try to read a `join`/`c` query param or a trailing path segment out of
   a URL. Falls back to null so plain codes pass through untouched. */
function extractCodeFromUrl(text: string): string | null {
  if (!/https?:\/\//i.test(text) && !text.includes("?")) return null;
  try {
    const url = new URL(text, "http://placeholder.local");
    const q = url.searchParams.get("join") ?? url.searchParams.get("c");
    if (q) return q;
    const m = url.pathname.match(/(bb1\.[^/]+)/i);
    if (m) return m[1];
  } catch {
    /* not a URL — fall through */
  }
  const bare = text.match(/bb1\.[A-Za-z0-9.]+/i);
  return bare ? bare[0] : null;
}

/* Build the shareable invite URL that the QR encodes. Scanning it with a
   phone's native camera (while online) opens the app straight into the
   join flow; the in-app scanner also reads the embedded code while fully
   offline. */
export function inviteUrl(origin: string, match: OfflineMatch): string {
  return `${origin}/offline?join=${encodeMatch(match)}`;
}
