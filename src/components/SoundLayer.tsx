import { useEffect, useRef } from "react";
import { useDisplayTime } from "../lib/useDisplayTime";
import { play } from "../lib/sound";
import type { GameState } from "../lib/types";

/**
 * Game-state-driven sound effects: per-second timer tick (urgent variant
 * under 30s) and the boom on game-over. Rendered for BOTH the defuser and
 * expert so they share the same audio cues.
 */
interface SoundLayerProps {
  gameState: GameState;
}

export function SoundLayer({ gameState }: SoundLayerProps) {
  const { game } = gameState;
  const timeRemaining = useDisplayTime(
    game.startedAt,
    game.timerSeconds,
    gameState.timeRemaining,
    game.status
  );

  // Tick sound — once per integer-second change while the game is active.
  const lastTickRef = useRef<number | null>(null);
  const sec = Math.floor(timeRemaining);
  useEffect(() => {
    if (game.status !== "active") {
      lastTickRef.current = null;
      return;
    }
    if (sec <= 0) return;
    // Skip the very first observed second (no startup beep).
    if (lastTickRef.current !== null && lastTickRef.current !== sec) {
      play(sec <= 30 ? "timerCritical" : "timerTick");
    }
    lastTickRef.current = sec;
  }, [sec, game.status]);

  // Explosion on a fresh transition into "lost".
  const playedExplosionRef = useRef(false);
  useEffect(() => {
    if (game.status === "lost" && !playedExplosionRef.current) {
      playedExplosionRef.current = true;
      play("explosion");
    } else if (game.status !== "lost") {
      playedExplosionRef.current = false;
    }
  }, [game.status]);

  return null;
}
