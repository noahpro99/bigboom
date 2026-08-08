import { useEffect, useState } from "react";
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
import {
  play,
  preloadAll,
  playMusic,
  stopMusic,
  setInGame,
} from "../lib/sound";
import type {
  GameState,
  ModuleType,
  PlayerRole,
  Preset,
} from "../lib/types";
import { ConfigSection } from "../components/lobby/ConfigSection";
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
  Eye,
  User as UserIcon,
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

  // Music carries through the whole experience. While the bomb is armed
  // we flip the music bus to "musicInGame" via setInGame — its slider
  // defaults lower so the soundtrack sits well under SFX/timer beeps —
  // and flip back for lobby + game-over.
  useEffect(() => {
    const status = gameState?.game.status;
    if (!status) return;
    setInGame(status === "active");
    playMusic("menuMusic");
    return () => {
      /* Make sure we don't leave the in-game bus stuck on when this
         component unmounts (navigating away from the game). */
      setInGame(false);
    };
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
      players={players}
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

      {/* Expert reads the manual; defuser and spectator both see the
         bomb — but spectator interactions are gated by the readOnly
         flag that BombView passes down to every module. */}
      {playerRole === "expert" ? (
        <ManualView seed={game.seed} moduleTypes={game.moduleTypes} />
      ) : (
        <BombView
          gameState={gameState}
          readOnly={playerRole === "spectator"}
        />
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


/* Single row of the lobby's Personnel list. Defuser/expert/spectator
   each get a distinct icon + accent; signed-in sessions show their
   username, anonymous sessions show "(guest)". The current session
   is highlighted so the user can find themselves at a glance. */
function PersonnelRow({
  player,
}: {
  player: GameState["players"][number];
}) {
  const Icon =
    player.role === "defuser"
      ? Bomb
      : player.role === "expert"
      ? BookOpen
      : Eye;
  const accent =
    player.role === "defuser"
      ? "text-amber-glow"
      : player.role === "expert"
      ? "text-cyan-rad"
      : "text-bone-dim";
  const name = player.username ?? "guest";
  return (
    <li
      className={`flex items-center gap-2 px-2 py-1 border ${
        player.isMe
          ? "border-phosphor/40 bg-phosphor/5"
          : "border-rib bg-void/30"
      }`}
    >
      <Icon size={13} strokeWidth={2.2} className={accent} />
      <span className="flex items-center gap-1 font-mono text-[12px] text-bone tracking-wide min-w-0">
        {!player.username && (
          <UserIcon size={10} className="text-bone-dim/50 shrink-0" />
        )}
        <span className="truncate">{name}</span>
        {player.isMe && (
          <span className="text-[9px] uppercase tracking-[0.25em] text-phosphor/80 ml-1">
            you
          </span>
        )}
      </span>
      <span
        className={`ml-auto text-[9px] font-mono uppercase tracking-[0.22em] ${accent}`}
      >
        {player.role}
      </span>
    </li>
  );
}

interface LobbyViewProps {
  gameId: string;
  playerRole: PlayerRole;
  players: GameState["players"];
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
  players,
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
      claimedBySomeoneElse: hasDefuser && playerRole !== "defuser",
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
      claimedBySomeoneElse: false,
      accent: "text-cyan-rad",
      bg: "bg-cyan-rad/8",
      border: "border-cyan-rad/45",
    },
    {
      role: "spectator" as PlayerRole,
      label: "Spectator",
      sub: "Watch — no controls",
      Icon: Eye,
      claimed: false,
      claimedBySomeoneElse: false,
      accent: "text-bone-dim",
      bg: "bg-bone/5",
      border: "border-steel-light/50",
    },
  ];

  return (
    <div className="min-h-screen tx-grid relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1.5 tx-stripes opacity-80" />
      <div className="absolute bottom-0 left-0 right-0 h-1.5 tx-stripes opacity-80" />

      {/* Top corners — back-to-home on the left mirrors the
         Profile/Settings chip on the right. */}
      <button
        onClick={onHome}
        aria-label="Back to home"
        title="Back to home"
        className="absolute top-4 left-4 z-30 inline-flex items-center justify-center border border-rib p-1.5 text-bone-dim hover:text-bone hover:border-bone-dim/40 hover:bg-bone/8 transition-colors"
      >
        <Home size={16} strokeWidth={2.2} />
      </button>
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

          {/* Personnel — who's currently in the room. */}
          <div className="p-5 border-b border-rib/60">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
                Personnel
              </span>
              <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-bone-dim/60">
                {players.length} in room
              </span>
            </div>
            <ul className="space-y-1">
              {players.map((p, i) => (
                <PersonnelRow key={`${i}-${p.role}`} player={p} />
              ))}
              {players.length === 0 && (
                <li className="text-bone-dim/50 font-mono text-[11px] tracking-[0.15em]">
                  Awaiting any session…
                </li>
              )}
            </ul>
          </div>

          {/* Roles */}
          <div className="p-5 border-b border-rib/60">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim mb-3">
              Pick a Role
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {roles.map((r) => {
                const isMine = r.role === playerRole;
                /* Defuser is a single-claim slot — if someone else
                   already has it, this tile is locked. The server
                   rejects the claim too, so it's belt-and-suspenders. */
                const lockedByOther = r.claimedBySomeoneElse;
                const Icon = r.Icon;
                return (
                  <button
                    key={r.role}
                    onClick={() => onPick(r.role)}
                    disabled={isMine || switchPending || lockedByOther}
                    title={
                      lockedByOther
                        ? "Defuser slot is already taken"
                        : undefined
                    }
                    className={`relative px-3 py-3 sm:px-4 sm:py-4 border transition-all text-left ${
                      isMine
                        ? `${r.border} ${r.bg} cursor-default`
                        : lockedByOther
                        ? "border-rib opacity-50 cursor-not-allowed"
                        : "border-rib hover:border-steel-light cursor-pointer"
                    }`}
                  >
                    <Icon
                      size={32}
                      className={isMine ? r.accent : "text-bone-dim"}
                      strokeWidth={1.75}
                    />
                    <div className={`font-stencil text-base mt-1.5 tracking-wider uppercase ${isMine ? "text-bone" : "text-bone-dim"}`}>
                      {r.label}
                    </div>
                    <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-bone-dim/60 mb-1.5 leading-tight">
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
            Talk to your partner over voice — Matrix, phone, or in person. The game has no in-game chat: the Defuser describes the bomb, the Expert reads the manual aloud.
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
