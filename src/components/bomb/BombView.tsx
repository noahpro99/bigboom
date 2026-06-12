import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WireModule } from "./WireModule";
import { ButtonModule } from "./ButtonModule";
import { SymbolsModule } from "./SymbolsModule";
import { Timer } from "./Timer";
import {
  cutWire,
  tapButton,
  startHold,
  releaseHold,
  pressSymbol,
} from "../../server/game";
import { useDisplayTime } from "../../lib/useDisplayTime";
import { play } from "../../lib/sound";
import { checkReleaseTiming } from "../../lib/generator";
import type {
  GameState,
  Module,
  ButtonModuleConfig,
} from "../../lib/types";
import { Skull, Wifi, Activity } from "lucide-react";

interface BombViewProps {
  gameState: GameState;
}

export function BombView({ gameState }: BombViewProps) {
  const qc = useQueryClient();
  const { game, modules } = gameState;
  const timeRemaining = useDisplayTime(
    game.startedAt,
    game.timerSeconds,
    gameState.timeRemaining,
    game.status
  );
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["game", game.id] });

  // Fire the wrong-buzzer whenever a defuser action was scored incorrect.
  // The server returns { correct: boolean } on every scoring mutation; if it's
  // false we play the buzzer in addition to invalidating the query.
  const onActionResult = (result: { correct?: boolean } | void) => {
    if (result && result.correct === false) play("wrongBuzzer");
    invalidate();
  };

  const cutMut = useMutation({ mutationFn: cutWire, onSuccess: onActionResult });
  const tapMut = useMutation({ mutationFn: tapButton, onSuccess: onActionResult });
  const startMut = useMutation({ mutationFn: startHold, onSuccess: invalidate });
  const releaseMut = useMutation({
    mutationFn: releaseHold,
    onSuccess: onActionResult,
  });
  const pressMut = useMutation({
    mutationFn: pressSymbol,
    onSuccess: onActionResult,
  });

  const disabled = game.status !== "active";

  return (
    <div className="h-full flex flex-col tx-grid relative">
      <div className="absolute top-0 left-0 right-0 h-1.5 tx-stripes opacity-90 z-10" />
      <div className="absolute bottom-0 left-0 right-0 h-1.5 tx-stripes opacity-90 z-10" />

      {/* Chassis header */}
      <div className="relative border-b border-rib bg-chassis/80 backdrop-blur-sm px-4 sm:px-6 py-3 z-20">
        <div className="flex items-center justify-between gap-2 sm:gap-4 max-w-6xl mx-auto">
          {/* Left: serial sticker */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="relative bg-amber/95 text-void px-2 sm:px-3 py-1 sm:py-1.5 font-stencil tracking-wider text-sm shadow-md transform -rotate-1">
              <div className="text-[7px] sm:text-[8px] uppercase tracking-[0.3em] leading-none mb-0.5 opacity-80">
                SER.
              </div>
              <div className="font-mono font-black tracking-[0.12em] sm:tracking-[0.18em] leading-tight text-xs sm:text-sm">
                {game.serial}
              </div>
            </div>
            <div className="hidden sm:flex flex-col gap-1">
              <span className="text-[9px] font-stencil tracking-[0.25em] text-bone-dim uppercase flex items-center gap-1">
                <Wifi size={9} /> ROOM
              </span>
              <span className="font-mono text-xs text-bone tracking-widest">
                {game.id}
              </span>
            </div>
          </div>

          {/* Center: timer */}
          <Timer seconds={timeRemaining} status={game.status} />

          {/* Right: strikes */}
          <div className="flex flex-col items-end gap-1">
            <span className="hidden sm:flex text-[9px] font-stencil tracking-[0.3em] text-bone-dim uppercase items-center gap-1">
              <Skull size={10} /> STRIKES
            </span>
            <Skull size={10} className="sm:hidden text-bone-dim mb-0.5" />
            <div className="flex items-center gap-1 sm:gap-1.5 border border-steel/50 px-2 sm:px-2.5 py-1 bg-black/50">
              {Array.from({ length: game.maxStrikes }).map((_, i) => {
                const isHit = i < game.strikes;
                return (
                  <div
                    key={i}
                    className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ${
                      isHit
                        ? "bg-crimson shadow-[0_0_8px_#e0245e]"
                        : "bg-steel/70 border border-steel-light/30"
                    }`}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Mini status bar under header */}
        <div className="hidden sm:flex max-w-6xl mx-auto mt-2 items-center justify-between text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim/70">
          <div className="flex items-center gap-2">
            <Activity size={10} className="text-phosphor" />
            <span>Telemetry · Live</span>
          </div>
          <span>Defusal Bay · Unit 7</span>
        </div>
      </div>

      {/* Bomb body — module grid */}
      <div className="flex-1 overflow-auto scrollbar-dark px-4 sm:px-6 py-5 sm:py-8 relative">
        <div className="max-w-3xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {modules.map((mod: Module) => {
              if (mod.type === "wire") {
                return (
                  <WireModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onCut={(slotIndex) =>
                      cutMut.mutate({
                        data: { gameId: game.id, moduleId: mod.id, slotIndex },
                      })
                    }
                  />
                );
              }
              if (mod.type === "button") {
                return (
                  <ButtonModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onTap={() =>
                      tapMut.mutate({
                        data: { gameId: game.id, moduleId: mod.id },
                      })
                    }
                    onHoldStart={() =>
                      startMut.mutate({ data: { moduleId: mod.id } })
                    }
                    onHoldRelease={() => {
                      // Client-side validation — the client has the module
                      // config (so it knows the rule) and the exact value the
                      // user just saw, so it decides correctness and tells
                      // the server the verdict.
                      const cfg = mod.config as ButtonModuleConfig;
                      const correct = checkReleaseTiming(cfg, timeRemaining);
                      releaseMut.mutate({
                        data: {
                          gameId: game.id,
                          moduleId: mod.id,
                          correct,
                        },
                      });
                    }}
                  />
                );
              }
              if (mod.type === 'symbols') {
                return (
                  <SymbolsModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onPress={(symbolId) =>
                      pressMut.mutate({
                        data: { gameId: game.id, moduleId: mod.id, symbolId },
                      })
                    }
                  />
                );
              }
              return null;
            })}
          </div>

          {/* Chassis footer plate */}
          <div className="mt-10 border-t border-rib/50 pt-3 flex items-center justify-between text-[9px] font-mono uppercase tracking-[0.3em] text-bone-dim/60">
            <span>ACME DEFUSAL DEVICE · MK-VII</span>
            <span className="hidden sm:inline">DO NOT REMOVE THIS PANEL</span>
          </div>
        </div>
      </div>
    </div>
  );
}
