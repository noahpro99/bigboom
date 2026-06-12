import { Howl } from "howler";

export type SoundKey =
  | "menuButton"
  | "wireSnip"
  | "buttonDown"
  | "buttonUp"
  | "symbolPress"
  | "pageTurn"
  | "wrongBuzzer"
  | "timerTick"
  | "timerCritical"
  | "explosion"
  | "win";

export type MusicKey = "menuMusic";

/* Every sound belongs to exactly one mix bus. The Settings modal exposes
   one master slider per bus; the per-key BASE_VOLUMES below give the
   relative loudness within a bus. Effective volume at play time is
   BASE_VOLUMES[key] * busVolume[bus]; muted overrides everything to silent.

   Music has two buses — "music" for menu/lobby/game-over and "musicInGame"
   for active gameplay — controlled by setInGame() below. The active
   gameplay bus defaults lower so music doesn't compete with concentration. */
export type Bus = "music" | "musicInGame" | "sfx" | "timer";

const BUS: Record<SoundKey, Exclude<Bus, "music">> = {
  menuButton: "sfx",
  wireSnip: "sfx",
  buttonDown: "sfx",
  buttonUp: "sfx",
  symbolPress: "sfx",
  pageTurn: "sfx",
  wrongBuzzer: "sfx",
  explosion: "sfx",
  win: "sfx",
  timerTick: "timer",
  timerCritical: "timer",
};

const FILES: Record<SoundKey, string> = {
  menuButton: "/sounds/menu-button.ogg",
  wireSnip: "/sounds/wire-snip.ogg",
  buttonDown: "/sounds/toggle-down.ogg",
  buttonUp: "/sounds/toggle-up.ogg",
  symbolPress: "/sounds/clicky-button.ogg",
  pageTurn: "/sounds/page-turn.ogg",
  wrongBuzzer: "/sounds/wrong-buzzer.ogg",
  timerTick: "/sounds/countdown-beep.ogg",
  timerCritical: "/sounds/countdown-ending.ogg",
  explosion: "/sounds/explosion.ogg",
  win: "/sounds/win.ogg",
};

const BASE_VOLUMES: Record<SoundKey, number> = {
  menuButton: 0.45,
  wireSnip: 0.75,
  buttonDown: 0.6,
  buttonUp: 0.6,
  symbolPress: 0.55,
  pageTurn: 0.55,
  wrongBuzzer: 0.7,
  timerTick: 0.3,
  timerCritical: 0.55,
  explosion: 0.85,
  win: 0.7,
};

const MUSIC_FILES: Record<MusicKey, string> = {
  menuMusic: "/sounds/menu-music.ogg",
};
const MUSIC_BASE: Record<MusicKey, number> = {
  menuMusic: 0.12,
};

const MUTE_KEY = "bigboom-muted";
const VOL_KEY = "bigboom-volumes";

interface PersistedVolumes {
  music: number;
  musicInGame: number;
  sfx: number;
  timer: number;
}

const DEFAULT_VOLUMES: PersistedVolumes = {
  music: 1,
  /* Music gets ducked hard during active gameplay so it sits well below
     SFX and timer beeps. The slider lets the host taste-test up or down. */
  musicInGame: 0.25,
  sfx: 1,
  timer: 1,
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

let busVolumes: PersistedVolumes = { ...DEFAULT_VOLUMES };
let muted = false;
/* "Listening" mode — held by the Morse module's defuser-side AUDIO
   button. While true, no SFX/music plays; only the synthesized morse
   tone (which goes through a separate Web Audio path) is audible. */
let listening = false;
/* True while the bomb is armed (status === "active"). Switches the
   music bus from "music" to "musicInGame" so the in-game slider takes
   over. Game route hooks into status changes via setInGame(). */
let inGame = false;

const cache = new Map<SoundKey, Howl>();
const musicCache = new Map<MusicKey, Howl>();
const activeMusic = new Set<MusicKey>();
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  muted = window.localStorage.getItem(MUTE_KEY) === "1";
  try {
    const raw = window.localStorage.getItem(VOL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedVolumes>;
      busVolumes = {
        music: clamp01(parsed.music ?? DEFAULT_VOLUMES.music),
        musicInGame: clamp01(
          parsed.musicInGame ?? DEFAULT_VOLUMES.musicInGame
        ),
        sfx: clamp01(parsed.sfx ?? DEFAULT_VOLUMES.sfx),
        timer: clamp01(parsed.timer ?? DEFAULT_VOLUMES.timer),
      };
    }
  } catch {
    /* malformed JSON — fall back to defaults */
  }
}

function persistVolumes() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VOL_KEY, JSON.stringify(busVolumes));
}

function effective(key: SoundKey): number {
  if (muted) return 0;
  return BASE_VOLUMES[key] * busVolumes[BUS[key]];
}

function effectiveMusic(key: MusicKey): number {
  if (muted) return 0;
  const bus: Bus = inGame ? "musicInGame" : "music";
  return MUSIC_BASE[key] * busVolumes[bus];
}

function load(key: SoundKey): Howl {
  let h = cache.get(key);
  if (!h) {
    h = new Howl({ src: [FILES[key]], volume: effective(key), preload: true });
    cache.set(key, h);
  }
  return h;
}

function loadMusic(key: MusicKey): Howl {
  let h = musicCache.get(key);
  if (!h) {
    h = new Howl({
      src: [MUSIC_FILES[key]],
      volume: effectiveMusic(key),
      loop: true,
      preload: true,
      html5: true,
    });
    musicCache.set(key, h);
  }
  return h;
}

export function play(key: SoundKey) {
  if (typeof window === "undefined" || muted || listening) return;
  const h = load(key);
  h.volume(effective(key));
  h.play();
}

function applyMusicPlayState(key: MusicKey) {
  const h = musicCache.get(key);
  if (!h) return;
  const activeBus: Bus = inGame ? "musicInGame" : "music";
  const wantsPlaying =
    activeMusic.has(key) && !muted && !listening && busVolumes[activeBus] > 0;
  if (wantsPlaying && !h.playing()) h.play();
  else if (!wantsPlaying && h.playing()) h.pause();
}

function applyAllVolumes() {
  cache.forEach((h, key) => h.volume(effective(key)));
  musicCache.forEach((h, key) => h.volume(effectiveMusic(key)));
  activeMusic.forEach(applyMusicPlayState);
}

export function playMusic(key: MusicKey) {
  if (typeof window === "undefined") return;
  loadMusic(key);
  activeMusic.add(key);
  applyMusicPlayState(key);
}

export function stopMusic(key: MusicKey) {
  activeMusic.delete(key);
  const h = musicCache.get(key);
  if (h) h.stop();
}

export function preloadAll() {
  if (typeof window === "undefined") return;
  (Object.keys(FILES) as SoundKey[]).forEach(load);
}

export function setMuted(v: boolean) {
  muted = v;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  }
  applyAllVolumes();
  listeners.forEach((l) => l());
}

export function isMuted(): boolean {
  return muted;
}

export function getBusVolume(bus: Bus): number {
  return busVolumes[bus];
}

export function setBusVolume(bus: Bus, value: number) {
  busVolumes[bus] = clamp01(value);
  persistVolumes();
  applyAllVolumes();
  listeners.forEach((l) => l());
}

export function subscribeAudio(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/* Backwards-compat alias — older imports used subscribeMuted. */
export const subscribeMuted = subscribeAudio;

/* ----- Listen mode + synthesized morse tone -----
   Independent Web Audio pipeline so we can produce a precisely-gated
   tone without involving Howler. Used by the Morse module's hold-to-
   listen button: while held, listening=true suppresses everything else
   so the player can concentrate on the beeps. */

export function setListening(on: boolean) {
  if (listening === on) return;
  listening = on;
  /* When entering listening mode, pause whatever music's playing.
     When leaving, applyAllVolumes resumes it if appropriate. */
  applyAllVolumes();
  listeners.forEach((l) => l());
}

/* Toggle the music-bus selection. Called by the game route when the
   game status transitions in/out of "active". */
export function setInGame(on: boolean) {
  if (inGame === on) return;
  inGame = on;
  applyAllVolumes();
  listeners.forEach((l) => l());
}

export function isListening(): boolean {
  return listening;
}

let audioCtx: AudioContext | null = null;
let toneOsc: OscillatorNode | null = null;
let toneGain: GainNode | null = null;

function ensureAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor = (window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  /* Browsers suspend AudioContexts created before the first user
     gesture — calling resume() here is safe after the press that
     triggered listening mode. */
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/* Start a continuous tone at `audibleHz`, initially silent. Call
   `gateMorseTone(true|false)` to switch it on/off during the morse
   schedule. Stops any previous tone. */
export function startMorseTone(audibleHz: number) {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  stopMorseTone();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = audibleHz;
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  toneOsc = osc;
  toneGain = gain;
}

const TONE_LEVEL = 0.18;
const TONE_RAMP = 0.008; // s — short fade prevents clicks at edges

export function gateMorseTone(on: boolean) {
  if (!toneGain || !audioCtx) return;
  const t = audioCtx.currentTime;
  toneGain.gain.cancelScheduledValues(t);
  toneGain.gain.setValueAtTime(toneGain.gain.value, t);
  toneGain.gain.linearRampToValueAtTime(on ? TONE_LEVEL : 0, t + TONE_RAMP);
}

export function stopMorseTone() {
  if (toneGain && audioCtx) {
    /* Fade out first to avoid a click, then disconnect. */
    const t = audioCtx.currentTime;
    toneGain.gain.cancelScheduledValues(t);
    toneGain.gain.setValueAtTime(toneGain.gain.value, t);
    toneGain.gain.linearRampToValueAtTime(0, t + TONE_RAMP);
  }
  if (toneOsc) {
    try {
      toneOsc.stop(audioCtx ? audioCtx.currentTime + TONE_RAMP * 2 : 0);
    } catch {
      /* already stopped */
    }
    toneOsc = null;
  }
  if (toneGain) {
    setTimeout(() => {
      toneGain?.disconnect();
      toneGain = null;
    }, 20);
  }
}
