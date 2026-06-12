// Per-tab session ID, persisted in sessionStorage so it survives navigation
// inside the tab but a different tab gets a different session.

let cached: string | null = null;
const KEY = "bigboom-session";

export function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  if (cached) return cached;
  const existing = window.sessionStorage.getItem(KEY);
  if (existing) {
    cached = existing;
    return existing;
  }
  const fresh =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  window.sessionStorage.setItem(KEY, fresh);
  cached = fresh;
  return fresh;
}
