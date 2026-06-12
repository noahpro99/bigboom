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
   BASE_VOLUMES[key] * busVolume[bus]; muted overrides everything to silent. */
export type Bus = "music" | "sfx" | "timer";

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
  sfx: number;
  timer: number;
}

const DEFAULT_VOLUMES: PersistedVolumes = {
  music: 1,
  sfx: 1,
  timer: 1,
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

let busVolumes: PersistedVolumes = { ...DEFAULT_VOLUMES };
let muted = false;

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
  return MUSIC_BASE[key] * busVolumes.music;
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
  if (typeof window === "undefined" || muted) return;
  const h = load(key);
  h.volume(effective(key));
  h.play();
}

function applyMusicPlayState(key: MusicKey) {
  const h = musicCache.get(key);
  if (!h) return;
  const wantsPlaying = activeMusic.has(key) && !muted && busVolumes.music > 0;
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
