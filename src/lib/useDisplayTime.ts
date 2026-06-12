import { useEffect, useState } from "react";

// Smooth countdown driven by the browser's clock. We anchor on the server's
// `startedAt` so the value matches what the server thinks, but the
// per-frame value is computed locally — no waiting for the next poll.
//
// While the game isn't active, returns the server-supplied remaining
// value so SSR + hydration agree.
export function useDisplayTime(
  startedAt: number | null,
  timerSeconds: number,
  serverRemaining: number,
  status: string
): number {
  const [mounted, setMounted] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (status !== "active") return;
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 250);
    return () => clearInterval(id);
  }, [status]);

  if (!mounted || status !== "active" || !startedAt) return serverRemaining;

  const now = Date.now() / 1000;
  return Math.max(0, Math.round(startedAt + timerSeconds - now));
}
