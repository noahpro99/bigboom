import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Radio } from "lucide-react";
import type { Module, MorseModuleConfig } from "../../lib/types";
import { MORSE_FREQS } from "../../lib/types";
import { encodeMorse } from "../../lib/generator";
import { play } from "../../lib/sound";

interface MorseModuleProps {
  module: Module;
  disabled: boolean;
  onDial: (freqIndex: number) => void;
  onTransmit: () => void;
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

export function MorseModule({
  module,
  disabled,
  onDial,
  onTransmit,
}: MorseModuleProps) {
  const config = module.config as MorseModuleConfig;
  const active = config.pool[config.activeIndex];
  const currentFreq = module.state.morseFreqIndex ?? 0;

  /* Drive the flashing light by stepping through the schedule. The
     schedule loops forever while the module is unsolved. */
  const [lit, setLit] = useState(false);
  useEffect(() => {
    if (module.solved) {
      setLit(false);
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
      idx = (idx + 1) % schedule.length;
      timer = window.setTimeout(tick, step.ms);
    };
    timer = window.setTimeout(tick, 400);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active.word, module.solved]);

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

      {/* Flashing lamp */}
      <div className="mx-auto mb-4 flex flex-col items-center">
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
