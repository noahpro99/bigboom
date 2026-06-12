import { Check } from "lucide-react";
import type { Module, SymbolsModuleConfig } from "../../lib/types";
import { play } from "../../lib/sound";

interface SymbolsModuleProps {
  module: Module;
  disabled: boolean;
  onPress: (symbolId: string) => void;
}

function GlyphSvg({
  paths,
  className,
  stroke,
  strokeWidth = 6,
}: {
  paths: string[];
  className?: string;
  stroke?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      stroke={stroke ?? "currentColor"}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/* Engraved glyph — three stacked SVGs of the same path:
   1. Highlight rim, offset up — catches light on the upper bevel edge.
   2. Shadow rim, offset down — the recessed lower lip of the cut.
   3. The cut interior on top, slightly translucent dark so it reads as
      a dark line but the brushed metal below still shows through faintly.
   Strokes are slightly thicker on the rims so the highlight/shadow
   peek out from behind the main cut. */
function EngravedGlyph({
  paths,
  armed,
}: {
  paths: string[];
  armed: boolean;
}) {
  const cut = armed ? "#0a3e28" : "#070a14";
  const cutFill = armed ? "#00f5a0" : "#1a2030";
  const hi = armed ? "rgba(180,255,220,0.7)" : "rgba(230,238,255,0.55)";
  const lo = armed ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.85)";
  return (
    <div className="relative w-full h-full">
      {/* Highlight rim — offset up so it peeks out as a bright lip
          above the cut. Slightly thicker stroke so it's visible. */}
      <GlyphSvg
        paths={paths}
        stroke={hi}
        strokeWidth={7.5}
        className="absolute inset-0 w-full h-full"
      />
      {/* Shadow rim — offset down, peeks out as a darker lip below. */}
      <div
        className="absolute inset-0"
        style={{ transform: "translateY(1.4px)" }}
      >
        <GlyphSvg
          paths={paths}
          stroke={lo}
          strokeWidth={7.5}
          className="w-full h-full"
        />
      </div>
      {/* The cut itself — on top, original stroke width. The highlight
          shows as a 1.4px rim above and shadow as a rim below.
          Outer dark ring keeps the cut crisp; inner color is the
          engraved-channel fill (dark for unpressed, bright phosphor
          for armed). */}
      <div
        className="absolute inset-0"
        style={{ transform: "translateY(-1.4px)" }}
      >
        <GlyphSvg
          paths={paths}
          stroke={cut}
          strokeWidth={6}
          className="absolute inset-0 w-full h-full"
        />
        <GlyphSvg
          paths={paths}
          stroke={cutFill}
          strokeWidth={4}
          className={`absolute inset-0 w-full h-full ${
            armed ? "drop-shadow-[0_0_4px_rgba(0,245,160,0.7)]" : ""
          }`}
        />
      </div>
    </div>
  );
}

export function SymbolsModule({
  module,
  disabled,
  onPress,
}: SymbolsModuleProps) {
  const config = module.config as SymbolsModuleConfig;
  const pressedIds: string[] = module.state.pressedIds ?? [];
  const total = config.activeSymbols.length;

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
        SYMBOLS · MOD-S
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-[10px] font-mono uppercase tracking-widest text-bone-dim">
            {module.solved ? "DEFUSED" : module.struck ? "STRUCK" : "ARMED"}
          </span>
        </div>
      </div>

      {/* Progress pip row */}
      <div className="flex justify-center gap-2 mb-4">
        {Array.from({ length: total }).map((_, i) => {
          const done = i < pressedIds.length;
          return (
            <div
              key={i}
              className={`w-2 h-2 rounded-full border transition-all ${
                done
                  ? "bg-phosphor border-phosphor shadow-[0_0_6px_#00f5a0]"
                  : "bg-transparent border-steel/60"
              }`}
            />
          );
        })}
      </div>

      {/* 2×2 symbol grid — each cell is a 3D push-button */}
      <div className="grid grid-cols-2 gap-4 pt-1 pb-2">
        {config.activeSymbols.map((sym) => {
          const pressed = pressedIds.includes(sym.id);
          const isInteractable = !disabled && !module.solved && !pressed;

          return (
            <button
              key={sym.id}
              disabled={!isInteractable}
              onClick={() => {
                if (!isInteractable) return;
                play("symbolPress");
                onPress(sym.id);
              }}
              className={`relative flex items-center justify-center w-full h-20 rounded-md select-none group ${
                pressed ? "btn-3d btn-3d-armed btn-3d-press" : "btn-3d"
              } ${
                isInteractable ? "cursor-pointer" : "cursor-default"
              } ${!isInteractable && !pressed ? "opacity-60" : ""}`}
            >
              <div className="relative w-14 h-14">
                <EngravedGlyph paths={sym.paths} armed={pressed} />
                {pressed && (
                  <div className="absolute -top-2 -right-2">
                    <div className="w-5 h-5 rounded-full bg-phosphor/90 shadow-[0_0_8px_#00f5a0] border border-phosphor flex items-center justify-center">
                      <Check size={11} className="text-void" strokeWidth={3} />
                    </div>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

    </div>
  );
}
