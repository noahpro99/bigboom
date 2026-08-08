import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BombView, type BombActions } from "../components/bomb/BombView";
import { ManualView } from "../components/manual/ManualView";
import { SoundLayer } from "../components/SoundLayer";
import { ProfileButton } from "../components/ProfileButton";
import { ConfigSection } from "../components/lobby/ConfigSection";
import { QrCode } from "../components/offline/QrCode";
import { play, preloadAll, playMusic, setInGame } from "../lib/sound";
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
  applyGiveUp,
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
import { newRoomId, reportLobby, reportResult } from "../lib/sync";
import { getSessionId } from "../lib/session";
import { useLobbySocket, type LobbyPlayer } from "../lib/useLobbySocket";
import {
  PRESET_CONFIGS,
  type GameState,
  type ModuleType,
  type PlayerRole,
  type Preset,
} from "../lib/types";
import {
  Bomb,
  BookOpen,
  Home,
  ArrowRight,
  Check,
  Copy,
  AlertTriangle,
  Link2,
  QrCode as QrCodeIcon,
  RotateCcw,
  ShieldCheck,
  Skull,
  Dice5,
  X,
} from "lucide-react";

export const Route = createFileRoute("/lobby")({
  validateSearch: (search: Record<string, unknown>): { join?: string; room?: string } => ({
    join: typeof search.join === "string" ? search.join : undefined,
    room: typeof search.room === "string" ? search.room : undefined,
  }),
  component: LobbyPage,
});

const STORAGE_KEY = "bigboom-offline";

interface SavedGame {
  gameState: GameState;
  match: OfflineMatch;
  role: PlayerRole;
  gameId: string;
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

function LobbyPage() {
  const navigate = useNavigate();
  const { join, room: roomFromUrl } = Route.useSearch();

  const [phase, setPhase] = useState<"lobby" | "play">("lobby");
  // Decode the join URL param synchronously so joinedFromLink is true on the
  // very first render — if we wait for a useEffect, LobbyScreen's useState
  // initializer has already captured the wrong (false) joined value.
  const [match, setMatch] = useState<OfflineMatch | null>(() =>
    join ? decodeMatch(join) : null
  );
  const [role, setRole] = useState<PlayerRole>(join ? "expert" : "defuser");
  const [gameId, setGameId] = useState<string>("");
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

  // On first mount: if there's a saved in-progress game, jump straight to it.
  // The join-URL case is already handled above via lazy useState.
  useEffect(() => {
    const saved = loadSaved();
    if (saved?.gameState?.game) {
      setMatch(saved.match);
      setRole(saved.role);
      setGameId(saved.gameId);
      setGame(saved.gameState);
      setPhase("play");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Music bus follows whether a bomb is armed.
  useEffect(() => {
    setInGame(phase === "play" && game?.game.status === "active");
    return () => setInGame(false);
  }, [phase, game?.game.status]);

  /* Start a match. If `sync` is provided the game uses that shared
     gameId + startedAt so a partner who received the WS "start" enters
     play at the same anchor and timers agree. */
  function startMatch(
    m: OfflineMatch,
    r: PlayerRole,
    sync?: { gameId: string; startedAt: number }
  ) {
    const id = sync?.gameId ?? newRoomId();
    const fresh = createOfflineGame(m, r, id, sync?.startedAt);
    setMatch(m);
    setRole(r);
    setGameId(id);
    setGame(fresh);
    setPhase("play");
    saveGame({ gameState: fresh, match: m, role: r, gameId: id });
    // Once the game is armed the lobby snapshot is stale — clear it so a
    // future /lobby visit starts fresh.
    clearPersistedLobby();
    play("menuButton");
    // Optimistic, best-effort: register the lobby online if we can. Never
    // blocks — if it fails or we're offline, the game plays on regardless.
    reportLobby(id, fresh.game.serial, m);
    return { id, startedAt: fresh.game.startedAt! };
  }

  const updateGame = useCallback(
    (next: GameState) => {
      setGame(next);
      if (match) saveGame({ gameState: next, match, role, gameId });
    },
    [match, role, gameId]
  );

  function exitToLobby() {
    saveGame(null);
    setGame(null);
    setPhase("lobby");
  }

  if (phase === "play" && game && match) {
    return (
      <PlayScreen
        gameState={game}
        role={role}
        gameId={gameId}
        match={match}
        setGameState={updateGame}
        onReplay={() => startMatch(match, role)}
        onExit={exitToLobby}
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
        <div className="text-center mb-6 reveal">
          <div className="inline-flex items-center gap-2 mb-3 text-phosphor border border-phosphor/40 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.3em]">
            <span className="w-1.5 h-1.5 rounded-full bg-phosphor pulse-dot" />
            <span>Briefing Room</span>
          </div>
          <h1 className="font-stencil leading-[0.85] tracking-tight">
            <span className="text-4xl text-bone">BIG</span>
            <span className="text-4xl text-crimson">BOOM</span>
          </h1>
          <p className="text-bone-dim font-mono text-[10px] uppercase tracking-[0.3em] mt-2">
            Two players · One bomb
          </p>
        </div>

        <LobbyScreen
          initialMatch={match}
          joinedFromLink={!!join && !!match}
          roomFromUrl={roomFromUrl}
          onStart={(m, r, sync) => startMatch(m, r, sync)}
        />
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

/* The single lobby screen. You host by default (editable config + a Share
   button that hands a QR/code to your partner). If you arrive via someone
   else's code — by scanning or pasting — the config locks to their bomb
   and you just pick a role + start. The Share QR is generated client-side,
   so it works with no connection. */
/* Per-tab lobby state persistence. Reloads (accidental or intentional)
   used to wipe the roomId, seed, config, and role — leaving the host in
   a fresh room while their partner was stranded in the old one. Now we
   snapshot the whole lobby into sessionStorage and re-hydrate on mount. */
const LOBBY_STATE_KEY = "bigboom-lobby-state";
interface PersistedLobby {
  roomId: string;
  seed: number;
  preset: Preset;
  timerSeconds: number;
  moduleTypes: ModuleType[];
  role: PlayerRole;
  joined: boolean;
}
function loadPersistedLobby(): PersistedLobby | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(LOBBY_STATE_KEY);
    return raw ? (JSON.parse(raw) as PersistedLobby) : null;
  } catch {
    return null;
  }
}
function persistLobby(s: PersistedLobby) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(LOBBY_STATE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
function clearPersistedLobby() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(LOBBY_STATE_KEY);
  } catch {
    /* ignore */
  }
}

function LobbyScreen({
  initialMatch,
  joinedFromLink,
  roomFromUrl,
  onStart,
}: {
  initialMatch: OfflineMatch | null;
  joinedFromLink: boolean;
  roomFromUrl?: string;
  onStart: (
    m: OfflineMatch,
    r: PlayerRole,
    sync?: { gameId: string; startedAt: number }
  ) => { id: string; startedAt: number };
}) {
  const base = PRESET_CONFIGS.standard;

  const [seed, setSeed] = useState<number>(() => initialMatch?.seed ?? randomSeed());
  const [preset, setPreset] = useState<Preset>(initialMatch?.preset ?? base.preset);
  const [timerSeconds, setTimerSeconds] = useState<number>(
    initialMatch?.timerSeconds ?? base.timerSeconds
  );
  const [moduleTypes, setModuleTypes] = useState<ModuleType[]>(
    initialMatch?.moduleTypes ?? [...base.moduleTypes]
  );
  // "joined" = playing a partner's bomb (config is theirs, read-only).
  const [joined, setJoined] = useState<boolean>(joinedFromLink);
  const [role, setRole] = useState<PlayerRole>(joinedFromLink ? "expert" : "defuser");

  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  /* Stable room ID for pre-game presence. Host generates one; joiner gets
     it from the URL. Persisted rehydration in the effect below will
     override this on reload so the same tab lands back in the same room. */
  const [roomId, setRoomId] = useState<string>(
    () => roomFromUrl ?? newRoomId()
  );
  const sessionId = typeof window !== "undefined" ? getSessionId() : "";

  /* Rehydrate from sessionStorage on mount. Runs AFTER useState so no
     SSR/client hydration mismatch (SSR gets the pristine default DOM;
     the client overwrites state once mounted). A fresh invite URL or a
     just-passed match always wins over the snapshot. */
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (joinedFromLink || initialMatch) return; // URL wins over cache
    const p = loadPersistedLobby();
    if (!p) return;
    setSeed(p.seed);
    setPreset(p.preset);
    setTimerSeconds(p.timerSeconds);
    setModuleTypes(p.moduleTypes);
    setJoined(p.joined);
    setRole(p.role);
    setRoomId(p.roomId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the lobby snapshot whenever anything meaningful changes so a
  // page reload lands you back in the same room with the same config/role.
  useEffect(() => {
    if (!hydratedRef.current) return; // skip pre-hydration
    persistLobby({
      roomId,
      seed,
      preset,
      timerSeconds,
      moduleTypes,
      role,
      joined,
    });
  }, [roomId, seed, preset, timerSeconds, moduleTypes, role, joined]);

  // WS-based presence — only shown when connected.
  const [presencePlayers, setPresencePlayers] = useState<LobbyPlayer[]>([]);

  // Keep a ref to current config so callbacks always send the latest values.
  const configRef = useRef({ seed, timerSeconds, moduleTypes });
  useEffect(() => { configRef.current = { seed, timerSeconds, moduleTypes }; });

  /* Refs so the WS callbacks (installed once) always see the latest role +
     match without re-installing the socket. `startedRef` guards against a
     double-start if we fired our own local start and also get the echo. */
  const roleRef = useRef(role);
  useEffect(() => { roleRef.current = role; }, [role]);
  const matchRef = useRef<OfflineMatch | null>(null);
  const startedRef = useRef(false);

  const { connected, sendConfig, sendStart } = useLobbySocket({
    roomId,
    sessionId,
    role,
    onPlayers: setPresencePlayers,
    // Guest receives config from host via WS and auto-applies it.
    onConfig: (cfg) => {
      if (joined) applyMatch(normalizeMatch(cfg));
    },
    // Partner clicked "Arm & Play". Enter play at the same anchor so timers
    // agree. The server relays start-messages only to OTHER sessions in the
    // room, so we won't get our own back — but keep the guard anyway.
    onStart: (sync) => {
      if (startedRef.current) return;
      startedRef.current = true;
      const m = matchRef.current;
      if (!m) return;
      onStart(m, roleRef.current, sync);
    },
  });

  /* If we land in a room where our default role is already taken by
     someone else (typical case: host is already Expert, guest joins via
     link which also defaults to Expert), silently flip to the other role
     the FIRST time we hear presence. After that, the player's choices are
     sticky — no more auto-swaps. */
  const autoSwappedRef = useRef(false);
  useEffect(() => {
    if (autoSwappedRef.current) return;
    if (!connected || presencePlayers.length < 2) return;
    const others = presencePlayers.filter((p) => !p.isMe);
    const conflict = others.some((p) => p.role === role);
    if (!conflict) {
      autoSwappedRef.current = true; // no swap needed; lock in
      return;
    }
    const swap: PlayerRole = role === "defuser" ? "expert" : "defuser";
    setRole(swap);
    autoSwappedRef.current = true;
  }, [connected, presencePlayers, role]);

  // When the WS first connects, push the current config so the guest
  // immediately sees the host's settings even if they joined mid-session.
  const sendConfigFn = sendConfig;
  useEffect(() => {
    if (connected && !joined) sendConfigFn(configRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const match = useMemo(
    () => normalizeMatch({ seed, timerSeconds, moduleTypes }),
    [seed, timerSeconds, moduleTypes]
  );
  // Keep the ref fresh so the WS onStart callback (installed once) can
  // build the game from the latest match without reinstalling the socket.
  useEffect(() => { matchRef.current = match; }, [match]);
  const code = encodeMatch(match);
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://bigboom.app";
  const url = inviteUrl(origin, match, roomId);


  function applyMatch(m: OfflineMatch) {
    setSeed(m.seed);
    setPreset(m.preset);
    setTimerSeconds(m.timerSeconds);
    setModuleTypes(m.moduleTypes);
  }

  function onConfigChange(next: {
    preset?: Preset;
    timerSeconds?: number;
    moduleTypes?: ModuleType[];
  }) {
    let newTimerSeconds = timerSeconds;
    let newModuleTypes = moduleTypes;

    if (next.preset && next.preset !== "custom") {
      const cfg = PRESET_CONFIGS[next.preset];
      setPreset(cfg.preset);
      setTimerSeconds(cfg.timerSeconds);
      setModuleTypes([...cfg.moduleTypes]);
      newTimerSeconds = cfg.timerSeconds;
      newModuleTypes = [...cfg.moduleTypes];
    } else {
      const m = matchFromConfig(seed, {
        preset: "custom",
        timerSeconds: next.timerSeconds ?? timerSeconds,
        moduleTypes: next.moduleTypes ?? moduleTypes,
      });
      setPreset(m.preset);
      setTimerSeconds(m.timerSeconds);
      setModuleTypes(m.moduleTypes);
      newTimerSeconds = m.timerSeconds;
      newModuleTypes = m.moduleTypes;
    }

    if (!joined) sendConfig({ seed, timerSeconds: newTimerSeconds, moduleTypes: newModuleTypes });
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

  async function shareLink() {
    play("menuButton");
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "BigBoom",
          text: `Defuse with me — match code ${code}`,
          url,
        });
        return;
      } catch {
        /* cancelled or unsupported — fall back to copying */
      }
    }
    copyCode();
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      play("menuButton");
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="w-full max-w-lg bg-chassis/70 border border-rib backdrop-blur-sm reveal">
      <div className="flex items-center justify-between px-4 py-2 bg-rib/60 border-b border-rib text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
        <span>{joined ? "Joined a match" : "Build the bomb"}</span>
        <span className={`flex items-center gap-1.5 ${connected ? "text-phosphor" : "text-bone-dim/40"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-phosphor animate-pulse" : "bg-bone-dim/30"}`} />
          {connected ? "LIVE" : "OFFLINE"}
        </span>
      </div>

      {/* Share + Copy actions */}
      <div className="p-5 border-b border-rib/60 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              play("menuButton");
              setShareOpen((v) => !v);
            }}
            aria-pressed={shareOpen}
            className={`px-3 py-3 border transition-colors font-stencil text-base uppercase tracking-[0.18em] flex items-center justify-center gap-2 ${
              shareOpen
                ? "border-amber bg-amber/14 text-amber"
                : "border-amber/50 hover:border-amber bg-amber/8 hover:bg-amber/12 text-amber"
            }`}
          >
            <QrCodeIcon size={18} strokeWidth={2.5} /> QR Code
          </button>
          <button
            onClick={copyUrl}
            className="px-3 py-3 border transition-colors font-stencil text-base uppercase tracking-[0.18em] flex items-center justify-center gap-2 border-cyan-rad/50 hover:border-cyan-rad bg-cyan-rad/8 hover:bg-cyan-rad/12 text-cyan-rad"
          >
            {copiedUrl ? <Check size={18} strokeWidth={2.5} className="text-phosphor" /> : <Link2 size={18} strokeWidth={2.5} />}
            {copiedUrl ? "Copied!" : "Copy link"}
          </button>
        </div>

        {shareOpen && (
          <div className="border border-rib bg-void/40 p-4 flex flex-col items-center gap-3">
            <QrCode value={url} size={196} />
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
            <button
              onClick={copyUrl}
              className="w-full px-3 py-2 border border-rib hover:border-steel-light text-bone-dim hover:text-bone transition-colors flex items-center justify-center gap-2 font-mono text-xs uppercase tracking-[0.2em]"
            >
              {copiedUrl ? <Check size={14} className="text-phosphor" /> : <Link2 size={14} />}
              {copiedUrl ? "Copied!" : "Copy link"}
            </button>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-bone-dim/55 text-center">
              Partner taps Join and scans this — or types the code. Works offline.
            </p>
          </div>
        )}

      </div>

      {/* Players — only rendered when WS is connected */}
      {connected && presencePlayers.length > 0 && (
        <div className="px-5 py-3 border-b border-rib/60">
          <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim mb-2">
            Agents in room
          </div>
          <div className="flex flex-col gap-1">
            {presencePlayers.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono">
                <span className={`w-1.5 h-1.5 rounded-full ${p.role === "defuser" ? "bg-amber" : "bg-cyan-rad"}`} />
                <span className={p.isMe ? "text-bone" : "text-bone-dim"}>
                  {p.role === "defuser" ? "Defuser" : "Expert"}
                  {p.isMe && <span className="ml-1.5 text-bone-dim/50 text-[9px] uppercase tracking-widest">you</span>}
                </span>
              </div>
            ))}
            {presencePlayers.length === 1 && (
              <div className="flex items-center gap-2 text-xs font-mono text-bone-dim/40">
                <span className="w-1.5 h-1.5 rounded-full border border-bone-dim/30" />
                <span>Waiting for partner…</span>
              </div>
            )}
          </div>
        </div>
      )}

      {joined ? (
        /* Joined a partner's bomb — config is theirs. */
        <div className="px-5 py-4 border-b border-rib/60 flex items-center justify-between">
          <span className="text-phosphor font-mono text-[11px] uppercase tracking-[0.18em] flex items-center gap-1.5">
            <Check size={13} /> {match.preset} · {Math.floor(match.timerSeconds / 60)}m ·{" "}
            {match.moduleTypes.length} mod
          </span>
          <button
            onClick={() => {
              play("menuButton");
              setJoined(false);
              setRole("defuser");
              setSeed(randomSeed());
            }}
            className="text-[10px] font-mono uppercase tracking-[0.18em] text-bone-dim hover:text-bone flex items-center gap-1"
          >
            <X size={12} /> Host my own
          </button>
        </div>
      ) : (
        <>
          {/* Seed */}
          <div className="px-5 py-4 border-b border-rib/60">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
                Seed
              </span>
              <button
                onClick={() => {
                  play("menuButton");
                  const s = randomSeed();
                  setSeed(s);
                  if (!joined) sendConfig({ seed: s, timerSeconds, moduleTypes });
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
                const s = Number.isFinite(n) ? n >>> 0 : 0;
                setSeed(s);
                if (!joined) sendConfig({ seed: s, timerSeconds, moduleTypes });
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
        </>
      )}

      {/* Role */}
      <div className="p-5 border-b border-rib/60">
        <RolePicker
          role={role}
          onPick={setRole}
          hint={
            joined
              ? "Take whichever role your partner didn't."
              : "Pick whichever you want — your partner takes the other on their device."
          }
        />
      </div>

      {/* Start */}
      <div className="p-5">
        <button
          onClick={() => {
            if (startedRef.current) return;
            startedRef.current = true;
            const { id, startedAt } = onStart(match, role);
            // Broadcast to anyone else in the room so their lobbies start
            // simultaneously on the same anchor.
            sendStart({ gameId: id, startedAt });
          }}
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
          Plays instantly, online or off — solo or with a partner.
        </p>
      </div>
    </div>
  );
}

/* Local engine drives BombView (defuser) / ManualView (expert). Results
   are optimistically reported online; gameplay never waits on it. */
function PlayScreen({
  gameState,
  role,
  gameId,
  match,
  setGameState,
  onReplay,
  onExit,
}: {
  gameState: GameState;
  role: PlayerRole;
  gameId: string;
  match: OfflineMatch;
  setGameState: (s: GameState) => void;
  onReplay: () => void;
  onExit: () => void;
}) {
  const { game } = gameState;

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

  // Local timer — flip to "lost" when it runs out. Each device enforces
  // its own clock against the shared startedAt; no server involved.
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

  // Optimistic, best-effort: report the result once the game ends. The
  // overlay shows immediately regardless of whether this reaches the server.
  const reportedRef = useRef(false);
  useEffect(() => {
    if (reportedRef.current) return;
    if (game.status !== "won" && game.status !== "lost") return;
    reportedRef.current = true;
    let durationMs: number | null = null;
    if (game.startedAt != null) {
      const elapsed = Math.floor(Date.now() / 1000) - game.startedAt;
      durationMs = Math.max(0, Math.min(elapsed, game.timerSeconds)) * 1000;
    }
    reportResult(gameId, match, game.status, durationMs);
  }, [game.status, game.startedAt, game.timerSeconds, gameId, match]);

  const isOver = game.status === "won" || game.status === "lost";

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      <SoundLayer gameState={gameState} />

      {role === "expert" ? (
        <ManualView seed={game.seed} moduleTypes={game.moduleTypes} onGiveUp={() => setGameState(applyGiveUp(stateRef.current))} />
      ) : (
        <BombView gameState={gameState} actions={actions} readOnly={role === "spectator"} onGiveUp={() => setGameState(applyGiveUp(stateRef.current))} />
      )}

      {isOver && (
        <GameOver
          status={game.status as "won" | "lost"}
          role={role}
          onReplay={onReplay}
          onExit={onExit}
        />
      )}
    </div>
  );
}


function GameOver({
  status,
  role,
  onReplay,
  onExit,
}: {
  status: "won" | "lost";
  role: PlayerRole;
  onReplay: () => void;
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
            (Your screen ends on the timer — trust your Defuser's call.)
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
            onClick={onExit}
            className="px-6 py-3 border border-rib hover:border-steel-light text-bone-dim hover:text-bone font-mono uppercase tracking-[0.2em] text-xs transition-colors flex items-center justify-center gap-2"
          >
            <Home size={14} strokeWidth={2.5} /> Back to Lobby
          </button>
        </div>
      </div>
    </div>
  );
}
