import { useEffect, useRef, useState } from "react";

/* Display-side timer countdown — fully client-driven once we've seen one
   poll, so each displayed second lasts exactly one real second. No
   re-anchoring on every poll (which used to make the display rewind or
   skip when extrapolation overshot the next server tick).

   Strategy:
     1. The server sends `startedAt` (absolute server epoch seconds) and
        `timerSeconds`. These never change for a given game.
     2. We estimate `serverOffset = server_now - client_now` from each
        poll: serverNow ≈ startedAt + timerSeconds - serverRemaining.
        The server floors when computing serverRemaining, so any
        single estimate is up to 1s LOW. We keep `max(estimates)` so
        the offset converges to the truth after a couple of polls and
        never produces a backwards display.
     3. Display = floor(startedAt + timerSeconds - (clientNow + offset)).
        Both clients running this against their own (possibly-skewed)
        clocks land on the same number within 1s as soon as their
        offsets settle.

   While the game isn't active, returns the raw server value so SSR +
   hydration agree and we don't extrapolate from a stale startedAt. */
export function useDisplayTime(
  startedAt: number | null,
  timerSeconds: number,
  serverRemaining: number,
  status: string
): number {
  const [mounted, setMounted] = useState(false);
  const [, setTick] = useState(0);

  /* server_now - client_now, both in seconds. null until first poll. */
  const serverOffsetRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  /* Refresh the offset on every poll. We only ever *raise* it — since
     the server's flooring guarantees each single-poll estimate is at
     most 1s low, the largest value across polls is the closest to
     truth. (A pathological clock jump backwards on the client would
     leave us stuck on the old offset; that's a corner case we trade
     for a guaranteed-monotonic display.) */
  useEffect(() => {
    if (startedAt === null) return;
    const clientNowSec = Date.now() / 1000;
    const serverNowEstimate = startedAt + timerSeconds - serverRemaining;
    const newOffset = serverNowEstimate - clientNowSec;
    if (
      serverOffsetRef.current === null ||
      newOffset > serverOffsetRef.current
    ) {
      serverOffsetRef.current = newOffset;
    }
  }, [serverRemaining, startedAt, timerSeconds]);

  /* Re-render at 10 Hz while active. The displayed value only changes
     once per second, but the high cadence keeps the released-at value
     accurate to within ~100ms of when the player actually let go. */
  useEffect(() => {
    if (status !== "active") return;
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 100);
    return () => clearInterval(id);
  }, [status]);

  if (!mounted || status !== "active" || startedAt === null) {
    return serverRemaining;
  }
  const offset = serverOffsetRef.current;
  if (offset === null) {
    /* Before the first poll lands we have no estimate — fall back to
       the latest server value so we never show a wildly wrong number. */
    return serverRemaining;
  }
  const clientNowSec = Date.now() / 1000;
  const serverNow = clientNowSec + offset;
  return Math.max(0, Math.floor(startedAt + timerSeconds - serverNow));
}
