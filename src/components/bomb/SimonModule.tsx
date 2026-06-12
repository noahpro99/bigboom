import { useEffect, useRef, useState } from "react";
import type { Module, SimonModuleConfig, SimonColor } from "../../lib/types";
import { play } from "../../lib/sound";

interface SimonModuleProps {
  module: Module;
  disabled: boolean;
  onPress: (color: SimonColor) => void;
}

const COLORS: SimonColor[] = ["red", "blue", "yellow", "green"];

/* Diamond layout — top, right, bottom, left.
   Keyed positions so the diamond reads as a real Simon device. */
const POS: Record<SimonColor, { row: 1 | 2 | 3; col: 1 | 2 | 3 }> = {
  red:    { row: 1, col: 2 },
  blue:   { row: 2, col: 3 },
  yellow: { row: 3, col: 2 },
  green:  { row: 2, col: 1 },
};

const PALETTE: Record<SimonColor, { dim: string; lit: string; ring: string }> = {
  red:    { dim: "#5a1a1a", lit: "#ff5050", ring: "#ff7878" },
  blue:   { dim: "#162a5a", lit: "#5da6ff", ring: "#9ec7ff" },
  yellow: { dim: "#5a4a14", lit: "#ffd23a", ring: "#ffe78a" },
  green:  { dim: "#143a25", lit: "#3df09a", ring: "#85ffc8" },
};

export function SimonModule({ module, disabled, onPress }: SimonModuleProps) {
  const config = module.config as SimonModuleConfig;
  const pressedCount = module.state.simonPressed ?? 0;
  const total = config.sequence.length;

  // Cycle through the flash sequence continuously. The pad whose colour
  // matches the current flash lights up; everything else stays dim. A
  // longer pause between full cycles makes it easier to track the start.
  const [flashIdx, setFlashIdx] = useState<number>(0);
  const [lit, setLit] = useState<boolean>(false);
  const litRef = useRef(false);
  litRef.current = lit;

  useEffect(() => {
    if (module.solved) return;
    let cancelled = false;
    let idx = 0;
    let timer: number | undefined;

    const ON_MS = 480;
    const OFF_MS = 280;
    const CYCLE_GAP_MS = 1100;

    const step = () => {
      if (cancelled) return;
      if (!litRef.current) {
        setFlashIdx(idx);
        setLit(true);
        litRef.current = true;
        timer = window.setTimeout(step, ON_MS);
      } else {
        setLit(false);
        litRef.current = false;
        const wrap = idx === total - 1;
        idx = (idx + 1) % total;
        timer = window.setTimeout(step, wrap ? CYCLE_GAP_MS : OFF_MS);
      }
    };
    timer = window.setTimeout(step, 600);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [module.solved, total]);

  // Brief local highlight on tap (in addition to whatever the server says).
  const [tapped, setTapped] = useState<SimonColor | null>(null);
  const tapTimerRef = useRef<number | null>(null);

  function handleTap(color: SimonColor) {
    if (disabled || module.solved) return;
    setTapped(color);
    if (tapTimerRef.current !== null) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = window.setTimeout(() => setTapped(null), 220);
    play("symbolPress");
    onPress(color);
  }

  const flashing: SimonColor | null = lit ? config.sequence[flashIdx] : null;

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
        SIMON · MOD-Σ
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-[10px] font-mono uppercase tracking-widest text-bone-dim">
            {module.solved ? "DEFUSED" : module.struck ? "STRUCK" : "ARMED"}
          </span>
        </div>
        {/* Progress pips — one per flash in the sequence */}
        <div className="flex gap-1.5">
          {Array.from({ length: total }).map((_, i) => {
            const done = i < pressedCount;
            return (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full border ${
                  done
                    ? "bg-phosphor border-phosphor shadow-[0_0_5px_#00f5a0]"
                    : "border-steel/60"
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* 3x3 diamond grid — corners empty, centre has a sequence
          indicator showing which flash position we're on. */}
      <div className="grid grid-cols-3 gap-2 mx-auto" style={{ maxWidth: 240 }}>
        {([1, 2, 3] as const).map((row) =>
          ([1, 2, 3] as const).map((col) => {
            const color = COLORS.find((c) => POS[c].row === row && POS[c].col === col);
            if (!color) {
              // Centre cell: a decorative chassis filler. Progress is
              // surfaced by the pip row in the header, so no text needed.
              if (row === 2 && col === 2) {
                return (
                  <div
                    key={`${row}-${col}`}
                    className="aspect-square flex items-center justify-center border border-steel/35 bg-black/55 rounded-sm"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-steel/60" />
                  </div>
                );
              }
              return <div key={`${row}-${col}`} className="aspect-square" />;
            }

            const p = PALETTE[color];
            const isFlash = flashing === color;
            const isTap = tapped === color;
            const lit = isFlash || isTap;

            return (
              <button
                key={color}
                disabled={disabled || module.solved}
                onClick={() => handleTap(color)}
                aria-label={`${color} pad`}
                className={`relative aspect-square rounded-full select-none transition-all duration-100 ${
                  disabled || module.solved
                    ? "cursor-default"
                    : "cursor-pointer active:translate-y-[1px]"
                } simon-pad simon-pad-${color}`}
                style={{
                  background: lit
                    ? `radial-gradient(circle at 32% 28%, #fff 0%, ${p.lit} 30%, ${p.lit} 55%, color-mix(in srgb, ${p.lit} 70%, #000) 100%)`
                    : `radial-gradient(circle at 32% 28%, color-mix(in srgb, ${p.dim} 60%, #fff) 0%, ${p.dim} 35%, color-mix(in srgb, ${p.dim} 60%, #000) 100%)`,
                  boxShadow: lit
                    ? `0 0 22px ${p.lit}aa, 0 0 38px ${p.lit}66, inset 0 2px 0 rgba(255,255,255,0.5), inset 0 -3px 8px rgba(0,0,0,0.3), 0 0 0 2px ${p.ring}, 0 0 0 4px rgba(0,0,0,0.7), 0 6px 0 rgba(0,0,0,0.55), 0 10px 14px rgba(0,0,0,0.5)`
                    : `inset 0 2px 1px rgba(255,255,255,0.18), inset 0 -4px 8px rgba(0,0,0,0.5), 0 0 0 2px rgba(0,0,0,0.65), 0 0 0 4px rgba(80,100,140,0.18), 0 6px 0 rgba(0,0,0,0.55), 0 10px 14px rgba(0,0,0,0.5)`,
                }}
              />
            );
          })
        )}
      </div>

    </div>
  );
}
