import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BombView, type BombActions } from "../components/bomb/BombView";
import { ManualView } from "../components/manual/ManualView";
import { SoundLayer } from "../components/SoundLayer";
import { ProfileButton } from "../components/ProfileButton";
import { ConfigSection } from "../components/lobby/ConfigSection";
import { QrCode } from "../components/offline/QrCode";
import { QrScanner } from "../components/offline/QrScanner";
import { play, preloadAll, playMusic, setInGame } from "../lib/sound";
import { useDisplayTime } from "../lib/useDisplayTime";
import {
  createOfflineGame,
  applyCutWire,
  applyTapButton,
  applyStartHold,
  applyReleaseHold,
  applyPressSymbol,
  applyPressSimon,
  applyMoveMaze,
  applyPressMemory,
  applyDialMorse,
  applyTransmitMorse,
  applyCyclePassword,
  applySubmitPassword,
  applyCutCompWire,
  applyPressWhoFirst,
  applyCutWireSeq,
  applyTimeout,
} from "../lib/offlineEngine";
import {
  type OfflineMatch,
  decodeMatch,
  encodeMatch,
  inviteUrl,
  matchFromConfig,
  normalizeMatch,
  randomSeed,
} from "../lib/offlineCode";
import { PRESET_CONFIGS, type GameState, type ModuleType, type PlayerRole, type Preset } from "../lib/types";
import {
  Bomb,
  BookOpen,
  WifiOff,
  Home,
  ArrowRight,
  ArrowLeft,
  Camera,
  Check,
  Copy,
  AlertTriangle,
  ScanLine,
  RotateCcw,
  ShieldCheck,
  Skull,
  Dice5,
  LogOut,
} from "lucide-react";

export const Route = createFileRoute("/offline")({
  validateSearch: (search: Record<string, unknown>): { join?: string } => ({
    join: typeof search.join === "string" ? search.join : undefined,
  }),
  component: OfflinePage,
});

const STORAGE_KEY = "bigboom-offline";

interface SavedGame {
  gameState: GameState;
  match: OfflineMatch;
  role: PlayerRole;
}

function loadSaved(): SavedGame | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedGame;
    if (!parsed?.gameState?.game) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveGame(s: SavedGame | null) {
  if (typeof window === "undefined") return;
  try {
    if (s) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / quota — non-fatal, play just won't resume */
  }
}

type Phase = "home" | "create" | "join" | "play";

function OfflinePage() {
  const navigate = useNavigate();
  const { join } = Route.useSearch();

  const [phase, setPhase] = useState<Phase>("home");
  const [match, setMatch] = useState<OfflineMatch | null>(null);
  const [role, setRole] = useState<PlayerRole>("defuser");
  const [game, setGame] = useState<GameState | null>(null);

  // Audio unlock + ambient menu music (mirrors the home page).
  useEffect(() => {
    const once = () => {
      preloadAll();
      playMusic("menuMusic");
      window.removeEventListener("pointerdown", once);
    };
    window.addEventListener("pointerdown", once);
    return () => window.removeEventListener("pointerdown", once);
  }, []);

  // On first mount: resume an in-progress game, or honour a ?join= deep link.
  useEffect(() => {
    const saved = loadSaved();
    if (saved && saved.gameState.game.status === "active") {
      setMatch(saved.match);
      setRole(saved.role);
      setGame(saved.gameState);
      setPhase("play");
      return;
    }
    if (join) {
      const decoded = decodeMatch(join);
      if (decoded) {
        setMatch(decoded);
        setRole("expert");
        setPhase("join");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Music bus follows whether a bomb is armed.
  useEffect(() => {
    setInGame(phase === "play" && game?.game.status === "active");
    return () => setInGame(false);
  }, [phase, game?.game.status]);

  function startMatch(m: OfflineMatch, r: PlayerRole) {
    const fresh = createOfflineGame(m, r);
    setMatch(m);
    setRole(r);
    setGame(fresh);
    setPhase("play");
    saveGame({ gameState: fresh, match: m, role: r });
    play("menuButton");
  }

  const updateGame = useCallback(
    (next: GameState) => {
      setGame(next);
      if (match) saveGame({ gameState: next, match, role });
    },
    [match, role]
  );

  function exitToHome() {
    saveGame(null);
    setGame(null);
    setPhase("home");
  }

  if (phase === "play" && game && match) {
    return (
      <OfflinePlay
        gameState={game}
        role={role}
        setGameState={updateGame}
        onReplay={() => startMatch({ ...match, seed: match.seed }, role)}
        onNewMatch={() => {
          saveGame(null);
          setGame(null);
          setPhase("create");
        }}
        onExit={exitToHome}
      />
    );
  }

  return (
    <div className="min-h-screen tx-grid relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1.5 tx-stripes opacity-80" />
      <div className="absolute bottom-0 left-0 right-0 h-1.5 tx-stripes opacity-80" />

      <button
        onClick={() => navigate({ to: "/" })}
        aria-label="Back to home"
        className="absolute top-4 left-4 z-30 inline-flex items-center justify-center border border-rib p-1.5 text-bone-dim hover:text-bone hover:border-bone-dim/40 hover:bg-bone/8 transition-colors"
      >
        <Home size={16} strokeWidth={2.2} />
      </button>
      <div className="absolute top-4 right-4 z-30">
        <ProfileButton variant="dark" />
      </div>

      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 relative z-10">
        <div className="text-center mb-7 reveal">
          <div className="inline-flex items-center gap-2 mb-3 text-phosphor border border-phosphor/40 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.3em]">
            <WifiOff size={12} />
            <span>Offline Field Mode</span>
          </div>
          <h1 className="font-stencil leading-[0.85] tracking-tight">
            <span className="text-4xl text-bone">BIG</span>
            <span className="text-4xl text-crimson">BOOM</span>
          </h1>
          <p className="text-bone-dim font-mono text-[10px] uppercase tracking-[0.3em] mt-2 max-w-xs mx-auto leading-relaxed">
            No server. No internet. Share a seed, sit together, defuse.
          </p>
        </div>

        {phase === "home" && (
          <OfflineHome
            onCreate={() => {
              play("menuButton");
              setPhase("create");
            }}
            onJoin={() => {
              play("menuButton");
              setPhase("join");
            }}
          />
        )}

        {phase === "create" && (
          <OfflineCreate
            initialMatch={match}
            onBack={() => setPhase("home")}
            onStart={startMatch}
          />
        )}

        {phase === "join" && (
          <OfflineJoin
            initialMatch={match}
            onBack={() => setPhase("home")}
            onStart={startMatch}
          />
        )}
      </div>
    </div>
  );
}

/* ── Home: pick host or join ─────────────────────────────────────────── */
function OfflineHome({
  onCreate,
  onJoin,
}: {
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <div className="w-full max-w-md flex flex-col gap-3 reveal" style={{ animationDelay: "120ms" }}>
      <button
        onClick={onCreate}
        className="group relative overflow-hidden bg-amber text-void hover:bg-amber-glow transition-colors font-stencil text-2xl tracking-wider uppercase px-6 py-5 flex items-center justify-between"
      >
        <span className="flex items-center gap-3">
          <Bomb size={28} strokeWidth={2.5} />
          <span>Host a Match</span>
        </span>
        <ArrowRight size={22} strokeWidth={2.5} className="transition-transform group-hover:translate-x-1" />
        <div className="absolute bottom-0 left-0 right-0 h-1 tx-stripes" />
      </button>

      <button
        onClick={onJoin}
        className="group relative border border-cyan-rad/50 hover:border-cyan-rad bg-cyan-rad/8 hover:bg-cyan-rad/14 text-cyan-rad transition-colors font-stencil text-2xl tracking-wider uppercase px-6 py-5 flex items-center justify-between"
      >
        <span className="flex items-center gap-3">
          <ScanLine size={26} strokeWidth={2.5} />
          <span>Join a Match</span>
        </span>
        <ArrowRight size={22} strokeWidth={2.5} className="transition-transform group-hover:translate-x-1" />
      </button>

      <div className="mt-4 border border-rib bg-chassis/60 backdrop-blur-sm p-4 text-[11px] font-mono text-bone-dim/80 leading-relaxed">
        One of you hosts and shows a QR code. The other joins by scanning it
        — or typing the short code. You'll each pick a role: one
        <span className="text-amber"> Defuser</span> (operates the bomb), one
        <span className="text-cyan-rad"> Expert</span> (reads the manual).
        Then talk it out, in person.
      </div>
    </div>
  );
}

const ROLE_PICKER: Array<{
  role: PlayerRole;
  label: string;
  sub: string;
  Icon: typeof Bomb;
  accent: string;
  border: string;
  bg: string;
}> = [
  {
    role: "defuser",
    label: "Defuser",
    sub: "Hold the bomb",
    Icon: Bomb,
    accent: "text-amber-glow",
    border: "border-amber/50",
    bg: "bg-amber/10",
  },
  {
    role: "expert",
    label: "Expert",
    sub: "Read the manual",
    Icon: BookOpen,
    accent: "text-cyan-rad",
    border: "border-cyan-rad/45",
    bg: "bg-cyan-rad/8",
  },
];

function RolePicker({
  role,
  onPick,
  hint,
}: {
  role: PlayerRole;
  onPick: (r: PlayerRole) => void;
  hint: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim mb-2">
        Your role on this device
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {ROLE_PICKER.map((r) => {
          const mine = r.role === role;
          const Icon = r.Icon;
          return (
            <button
              key={r.role}
              onClick={() => {
                play("menuButton");
                onPick(r.role);
              }}
              className={`relative px-3 py-3 border transition-all text-left ${
                mine ? `${r.border} ${r.bg}` : "border-rib hover:border-steel-light"
              }`}
            >
              <Icon size={28} className={mine ? r.accent : "text-bone-dim"} strokeWidth={1.75} />
              <div className={`font-stencil text-base mt-1.5 tracking-wider uppercase ${mine ? "text-bone" : "text-bone-dim"}`}>
                {r.label}
              </div>
              <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-bone-dim/60 leading-tight">
                {r.sub}
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.18em] text-bone-dim/55">
        {hint}
      </p>
    </div>
  );
}

/* ── Create: config + seed + share QR + role + start ─────────────────── */
function OfflineCreate({
  initialMatch,
  onBack,
  onStart,
}: {
  initialMatch: OfflineMatch | null;
  onBack: () => void;
  onStart: (m: OfflineMatch, r: PlayerRole) => void;
}) {
  const [seed, setSeed] = useState<number>(() => initialMatch?.seed ?? randomSeed());
  const base = PRESET_CONFIGS.standard;
  const [preset, setPreset] = useState<Preset>(initialMatch?.preset ?? base.preset);
  const [timerSeconds, setTimerSeconds] = useState<number>(
    initialMatch?.timerSeconds ?? base.timerSeconds
  );
  const [moduleTypes, setModuleTypes] = useState<ModuleType[]>(
    initialMatch?.moduleTypes ?? [...base.moduleTypes]
  );
  const [role, setRole] = useState<PlayerRole>("defuser");
  const [copied, setCopied] = useState(false);

  const match = useMemo(
    () => normalizeMatch({ seed, timerSeconds, moduleTypes }),
    [seed, timerSeconds, moduleTypes]
  );
  const code = encodeMatch(match);
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://bigboom.app";
  const url = inviteUrl(origin, match);

  function onConfigChange(next: {
    preset?: Preset;
    timerSeconds?: number;
    moduleTypes?: ModuleType[];
  }) {
    if (next.preset && next.preset !== "custom") {
      const cfg = PRESET_CONFIGS[next.preset];
      setPreset(cfg.preset);
      setTimerSeconds(cfg.timerSeconds);
      setModuleTypes([...cfg.moduleTypes]);
      return;
    }
    const nextTypes = next.moduleTypes ?? moduleTypes;
    const nextTimer = next.timerSeconds ?? timerSeconds;
    const m = matchFromConfig(seed, {
      preset: "custom",
      timerSeconds: nextTimer,
      moduleTypes: nextTypes,
    });
    setPreset(m.preset);
    setTimerSeconds(m.timerSeconds);
    setModuleTypes(m.moduleTypes);
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      play("menuButton");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the code is on screen to read aloud */
    }
  }

  return (
    <div className="w-full max-w-lg bg-chassis/70 border border-rib backdrop-blur-sm reveal">
      <div className="flex items-center justify-between px-4 py-2 bg-rib/60 border-b border-rib text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
        <button onClick={onBack} className="flex items-center gap-1 hover:text-bone">
          <ArrowLeft size={12} /> Back
        </button>
        <span>Host · Build the bomb</span>
      </div>

      {/* Share panel — QR + code. This is what the partner scans/types. */}
      <div className="p-5 border-b border-rib/60 flex flex-col items-center gap-3">
        <QrCode value={url} size={200} />
        <div className="w-full flex items-stretch gap-2">
          <code className="flex-1 min-w-0 truncate bg-void/60 border border-rib px-3 py-2 font-mono text-sm text-phosphor tracking-wide">
            {code}
          </code>
          <button
            onClick={copyCode}
            className="px-3 border border-amber/50 hover:border-amber bg-amber/5 hover:bg-amber/10 text-amber transition-colors flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.2em]"
          >
            {copied ? <Check size={14} className="text-phosphor" /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-bone-dim/55 text-center">
          Partner scans this in Join, or types the code. Same code = same bomb.
        </p>
      </div>

      {/* Seed */}
      <div className="p-5 border-b border-rib/60">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
            Seed
          </span>
          <button
            onClick={() => {
              play("menuButton");
              setSeed(randomSeed());
            }}
            className="text-[10px] font-mono uppercase tracking-[0.2em] text-phosphor hover:text-phosphor/80 flex items-center gap-1"
          >
            <Dice5 size={13} /> Randomize
          </button>
        </div>
        <input
          inputMode="numeric"
          value={seed}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
            setSeed(Number.isFinite(n) ? n >>> 0 : 0);
          }}
          className="w-full bg-void/60 border border-rib focus:border-amber/60 px-3 py-2.5 text-bone font-mono text-sm focus:outline-none transition-colors"
          aria-label="Seed"
        />
      </div>

      {/* Config */}
      <div className="p-5 border-b border-rib/60">
        <ConfigSection
          preset={preset}
          timerSeconds={timerSeconds}
          moduleTypes={moduleTypes}
          onChange={onConfigChange}
          pending={false}
        />
      </div>

      {/* Role */}
      <div className="p-5 border-b border-rib/60">
        <RolePicker
          role={role}
          onPick={setRole}
          hint="Pick whichever you want — your partner takes the other on their device."
        />
      </div>

      {/* Start */}
      <div className="p-5">
        <button
          onClick={() => onStart(match, role)}
          disabled={moduleTypes.length === 0}
          className={`w-full px-6 py-4 font-stencil text-xl uppercase tracking-[0.2em] transition-all flex items-center justify-between ${
            moduleTypes.length === 0
              ? "bg-steel/40 text-bone-dim/50"
              : "bg-crimson hover:bg-crimson-bright text-bone"
          }`}
        >
          <span className="flex items-center gap-3">
            <Bomb size={22} strokeWidth={2.5} />
            {moduleTypes.length === 0 ? "Add a module" : "Arm & Play"}
          </span>
          {moduleTypes.length > 0 && <ArrowRight size={20} strokeWidth={2.5} />}
        </button>
        <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.18em] text-bone-dim/55 text-center">
          Solo-friendly — no need to wait for the other role.
        </p>
      </div>
    </div>
  );
}

/* ── Join: scan or type a code, then pick role + start ───────────────── */
function OfflineJoin({
  initialMatch,
  onBack,
  onStart,
}: {
  initialMatch: OfflineMatch | null;
  onBack: () => void;
  onStart: (m: OfflineMatch, r: PlayerRole) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [text, setText] = useState(initialMatch ? encodeMatch(initialMatch) : "");
  const [match, setMatch] = useState<OfflineMatch | null>(initialMatch);
  const [error, setError] = useState("");
  const [role, setRole] = useState<PlayerRole>("expert");

  function tryDecode(raw: string) {
    const decoded = decodeMatch(raw);
    if (!decoded) {
      setError("That doesn't look like a match code.");
      setMatch(null);
      return;
    }
    setError("");
    setMatch(decoded);
    play("menuButton");
  }

  return (
    <div className="w-full max-w-lg bg-chassis/70 border border-rib backdrop-blur-sm reveal">
      <div className="flex items-center justify-between px-4 py-2 bg-rib/60 border-b border-rib text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
        <button onClick={onBack} className="flex items-center gap-1 hover:text-bone">
          <ArrowLeft size={12} /> Back
        </button>
        <span>Join · Scan your partner's code</span>
      </div>

      <div className="p-5 border-b border-rib/60 flex flex-col gap-3">
        {scanning ? (
          <QrScanner
            onClose={() => setScanning(false)}
            onResult={(value) => {
              setScanning(false);
              setText(value);
              tryDecode(value);
            }}
          />
        ) : (
          <button
            onClick={() => {
              play("menuButton");
              setScanning(true);
            }}
            className="w-full px-4 py-4 border border-cyan-rad/50 hover:border-cyan-rad bg-cyan-rad/8 hover:bg-cyan-rad/14 text-cyan-rad transition-colors font-stencil text-lg uppercase tracking-[0.2em] flex items-center justify-center gap-3"
          >
            <Camera size={22} strokeWidth={2.5} /> Scan QR Code
          </button>
        )}

        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim/50">
          <div className="h-px flex-1 bg-rib" /> or type it <div className="h-px flex-1 bg-rib" />
        </div>

        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError("");
          }}
          onBlur={() => text.trim() && tryDecode(text)}
          onKeyDown={(e) => {
            if (e.key === "Enter") tryDecode(text);
          }}
          placeholder="bb1.xxxx.xx.00000000000"
          className="w-full bg-void/60 border border-rib focus:border-cyan-rad/60 px-3 py-2.5 text-bone font-mono text-sm placeholder:text-steel-light focus:outline-none transition-colors"
          aria-label="Match code"
        />
        {error && (
          <p className="text-crimson text-xs font-mono flex items-center gap-1.5">
            <AlertTriangle size={11} /> {error}
          </p>
        )}
      </div>

      {match && (
        <>
          <div className="px-5 py-3 border-b border-rib/60 flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.18em]">
            <span className="text-phosphor flex items-center gap-1.5">
              <Check size={13} /> Match found
            </span>
            <span className="text-bone-dim">
              {match.preset} · {Math.floor(match.timerSeconds / 60)}m ·{" "}
              {match.moduleTypes.length} mod
            </span>
          </div>
          <div className="p-5 border-b border-rib/60">
            <RolePicker
              role={role}
              onPick={setRole}
              hint="Take whichever role your partner didn't."
            />
          </div>
          <div className="p-5">
            <button
              onClick={() => onStart(match, role)}
              className="w-full px-6 py-4 bg-crimson hover:bg-crimson-bright text-bone font-stencil text-xl uppercase tracking-[0.2em] transition-all flex items-center justify-between"
            >
              <span className="flex items-center gap-3">
                <Bomb size={22} strokeWidth={2.5} /> Join & Play
              </span>
              <ArrowRight size={20} strokeWidth={2.5} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Play: local engine drives BombView (defuser) / ManualView (expert) ─ */
function OfflinePlay({
  gameState,
  role,
  setGameState,
  onReplay,
  onNewMatch,
  onExit,
}: {
  gameState: GameState;
  role: PlayerRole;
  setGameState: (s: GameState) => void;
  onReplay: () => void;
  onNewMatch: () => void;
  onExit: () => void;
}) {
  const { game } = gameState;

  // Keep the latest state in a ref so the stable dispatch never goes stale.
  const stateRef = useRef(gameState);
  useEffect(() => {
    stateRef.current = gameState;
  }, [gameState]);

  const dispatch = useCallback(
    (fn: (s: GameState) => { state: GameState; result: { correct?: boolean } }) => {
      const { state, result } = fn(stateRef.current);
      if (result.correct === false) play("wrongBuzzer");
      setGameState(state);
    },
    [setGameState]
  );

  const actions: BombActions = useMemo(
    () => ({
      onCut: (id, slot) => dispatch((s) => applyCutWire(s, id, slot)),
      onTap: (id) => dispatch((s) => applyTapButton(s, id)),
      onHoldStart: (id) => dispatch((s) => applyStartHold(s, id)),
      onHoldRelease: (id, releasedAt) =>
        dispatch((s) => applyReleaseHold(s, id, releasedAt)),
      onPressSymbol: (id, symbolId) => dispatch((s) => applyPressSymbol(s, id, symbolId)),
      onPressSimon: (id, color) => dispatch((s) => applyPressSimon(s, id, color)),
      onMoveMaze: (id, direction) => dispatch((s) => applyMoveMaze(s, id, direction)),
      onPressMemory: (id, position) => dispatch((s) => applyPressMemory(s, id, position)),
      onDialMorse: (id, freqIndex) => dispatch((s) => applyDialMorse(s, id, freqIndex)),
      onTransmitMorse: (id) => dispatch((s) => applyTransmitMorse(s, id)),
      onCyclePassword: (id, col, delta) =>
        dispatch((s) => applyCyclePassword(s, id, col, delta)),
      onSubmitPassword: (id) => dispatch((s) => applySubmitPassword(s, id)),
      onCutCompWire: (id, slot) => dispatch((s) => applyCutCompWire(s, id, slot)),
      onPressWhoFirst: (id, word) => dispatch((s) => applyPressWhoFirst(s, id, word)),
      onCutWireSeq: (id, slot) => dispatch((s) => applyCutWireSeq(s, id, slot)),
    }),
    [dispatch]
  );

  // Local timer — flip to "lost" when it runs out. There's no server, so
  // each device enforces its own clock against the shared startedAt.
  useEffect(() => {
    if (game.status !== "active") return;
    const id = setInterval(() => {
      const s = stateRef.current;
      if (s.game.status !== "active" || s.game.startedAt == null) return;
      const elapsed = Math.floor(Date.now() / 1000) - s.game.startedAt;
      if (elapsed >= s.game.timerSeconds) setGameState(applyTimeout(s));
    }, 500);
    return () => clearInterval(id);
  }, [game.status, setGameState]);

  const isOver = game.status === "won" || game.status === "lost";

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      <SoundLayer gameState={gameState} />

      {role === "expert" ? (
        <>
          <ManualView seed={game.seed} moduleTypes={game.moduleTypes} />
          <ExpertHud
            gameState={gameState}
            onExit={onExit}
            onMarkDefused={() => {
              const s = stateRef.current;
              if (s.game.status !== "active") return;
              play("menuButton");
              setGameState({ ...s, game: { ...s.game, status: "won" } });
            }}
          />
        </>
      ) : (
        <BombView gameState={gameState} actions={actions} readOnly={role === "spectator"} />
      )}

      {isOver && (
        <OfflineGameOver
          status={game.status as "won" | "lost"}
          role={role}
          onReplay={onReplay}
          onNewMatch={onNewMatch}
          onExit={onExit}
        />
      )}
    </div>
  );
}

/* Floating timer + leave control overlaid on the Expert's manual so they
   feel the clock without a full bomb chassis. */
function ExpertHud({
  gameState,
  onExit,
  onMarkDefused,
}: {
  gameState: GameState;
  onExit: () => void;
  onMarkDefused: () => void;
}) {
  const { game } = gameState;
  const t = useDisplayTime(
    game.startedAt,
    game.timerSeconds,
    gameState.timeRemaining,
    game.status
  );
  const mm = Math.floor(Math.max(0, t) / 60);
  const ss = String(Math.max(0, t) % 60).padStart(2, "0");
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2">
      <div
        className={`font-mono tabular-nums text-lg px-3 py-1 border bg-void/80 backdrop-blur-sm ${
          t <= 30 ? "border-crimson/60 text-crimson" : "border-rib text-phosphor"
        }`}
      >
        {mm}:{ss}
      </div>
      {/* The Expert never touches the bomb, so their screen can't know
          when the Defuser finishes. When the Defuser calls it, tap this
          to log the win + stop the clock. */}
      <button
        onClick={onMarkDefused}
        title="Defuser cleared the bomb"
        className="border border-phosphor/50 bg-phosphor/10 backdrop-blur-sm px-2 py-1.5 text-phosphor hover:bg-phosphor/20 transition-colors flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em]"
      >
        <ShieldCheck size={15} /> Defused
      </button>
      <button
        onClick={onExit}
        aria-label="Leave match"
        className="border border-rib bg-void/80 backdrop-blur-sm p-1.5 text-bone-dim hover:text-bone hover:border-bone-dim/40 transition-colors"
      >
        <LogOut size={16} />
      </button>
    </div>
  );
}

function OfflineGameOver({
  status,
  role,
  onReplay,
  onNewMatch,
  onExit,
}: {
  status: "won" | "lost";
  role: PlayerRole;
  onReplay: () => void;
  onNewMatch: () => void;
  onExit: () => void;
}) {
  const won = status === "won";
  return (
    <div className="absolute inset-0 bg-void/90 backdrop-blur-md flex items-center justify-center z-50 reveal overflow-auto py-8">
      <div className="text-center max-w-md px-6">
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
        <p className="text-bone-dim font-mono text-xs uppercase tracking-[0.25em] mb-2">
          {won ? "Outstanding teamwork." : "Better luck next time."}
        </p>
        {role === "expert" && (
          <p className="text-bone-dim/60 font-mono text-[10px] uppercase tracking-[0.2em] mb-6">
            (Offline — your screen ends on the timer. Trust your Defuser's call.)
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
          <button
            onClick={onReplay}
            className="px-6 py-3 bg-amber hover:bg-amber-glow text-void font-stencil uppercase tracking-[0.2em] text-base transition-colors flex items-center justify-center gap-2"
          >
            <RotateCcw size={16} strokeWidth={2.5} /> Replay Same Seed
          </button>
          <button
            onClick={onNewMatch}
            className="px-6 py-3 border border-rib hover:border-steel-light text-bone-dim hover:text-bone font-mono uppercase tracking-[0.2em] text-xs transition-colors flex items-center justify-center gap-2"
          >
            <Bomb size={14} strokeWidth={2.5} /> New Match
          </button>
          <button
            onClick={onExit}
            className="px-6 py-3 border border-rib hover:border-steel-light text-bone-dim hover:text-bone font-mono uppercase tracking-[0.2em] text-xs transition-colors flex items-center justify-center gap-2"
          >
            <Home size={14} strokeWidth={2.5} /> Exit
          </button>
        </div>
      </div>
    </div>
  );
}
