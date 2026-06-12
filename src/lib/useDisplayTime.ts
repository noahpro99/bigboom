import { useEffect, useRef, useState } from "react";

/* Display-side timer countdown. Both players need to see the SAME number
   at the same wall-clock moment, even if their devices' clocks disagree.
   The fix: anchor on the server's `timeRemaining` plus the local time
   elapsed since the moment that poll *landed in this tab*. Clock skew
   between Defuser and Expert no longer matters — they each derive their
   display from the same server-blessed remaining-seconds value, minus
   their own elapsed-since-poll, which differs by at most the polling
   interval (~1.5s) instead of the device's clock-skew.

   While the game isn't active, returns the raw server value so SSR +
   hydration agree and we don't show stale local extrapolations.

   startedAt and timerSeconds are accepted for API compatibility but no
   longer drive the displayed value. */
export function useDisplayTime(
  _startedAt: number | null,
  _timerSeconds: number,
  serverRemaining: number,
  status: string
): number {
  const [mounted, setMounted] = useState(false);
  const [, setTick] = useState(0);

  /* Receipt timestamp + value at receipt, in refs so the local clock
     interval can read them without re-rendering on every poll. */
  const receivedAtRef = useRef<number | null>(null);
  const baseRemainingRef = useRef<number>(serverRemaining);

  useEffect(() => {
    setMounted(true);
  }, []);

  /* Latch the new server value the moment it comes in. We use Date.now()
     locally as the reference for elapsed time — both clients use their
     OWN Date.now(), but only for the *delta* since the latch, so clock
     skew doesn't accumulate. */
  useEffect(() => {
    receivedAtRef.current = Date.now();
    baseRemainingRef.current = serverRemaining;
  }, [serverRemaining]);

  useEffect(() => {
    if (status !== "active") return;
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 250);
    return () => clearInterval(id);
  }, [status]);

  if (!mounted || status !== "active") return serverRemaining;
  if (receivedAtRef.current === null) return serverRemaining;

  const elapsedSinceLatch = (Date.now() - receivedAtRef.current) / 1000;
  /* Floor (not round) — the displayed "9" means the actual remaining is
     in [9, 10). The button-hold release check on the server compares
     against the SAME integer the user saw. */
  return Math.max(0, Math.floor(baseRemainingRef.current - elapsedSinceLatch));
}
