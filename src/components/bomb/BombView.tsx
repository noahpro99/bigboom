import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WireModule } from "./WireModule";
import { ButtonModule } from "./ButtonModule";
import { SymbolsModule } from "./SymbolsModule";
import { SimonModule } from "./SimonModule";
import { MazeModule } from "./MazeModule";
import { MemoryModule } from "./MemoryModule";
import { MorseModule } from "./MorseModule";
import { PasswordModule } from "./PasswordModule";
import { ComplicatedWiresModule } from "./ComplicatedWiresModule";
import { WhosOnFirstModule } from "./WhosOnFirstModule";
import { WireSequencesModule } from "./WireSequencesModule";
import { Timer } from "./Timer";
import { ProfileButton } from "../ProfileButton";
import { BatteryPanel } from "./BatteryPanel";
import {
  cutWire,
  tapButton,
  startHold,
  releaseHold,
  pressSymbol,
  pressSimon,
  moveMaze,
  pressMemory,
  dialMorse,
  transmitMorse,
  cyclePassword,
  submitPassword,
  cutCompWire,
  pressWhoFirst,
  cutWireSeq,
} from "../../server/game";
import { useDisplayTime } from "../../lib/useDisplayTime";
import { play } from "../../lib/sound";
import { tryMazeMove } from "../../lib/generator";
import { getSessionId } from "../../lib/session";
import type {
  GameState,
  Module,
  ButtonModuleConfig,
  ModuleState,
  MazeModuleConfig,
  MemoryModuleConfig,
} from "../../lib/types";
import { Skull, Wifi, Activity } from "lucide-react";

interface BombViewProps {
  gameState: GameState;
  /* True for spectators — they see the bomb but every interactive
     control is gated through `disabled`. */
  readOnly?: boolean;
}

export function BombView({ gameState, readOnly = false }: BombViewProps) {
  const qc = useQueryClient();
  const { game, modules } = gameState;
  const sessionId = getSessionId();
  /* The exact key TanStack Query uses for the game-state poll. We
     read/write this cache directly for optimistic updates so the bomb
     reacts the instant a button is pressed instead of waiting for the
     server round-trip. */
  const gameQueryKey = ["game", game.id, sessionId];
  const timeRemaining = useDisplayTime(
    game.startedAt,
    game.timerSeconds,
    gameState.timeRemaining,
    game.status
  );
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["game", game.id] });

  /* Apply an immediate patch to one module's state inside the cached
     game payload. Used by every action's onMutate so the visible
     change lands the moment the user clicks. */
  function patchModuleState(
    moduleId: string,
    updater: (s: ModuleState, mod: Module) => ModuleState
  ): GameState | null {
    const previous = qc.getQueryData<GameState>(gameQueryKey);
    if (!previous) return null;
    qc.setQueryData<GameState>(gameQueryKey, {
      ...previous,
      modules: previous.modules.map((m) =>
        m.id === moduleId ? { ...m, state: updater(m.state, m) } : m
      ),
    });
    return previous;
  }

  // Fire the wrong-buzzer whenever a defuser action was scored incorrect.
  // The server returns { correct: boolean } on every scoring mutation; if it's
  // false we play the buzzer in addition to invalidating the query.
  const onActionResult = (result: { correct?: boolean } | void) => {
    if (result && result.correct === false) play("wrongBuzzer");
    invalidate();
  };

  /* Generic shape of every action's onMutate context: the cached game
     state before we touched it, so onError can roll back if the server
     rejects. We cancel the in-flight refetch first so a pending poll
     can't overwrite the optimistic patch. */
  type Ctx = { previous: GameState | null };
  async function snapshotAndCancel(): Promise<Ctx> {
    await qc.cancelQueries({ queryKey: gameQueryKey });
    return { previous: qc.getQueryData<GameState>(gameQueryKey) ?? null };
  }
  function rollback(ctx?: Ctx) {
    if (ctx?.previous) qc.setQueryData(gameQueryKey, ctx.previous);
  }

  /* WIRE — the slot is added to cutWires immediately so the wire dims
     before the server scoring round-trip. If it's wrong the server
     responds correct=false (we play the buzzer); the cutWires entry
     stays either way because the server records it on both branches. */
  const cutMut = useMutation({
    mutationFn: cutWire,
    onMutate: async (vars) => {
      const ctx = await snapshotAndCancel();
      patchModuleState(vars.data.moduleId, (s) => ({
        ...s,
        cutWires: [...(s.cutWires ?? []), vars.data.slotIndex],
      }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx as Ctx),
    onSuccess: onActionResult,
  });
  /* BUTTON — tap can't be predicted client-side (it's a server-side
     check against the rule list), so no optimistic state change. */
  const tapMut = useMutation({ mutationFn: tapButton, onSuccess: onActionResult });
  /* BUTTON HOLD — set isHolding immediately so the LED strip appears
     under the cap on press. */
  const startMut = useMutation({
    mutationFn: startHold,
    onMutate: async (vars) => {
      const ctx = await snapshotAndCancel();
      patchModuleState(vars.data.moduleId, (s) => ({ ...s, isHolding: true }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx as Ctx),
    onSuccess: invalidate,
  });
  const releaseMut = useMutation({
    mutationFn: releaseHold,
    onMutate: async (vars) => {
      const ctx = await snapshotAndCancel();
      patchModuleState(vars.data.moduleId, (s) => ({ ...s, isHolding: false }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx as Ctx),
    onSuccess: onActionResult,
  });
  /* SYMBOL — assume the press is correct and add the id to pressedIds.
     If the server says correct=false, onActionResult plays the buzzer
     and the subsequent invalidate refetches the real state (which on
     wrong press is pressedIds=[] — the optimistic entry vanishes). */
  const pressMut = useMutation({
    mutationFn: pressSymbol,
    onMutate: async (vars) => {
      const ctx = await snapshotAndCancel();
      patchModuleState(vars.data.moduleId, (s) => ({
        ...s,
        pressedIds: [...(s.pressedIds ?? []), vars.data.symbolId],
      }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx as Ctx),
    onSuccess: onActionResult,
  });
  /* SIMON — assume correct: increment the counter so the next pip
     lights immediately. */
  const simonMut = useMutation({
    mutationFn: pressSimon,
    onMutate: async (vars) => {
      const ctx = await snapshotAndCancel();
      patchModuleState(vars.data.moduleId, (s) => ({
        ...s,
        simonPressed: (s.simonPressed ?? 0) + 1,
      }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx as Ctx),
    onSuccess: onActionResult,
  });
  /* MAZE — we can compute the move's legality locally (the maze config
     is on the client), so only apply the optimistic move if it would
     actually be allowed. Skip the patch on wall collisions; the server
     still validates and applies the strike. */
  const mazeMut = useMutation({
    mutationFn: moveMaze,
    onMutate: async (vars) => {
      const ctx = await snapshotAndCancel();
      const mod = modules.find((m) => m.id === vars.data.moduleId);
      if (mod && mod.type === "maze") {
        const cfg = mod.config as MazeModuleConfig;
        const active = cfg.pool[cfg.activeIndex];
        const from = mod.state.mazePos ?? cfg.start;
        const next = tryMazeMove(active.walls, from, vars.data.direction);
        if (next) {
          patchModuleState(vars.data.moduleId, (s) => ({
            ...s,
            mazePos: next,
            mazeTrail: [...(s.mazeTrail ?? [cfg.start]), next],
          }));
        }
      }
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx as Ctx),
    onSuccess: onActionResult,
  });
  /* MEMORY — assume correct: append a synthetic press to history so
     the stage pip lights and the bomb advances. Server rolls back on
     wrong. */
  const memoryMut = useMutation({
    mutationFn: pressMemory,
    onMutate: async (vars) => {
      const ctx = await snapshotAndCancel();
      const mod = modules.find((m) => m.id === vars.data.moduleId);
      if (mod && mod.type === "memory") {
        const cfg = mod.config as MemoryModuleConfig;
        const stageIdx = mod.state.memoryHistory?.length ?? 0;
        const stage = cfg.stages[stageIdx];
        if (stage) {
          const label = stage.labels[vars.data.position - 1] ?? 1;
          patchModuleState(vars.data.moduleId, (s) => ({
            ...s,
            memoryHistory: [
              ...(s.memoryHistory ?? []),
              { position: vars.data.position, label },
            ],
          }));
        }
      }
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx as Ctx),
    onSuccess: onActionResult,
  });
  /* MORSE DIAL — pure state setter. No correctness check, so the
     optimistic update is always right. */
  const morseDialMut = useMutation({
    mutationFn: dialMorse,
    onMutate: async (vars) => {
      const ctx = await snapshotAndCancel();
      patchModuleState(vars.data.moduleId, (s) => ({
        ...s,
        morseFreqIndex: vars.data.freqIndex,
      }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx as Ctx),
    onSuccess: invalidate,
  });
  const morseTxMut = useMutation({
    mutationFn: transmitMorse,
    onSuccess: onActionResult,
  });
  /* PASSWORD DIAL — also a pure state setter. */
  const pwCycleMut = useMutation({
    mutationFn: cyclePassword,
    onMutate: async (vars) => {
      const ctx = await snapshotAndCancel();
      patchModuleState(vars.data.moduleId, (s, mod) => {
        const cur =
          s.passwordDials ?? new Array((mod.config as { columns: string[][] }).columns.length).fill(0);
        const colLen = (mod.config as { columns: string[][] }).columns[vars.data.col].length;
        const next = [...cur];
        next[vars.data.col] =
          (((cur[vars.data.col] ?? 0) + vars.data.delta) % colLen + colLen) % colLen;
        return { ...s, passwordDials: next };
      });
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx as Ctx),
    onSuccess: invalidate,
  });
  const pwSubmitMut = useMutation({
    mutationFn: submitPassword,
    onSuccess: onActionResult,
  });
  /* COMPLICATED WIRES — like the basic Wire module, record the cut
     immediately so the wire fades. Whether it was correct comes back
     from the server. */
  const compCutMut = useMutation({
    mutationFn: cutCompWire,
    onMutate: async (vars) => {
      const ctx = await snapshotAndCancel();
      patchModuleState(vars.data.moduleId, (s) => ({
        ...s,
        cutCompWires: [...(s.cutCompWires ?? []), vars.data.slotIndex],
      }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx as Ctx),
    onSuccess: onActionResult,
  });
  /* WHO'S ON FIRST — optimistically advance the stage on press; the
     server rolls back if the press was wrong (stage resets to 0,
     server says correct=false → buzzer + refetch). */
  const whoMut = useMutation({
    mutationFn: pressWhoFirst,
    onMutate: async (vars) => {
      const ctx = await snapshotAndCancel();
      patchModuleState(vars.data.moduleId, (s) => ({
        ...s,
        whoStage: (s.whoStage ?? 0) + 1,
      }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx as Ctx),
    onSuccess: onActionResult,
  });
  /* WIRE SEQUENCES — same shape as Complicated Wires: optimistically
     mark the slot cut so the wire fades immediately. */
  const wireSeqCutMut = useMutation({
    mutationFn: cutWireSeq,
    onMutate: async (vars) => {
      const ctx = await snapshotAndCancel();
      patchModuleState(vars.data.moduleId, (s) => ({
        ...s,
        cutWireSeqs: [...(s.cutWireSeqs ?? []), vars.data.slotIndex],
      }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx as Ctx),
    onSuccess: onActionResult,
  });

  /* Spectators see everything but can't interact — fold into the same
     `disabled` gate every module already checks. */
  const disabled = game.status !== "active" || readOnly;

  /* batteryCount is a bomb-wide attribute stamped on the Button module's
     config (only one Button module per bomb). Pulled out here so the
     chassis header can render the battery pack alongside the serial. */
  const buttonMod = modules.find((m) => m.type === "button");
  const batteryCount = buttonMod
    ? (buttonMod.config as ButtonModuleConfig).batteryCount
    : 0;

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

          {/* Right: battery pack + strikes */}
          <div className="flex items-end gap-2 sm:gap-3">
            <BatteryPanel count={batteryCount} />
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
        </div>

        {/* Mini status bar under header — telemetry / bay readout
            on the left, profile/settings chip on the right. */}
        <div className="max-w-6xl mx-auto mt-2 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim/70 gap-2">
          <div className="hidden sm:flex items-center gap-2">
            <Activity size={10} className="text-phosphor" />
            <span>Telemetry · Live</span>
          </div>
          <span className="hidden md:inline">Defusal Bay · Unit 7</span>
          <ProfileButton variant="dark" showLabel={false} className="sm:hidden" />
          <ProfileButton variant="dark" className="hidden sm:flex" />
        </div>
      </div>

      {/* Bomb body — module grid. The bay itself is a sheet of brushed
          steel; the grid lines stay on top for a subtle inspection grid. */}
      <div className="flex-1 overflow-auto scrollbar-dark px-4 sm:px-6 py-5 sm:py-8 relative tx-metal-deep tx-grid-fine">
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
                      /* Send the exact integer the client was showing
                         at the moment of release — the server applies
                         the timing rule against THAT value. No
                         server-side clock comparison, no off-by-one
                         from network/poll latency. */
                      releaseMut.mutate({
                        data: {
                          gameId: game.id,
                          moduleId: mod.id,
                          releasedAt: timeRemaining,
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
              if (mod.type === 'simon') {
                return (
                  <SimonModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onPress={(color) =>
                      simonMut.mutate({
                        data: { gameId: game.id, moduleId: mod.id, color },
                      })
                    }
                  />
                );
              }
              if (mod.type === 'maze') {
                return (
                  <MazeModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onMove={(direction) =>
                      mazeMut.mutate({
                        data: { gameId: game.id, moduleId: mod.id, direction },
                      })
                    }
                  />
                );
              }
              if (mod.type === 'memory') {
                return (
                  <MemoryModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onPress={(position) =>
                      memoryMut.mutate({
                        data: { gameId: game.id, moduleId: mod.id, position },
                      })
                    }
                  />
                );
              }
              if (mod.type === 'morse') {
                return (
                  <MorseModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    /* Spectators can hold AUDIO to listen even though
                       they can't dial or transmit. Game must still be
                       live (not won/lost/waiting). */
                    canListen={game.status === "active"}
                    onDial={(freqIndex) =>
                      morseDialMut.mutate({
                        data: { moduleId: mod.id, freqIndex },
                      })
                    }
                    onTransmit={() =>
                      morseTxMut.mutate({
                        data: { gameId: game.id, moduleId: mod.id },
                      })
                    }
                  />
                );
              }
              if (mod.type === 'password') {
                return (
                  <PasswordModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onCycle={(col, delta) =>
                      pwCycleMut.mutate({
                        data: { moduleId: mod.id, col, delta },
                      })
                    }
                    onSubmit={() =>
                      pwSubmitMut.mutate({
                        data: { gameId: game.id, moduleId: mod.id },
                      })
                    }
                  />
                );
              }
              if (mod.type === 'compWires') {
                return (
                  <ComplicatedWiresModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onCut={(slotIndex) =>
                      compCutMut.mutate({
                        data: { gameId: game.id, moduleId: mod.id, slotIndex },
                      })
                    }
                  />
                );
              }
              if (mod.type === 'whoFirst') {
                return (
                  <WhosOnFirstModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onPress={(word) =>
                      whoMut.mutate({
                        data: { gameId: game.id, moduleId: mod.id, word },
                      })
                    }
                  />
                );
              }
              if (mod.type === 'wireSeq') {
                return (
                  <WireSequencesModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onCut={(slotIndex) =>
                      wireSeqCutMut.mutate({
                        data: { gameId: game.id, moduleId: mod.id, slotIndex },
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
