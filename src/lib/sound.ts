import { Howl } from "howler";

export type SoundKey =
  | "menuButton"
  | "wireSnip"
  | "buttonDown"
  | "buttonUp"
  | "symbolPress"
  | "pageTurn"
  | "timerTick"
  | "timerCritical"
  | "explosion";

const FILES: Record<SoundKey, string> = {
  menuButton: "/sounds/menu-button.ogg",
  wireSnip: "/sounds/wire-snip.ogg",
  buttonDown: "/sounds/toggle-down.ogg",
  buttonUp: "/sounds/toggle-up.ogg",
  symbolPress: "/sounds/clicky-button.ogg",
  pageTurn: "/sounds/page-turn.ogg",
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
  timerTick: 0.3,
  timerCritical: 0.55,
  explosion: 0.85,
};

const MUTE_KEY = "bigboom-muted";

const cache = new Map<SoundKey, Howl>();
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

export function play(key: SoundKey) {
  if (typeof window === "undefined" || muted) return;
  load(key).play();
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
