import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  User,
  Bomb,
  X,
  LogOut,
  ShieldCheck,
  AlertTriangle,
  Volume2,
  VolumeX,
  Music2,
  Headphones,
  Timer as TimerIcon,
  Skull,
} from "lucide-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  getBusVolume,
  setBusVolume,
  isMuted,
  setMuted,
  subscribeAudio,
  play,
  type Bus,
} from "../lib/sound";
import { signup, login, logout, getCurrentUser } from "../server/auth";
import { giveUpGame, getGameState } from "../server/game";
import { getSessionId } from "../lib/session";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = "profile" | "audio" | "game";

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("profile");

  /* Are we inside an ACTIVE game? The Game tab only makes sense when a
     bomb is armed — hiding it in the lobby (status='waiting') and on the
     game-over overlay (won/lost) prevents the "give up" path from
     showing where it would either be premature or pointless. */
  const params = useParams({ strict: false }) as { gameId?: string };
  const gameId = params.gameId;
  /* Piggy-back on the polling getGameState cache used by the game page;
     SettingsModal lives on every page so we only enable the query when
     we actually have a game id. */
  const { data: gameStatus } = useQuery({
    queryKey: ["game-status-for-settings", gameId],
    queryFn: async () => {
      if (!gameId) return null;
      const state = await getGameState({ data: { gameId } });
      return state?.game.status ?? null;
    },
    enabled: !!gameId && open,
    refetchInterval: open ? 2000 : false,
    staleTime: 1500,
  });
  const inGame = !!gameId && gameStatus === "active";

  /* Close on Escape — common modal etiquette. */
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /* Block body scroll while open. */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  /* Portal to document.body so the modal isn't trapped in whatever
     stacking context its trigger button happens to live in (e.g. the
     BombView chassis header has its own z-20 context, which previously
     stopped z-50 from putting the modal above the bomb modules and
     silently swallowed clicks). SSR-safe via the typeof check. */
  if (typeof document === "undefined") return null;

  const content = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(5,10,20,0.82) 0%, rgba(5,10,20,0.97) 80%)",
        }}
        onMouseDown={onClose}
      />

      {/* Dialog — same chassis-with-stripes look as the lobby. The
         data-no-swipe attribute stops the manual's swipe handler from
         hijacking pointer drags (e.g. on a volume slider) that bubble
         back through the React tree from the portal. */}
      <div
        className="relative z-[101] w-full max-w-lg bg-chassis border border-rib shadow-2xl flex flex-col reveal"
        style={{
          maxHeight: "calc(100vh - 4rem)",
          backgroundColor: "var(--color-chassis)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
        data-no-swipe="true"
      >
        <div className="absolute top-0 left-0 right-0 h-1 tx-stripes opacity-80" />
        <div className="absolute bottom-0 left-0 right-0 h-1 tx-stripes opacity-80" />

        {/* Header */}
        <header className="flex items-center justify-between border-b border-rib px-4 sm:px-5 py-3 pt-4 font-mono uppercase tracking-[0.25em] text-[10px] text-bone-dim">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-phosphor pulse-dot" />
            <span>Operator Console</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="p-1.5 -mr-1.5 text-bone-dim hover:text-bone hover:bg-bone/8 border border-transparent hover:border-rib transition-colors"
          >
            <X size={16} strokeWidth={2.4} />
          </button>
        </header>

        {/* Tab strip */}
        <div className="flex border-b border-rib">
          <TabButton
            active={tab === "profile"}
            onClick={() => {
              play("menuButton");
              setTab("profile");
            }}
            Icon={User}
            label="Profile"
          />
          <TabButton
            active={tab === "audio"}
            onClick={() => {
              play("menuButton");
              setTab("audio");
            }}
            Icon={Volume2}
            label="Audio"
          />
          {inGame && (
            <TabButton
              active={tab === "game"}
              onClick={() => {
                play("menuButton");
                setTab("game");
              }}
              Icon={Bomb}
              label="Game"
            />
          )}
        </div>

        {/* Body — locked to the tallest tab's height so the dialog
            doesn't jump (and the tab strip doesn't shift up/down) when
            switching tabs. Overflows scroll internally. */}
        <div
          className="overflow-auto scrollbar-dark px-4 sm:px-6 py-5"
          style={{ height: "min(520px, calc(100vh - 12rem))" }}
        >
          {tab === "profile" && <ProfileTab />}
          {tab === "audio" && <AudioTab />}
          {tab === "game" && inGame && (
            <GameTab gameId={params.gameId!} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

/* ---------- Game tab ---------- */

function GameTab({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const giveUpMut = useMutation({
    mutationFn: giveUpGame,
    onSuccess: () => {
      onClose();
      /* The game route polls and will pick up the 'lost' status on the
         next refetch, dropping the GameOverOverlay in. No need to
         navigate away — let the overlay handle next steps. */
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="border border-rib bg-void/40 p-4">
        <div className="flex items-center gap-2 text-bone mb-1">
          <Skull size={16} strokeWidth={2.2} className="text-crimson" />
          <span className="font-stencil tracking-[0.18em] text-base">
            ABANDON DEFUSAL
          </span>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-bone-dim/80 leading-relaxed mb-3">
          Detonate the bomb and end the round for everyone in the room.
          This cannot be undone, but you can re-arm a fresh bomb from the
          game-over screen.
        </p>

        {!confirming ? (
          <button
            onClick={() => {
              play("menuButton");
              setConfirming(true);
            }}
            className="w-full border border-crimson/60 text-crimson hover:bg-crimson/10 transition-colors py-2.5 font-stencil tracking-[0.25em] text-sm uppercase"
          >
            Give Up
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => {
                play("menuButton");
                setConfirming(false);
              }}
              disabled={giveUpMut.isPending}
              className="flex-1 border border-rib text-bone-dim hover:text-bone transition-colors py-2 font-mono text-[11px] uppercase tracking-[0.22em]"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                play("explosion");
                giveUpMut.mutate({ data: { gameId } });
              }}
              disabled={giveUpMut.isPending}
              className="flex-1 bg-crimson text-bone hover:bg-crimson-bright transition-colors py-2 font-stencil text-sm tracking-[0.22em] uppercase disabled:opacity-60"
            >
              {giveUpMut.isPending ? "Detonating…" : "Confirm"}
            </button>
          </div>
        )}
      </div>

      <button
        onClick={() => {
          play("menuButton");
          onClose();
          navigate({ to: "/" });
        }}
        className="border border-rib text-bone-dim hover:text-bone hover:bg-bone/5 transition-colors py-2 font-mono text-[11px] uppercase tracking-[0.22em]"
      >
        Leave room · back to lobby
      </button>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 font-mono uppercase tracking-[0.25em] text-[11px] transition-colors relative ${
        active
          ? "text-amber bg-amber/5"
          : "text-bone-dim hover:text-bone hover:bg-bone/5"
      }`}
    >
      <Icon size={13} strokeWidth={2.4} />
      <span>{label}</span>
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-amber" />
      )}
    </button>
  );
}

/* ---------- Audio tab ---------- */

function AudioTab() {
  /* Subscribe to the audio store so slider positions stay in sync if a
     change happens elsewhere (e.g. mute toggled). */
  const tick = useSyncExternalStore(
    subscribeAudio,
    () =>
      `${isMuted()}|${getBusVolume("music")}|${getBusVolume(
        "musicInGame"
      )}|${getBusVolume("sfx")}|${getBusVolume("timer")}`,
    () => "ssr"
  );
  /* tick is only here to force re-render on changes; we read fresh values
     below so we don't need to parse it. */
  void tick;

  const muted = isMuted();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 border border-rib bg-void/40 px-3 py-2.5">
        <div className="flex items-center gap-2.5 text-bone">
          {muted ? (
            <VolumeX size={16} strokeWidth={2.2} className="text-crimson" />
          ) : (
            <Volume2 size={16} strokeWidth={2.2} className="text-phosphor" />
          )}
          <div>
            <div className="font-stencil tracking-[0.18em] text-sm">
              {muted ? "MUTED" : "AUDIO ACTIVE"}
            </div>
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim/70">
              Master switch
            </div>
          </div>
        </div>
        <button
          onClick={() => {
            const next = !muted;
            setMuted(next);
            if (!next) play("menuButton");
          }}
          className={`font-mono uppercase tracking-[0.25em] text-[10px] px-3 py-1.5 border transition-colors ${
            muted
              ? "border-phosphor/60 text-phosphor hover:bg-phosphor/10"
              : "border-rib text-bone-dim hover:text-bone hover:bg-bone/5"
          }`}
        >
          {muted ? "Unmute" : "Mute"}
        </button>
      </div>

      <VolumeSlider
        bus="music"
        Icon={Music2}
        label="Music"
        sub="Menu and lobby"
        previewSound={null}
      />
      <VolumeSlider
        bus="musicInGame"
        Icon={Music2}
        label="Music in Game"
        sub="During active defusal"
        previewSound={null}
      />
      <VolumeSlider
        bus="sfx"
        Icon={Headphones}
        label="Sound Effects"
        sub="Wires, buttons, presses"
        previewSound="symbolPress"
      />
      <VolumeSlider
        bus="timer"
        Icon={TimerIcon}
        label="Timer Beeps"
        sub="Countdown ticks"
        previewSound="timerTick"
      />
    </div>
  );
}

function VolumeSlider({
  bus,
  Icon,
  label,
  sub,
  previewSound,
}: {
  bus: Bus;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  sub: string;
  previewSound:
    | "menuButton"
    | "symbolPress"
    | "timerTick"
    | "wireSnip"
    | null;
}) {
  const value = getBusVolume(bus);
  const pct = Math.round(value * 100);
  /* Throttle preview-on-drag so the slider doesn't fire dozens of clicks. */
  const lastPreviewRef = useRef(0);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="flex items-center gap-2 text-bone">
          <Icon size={14} strokeWidth={2.2} className="text-bone-dim" />
          <span className="font-stencil tracking-[0.18em] text-sm">
            {label.toUpperCase()}
          </span>
          <span className="text-[9px] font-mono uppercase tracking-[0.25em] text-bone-dim/60">
            {sub}
          </span>
        </div>
        <span className="font-mono text-xs text-amber tabular-nums">
          {pct}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => {
          const v = Number(e.currentTarget.value) / 100;
          setBusVolume(bus, v);
          if (previewSound) {
            const now = performance.now();
            if (now - lastPreviewRef.current > 220) {
              lastPreviewRef.current = now;
              play(previewSound);
            }
          }
        }}
        className="bigboom-slider w-full"
        aria-label={label}
      />
    </div>
  );
}

/* ---------- Profile tab ---------- */

function ProfileTab() {
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState("");
  useEffect(() => setSessionId(getSessionId()), []);

  const { data: user } = useQuery({
    queryKey: ["currentUser", sessionId],
    queryFn: () => getCurrentUser({ data: { sessionId } }),
    enabled: !!sessionId,
  });

  const logoutMut = useMutation({
    mutationFn: logout,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["currentUser"] }),
  });

  if (!sessionId) {
    return (
      <div className="text-center text-bone-dim font-mono text-xs uppercase tracking-[0.25em] py-6">
        Loading…
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex flex-col gap-4">
        <div className="border border-rib bg-void/40 p-4 flex items-center gap-3">
          <div className="w-12 h-12 border border-amber/50 bg-amber/10 flex items-center justify-center">
            <ShieldCheck size={20} className="text-amber" strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-bone-dim">
              Signed in as
            </div>
            <div className="font-stencil text-xl tracking-wide text-bone truncate">
              {user.username}
            </div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-bone-dim/60">
              Member since {new Date(user.createdAt * 1000).toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* Stats placeholder — wire this up when stats land. */}
        <div className="border border-rib/60 bg-void/30 p-3">
          <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-bone-dim mb-1">
            Career stats
          </div>
          <p className="font-mono text-[11px] text-bone-dim/70 leading-relaxed">
            Run stats will appear here once tracking is enabled. Bombs
            armed, defusals, strikes, fastest solve — all tied to this
            account.
          </p>
        </div>

        <button
          onClick={() => {
            play("menuButton");
            logoutMut.mutate({ data: { sessionId } });
          }}
          disabled={logoutMut.isPending}
          className="flex items-center justify-center gap-2 border border-rib hover:border-crimson/60 hover:bg-crimson/8 text-bone-dim hover:text-crimson transition-colors py-2.5 font-mono text-xs uppercase tracking-[0.25em] disabled:opacity-50"
        >
          <LogOut size={13} strokeWidth={2.4} />
          Sign out
        </button>
      </div>
    );
  }

  return <SignedOutForm sessionId={sessionId} />;
}

function SignedOutForm({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const signupMut = useMutation({
    mutationFn: signup,
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ["currentUser"] });
        setError("");
      } else {
        setError(res.error);
      }
    },
  });
  const loginMut = useMutation({
    mutationFn: login,
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ["currentUser"] });
        setError("");
      } else {
        setError(res.error);
      }
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    play("menuButton");
    if (mode === "login") {
      loginMut.mutate({ data: { sessionId, username, password } });
    } else {
      signupMut.mutate({ data: { sessionId, username, password } });
    }
  }

  const pending = loginMut.isPending || signupMut.isPending;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="text-[11px] font-mono uppercase tracking-[0.25em] text-bone-dim leading-relaxed">
        {mode === "login"
          ? "Sign in to keep your stats across devices."
          : "Create an account to save your stats and progress."}
      </div>

      <label className="block">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-bone-dim mb-1">
          Username
        </div>
        <input
          type="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.currentTarget.value)}
          className="w-full bg-void/60 border border-rib focus:border-amber/60 px-3 py-2 text-bone font-mono text-sm placeholder:text-steel-light focus:outline-none transition-colors"
          placeholder="callsign"
        />
      </label>

      <label className="block">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-bone-dim mb-1">
          Password
        </div>
        <input
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          className="w-full bg-void/60 border border-rib focus:border-amber/60 px-3 py-2 text-bone font-mono text-sm placeholder:text-steel-light focus:outline-none transition-colors"
          placeholder="••••••"
        />
      </label>

      {error && (
        <div className="flex items-center gap-2 border border-crimson/40 bg-crimson/8 px-3 py-2 text-crimson font-mono text-[11px]">
          <AlertTriangle size={12} strokeWidth={2.2} />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending || !username || !password}
        className="bg-amber text-void hover:bg-amber-glow disabled:bg-steel disabled:text-bone-dim transition-colors font-stencil text-base tracking-[0.18em] uppercase py-2.5 px-4"
      >
        {pending
          ? mode === "login"
            ? "Verifying…"
            : "Enlisting…"
          : mode === "login"
          ? "Sign In"
          : "Enlist"}
      </button>

      <button
        type="button"
        onClick={() => {
          play("menuButton");
          setError("");
          setMode(mode === "login" ? "signup" : "login");
        }}
        className="text-[11px] font-mono uppercase tracking-[0.25em] text-bone-dim hover:text-bone transition-colors text-center"
      >
        {mode === "login"
          ? "No account yet? Enlist now."
          : "Already enlisted? Sign in."}
      </button>
    </form>
  );
}
