import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Radio, Headphones } from "lucide-react";
import type { Module, MorseModuleConfig } from "../../lib/types";
import { MORSE_FREQS } from "../../lib/types";
import { encodeMorse } from "../../lib/generator";
import {
  play,
  setListening,
  startMorseTone,
  gateMorseTone,
  stopMorseTone,
} from "../../lib/sound";

interface MorseModuleProps {
  module: Module;
  disabled: boolean;
  onDial: (freqIndex: number) => void;
  onTransmit: () => void;
  /* AUDIO hold button is pure feedback (no game-state effect), so
     spectator/helper sessions can use it even when their other
     interactions are disabled. Defaults to !disabled. */
  canListen?: boolean;
}

const DOT_MS = 220;
const DASH_MS = 660;
const GAP_INTRA = 220;
const GAP_LETTER = 660;
const GAP_WORD = 1500;

/* Build a flat list of (on, durationMs) atoms for one full pass of the
   word. The light is then driven by walking through them in order with
   setTimeout. */
function buildSchedule(word: string): Array<{ on: boolean; ms: number }> {
  const out: Array<{ on: boolean; ms: number }> = [];
  const letters = encodeMorse(word);
  letters.forEach((letter, li) => {
    if (li > 0) out.push({ on: false, ms: GAP_LETTER });
    for (let i = 0; i < letter.length; i++) {
      if (i > 0) out.push({ on: false, ms: GAP_INTRA });
      out.push({ on: true, ms: letter[i] === "-" ? DASH_MS : DOT_MS });
    }
  });
  out.push({ on: false, ms: GAP_WORD });
  return out;
}

/* Map the dialed MHz to an audible pitch. MORSE_FREQS spans 3.505 to
   3.600 MHz; we map that to 440 Hz (A4) — 880 Hz (A5), one octave,
   so each frequency notch is a distinct pitch the defuser can use to
   double-check what they're dialled to. The pitch the BEACON plays is
   indexed off the active word's actual response frequency, not the
   currently-dialled value — the puzzle is to find a match. */
function audibleHzForFreq(freqIndex: number): number {
  const t = freqIndex / Math.max(1, MORSE_FREQS.length - 1);
  return 440 + t * 440;
}

export function MorseModule({
  module,
  disabled,
  onDial,
  onTransmit,
  canListen,
}: MorseModuleProps) {
  const audioAllowed = canListen ?? !disabled;
  const config = module.config as MorseModuleConfig;
  const active = config.pool[config.activeIndex];
  const currentFreq = module.state.morseFreqIndex ?? 0;
  const beaconHz = audibleHzForFreq(active.freqIndex);

  /* ONE schedule walker drives both the LED and the audio gate so they
     can never drift. Listening is a ref so the loop reads the latest
     value without restarting (which would reset idx and desync from
     the LED the Expert is also watching). */
  const [lit, setLit] = useState(false);
  const [listening, setListeningLocal] = useState(false);
  const listeningRef = useRef(false);
  listeningRef.current = listening;
  /* Mirror of the current "step.on" so startListening can immediately
     match the audio gate to whatever phase the LED is in. */
  const currentOnRef = useRef(false);

  useEffect(() => {
    if (module.solved) {
      setLit(false);
      currentOnRef.current = false;
      return;
    }
    const schedule = buildSchedule(active.word);
    let cancelled = false;
    let idx = 0;
    let timer: number | undefined;

    const tick = () => {
      if (cancelled) return;
      const step = schedule[idx];
      setLit(step.on);
      currentOnRef.current = step.on;
      /* Gate the tone every step regardless — gateMorseTone is a no-op
         when the oscillator isn't running, so the cost is trivial and
         the audio stays locked to the visual schedule. */
      if (listeningRef.current) gateMorseTone(step.on);
      idx = (idx + 1) % schedule.length;
      timer = window.setTimeout(tick, step.ms);
    };
    timer = window.setTimeout(tick, 400);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active.word, module.solved]);

  /* AUDIO hold button — toggle the listening ref and gate the tone to
     match the CURRENT LED phase so the very first dot/dash the user
     hears lines up with the light they were already watching. */
  function startListening() {
    if (!audioAllowed || module.solved || listening) return;
    setListeningLocal(true);
    setListening(true);
    startMorseTone(beaconHz);
    /* Sync the gate immediately to whatever phase the schedule is in. */
    gateMorseTone(currentOnRef.current);
  }
  function stopListening() {
    if (!listeningRef.current) return;
    setListeningLocal(false);
    stopMorseTone();
    setListening(false);
  }
  /* Safety: if the component unmounts mid-press, restore audio. */
  useEffect(() => {
    return () => {
      if (listeningRef.current) {
        stopMorseTone();
        setListening(false);
      }
    };
  }, []);

  function step(delta: number) {
    if (disabled || module.solved) return;
    const next = Math.max(
      0,
      Math.min(MORSE_FREQS.length - 1, currentFreq + delta)
    );
    if (next === currentFreq) return;
    play("symbolPress");
    onDial(next);
  }

  function tx() {
    if (disabled || module.solved) return;
    play("buttonDown");
    onTransmit();
  }

  const borderColor = module.solved
    ? "border-phosphor/50"
    : module.struck
    ? "border-crimson/60"
    : "border-steel/50";

  const statusDot = module.solved
    ? "bg-phosphor shadow-[0_0_8px_#00f5a0]"
    : module.struck
    ? "bg-crimson shadow-[0_0_8px_#e0245e] led-glow-red"
    : "bg-amber-glow shadow-[0_0_6px_#ffaa3a] pulse-dot";

  return (
    <div className={`bezel relative border ${borderColor} rounded-sm p-5 pt-7`}>
      <span className="screw top-1.5 left-1.5" />
      <span className="screw top-1.5 right-1.5" />
      <span className="screw bottom-1.5 left-1.5" />
      <span className="screw bottom-1.5 right-1.5" />

      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-chassis px-3 py-1 text-sm font-stencil tracking-[0.18em] text-bone border border-steel/60">
        MORSE · MOD-T
      </div>

      <div className="flex items-center mb-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-[10px] font-mono uppercase tracking-widest text-bone-dim">
            {module.solved ? "DEFUSED" : module.struck ? "STRUCK" : "ARMED"}
          </span>
        </div>
      </div>

      {/* Flashing lamp + hold-to-listen audio button on its right. */}
      <div className="mx-auto mb-4 flex items-center justify-center gap-3">
        <div
          className="w-12 h-12 rounded-full transition-all duration-75"
          style={{
            background: lit
              ? "radial-gradient(circle at 30% 25%, #fff8e8 0%, #ffd96e 40%, #ff9d33 100%)"
              : "radial-gradient(circle at 30% 25%, #3a2a18 0%, #1b110a 60%, #0a0604 100%)",
            boxShadow: lit
              ? "0 0 22px #ffaa3a, 0 0 44px #ff7a00aa, inset 0 1px 0 rgba(255,255,255,0.5), 0 0 0 3px rgba(0,0,0,0.7), 0 0 0 5px rgba(80,100,140,0.18)"
              : "inset 0 2px 4px rgba(0,0,0,0.7), 0 0 0 3px rgba(0,0,0,0.7), 0 0 0 5px rgba(80,100,140,0.18)",
          }}
        />
        <button
          /* Pointer events instead of onMouseDown/Up so touch + mouse +
             pen all work the same. Spectator/helper sessions can still
             hold AUDIO even though their other interactions are off. */
          disabled={!audioAllowed || module.solved}
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            startListening();
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            stopListening();
          }}
          onPointerCancel={() => stopListening()}
          onPointerLeave={(e) => {
            /* If they slid off without releasing, stop too. Pointer
               capture should prevent this for touch, but mouse can
               escape if e.preventDefault didn't latch. */
            if (e.pointerType !== "touch") stopListening();
          }}
          aria-label="Hold to listen to morse beacon"
          className={`btn-3d px-3 py-2 rounded-sm flex items-center gap-1.5 font-stencil text-[12px] tracking-[0.2em] select-none disabled:opacity-50 ${
            listening
              ? "btn-3d-armed text-phosphor"
              : "text-bone"
          }`}
        >
          <Headphones size={14} strokeWidth={2.4} />
          AUDIO
        </button>
      </div>

      {/* Frequency dial */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <button
            disabled={disabled || module.solved || currentFreq === 0}
            onClick={() => step(-1)}
            className="btn-3d w-9 h-9 rounded-sm flex items-center justify-center text-bone disabled:opacity-50"
            aria-label="Decrease frequency"
          >
            <ChevronLeft size={20} strokeWidth={3} />
          </button>
          <div className="flex-1 bg-black border border-steel/40 px-3 py-2 text-center">
            <span
              className={`led-timer text-2xl ${
                module.solved
                  ? "led-glow-green"
                  : "led-glow-amber"
              }`}
            >
              {MORSE_FREQS[currentFreq].toFixed(3)}
            </span>
            <span
              className={`led-timer text-xs ml-1 ${
                module.solved ? "led-glow-green" : "led-glow-amber"
              }`}
            >
              MHz
            </span>
          </div>
          <button
            disabled={
              disabled || module.solved || currentFreq === MORSE_FREQS.length - 1
            }
            onClick={() => step(1)}
            className="btn-3d w-9 h-9 rounded-sm flex items-center justify-center text-bone disabled:opacity-50"
            aria-label="Increase frequency"
          >
            <ChevronRight size={20} strokeWidth={3} />
          </button>
        </div>

        {/* Frequency tick strip — visual position within the band. */}
        <div className="mt-2 relative h-2 bg-black/60 border border-steel/30 rounded-sm overflow-hidden">
          {MORSE_FREQS.map((_, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 border-l border-steel/20"
              style={{ left: `${(i / (MORSE_FREQS.length - 1)) * 100}%` }}
            />
          ))}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-amber-glow shadow-[0_0_6px_#ffaa3a] transition-all"
            style={{
              left: `${(currentFreq / (MORSE_FREQS.length - 1)) * 100}%`,
            }}
          />
        </div>
      </div>

      <button
        disabled={disabled || module.solved}
        onClick={tx}
        className="btn-3d w-full py-2.5 rounded-sm font-stencil tracking-[0.3em] text-base text-bone flex items-center justify-center gap-2 disabled:opacity-60"
      >
        <Radio size={16} strokeWidth={2.5} />
        TX
      </button>
    </div>
  );
}
