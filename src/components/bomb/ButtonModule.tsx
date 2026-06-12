import { useRef, useState, useEffect } from "react";
import { BatteryFull } from "lucide-react";
import type { Module, ButtonModuleConfig } from "../../lib/types";
import { play } from "../../lib/sound";

const BUTTON_COLORS: Record<string, string> = {
  red: "#dc2626",
  blue: "#2563eb",
  yellow: "#ca8a04",
  white: "#e2e8f0",
};

const STRIP_COLORS: Record<string, string> = {
  red: "#ef4444",
  blue: "#60a5fa",
  yellow: "#facc15",
  white: "#f8fafc",
};

const HOLD_THRESHOLD_MS = 400;

interface ButtonModuleProps {
  module: Module;
  disabled: boolean;
  onTap: () => void;
  onHoldStart: () => void;
  onHoldRelease: () => void;
}

export function ButtonModule({
  module,
  disabled,
  onTap,
  onHoldStart,
  onHoldRelease,
}: ButtonModuleProps) {
  const config = module.config as ButtonModuleConfig;
  const isHoldingServer = module.state.isHolding ?? false;
  const pressStartRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const [localHolding, setLocalHolding] = useState(false);
  const holding = isHoldingServer || localHolding;
  const bgColor = BUTTON_COLORS[config.color] ?? "#555";
  const textColor =
    config.color === "white" || config.color === "yellow" ? "#111" : "#fff";

  useEffect(() => {
    if (!isHoldingServer) setLocalHolding(false);
  }, [isHoldingServer]);

  function handleMouseDown() {
    if (disabled || module.solved || holding) return;
    pressStartRef.current = Date.now();
    holdTimerRef.current = window.setTimeout(() => {
      setLocalHolding(true);
      play("buttonDown");
      onHoldStart();
    }, HOLD_THRESHOLD_MS);
  }

  function handleMouseUp() {
    if (disabled || module.solved) return;
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    const heldFor = pressStartRef.current
      ? Date.now() - pressStartRef.current
      : 0;
    pressStartRef.current = null;

    if (holding) {
      play("buttonUp");
      onHoldRelease();
    } else if (heldFor < HOLD_THRESHOLD_MS) {
      play("buttonUp");
      onTap();
    }
  }

  function handleMouseLeave() {
    if (holdTimerRef.current !== null && !localHolding) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      pressStartRef.current = null;
    }
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
        BUTTON · MOD-B
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-[10px] font-mono uppercase tracking-widest text-bone-dim">
            {module.solved
              ? "DEFUSED"
              : module.struck
              ? "STRUCK"
              : "ARMED"}
          </span>
        </div>
      </div>

      {/* Top indicator label LED */}
      <div className="flex justify-end mb-2">
        <div className="flex items-center gap-1.5 border border-steel/50 px-2 py-0.5 bg-black/40">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              config.indicatorLit
                ? "bg-amber-glow shadow-[0_0_5px_#ffaa3a]"
                : "bg-steel"
            }`}
          />
          <span
            className={`font-stencil text-[10px] tracking-[0.25em] ${
              config.indicatorLit ? "text-amber-glow" : "text-steel-light"
            }`}
          >
            {config.indicatorLabel}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 pt-1">
        {/* The button */}
        <button
          disabled={disabled || module.solved}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onTouchStart={(e) => {
            e.preventDefault();
            handleMouseDown();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            handleMouseUp();
          }}
          className={`relative w-28 h-28 rounded-full font-stencil text-base tracking-[0.15em] uppercase select-none transition-all duration-100 ${
            disabled || module.solved
              ? "opacity-50 cursor-default"
              : "cursor-pointer"
          } ${holding ? "btn-press" : ""}`}
          style={{
            // Radial highlight on top-left for a glossy domed cap.
            // Slight rigid-hardware tilt + offset — factory tolerance,
            // not visibly crooked. `btn-press` adds the held-down nudge.
            transform: `translate(0.4px, -0.3px) rotate(0.3deg)${
              holding ? " translateY(3px)" : ""
            }`,
            background: `radial-gradient(ellipse at 32% 28%, color-mix(in srgb, ${bgColor} 60%, #fff) 0%, ${bgColor} 35%, color-mix(in srgb, ${bgColor} 70%, #000) 100%)`,
            color: textColor,
            boxShadow: holding
              ? `inset 0 5px 14px rgba(0,0,0,0.7), inset 0 -2px 4px rgba(255,255,255,0.18), 0 0 34px ${bgColor}aa, 0 0 0 4px rgba(0,0,0,0.55), 0 0 0 8px rgba(80,100,140,0.18)`
              : `inset 0 2px 1px rgba(255,255,255,0.4), inset 0 -6px 12px rgba(0,0,0,0.4), 0 8px 0 rgba(0,0,0,0.6), 0 12px 18px rgba(0,0,0,0.55), 0 0 28px ${bgColor}55, 0 0 0 4px rgba(0,0,0,0.55), 0 0 0 8px rgba(80,100,140,0.18)`,
          }}
        >
          <span className="relative z-10">{config.label}</span>
          {/* Subtle ring */}
          <span
            className="absolute inset-1.5 rounded-full pointer-events-none"
            style={{
              border: "1px solid rgba(255,255,255,0.18)",
            }}
          />
        </button>

        {/* Battery indicator */}
        <div className="flex items-center gap-2 border border-steel/40 px-2.5 py-1 bg-black/30">
          <BatteryFull size={14} className="text-bone-dim" strokeWidth={2} />
          <div className="flex gap-1">
            {Array.from({ length: config.batteryCount }).map((_, i) => (
              <div
                key={i}
                className="w-1.5 h-3.5 bg-phosphor/80 shadow-[0_0_3px_#00f5a0]"
              />
            ))}
          </div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-bone-dim">
            x{config.batteryCount}
          </span>
        </div>

        {/* LED strip */}
        {holding && (
          <div className="flex flex-col items-center gap-1.5 mt-1">
            <div
              className="w-32 h-3 rounded-sm led-strip"
              style={{
                backgroundColor: STRIP_COLORS[config.actualStripColor],
                boxShadow: `0 0 14px ${STRIP_COLORS[config.actualStripColor]}, inset 0 0 0 1px rgba(255,255,255,0.2)`,
              }}
            />
            <span className="text-[9px] font-stencil uppercase tracking-[0.3em] text-bone-dim">
              LED STRIP ACTIVE
            </span>
          </div>
        )}

      </div>
    </div>
  );
}
