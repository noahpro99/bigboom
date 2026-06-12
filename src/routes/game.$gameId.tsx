import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGameState,
  joinGame,
  startGame,
  checkTimer,
  restartGame,
  switchRole,
  updateGameConfig,
  getPresetDistribution,
  getGameResult,
} from "../server/game";
import { BombView } from "../components/bomb/BombView";
import { ManualView } from "../components/manual/ManualView";
import { ProfileButton } from "../components/ProfileButton";
import { SoundLayer } from "../components/SoundLayer";
import { getSessionId } from "../lib/session";
import { play, preloadAll, playMusic, stopMusic } from "../lib/sound";
import type {
  ModuleType,
  PlayerRole,
  Preset,
} from "../lib/types";
import {
  ALL_OPTIONAL_MODULES,
  MAX_INSTANCES_PER_TYPE,
  PRESET_CONFIGS,
  estimateTimerSeconds,
  moduleCounts,
  moduleTypesFromCounts,
} from "../lib/types";
import {
  Bomb,
  BookOpen,
  Link2,
  Check,
  AlertTriangle,
  Home,
  RotateCcw,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Skull,
} from "lucide-react";

export const Route = createFileRoute("/game/$gameId")({
  component: GamePage,
});

function GamePage() {
  const { gameId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [sessionId, setSessionId] = useState<string>("");
  useEffect(() => {
    setSessionId(getSessionId());
  }, []);

  const { data: gameState, error, isFetched } = useQuery({
    queryKey: ["game", gameId, sessionId],
    queryFn: () => getGameState({ data: { gameId, sessionId } }),
    refetchInterval: 1500,
    enabled: !!sessionId,
  });

  // The server is the source of truth for which role this session has.
  const playerRole: PlayerRole = gameState?.myRole ?? "defuser";

  const joinMut = useMutation({
    mutationFn: joinGame,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["game", gameId] }),
  });

  const [startError, setStartError] = useState<string | null>(null);
  const startMut = useMutation({
    mutationFn: startGame,
    onSuccess: (result) => {
      if (result && "error" in result && result.error) {
        setStartError(result.error);
      } else {
        setStartError(null);
      }
      qc.invalidateQueries({ queryKey: ["game", gameId] });
    },
  });

  const checkTimerMut = useMutation({
    mutationFn: checkTimer,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["game", gameId] }),
  });

  const restartMut = useMutation({
    mutationFn: restartGame,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["game", gameId] }),
  });

  const switchRoleMut = useMutation({
    mutationFn: switchRole,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["game", gameId] }),
  });

  const updateConfigMut = useMutation({
    mutationFn: updateGameConfig,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["game", gameId] }),
  });

  async function pickRole(target: PlayerRole) {
    if (target === playerRole || !sessionId) return;
    play("menuButton");
    await switchRoleMut.mutateAsync({
      data: { gameId, sessionId, toRole: target },
    });
  }

  const [copied, setCopied] = useState(false);
  async function copyInviteLink() {
    const inviteUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/game/${gameId}`
        : `/game/${gameId}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      play("menuButton");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!sessionId) return;
    joinMut.mutate({ data: { gameId, sessionId } });
  }, [gameId, sessionId]);

  // Warm the SFX cache once on mount so the first sound has no load latency.
  useEffect(() => {
    preloadAll();
  }, []);

  // Music carries through the whole experience. We just duck the volume
  // hard while the bomb is armed so the ticks and chatter sit on top, and
  // bring it back up for the lobby + game-over overlay.
  useEffect(() => {
    const status = gameState?.game.status;
    if (status === "active") playMusic("menuMusic", 0.02);
    else if (status === "waiting" || status === "won" || status === "lost") {
      playMusic("menuMusic", 0.12);
    }
  }, [gameState?.game.status]);

  useEffect(() => {
    if (gameState?.game.status !== "active") return;
    const interval = setInterval(() => {
      checkTimerMut.mutate({ data: { gameId } });
    }, 5000);
    return () => clearInterval(interval);
  }, [gameState?.game.status, gameId]);

  // Don't show "Signal Lost" until we've actually attempted at least one
  // fetch — otherwise a reload would briefly flash the error screen while
  // sessionId initialises and the query fires.
  const initializing = !sessionId || (!isFetched && !error);
  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center tx-grid">
        <div className="flex items-center gap-3 text-bone-dim font-mono text-xs uppercase tracking-[0.3em]">
          <Loader2 size={16} className="animate-spin" />
          <span>Connecting…</span>
        </div>
      </div>
    );
  }

  if (error || !gameState) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center tx-grid gap-4 px-4 relative">
        <div className="absolute top-0 left-0 right-0 h-1.5 tx-stripes opacity-80" />
        <div className="text-center max-w-sm">
          <AlertTriangle size={36} className="text-crimson mx-auto mb-3" />
          <div className="font-stencil text-3xl text-crimson mb-2 tracking-wider">
            SIGNAL LOST
          </div>
          <p className="text-bone-dim text-sm font-mono">
            Could not locate that bomb. The room may have been cleared.
          </p>
        </div>
        <button
          onClick={() => navigate({ to: "/" })}
          className="mt-3 px-6 py-2.5 bg-steel hover:bg-steel-light/40 text-bone font-mono uppercase tracking-[0.2em] text-xs transition-colors flex items-center gap-2"
        >
          <Home size={14} strokeWidth={2.5} />
          Back to Home
        </button>
      </div>
    );
  }

  const { game, players } = gameState;
  const hasDefuser = players.some((p) => p.role === "defuser");
  const hasExpert = players.some((p) => p.role === "expert");
  const bothPresent = hasDefuser && hasExpert;

  if (game.status === "waiting") {
    return <LobbyView
      gameId={gameId}
      playerRole={playerRole}
      hasDefuser={hasDefuser}
      hasExpert={hasExpert}
      bothPresent={bothPresent}
      copied={copied}
      preset={game.preset}
      timerSeconds={game.timerSeconds}
      moduleTypes={game.moduleTypes}
      onConfigChange={(next) =>
        updateConfigMut.mutate({ data: { gameId, ...next } })
      }
      configPending={updateConfigMut.isPending}
      onCopy={copyInviteLink}
      onPick={pickRole}
      onStart={() => {
        play("menuButton");
        setStartError(null);
        startMut.mutate({ data: { gameId } });
      }}
      startPending={startMut.isPending}
      startError={startError}
      switchPending={switchRoleMut.isPending}
      onHome={() => navigate({ to: "/" })}
    />;
  }

  const isOver = game.status === "won" || game.status === "lost";

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      {/* Headless audio side-effect — fires for both roles */}
      <SoundLayer gameState={gameState} />

      {playerRole === "defuser" ? (
        <BombView gameState={gameState} />
      ) : (
        <ManualView seed={game.seed} moduleTypes={game.moduleTypes} />
      )}

      {isOver && (
        <GameOverOverlay
          status={game.status}
          gameId={gameId}
          preset={game.preset}
          onRestart={() => {
            play("menuButton");
            restartMut.mutate({ data: { gameId } });
          }}
          restartPending={restartMut.isPending}
          onHome={() => navigate({ to: "/" })}
        />
      )}
    </div>
  );
}

/* Preset selector + collapsed Advanced drawer for the lobby. Sends the
   updated config up via onChange; the server is the source of truth and
   the next getGameState poll will sync any other tab in the room. */
const PRESET_META: Array<{
  preset: Exclude<Preset, "custom">;
  label: string;
  sub: string;
  Icon: typeof Bomb;
}> = [
  { preset: "quick", label: "Quick", sub: "3 min · 4 modules", Icon: Loader2 },
  { preset: "standard", label: "Standard", sub: "5 min · 6 modules", Icon: Bomb },
  { preset: "hardcore", label: "Hardcore", sub: "8 min · all 8", Icon: Skull },
];

const MODULE_META: Record<ModuleType, { label: string; sub: string }> = {
  wire: { label: "Wires", sub: "MOD-A" },
  button: { label: "Button", sub: "MOD-B" },
  symbols: { label: "Symbols", sub: "MOD-S" },
  simon: { label: "Simon", sub: "MOD-Σ" },
  maze: { label: "Maze", sub: "MOD-M" },
  memory: { label: "Memory", sub: "MOD-R" },
  morse: { label: "Morse", sub: "MOD-T" },
  password: { label: "Password", sub: "MOD-P" },
};

function ConfigSection({
  preset,
  timerSeconds,
  moduleTypes,
  onChange,
  pending,
}: {
  preset: Preset;
  timerSeconds: number;
  moduleTypes: ModuleType[];
  onChange: (next: {
    preset?: Preset;
    timerSeconds?: number;
    moduleTypes?: ModuleType[];
  }) => void;
  pending: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(preset === "custom");
  const counts = moduleCounts(moduleTypes);

  const [localTimer, setLocalTimer] = useState(timerSeconds);
  const draggingRef = useRef(false);
  useEffect(() => {
    if (!draggingRef.current) setLocalTimer(timerSeconds);
  }, [timerSeconds]);

  function pickPreset(p: Exclude<Preset, "custom">) {
    if (preset === p) return;
    play("menuButton");
    onChange({ preset: p });
  }

  function bumpModule(t: ModuleType, delta: number) {
    const cur = counts[t];
    const next = Math.max(0, Math.min(MAX_INSTANCES_PER_TYPE, cur + delta));
    if (next === cur) return;
    play("menuButton");
    const nextCounts = { ...counts, [t]: next };
    const nextTypes = moduleTypesFromCounts(nextCounts);
    /* Module changes auto-suggest a fitting timer so the host doesn't
       have to remember to retune it. The slider remains the final
       authority — if they adjust it afterwards, that's their answer. */
    onChange({
      timerSeconds: estimateTimerSeconds(nextTypes),
      moduleTypes: nextTypes,
    });
  }

  function commitTimer(value: number) {
    if (value === timerSeconds) return;
    onChange({ timerSeconds: value, moduleTypes });
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
          Bomb Configuration
        </span>
        {pending && (
          <span className="text-[9px] font-mono uppercase tracking-[0.25em] text-amber/80 flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" /> Updating
          </span>
        )}
      </div>

      {/* Preset row — three radio-style chassis tiles. */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {PRESET_META.map((p) => {
          const active = preset === p.preset;
          return (
            <button
              key={p.preset}
              disabled={pending}
              onClick={() => pickPreset(p.preset)}
              className={`relative px-2 py-2 border transition-all text-left disabled:opacity-60 ${
                active
                  ? "border-amber/60 bg-amber/8"
                  : "border-rib hover:border-steel-light"
              }`}
            >
              <div
                className={`font-stencil text-sm tracking-wider uppercase ${
                  active ? "text-amber-glow" : "text-bone-dim"
                }`}
              >
                {p.label}
              </div>
              <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-bone-dim/60 leading-tight">
                {p.sub}
              </div>
            </button>
          );
        })}
      </div>
      {preset === "custom" && (
        <div className="mb-3 flex items-center gap-2 border border-amber/40 bg-amber/8 px-3 py-2 text-[10px] font-mono uppercase tracking-[0.22em] text-amber/90">
          <AlertTriangle size={11} />
          <span>Custom — not counted in stats.</span>
        </div>
      )}

      {/* Advanced drawer */}
      <button
        onClick={() => {
          play("menuButton");
          setAdvancedOpen((v) => !v);
        }}
        className="w-full text-left text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim hover:text-bone transition-colors flex items-center gap-1.5"
      >
        <span>{advancedOpen ? "▾" : "▸"}</span>
        Advanced
      </button>
      {advancedOpen && (
        <div className="mt-3 space-y-4 border-t border-rib/60 pt-3">
          {/* Timer slider — module changes pre-fill an estimate; drag
              from there to fine-tune. To re-snap to the auto value,
              bump any module count and back. */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
                Timer
              </span>
              <span className="font-mono text-xs text-amber tabular-nums">
                {Math.floor(localTimer / 60)}m{" "}
                {String(localTimer % 60).padStart(2, "0")}s
              </span>
            </div>
            <input
              type="range"
              min={60}
              max={900}
              step={30}
              value={localTimer}
              disabled={pending}
              onChange={(e) => setLocalTimer(Number(e.currentTarget.value))}
              onPointerDown={() => {
                draggingRef.current = true;
              }}
              onPointerUp={() => {
                draggingRef.current = false;
                commitTimer(localTimer);
              }}
              onPointerCancel={() => {
                draggingRef.current = false;
              }}
              onKeyUp={() => commitTimer(localTimer)}
              className="bigboom-slider w-full"
              aria-label="Timer in seconds"
            />
          </div>

          {/* Module counts — +/- picker per type. Wire & button are
              core (min 1), the rest start at 0. Anything above 1 is
              a "multi-instance" bomb — each module type still gets a
              single manual page. */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
                Modules
              </span>
              <span className="text-[9px] font-mono uppercase tracking-[0.22em] text-bone-dim/55">
                count
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["wire", "button", ...ALL_OPTIONAL_MODULES] as ModuleType[]).map(
                (t) => {
                  const meta = MODULE_META[t];
                  const count = counts[t];
                  const enabled = count > 0;
                  return (
                    <div
                      key={t}
                      className={`px-2.5 py-1.5 border flex items-center justify-between gap-2 ${
                        enabled
                          ? "border-phosphor/45 bg-phosphor/8"
                          : "border-rib"
                      }`}
                    >
                      <div className="min-w-0">
                        <div
                          className={`font-stencil text-sm tracking-wide uppercase truncate ${
                            enabled ? "text-phosphor" : "text-bone-dim"
                          }`}
                        >
                          {meta.label}
                        </div>
                        <div className="text-[8px] font-mono uppercase tracking-[0.22em] text-bone-dim/55">
                          {meta.sub}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => bumpModule(t, -1)}
                          disabled={pending || count <= 0}
                          className="w-6 h-6 border border-rib bg-void/40 text-bone-dim hover:text-bone hover:border-steel-light disabled:opacity-30 flex items-center justify-center font-mono"
                          aria-label={`Decrease ${meta.label}`}
                        >
                          −
                        </button>
                        <span
                          className={`min-w-[1.5ch] text-center font-stencil text-base ${
                            enabled ? "text-phosphor" : "text-bone-dim/60"
                          }`}
                        >
                          {count}
                        </span>
                        <button
                          onClick={() => bumpModule(t, 1)}
                          disabled={pending || count >= MAX_INSTANCES_PER_TYPE}
                          className="w-6 h-6 border border-rib bg-void/40 text-bone-dim hover:text-bone hover:border-steel-light disabled:opacity-30 flex items-center justify-center font-mono"
                          aria-label={`Increase ${meta.label}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface LobbyViewProps {
  gameId: string;
  playerRole: PlayerRole;
  hasDefuser: boolean;
  hasExpert: boolean;
  bothPresent: boolean;
  copied: boolean;
  preset: Preset;
  timerSeconds: number;
  moduleTypes: ModuleType[];
  onConfigChange: (next: {
    preset?: Preset;
    timerSeconds?: number;
    moduleTypes?: ModuleType[];
  }) => void;
  configPending: boolean;
  onCopy: () => void;
  onPick: (r: PlayerRole) => void;
  onStart: () => void;
  startPending: boolean;
  startError: string | null;
  switchPending: boolean;
  onHome: () => void;
}

function LobbyView({
  gameId,
  playerRole,
  hasDefuser,
  hasExpert,
  bothPresent,
  copied,
  preset,
  timerSeconds,
  moduleTypes,
  onConfigChange,
  configPending,
  onCopy,
  onPick,
  onStart,
  startPending,
  startError,
  switchPending,
  onHome,
}: LobbyViewProps) {
  const roles = [
    {
      role: "defuser" as PlayerRole,
      label: "Defuser",
      sub: "Operates the bomb",
      Icon: Bomb,
      claimed: hasDefuser,
      accent: "text-amber-glow",
      bg: "bg-amber/10",
      border: "border-amber/50",
    },
    {
      role: "expert" as PlayerRole,
      label: "Expert",
      sub: "Reads the manual",
      Icon: BookOpen,
      claimed: hasExpert,
      accent: "text-cyan-rad",
      bg: "bg-cyan-rad/8",
      border: "border-cyan-rad/45",
    },
  ];

  return (
    <div className="min-h-screen tx-grid relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1.5 tx-stripes opacity-80" />
      <div className="absolute bottom-0 left-0 right-0 h-1.5 tx-stripes opacity-80" />

      {/* Profile + Settings — sits in the top-right corner, but as a
         small chassis-tile chip that visually belongs to the briefing
         border rather than floating over content. */}
      <div className="absolute top-4 right-4 z-30">
        <ProfileButton variant="dark" />
      </div>

      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 relative z-10">
        {/* Header */}
        <div className="text-center mb-7 reveal">
          <div className="inline-flex items-center gap-2 mb-3 text-phosphor border border-phosphor/40 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.3em]">
            <span className="w-1.5 h-1.5 rounded-full bg-phosphor pulse-dot" />
            <span>Awaiting Personnel</span>
          </div>
          <h1 className="font-stencil leading-[0.85] tracking-tight">
            <span className="text-4xl text-bone">BIG</span>
            <span className="text-4xl text-crimson">BOOM</span>
          </h1>
          <p className="text-bone-dim font-mono text-[10px] uppercase tracking-[0.3em] mt-2">
            Briefing Room
          </p>
        </div>

        {/* Card */}
        <div className="w-full max-w-lg bg-chassis/70 border border-rib backdrop-blur-sm reveal" style={{ animationDelay: "120ms" }}>
          {/* Top header strip */}
          <div className="flex items-center justify-between px-4 py-2 bg-rib/60 border-b border-rib text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
            <span>Case File · {gameId}</span>
            <span>Voice channel required</span>
          </div>

          {/* Copy link */}
          <div className="p-5 border-b border-rib/60">
            <button
              onClick={onCopy}
              className="w-full px-4 py-3 border border-amber/50 hover:border-amber bg-amber/5 hover:bg-amber/10 text-amber transition-colors flex items-center justify-between gap-3 group"
            >
              <div className="flex items-center gap-3">
                {copied ? (
                  <Check size={18} strokeWidth={2.5} className="text-phosphor" />
                ) : (
                  <Link2 size={18} strokeWidth={2.5} />
                )}
                <div className="text-left">
                  <div className="font-stencil text-base tracking-wider uppercase">
                    {copied ? "Copied" : "Copy Invite Link"}
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-widest opacity-70">
                    {copied ? "Send it to your partner" : "Share to invite a teammate"}
                  </div>
                </div>
              </div>
              <ArrowRight size={16} className="opacity-60 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>

          {/* Roles */}
          <div className="p-5 border-b border-rib/60">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim mb-3">
              Pick a Role
            </div>
            <div className="grid grid-cols-2 gap-3">
              {roles.map((r) => {
                const isMine = r.role === playerRole;
                const Icon = r.Icon;
                return (
                  <button
                    key={r.role}
                    onClick={() => onPick(r.role)}
                    disabled={isMine || switchPending}
                    className={`relative px-4 py-4 border transition-all text-left ${
                      isMine
                        ? `${r.border} ${r.bg} cursor-default`
                        : "border-rib hover:border-steel-light cursor-pointer"
                    }`}
                  >
                    <Icon
                      size={44}
                      className={isMine ? r.accent : "text-bone-dim"}
                      strokeWidth={1.75}
                    />
                    <div className={`font-stencil text-lg mt-2 tracking-wider uppercase ${isMine ? "text-bone" : "text-bone-dim"}`}>
                      {r.label}
                    </div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-bone-dim/60 mb-1.5">
                      {r.sub}
                    </div>
                    <div
                      className={`text-[9px] font-mono uppercase tracking-[0.25em] inline-flex items-center gap-1 ${
                        isMine
                          ? "text-phosphor"
                          : r.claimed
                          ? "text-amber-glow"
                          : "text-steel-light"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        isMine
                          ? "bg-phosphor pulse-dot"
                          : r.claimed
                          ? "bg-amber-glow"
                          : "bg-steel-light"
                      }`} />
                      {isMine ? "You" : r.claimed ? "Claimed" : "Open"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Config — preset selector + Advanced drawer */}
          <div className="p-5 border-b border-rib/60">
            <ConfigSection
              preset={preset}
              timerSeconds={timerSeconds}
              moduleTypes={moduleTypes}
              onChange={onConfigChange}
              pending={configPending}
            />
          </div>

          {/* Notice */}
          <div className="p-5 border-b border-rib/60 text-[11px] font-mono text-bone-dim/80 leading-relaxed">
            Talk to your partner over voice — Discord, phone, or in person. The game has no in-game chat: the Defuser describes the bomb, the Expert reads the manual aloud.
          </div>

          {/* Start */}
          <div className="p-5">
            {(() => {
              const hasModules = moduleTypes.length > 0;
              const canStart = bothPresent && hasModules && !startPending;
              return (
                <>
                  <button
                    onClick={onStart}
                    disabled={!bothPresent || !hasModules || startPending}
                    className={`w-full px-6 py-4 font-stencil text-xl uppercase tracking-[0.2em] transition-all flex items-center justify-between ${
                      canStart
                        ? "bg-crimson hover:bg-crimson-bright text-bone cursor-pointer"
                        : "bg-steel/40 text-bone-dim/50"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      {startPending ? (
                        <Loader2 size={20} className="animate-spin" />
                      ) : (
                        <Bomb size={22} strokeWidth={2.5} />
                      )}
                      <span>
                        {startPending
                          ? "Arming…"
                          : !bothPresent
                          ? "Need 1 of each role"
                          : !hasModules
                          ? "Add a module"
                          : "Arm The Bomb"}
                      </span>
                    </span>
                    {canStart && <ArrowRight size={20} strokeWidth={2.5} />}
                  </button>
                  {startError && (
                    <p className="mt-3 text-crimson font-mono text-xs uppercase tracking-[0.18em] flex items-center gap-2">
                      <AlertTriangle size={12} />
                      {startError}
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        <button
          onClick={onHome}
          className="mt-6 text-bone-dim/60 hover:text-bone-dim text-[10px] font-mono uppercase tracking-[0.25em] flex items-center gap-1.5"
        >
          <Home size={11} />
          Home
        </button>
      </div>
    </div>
  );
}

function GameOverOverlay({
  status,
  gameId,
  preset,
  onRestart,
  restartPending,
  onHome,
}: {
  status: "won" | "lost";
  gameId: string;
  preset: Preset;
  onRestart: () => void;
  restartPending: boolean;
  onHome: () => void;
}) {
  const won = status === "won";
  return (
    <div className="absolute inset-0 bg-void/90 backdrop-blur-md flex items-center justify-center z-50 reveal overflow-auto py-8">
      <div className="text-center max-w-lg px-6">
        <div className="mb-5 flex justify-center">
          {won ? (
            <ShieldCheck size={72} className="text-phosphor" strokeWidth={1.5} />
          ) : (
            <Skull size={72} className="text-crimson" strokeWidth={1.5} />
          )}
        </div>
        <div
          className={`font-stencil text-5xl sm:text-6xl tracking-tight mb-2 ${
            won ? "text-phosphor" : "text-crimson"
          }`}
        >
          {won ? "BOMB DEFUSED" : "DETONATED"}
        </div>
        <p className="text-bone-dim font-mono text-xs uppercase tracking-[0.25em] mb-6">
          {won ? "Outstanding teamwork." : "Better luck next time."}
        </p>

        <DistributionPanel gameId={gameId} preset={preset} won={won} />

        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
          <button
            onClick={onRestart}
            disabled={restartPending}
            className="px-6 py-3 bg-amber hover:bg-amber-glow disabled:bg-steel text-void font-stencil uppercase tracking-[0.2em] text-base transition-colors flex items-center justify-center gap-2"
          >
            {restartPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RotateCcw size={16} strokeWidth={2.5} />
            )}
            {restartPending ? "Arming…" : "Restart in This Room"}
          </button>
          <button
            onClick={onHome}
            className="px-6 py-3 border border-rib hover:border-steel-light text-bone-dim hover:text-bone font-mono uppercase tracking-[0.2em] text-xs transition-colors flex items-center justify-center gap-2"
          >
            <Home size={14} strokeWidth={2.5} />
            Back to Home
          </button>
        </div>

        <p className="mt-6 text-bone-dim/40 text-[10px] font-mono uppercase tracking-[0.3em]">
          Room {gameId}
        </p>
      </div>
    </div>
  );
}

/* Histogram + percentile panel shown beneath the result headline. Pulls
   the game's recorded result + the preset's win distribution. Custom
   games show a brief note and no chart; preset losses show the chart
   without a percentile callout. The TanStack Start server fns serialise
   `null` over the wire — we treat both `null` and `undefined` as
   "still loading" to avoid flashing the empty state. */
function DistributionPanel({
  gameId,
  preset,
  won,
}: {
  gameId: string;
  preset: Preset;
  won: boolean;
}) {
  const isCustom = preset === "custom";
  const { data: result } = useQuery({
    queryKey: ["gameResult", gameId],
    queryFn: () => getGameResult({ data: { gameId } }),
    refetchInterval: (q) =>
      /* The terminal status flips before the result row lands, so the
         first poll can return null; retry briefly until it shows up. */
      (q.state.data == null ? 800 : false) as number | false,
    enabled: !isCustom,
  });

  const { data: dist } = useQuery({
    queryKey: ["presetDistribution", preset, result?.durationMs ?? null],
    queryFn: () =>
      getPresetDistribution({
        data: { preset, mineDurationMs: result?.durationMs ?? null },
      }),
    enabled: !isCustom && !!result,
  });

  if (isCustom) {
    return (
      <div className="border border-amber/40 bg-amber/5 px-4 py-3 text-amber font-mono text-[11px] uppercase tracking-[0.22em] flex items-center justify-center gap-2">
        <AlertTriangle size={12} />
        Custom configuration · not counted in stats
      </div>
    );
  }

  if (!result || !dist) {
    return (
      <div className="text-bone-dim/50 font-mono text-[11px] uppercase tracking-[0.25em] flex items-center justify-center gap-2 py-2">
        <Loader2 size={11} className="animate-spin" />
        Logging result…
      </div>
    );
  }

  return (
    <div className="border border-rib bg-chassis/60 px-4 py-3 text-left">
      <div className="flex items-baseline justify-between mb-2 text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
        <span>{preset} preset</span>
        <span>
          {dist.totalWins} win{dist.totalWins === 1 ? "" : "s"} ·{" "}
          {dist.totalLosses} loss{dist.totalLosses === 1 ? "" : "es"}
        </span>
      </div>

      {/* This-run summary line. */}
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <div>
          <div className="text-[9px] font-mono uppercase tracking-[0.25em] text-bone-dim/60">
            Your time
          </div>
          <div className="font-stencil text-2xl text-bone tracking-wider">
            {result.durationMs == null
              ? "—"
              : formatDuration(result.durationMs)}
          </div>
        </div>
        {won && dist.percentile != null && dist.totalWins > 1 && (
          <div className="text-right">
            <div className="text-[9px] font-mono uppercase tracking-[0.25em] text-bone-dim/60">
              Percentile
            </div>
            <div className="font-stencil text-2xl text-phosphor tracking-wider">
              {dist.percentile}%
            </div>
          </div>
        )}
      </div>

      {/* Histogram — only meaningful with a handful of wins. */}
      {dist.totalWins > 0 && dist.bins.length > 0 ? (
        <Histogram
          bins={dist.bins}
          binSeconds={dist.binSeconds}
          mineMs={result.durationMs}
        />
      ) : (
        <div className="text-bone-dim/55 font-mono text-[10px] uppercase tracking-[0.22em] text-center py-2">
          First recorded {won ? "win" : "loss"} on this preset.
        </div>
      )}

      {dist.totalWins > 0 && (
        <div className="mt-2 flex items-baseline justify-between text-[9px] font-mono uppercase tracking-[0.22em] text-bone-dim/55">
          <span>fast {formatDuration(dist.minMs)}</span>
          <span>median {formatDuration(dist.medianMs)}</span>
          <span>slow {formatDuration(dist.maxMs)}</span>
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function Histogram({
  bins,
  binSeconds,
  mineMs,
}: {
  bins: number[];
  binSeconds: number;
  mineMs: number | null;
}) {
  const maxCount = Math.max(1, ...bins);
  const binWidthMs = binSeconds * 1000;
  const mineIdx =
    mineMs != null
      ? Math.min(bins.length - 1, Math.floor(mineMs / binWidthMs))
      : null;
  return (
    <div className="flex items-end gap-[2px] h-16 border-b border-rib/70 pb-px">
      {bins.map((count, i) => {
        const ratio = count / maxCount;
        const isMine = i === mineIdx;
        return (
          <div
            key={i}
            className="flex-1 min-w-0 relative"
            style={{ height: `${Math.max(2, ratio * 100)}%` }}
            title={`${formatDuration(i * binWidthMs)}–${formatDuration(
              (i + 1) * binWidthMs
            )}: ${count}`}
          >
            <div
              className={`absolute inset-x-0 bottom-0 ${
                isMine
                  ? "bg-phosphor shadow-[0_0_6px_#00f5a0]"
                  : "bg-steel-light/65"
              }`}
              style={{ height: "100%" }}
            />
          </div>
        );
      })}
    </div>
  );
}
