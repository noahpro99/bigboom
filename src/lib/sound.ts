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
  | "explosion";

export type MusicKey = "menuMusic";

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
};

const VOLUMES: Record<SoundKey, number> = {
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
};

const MUSIC_FILES: Record<MusicKey, string> = {
  menuMusic: "/sounds/menu-music.ogg",
};

// Background music sits well below SFX so it's atmosphere, not in the way.
const MUSIC_VOLUMES: Record<MusicKey, number> = {
  menuMusic: 0.12,
};

const MUTE_KEY = "bigboom-muted";

const cache = new Map<SoundKey, Howl>();
const musicCache = new Map<MusicKey, Howl>();
const activeMusic = new Set<MusicKey>();
let muted = false;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  muted = window.localStorage.getItem(MUTE_KEY) === "1";
}

function load(key: SoundKey): Howl {
  let h = cache.get(key);
  if (!h) {
    h = new Howl({ src: [FILES[key]], volume: VOLUMES[key], preload: true });
    cache.set(key, h);
  }
  return h;
}

function loadMusic(key: MusicKey): Howl {
  let h = musicCache.get(key);
  if (!h) {
    h = new Howl({
      src: [MUSIC_FILES[key]],
      volume: muted ? 0 : MUSIC_VOLUMES[key],
      loop: true,
      preload: true,
      html5: true, // stream long files instead of decoding to buffer
    });
    musicCache.set(key, h);
  }
  return h;
}

export function play(key: SoundKey) {
  if (typeof window === "undefined" || muted) return;
  load(key).play();
}

export function playMusic(key: MusicKey) {
  if (typeof window === "undefined") return;
  const h = loadMusic(key);
  activeMusic.add(key);
  if (!h.playing()) {
    h.volume(muted ? 0 : MUSIC_VOLUMES[key]);
    h.play();
  }
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
  // Apply to any music that is currently playing.
  activeMusic.forEach((key) => {
    const h = musicCache.get(key);
    if (h) h.volume(v ? 0 : MUSIC_VOLUMES[key]);
  });
  listeners.forEach((l) => l());
}

export function isMuted(): boolean {
  return muted;
}

export function subscribeMuted(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
