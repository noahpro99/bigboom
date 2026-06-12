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
} from "../server/game";
import { BombView } from "../components/bomb/BombView";
import { ManualView } from "../components/manual/ManualView";
import { MuteButton } from "../components/MuteButton";
import { SoundLayer } from "../components/SoundLayer";
import { getSessionId } from "../lib/session";
import { play, preloadAll, playMusic, stopMusic } from "../lib/sound";
import type { PlayerRole } from "../lib/types";
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
        <ManualView seed={game.seed} />
      )}

      {/* Floating mute toggle */}
      <div className="absolute top-2 right-2 z-30">
        <MuteButton variant={playerRole === "defuser" ? "dark" : "light"} />
      </div>

      {isOver && (
        <GameOverOverlay
          status={game.status}
          gameId={gameId}
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

interface LobbyViewProps {
  gameId: string;
  playerRole: PlayerRole;
  hasDefuser: boolean;
  hasExpert: boolean;
  bothPresent: boolean;
  copied: boolean;
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

      {/* Floating mute toggle */}
      <div className="absolute top-3 right-3 z-30">
        <MuteButton variant="dark" />
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

          {/* Notice */}
          <div className="p-5 border-b border-rib/60 text-[11px] font-mono text-bone-dim/80 leading-relaxed">
            Talk to your partner over voice — Discord, phone, or in person. The game has no in-game chat: the Defuser describes the bomb, the Expert reads the manual aloud.
          </div>

          {/* Start */}
          <div className="p-5">
            <button
              onClick={onStart}
              disabled={!bothPresent || startPending}
              className={`w-full px-6 py-4 font-stencil text-xl uppercase tracking-[0.2em] transition-all flex items-center justify-between ${
                bothPresent && !startPending
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
                    : bothPresent
                    ? "Arm The Bomb"
                    : "Need 1 of each role"}
                </span>
              </span>
              {bothPresent && !startPending && (
                <ArrowRight size={20} strokeWidth={2.5} />
              )}
            </button>
            {startError && (
              <p className="mt-3 text-crimson font-mono text-xs uppercase tracking-[0.18em] flex items-center gap-2">
                <AlertTriangle size={12} />
                {startError}
              </p>
            )}
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
  onRestart,
  restartPending,
  onHome,
}: {
  status: "won" | "lost";
  gameId: string;
  onRestart: () => void;
  restartPending: boolean;
  onHome: () => void;
}) {
  const won = status === "won";
  return (
    <div className="absolute inset-0 bg-void/90 backdrop-blur-md flex items-center justify-center z-50 reveal">
      <div className="text-center max-w-md px-6">
        <div className="mb-6 flex justify-center">
          {won ? (
            <ShieldCheck size={72} className="text-phosphor" strokeWidth={1.5} />
          ) : (
            <Skull size={72} className="text-crimson" strokeWidth={1.5} />
          )}
        </div>
        <div
          className={`font-stencil text-6xl tracking-tight mb-3 ${
            won ? "text-phosphor" : "text-crimson"
          }`}
        >
          {won ? "BOMB DEFUSED" : "DETONATED"}
        </div>
        <p className="text-bone-dim font-mono text-xs uppercase tracking-[0.25em] mb-8">
          {won ? "Outstanding teamwork." : "Better luck next time."}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
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
