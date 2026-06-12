import { Scissors } from "lucide-react";
import type { Module, WireModuleConfig } from "../../lib/types";
import { play } from "../../lib/sound";

const WIRE_COLORS: Record<string, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  yellow: "#eab308",
  white: "#f1f5f9",
  black: "#374151",
};

interface WireModuleProps {
  module: Module;
  disabled: boolean;
  onCut: (slotIndex: number) => void;
}

export function WireModule({ module, disabled, onCut }: WireModuleProps) {
  const config = module.config as WireModuleConfig;
  const cutWires: number[] = module.state.cutWires ?? [];

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
      {/* Corner screws */}
      <span className="screw top-1.5 left-1.5" />
      <span className="screw top-1.5 right-1.5" />
      <span className="screw bottom-1.5 left-1.5" />
      <span className="screw bottom-1.5 right-1.5" />

      {/* Module label strip */}
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-chassis px-3 py-1 text-sm font-stencil tracking-[0.18em] text-bone border border-steel/60">
        WIRE · MOD-A
      </div>

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

      {/* Top connector strip */}
      <div className="flex justify-around mb-1">
        {config.slots.map((_, i) => (
          <div
            key={`top-${i}`}
            className="w-3 h-3 rounded-full pin-3d"
          />
        ))}
      </div>

      {/* Slots */}
      <div className="relative flex justify-around py-6">
        {config.slots.map((slot, i) => {
          const isEmpty = slot === null;
          const isCut = cutWires.includes(i);
          const clickable = !isEmpty && !disabled && !isCut && !module.solved;
          const color = !isEmpty ? WIRE_COLORS[slot!.color] ?? "#888" : null;

          return (
            <button
              key={i}
              disabled={!clickable}
              onClick={() => {
                if (!clickable) return;
                play("wireSnip");
                onCut(i);
              }}
              className={`relative flex flex-col items-center justify-center group w-3 ${
                isCut ? "wire-cut" : ""
              } ${clickable ? "cursor-pointer" : "cursor-default"}`}
              aria-label={isEmpty ? "Empty slot" : `${slot!.color} wire`}
            >
              {isEmpty ? (
                <div
                  className="w-[2px] border-l-2 border-dashed border-steel-light/35"
                  style={{ height: "64px" }}
                />
              ) : (
                <div
                  className="w-3 rounded-full transition-all duration-150 relative"
                  style={{
                    height: "64px",
                    background: `linear-gradient(90deg, color-mix(in srgb, ${color} 55%, #000) 0%, ${color} 35%, color-mix(in srgb, ${color} 70%, #fff) 55%, ${color} 85%, color-mix(in srgb, ${color} 60%, #000) 100%)`,
                    boxShadow: `0 0 6px ${color}80, inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.4)`,
                    opacity: isCut ? 0.3 : 1,
                  }}
                />
              )}
              {clickable && (
                <Scissors
                  size={36}
                  strokeWidth={2}
                  className="text-bone absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  style={{
                    maxWidth: "none",
                    filter:
                      "drop-shadow(0 0 0 #050a14) drop-shadow(0 1px 0 #050a14) drop-shadow(0 -1px 0 #050a14) drop-shadow(1px 0 0 #050a14) drop-shadow(-1px 0 0 #050a14) drop-shadow(0 3px 6px rgba(0,0,0,0.95))",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom connector strip */}
      <div className="flex justify-around mt-1">
        {config.slots.map((_, i) => (
          <div
            key={`bot-${i}`}
            className="w-3 h-3 rounded-full pin-3d"
          />
        ))}
      </div>
    </div>
  );
}
