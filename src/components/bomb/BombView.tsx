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
  Direction,
} from "../../lib/types";
import { Skull, Wifi, Activity } from "lucide-react";

/* The full set of defuser actions BombView wires to the module controls.
   Online play backs these with TanStack Start server mutations (see
   useServerBombActions); offline play injects engine-backed handlers that
   mutate local state synchronously. Either way BombView's rendering — and
   every child module — is identical. */
export interface BombActions {
  onCut(moduleId: string, slotIndex: number): void;
  onTap(moduleId: string): void;
  onHoldStart(moduleId: string): void;
  onHoldRelease(moduleId: string, releasedAt: number): void;
  onPressSymbol(moduleId: string, symbolId: string): void;
  onPressSimon(moduleId: string, color: string): void;
  onMoveMaze(moduleId: string, direction: Direction): void;
  onPressMemory(moduleId: string, position: number): void;
  onDialMorse(moduleId: string, freqIndex: number): void;
  onTransmitMorse(moduleId: string): void;
  onCyclePassword(moduleId: string, col: number, delta: number): void;
  onSubmitPassword(moduleId: string): void;
  onCutCompWire(moduleId: string, slotIndex: number): void;
  onPressWhoFirst(moduleId: string, word: string): void;
  onCutWireSeq(moduleId: string, slotIndex: number): void;
}

/* Online action set: server mutations + optimistic cache patches so the
   bomb reacts the instant a control is used rather than waiting for the
   round-trip. This is the original BombView behaviour, lifted into a hook
   so offline play can swap in its own implementation. */
function useServerBombActions(gameState: GameState): BombActions {
  const qc = useQueryClient();
  const { game, modules } = gameState;
  const sessionId = getSessionId();
  const gameQueryKey = ["game", game.id, sessionId];
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["game", game.id] });

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

  const onActionResult = (result: { correct?: boolean } | void) => {
    if (result && result.correct === false) play("wrongBuzzer");
    invalidate();
  };

  type Ctx = { previous: GameState | null };
  async function snapshotAndCancel(): Promise<Ctx> {
    await qc.cancelQueries({ queryKey: gameQueryKey });
    return { previous: qc.getQueryData<GameState>(gameQueryKey) ?? null };
  }
  function rollback(ctx?: Ctx) {
    if (ctx?.previous) qc.setQueryData(gameQueryKey, ctx.previous);
  }

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
  const tapMut = useMutation({ mutationFn: tapButton, onSuccess: onActionResult });
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

  return {
    onCut: (moduleId, slotIndex) =>
      cutMut.mutate({ data: { gameId: game.id, moduleId, slotIndex } }),
    onTap: (moduleId) => tapMut.mutate({ data: { gameId: game.id, moduleId } }),
    onHoldStart: (moduleId) => startMut.mutate({ data: { moduleId } }),
    onHoldRelease: (moduleId, releasedAt) =>
      releaseMut.mutate({ data: { gameId: game.id, moduleId, releasedAt } }),
    onPressSymbol: (moduleId, symbolId) =>
      pressMut.mutate({ data: { gameId: game.id, moduleId, symbolId } }),
    onPressSimon: (moduleId, color) =>
      simonMut.mutate({ data: { gameId: game.id, moduleId, color } }),
    onMoveMaze: (moduleId, direction) =>
      mazeMut.mutate({ data: { gameId: game.id, moduleId, direction } }),
    onPressMemory: (moduleId, position) =>
      memoryMut.mutate({ data: { gameId: game.id, moduleId, position } }),
    onDialMorse: (moduleId, freqIndex) =>
      morseDialMut.mutate({ data: { moduleId, freqIndex } }),
    onTransmitMorse: (moduleId) =>
      morseTxMut.mutate({ data: { gameId: game.id, moduleId } }),
    onCyclePassword: (moduleId, col, delta) =>
      pwCycleMut.mutate({ data: { moduleId, col, delta } }),
    onSubmitPassword: (moduleId) =>
      pwSubmitMut.mutate({ data: { gameId: game.id, moduleId } }),
    onCutCompWire: (moduleId, slotIndex) =>
      compCutMut.mutate({ data: { gameId: game.id, moduleId, slotIndex } }),
    onPressWhoFirst: (moduleId, word) =>
      whoMut.mutate({ data: { gameId: game.id, moduleId, word } }),
    onCutWireSeq: (moduleId, slotIndex) =>
      wireSeqCutMut.mutate({ data: { gameId: game.id, moduleId, slotIndex } }),
  };
}

interface BombViewProps {
  gameState: GameState;
  readOnly?: boolean;
  actions?: BombActions;
  onGiveUp?: () => void;
}

export function BombView({ gameState, readOnly = false, actions, onGiveUp }: BombViewProps) {
  const { game, modules } = gameState;
  const timeRemaining = useDisplayTime(
    game.startedAt,
    game.timerSeconds,
    gameState.timeRemaining,
    game.status
  );

  /* The hook is always called (Rules of Hooks); for offline play its
     mutations simply go unused because `actions` is supplied. */
  const serverActions = useServerBombActions(gameState);
  const act = actions ?? serverActions;

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
          <ProfileButton variant="dark" showLabel={false} className="sm:hidden" onGiveUp={onGiveUp} />
          <ProfileButton variant="dark" className="hidden sm:flex" onGiveUp={onGiveUp} />
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
                    onCut={(slotIndex) => act.onCut(mod.id, slotIndex)}
                  />
                );
              }
              if (mod.type === "button") {
                return (
                  <ButtonModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onTap={() => act.onTap(mod.id)}
                    onHoldStart={() => act.onHoldStart(mod.id)}
                    onHoldRelease={() => {
                      /* Send the exact integer the client was showing
                         at the moment of release — the timing rule is
                         applied against THAT value. No clock comparison,
                         no off-by-one from network/poll latency. */
                      act.onHoldRelease(mod.id, timeRemaining);
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
                    onPress={(symbolId) => act.onPressSymbol(mod.id, symbolId)}
                  />
                );
              }
              if (mod.type === 'simon') {
                return (
                  <SimonModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onPress={(color) => act.onPressSimon(mod.id, color)}
                  />
                );
              }
              if (mod.type === 'maze') {
                return (
                  <MazeModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onMove={(direction) => act.onMoveMaze(mod.id, direction)}
                  />
                );
              }
              if (mod.type === 'memory') {
                return (
                  <MemoryModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onPress={(position) => act.onPressMemory(mod.id, position)}
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
                    onDial={(freqIndex) => act.onDialMorse(mod.id, freqIndex)}
                    onTransmit={() => act.onTransmitMorse(mod.id)}
                  />
                );
              }
              if (mod.type === 'password') {
                return (
                  <PasswordModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onCycle={(col, delta) => act.onCyclePassword(mod.id, col, delta)}
                    onSubmit={() => act.onSubmitPassword(mod.id)}
                  />
                );
              }
              if (mod.type === 'compWires') {
                return (
                  <ComplicatedWiresModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onCut={(slotIndex) => act.onCutCompWire(mod.id, slotIndex)}
                  />
                );
              }
              if (mod.type === 'whoFirst') {
                return (
                  <WhosOnFirstModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onPress={(word) => act.onPressWhoFirst(mod.id, word)}
                  />
                );
              }
              if (mod.type === 'wireSeq') {
                return (
                  <WireSequencesModule
                    key={mod.id}
                    module={mod}
                    disabled={disabled}
                    onCut={(slotIndex) => act.onCutWireSeq(mod.id, slotIndex)}
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
