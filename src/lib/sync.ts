/* Optimistic, best-effort online tracking for offline-first games.
 *
 * Gameplay is fully local + deterministic (src/lib/offlineEngine.ts), so
 * none of this is required for a game to work. These helpers fire the
 * server-side tracking endpoints (src/server/game.ts) in the background
 * and swallow every failure — being offline, a flaky network, or the
 * server being unreachable all just mean "not tracked," never a blocked
 * or broken game. */
import { trackLobby, trackResult } from "../server/game";
import { canonicalModuleSet } from "./types";
import type { OfflineMatch } from "./offlineCode";

/* Short, room-style id for a single play session. Distinct per arm so the
   server's result stats count each playthrough once (the shareable SEED
   code is separate — that identifies the bomb, this identifies the run). */
export function newRoomId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  return Array.from(
    { length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

/* Mirror a freshly-armed game to the server. Fire-and-forget. */
export function reportLobby(
  gameId: string,
  serial: string,
  match: OfflineMatch
): void {
  void trackLobby({
    data: {
      gameId,
      seed: match.seed,
      serial,
      preset: match.preset,
      timerSeconds: match.timerSeconds,
      moduleSet: canonicalModuleSet(match.moduleTypes),
    },
  }).catch(() => {
    /* offline / unreachable — tracking is optional */
  });
}

/* Mirror a finished game's result to the server. Fire-and-forget. */
export function reportResult(
  gameId: string,
  match: OfflineMatch,
  status: "won" | "lost",
  durationMs: number | null
): void {
  void trackResult({
    data: {
      gameId,
      preset: match.preset,
      timerSeconds: match.timerSeconds,
      moduleSet: canonicalModuleSet(match.moduleTypes),
      status,
      durationMs,
    },
  }).catch(() => {
    /* offline / unreachable — tracking is optional */
  });
}
